import { Request, Response } from "express";
import { joinRequestSchema, requestActionSchema } from "../validators/event-validators";
import {
  createRequest,
  findRequestById,
  findExistingRequest,
  getRequestsForEvent,
  updateRequestStatus,
  withdrawRequest,
  deleteRequest,
  getUserRequests,
  getHostIncomingRequests,
} from "../../dblayer/request-queries";
import { findEventById, incrementAttendedCount } from "../../dblayer/event-queries";
import { approveFreeRequestAndAdmit, findAttendee } from "../../dblayer/payment-queries";
import { findTierById } from "../../dblayer/tier-queries";
import { createNotificationWithSocket } from "../../dblayer/notification-queries";
import { getMutualFriends } from "../../dblayer/friend-queries";
import { findUserById, calculateAge } from "../../dblayer/user-queries";

// POST /api/v1/events/:eventId/requests
export async function requestToJoin(req: Request, res: Response) {
  const eventId = req.params.eventId as string;
  const userId = req.user!.userId;

  const event = await findEventById(eventId);
  if (!event) {
    res.status(404).json({
      success: false,
      error: { code: "NOT_FOUND", message: "Event not found" },
    });
    return;
  }

  if (event.status !== "upcoming") {
    res.status(400).json({
      success: false,
      error: { code: "INVALID_STATE", message: "Can only request to join upcoming events" },
    });
    return;
  }

  if (event.host_id === userId) {
    res.status(400).json({
      success: false,
      error: { code: "SELF_JOIN", message: "You cannot request to join your own event" },
    });
    return;
  }

  const existing = await findExistingRequest(eventId, userId);
  if (existing) {
    // Allow re-request after withdrawal or rejection (M-4)
    if (existing.status === "withdrawn" || existing.status === "rejected") {
      await deleteRequest(existing.id);
    } else {
      res.status(409).json({
        success: false,
        error: { code: "ALREADY_REQUESTED", message: `You already have a ${existing.status} request for this event` },
      });
      return;
    }
  }

  // Age verification: must be 18+ to join a event
  const requestingUser = await findUserById(userId);
  if (!requestingUser?.date_of_birth || (calculateAge(requestingUser.date_of_birth) ?? 0) < 18) {
    res.status(403).json({
      success: false,
      error: { code: "AGE_RESTRICTION", message: "You must be at least 18 years old to join a event" },
    });
    return;
  }

  const parsed = joinRequestSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({
      success: false,
      error: { code: "VALIDATION_ERROR", message: parsed.error.issues[0]?.message || "Invalid input" },
    });
    return;
  }

  const request = await createRequest(eventId, userId, parsed.data.message, parsed.data.tier_id ?? null);

  // Notify host of new join request
  createNotificationWithSocket(
    event.host_id,
    "join_request",
    "New join request",
    `Someone requested to join "${event.title}"`,
    eventId,
    "event"
  ).catch(() => {});

  res.status(201).json({ success: true, data: { request } });
}

// GET /api/v1/events/:eventId/requests (host only)
export async function listRequests(req: Request, res: Response) {
  const eventId = req.params.eventId as string;
  const event = await findEventById(eventId);

  if (!event) {
    res.status(404).json({
      success: false,
      error: { code: "NOT_FOUND", message: "Event not found" },
    });
    return;
  }

  if (event.host_id !== req.user!.userId) {
    res.status(403).json({
      success: false,
      error: { code: "FORBIDDEN", message: "Only the host can view requests" },
    });
    return;
  }

  const status = req.query.status as string | undefined;

  const allowedStatuses = ["pending", "approved", "rejected", "withdrawn"];
  if (status && !allowedStatuses.includes(status)) {
    res.status(400).json({
      success: false,
      error: { code: "INVALID_FILTER", message: "Invalid status filter. Allowed: pending, approved, rejected, withdrawn" },
    });
    return;
  }

  const requests = await getRequestsForEvent(eventId, status);

  // Enrich each request with mutual friends between host and applicant
  const enriched = await Promise.all(
    requests.map(async (r) => {
      const mutuals = await getMutualFriends(req.user!.userId, r.user_id);
      return { ...r, mutual_friends: mutuals };
    })
  );

  res.json({ success: true, data: { requests: enriched } });
}

// PATCH /api/v1/events/:eventId/requests/:requestId (host approves/rejects)
export async function handleRequest(req: Request, res: Response) {
  const { eventId, requestId } = req.params;
  const event = await findEventById(eventId as string);

  if (!event) {
    res.status(404).json({
      success: false,
      error: { code: "NOT_FOUND", message: "Event not found" },
    });
    return;
  }

  if (event.host_id !== req.user!.userId) {
    res.status(403).json({
      success: false,
      error: { code: "FORBIDDEN", message: "Only the host can approve/reject requests" },
    });
    return;
  }

  const parsed = requestActionSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({
      success: false,
      error: { code: "VALIDATION_ERROR", message: parsed.error.issues[0]?.message || "Invalid input" },
    });
    return;
  }

  const request = await findRequestById(requestId as string);
  if (!request || request.event_id !== eventId) {
    res.status(404).json({
      success: false,
      error: { code: "NOT_FOUND", message: "Request not found" },
    });
    return;
  }

  if (request.status !== "pending") {
    res.status(400).json({
      success: false,
      error: { code: "ALREADY_HANDLED", message: `This request is already ${request.status}` },
    });
    return;
  }

  let updated;

  if (parsed.data.status === "approved") {
    // Determine pricing from tier or event default
    let slots = 1;
    let tierId: string | null = request.tier_id ?? null;
    let isFree = event.ticket_price === 0;

    if (tierId) {
      const tier = await findTierById(tierId);
      if (tier) {
        slots = tier.slots;
        isFree = tier.price === 0;
      }
    }

    if (isFree) {
      // Free path: immediately admit (create attendee rows)
      const admission = await approveFreeRequestAndAdmit(
        event.id,
        requestId as string,
        request.user_id,
        slots,
        tierId
      );

      if (!admission) {
        res.status(400).json({
          success: false,
          error: { code: "EVENT_FULL", message: "Event is at full capacity" },
        });
        return;
      }

      await incrementAttendedCount(request.user_id);
    } else {
      // Paid path: just approve the request; user pays via payment flow which creates attendees
      updated = await updateRequestStatus(requestId as string, "approved");
    }

    updated = await findRequestById(requestId as string);
  } else {
    updated = await updateRequestStatus(requestId as string, parsed.data.status);
  }

  // Notify requester of approval/rejection
  createNotificationWithSocket(
    request.user_id,
    `request_${parsed.data.status}`,
    `Request ${parsed.data.status}`,
    `Your request to join "${event.title}" was ${parsed.data.status}`,
    eventId as string,
    "event"
  ).catch(() => {});

  res.json({ success: true, data: { request: updated } });
}

// DELETE /api/v1/events/:eventId/requests/:requestId (withdraw own request)
export async function withdraw(req: Request, res: Response) {
  const { eventId, requestId } = req.params;
  const request = await findRequestById(requestId as string);

  if (!request || request.event_id !== eventId) {
    res.status(404).json({
      success: false,
      error: { code: "NOT_FOUND", message: "Request not found" },
    });
    return;
  }

  if (request.user_id !== req.user!.userId) {
    res.status(403).json({
      success: false,
      error: { code: "FORBIDDEN", message: "You can only withdraw your own requests" },
    });
    return;
  }

  if (request.status !== "pending") {
    res.status(400).json({
      success: false,
      error: { code: "INVALID_STATE", message: "Can only withdraw pending requests" },
    });
    return;
  }

  await withdrawRequest(requestId as string);
  res.json({ success: true, data: { message: "Request withdrawn" } });
}

// GET /api/v1/users/me/requests
export async function myRequests(req: Request, res: Response) {
  const requests = await getUserRequests(req.user!.userId);
  res.json({ success: true, data: { requests } });
}

// GET /api/v1/users/me/host-requests
export async function myHostRequests(req: Request, res: Response) {
  const requests = await getHostIncomingRequests(req.user!.userId);
  res.json({ success: true, data: { requests } });
}

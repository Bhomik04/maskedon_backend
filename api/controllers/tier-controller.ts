import { Request, Response } from "express";
import {
  tierInputSchema,
  tiersArraySchema,
  assignSlotSchema,
} from "../validators/event-validators";
import {
  getEventTiers,
  createTier,
  findTierForEvent,
  updateTier,
  deleteTier,
  createTiersForEvent,
} from "../../dblayer/tier-queries";
import { findEventById } from "../../dblayer/event-queries";
import { findUserByUsername } from "../../dblayer/user-queries";
import { assignSlotToUser } from "../../dblayer/payment-queries";
import { createNotificationWithSocket } from "../../dblayer/notification-queries";

// GET /api/v1/events/:eventId/tiers
export async function listTiers(req: Request, res: Response) {
  const eventId = req.params.eventId as string;

  const event = await findEventById(eventId);
  if (!event) {
    res.status(404).json({ success: false, error: { code: "NOT_FOUND", message: "Event not found" } });
    return;
  }

  const tiers = await getEventTiers(eventId);
  res.json({ success: true, data: { tiers } });
}

// POST /api/v1/events/:eventId/tiers
export async function createEventTier(req: Request, res: Response) {
  const eventId = req.params.eventId as string;
  const userId = req.user!.userId;

  const event = await findEventById(eventId);
  if (!event) {
    res.status(404).json({ success: false, error: { code: "NOT_FOUND", message: "Event not found" } });
    return;
  }
  if (event.host_id !== userId) {
    res.status(403).json({ success: false, error: { code: "FORBIDDEN", message: "Only the host can manage tiers" } });
    return;
  }

  const parsed = tierInputSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ success: false, error: { code: "VALIDATION_ERROR", message: parsed.error.issues[0]?.message || "Invalid tier data" } });
    return;
  }

  const tier = await createTier(eventId, {
    name: parsed.data.name,
    description: parsed.data.description,
    price: parsed.data.price,
    slots: parsed.data.slots,
    max_quantity: parsed.data.max_quantity,
    sort_order: parsed.data.sort_order,
  });

  res.status(201).json({ success: true, data: { tier } });
}

// POST /api/v1/events/:eventId/tiers/bulk
export async function bulkCreateTiers(req: Request, res: Response) {
  const eventId = req.params.eventId as string;
  const userId = req.user!.userId;

  const event = await findEventById(eventId);
  if (!event) {
    res.status(404).json({ success: false, error: { code: "NOT_FOUND", message: "Event not found" } });
    return;
  }
  if (event.host_id !== userId) {
    res.status(403).json({ success: false, error: { code: "FORBIDDEN", message: "Only the host can manage tiers" } });
    return;
  }

  const parsed = tiersArraySchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ success: false, error: { code: "VALIDATION_ERROR", message: parsed.error.issues[0]?.message || "Invalid tiers data" } });
    return;
  }

  const tiers = await createTiersForEvent(eventId, parsed.data.map((t) => ({
    name: t.name,
    description: t.description,
    price: t.price,
    slots: t.slots,
    max_quantity: t.max_quantity,
    sort_order: t.sort_order,
  })));

  res.status(201).json({ success: true, data: { tiers } });
}

// PUT /api/v1/events/:eventId/tiers/:tierId
export async function updateEventTier(req: Request, res: Response) {
  const { eventId, tierId } = req.params as { eventId: string; tierId: string };
  const userId = req.user!.userId;

  const event = await findEventById(eventId);
  if (!event) {
    res.status(404).json({ success: false, error: { code: "NOT_FOUND", message: "Event not found" } });
    return;
  }
  if (event.host_id !== userId) {
    res.status(403).json({ success: false, error: { code: "FORBIDDEN", message: "Only the host can manage tiers" } });
    return;
  }

  const tier = await findTierForEvent(tierId, eventId);
  if (!tier) {
    res.status(404).json({ success: false, error: { code: "NOT_FOUND", message: "Tier not found" } });
    return;
  }

  const parsed = tierInputSchema.partial().safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ success: false, error: { code: "VALIDATION_ERROR", message: parsed.error.issues[0]?.message || "Invalid tier data" } });
    return;
  }

  const updated = await updateTier(tierId, eventId, parsed.data);
  res.json({ success: true, data: { tier: updated } });
}

// DELETE /api/v1/events/:eventId/tiers/:tierId
export async function deleteEventTier(req: Request, res: Response) {
  const { eventId, tierId } = req.params as { eventId: string; tierId: string };
  const userId = req.user!.userId;

  const event = await findEventById(eventId);
  if (!event) {
    res.status(404).json({ success: false, error: { code: "NOT_FOUND", message: "Event not found" } });
    return;
  }
  if (event.host_id !== userId) {
    res.status(403).json({ success: false, error: { code: "FORBIDDEN", message: "Only the host can manage tiers" } });
    return;
  }

  const deleted = await deleteTier(tierId, eventId);
  if (!deleted) {
    res.status(404).json({ success: false, error: { code: "NOT_FOUND", message: "Tier not found" } });
    return;
  }
  res.json({ success: true, data: {} });
}

// POST /api/v1/events/:eventId/attendees/:attendeeId/assign
// Assign an unassigned group slot to another maskedon user by username
export async function assignSlot(req: Request, res: Response) {
  const { eventId, attendeeId } = req.params as { eventId: string; attendeeId: string };
  const requesterId = req.user!.userId;

  const parsed = assignSlotSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ success: false, error: { code: "VALIDATION_ERROR", message: parsed.error.issues[0]?.message || "Username required" } });
    return;
  }

  const assignee = await findUserByUsername(parsed.data.username);
  if (!assignee) {
    res.status(404).json({ success: false, error: { code: "USER_NOT_FOUND", message: "User not found" } });
    return;
  }

  if (assignee.id === requesterId) {
    res.status(400).json({ success: false, error: { code: "SELF_ASSIGN", message: "You cannot assign a slot to yourself" } });
    return;
  }

  const result = await assignSlotToUser(attendeeId, assignee.id, requesterId, eventId);
  if (!result.success) {
    const statusMap: Record<string, number> = {
      "Slot not found": 404,
      "Slot already assigned": 409,
      "Not a group ticket": 400,
      "You are not the group owner": 403,
      "User already has a ticket for this event": 409,
    };
    const status = result.reason ? (statusMap[result.reason] ?? 400) : 400;
    res.status(status).json({ success: false, error: { code: "ASSIGN_FAILED", message: result.reason || "Could not assign slot" } });
    return;
  }

  // Notify the assignee
  const event = await findEventById(eventId);
  if (event) {
    createNotificationWithSocket(
      assignee.id,
      "slot_assigned",
      "You've been added to a event",
      `You have been given a ticket to "${event.title}"`,
      eventId,
      "event"
    ).catch(() => {});
  }

  res.json({ success: true, data: { assignee: { id: assignee.id, username: assignee.username, display_name: assignee.display_name } } });
}

import { Request, Response } from "express";
import multer from "multer";
import { createEventSchema, updateEventSchema } from "../validators/event-validators";
import {
  createEvent,
  findEventById,
  findEventByIdWithHost,
  findEventByPrivateCode,
  discoverEvents,
  updateEvent,
  cancelEvent,
  getEventsByHost,
  getHostAnalytics,
  incrementHostedCount,
  getFriendsAttendingEvents,
  getPopularEventTags,
} from "../../dblayer/event-queries";
import { createTiersForEvent, replaceTiersForEvent } from "../../dblayer/tier-queries";
import { tiersArraySchema } from "../validators/event-validators";
import { findUserById, calculateAge } from "../../dblayer/user-queries";
import { getHostVerificationRaw } from "../../dblayer/verification-queries";
import { issueRefundsForEvent } from "./payment-controller";
import { findAttendee, getEventAttendees } from "../../dblayer/payment-queries";
import { findExistingRequest, getEventRequestCounts } from "../../dblayer/request-queries";
import { createNotificationWithSocket } from "../../dblayer/notification-queries";
import { getFeeBreakdown } from "../lib/fee-calculator";
import { getHostPayoutSummary } from "../../dblayer/financial-ops";
import path from "path";
import { v4 as uuidv4 } from "uuid";
import { uploadToStorage, deleteFromStorage } from "../lib/supabase";
import { logger } from "../lib/logger";

const MAX_FILE_SIZE = parseInt(process.env.MAX_FILE_SIZE || "5242880", 10);
const ALLOWED_MIMES = ["image/jpeg", "image/png", "image/webp"];
const EVENT_COVER_BUCKET = process.env.SUPABASE_EVENT_BUCKET || "photos";

function parseEventTags(tags: unknown): string[] {
  if (Array.isArray(tags)) {
    return tags.filter((tag): tag is string => typeof tag === "string");
  }

  if (typeof tags === "string") {
    try {
      const parsed = JSON.parse(tags);
      if (Array.isArray(parsed)) {
        return parsed.filter((tag): tag is string => typeof tag === "string");
      }
    } catch {
      return [];
    }
  }

  return [];
}

function normalizeEventTags<T extends { tags?: unknown }>(event: T): Omit<T, "tags"> & { tags: string[] } {
  return {
    ...event,
    tags: parseEventTags(event.tags),
  };
}

export const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_FILE_SIZE },
  fileFilter(_req, file, cb) {
    if (ALLOWED_MIMES.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new multer.MulterError("LIMIT_UNEXPECTED_FILE", "Only JPEG, PNG, and WebP images are allowed"));
    }
  },
});

// GET /api/v1/events/tags/suggestions
export async function getTagSuggestions(req: Request, res: Response) {
  const q = typeof req.query.q === "string" ? req.query.q : undefined;
  const limitRaw = typeof req.query.limit === "string" ? parseInt(req.query.limit, 10) : undefined;
  const limit = Number.isFinite(limitRaw) ? limitRaw : 10;

  const tags = await getPopularEventTags(q, limit);
  res.json({ success: true, data: { tags } });
}

// POST /api/v1/events
export async function create(req: Request, res: Response) {
  // Handle multipart data
  const {
    title,
    description,
    location_name,
    location_city,
    latitude,
    longitude,
    date_time,
    end_time,
    ticket_price,
    currency,
    tags,
    min_rating,
    is_private,
    allow_photos,
    food_type,
    allows_alcohol,
    allows_smoking,
    allows_other_substances,
    location_country,
    location_state,
    location_district,
  } = req.body;

  // Parse tags if it's a string (from multipart form)
  let parsedTags: string[] | undefined = undefined;
  if (tags) {
    if (typeof tags === "string") {
      try {
        parsedTags = JSON.parse(tags);
      } catch {
        parsedTags = undefined;
      }
    } else if (Array.isArray(tags)) {
      parsedTags = tags;
    }
  }

  function parseBool(val: unknown): boolean | undefined {
    if (val === undefined || val === null) return undefined;
    if (typeof val === "boolean") return val;
    if (val === "true" || val === "1") return true;
    if (val === "false" || val === "0") return false;
    return undefined;
  }

  // Validate required fields
  const input = {
    title,
    description,
    location_name,
    location_city,
    latitude: latitude ? Number(latitude) : undefined,
    longitude: longitude ? Number(longitude) : undefined,
    date_time,
    end_time,
    ticket_price: ticket_price ? Number(ticket_price) : undefined,
    currency,
    tags: parsedTags,
    min_rating: min_rating ? Number(min_rating) : undefined,
    is_private: parseBool(is_private),
    allow_photos: parseBool(allow_photos),
    food_type: food_type || undefined,
    allows_alcohol: parseBool(allows_alcohol),
    allows_smoking: parseBool(allows_smoking),
    allows_other_substances: parseBool(allows_other_substances),
    location_country: location_country || undefined,
    location_state: location_state || undefined,
    location_district: location_district || undefined,
  };

  const parsed = createEventSchema.safeParse(input);
  if (!parsed.success) {
    res.status(400).json({
      success: false,
      error: { code: "VALIDATION_ERROR", message: parsed.error.issues[0]?.message || "Invalid input" },
    });
    return;
  }

  try {
    const userId = req.user!.userId;

    // One-time host KYC gate: PAN + bank details must be submitted before creating events.
    // Applies to both new and existing users.
    const hostVerification = await getHostVerificationRaw(userId);
    if (!hostVerification) {
      res.status(403).json({
        success: false,
        error: {
          code: "KYC_REQUIRED",
          message: "Please complete host verification (PAN, Aadhaar, and bank details) before creating an event.",
        },
      });
      return;
    }

    // Age verification: host must be 18+ to create a event
    const host = await findUserById(userId);
    if (!host?.date_of_birth || (calculateAge(host.date_of_birth) ?? 0) < 18) {
      res.status(403).json({
        success: false,
        error: { code: "AGE_RESTRICTION", message: "You must be at least 18 years old to host a event" },
      });
      return;
    }

    // Handle cover image upload if provided
    let coverImageUrl: string | undefined = undefined;
    if (req.file) {
      try {
        const ext = path.extname(req.file.originalname).toLowerCase().replace(/[^.a-z0-9]/g, "") || ".jpg";
        const safeName = `${uuidv4()}${ext}`;
        coverImageUrl = await uploadToStorage(EVENT_COVER_BUCKET, req.file.buffer, safeName, req.file.mimetype);
      } catch (uploadError) {
        logger.warn("Event cover image upload failed", uploadError);
        res.status(500).json({
          success: false,
          error: {
            code: "STORAGE_UPLOAD_FAILED",
            message: "Cover image upload failed. Please try again.",
          },
        });
        return;
      }
    }

    // Create event with cover image URL if available
    const eventInput: any = {
      ...parsed.data,
    };
    
    if (coverImageUrl) {
      eventInput.cover_image_url = coverImageUrl;
    }

    const event = await createEvent(userId, eventInput);
    await incrementHostedCount(userId);

    // Create ticket tiers if provided
    if (req.body.tiers) {
      try {
        const rawTiers = typeof req.body.tiers === "string" ? JSON.parse(req.body.tiers) : req.body.tiers;
        const tiersResult = tiersArraySchema.safeParse(rawTiers);
        if (tiersResult.success) {
          await createTiersForEvent(event.id, tiersResult.data);
        }
      } catch {
        // Non-fatal: event was created, tiers can be added later
        logger.warn("Failed to create ticket tiers for event", { eventId: event.id });
      }
    }

    const depositRequired = event.deposit_amount > 0;
    res.status(201).json({
      success: true,
      data: {
        event: normalizeEventTags(event),
        deposit_required: depositRequired,
        deposit_amount: event.deposit_amount,
      },
    });
  } catch (error) {
    logger.error("Event creation failed", error);
    res.status(500).json({
      success: false,
      error: { code: "SERVER_ERROR", message: "Failed to create event" },
    });
  }
}

// GET /api/v1/events
export async function discover(req: Request, res: Response) {
  const userId = req.user?.userId;

  // Look up viewer's social rating to enforce min_rating gate on events
  let viewerRating = 0;
  if (userId) {
    const viewer = await findUserById(userId);
    viewerRating = viewer?.social_rating ?? 0;
  }

  const rawMaxPrice = req.query.max_price ? parseInt(req.query.max_price as string, 10) : undefined;
  const rawPage = req.query.page ? parseInt(req.query.page as string, 10) : undefined;
  const rawLimit = req.query.limit ? parseInt(req.query.limit as string, 10) : undefined;
  const rawLat = req.query.lat ? Number(req.query.lat) : undefined;
  const rawLng = req.query.lng ? Number(req.query.lng) : undefined;
  const rawRadiusKm = req.query.radius_km ? Number(req.query.radius_km) : undefined;

  const filters = {
    city: req.query.city as string | undefined,
    min_date: req.query.min_date as string | undefined,
    max_date: req.query.max_date as string | undefined,
    // Guard against NaN from non-numeric input (M-19)
    max_price: rawMaxPrice !== undefined && !isNaN(rawMaxPrice) ? rawMaxPrice : undefined,
    search: req.query.search as string | undefined,
    sort: req.query.sort as any,
    page: rawPage !== undefined && !isNaN(rawPage) ? Math.max(1, Math.min(rawPage, 1000)) : undefined,
    limit: rawLimit !== undefined && !isNaN(rawLimit) ? rawLimit : undefined,
    lat: rawLat !== undefined && !isNaN(rawLat) ? rawLat : undefined,
    lng: rawLng !== undefined && !isNaN(rawLng) ? rawLng : undefined,
    radius_km: rawRadiusKm !== undefined && !isNaN(rawRadiusKm) ? rawRadiusKm : undefined,
    viewer_rating: viewerRating,
  };

  const result = await discoverEvents(filters);

  // Enrich with friends attending data
  let friendsMap: Record<string, { count: number; friends: { user_id: string; display_name: string; avatar_url: string | null }[] }> = {};
  if (userId && result.events.length > 0) {
    const eventIds = result.events.map((p) => p.id);
    friendsMap = await getFriendsAttendingEvents(userId, eventIds);
  }

  const enriched = result.events.map((p) => ({
    ...normalizeEventTags(p),
    friends_attending: friendsMap[p.id]?.count ?? 0,
    friends_attending_avatars: friendsMap[p.id]?.friends ?? [],
  }));

  res.json({ success: true, data: { events: enriched, total: result.total } });
}

// GET /api/v1/events/:eventId
export async function getEvent(req: Request, res: Response) {
  const eventId = req.params.eventId as string;
  const userId = req.user?.userId ?? null;

  const [event, request, attendee] = await Promise.all([
    findEventByIdWithHost(eventId),
    userId ? findExistingRequest(eventId, userId) : Promise.resolve(null),
    userId ? findAttendee(eventId, userId) : Promise.resolve(null),
  ]);

  if (!event) {
    res.status(404).json({
      success: false,
      error: { code: "NOT_FOUND", message: "Event not found" },
    });
    return;
  }

  const isHost = userId ? event.host_id === userId : false;
  const isAttending = !!attendee;

  const eventData = normalizeEventTags(event);
  const distance_km = typeof eventData.distance_km === "number" ? eventData.distance_km : null;

  const showMap = event.ticket_price === 0 || isHost || isAttending;
  const sanitizedEvent = {
    ...eventData,
    latitude: showMap ? eventData.latitude : null,
    longitude: showMap ? eventData.longitude : null,
    private_code: isHost ? eventData.private_code : undefined,
    // Hide total attendee count from guests
    current_attendees: isHost ? eventData.current_attendees : undefined,
  };

  // Host: full attendee list + request stats panel
  let attendees: Awaited<ReturnType<typeof getEventAttendees>> = [];
  let host_stats: { pending_count: number; approved_not_joined_count: number } | undefined;
  if (isHost) {
    [attendees, host_stats] = await Promise.all([
      getEventAttendees(eventId),
      getEventRequestCounts(eventId),
    ]);
  }

  // Guests: list of their friends who are attending
  let friends_attending: { user_id: string; display_name: string; avatar_url: string | null }[] = [];
  if (!isHost && userId) {
    const friendsMap = await getFriendsAttendingEvents(userId, [eventId]);
    friends_attending = friendsMap[eventId]?.friends ?? [];
  }

  // Fee breakdown (shown to guests before paying; also useful for hosts)
  const fee_breakdown = event.ticket_price > 0
    ? getFeeBreakdown(event.ticket_price, event.host_commission_rate)
    : null;

  res.json({
    success: true,
    data: {
      event: sanitizedEvent,
      attendees,
      friends_attending,
      host_stats,
      fee_breakdown,
      viewer: userId ? {
        request_status: request?.status ?? null,
        request_id: request?.id ?? null,
        is_attending: isAttending,
      } : null,
    },
  });
}

// PUT /api/v1/events/:eventId
export async function update(req: Request, res: Response) {
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
      error: { code: "FORBIDDEN", message: "Only the host can edit this event" },
    });
    return;
  }

  if (event.status !== "upcoming") {
    res.status(400).json({
      success: false,
      error: { code: "INVALID_STATE", message: "Can only edit upcoming events" },
    });
    return;
  }

  const parsed = updateEventSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({
      success: false,
      error: { code: "VALIDATION_ERROR", message: parsed.error.issues[0]?.message || "Invalid input" },
    });
    return;
  }

  const updated = await updateEvent(eventId, parsed.data);

  // Replace ticket tiers if provided
  if (req.body.tiers !== undefined) {
    try {
      const rawTiers = typeof req.body.tiers === "string" ? JSON.parse(req.body.tiers) : req.body.tiers;
      const tiersResult = tiersArraySchema.safeParse(rawTiers);
      if (tiersResult.success) {
        await replaceTiersForEvent(eventId, tiersResult.data);
      }
    } catch {
      logger.warn("Failed to replace ticket tiers for event", { eventId });
    }
  }

  res.json({ success: true, data: { event: updated ? normalizeEventTags(updated) : null } });
}

// PATCH /api/v1/events/:eventId/cancel
export async function cancel(req: Request, res: Response) {
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
      error: { code: "FORBIDDEN", message: "Only the host can cancel this event" },
    });
    return;
  }

  if (event.status === "completed" || event.status === "cancelled" || event.status === "archived") {
    res.status(400).json({
      success: false,
      error: { code: "INVALID_STATE", message: "Cannot cancel a event in this state" },
    });
    return;
  }

  await cancelEvent(eventId, req.user!.userId);
  await issueRefundsForEvent(eventId);

  // Clean up cover image from storage
  if (event.cover_image_url) {
    deleteFromStorage(EVENT_COVER_BUCKET, event.cover_image_url).catch(() => {});
  }

  // Notify all attendees of cancellation
  const attendees = await getEventAttendees(eventId);
  for (const attendee of attendees) {
    if (!attendee.user_id) continue; // skip unassigned group slots
    createNotificationWithSocket(
      attendee.user_id,
      "event_cancelled",
      "Event cancelled",
      `"${event.title}" has been cancelled. Any payments have been refunded.`,
      eventId,
      "event"
    ).catch(() => {});
  }

  res.json({ success: true, data: { message: "Event cancelled. All payments refunded." } });
}

// GET /api/v1/events/:eventId/attendees
export async function listAttendees(req: Request, res: Response) {
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

  // Only the host may enumerate attendees (H-7)
  if (event.host_id !== userId) {
    res.status(403).json({
      success: false,
      error: { code: "FORBIDDEN", message: "Only the host can view the attendee list" },
    });
    return;
  }

  const attendees = await getEventAttendees(eventId);
  res.json({ success: true, data: { attendees } });
}

// GET /api/v1/users/me/events (host dashboard)
export async function myHostedEvents(req: Request, res: Response) {
  const events = await getEventsByHost(req.user!.userId);
  res.json({ success: true, data: { events: events.map((event) => normalizeEventTags(event)) } });
}

// GET /api/v1/users/me/host-analytics
export async function hostAnalytics(req: Request, res: Response) {
  const analytics = await getHostAnalytics(req.user!.userId);
  const payouts = await getHostPayoutSummary(req.user!.userId);
  res.json({ success: true, data: { analytics: { ...analytics, payouts } } });
}

// GET /api/v1/events/private/:code
// Lookup a private event by its 10-char code.
// The full code must match exactly — no partial guessing.
export async function findByPrivateCode(req: Request, res: Response) {
  const code = (req.params.code as string).trim().toUpperCase();
  if (!/^[A-Z0-9]{10}$/.test(code)) {
    res.status(400).json({
      success: false,
      error: { code: "INVALID_CODE", message: "Invalid event code format" },
    });
    return;
  }

  const event = await findEventByPrivateCode(code);
  if (!event) {
    res.status(404).json({
      success: false,
      error: { code: "NOT_FOUND", message: "No private event found with that code" },
    });
    return;
  }

  // Never expose the private_code in the lookup response (caller already has it)
  const { private_code: _hidden, ...eventData } = normalizeEventTags(event) as any;

  res.json({ success: true, data: { event: eventData } });
}

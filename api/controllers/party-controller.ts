import { Request, Response } from "express";
import multer from "multer";
import { createPartySchema, updatePartySchema } from "../validators/party-validators";
import {
  createParty,
  findPartyById,
  findPartyByIdWithHost,
  findPartyByPrivateCode,
  discoverParties,
  updateParty,
  cancelParty,
  getPartiesByHost,
  getHostAnalytics,
  incrementHostedCount,
  getFriendsAttendingParties,
  getPopularPartyTags,
} from "../../dblayer/party-queries";
import { createTiersForParty, replaceTiersForParty } from "../../dblayer/tier-queries";
import { tiersArraySchema } from "../validators/party-validators";
import { findUserById, calculateAge } from "../../dblayer/user-queries";
import { issueRefundsForParty } from "./payment-controller";
import { findAttendee, getPartyAttendees } from "../../dblayer/payment-queries";
import { findExistingRequest, getPartyRequestCounts } from "../../dblayer/request-queries";
import { createNotificationWithSocket } from "../../dblayer/notification-queries";
import { getFeeBreakdown } from "../lib/fee-calculator";
import path from "path";
import { v4 as uuidv4 } from "uuid";
import { uploadToStorage, deleteFromStorage } from "../lib/supabase";
import { logger } from "../lib/logger";

const MAX_FILE_SIZE = parseInt(process.env.MAX_FILE_SIZE || "5242880", 10);
const ALLOWED_MIMES = ["image/jpeg", "image/png", "image/webp"];
const PARTY_COVER_BUCKET = process.env.SUPABASE_PARTY_BUCKET || "photos";

function parsePartyTags(tags: unknown): string[] {
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

function normalizePartyTags<T extends { tags?: unknown }>(party: T): Omit<T, "tags"> & { tags: string[] } {
  return {
    ...party,
    tags: parsePartyTags(party.tags),
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

// GET /api/v1/parties/tags/suggestions
export async function getTagSuggestions(req: Request, res: Response) {
  const q = typeof req.query.q === "string" ? req.query.q : undefined;
  const limitRaw = typeof req.query.limit === "string" ? parseInt(req.query.limit, 10) : undefined;
  const limit = Number.isFinite(limitRaw) ? limitRaw : 10;

  const tags = await getPopularPartyTags(q, limit);
  res.json({ success: true, data: { tags } });
}

// POST /api/v1/parties
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

  const parsed = createPartySchema.safeParse(input);
  if (!parsed.success) {
    res.status(400).json({
      success: false,
      error: { code: "VALIDATION_ERROR", message: parsed.error.issues[0]?.message || "Invalid input" },
    });
    return;
  }

  try {
    const userId = req.user!.userId;

    // Age verification: host must be 18+ to create a party
    const host = await findUserById(userId);
    if (!host?.date_of_birth || (calculateAge(host.date_of_birth) ?? 0) < 18) {
      res.status(403).json({
        success: false,
        error: { code: "AGE_RESTRICTION", message: "You must be at least 18 years old to host a party" },
      });
      return;
    }

    // Handle cover image upload if provided
    let coverImageUrl: string | undefined = undefined;
    if (req.file) {
      try {
        const ext = path.extname(req.file.originalname).toLowerCase().replace(/[^.a-z0-9]/g, "") || ".jpg";
        const safeName = `${uuidv4()}${ext}`;
        coverImageUrl = await uploadToStorage(PARTY_COVER_BUCKET, req.file.buffer, safeName, req.file.mimetype);
      } catch (uploadError) {
        logger.warn("Party cover image upload failed", uploadError);
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

    // Create party with cover image URL if available
    const partyInput: any = {
      ...parsed.data,
    };
    
    if (coverImageUrl) {
      partyInput.cover_image_url = coverImageUrl;
    }

    const party = await createParty(userId, partyInput);
    await incrementHostedCount(userId);

    // Create ticket tiers if provided
    if (req.body.tiers) {
      try {
        const rawTiers = typeof req.body.tiers === "string" ? JSON.parse(req.body.tiers) : req.body.tiers;
        const tiersResult = tiersArraySchema.safeParse(rawTiers);
        if (tiersResult.success) {
          await createTiersForParty(party.id, tiersResult.data);
        }
      } catch {
        // Non-fatal: party was created, tiers can be added later
        logger.warn("Failed to create ticket tiers for party", { partyId: party.id });
      }
    }

    const depositRequired = party.deposit_amount > 0;
    res.status(201).json({
      success: true,
      data: {
        party: normalizePartyTags(party),
        deposit_required: depositRequired,
        deposit_amount: party.deposit_amount,
      },
    });
  } catch (error) {
    logger.error("Party creation failed", error);
    res.status(500).json({
      success: false,
      error: { code: "SERVER_ERROR", message: "Failed to create party" },
    });
  }
}

// GET /api/v1/parties
export async function discover(req: Request, res: Response) {
  const userId = req.user?.userId;

  // Look up viewer's social rating to enforce min_rating gate on parties
  let viewerRating = 0;
  if (userId) {
    const viewer = await findUserById(userId);
    viewerRating = viewer?.social_rating ?? 0;
  }

  const rawMaxPrice = req.query.max_price ? parseInt(req.query.max_price as string, 10) : undefined;
  const rawPage = req.query.page ? parseInt(req.query.page as string, 10) : undefined;
  const rawLimit = req.query.limit ? parseInt(req.query.limit as string, 10) : undefined;

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
    viewer_rating: viewerRating,
  };

  const result = await discoverParties(filters);

  // Enrich with friends attending data
  let friendsMap: Record<string, { count: number; friends: { user_id: string; display_name: string; avatar_url: string | null }[] }> = {};
  if (userId && result.parties.length > 0) {
    const partyIds = result.parties.map((p) => p.id);
    friendsMap = await getFriendsAttendingParties(userId, partyIds);
  }

  const enriched = result.parties.map((p) => ({
    ...normalizePartyTags(p),
    friends_attending: friendsMap[p.id]?.count ?? 0,
    friends_attending_avatars: friendsMap[p.id]?.friends ?? [],
  }));

  res.json({ success: true, data: { parties: enriched, total: result.total } });
}

// GET /api/v1/parties/:partyId
export async function getParty(req: Request, res: Response) {
  const partyId = req.params.partyId as string;
  const userId = req.user?.userId ?? null;

  const [party, request, attendee] = await Promise.all([
    findPartyByIdWithHost(partyId),
    userId ? findExistingRequest(partyId, userId) : Promise.resolve(null),
    userId ? findAttendee(partyId, userId) : Promise.resolve(null),
  ]);

  if (!party) {
    res.status(404).json({
      success: false,
      error: { code: "NOT_FOUND", message: "Party not found" },
    });
    return;
  }

  const isHost = userId ? party.host_id === userId : false;
  const isAttending = !!attendee;

  const partyData = normalizePartyTags(party);

  const showMap = party.ticket_price === 0 || isHost || isAttending;
  const sanitizedParty = {
    ...partyData,
    latitude: showMap ? partyData.latitude : null,
    longitude: showMap ? partyData.longitude : null,
    private_code: isHost ? partyData.private_code : undefined,
    // Hide total attendee count from guests
    current_attendees: isHost ? partyData.current_attendees : undefined,
  };

  // Host: full attendee list + request stats panel
  let attendees: Awaited<ReturnType<typeof getPartyAttendees>> = [];
  let host_stats: { pending_count: number; approved_not_joined_count: number } | undefined;
  if (isHost) {
    [attendees, host_stats] = await Promise.all([
      getPartyAttendees(partyId),
      getPartyRequestCounts(partyId),
    ]);
  }

  // Guests: list of their friends who are attending
  let friends_attending: { user_id: string; display_name: string; avatar_url: string | null }[] = [];
  if (!isHost && userId) {
    const friendsMap = await getFriendsAttendingParties(userId, [partyId]);
    friends_attending = friendsMap[partyId]?.friends ?? [];
  }

  // Fee breakdown (shown to guests before paying; also useful for hosts)
  const fee_breakdown = party.ticket_price > 0
    ? getFeeBreakdown(party.ticket_price, party.host_commission_rate)
    : null;

  res.json({
    success: true,
    data: {
      party: sanitizedParty,
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

// PUT /api/v1/parties/:partyId
export async function update(req: Request, res: Response) {
  const partyId = req.params.partyId as string;
  const party = await findPartyById(partyId);

  if (!party) {
    res.status(404).json({
      success: false,
      error: { code: "NOT_FOUND", message: "Party not found" },
    });
    return;
  }

  if (party.host_id !== req.user!.userId) {
    res.status(403).json({
      success: false,
      error: { code: "FORBIDDEN", message: "Only the host can edit this party" },
    });
    return;
  }

  if (party.status !== "upcoming") {
    res.status(400).json({
      success: false,
      error: { code: "INVALID_STATE", message: "Can only edit upcoming parties" },
    });
    return;
  }

  const parsed = updatePartySchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({
      success: false,
      error: { code: "VALIDATION_ERROR", message: parsed.error.issues[0]?.message || "Invalid input" },
    });
    return;
  }

  const updated = await updateParty(partyId, parsed.data);

  // Replace ticket tiers if provided
  if (req.body.tiers !== undefined) {
    try {
      const rawTiers = typeof req.body.tiers === "string" ? JSON.parse(req.body.tiers) : req.body.tiers;
      const tiersResult = tiersArraySchema.safeParse(rawTiers);
      if (tiersResult.success) {
        await replaceTiersForParty(partyId, tiersResult.data);
      }
    } catch {
      logger.warn("Failed to replace ticket tiers for party", { partyId });
    }
  }

  res.json({ success: true, data: { party: updated ? normalizePartyTags(updated) : null } });
}

// PATCH /api/v1/parties/:partyId/cancel
export async function cancel(req: Request, res: Response) {
  const partyId = req.params.partyId as string;
  const party = await findPartyById(partyId);

  if (!party) {
    res.status(404).json({
      success: false,
      error: { code: "NOT_FOUND", message: "Party not found" },
    });
    return;
  }

  if (party.host_id !== req.user!.userId) {
    res.status(403).json({
      success: false,
      error: { code: "FORBIDDEN", message: "Only the host can cancel this party" },
    });
    return;
  }

  if (party.status === "completed" || party.status === "cancelled" || party.status === "archived") {
    res.status(400).json({
      success: false,
      error: { code: "INVALID_STATE", message: "Cannot cancel a party in this state" },
    });
    return;
  }

  await cancelParty(partyId, req.user!.userId);
  await issueRefundsForParty(partyId);

  // Clean up cover image from storage
  if (party.cover_image_url) {
    deleteFromStorage(PARTY_COVER_BUCKET, party.cover_image_url).catch(() => {});
  }

  // Notify all attendees of cancellation
  const attendees = await getPartyAttendees(partyId);
  for (const attendee of attendees) {
    if (!attendee.user_id) continue; // skip unassigned group slots
    createNotificationWithSocket(
      attendee.user_id,
      "party_cancelled",
      "Party cancelled",
      `"${party.title}" has been cancelled. Any payments have been refunded.`,
      partyId,
      "party"
    ).catch(() => {});
  }

  res.json({ success: true, data: { message: "Party cancelled. All payments refunded." } });
}

// GET /api/v1/parties/:partyId/attendees
export async function listAttendees(req: Request, res: Response) {
  const partyId = req.params.partyId as string;
  const userId = req.user!.userId;
  const party = await findPartyById(partyId);

  if (!party) {
    res.status(404).json({
      success: false,
      error: { code: "NOT_FOUND", message: "Party not found" },
    });
    return;
  }

  // Only the host may enumerate attendees (H-7)
  if (party.host_id !== userId) {
    res.status(403).json({
      success: false,
      error: { code: "FORBIDDEN", message: "Only the host can view the attendee list" },
    });
    return;
  }

  const attendees = await getPartyAttendees(partyId);
  res.json({ success: true, data: { attendees } });
}

// GET /api/v1/users/me/parties (host dashboard)
export async function myHostedParties(req: Request, res: Response) {
  const parties = await getPartiesByHost(req.user!.userId);
  res.json({ success: true, data: { parties: parties.map((party) => normalizePartyTags(party)) } });
}

// GET /api/v1/users/me/host-analytics
export async function hostAnalytics(req: Request, res: Response) {
  const analytics = await getHostAnalytics(req.user!.userId);
  res.json({ success: true, data: { analytics } });
}

// GET /api/v1/parties/private/:code
// Lookup a private party by its 10-char code.
// The full code must match exactly — no partial guessing.
export async function findByPrivateCode(req: Request, res: Response) {
  const code = (req.params.code as string).trim().toUpperCase();
  if (!/^[A-Z0-9]{10}$/.test(code)) {
    res.status(400).json({
      success: false,
      error: { code: "INVALID_CODE", message: "Invalid party code format" },
    });
    return;
  }

  const party = await findPartyByPrivateCode(code);
  if (!party) {
    res.status(404).json({
      success: false,
      error: { code: "NOT_FOUND", message: "No private party found with that code" },
    });
    return;
  }

  // Never expose the private_code in the lookup response (caller already has it)
  const { private_code: _hidden, ...partyData } = normalizePartyTags(party) as any;

  res.json({ success: true, data: { party: partyData } });
}

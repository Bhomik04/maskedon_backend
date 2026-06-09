import { Request, Response } from "express";
import { logger } from "../lib/logger";
import { crowdRatingSchema } from "../validators/rating-validators";
import {
  submitCrowdRating,
  findCrowdRating,
  getEventCrowdAverage,
  getUserPendingCrowdRatings,
  recalcUserCrowdRating,
  getUserCrowdRatingHistory,
} from "../../dblayer/rating-queries";
import { findEventById } from "../../dblayer/event-queries";
import { findAttendee } from "../../dblayer/payment-queries";
import { getTrustLevel } from "../../algorithms/social-rating";

const RATING_WINDOW_DAYS = 7;

// POST /api/v1/events/:eventId/ratings/crowd
export async function rateCrowd(req: Request, res: Response) {
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

  // Event must have ended
  const eventEnd = new Date(event.end_time || event.date_time);
  if (new Date() < eventEnd) {
    res.status(400).json({
      success: false,
      error: { code: "NOT_ENDED", message: "Ratings open once the event has ended" },
    });
    return;
  }

  // Check rating window (7 days after event end)
  const windowClose = new Date(eventEnd.getTime() + RATING_WINDOW_DAYS * 24 * 60 * 60 * 1000);
  if (new Date() > windowClose) {
    res.status(400).json({
      success: false,
      error: { code: "WINDOW_CLOSED", message: "Rating window has closed (7 days after event)" },
    });
    return;
  }

  const parsed = crowdRatingSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({
      success: false,
      error: { code: "VALIDATION_ERROR", message: parsed.error.issues[0]?.message || "Invalid input" },
    });
    return;
  }

  const { score } = parsed.data;

  // User must be a participant (attendee or host)
  const isHost = event.host_id === userId;
  const attendee = isHost ? true : await findAttendee(eventId, userId);
  if (!attendee) {
    res.status(403).json({
      success: false,
      error: { code: "NOT_PARTICIPANT", message: "You must be a participant of this event to rate" },
    });
    return;
  }

  // Check if already rated
  const existing = await findCrowdRating(userId, eventId);
  if (existing) {
    res.status(409).json({
      success: false,
      error: { code: "ALREADY_RATED", message: "You have already rated the crowd for this event" },
    });
    return;
  }

  let rating;
  try {
    rating = await submitCrowdRating(userId, eventId, score);
  } catch (err) {
    logger.error("Failed to submit crowd rating", err);
    res.status(500).json({
      success: false,
      error: { code: "SERVER_ERROR", message: "Failed to submit rating" },
    });
    return;
  }

  // Recalculate the submitter's social rating (non-critical)
  recalcUserCrowdRating(userId).catch((err) =>
    logger.error("Failed to recalculate user rating", err)
  );

  // Get updated event average
  const eventAvg = await getEventCrowdAverage(eventId);

  res.status(201).json({
    success: true,
    data: {
      rating,
      event_average: eventAvg,
    },
  });
}

// GET /api/v1/ratings/pending
export async function pendingRatings(req: Request, res: Response) {
  const userId = req.user!.userId;
  const pending = await getUserPendingCrowdRatings(userId);
  res.json({ success: true, data: { pending } });
}

// GET /api/v1/events/:eventId/ratings
export async function eventRatings(req: Request, res: Response) {
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

  const [existingRating, average] = await Promise.all([
    findCrowdRating(userId, eventId),
    getEventCrowdAverage(eventId),
  ]);

  res.json({
    success: true,
    data: {
      has_rated: !!existingRating,
      average: average?.avg_score || 0,
      total_votes: average?.total_votes || 0,
    },
  });
}

// GET /api/v1/users/:userId/ratings
export async function userRatings(req: Request, res: Response) {
  const userId = req.params.userId as string;
  const history = await getUserCrowdRatingHistory(userId);
  res.json({ success: true, data: { history } });
}

// GET /api/v1/users/:userId/trust-level
export async function userTrustLevel(req: Request, res: Response) {
  const userId = req.params.userId as string;
  const { social_rating, total_ratings } = await recalcUserCrowdRating(userId);
  const trustLevel = getTrustLevel(social_rating, total_ratings);

  res.json({
    success: true,
    data: {
      social_rating,
      total_ratings,
      trust_level: trustLevel,
    },
  });
}

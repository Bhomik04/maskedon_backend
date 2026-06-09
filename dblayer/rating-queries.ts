import { query } from "./connection";
import { v4 as uuidv4 } from "uuid";

// ============================================
// CROWD RATING TYPES
// ============================================

export interface CrowdRatingRow {
  id: string;
  user_id: string;
  event_id: string;
  score: number;
  created_at: Date;
}

export interface PendingRatingEvent {
  id: string;
  title: string;
  date_time: string;
  end_time: string | null;
  cover_image_url: string | null;
  location_name: string;
  location_city: string;
}

export interface EventRatingSummary {
  event_id: string;
  avg_score: number;
  total_votes: number;
}

// ============================================
// CROWD RATING QUERIES
// ============================================

/** Submit a crowd rating for a event (one per user per event). */
export async function submitCrowdRating(
  userId: string,
  eventId: string,
  score: number
): Promise<CrowdRatingRow> {
  const id = uuidv4();
  await query(
    `INSERT INTO crowd_ratings (id, user_id, event_id, score)
     VALUES (?, ?, ?, ?)`,
    [id, userId, eventId, score]
  );
  const result = await query<CrowdRatingRow>(
    "SELECT * FROM crowd_ratings WHERE id = ?",
    [id]
  );
  return result.rows[0]!;
}

/** Check if a user already rated a event. */
export async function findCrowdRating(
  userId: string,
  eventId: string
): Promise<CrowdRatingRow | null> {
  const result = await query<CrowdRatingRow>(
    "SELECT * FROM crowd_ratings WHERE user_id = ? AND event_id = ?",
    [userId, eventId]
  );
  return result.rows[0] || null;
}

/** Get the average crowd rating for a specific event. */
export async function getEventCrowdAverage(
  eventId: string
): Promise<EventRatingSummary | null> {
  const result = await query<{ avg_score: string; total_votes: string }>(
    `SELECT AVG(score) as avg_score, COUNT(*) as total_votes
     FROM crowd_ratings WHERE event_id = ?`,
    [eventId]
  );
  const row = result.rows[0];
  if (!row || !row.avg_score) return null;
  return {
    event_id: eventId,
    avg_score: Math.round(parseFloat(row.avg_score) * 100) / 100,
    total_votes: parseInt(row.total_votes, 10),
  };
}

/**
 * Get all pending events that a user needs to rate.
 * A event is pending if:
 *   1. The user was a participant (attendee or host)
 *   2. The event has ended (end_time or date_time is in the past)
 *   3. The user hasn't submitted a crowd rating yet
 *   4. The event ended within the last 7 days (rating window)
 *   5. The event is not cancelled or deleted
 */
export async function getUserPendingCrowdRatings(
  userId: string
): Promise<PendingRatingEvent[]> {
  const result = await query<PendingRatingEvent>(
    `SELECT p.id, p.title, p.date_time, p.end_time, p.cover_image_url,
            p.location_name, p.location_city
     FROM events p
     WHERE (
       p.id IN (SELECT pa.event_id FROM event_attendees pa WHERE pa.user_id = ?)
       OR p.host_id = ?
     )
     AND (
       (p.end_time IS NOT NULL AND p.end_time < NOW())
       OR (p.end_time IS NULL AND p.date_time < NOW())
     )
     AND (
       (p.end_time IS NOT NULL AND p.end_time > NOW() - INTERVAL '7 days')
       OR (p.end_time IS NULL AND p.date_time > NOW() - INTERVAL '7 days')
     )
     AND p.id NOT IN (SELECT cr.event_id FROM crowd_ratings cr WHERE cr.user_id = ?)
     AND p.status != 'cancelled'
     AND p.deleted_at IS NULL
     ORDER BY COALESCE(p.end_time, p.date_time) DESC`,
    [userId, userId, userId]
  );
  return result.rows;
}

/**
 * Recalculate a user's social_rating based on crowd ratings.
 *
 * social_rating = average of all event crowd averages for events the user participated in.
 * total_ratings = number of distinct events with crowd data that the user participated in.
 */
export async function recalcUserCrowdRating(userId: string): Promise<{
  social_rating: number;
  total_ratings: number;
}> {
  const result = await query<{ social_rating: string; total_ratings: string }>(
    `SELECT
       COALESCE(AVG(event_avg), 0) as social_rating,
       COUNT(*) as total_ratings
     FROM (
       SELECT cr.event_id, AVG(cr.score) as event_avg
       FROM crowd_ratings cr
       WHERE cr.event_id IN (
         SELECT pa.event_id FROM event_attendees pa WHERE pa.user_id = ?
         UNION
         SELECT p.id FROM events p WHERE p.host_id = ?
       )
       GROUP BY cr.event_id
       HAVING COUNT(cr.id) >= 1
     ) event_avgs`,
    [userId, userId]
  );

  const row = result.rows[0];
  const social_rating = row ? Math.round(parseFloat(row.social_rating) * 100) / 100 : 0;
  const total_ratings = row ? parseInt(row.total_ratings, 10) : 0;

  // Update cached value on the user record
  await query(
    `UPDATE users SET social_rating = ?, total_ratings = ? WHERE id = ?`,
    [social_rating, total_ratings, userId]
  );

  return { social_rating, total_ratings };
}

/**
 * Get crowd rating history for a user — each event they participated in with its crowd average.
 */
export async function getUserCrowdRatingHistory(userId: string): Promise<Array<{
  event_id: string;
  event_title: string;
  event_date: string;
  avg_score: number;
  total_votes: number;
  user_voted: boolean;
}>> {
  const result = await query<{
    event_id: string;
    event_title: string;
    event_date: string;
    avg_score: string;
    total_votes: string;
    user_voted: string;
  }>(
    `SELECT
       p.id as event_id,
       p.title as event_title,
       COALESCE(p.end_time, p.date_time)::text as event_date,
       COALESCE(AVG(cr.score), 0) as avg_score,
       COUNT(cr.id) as total_votes,
       CASE WHEN EXISTS (
         SELECT 1 FROM crowd_ratings cr2 WHERE cr2.event_id = p.id AND cr2.user_id = ?
       ) THEN 1 ELSE 0 END as user_voted
     FROM events p
     LEFT JOIN crowd_ratings cr ON cr.event_id = p.id
     WHERE (
       p.id IN (SELECT pa.event_id FROM event_attendees pa WHERE pa.user_id = ?)
       OR p.host_id = ?
     )
     AND (
       (p.end_time IS NOT NULL AND p.end_time < NOW())
       OR (p.end_time IS NULL AND p.date_time < NOW())
     )
     AND p.status != 'cancelled'
     AND p.deleted_at IS NULL
     GROUP BY p.id, p.title, p.end_time, p.date_time
     HAVING COUNT(cr.id) >= 1
     ORDER BY COALESCE(p.end_time, p.date_time) DESC`,
    [userId, userId, userId]
  );

  return result.rows.map((r) => ({
    event_id: r.event_id,
    event_title: r.event_title,
    event_date: r.event_date,
    avg_score: Math.round(parseFloat(r.avg_score) * 100) / 100,
    total_votes: parseInt(r.total_votes, 10),
    user_voted: r.user_voted === "1" || r.user_voted === "true" || (r.user_voted as unknown) === true,
  }));
}

/** Get all crowd ratings for a specific event. */
export async function getEventCrowdRatings(eventId: string): Promise<CrowdRatingRow[]> {
  const result = await query<CrowdRatingRow>(
    `SELECT * FROM crowd_ratings WHERE event_id = ? ORDER BY created_at DESC`,
    [eventId]
  );
  return result.rows;
}

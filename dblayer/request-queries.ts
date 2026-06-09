import { query } from "./connection";
import { v4 as uuidv4 } from "uuid";

// ============================================
// REQUEST TYPES
// ============================================

export interface RequestRow {
  id: string;
  event_id: string;
  user_id: string;
  status: "pending" | "approved" | "rejected" | "withdrawn";
  message: string | null;
  tier_id: string | null;  // migration 027
  requested_at: Date;
  responded_at: Date | null;
}

export interface RequestWithUser extends RequestRow {
  username: string;
  display_name: string;
  avatar_url: string | null;
  social_rating: number;
  events_attended: number;
}

// ============================================
// REQUEST QUERIES
// ============================================

export async function createRequest(
  eventId: string,
  userId: string,
  message?: string,
  tierId?: string | null
): Promise<RequestRow> {
  const id = uuidv4();
  await query(
    `INSERT INTO event_requests (id, event_id, user_id, message, tier_id)
     VALUES (?, ?, ?, ?, ?)`,
    [id, eventId, userId, message || null, tierId || null]
  );
  const result = await query<RequestRow>(
    "SELECT * FROM event_requests WHERE id = ?",
    [id]
  );
  return result.rows[0]!;
}

export async function findRequestById(id: string): Promise<RequestRow | null> {
  const result = await query<RequestRow>(
    "SELECT * FROM event_requests WHERE id = ?",
    [id]
  );
  return result.rows[0] || null;
}

export async function findExistingRequest(
  eventId: string,
  userId: string
): Promise<RequestRow | null> {
  const result = await query<RequestRow>(
    "SELECT * FROM event_requests WHERE event_id = ? AND user_id = ?",
    [eventId, userId]
  );
  return result.rows[0] || null;
}

export async function getRequestsForEvent(
  eventId: string,
  status?: string
): Promise<RequestWithUser[]> {
  let sql = `SELECT r.*, u.username, u.display_name, u.avatar_url,
                    u.social_rating, u.events_attended
             FROM event_requests r
             JOIN users u ON u.id = r.user_id
             WHERE r.event_id = ?`;
  const params: any[] = [eventId];

  if (status) {
    sql += " AND r.status = ?";
    params.push(status);
  }

  sql += " ORDER BY r.requested_at DESC";

  const result = await query<RequestWithUser>(sql, params);
  return result.rows;
}

/**
 * Returns pending request count and approved-but-not-yet-joined count for a event.
 * Used by the host dashboard stats panel on the event detail page.
 */
export async function getEventRequestCounts(eventId: string): Promise<{
  pending_count: number;
  approved_not_joined_count: number;
}> {
  const result = await query<{ pending_count: string; approved_not_joined_count: string }>(
    `SELECT
       COUNT(CASE WHEN r.status = 'pending' THEN 1 END) AS pending_count,
       COUNT(CASE WHEN r.status = 'approved'
                   AND r.user_id NOT IN (
                     SELECT user_id FROM event_attendees WHERE event_id = ?
                   ) THEN 1 END) AS approved_not_joined_count
     FROM event_requests r
     WHERE r.event_id = ?`,
    [eventId, eventId]
  );
  return {
    pending_count: parseInt(result.rows[0]?.pending_count || "0", 10),
    approved_not_joined_count: parseInt(result.rows[0]?.approved_not_joined_count || "0", 10),
  };
}

export async function updateRequestStatus(
  requestId: string,
  status: "approved" | "rejected"
): Promise<RequestRow | null> {
  await query(
    "UPDATE event_requests SET status = ?, responded_at = NOW() WHERE id = ?",
    [status, requestId]
  );
  const result = await query<RequestRow>(
    "SELECT * FROM event_requests WHERE id = ?",
    [requestId]
  );
  return result.rows[0] || null;
}

export async function withdrawRequest(requestId: string): Promise<void> {
  await query(
    "UPDATE event_requests SET status = 'withdrawn' WHERE id = ?",
    [requestId]
  );
}

export async function deleteRequest(requestId: string): Promise<void> {
  await query("DELETE FROM event_requests WHERE id = ?", [requestId]);
}

export interface EnrichedUserRequest extends RequestRow {
  event_title: string;
  event_date_time: Date;
  event_location_city: string;
  event_cover_image_url: string | null;
  event_ticket_price: number;
  event_max_capacity: number;
  event_current_attendees: number;
  event_host_id: string;
  event_end_time: Date | null;
  event_tags: string | null;
}

export async function getUserRequests(userId: string): Promise<EnrichedUserRequest[]> {
  const result = await query<EnrichedUserRequest>(
    `SELECT r.*,
            p.title AS event_title,
            p.date_time AS event_date_time,
            p.location_city AS event_location_city,
            p.cover_image_url AS event_cover_image_url,
            p.ticket_price AS event_ticket_price,
            p.max_capacity AS event_max_capacity,
            p.current_attendees AS event_current_attendees,
            p.host_id AS event_host_id,
            p.end_time AS event_end_time,
            p.tags AS event_tags
     FROM event_requests r
     JOIN events p ON p.id = r.event_id
     WHERE r.user_id = ?
     ORDER BY r.requested_at DESC`,
    [userId]
  );
  return result.rows;
}

export interface HostIncomingRequest extends RequestRow {
  event_title: string;
  event_date_time: Date;
  event_location_city: string;
  event_cover_image_url: string | null;
  event_ticket_price: number;
  username: string;
  display_name: string;
  avatar_url: string | null;
  social_rating: number;
  events_attended: number;
}

export async function getHostIncomingRequests(hostUserId: string): Promise<HostIncomingRequest[]> {
  const result = await query<HostIncomingRequest>(
    `SELECT r.*,
            p.title AS event_title,
            p.date_time AS event_date_time,
            p.location_city AS event_location_city,
            p.cover_image_url AS event_cover_image_url,
            p.ticket_price AS event_ticket_price,
            u.username,
            u.display_name,
            u.avatar_url,
            u.social_rating,
            u.events_attended
     FROM event_requests r
     JOIN events p ON p.id = r.event_id
     JOIN users u ON u.id = r.user_id
     WHERE p.host_id = ?
     ORDER BY r.requested_at DESC`,
    [hostUserId]
  );
  return result.rows;
}

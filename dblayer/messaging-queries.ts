import { query } from "./connection";
import { v4 as uuidv4 } from "uuid";

export interface ConversationRow {
  id: string;
  event_id: string;
  guest_id: string;
  host_id: string;
  created_at: Date;
}

export interface ConversationSummaryRow extends ConversationRow {
  event_title: string;
  event_cover_image_url: string | null;
  other_user_id: string;
  other_username: string;
  other_display_name: string;
  other_avatar_url: string | null;
  last_message_body: string | null;
  last_message_at: Date | null;
  unread_count: number;
}

export interface MessageRow {
  id: string;
  conversation_id: string;
  sender_id: string;
  body: string;
  created_at: Date;
  read_at: Date | null;
}

export interface EventAnnouncementRow {
  id: string;
  event_id: string;
  host_id: string;
  body: string;
  created_at: Date;
}

export async function findConversationByEventAndGuest(
  eventId: string,
  guestId: string
): Promise<ConversationRow | null> {
  const result = await query<ConversationRow>(
    "SELECT * FROM conversations WHERE event_id = ? AND guest_id = ?",
    [eventId, guestId]
  );
  return result.rows[0] || null;
}

export async function findConversationById(conversationId: string): Promise<ConversationRow | null> {
  const result = await query<ConversationRow>(
    "SELECT * FROM conversations WHERE id = ?",
    [conversationId]
  );
  return result.rows[0] || null;
}

export async function findConversationForUser(
  conversationId: string,
  userId: string
): Promise<ConversationRow | null> {
  const result = await query<ConversationRow>(
    `SELECT * FROM conversations
     WHERE id = ? AND (host_id = ? OR guest_id = ?)` ,
    [conversationId, userId, userId]
  );
  return result.rows[0] || null;
}

export async function createConversation(
  eventId: string,
  guestId: string,
  hostId: string
): Promise<ConversationRow> {
  const id = uuidv4();
  const inserted = await query<ConversationRow>(
    `INSERT INTO conversations (id, event_id, guest_id, host_id)
     VALUES (?, ?, ?, ?)
     ON CONFLICT (event_id, guest_id) DO NOTHING
     RETURNING *`,
    [id, eventId, guestId, hostId]
  );

  if (inserted.rows[0]) {
    return inserted.rows[0];
  }

  const existing = await query<ConversationRow>(
    "SELECT * FROM conversations WHERE event_id = ? AND guest_id = ?",
    [eventId, guestId]
  );
  return existing.rows[0]!;
}

export async function listConversationsForUser(userId: string): Promise<ConversationSummaryRow[]> {
  const result = await query<ConversationSummaryRow>(
    `SELECT c.id,
            c.event_id,
            c.guest_id,
            c.host_id,
            c.created_at,
            p.title AS event_title,
            p.cover_image_url AS event_cover_image_url,
            other_user.id AS other_user_id,
            other_user.username AS other_username,
            other_user.display_name AS other_display_name,
            other_user.avatar_url AS other_avatar_url,
            last_message.body AS last_message_body,
            last_message.created_at AS last_message_at,
            (
              SELECT COUNT(*)
              FROM messages unread_message
              WHERE unread_message.conversation_id = c.id
                AND unread_message.sender_id <> ?
                AND unread_message.read_at IS NULL
            ) AS unread_count
     FROM conversations c
     JOIN events p ON p.id = c.event_id
     JOIN users other_user ON other_user.id = CASE WHEN c.host_id = ? THEN c.guest_id ELSE c.host_id END
     LEFT JOIN LATERAL (
       SELECT m.body, m.created_at
       FROM messages m
       WHERE m.conversation_id = c.id
       ORDER BY m.created_at DESC
       LIMIT 1
     ) last_message ON TRUE
     WHERE c.host_id = ? OR c.guest_id = ?
     ORDER BY COALESCE(last_message.created_at, c.created_at) DESC`,
    [userId, userId, userId, userId]
  );

  return result.rows;
}

export async function getConversationMessages(
  conversationId: string,
  page = 1,
  limit = 50
): Promise<{ messages: MessageRow[]; total: number }> {
  const offset = (page - 1) * limit;

  const [countResult, result] = await Promise.all([
    query<{ cnt: number }>(
      "SELECT COUNT(*) AS cnt FROM messages WHERE conversation_id = ?",
      [conversationId]
    ),
    query<MessageRow>(
      `SELECT * FROM messages
       WHERE conversation_id = ?
       ORDER BY created_at ASC
       LIMIT ? OFFSET ?`,
      [conversationId, limit, offset]
    ),
  ]);

  return {
    messages: result.rows,
    total: countResult.rows[0]?.cnt || 0,
  };
}

export async function createMessage(
  conversationId: string,
  senderId: string,
  body: string
): Promise<MessageRow> {
  const id = uuidv4();
  await query(
    `INSERT INTO messages (id, conversation_id, sender_id, body)
     VALUES (?, ?, ?, ?)`,
    [id, conversationId, senderId, body]
  );
  const result = await query<MessageRow>("SELECT * FROM messages WHERE id = ?", [id]);
  return result.rows[0]!;
}

export async function markConversationRead(
  conversationId: string,
  userId: string
): Promise<void> {
  await query(
    `UPDATE messages
     SET read_at = NOW()
     WHERE conversation_id = ?
       AND sender_id <> ?
       AND read_at IS NULL`,
    [conversationId, userId]
  );
}

export async function getUnreadMessageCount(userId: string): Promise<number> {
  const result = await query<{ cnt: number }>(
    `SELECT COUNT(*) AS cnt
     FROM messages m
     JOIN conversations c ON c.id = m.conversation_id
     WHERE (c.host_id = ? OR c.guest_id = ?)
       AND m.sender_id <> ?
       AND m.read_at IS NULL`,
    [userId, userId, userId]
  );
  return result.rows[0]?.cnt || 0;
}

export async function createEventAnnouncement(
  eventId: string,
  hostId: string,
  body: string
): Promise<EventAnnouncementRow> {
  const id = uuidv4();
  await query(
    `INSERT INTO event_announcements (id, event_id, host_id, body)
     VALUES (?, ?, ?, ?)`,
    [id, eventId, hostId, body]
  );
  const result = await query<EventAnnouncementRow>(
    "SELECT * FROM event_announcements WHERE id = ?",
    [id]
  );
  return result.rows[0]!;
}

export async function listEventAnnouncements(eventId: string): Promise<EventAnnouncementRow[]> {
  const result = await query<EventAnnouncementRow>(
    `SELECT * FROM event_announcements
     WHERE event_id = ?
     ORDER BY created_at DESC`,
    [eventId]
  );
  return result.rows;
}

export async function getEventAnnouncementRecipients(
  eventId: string,
  hostId: string
): Promise<string[]> {
  const result = await query<{ user_id: string }>(
    `SELECT DISTINCT user_id FROM (
       SELECT user_id FROM event_requests WHERE event_id = ? AND status = 'approved'
       UNION
       SELECT user_id FROM event_attendees WHERE event_id = ?
     ) recipients
     WHERE user_id <> ?`,
    [eventId, eventId, hostId]
  );
  return result.rows.map((row) => row.user_id);
}
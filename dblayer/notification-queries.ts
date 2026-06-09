import { query } from "./connection";
import { v4 as uuidv4 } from "uuid";
import { logger } from "../api/lib/logger";

// ============================================
// NOTIFICATION TYPES
// ============================================

export interface NotificationRow {
  id: string;
  user_id: string;
  type: string;
  title: string;
  body: string | null;
  reference_id: string | null;
  reference_type: string | null;
  is_read: boolean;
  created_at: Date;
}

// ============================================
// NOTIFICATION QUERIES
// ============================================

export async function createNotification(
  userId: string,
  type: string,
  title: string,
  body?: string,
  referenceId?: string,
  referenceType?: string
): Promise<NotificationRow> {
  const id = uuidv4();
  await query(
    `INSERT INTO notifications (id, user_id, type, title, body, reference_id, reference_type)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [id, userId, type, title, body || null, referenceId || null, referenceType || null]
  );
  const result = await query<NotificationRow>("SELECT * FROM notifications WHERE id = ?", [id]);
  return result.rows[0]!;
}

/**
 * Create notification and emit WebSocket event to user
 * Use this in all controllers to push real-time updates
 */
export async function createNotificationWithSocket(
  userId: string,
  type: string,
  title: string,
  body?: string,
  referenceId?: string,
  referenceType?: string
): Promise<NotificationRow> {
  const notification = await createNotification(userId, type, title, body, referenceId, referenceType);

  // Emit WebSocket event asynchronously (don't wait for it)
  try {
    const { io } = await import("../api/server");
    const { emitNotificationToUser } = await import("../api/lib/websocket");
    emitNotificationToUser(io, userId, {
      id: notification.id,
      type: notification.type,
      title: notification.title,
      body: notification.body || undefined,
      reference_id: notification.reference_id || undefined,
      reference_type: notification.reference_type || undefined,
    });
  } catch (error) {
    // WebSocket may not be available in all contexts (e.g., tests, scheduled jobs)
    logger.warn("WebSocket event not emitted for notification", error);
  }

  // Dispatch FCM / APNs push to all registered devices for this user
  try {
    const { getUserPushTokens } = await import("./push-token-queries");
    const { sendPushToToken } = await import("../api/lib/firebase");
    const tokens = await getUserPushTokens(userId);
    await Promise.all(
      tokens.map((t) =>
        sendPushToToken(t.token, notification.title, notification.body ?? undefined, {
          type: notification.type,
          referenceId: notification.reference_id ?? "",
          referenceType: notification.reference_type ?? "",
        })
      )
    );
  } catch (error) {
    logger.warn("Push notification dispatch failed", error);
  }

  return notification;
}

export async function getUserNotifications(
  userId: string,
  page = 1,
  limit = 20
): Promise<{ notifications: NotificationRow[]; total: number; unread: number }> {
  const offset = (page - 1) * limit;

  const [countResult, unreadResult, result] = await Promise.all([
    query<{ cnt: number }>(
      "SELECT COUNT(*) AS cnt FROM notifications WHERE user_id = ?",
      [userId]
    ),
    query<{ cnt: number }>(
      "SELECT COUNT(*) AS cnt FROM notifications WHERE user_id = ? AND is_read = FALSE",
      [userId]
    ),
    query<NotificationRow>(
      `SELECT * FROM notifications
       WHERE user_id = ?
       ORDER BY created_at DESC
       LIMIT ? OFFSET ?`,
      [userId, limit, offset]
    ),
  ]);

  return {
    notifications: result.rows,
    total: countResult.rows[0]?.cnt || 0,
    unread: unreadResult.rows[0]?.cnt || 0,
  };
}

export async function getUnreadCount(userId: string): Promise<number> {
  const result = await query<{ cnt: number }>(
    "SELECT COUNT(*) AS cnt FROM notifications WHERE user_id = ? AND is_read = FALSE",
    [userId]
  );
  return result.rows[0]?.cnt || 0;
}

export async function markAsRead(notificationId: string, userId: string): Promise<void> {
  await query(
    "UPDATE notifications SET is_read = TRUE WHERE id = ? AND user_id = ?",
    [notificationId, userId]
  );
}

export async function markAllAsRead(userId: string): Promise<void> {
  await query(
    "UPDATE notifications SET is_read = TRUE WHERE user_id = ? AND is_read = FALSE",
    [userId]
  );
}

export async function deleteNotification(notificationId: string, userId: string): Promise<void> {
  await query(
    "DELETE FROM notifications WHERE id = ? AND user_id = ?",
    [notificationId, userId]
  );
}

export async function deleteAllNotifications(userId: string): Promise<void> {
  await query(
    "DELETE FROM notifications WHERE user_id = ?",
    [userId]
  );
}

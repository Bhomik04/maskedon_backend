import { query } from "./connection";
import { v4 as uuidv4 } from "uuid";

export interface PushTokenRow {
  id: string;
  user_id: string;
  token: string;
  platform: "fcm" | "apns";
  created_at: Date;
}

/**
 * Upsert a push token for a user.
 * If the token already exists for this user, this is a no-op.
 * If the token exists for a *different* user (device was transferred), re-assign it.
 */
export async function upsertPushToken(
  userId: string,
  token: string,
  platform: "fcm" | "apns"
): Promise<void> {
  const id = uuidv4();
  await query(
    `INSERT INTO device_push_tokens (id, user_id, token, platform)
     VALUES (?, ?, ?, ?)
     ON CONFLICT (token) DO UPDATE SET user_id = EXCLUDED.user_id, platform = EXCLUDED.platform`,
    [id, userId, token, platform]
  );
}

/**
 * Get all push tokens for a user (they may have multiple devices).
 */
export async function getUserPushTokens(userId: string): Promise<PushTokenRow[]> {
  const result = await query<PushTokenRow>(
    "SELECT * FROM device_push_tokens WHERE user_id = ?",
    [userId]
  );
  return result.rows;
}

/**
 * Get all push tokens across all users (for admin broadcast).
 * Capped at 50,000 to avoid unbounded memory usage.
 */
export async function getAllPushTokens(): Promise<PushTokenRow[]> {
  const result = await query<PushTokenRow>(
    "SELECT id, user_id, token, platform, created_at FROM device_push_tokens LIMIT 50000"
  );
  return result.rows;
}

/**
 * Delete a specific push token (e.g., on logout from that device).
 */
export async function deletePushToken(token: string): Promise<void> {
  await query("DELETE FROM device_push_tokens WHERE token = ?", [token]);
}

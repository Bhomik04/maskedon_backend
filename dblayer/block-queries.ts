import { query } from "./connection";
import { v4 as uuidv4 } from "uuid";

// ============================================
// BLOCK TYPES
// ============================================

export interface BlockRow {
  id: string;
  blocker_id: string;
  blocked_user_id: string;
  created_at: Date;
}

export interface BlockedUserInfo {
  id: string;
  username: string;
  display_name: string;
  avatar_url: string | null;
  blocked_at: Date;
}

// ============================================
// BLOCK QUERIES
// ============================================

/** Block a user */
export async function createBlock(
  blockerId: string,
  blockedUserId: string
): Promise<BlockRow> {
  const id = uuidv4();
  await query(
    `INSERT INTO user_blocks (id, blocker_id, blocked_user_id)
     VALUES (?, ?, ?)`,
    [id, blockerId, blockedUserId]
  );
  const result = await query<BlockRow>(
    "SELECT * FROM user_blocks WHERE id = ?",
    [id]
  );
  return result.rows[0]!;
}

/** Unblock a user */
export async function removeBlock(
  blockerId: string,
  blockedUserId: string
): Promise<boolean> {
  const result = await query(
    "DELETE FROM user_blocks WHERE blocker_id = ? AND blocked_user_id = ?",
    [blockerId, blockedUserId]
  );
  return result.affectedRows > 0;
}

/** Check if userA has blocked userB */
export async function hasBlocked(
  blockerId: string,
  blockedUserId: string
): Promise<boolean> {
  const result = await query<{ cnt: number }>(
    `SELECT COUNT(*) AS cnt FROM user_blocks
     WHERE blocker_id = ? AND blocked_user_id = ?`,
    [blockerId, blockedUserId]
  );
  return (result.rows[0]?.cnt ?? 0) > 0;
}

/** Check if either user has blocked the other (bidirectional) */
export async function isBlockedEitherWay(
  userA: string,
  userB: string
): Promise<boolean> {
  const result = await query<{ cnt: number }>(
    `SELECT COUNT(*) AS cnt FROM user_blocks
     WHERE (blocker_id = ? AND blocked_user_id = ?)
        OR (blocker_id = ? AND blocked_user_id = ?)`,
    [userA, userB, userB, userA]
  );
  return (result.rows[0]?.cnt ?? 0) > 0;
}

/** Get all users blocked by a given user */
export async function getBlockedUsers(
  blockerId: string,
  page: number = 1,
  limit: number = 50
): Promise<{ blocked: BlockedUserInfo[]; total: number }> {
  const offset = (page - 1) * limit;

  const countResult = await query<{ cnt: number }>(
    "SELECT COUNT(*) AS cnt FROM user_blocks WHERE blocker_id = ?",
    [blockerId]
  );
  const total = countResult.rows[0]?.cnt || 0;

  const result = await query<BlockedUserInfo>(
    `SELECT u.id, u.username, u.display_name, u.avatar_url, b.created_at AS blocked_at
     FROM user_blocks b
     JOIN users u ON u.id = b.blocked_user_id
     WHERE b.blocker_id = ?
     ORDER BY b.created_at DESC
     LIMIT ? OFFSET ?`,
    [blockerId, limit, offset]
  );

  return { blocked: result.rows, total };
}

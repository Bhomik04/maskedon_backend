import { query } from "./connection";
import { v4 as uuidv4 } from "uuid";

// ============================================
// FRIENDSHIP TYPES
// ============================================

export interface FriendshipRow {
  id: string;
  requester_id: string;
  addressee_id: string;
  status: "pending" | "accepted" | "rejected";
  created_at: Date;
  updated_at: Date;
}

export interface FriendUser {
  id: string;
  username: string;
  display_name: string;
  avatar_url: string | null;
  social_rating: number;
}

// ============================================
// FRIENDSHIP QUERIES
// ============================================

/** Send a friend request */
export async function createFriendRequest(
  requesterId: string,
  addresseeId: string
): Promise<FriendshipRow> {
  const id = uuidv4();
  await query(
    `INSERT INTO friendships (id, requester_id, addressee_id)
     VALUES (?, ?, ?)`,
    [id, requesterId, addresseeId]
  );
  const result = await query<FriendshipRow>(
    "SELECT * FROM friendships WHERE id = ?",
    [id]
  );
  return result.rows[0]!;
}

/** Find friendship row between two users (in either direction) */
export async function findFriendship(
  userA: string,
  userB: string
): Promise<FriendshipRow | null> {
  const result = await query<FriendshipRow>(
    `SELECT * FROM friendships
     WHERE (requester_id = ? AND addressee_id = ?)
        OR (requester_id = ? AND addressee_id = ?)
     LIMIT 1`,
    [userA, userB, userB, userA]
  );
  return result.rows[0] || null;
}

/** Accept a friend request */
export async function acceptFriendRequest(friendshipId: string): Promise<void> {
  await query(
    "UPDATE friendships SET status = 'accepted' WHERE id = ?",
    [friendshipId]
  );
}

/** Reject a friend request */
export async function rejectFriendRequest(friendshipId: string): Promise<void> {
  await query(
    "UPDATE friendships SET status = 'rejected' WHERE id = ?",
    [friendshipId]
  );
}

/** Remove a friendship (unfriend or cancel pending request) */
export async function removeFriendship(friendshipId: string): Promise<void> {
  await query("DELETE FROM friendships WHERE id = ?", [friendshipId]);
}

/** Get accepted friends for a user */
export async function getUserFriends(
  userId: string,
  page: number = 1,
  limit: number = 20
): Promise<{ friends: FriendUser[]; total: number }> {
  const offset = (page - 1) * limit;

  const countResult = await query<{ cnt: number }>(
    `SELECT COUNT(*) AS cnt FROM friendships
     WHERE status = 'accepted'
       AND (requester_id = ? OR addressee_id = ?)`,
    [userId, userId]
  );
  const total = countResult.rows[0]?.cnt || 0;

  const result = await query<FriendUser>(
    `SELECT u.id, u.username, u.display_name, u.avatar_url, u.social_rating
     FROM friendships f
     JOIN users u ON u.id = CASE
       WHEN f.requester_id = ? THEN f.addressee_id
       ELSE f.requester_id
     END
     WHERE f.status = 'accepted'
       AND (f.requester_id = ? OR f.addressee_id = ?)
     ORDER BY f.updated_at DESC
     LIMIT ? OFFSET ?`,
    [userId, userId, userId, limit, offset]
  );

  return { friends: result.rows, total };
}

/** Get pending friend requests received by a user */
export async function getPendingRequests(
  userId: string
): Promise<(FriendshipRow & FriendUser)[]> {
  const result = await query<FriendshipRow & FriendUser>(
    `SELECT f.*, u.id AS id, u.username, u.display_name, u.avatar_url, u.social_rating
     FROM friendships f
     JOIN users u ON u.id = f.requester_id
     WHERE f.addressee_id = ? AND f.status = 'pending'
     ORDER BY f.created_at DESC`,
    [userId]
  );
  return result.rows;
}

/** Get friend count for a user */
export async function getFriendCount(userId: string): Promise<number> {
  const result = await query<{ cnt: number }>(
    `SELECT COUNT(*) AS cnt FROM friendships
     WHERE status = 'accepted'
       AND (requester_id = ? OR addressee_id = ?)`,
    [userId, userId]
  );
  return result.rows[0]?.cnt || 0;
}

/** Get outgoing pending friend requests sent by a user */
export async function getSentRequests(
  userId: string
): Promise<(FriendshipRow & FriendUser)[]> {
  const result = await query<FriendshipRow & FriendUser>(
    `SELECT f.*, u.id AS id, u.username, u.display_name, u.avatar_url, u.social_rating
     FROM friendships f
     JOIN users u ON u.id = f.addressee_id
     WHERE f.requester_id = ? AND f.status = 'pending'
     ORDER BY f.created_at DESC`,
    [userId]
  );
  return result.rows;
}

/** Get friend suggestions for a user (top-rated non-friends, not blocked) */
export async function getFriendSuggestions(
  userId: string,
  limit: number = 12
): Promise<FriendUser[]> {
  const result = await query<FriendUser>(
    `SELECT u.id, u.username, u.display_name, u.avatar_url, u.social_rating
     FROM users u
     WHERE u.id != ?
       AND u.id NOT IN (
         SELECT CASE WHEN f.requester_id = ? THEN f.addressee_id ELSE f.requester_id END
         FROM friendships f
         WHERE f.requester_id = ? OR f.addressee_id = ?
       )
       AND u.id NOT IN (
         SELECT blocked_id FROM user_blocks WHERE blocker_id = ?
         UNION ALL
         SELECT blocker_id FROM user_blocks WHERE blocked_id = ?
       )
       AND u.total_ratings >= 1
     ORDER BY u.social_rating DESC, u.events_attended DESC
     LIMIT ?`,
    [userId, userId, userId, userId, userId, userId, limit]
  );
  return result.rows;
}

/** Get mutual friends between two users */
export async function getMutualFriends(
  userA: string,
  userB: string
): Promise<FriendUser[]> {
  const result = await query<FriendUser>(
    `SELECT u.id, u.username, u.display_name, u.avatar_url, u.social_rating
     FROM users u
     WHERE u.id IN (
       SELECT CASE WHEN f.requester_id = ? THEN f.addressee_id ELSE f.requester_id END
       FROM friendships f
       WHERE f.status = 'accepted' AND (f.requester_id = ? OR f.addressee_id = ?)
     )
     AND u.id IN (
       SELECT CASE WHEN f.requester_id = ? THEN f.addressee_id ELSE f.requester_id END
       FROM friendships f
       WHERE f.status = 'accepted' AND (f.requester_id = ? OR f.addressee_id = ?)
     )`,
    [userA, userA, userA, userB, userB, userB]
  );
  return result.rows;
}

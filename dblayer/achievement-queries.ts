import { v4 as uuidv4 } from "uuid";
import { evaluateUnlockedAchievements } from "../algorithms/achievement-rules";
import { query } from "./connection";

interface AchievementStatsRow {
  events_attended: number;
  events_hosted: number;
  social_rating: number;
  total_ratings: number;
  friend_count: number;
  profile_photo_count: number;
}

interface ExistingAchievementRow {
  achievement_key: string;
}

interface FriendIdRow {
  friend_id: string;
}

export interface FriendAchievementFeedItem {
  id: string;
  friend_id: string;
  friend_username: string;
  friend_display_name: string;
  friend_avatar_url: string | null;
  achievement_key: string;
  achievement_name: string;
  unlocked_at: Date;
}

async function getAchievementStats(userId: string): Promise<AchievementStatsRow | null> {
  const result = await query<AchievementStatsRow>(
    `SELECT
       u.events_attended,
       u.events_hosted,
       u.social_rating,
       u.total_ratings,
       (
         SELECT COUNT(*)
         FROM friendships f
         WHERE f.status = 'accepted'
           AND (f.requester_id = u.id OR f.addressee_id = u.id)
       ) AS friend_count,
       (
         SELECT COUNT(*)
         FROM photos p
         WHERE p.user_id = u.id
           AND p.event_id IS NULL
           AND p.deleted_at IS NULL
       ) AS profile_photo_count
     FROM users u
     WHERE u.id = ? AND u.deleted_at IS NULL
     LIMIT 1`,
    [userId],
  );

  return result.rows[0] || null;
}

export async function syncUserAchievements(userId: string): Promise<void> {
  const stats = await getAchievementStats(userId);
  if (!stats) return;

  const unlocked = evaluateUnlockedAchievements({
    events_attended: Number(stats.events_attended || 0),
    events_hosted: Number(stats.events_hosted || 0),
    social_rating: Number(stats.social_rating || 0),
    total_ratings: Number(stats.total_ratings || 0),
    friend_count: Number(stats.friend_count || 0),
    profile_photo_count: Number(stats.profile_photo_count || 0),
  });

  if (unlocked.length === 0) return;

  const existingResult = await query<ExistingAchievementRow>(
    `SELECT achievement_key
     FROM user_achievements
     WHERE user_id = ?`,
    [userId],
  );
  const existingKeys = new Set(existingResult.rows.map((row) => row.achievement_key));

  for (const achievement of unlocked) {
    if (existingKeys.has(achievement.key)) continue;
    await query(
      `INSERT INTO user_achievements (id, user_id, achievement_key, achievement_name)
       VALUES (?, ?, ?, ?)
       ON CONFLICT (user_id, achievement_key) DO NOTHING`,
      [uuidv4(), userId, achievement.key, achievement.name],
    );
  }
}

async function getViewerFriendIds(viewerId: string): Promise<string[]> {
  const result = await query<FriendIdRow>(
    `WITH friends AS (
       SELECT CASE
         WHEN f.requester_id = ? THEN f.addressee_id
         ELSE f.requester_id
       END AS friend_id
       FROM friendships f
       WHERE f.status = 'accepted'
         AND (f.requester_id = ? OR f.addressee_id = ?)
     )
     SELECT fr.friend_id
     FROM friends fr
     WHERE NOT EXISTS (
       SELECT 1
       FROM user_blocks b
       WHERE (b.blocker_id = ? AND b.blocked_user_id = fr.friend_id)
          OR (b.blocker_id = fr.friend_id AND b.blocked_user_id = ?)
     )`,
    [viewerId, viewerId, viewerId, viewerId, viewerId],
  );

  return result.rows.map((row) => row.friend_id);
}

export async function getUserAchievements(
  userId: string
): Promise<{ achievement_key: string; achievement_name: string; unlocked_at: Date }[]> {
  const result = await query<{ achievement_key: string; achievement_name: string; unlocked_at: Date }>(
    `SELECT achievement_key, achievement_name, unlocked_at
     FROM user_achievements
     WHERE user_id = ?
     ORDER BY unlocked_at ASC`,
    [userId]
  );
  return result.rows;
}

export async function getUserAchievementStats(
  userId: string
): Promise<{
  events_attended: number;
  events_hosted: number;
  social_rating: number;
  total_ratings: number;
  friend_count: number;
  profile_photo_count: number;
} | null> {
  const stats = await getAchievementStats(userId);
  if (!stats) return null;
  return {
    events_attended: Number(stats.events_attended || 0),
    events_hosted: Number(stats.events_hosted || 0),
    social_rating: Number(stats.social_rating || 0),
    total_ratings: Number(stats.total_ratings || 0),
    friend_count: Number(stats.friend_count || 0),
    profile_photo_count: Number(stats.profile_photo_count || 0),
  };
}

export async function syncFriendsAchievementsForViewer(viewerId: string): Promise<void> {
  const friendIds = await getViewerFriendIds(viewerId);
  if (friendIds.length === 0) return;

  await Promise.all(friendIds.map((friendId) => syncUserAchievements(friendId)));
}

export async function getRecentFriendAchievementFeedItems(
  viewerId: string,
  limit: number = 10,
): Promise<FriendAchievementFeedItem[]> {
  const result = await query<FriendAchievementFeedItem>(
    `SELECT
       ua.id,
       ua.user_id AS friend_id,
       u.username AS friend_username,
       u.display_name AS friend_display_name,
       u.avatar_url AS friend_avatar_url,
       ua.achievement_key,
       ua.achievement_name,
       ua.unlocked_at
     FROM user_achievements ua
     JOIN users u ON u.id = ua.user_id
     WHERE ua.user_id IN (
       SELECT CASE
         WHEN f.requester_id = ? THEN f.addressee_id
         ELSE f.requester_id
       END
       FROM friendships f
       WHERE f.status = 'accepted'
         AND (f.requester_id = ? OR f.addressee_id = ?)
     )
       AND NOT EXISTS (
         SELECT 1
         FROM user_blocks b
         WHERE (b.blocker_id = ? AND b.blocked_user_id = ua.user_id)
            OR (b.blocker_id = ua.user_id AND b.blocked_user_id = ?)
       )
     ORDER BY ua.unlocked_at DESC
     LIMIT ?`,
    [viewerId, viewerId, viewerId, viewerId, viewerId, limit],
  );

  return result.rows;
}
 
import { query } from "./connection";
import type { FeedPost } from "../algorithms/feed-algorithm";

// ============================================
// FEED TYPES
// ============================================

export interface FeedStoryUser {
  user_id: string;
  username: string;
  display_name: string;
  avatar_url: string | null;
  recent_photo_count: number;
  latest_photo_url: string;
  latest_photo_at: string;
}

export interface TrendingFeedPost extends FeedPost {
  comment_count: number;
  view_count: number;
}

export interface UpcomingFriendEvent {
  id: string;
  title: string;
  cover_image_url: string | null;
  date_time: string;
  location_city: string;
  ticket_price: number;
  current_attendees: number;
  max_capacity: number;
  host_id: string;
  host_display_name: string;
  host_avatar_url: string | null;
}

// ============================================
// FEED QUERIES
// ============================================

/**
 * Fetches recent photos posted by accepted friends of the given user.
 * Excludes photos from users who have blocked or are blocked by the requesting user.
 * Ordered newest first. Includes whether the requesting user has liked each photo.
 */
export async function getFriendsFeedPosts(
  userId: string,
  page: number = 1,
  limit: number = 20
): Promise<{ posts: FeedPost[]; total: number }> {
  const offset = (page - 1) * limit;

  // Count total posts in the friends' feed (for pagination metadata)
  const countResult = await query<{ cnt: number }>(
    `SELECT COUNT(*) AS cnt
     FROM photos p
     WHERE p.deleted_at IS NULL
       AND p.user_id IN (
         -- All accepted friends of the current user
         SELECT CASE
           WHEN f.requester_id = ? THEN f.addressee_id
           ELSE f.requester_id
         END AS friend_id
         FROM friendships f
         WHERE f.status = 'accepted'
           AND (f.requester_id = ? OR f.addressee_id = ?)
       )
       AND p.user_id NOT IN (
         SELECT blocked_user_id FROM user_blocks WHERE blocker_id = ?
       )
       AND p.user_id NOT IN (
         SELECT blocker_id FROM user_blocks WHERE blocked_user_id = ?
       )`,
    [userId, userId, userId, userId, userId]
  );
  const total = Number(countResult.rows[0]?.cnt ?? 0);

  // Fetch paginated posts with uploader user info, like status, comment_count, view_count
  const result = await query<FeedPost>(
    `SELECT
       p.id,
       p.user_id,
       p.event_id,
       p.image_url,
       p.thumbnail_url,
       p.caption,
       p.like_count,
       p.view_count,
       p.created_at,
       u.username,
       u.display_name,
       u.avatar_url,
       CASE WHEN pl.id IS NOT NULL THEN TRUE ELSE FALSE END AS liked_by_me,
       (SELECT COUNT(*) FROM photo_comments pc WHERE pc.photo_id = p.id AND pc.deleted_at IS NULL) AS comment_count
     FROM photos p
     JOIN users u ON u.id = p.user_id
     LEFT JOIN photo_likes pl
       ON pl.photo_id = p.id AND pl.user_id = ?
     WHERE p.deleted_at IS NULL
       AND p.user_id IN (
         SELECT CASE
           WHEN f.requester_id = ? THEN f.addressee_id
           ELSE f.requester_id
         END AS friend_id
         FROM friendships f
         WHERE f.status = 'accepted'
           AND (f.requester_id = ? OR f.addressee_id = ?)
       )
       AND p.user_id NOT IN (
         SELECT blocked_user_id FROM user_blocks WHERE blocker_id = ?
       )
       AND p.user_id NOT IN (
         SELECT blocker_id FROM user_blocks WHERE blocked_user_id = ?
       )
     ORDER BY p.created_at DESC
     LIMIT ? OFFSET ?`,
    [userId, userId, userId, userId, userId, userId, limit, offset]
  );

  // Coerce tinyint liked_by_me to boolean
  const posts: FeedPost[] = result.rows.map((row) => ({
    ...row,
    liked_by_me: Boolean(row.liked_by_me),
  }));

  return { posts, total };
}

// ============================================
// STORIES STRIP — Friends with recent photos (72h)
// ============================================

export async function getFeedStories(userId: string): Promise<FeedStoryUser[]> {
  const result = await query<FeedStoryUser>(
    `SELECT
       u.id AS user_id,
       u.username,
       u.display_name,
       u.avatar_url,
       COUNT(p.id) AS recent_photo_count,
       (SELECT p2.image_url FROM photos p2 WHERE p2.user_id = u.id AND p2.deleted_at IS NULL ORDER BY p2.created_at DESC LIMIT 1) AS latest_photo_url,
       MAX(p.created_at) AS latest_photo_at
     FROM users u
     JOIN photos p ON p.user_id = u.id AND p.deleted_at IS NULL AND p.created_at >= NOW() - INTERVAL '72 hours'
     WHERE u.id IN (
       SELECT CASE
         WHEN f.requester_id = ? THEN f.addressee_id
         ELSE f.requester_id
       END AS friend_id
       FROM friendships f
       WHERE f.status = 'accepted'
         AND (f.requester_id = ? OR f.addressee_id = ?)
     )
     AND u.id NOT IN (SELECT blocked_user_id FROM user_blocks WHERE blocker_id = ?)
     AND u.id NOT IN (SELECT blocker_id FROM user_blocks WHERE blocked_user_id = ?)
     GROUP BY u.id, u.username, u.display_name, u.avatar_url
     ORDER BY latest_photo_at DESC
     LIMIT 20`,
    [userId, userId, userId, userId, userId]
  );
  return result.rows;
}

// ============================================
// TRENDING POST — Most engaged post from friends this week
// ============================================

export async function getTrendingFeedPost(userId: string): Promise<TrendingFeedPost | null> {
  const result = await query<TrendingFeedPost>(
    `SELECT
       p.id,
       p.user_id,
       p.event_id,
       p.image_url,
       p.thumbnail_url,
       p.caption,
       p.like_count,
       p.view_count,
       p.created_at,
       u.username,
       u.display_name,
       u.avatar_url,
       CASE WHEN pl.id IS NOT NULL THEN TRUE ELSE FALSE END AS liked_by_me,
       (SELECT COUNT(*) FROM photo_comments pc WHERE pc.photo_id = p.id AND pc.deleted_at IS NULL) AS comment_count
     FROM photos p
     JOIN users u ON u.id = p.user_id
     LEFT JOIN photo_likes pl ON pl.photo_id = p.id AND pl.user_id = ?
     WHERE p.deleted_at IS NULL
       AND p.created_at >= NOW() - INTERVAL '7 days'
       AND p.user_id IN (
         SELECT CASE
           WHEN f.requester_id = ? THEN f.addressee_id
           ELSE f.requester_id
         END AS friend_id
         FROM friendships f
         WHERE f.status = 'accepted'
           AND (f.requester_id = ? OR f.addressee_id = ?)
       )
       AND p.user_id NOT IN (SELECT blocked_user_id FROM user_blocks WHERE blocker_id = ?)
       AND p.user_id NOT IN (SELECT blocker_id FROM user_blocks WHERE blocked_user_id = ?)
     ORDER BY (p.like_count * 3 + p.view_count) DESC
     LIMIT 1`,
    [userId, userId, userId, userId, userId, userId]
  );
  if (!result.rows[0]) return null;
  return { ...result.rows[0], liked_by_me: Boolean(result.rows[0].liked_by_me) };
}

// ============================================
// UPCOMING FRIEND EVENTS — Events hosted by friends
// ============================================

export async function getUpcomingFriendEvents(userId: string): Promise<UpcomingFriendEvent[]> {
  const result = await query<UpcomingFriendEvent>(
    `SELECT
       pa.id,
       pa.title,
       pa.cover_image_url,
       pa.date_time,
       pa.location_city,
       pa.ticket_price,
       pa.current_attendees,
       pa.max_capacity,
       pa.host_id,
       u.display_name AS host_display_name,
       u.avatar_url AS host_avatar_url
     FROM events pa
     JOIN users u ON u.id = pa.host_id
     WHERE pa.status = 'upcoming'
       AND pa.date_time >= NOW()
       AND pa.host_id IN (
         SELECT CASE
           WHEN f.requester_id = ? THEN f.addressee_id
           ELSE f.requester_id
         END AS friend_id
         FROM friendships f
         WHERE f.status = 'accepted'
           AND (f.requester_id = ? OR f.addressee_id = ?)
       )
       AND pa.host_id NOT IN (SELECT blocked_user_id FROM user_blocks WHERE blocker_id = ?)
       AND pa.host_id NOT IN (SELECT blocker_id FROM user_blocks WHERE blocked_user_id = ?)
     ORDER BY pa.date_time ASC
     LIMIT 5`,
    [userId, userId, userId, userId, userId]
  );
  return result.rows;
}

// ============================================
// GLOBAL DISCOVERY: interest-based post
// ============================================

export interface DiscoveryPost extends FeedPost {
  is_global: true;
}

/**
 * Returns up to 1 globally-visible photo from a non-friend that the current
 * user hasn't seen before.  Selection is weighted by recent engagement and
 * tag overlap with photos the user has liked.
 *
 * Algorithm:
 *  1. Build the viewer's interest profile: top-5 tags from photos they liked.
 *  2. Among globally-visible photos from non-friends (excluding blocked), give
 *     bonus score for each matching tag.
 *  3. Score = (tag_overlap × 2) + (like_count × 0.15) + (view_count × 0.02)
 *             + recency_bonus (5 if <24 h, 2 if <7 d, 0 otherwise)
 *  4. Pick the top-scored post, then add some randomness so each feed refresh
 *     can surface a different discovery post: ORDER BY score DESC, RANDOM() with
 *     a LIMIT 5, then pick one randomly in SQL using RANDOM() as secondary sort.
 */
export async function getDiscoveryPost(userId: string): Promise<DiscoveryPost | null> {
  // Shows one recent globally-visible photo from a non-friend, ranked by engagement + recency.
  const result = await query<DiscoveryPost & { liked_by_me: boolean }>(
    `SELECT
       p.id,
       p.user_id,
       NULL AS event_id,
       p.image_url,
       p.thumbnail_url,
       p.caption,
       p.like_count,
       p.view_count,
       p.created_at,
       u.username,
       u.display_name,
       u.avatar_url,
       CASE WHEN pl.id IS NOT NULL THEN TRUE ELSE FALSE END AS liked_by_me,
       TRUE AS is_global,
       (SELECT COUNT(*) FROM photo_comments pc WHERE pc.photo_id = p.id AND pc.deleted_at IS NULL) AS comment_count,
       (
         CASE
           WHEN p.created_at >= NOW() - INTERVAL '24 hours' THEN 5.0
           WHEN p.created_at >= NOW() - INTERVAL '7 days'   THEN 2.0
           ELSE 0.0
         END
         + p.like_count * 0.15
         + p.view_count * 0.02
       ) AS _score
     FROM photos p
     JOIN users u ON u.id = p.user_id
     LEFT JOIN photo_likes pl ON pl.photo_id = p.id AND pl.user_id = ?
     WHERE p.deleted_at IS NULL
       AND p.global_visibility = TRUE
       AND p.user_id != ?
       -- Exclude accepted friends
       AND p.user_id NOT IN (
         SELECT CASE
           WHEN f.requester_id = ? THEN f.addressee_id
           ELSE f.requester_id
         END
         FROM friendships f
         WHERE f.status = 'accepted'
           AND (f.requester_id = ? OR f.addressee_id = ?)
       )
       -- Exclude blocked users (both directions)
       AND p.user_id NOT IN (
         SELECT blocked_user_id FROM user_blocks WHERE blocker_id = ?
         UNION
         SELECT blocker_id FROM user_blocks WHERE blocked_user_id = ?
       )
       AND p.created_at >= NOW() - INTERVAL '30 days'
     ORDER BY _score DESC, RANDOM()
     LIMIT 1`,
    [userId, userId, userId, userId, userId, userId, userId]
  );
  if (!result.rows[0]) return null;
  return { ...result.rows[0], liked_by_me: Boolean(result.rows[0].liked_by_me) };
}

// ============================================
// GLOBAL FALLBACK FEED — for new users with no friends
// Returns globally-visible posts ranked by engagement, excludes blocked users
// ============================================

export async function getGlobalFallbackFeed(
  userId: string,
  page: number = 1,
  limit: number = 20
): Promise<{ posts: FeedPost[]; total: number }> {
  const offset = (page - 1) * limit;

  const countResult = await query<{ cnt: number }>(
    `SELECT COUNT(*) AS cnt
     FROM photos p
     WHERE p.deleted_at IS NULL
       AND p.global_visibility = TRUE
       AND p.user_id != ?
       AND p.user_id NOT IN (SELECT blocked_user_id FROM user_blocks WHERE blocker_id = ?)
       AND p.user_id NOT IN (SELECT blocker_id FROM user_blocks WHERE blocked_user_id = ?)`,
    [userId, userId, userId]
  );
  const total = Number(countResult.rows[0]?.cnt ?? 0);

  const result = await query<FeedPost>(
    `SELECT
       p.id,
       p.user_id,
       p.event_id,
       p.image_url,
       p.thumbnail_url,
       p.caption,
       p.like_count,
       p.view_count,
       p.created_at,
       u.username,
       u.display_name,
       u.avatar_url,
       CASE WHEN pl.id IS NOT NULL THEN TRUE ELSE FALSE END AS liked_by_me,
       (SELECT COUNT(*) FROM photo_comments pc WHERE pc.photo_id = p.id AND pc.deleted_at IS NULL) AS comment_count
     FROM photos p
     JOIN users u ON u.id = p.user_id
     LEFT JOIN photo_likes pl ON pl.photo_id = p.id AND pl.user_id = ?
     WHERE p.deleted_at IS NULL
       AND p.global_visibility = TRUE
       AND p.user_id != ?
       AND p.user_id NOT IN (SELECT blocked_user_id FROM user_blocks WHERE blocker_id = ?)
       AND p.user_id NOT IN (SELECT blocker_id FROM user_blocks WHERE blocked_user_id = ?)
     ORDER BY (p.like_count * 2 + p.view_count * 0.1) DESC, p.created_at DESC
     LIMIT ? OFFSET ?`,
    [userId, userId, userId, userId, limit, offset]
  );

  const posts: FeedPost[] = result.rows.map((row) => ({
    ...row,
    liked_by_me: Boolean(row.liked_by_me),
  }));

  return { posts, total };
}

// ============================================
// TRENDING UPCOMING EVENTS — For new user feed enrichment
// ============================================

export async function getTrendingUpcomingEvents(
  userId: string,
  limit: number = 5
): Promise<UpcomingFriendEvent[]> {
  const result = await query<UpcomingFriendEvent>(
    `SELECT
       p.id,
       p.title,
       p.cover_image_url,
       p.date_time,
       p.location_city,
       p.ticket_price,
       p.current_attendees,
       p.max_capacity,
       p.host_id,
       u.display_name AS host_display_name,
       u.avatar_url AS host_avatar_url
     FROM events p
     JOIN users u ON u.id = p.host_id
     WHERE p.deleted_at IS NULL
       AND p.is_private = FALSE
       AND p.status = 'upcoming'
       AND p.date_time > NOW()
       AND p.host_id != ?
       AND p.host_id NOT IN (SELECT blocked_user_id FROM user_blocks WHERE blocker_id = ?)
       AND p.host_id NOT IN (SELECT blocker_id FROM user_blocks WHERE blocked_user_id = ?)
     ORDER BY p.current_attendees DESC, p.date_time ASC
     LIMIT ?`,
    [userId, userId, userId, limit]
  );
  return result.rows;
}

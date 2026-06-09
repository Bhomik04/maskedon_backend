import { query } from "./connection";
import type {
  TagAffinity,
  UserTasteProfile,
  DiscoveryCandidate,
  ScoredDiscoveryPost,
} from "../algorithms/discovery-algorithm";
import { rankDiscoveryFeed } from "../algorithms/discovery-algorithm";

// ============================================
// TASTE PROFILE CONSTRUCTION
// ============================================

/**
 * Builds a user's tag affinities from their engagement history (last 90 days).
 *
 * Signals and weights:
 *  - Liked a photo   → weight 3.0  (strong positive)
 *  - Commented        → weight 5.0  (very strong)
 *  - Viewed           → weight 0.5  (weak / passive)
 *
 * Each interaction is decay-weighted by recency: e^(-age_days / 30)
 * so a 30-day-old interaction is worth ~37% of a fresh one.
 */
async function computeTagAffinities(userId: string): Promise<TagAffinity[]> {
  const result = await query<{ tag: string; affinity_score: number; interaction_count: number }>(
    `WITH engagement_tags AS (
       -- Tags from liked photos (strong signal)
       SELECT pt.tag,
              3.0 * EXP(-EXTRACT(EPOCH FROM (NOW() - pl.created_at)) / (30 * 86400)) AS weighted_score
       FROM photo_likes pl
       JOIN photo_tags pt ON pt.photo_id = pl.photo_id
       WHERE pl.user_id = ?
         AND pl.created_at >= NOW() - INTERVAL '90 days'

       UNION ALL

       -- Tags from commented photos (very strong signal)
       SELECT pt.tag,
              5.0 * EXP(-EXTRACT(EPOCH FROM (NOW() - pc.created_at)) / (30 * 86400)) AS weighted_score
       FROM photo_comments pc
       JOIN photo_tags pt ON pt.photo_id = pc.photo_id
       WHERE pc.user_id = ?
         AND pc.deleted_at IS NULL
         AND pc.created_at >= NOW() - INTERVAL '90 days'

       UNION ALL

       -- Tags from viewed photos (weak / passive signal)
       SELECT pt.tag,
              0.5 * EXP(-EXTRACT(EPOCH FROM (NOW() - pv.created_at)) / (30 * 86400)) AS weighted_score
       FROM photo_views pv
       JOIN photo_tags pt ON pt.photo_id = pv.photo_id
       WHERE pv.user_id = ?
         AND pv.created_at >= NOW() - INTERVAL '90 days'
     )
     SELECT tag,
            SUM(weighted_score) AS affinity_score,
            COUNT(*)::int       AS interaction_count
     FROM engagement_tags
     GROUP BY tag
     ORDER BY affinity_score DESC
     LIMIT 30`,
    [userId, userId, userId]
  );

  return result.rows.map((r) => ({
    tag: r.tag,
    score: Number(r.affinity_score),
    interactions: r.interaction_count,
  }));
}

/**
 * Gets creator IDs the user has previously engaged with (liked or commented).
 */
async function getEngagedCreatorIds(userId: string): Promise<string[]> {
  const result = await query<{ creator_id: string }>(
    `SELECT DISTINCT p.user_id AS creator_id
     FROM (
       SELECT photo_id FROM photo_likes WHERE user_id = ? AND created_at >= NOW() - INTERVAL '90 days'
       UNION
       SELECT photo_id FROM photo_comments WHERE user_id = ? AND deleted_at IS NULL AND created_at >= NOW() - INTERVAL '90 days'
     ) engaged
     JOIN photos p ON p.id = engaged.photo_id
     WHERE p.user_id != ?`,
    [userId, userId, userId]
  );
  return result.rows.map((r) => r.creator_id);
}

/**
 * Builds the full taste profile for a user by aggregating their engagement.
 */
export async function buildUserTasteProfile(userId: string): Promise<UserTasteProfile> {
  const [tagAffinities, engagedCreatorIds] = await Promise.all([
    computeTagAffinities(userId),
    getEngagedCreatorIds(userId),
  ]);

  const totalInteractions = tagAffinities.reduce((sum, a) => sum + a.interactions, 0);

  return { tagAffinities, engagedCreatorIds, totalInteractions };
}

// ============================================
// AFFINITY CACHE (materialization)
// ============================================

/**
 * Materializes the user's tag affinities into the `user_tag_affinities` table.
 * Called periodically or when the user requests their discovery feed after the
 * cache is stale (> 24 hours old).
 */
export async function refreshUserAffinityCache(userId: string): Promise<void> {
  const affinities = await computeTagAffinities(userId);

  // Clear old affinities
  await query("DELETE FROM user_tag_affinities WHERE user_id = ?", [userId]);

  if (affinities.length === 0) return;

  // Batch insert
  const placeholders = affinities.map(() => "(?, ?, ?, ?, NOW(), NOW())").join(", ");
  const values = affinities.flatMap((a) => [userId, a.tag, a.score, a.interactions]);

  await query(
    `INSERT INTO user_tag_affinities (user_id, tag, affinity_score, interaction_count, last_interaction_at, updated_at)
     VALUES ${placeholders}
     ON CONFLICT (user_id, tag)
     DO UPDATE SET
       affinity_score = EXCLUDED.affinity_score,
       interaction_count = EXCLUDED.interaction_count,
       updated_at = NOW()`,
    values
  );
}

/**
 * Checks if the user's affinity cache is fresh enough (< 24h old).
 */
async function isAffinityCacheFresh(userId: string): Promise<boolean> {
  const result = await query<{ cnt: number }>(
    `SELECT COUNT(*) AS cnt FROM user_tag_affinities
     WHERE user_id = ? AND updated_at >= NOW() - INTERVAL '24 hours'`,
    [userId]
  );
  return (result.rows[0]?.cnt ?? 0) > 0;
}

// ============================================
// CANDIDATE FETCHING
// ============================================

interface RawCandidateRow {
  id: string;
  user_id: string;
  image_url: string;
  thumbnail_url: string | null;
  caption: string | null;
  like_count: number;
  view_count: number;
  comment_count: number;
  created_at: Date;
  username: string;
  display_name: string;
  avatar_url: string | null;
  event_id: string | null;
  event_city: string | null;
  friends_liked_count: number;
  creator_social_rating: number;
  creator_total_ratings: number;
  tags_csv: string;
  liked_by_me: boolean;
}

/**
 * Fetches candidate posts for the discovery feed.
 *
 * Candidates are globally-visible posts from non-friends that the user
 * has not been shown before. We fetch more candidates than needed (3×)
 * so the algorithm has room for diversification.
 */
async function fetchDiscoveryCandidates(
  userId: string,
  fetchLimit: number
): Promise<DiscoveryCandidate[]> {
  const result = await query<RawCandidateRow>(
    `SELECT
       p.id,
       p.user_id,
       p.image_url,
       p.thumbnail_url,
       p.caption,
       p.like_count,
       p.view_count,
       p.created_at,
       u.username,
       u.display_name,
       u.avatar_url,
       u.social_rating  AS creator_social_rating,
       u.total_ratings  AS creator_total_ratings,
       p.event_id,
       par.location_city AS event_city,
       CASE WHEN pl.id IS NOT NULL THEN TRUE ELSE FALSE END AS liked_by_me,
       -- Comment count
       (SELECT COUNT(*) FROM photo_comments pc
        WHERE pc.photo_id = p.id AND pc.deleted_at IS NULL)::int AS comment_count,
       -- Friends who liked this post
       (SELECT COUNT(*) FROM photo_likes fl
        WHERE fl.photo_id = p.id
          AND fl.user_id IN (
            SELECT CASE WHEN f.requester_id = ? THEN f.addressee_id ELSE f.requester_id END
            FROM friendships f
            WHERE f.status = 'accepted' AND (f.requester_id = ? OR f.addressee_id = ?)
          )
       )::int AS friends_liked_count,
       -- Tags as CSV
       COALESCE((SELECT string_agg(pt.tag, ',') FROM photo_tags pt WHERE pt.photo_id = p.id), '') AS tags_csv
     FROM photos p
     JOIN users u ON u.id = p.user_id
     LEFT JOIN events par ON par.id = p.event_id
     LEFT JOIN photo_likes pl ON pl.photo_id = p.id AND pl.user_id = ?
     WHERE p.global_visibility = TRUE
       AND p.deleted_at IS NULL
       AND p.user_id != ?
       -- Exclude friends
       AND p.user_id NOT IN (
         SELECT CASE WHEN f.requester_id = ? THEN f.addressee_id ELSE f.requester_id END
         FROM friendships f
         WHERE f.status = 'accepted' AND (f.requester_id = ? OR f.addressee_id = ?)
       )
       -- Exclude blocked (both directions)
       AND p.user_id NOT IN (
         SELECT blocked_user_id FROM user_blocks WHERE blocker_id = ?
         UNION
         SELECT blocker_id FROM user_blocks WHERE blocked_user_id = ?
       )
       -- Exclude already shown
       AND p.id NOT IN (
         SELECT photo_id FROM discovery_impressions WHERE user_id = ?
       )
       -- Only recent posts
       AND p.created_at >= NOW() - INTERVAL '30 days'
     ORDER BY p.created_at DESC
     LIMIT ?`,
    [
      userId, userId, userId,  // for friends_liked subquery
      userId,                  // for photo_likes pl LEFT JOIN
      userId,                  // exclude self
      userId, userId, userId,  // exclude friends
      userId, userId,          // exclude blocked
      userId,                  // exclude seen
      fetchLimit,              // limit
    ]
  );

  return result.rows.map((row) => ({
    ...row,
    tags: row.tags_csv ? row.tags_csv.split(",") : [],
    creator_social_rating: Number(row.creator_social_rating),
    creator_total_ratings: Number(row.creator_total_ratings),
    friends_liked_count: Number(row.friends_liked_count),
    comment_count: Number(row.comment_count),
    liked_by_me: Boolean(row.liked_by_me),
  }));
}

// ============================================
// IMPRESSION TRACKING
// ============================================

/**
 * Records that a set of discovery posts was shown to the user.
 */
export async function recordDiscoveryImpressions(
  userId: string,
  photoIds: string[]
): Promise<void> {
  if (photoIds.length === 0) return;

  const placeholders = photoIds.map(() => "(?, ?)").join(", ");
  const values = photoIds.flatMap((id) => [userId, id]);

  await query(
    `INSERT INTO discovery_impressions (user_id, photo_id)
     VALUES ${placeholders}
     ON CONFLICT (user_id, photo_id) DO NOTHING`,
    values
  );
}

/**
 * Marks that the user engaged with a discovery post (liked, commented, viewed).
 */
export async function markDiscoveryEngagement(
  userId: string,
  photoId: string
): Promise<void> {
  await query(
    `UPDATE discovery_impressions SET engaged = TRUE
     WHERE user_id = ? AND photo_id = ?`,
    [userId, photoId]
  );
}

/**
 * Prune old impressions (> 30 days) to keep the table small.
 * Should be called from a scheduled job.
 */
export async function pruneOldImpressions(): Promise<number> {
  const result = await query(
    "DELETE FROM discovery_impressions WHERE shown_at < NOW() - INTERVAL '30 days'"
  );
  return result.affectedRows;
}

// ============================================
// MAIN DISCOVERY FEED ENTRY POINT
// ============================================

export interface DiscoveryFeedResult {
  posts: ScoredDiscoveryPost[];
  total_candidates: number;
  is_personalized: boolean;
}

/**
 * Returns the personalized discovery feed for a user.
 *
 * Flow:
 *  1. Refresh affinity cache if stale (> 24h).
 *  2. Build the user's taste profile.
 *  3. Fetch 3× more candidates than needed from the DB.
 *  4. Score and rank candidates using the discovery algorithm.
 *  5. Record impressions so we don't show the same posts again.
 *  6. Return the final ranked list.
 */
export async function getDiscoveryFeed(
  userId: string,
  page: number = 1,
  limit: number = 20
): Promise<DiscoveryFeedResult> {
  // 1. Refresh affinity cache if needed
  const cacheFresh = await isAffinityCacheFresh(userId);
  if (!cacheFresh) {
    await refreshUserAffinityCache(userId);
  }

  // 2. Build taste profile
  const profile = await buildUserTasteProfile(userId);

  // 3. Fetch candidates (3× overfetch for diversity headroom)
  const fetchLimit = limit * 3 + (page - 1) * limit;
  const candidates = await fetchDiscoveryCandidates(userId, fetchLimit);

  // 4. Score and rank
  const ranked = rankDiscoveryFeed(candidates, profile, limit);

  // 5. Record impressions
  const shownIds = ranked.map((p) => p.id);
  await recordDiscoveryImpressions(userId, shownIds);

  return {
    posts: ranked,
    total_candidates: candidates.length,
    is_personalized: profile.tagAffinities.length >= 3,
  };
}

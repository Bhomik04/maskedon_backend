// Feed Ranking Algorithm — Pure function, no DB or HTTP imports.
// Ranks friend photo posts using recency + engagement signals.

export interface FeedPost {
  id: string;
  user_id: string;
  party_id: string | null;
  image_url: string;
  thumbnail_url: string | null;
  caption: string | null;
  like_count: number;
  view_count?: number;
  comment_count?: number;
  created_at: Date;
  // Joined user fields
  username: string;
  display_name: string;
  avatar_url: string | null;
  // Optional: whether the requesting user liked this post
  liked_by_me?: boolean;
}

export interface RankedFeedPost extends FeedPost {
  feed_score: number;
}

// Time-based weight tiers
const WEIGHT_LAST_24H = 3.0;   // very fresh
const WEIGHT_LAST_7D  = 2.0;   // recent
const WEIGHT_OLDER    = 1.0;   // older

// Engagement weights
const LIKE_WEIGHT    = 0.15;   // per like
const COMMENT_WEIGHT = 0.3;    // per comment (higher value — comments = deeper engagement)
const VIEW_WEIGHT    = 0.02;   // per view (lower value — passive signal)
const PARTY_BOOST    = 0.5;    // bonus for party-linked photos

const MS_24H = 24 * 60 * 60 * 1000;
const MS_7D  = 7  * 24 * 60 * 60 * 1000;

/**
 * Returns the recency weight for a post based on how old it is.
 */
export function getRecencyWeight(postDate: Date, now: Date = new Date()): number {
  const ageMs = now.getTime() - postDate.getTime();
  if (ageMs <= MS_24H) return WEIGHT_LAST_24H;
  if (ageMs <= MS_7D)  return WEIGHT_LAST_7D;
  return WEIGHT_OLDER;
}

/**
 * Scores a single feed post.
 * Score = (recencyWeight + engagementBoost) / (rank + 1)
 *
 * This preserves overall chronological order within a weight tier but
 * bubbles fresher and more-engaged posts to the top.
 */
export function scoreFeedPost(post: FeedPost, rank: number, now: Date = new Date()): RankedFeedPost {
  const recency = getRecencyWeight(post.created_at, now);
  const engagement =
    (post.like_count || 0) * LIKE_WEIGHT +
    (post.comment_count || 0) * COMMENT_WEIGHT +
    (post.view_count || 0) * VIEW_WEIGHT +
    (post.party_id ? PARTY_BOOST : 0);
  const feedScore = (recency + Math.min(engagement, 5)) / (rank + 1);
  return { ...post, feed_score: feedScore };
}

/**
 * Ranks an array of feed posts.
 * Input is expected to already be ordered newest-first (DB ORDER BY created_at DESC).
 * Output is sorted by feed_score descending so freshest posts stay on top.
 */
export function rankFeedPosts(posts: FeedPost[], now: Date = new Date()): RankedFeedPost[] {
  const scored = posts.map((post, index) => scoreFeedPost(post, index, now));
  // Stable sort: higher score first; equal scores keep original (chronological) order
  return scored.sort((a, b) => b.feed_score - a.feed_score);
}

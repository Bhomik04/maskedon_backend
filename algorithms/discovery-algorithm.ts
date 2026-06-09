// Discovery & Suggestion Algorithm — Pure function, no DB or HTTP imports.
// Ranks candidate posts for a user's "Discover" feed using multi-signal
// "Resonance Scoring" to surface content that matches the user's taste
// profile while maintaining diversity and serendipity.

// ── Score Weights (sum to 1.0) ───────────────────────────────────────
export const W_TAG_RELEVANCE      = 0.35;
export const W_ENGAGEMENT_QUALITY = 0.20;
export const W_SOCIAL_PROOF       = 0.15;
export const W_CREATOR_QUALITY    = 0.10;
export const W_FRESHNESS          = 0.15;
export const W_SERENDIPITY        = 0.05;

/** Recency half-life: posts lose half their freshness score after this many hours */
export const FRESHNESS_HALF_LIFE_HOURS = 48;

/** Max posts from the same creator in one response batch */
export const MAX_PER_CREATOR = 2;

/** Below this many tag affinities we fall back to popularity-based ranking */
export const MIN_AFFINITIES_FOR_PERSONALIZATION = 3;

/** Percentage of results reserved for "wildcard" serendipitous posts */
export const SERENDIPITY_SLOT_RATIO = 0.15;

// ── Interfaces ───────────────────────────────────────────────────────

export interface TagAffinity {
  tag: string;
  /** Raw affinity score derived from engagement (likes=3, comments=5, views=0.5) × recency decay */
  score: number;
  /** How many interactions contributed to this affinity */
  interactions: number;
}

export interface UserTasteProfile {
  /** Top tag affinities sorted by score desc */
  tagAffinities: TagAffinity[];
  /** Creator IDs the user has previously engaged with */
  engagedCreatorIds: string[];
  /** Total interaction count (for confidence weighting) */
  totalInteractions: number;
}

export interface DiscoveryCandidate {
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
  tags: string[];
  event_id: string | null;
  event_city: string | null;
  /** How many of the viewer's friends liked this post */
  friends_liked_count: number;
  /** Post creator's social rating (0–5) */
  creator_social_rating: number;
  /** How many total ratings the creator has received */
  creator_total_ratings: number;
  liked_by_me: boolean;
}

export interface ScoreBreakdown {
  tag_relevance: number;
  engagement_quality: number;
  social_proof: number;
  creator_quality: number;
  freshness: number;
  serendipity: number;
}

export interface ScoredDiscoveryPost extends DiscoveryCandidate {
  discovery_score: number;
  score_breakdown: ScoreBreakdown;
  /** Human-readable reason why this was recommended */
  relevance_reason: string;
}

// ── Scoring Functions ────────────────────────────────────────────────

/**
 * Tag Relevance (0–10)
 * Measures overlap between user's tag affinities and the post's tags.
 * Uses weighted sum normalized by sqrt(tag count) to penalize tag-spam.
 */
export function scoreTagRelevance(
  postTags: string[],
  affinityMap: Map<string, number>
): number {
  if (postTags.length === 0 || affinityMap.size === 0) return 0;

  let matchScore = 0;
  for (const tag of postTags) {
    const affinity = affinityMap.get(tag);
    if (affinity !== undefined) matchScore += affinity;
  }

  // Normalize by sqrt of tag count — rewards focused posts, penalizes spam
  const normalized = matchScore / Math.sqrt(postTags.length);

  // Clamp to 0–10
  return Math.min(10, normalized);
}

/**
 * Engagement Quality (0–10)
 * Measures how genuinely engaging a post is based on like/comment/view ratios
 * and velocity. Uses log scale to prevent viral outliers from dominating.
 */
export function scoreEngagementQuality(
  likeCount: number,
  commentCount: number,
  viewCount: number,
  ageHours: number
): number {
  const views = Math.max(viewCount, 1);

  // Engagement rate: weighted interactions per view
  const engagementRate = (likeCount + commentCount * 3) / views;

  // Engagement velocity: weighted interactions per hour (only if post has some age)
  const safeAge = Math.max(ageHours, 0.5);
  const velocity = (likeCount + commentCount * 3) / safeAge;

  // Log-scale both to prevent outlier dominance
  const rateScore = Math.log1p(engagementRate * 10);
  const velocityScore = Math.log1p(velocity * 2);

  // Combined, clamped to 0–10
  return Math.min(10, (rateScore + velocityScore) * 1.5);
}

/**
 * Social Proof (0–10)
 * Measures how many of the user's friends engaged with this post.
 * Diminishing returns: first friend is worth most, each additional less.
 */
export function scoreSocialProof(friendsLikedCount: number): number {
  if (friendsLikedCount <= 0) return 0;
  // Logarithmic diminishing returns, capped at 10
  return Math.min(10, Math.log2(friendsLikedCount + 1) * 4);
}

/**
 * Creator Quality (0–10)
 * Based on the post creator's social rating and reliability.
 * Confidence factor ensures creators with few ratings don't unfairly dominate.
 */
export function scoreCreatorQuality(
  socialRating: number,
  totalRatings: number,
  isEngagedCreator: boolean
): number {
  // Base score from social rating (0–5 scale → 0–10)
  const ratingScore = (socialRating / 5) * 10;

  // Confidence: need 10+ ratings for full weight
  const confidence = Math.min(totalRatings / 10, 1);

  // Bonus if user has previously engaged with this creator
  const familiarityBonus = isEngagedCreator ? 1.5 : 0;

  return Math.min(10, ratingScore * confidence + familiarityBonus);
}

/**
 * Freshness (0–10)
 * Exponential decay based on post age. Posts lose half their freshness
 * score every FRESHNESS_HALF_LIFE_HOURS hours.
 */
export function scoreFreshness(ageHours: number): number {
  const decay = Math.exp((-Math.LN2 * ageHours) / FRESHNESS_HALF_LIFE_HOURS);
  return decay * 10;
}

/**
 * Serendipity (0–10)
 * Rewards posts with tags the user has NEVER interacted with.
 * Prevents echo chambers by surfacing novel content.
 */
export function scoreSerendipity(
  postTags: string[],
  affinityMap: Map<string, number>
): number {
  if (postTags.length === 0) return 5; // No tags = neutral

  let novelCount = 0;
  for (const tag of postTags) {
    if (!affinityMap.has(tag)) novelCount++;
  }

  const novelRatio = novelCount / postTags.length;
  return novelRatio * 10;
}

/**
 * Generates a human-readable reason for why this post was recommended.
 */
function buildRelevanceReason(
  breakdown: ScoreBreakdown,
  postTags: string[],
  affinityMap: Map<string, number>,
  friendsLiked: number
): string {
  // Find the strongest signal
  const signals = [
    { key: "tag_relevance", score: breakdown.tag_relevance, label: "" },
    { key: "social_proof", score: breakdown.social_proof, label: "" },
    { key: "engagement_quality", score: breakdown.engagement_quality, label: "Trending in the community" },
    { key: "freshness", score: breakdown.freshness, label: "Fresh post" },
    { key: "creator_quality", score: breakdown.creator_quality, label: "From a highly rated creator" },
    { key: "serendipity", score: breakdown.serendipity, label: "Something new for you" },
  ];

  // Build dynamic labels for tag_relevance and social_proof
  if (breakdown.tag_relevance > 0) {
    const matchingTags = postTags.filter((t) => affinityMap.has(t)).slice(0, 2);
    signals[0].label = matchingTags.length > 0
      ? `Matches your interest in #${matchingTags.join(", #")}`
      : "Matches your interests";
  }
  if (friendsLiked > 0) {
    signals[1].label = friendsLiked === 1
      ? "Liked by a friend"
      : `Liked by ${friendsLiked} friends`;
  }

  // Pick the top-scoring signal that has a label
  const best = signals
    .filter((s) => s.label.length > 0 && s.score > 0)
    .sort((a, b) => b.score - a.score)[0];

  return best?.label || "Suggested for you";
}

// ── Core Scoring ─────────────────────────────────────────────────────

/**
 * Scores a single discovery candidate against the user's taste profile.
 */
export function scoreCandidate(
  candidate: DiscoveryCandidate,
  profile: UserTasteProfile,
  now: Date = new Date()
): ScoredDiscoveryPost {
  const affinityMap = new Map(profile.tagAffinities.map((a) => [a.tag, a.score]));
  const engagedSet = new Set(profile.engagedCreatorIds);

  const ageMs = now.getTime() - new Date(candidate.created_at).getTime();
  const ageHours = Math.max(ageMs / 3_600_000, 0);

  const breakdown: ScoreBreakdown = {
    tag_relevance: scoreTagRelevance(candidate.tags, affinityMap),
    engagement_quality: scoreEngagementQuality(
      candidate.like_count,
      candidate.comment_count,
      candidate.view_count,
      ageHours
    ),
    social_proof: scoreSocialProof(candidate.friends_liked_count),
    creator_quality: scoreCreatorQuality(
      candidate.creator_social_rating,
      candidate.creator_total_ratings,
      engagedSet.has(candidate.user_id)
    ),
    freshness: scoreFreshness(ageHours),
    serendipity: scoreSerendipity(candidate.tags, affinityMap),
  };

  // If user has too few affinities, shift weight from tags to engagement + freshness
  const isPersonalized = profile.tagAffinities.length >= MIN_AFFINITIES_FOR_PERSONALIZATION;

  let discovery_score: number;
  if (isPersonalized) {
    discovery_score =
      breakdown.tag_relevance      * W_TAG_RELEVANCE +
      breakdown.engagement_quality * W_ENGAGEMENT_QUALITY +
      breakdown.social_proof       * W_SOCIAL_PROOF +
      breakdown.creator_quality    * W_CREATOR_QUALITY +
      breakdown.freshness          * W_FRESHNESS +
      breakdown.serendipity        * W_SERENDIPITY;
  } else {
    // Fallback: popularity-based with freshness boost
    discovery_score =
      breakdown.tag_relevance      * 0.10 +
      breakdown.engagement_quality * 0.35 +
      breakdown.social_proof       * 0.20 +
      breakdown.creator_quality    * 0.10 +
      breakdown.freshness          * 0.20 +
      breakdown.serendipity        * 0.05;
  }

  const relevance_reason = buildRelevanceReason(
    breakdown,
    candidate.tags,
    affinityMap,
    candidate.friends_liked_count
  );

  return {
    ...candidate,
    discovery_score,
    score_breakdown: breakdown,
    relevance_reason,
  };
}

// ── Ranking & Diversification ────────────────────────────────────────

/**
 * Ranks and diversifies a batch of discovery candidates.
 *
 * 1. Score every candidate against the user's taste profile.
 * 2. Sort by discovery_score descending.
 * 3. Apply diversity constraints (max N per creator, tag cluster variety).
 * 4. Reserve ~15% of slots for serendipitous "wildcard" posts.
 * 5. Return the final ranked list trimmed to `limit`.
 */
export function rankDiscoveryFeed(
  candidates: DiscoveryCandidate[],
  profile: UserTasteProfile,
  limit: number = 20,
  now: Date = new Date()
): ScoredDiscoveryPost[] {
  if (candidates.length === 0) return [];

  // 1. Score all candidates
  const scored = candidates.map((c) => scoreCandidate(c, profile, now));

  // 2. Sort by score
  scored.sort((a, b) => b.discovery_score - a.discovery_score);

  // 3. Diversify: enforce max-per-creator + reserve serendipity slots
  const wildcardSlots = Math.max(1, Math.floor(limit * SERENDIPITY_SLOT_RATIO));
  const mainSlots = limit - wildcardSlots;

  const mainResults: ScoredDiscoveryPost[] = [];
  const wildcardPool: ScoredDiscoveryPost[] = [];
  const creatorCounts = new Map<string, number>();
  const usedIds = new Set<string>();

  for (const post of scored) {
    if (mainResults.length >= mainSlots && wildcardPool.length >= wildcardSlots * 3) break;

    const creatorCount = creatorCounts.get(post.user_id) || 0;

    if (creatorCount >= MAX_PER_CREATOR) {
      // Already have enough from this creator — skip for main, maybe wildcard
      continue;
    }

    // High serendipity score → candidate for wildcard slot
    if (post.score_breakdown.serendipity > 6 && post.score_breakdown.tag_relevance < 2) {
      if (wildcardPool.length < wildcardSlots * 3) {
        wildcardPool.push(post);
        usedIds.add(post.id);
      }
      continue;
    }

    if (mainResults.length < mainSlots) {
      mainResults.push(post);
      usedIds.add(post.id);
      creatorCounts.set(post.user_id, creatorCount + 1);
    }
  }

  // 4. Fill wildcard slots (pick randomly from the pool for variety)
  const wildcards: ScoredDiscoveryPost[] = [];
  const availableWildcards = wildcardPool.filter((p) => !usedIds.has(p.id));
  for (let i = 0; i < wildcardSlots && availableWildcards.length > 0; i++) {
    const idx = Math.floor(Math.random() * availableWildcards.length);
    wildcards.push(availableWildcards.splice(idx, 1)[0]);
  }

  // 5. If we don't have enough main results, backfill from scored list
  if (mainResults.length < mainSlots) {
    for (const post of scored) {
      if (mainResults.length >= mainSlots) break;
      if (usedIds.has(post.id)) continue;
      mainResults.push(post);
      usedIds.add(post.id);
    }
  }

  // 6. Interleave wildcards into the main feed at even intervals
  const combined = [...mainResults];
  if (wildcards.length > 0) {
    const interval = Math.max(1, Math.floor(combined.length / (wildcards.length + 1)));
    for (let i = 0; i < wildcards.length; i++) {
      const insertAt = Math.min((i + 1) * interval, combined.length);
      combined.splice(insertAt, 0, wildcards[i]);
    }
  }

  return combined.slice(0, limit);
}

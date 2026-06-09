import { Request, Response } from "express";
import { getFriendsFeedPosts, getFeedStories, getTrendingFeedPost, getUpcomingFriendEvents, getDiscoveryPost, getGlobalFallbackFeed, getTrendingUpcomingEvents } from "../../dblayer/feed-queries";
import { rankFeedPosts } from "../../algorithms/feed-algorithm";
import { getRecentFriendAchievementFeedItems, syncFriendsAchievementsForViewer } from "../../dblayer/achievement-queries";
import { getDiscoveryFeed } from "../../dblayer/discovery-queries";
import { logger } from "../lib/logger";

/**
 * GET /api/v1/feed
 * Returns a ranked feed of photos from the authenticated user's accepted friends.
 * On page 1, also returns stories strip, trending post, and upcoming friend events.
 * Query params: page (default 1), limit (default 20, max 50)
 */
export async function getFeed(req: Request, res: Response) {
  const userId = req.user?.userId;
  if (!userId) {
    res.status(401).json({
      success: false,
      error: { code: "AUTH_REQUIRED", message: "Authentication required" },
    });
    return;
  }

  // Parse and clamp pagination params
  const page  = Math.max(1, parseInt(String(req.query.page  ?? "1"),  10) || 1);
  const limit = Math.min(50, Math.max(1, parseInt(String(req.query.limit ?? "20"), 10) || 20));

  // Always fetch the main feed
  const { posts, total } = await getFriendsFeedPosts(userId, page, limit);

  // New-user fallback: if no friends have posted yet, serve global community posts
  let isFallback = false;
  let rankedPosts = rankFeedPosts(posts);
  let finalTotal = total;
  let fallbackEvents: Awaited<ReturnType<typeof getTrendingUpcomingEvents>> = [];

  if (total === 0) {
    const fallback = await getGlobalFallbackFeed(userId, page, limit);
    rankedPosts = rankFeedPosts(fallback.posts);
    finalTotal = fallback.total;
    isFallback = true;
    if (page === 1) {
      fallbackEvents = await getTrendingUpcomingEvents(userId, 5);
    }
  }

  // On first page, fetch enrichment data in parallel
  let stories = undefined;
  let trendingPost = undefined;
  let upcomingEvents = undefined;
  let achievementUpdates = undefined;
  let discoveryPost = undefined;

  if (page === 1) {
    // Keep achievement unlocks up to date before returning feed extras.
    // Wrap in try/catch — a failing achievement sync must not crash the feed.
    await syncFriendsAchievementsForViewer(userId).catch((err) => {
      logger.error("[feed] syncFriendsAchievementsForViewer failed", { message: err?.message });
    });

    const [storiesResult, trendingResult, eventsResult, discoveryResult, achievementResult] = await Promise.allSettled([
      getFeedStories(userId),
      getTrendingFeedPost(userId),
      isFallback ? Promise.resolve(fallbackEvents) : getUpcomingFriendEvents(userId),
      getDiscoveryPost(userId),
      getRecentFriendAchievementFeedItems(userId, 12),
    ]);

    stories         = storiesResult.status         === "fulfilled" ? storiesResult.value         : [];
    trendingPost    = trendingResult.status         === "fulfilled" ? trendingResult.value        : null;
    upcomingEvents = eventsResult.status          === "fulfilled" ? eventsResult.value         : [];
    discoveryPost   = discoveryResult.status        === "fulfilled" ? (discoveryResult.value ?? undefined) : undefined;
    achievementUpdates = achievementResult.status   === "fulfilled" ? achievementResult.value     : [];

    // Log any enrichment failures for debugging — they won't break the feed response.
    if (storiesResult.status === "rejected")      logger.error("[feed] getFeedStories failed",                    { message: storiesResult.reason?.message });
    if (trendingResult.status === "rejected")     logger.error("[feed] getTrendingFeedPost failed",               { message: trendingResult.reason?.message });
    if (eventsResult.status === "rejected")      logger.error("[feed] getUpcomingFriendEvents failed",          { message: eventsResult.reason?.message });
    if (discoveryResult.status === "rejected")    logger.error("[feed] getDiscoveryPost failed",                  { message: discoveryResult.reason?.message });
    if (achievementResult.status === "rejected")  logger.error("[feed] getRecentFriendAchievementFeedItems failed", { message: achievementResult.reason?.message });
  }

  res.status(200).json({
    success: true,
    data: {
      posts: rankedPosts,
      total: finalTotal,
      page,
      limit,
      hasMore: page * limit < finalTotal,
      is_fallback: isFallback,
      ...(page === 1 && {
        stories,
        trending_post: trendingPost,
        upcoming_events: upcomingEvents,
        achievement_updates: achievementUpdates,
        discovery_post: discoveryPost ?? null,
      }),
    },
  });
}

/**
 * GET /api/v1/feed/discover
 * Returns a personalized discovery feed of posts from non-friends,
 * ranked by the Resonance Scoring algorithm based on the user's
 * engagement history and taste profile.
 *
 * Query params: page (default 1), limit (default 20, max 50)
 */
export async function getDiscover(req: Request, res: Response) {
  const userId = req.user?.userId;
  if (!userId) {
    res.status(401).json({
      success: false,
      error: { code: "AUTH_REQUIRED", message: "Authentication required" },
    });
    return;
  }

  const page  = Math.max(1, parseInt(String(req.query.page  ?? "1"),  10) || 1);
  const limit = Math.min(50, Math.max(1, parseInt(String(req.query.limit ?? "20"), 10) || 20));

  const result = await getDiscoveryFeed(userId, page, limit);

  res.status(200).json({
    success: true,
    data: {
      posts: result.posts,
      total_candidates: result.total_candidates,
      is_personalized: result.is_personalized,
      page,
      limit,
      hasMore: result.posts.length >= limit && (page * limit) < result.total_candidates,
    },
  });
}

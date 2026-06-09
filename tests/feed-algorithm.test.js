// Unit tests for feed-algorithm.ts
// Run with: npm test (builds TS first, then runs Node test runner)

const { rankFeedPosts, getRecencyWeight } = require("../dist/algorithms/feed-algorithm");
const { test, describe } = require("node:test");
const assert = require("node:assert/strict");

function makePost(id, hoursAgo) {
  const date = new Date();
  date.setHours(date.getHours() - hoursAgo);
  return {
    id,
    user_id: "user-1",
    event_id: null,
    image_url: `/img/${id}.jpg`,
    thumbnail_url: null,
    caption: null,
    like_count: 0,
    created_at: date,
    username: "testuser",
    display_name: "Test User",
    avatar_url: null,
    liked_by_me: false,
  };
}

describe("getRecencyWeight", () => {
  const now = new Date();

  test("returns 3.0 for posts < 24h old", () => {
    const post = makePost("a", 1);
    assert.equal(getRecencyWeight(post.created_at, now), 3.0);
  });

  test("returns 3.0 for posts exactly 24h old boundary", () => {
    const post = makePost("b", 23);
    assert.equal(getRecencyWeight(post.created_at, now), 3.0);
  });

  test("returns 2.0 for posts between 24h and 7d old", () => {
    const post = makePost("c", 48);
    assert.equal(getRecencyWeight(post.created_at, now), 2.0);
  });

  test("returns 1.0 for posts older than 7 days", () => {
    const post = makePost("d", 200);
    assert.equal(getRecencyWeight(post.created_at, now), 1.0);
  });
});

describe("rankFeedPosts", () => {
  const now = new Date();

  test("returns empty array for empty input", () => {
    assert.deepEqual(rankFeedPosts([], now), []);
  });

  test("newer posts appear before older posts", () => {
    // Algorithm expects newest-first input (mirroring DB ORDER BY created_at DESC).
    // Position divisor (rank+1) penalises later entries to dampen low-quality bumps.
    const posts = [
      makePost("fresh", 2),    // rank=0, recency=3.0 → score=3.0/1=3.0
      makePost("recent", 48),  // rank=1, recency=2.0 → score=2.0/2=1.0
      makePost("old", 200),    // rank=2, recency=1.0 → score=1.0/3≈0.33
    ];
    const ranked = rankFeedPosts(posts, now);
    assert.equal(ranked[0].id, "fresh");
    assert.equal(ranked[1].id, "recent");
    assert.equal(ranked[2].id, "old");
  });

  test("adds feed_score to each post", () => {
    const posts = [makePost("x", 1)];
    const ranked = rankFeedPosts(posts, now);
    assert.ok(typeof ranked[0].feed_score === "number");
    assert.ok(ranked[0].feed_score > 0);
  });

  test("fresh posts have higher score than old posts", () => {
    const posts = [makePost("old", 200), makePost("fresh", 1)];
    const ranked = rankFeedPosts(posts, now);
    assert.ok(ranked[0].feed_score > ranked[1].feed_score);
  });
});

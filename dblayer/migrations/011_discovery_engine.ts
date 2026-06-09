/**
 * Migration 011: Discovery Engine tables.
 *
 * Adds infrastructure for the personalized post discovery system:
 *
 * 1. `user_tag_affinities` — Cached per-user tag affinity scores computed
 *    from engagement history (likes, comments, views). Rebuilt periodically
 *    so the discovery feed query doesn't need to aggregate on every request.
 *
 * 2. `discovery_impressions` — Tracks which discovery posts have been served
 *    to each user so we never show the same post twice. Old rows are safe
 *    to prune after 30 days.
 */
import { query } from "../connection";

export async function up(): Promise<void> {
  // 1. User tag affinities — materialized taste profile
  await query(`
    CREATE TABLE IF NOT EXISTS user_tag_affinities (
      user_id          UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      tag              TEXT NOT NULL,
      affinity_score   NUMERIC(10,4) NOT NULL DEFAULT 0,
      interaction_count INT NOT NULL DEFAULT 0,
      last_interaction_at TIMESTAMP,
      updated_at       TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (user_id, tag)
    )
  `);

  await query(`
    CREATE INDEX IF NOT EXISTS idx_user_tag_affinities_score
    ON user_tag_affinities (user_id, affinity_score DESC)
  `);

  await query(`
    CREATE INDEX IF NOT EXISTS idx_user_tag_affinities_tag
    ON user_tag_affinities (tag)
  `);

  // 2. Discovery impressions — dedup tracker
  await query(`
    CREATE TABLE IF NOT EXISTS discovery_impressions (
      user_id   UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      photo_id  UUID NOT NULL REFERENCES photos(id) ON DELETE CASCADE,
      shown_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      engaged   BOOLEAN DEFAULT FALSE,
      PRIMARY KEY (user_id, photo_id)
    )
  `);

  await query(`
    CREATE INDEX IF NOT EXISTS idx_discovery_impressions_shown
    ON discovery_impressions (shown_at)
  `);

  await query(`
    CREATE INDEX IF NOT EXISTS idx_discovery_impressions_user
    ON discovery_impressions (user_id, shown_at DESC)
  `);

  // 3. Composite index on photo_tags for efficient affinity-based lookups
  await query(`
    CREATE INDEX IF NOT EXISTS idx_photo_tags_photo_tag
    ON photo_tags (photo_id, tag)
  `);

  // 4. Partial index on globally-visible recent photos for fast candidate selection
  await query(`
    CREATE INDEX IF NOT EXISTS idx_photos_discovery_candidates
    ON photos (created_at DESC)
    WHERE global_visibility = TRUE AND deleted_at IS NULL
  `);

  console.log("Migration 011: discovery engine tables created.");
}

async function migrate() {
  console.log("Running migration 011: discovery engine...");
  await up();
  console.log("Migration 011 complete.");
  process.exit(0);
}

if (require.main === module) {
  migrate().catch((err) => { console.error(err); process.exit(1); });
}


/**
 * Migration 010: Add global_visibility flag to photos.
 *
 * When global_visibility = true the photo may appear in the discovery
 * feed of non-friends who share similar interests (tag overlap).
 * Default is false — photos are only shown to friends.
 *
 * Also adds a lightweight photo_tags table so interest-matching
 * can be done efficiently in SQL without scanning the caption text.
 * Tags are synced from the photo's caption-derived tags at upload time.
 */
import { query } from "../connection";

export async function up(): Promise<void> {
  // 1. Add global_visibility column to photos
  await query(`
    ALTER TABLE photos
    ADD COLUMN IF NOT EXISTS global_visibility BOOLEAN NOT NULL DEFAULT FALSE
  `);

  await query(`
    CREATE INDEX IF NOT EXISTS idx_photos_global_visibility
    ON photos (global_visibility)
    WHERE global_visibility = TRUE AND deleted_at IS NULL
  `);

  // 2. photo_tags: stores tags associated with a photo for interest-matching
  await query(`
    CREATE TABLE IF NOT EXISTS photo_tags (
      photo_id UUID NOT NULL,
      tag      TEXT  NOT NULL,
      PRIMARY KEY (photo_id, tag),
      CONSTRAINT fk_photo_tags_photo FOREIGN KEY (photo_id)
        REFERENCES photos(id) ON DELETE CASCADE
    )
  `);

  await query(`
    CREATE INDEX IF NOT EXISTS idx_photo_tags_tag ON photo_tags (tag)
  `);

  console.log("Migration 010: global_visibility + photo_tags created.");
}

async function migrate() {
  console.log("Running migration 010: global_visibility + photo_tags...");
  await up();
  console.log("Migration 010 complete.");
  process.exit(0);
}

if (require.main === module) {
  migrate().catch((err) => { console.error(err); process.exit(1); });
}

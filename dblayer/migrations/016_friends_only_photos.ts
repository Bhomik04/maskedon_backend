/**
 * Migration 016: Add friends_only flag to photos.
 *
 * When friends_only = true the photo is private — visible only to the
 * poster themselves and users who are mutual friends with the poster.
 * It is hidden from discovery, public profiles viewed by non-friends,
 * and event photo feeds for non-friends.
 *
 * friends_only takes precedence over global_visibility:
 *   friends_only=true  → only friends see it (regardless of global_visibility)
 *   friends_only=false, global_visibility=true → everyone can discover it
 *   friends_only=false, global_visibility=false → friends see it (default)
 */
import { query } from "../connection";

export async function up(): Promise<void> {
  await query(`
    ALTER TABLE photos
    ADD COLUMN IF NOT EXISTS friends_only BOOLEAN NOT NULL DEFAULT FALSE
  `);

  await query(`
    CREATE INDEX IF NOT EXISTS idx_photos_friends_only
    ON photos (friends_only)
    WHERE friends_only = TRUE AND deleted_at IS NULL
  `);
}

export async function down(): Promise<void> {
  await query(`ALTER TABLE photos DROP COLUMN IF EXISTS friends_only`);
}

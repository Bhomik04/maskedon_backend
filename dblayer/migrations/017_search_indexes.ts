/**
 * Migration 017: Enable pg_trgm extension and create trigram GIN indexes
 * for fuzzy full-text search on events and users.
 *
 * pg_trgm lets us use similarity() and % operator for typo-tolerant search.
 * GIN indexes make these queries fast even on large tables.
 */
import { query } from "../connection";

export async function up(): Promise<void> {
  // Enable pg_trgm extension (requires superuser on first install, safe to re-run)
  await query(`CREATE EXTENSION IF NOT EXISTS pg_trgm`);

  // Event search indexes
  await query(`
    CREATE INDEX IF NOT EXISTS idx_events_title_trgm
    ON events USING gin(title gin_trgm_ops)
    WHERE deleted_at IS NULL
  `);
  await query(`
    CREATE INDEX IF NOT EXISTS idx_events_desc_trgm
    ON events USING gin(COALESCE(description, '') gin_trgm_ops)
    WHERE deleted_at IS NULL
  `);
  await query(`
    CREATE INDEX IF NOT EXISTS idx_events_city_trgm
    ON events USING gin(location_city gin_trgm_ops)
    WHERE deleted_at IS NULL
  `);

  // User search indexes
  await query(`
    CREATE INDEX IF NOT EXISTS idx_users_username_trgm
    ON users USING gin(username gin_trgm_ops)
    WHERE deleted_at IS NULL
  `);
  await query(`
    CREATE INDEX IF NOT EXISTS idx_users_display_name_trgm
    ON users USING gin(display_name gin_trgm_ops)
    WHERE deleted_at IS NULL
  `);
}

export async function down(): Promise<void> {
  await query(`DROP INDEX IF EXISTS idx_events_title_trgm`);
  await query(`DROP INDEX IF EXISTS idx_events_desc_trgm`);
  await query(`DROP INDEX IF EXISTS idx_events_city_trgm`);
  await query(`DROP INDEX IF EXISTS idx_users_username_trgm`);
  await query(`DROP INDEX IF EXISTS idx_users_display_name_trgm`);
}

/**
 * Migration 004: Add photo_views table and view_count column to photos.
 * Also adds an updated_at column to photos for caption editing.
 */
import { query } from "../connection";

export async function up(): Promise<void> {
  await query(`ALTER TABLE photos ADD COLUMN IF NOT EXISTS view_count INT DEFAULT 0`);
  await query(`ALTER TABLE photos ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP`);
  await query(`
    CREATE TABLE IF NOT EXISTS photo_views (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      photo_id UUID NOT NULL,
      user_id UUID NOT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      CONSTRAINT uq_photo_user_view UNIQUE (photo_id, user_id),
      CONSTRAINT fk_photo_views_photo FOREIGN KEY (photo_id) REFERENCES photos(id) ON DELETE CASCADE,
      CONSTRAINT fk_photo_views_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    )
  `);
  await query(`CREATE INDEX IF NOT EXISTS idx_photo_views_photo ON photo_views (photo_id)`);
  await query(`CREATE INDEX IF NOT EXISTS idx_photo_views_user ON photo_views (user_id)`);
  console.log("Migration 004: photo_views table + view_count/updated_at columns created.");
}

async function migrate() {
  console.log("Running migration 004: photo_views + photo updates...");

  // 1. Add view_count and updated_at to photos table
  try {
    await query(`ALTER TABLE photos ADD COLUMN IF NOT EXISTS view_count INT DEFAULT 0`);
    console.log("  ✓ Added view_count column to photos");
  } catch (e: any) {
    if (e.message?.includes("already exists")) console.log("  ⓘ view_count column already exists");
    else throw e;
  }

  try {
    await query(`ALTER TABLE photos ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP`);
    console.log("  ✓ Added updated_at column to photos");
  } catch (e: any) {
    if (e.message?.includes("already exists")) console.log("  ⓘ updated_at column already exists");
    else throw e;
  }

  // 2. Create photo_views table for tracking unique views
  await query(`
    CREATE TABLE IF NOT EXISTS photo_views (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      photo_id UUID NOT NULL,
      user_id UUID NOT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      CONSTRAINT uq_photo_user_view UNIQUE (photo_id, user_id),
      CONSTRAINT fk_photo_views_photo FOREIGN KEY (photo_id) REFERENCES photos(id) ON DELETE CASCADE,
      CONSTRAINT fk_photo_views_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    )
  `);
  console.log("  ✓ Created photo_views table");

  await query(`CREATE INDEX IF NOT EXISTS idx_photo_views_photo ON photo_views (photo_id)`);
  await query(`CREATE INDEX IF NOT EXISTS idx_photo_views_user ON photo_views (user_id)`);
  console.log("  ✓ Created photo_views indexes");

  console.log("Migration 004 complete!");
}

// Only run when invoked directly (not when imported by the migration runner)
if (require.main === module) {
  migrate()
    .then(() => process.exit(0))
    .catch((err) => { console.error("Migration 004 failed:", err); process.exit(1); });
}

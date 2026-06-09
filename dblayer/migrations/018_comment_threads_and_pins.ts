import { getConnection, testConnection, query } from "../connection";

export async function up(): Promise<void> {
  // Add parent_comment_id for threaded replies (1 level deep, Instagram-style)
  await query(`
    ALTER TABLE photo_comments
    ADD COLUMN IF NOT EXISTS parent_comment_id UUID NULL
  `);

  // Add foreign key constraint for parent_comment_id if not already present
  // (wrapped in DO block so it's idempotent)
  await query(`
    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'fk_comment_parent'
      ) THEN
        ALTER TABLE photo_comments
          ADD CONSTRAINT fk_comment_parent
          FOREIGN KEY (parent_comment_id)
          REFERENCES photo_comments(id)
          ON DELETE CASCADE;
      END IF;
    END$$
  `);

  // Add is_pinned for pinned top comments (photo owner can pin up to 3)
  await query(`
    ALTER TABLE photo_comments
    ADD COLUMN IF NOT EXISTS is_pinned BOOLEAN NOT NULL DEFAULT FALSE
  `);

  await query(`
    CREATE INDEX IF NOT EXISTS idx_photo_comments_parent ON photo_comments(parent_comment_id)
  `);

  console.log("Migration 018: parent_comment_id + is_pinned added to photo_comments.");
}

async function migrate() {
  const connected = await testConnection();
  if (!connected) {
    console.error("Cannot run migration — database connection failed.");
    process.exit(1);
  }

  const conn = await getConnection();

  try {
    await conn.execute(`
      CREATE TABLE IF NOT EXISTS migrations (
        id INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
        name VARCHAR(255) NOT NULL UNIQUE,
        executed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    const migrationName = "018_comment_threads_and_pins";

    const [rows] = await conn.execute(
      "SELECT id FROM migrations WHERE name = ?",
      [migrationName]
    );

    if (Array.isArray(rows) && rows.length > 0) {
      console.log(`Migration "${migrationName}" already applied. Skipping.`);
      conn.release();
      process.exit(0);
    }

    await conn.beginTransaction();

    await conn.execute(`
      ALTER TABLE photo_comments
      ADD COLUMN IF NOT EXISTS parent_comment_id UUID NULL
    `);

    await conn.execute(`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM pg_constraint WHERE conname = 'fk_comment_parent'
        ) THEN
          ALTER TABLE photo_comments
            ADD CONSTRAINT fk_comment_parent
            FOREIGN KEY (parent_comment_id)
            REFERENCES photo_comments(id) ON DELETE CASCADE;
        END IF;
      END$$
    `);

    await conn.execute(`
      ALTER TABLE photo_comments
      ADD COLUMN IF NOT EXISTS is_pinned BOOLEAN NOT NULL DEFAULT FALSE
    `);

    await conn.execute(`
      CREATE INDEX IF NOT EXISTS idx_photo_comments_parent ON photo_comments(parent_comment_id)
    `);

    await conn.execute(
      "INSERT INTO migrations (name) VALUES (?)",
      [migrationName]
    );

    await conn.commit();
    console.log(`Migration "${migrationName}" applied successfully.`);
  } catch (err) {
    await conn.rollback();
    console.error("Migration failed:", err);
    process.exit(1);
  } finally {
    conn.release();
    process.exit(0);
  }
}

if (require.main === module) { migrate(); }

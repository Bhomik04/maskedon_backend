import { getConnection, testConnection, query } from "../connection";

export async function up(): Promise<void> {
  await query(`
    CREATE TABLE IF NOT EXISTS photo_comments (
      id UUID PRIMARY KEY,
      photo_id UUID NOT NULL,
      user_id UUID NOT NULL,
      comment_text TEXT NOT NULL,
      like_count INT DEFAULT 0,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      deleted_at TIMESTAMP NULL,
      CONSTRAINT fk_comments_photo FOREIGN KEY (photo_id) REFERENCES photos(id) ON DELETE CASCADE,
      CONSTRAINT fk_comments_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    )
  `);
  await query(`CREATE INDEX IF NOT EXISTS idx_photo_comments_photo ON photo_comments (photo_id)`);
  await query(`CREATE INDEX IF NOT EXISTS idx_photo_comments_user ON photo_comments (user_id)`);
  console.log("Migration 002: photo_comments table created.");
}

async function migrate() {
  const connected = await testConnection();
  if (!connected) {
    console.error("Cannot run migration — database connection failed.");
    process.exit(1);
  }

  const conn = await getConnection();

  try {
    // Create migrations tracking table if it doesn't exist
    await conn.execute(`
      CREATE TABLE IF NOT EXISTS migrations (
        id INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
        name VARCHAR(255) NOT NULL UNIQUE,
        executed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    const migrationName = "002_add_photo_comments";

    // Check if already run
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

    // Create photo_comments table
    await conn.execute(`
      CREATE TABLE IF NOT EXISTS photo_comments (
        id UUID PRIMARY KEY,
        photo_id UUID NOT NULL,
        user_id UUID NOT NULL,
        comment_text TEXT NOT NULL,
        like_count INT DEFAULT 0,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        deleted_at TIMESTAMP NULL,
        CONSTRAINT fk_comments_photo FOREIGN KEY (photo_id) REFERENCES photos(id) ON DELETE CASCADE,
        CONSTRAINT fk_comments_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      )
    `);

    await conn.execute("CREATE INDEX IF NOT EXISTS idx_photo_comments_photo ON photo_comments (photo_id)");
    await conn.execute("CREATE INDEX IF NOT EXISTS idx_photo_comments_user ON photo_comments (user_id)");

    await conn.execute("INSERT INTO migrations (name) VALUES (?)", [migrationName]);
    await conn.commit();
    console.log(`✓ Migration "${migrationName}" applied successfully.`);
  } catch (err) {
    await conn.rollback();
    console.error("✗ Migration failed:", err);
    process.exit(1);
  } finally {
    conn.release();
  }

  process.exit(0);
}

// Only run when invoked directly (not when imported by the migration runner)
if (require.main === module) { migrate(); }

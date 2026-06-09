import fs from "fs";
import path from "path";
import { getConnection, testConnection } from "./connection";

async function migrate() {
  const connected = await testConnection();
  if (!connected) {
    console.error("Cannot run migrations — database connection failed.");
    process.exit(1);
  }

  const conn = await getConnection();

  try {
    // Create migrations tracking table
    await conn.execute(`
      CREATE TABLE IF NOT EXISTS migrations (
        id INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
        name VARCHAR(255) NOT NULL UNIQUE,
        executed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    const schemaPath = path.join(__dirname, "schema.sql");
    const migrationName = "001_initial_schema";

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

    const sql = fs.readFileSync(schemaPath, "utf-8");

    // Split on semicolons, strip comment-only lines within each block, keep actual SQL
    const statements = sql
      .split(";")
      .map((s) =>
        s
          .split("\n")
          .filter((line) => !line.trim().startsWith("--"))
          .join("\n")
          .trim()
      )
      .filter((s) => s.length > 0);

    await conn.beginTransaction();

    for (const stmt of statements) {
      await conn.execute(stmt);
    }

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

migrate();

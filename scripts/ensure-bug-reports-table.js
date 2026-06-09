// Simple check script — plain JS, CommonJS
require('dotenv').config();
const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

async function main() {
  const client = await pool.connect();
  try {
    const res = await client.query(
      "SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'bug_reports'"
    );
    if (res.rows.length > 0) {
      console.log('✓ bug_reports table EXISTS');
    } else {
      console.log('✗ bug_reports table MISSING — creating now...');
      await client.query(`
        CREATE TABLE IF NOT EXISTS bug_reports (
          id                 UUID          PRIMARY KEY,
          reporter_id        UUID          REFERENCES users(id) ON DELETE SET NULL,
          category           VARCHAR(100)  NOT NULL,
          severity           VARCHAR(10)   NOT NULL,
          affected_feature   VARCHAR(200),
          steps_to_reproduce TEXT          NOT NULL,
          expected_behavior  TEXT          NOT NULL,
          actual_behavior    TEXT          NOT NULL,
          screenshot_urls    JSONB         NOT NULL DEFAULT '[]',
          status             VARCHAR(20)   NOT NULL DEFAULT 'open',
          created_at         TIMESTAMP     DEFAULT CURRENT_TIMESTAMP,
          CONSTRAINT chk_bug_severity CHECK (severity IN ('low', 'medium', 'high', 'critical')),
          CONSTRAINT chk_bug_status   CHECK (status IN ('open', 'in_progress', 'resolved', 'wont_fix'))
        )
      `);
      await client.query(`CREATE INDEX IF NOT EXISTS idx_bug_reports_status     ON bug_reports (status)`);
      await client.query(`CREATE INDEX IF NOT EXISTS idx_bug_reports_reporter   ON bug_reports (reporter_id)`);
      await client.query(`CREATE INDEX IF NOT EXISTS idx_bug_reports_created_at ON bug_reports (created_at DESC)`);

      // Track in migrations table
      await client.query(
        "INSERT INTO migrations (name) VALUES ($1) ON CONFLICT (name) DO NOTHING",
        ['012_bug_reports']
      );
      console.log('✓ bug_reports table CREATED');
    }
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch(e => { console.error(e); process.exit(1); });

import { query } from "../connection";

/**
 * Migration 012: Add bug_reports table for in-app bug reporting.
 */
export async function up(): Promise<void> {
  await query(`
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

  await query(`CREATE INDEX IF NOT EXISTS idx_bug_reports_status     ON bug_reports (status)`);
  await query(`CREATE INDEX IF NOT EXISTS idx_bug_reports_reporter   ON bug_reports (reporter_id)`);
  await query(`CREATE INDEX IF NOT EXISTS idx_bug_reports_created_at ON bug_reports (created_at DESC)`);

  console.log("Migration 012: bug_reports table created.");
}

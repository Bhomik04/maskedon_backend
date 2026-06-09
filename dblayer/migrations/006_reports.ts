import { query } from "../connection";

/**
 * Migration 006: Add reports table for user/event/photo flagging.
 */
export async function up(): Promise<void> {
  await query(`
    CREATE TABLE IF NOT EXISTS reports (
      id           UUID         PRIMARY KEY,
      reporter_id  UUID         NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      target_type  VARCHAR(20)  NOT NULL,
      target_id    UUID         NOT NULL,
      reason       VARCHAR(50)  NOT NULL,
      description  TEXT,
      status       VARCHAR(20)  NOT NULL DEFAULT 'open',
      created_at   TIMESTAMP    DEFAULT CURRENT_TIMESTAMP,
      CONSTRAINT chk_report_target_type CHECK (target_type IN ('user', 'event', 'photo')),
      CONSTRAINT chk_report_reason      CHECK (reason IN ('spam','harassment','fake_event','inappropriate_content','underage','other')),
      CONSTRAINT chk_report_status      CHECK (status IN ('open','reviewed','resolved','dismissed')),
      CONSTRAINT uq_report_per_user     UNIQUE (reporter_id, target_type, target_id)
    )
  `);

  await query(`CREATE INDEX IF NOT EXISTS idx_reports_target ON reports (target_type, target_id)`);
  await query(`CREATE INDEX IF NOT EXISTS idx_reports_status ON reports (status)`);

  console.log("Migration 006: reports table created.");
}

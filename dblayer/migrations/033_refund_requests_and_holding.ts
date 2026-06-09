import { query } from "../connection";

export async function up(): Promise<void> {
  // 1. Create global platform settings table (for global commission rate & toggle)
  await query(`
    CREATE TABLE IF NOT EXISTS platform_settings (
      key VARCHAR(100) PRIMARY KEY,
      value VARCHAR(255) NOT NULL,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // Seed default settings
  await query(`
    INSERT INTO platform_settings (key, value)
    VALUES 
      ('commission_rate_percent', '12.0'),
      ('commission_enabled', 'true')
    ON CONFLICT (key) DO NOTHING
  `);

  // 2. Add commission override column to users table
  await query(`
    ALTER TABLE users 
    ADD COLUMN IF NOT EXISTS commission_override_rate NUMERIC(5,2) DEFAULT NULL
  `);

  // 3. Create refund_requests table with review statuses
  await query(`
    CREATE TABLE IF NOT EXISTS refund_requests (
      id UUID PRIMARY KEY,
      payment_id UUID NOT NULL REFERENCES payments(id) ON DELETE CASCADE,
      event_id UUID NOT NULL REFERENCES events(id) ON DELETE CASCADE,
      user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      amount INTEGER NOT NULL, -- in paisa
      reason TEXT,
      status VARCHAR(20) NOT NULL DEFAULT 'pending_review',
      admin_note TEXT,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      CONSTRAINT chk_refund_requests_status CHECK (status IN ('pending_review', 'approved', 'rejected'))
    )
  `);

  await query(`CREATE INDEX IF NOT EXISTS idx_refund_requests_status ON refund_requests (status)`);
  await query(`CREATE INDEX IF NOT EXISTS idx_refund_requests_event_id ON refund_requests (event_id)`);
}

export async function down(): Promise<void> {
  await query(`DROP TABLE IF EXISTS refund_requests`);
  await query(`ALTER TABLE users DROP COLUMN IF EXISTS commission_override_rate`);
  await query(`DROP TABLE IF EXISTS platform_settings`);
}

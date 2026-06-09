import { query } from "../connection";

export async function up(): Promise<void> {
  await query(`
    CREATE TABLE IF NOT EXISTS refund_jobs (
      id UUID PRIMARY KEY,
      payment_id UUID NOT NULL UNIQUE REFERENCES payments(id) ON DELETE CASCADE,
      refund_amount INTEGER NOT NULL,
      status VARCHAR(20) NOT NULL DEFAULT 'pending',
      attempt_count INTEGER NOT NULL DEFAULT 0,
      last_error TEXT NULL,
      provider_refund_id VARCHAR(100) NULL,
      next_retry_at TIMESTAMP NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      CONSTRAINT chk_refund_jobs_status CHECK (status IN ('pending', 'processing', 'retrying', 'succeeded', 'failed'))
    )
  `);

  await query(`CREATE INDEX IF NOT EXISTS idx_refund_jobs_status_next_retry ON refund_jobs (status, next_retry_at)`);
  await query(`CREATE INDEX IF NOT EXISTS idx_refund_jobs_payment_id ON refund_jobs (payment_id)`);

  await query(`
    CREATE TABLE IF NOT EXISTS host_payouts (
      id UUID PRIMARY KEY,
      event_id UUID NOT NULL UNIQUE REFERENCES events(id) ON DELETE CASCADE,
      host_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      gross_amount INTEGER NOT NULL,
      platform_fee INTEGER NOT NULL,
      net_amount INTEGER NOT NULL,
      status VARCHAR(20) NOT NULL DEFAULT 'pending',
      provider_transfer_id VARCHAR(100) NULL,
      failure_reason TEXT NULL,
      attempt_count INTEGER NOT NULL DEFAULT 0,
      last_error TEXT NULL,
      next_retry_at TIMESTAMP NULL,
      settled_at TIMESTAMP NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      CONSTRAINT chk_host_payouts_status CHECK (status IN ('pending', 'processing', 'paid', 'failed', 'retrying'))
    )
  `);

  await query(`CREATE INDEX IF NOT EXISTS idx_host_payouts_status_next_retry ON host_payouts (status, next_retry_at)`);
  await query(`CREATE INDEX IF NOT EXISTS idx_host_payouts_host_id ON host_payouts (host_id)`);

  await query(`
    CREATE TABLE IF NOT EXISTS host_payout_items (
      id UUID PRIMARY KEY,
      host_payout_id UUID NOT NULL REFERENCES host_payouts(id) ON DELETE CASCADE,
      payment_id UUID NOT NULL REFERENCES payments(id) ON DELETE CASCADE,
      amount INTEGER NOT NULL,
      platform_fee INTEGER NOT NULL,
      net_amount INTEGER NOT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      CONSTRAINT uq_host_payout_item UNIQUE (host_payout_id, payment_id)
    )
  `);

  await query(`CREATE INDEX IF NOT EXISTS idx_host_payout_items_payout_id ON host_payout_items (host_payout_id)`);
}

export async function down(): Promise<void> {
  await query(`DROP TABLE IF EXISTS host_payout_items`);
  await query(`DROP TABLE IF EXISTS host_payouts`);
  await query(`DROP TABLE IF EXISTS refund_jobs`);
}

if (require.main === module) {
  up().then(() => process.exit(0)).catch((err) => { console.error(err); process.exit(1); });
}
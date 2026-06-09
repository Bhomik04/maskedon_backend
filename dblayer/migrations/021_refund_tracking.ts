import { query } from "../connection";

/**
 * Migration 021 — Refund Tracking
 *
 * Adds columns to record real Razorpay refund details and guest-initiated
 * cancellations, and expands the status constraint to include
 * 'partial_refund' and 'refund_failed'.
 */

export async function up(): Promise<void> {
  // Add refund tracking columns
  await query(`ALTER TABLE payments ADD COLUMN IF NOT EXISTS refunded_amount INTEGER NULL`);
  await query(`ALTER TABLE payments ADD COLUMN IF NOT EXISTS refund_razorpay_id VARCHAR(100) NULL`);

  // Expand status CHECK constraint to include partial_refund and refund_failed
  await query(`ALTER TABLE payments DROP CONSTRAINT IF EXISTS chk_payments_status`);
  await query(`
    ALTER TABLE payments ADD CONSTRAINT chk_payments_status
    CHECK (status IN ('initiated', 'pending', 'completed', 'failed', 'refunded', 'partial_refund', 'refund_failed'))
  `);

  console.log("Migration 021: Refund tracking columns and expanded status constraint added.");
}

async function down(): Promise<void> {
  await query(`ALTER TABLE payments DROP COLUMN IF EXISTS refunded_amount`);
  await query(`ALTER TABLE payments DROP COLUMN IF EXISTS refund_razorpay_id`);
  await query(`ALTER TABLE payments DROP CONSTRAINT IF EXISTS chk_payments_status`);
  await query(`
    ALTER TABLE payments ADD CONSTRAINT chk_payments_status
    CHECK (status IN ('initiated', 'pending', 'completed', 'failed', 'refunded'))
  `);
  console.log("Migration 021: Rolled back.");
}

if (require.main === module) {
  up().then(() => process.exit(0)).catch((err) => { console.error(err); process.exit(1); });
}

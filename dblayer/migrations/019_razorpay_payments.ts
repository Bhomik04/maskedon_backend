import { query } from "../connection";

/**
 * Migration 019 — Razorpay Payment Gateway
 *
 * Upgrades the payments table from mock to real Razorpay:
 * - Adds razorpay_order_id, razorpay_payment_id, razorpay_signature columns
 * - Updates the status constraint to include 'initiated' and 'failed' states
 * - Adds unique partial indexes to prevent double-capture
 */

export async function up() {
  // Add Razorpay-specific columns
  await query(`ALTER TABLE payments ADD COLUMN IF NOT EXISTS razorpay_order_id VARCHAR(100) NULL`);
  await query(`ALTER TABLE payments ADD COLUMN IF NOT EXISTS razorpay_payment_id VARCHAR(100) NULL`);
  await query(`ALTER TABLE payments ADD COLUMN IF NOT EXISTS razorpay_signature VARCHAR(200) NULL`);

  // Drop the old status constraint and replace with one that includes 'initiated' and 'failed'
  await query(`ALTER TABLE payments DROP CONSTRAINT IF EXISTS chk_payments_status`);
  await query(`
    ALTER TABLE payments ADD CONSTRAINT chk_payments_status
    CHECK (status IN ('initiated', 'pending', 'completed', 'failed', 'refunded'))
  `);

  // Unique partial indexes prevent double-capture / double-admission
  await query(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_payments_razorpay_order
    ON payments (razorpay_order_id)
    WHERE razorpay_order_id IS NOT NULL
  `);
  await query(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_payments_razorpay_payment
    ON payments (razorpay_payment_id)
    WHERE razorpay_payment_id IS NOT NULL
  `);

  console.log("Migration 019: Razorpay payment columns and constraints added.");
}

async function down() {
  await query(`DROP INDEX IF EXISTS idx_payments_razorpay_order`);
  await query(`DROP INDEX IF EXISTS idx_payments_razorpay_payment`);
  await query(`ALTER TABLE payments DROP COLUMN IF EXISTS razorpay_order_id`);
  await query(`ALTER TABLE payments DROP COLUMN IF EXISTS razorpay_payment_id`);
  await query(`ALTER TABLE payments DROP COLUMN IF EXISTS razorpay_signature`);
  await query(`ALTER TABLE payments DROP CONSTRAINT IF EXISTS chk_payments_status`);
  await query(`
    ALTER TABLE payments ADD CONSTRAINT chk_payments_status
    CHECK (status IN ('pending', 'completed', 'refunded'))
  `);
  console.log("Migration 019: Rolled back.");
}

if (require.main === module) { up().then(() => process.exit(0)).catch((err) => { console.error(err); process.exit(1); }); }

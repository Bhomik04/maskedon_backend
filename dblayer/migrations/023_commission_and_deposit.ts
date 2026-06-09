import { query } from "../connection";

export async function up(): Promise<void> {
  // Add commission rate and deposit tracking to events
  await query(
    `ALTER TABLE events
       ADD COLUMN host_commission_rate DECIMAL(5,2) NOT NULL DEFAULT 12.50,
       ADD COLUMN deposit_amount       INT           NOT NULL DEFAULT 0,
       ADD COLUMN deposit_status       VARCHAR(20)   NOT NULL DEFAULT 'not_required',
       ADD COLUMN deposit_payment_id   VARCHAR(255)  DEFAULT NULL`,
    []
  );

  await query(
    `ALTER TABLE events
       ADD CONSTRAINT chk_events_deposit_status
         CHECK (deposit_status IN ('not_required','pending','paid','refunded'))`,
    []
  );

  // Add platform fee and payment type to payments
  await query(
    `ALTER TABLE payments
       ADD COLUMN platform_fee  INT          NOT NULL DEFAULT 0,
       ADD COLUMN payment_type  VARCHAR(20)  NOT NULL DEFAULT 'ticket'`,
    []
  );

  await query(
    `ALTER TABLE payments
       ADD CONSTRAINT chk_payments_payment_type
         CHECK (payment_type IN ('ticket','deposit'))`,
    []
  );

  console.log("Migration 023: host commission rate, deposit tracking, and platform_fee columns added.");
}

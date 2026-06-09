import { query } from "../connection";

/**
 * Migration 028 — Host KYC Verification
 *
 * Creates `host_verifications` table storing PAN card details,
 * PAN image URL, and bank account details for hosts.
 * One row per user (UNIQUE on user_id). Hosts re-submit by updating
 * the same row (status resets to 'pending').
 */
export async function up(): Promise<void> {
  await query(`
    CREATE TABLE IF NOT EXISTS host_verifications (
      id                    UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id               UUID        UNIQUE NOT NULL REFERENCES users(id) ON DELETE CASCADE,

      -- PAN card details
      pan_number            VARCHAR(10) NOT NULL,
      pan_name              VARCHAR(200) NOT NULL,
      pan_image_url         VARCHAR(500) NOT NULL,

      -- Bank account details
      bank_account_number   VARCHAR(30) NOT NULL,
      bank_ifsc             VARCHAR(11) NOT NULL,
      bank_account_name     VARCHAR(200) NOT NULL,
      bank_name             VARCHAR(100) NOT NULL,

      -- Review state
      status                VARCHAR(20) NOT NULL DEFAULT 'pending'
                            CHECK (status IN ('pending', 'approved', 'rejected', 'flagged')),
      rejection_reason      TEXT        NULL,
      auto_flags            JSONB       NULL,

      submitted_at          TIMESTAMP   NOT NULL DEFAULT NOW(),
      reviewed_at           TIMESTAMP   NULL,
      reviewed_by           UUID        NULL REFERENCES users(id) ON DELETE SET NULL,

      created_at            TIMESTAMP   NOT NULL DEFAULT NOW(),
      updated_at            TIMESTAMP   NOT NULL DEFAULT NOW()
    )
  `);

  await query(`
    CREATE INDEX IF NOT EXISTS idx_host_verifications_user   ON host_verifications(user_id)
  `);
  await query(`
    CREATE INDEX IF NOT EXISTS idx_host_verifications_status ON host_verifications(status)
  `);
}

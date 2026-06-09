import { query } from "../connection";

export async function up(): Promise<void> {
  await query(
    `ALTER TABLE users
      ADD COLUMN IF NOT EXISTS is_email_verified BOOLEAN NOT NULL DEFAULT FALSE,
      ADD COLUMN IF NOT EXISTS date_of_birth DATE NULL,
      ADD COLUMN IF NOT EXISTS id_verification_status VARCHAR(20) NOT NULL DEFAULT 'not_submitted',
      ADD COLUMN IF NOT EXISTS id_verification_submitted_at TIMESTAMP NULL,
      ADD COLUMN IF NOT EXISTS banner_url TEXT DEFAULT NULL`,
    []
  );

  await query(`UPDATE users SET is_email_verified = TRUE WHERE deleted_at IS NULL`, []);

  await query(`ALTER TABLE users DROP CONSTRAINT IF EXISTS chk_users_id_verification_status`, []);

  await query(
    `ALTER TABLE users
      ADD CONSTRAINT chk_users_id_verification_status
      CHECK (id_verification_status IN ('not_submitted','pending','verified','rejected'))`,
    []
  );

  await query(
    `CREATE TABLE IF NOT EXISTS email_verification_tokens (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      token_hash TEXT NOT NULL UNIQUE,
      expires_at TIMESTAMPTZ NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`,
    []
  );

  await query(`CREATE INDEX IF NOT EXISTS idx_evtokens_token_hash ON email_verification_tokens(token_hash)`, []);
  await query(`CREATE INDEX IF NOT EXISTS idx_evtokens_user_id ON email_verification_tokens(user_id)`, []);

  await query(
    `CREATE TABLE IF NOT EXISTS password_reset_tokens (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      token_hash TEXT NOT NULL UNIQUE,
      expires_at TIMESTAMPTZ NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`,
    []
  );

  await query(`CREATE INDEX IF NOT EXISTS idx_prtokens_token_hash ON password_reset_tokens(token_hash)`, []);
  await query(`CREATE INDEX IF NOT EXISTS idx_prtokens_user_id ON password_reset_tokens(user_id)`, []);
}
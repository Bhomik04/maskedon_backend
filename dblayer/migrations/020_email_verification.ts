import { query } from "../connection";

export async function up(): Promise<void> {
  // Add is_email_verified to users.
  // Existing users are marked verified so they aren't locked out — they were
  // already verified through the previous Supabase Auth flow.
  await query(`
    ALTER TABLE users
    ADD COLUMN IF NOT EXISTS is_email_verified BOOLEAN NOT NULL DEFAULT FALSE
  `, []);

  await query(`UPDATE users SET is_email_verified = TRUE WHERE deleted_at IS NULL`, []);

  // Table for email address verification tokens (sent when registering / resend)
  await query(`
    CREATE TABLE IF NOT EXISTS email_verification_tokens (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      token_hash TEXT NOT NULL UNIQUE,
      expires_at TIMESTAMPTZ NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `, []);

  await query(`
    CREATE INDEX IF NOT EXISTS idx_evtokens_token_hash ON email_verification_tokens(token_hash)
  `, []);
  await query(`
    CREATE INDEX IF NOT EXISTS idx_evtokens_user_id ON email_verification_tokens(user_id)
  `, []);

  // Table for password-reset tokens (sent via forgot-password flow)
  await query(`
    CREATE TABLE IF NOT EXISTS password_reset_tokens (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      token_hash TEXT NOT NULL UNIQUE,
      expires_at TIMESTAMPTZ NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `, []);

  await query(`
    CREATE INDEX IF NOT EXISTS idx_prtokens_token_hash ON password_reset_tokens(token_hash)
  `, []);
  await query(`
    CREATE INDEX IF NOT EXISTS idx_prtokens_user_id ON password_reset_tokens(user_id)
  `, []);
}

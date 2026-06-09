import { query } from "./connection";

// ── Email Verification Tokens ────────────────────────────────────────────────

export async function createEmailVerificationToken(
  userId: string,
  tokenHash: string,
  expiresAt: Date
): Promise<void> {
  await query(
    `INSERT INTO email_verification_tokens (user_id, token_hash, expires_at)
     VALUES (?, ?, ?)`,
    [userId, tokenHash, expiresAt]
  );
}

export async function findEmailVerificationToken(
  tokenHash: string
): Promise<{ user_id: string; expires_at: Date } | null> {
  const result = await query<{ user_id: string; expires_at: Date }>(
    `SELECT user_id, expires_at FROM email_verification_tokens WHERE token_hash = ?`,
    [tokenHash]
  );
  return result.rows[0] || null;
}

export async function deleteEmailVerificationTokensByUser(userId: string): Promise<void> {
  await query(`DELETE FROM email_verification_tokens WHERE user_id = ?`, [userId]);
}

export async function markUserEmailVerified(userId: string): Promise<void> {
  await query(`UPDATE users SET is_email_verified = TRUE WHERE id = ?`, [userId]);
}

// ── Password Reset Tokens ────────────────────────────────────────────────────

export async function createPasswordResetToken(
  userId: string,
  tokenHash: string,
  expiresAt: Date
): Promise<void> {
  await query(
    `INSERT INTO password_reset_tokens (user_id, token_hash, expires_at)
     VALUES (?, ?, ?)`,
    [userId, tokenHash, expiresAt]
  );
}

export async function findPasswordResetToken(
  tokenHash: string
): Promise<{ user_id: string; expires_at: Date } | null> {
  const result = await query<{ user_id: string; expires_at: Date }>(
    `SELECT user_id, expires_at FROM password_reset_tokens WHERE token_hash = ?`,
    [tokenHash]
  );
  return result.rows[0] || null;
}

export async function deletePasswordResetTokensByUser(userId: string): Promise<void> {
  await query(`DELETE FROM password_reset_tokens WHERE user_id = ?`, [userId]);
}

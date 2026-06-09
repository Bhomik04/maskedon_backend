import { query } from "./connection";
import { v4 as uuidv4 } from "uuid";

// ============================================
// USER QUERIES
// ============================================

export interface UserRow {
  id: string;
  email: string;
  username: string;
  password_hash: string;
  display_name: string;
  bio: string | null;
  avatar_url: string | null;
  banner_url: string | null;
  social_rating: number;
  total_ratings: number;
  events_hosted: number;
  events_attended: number;
  is_email_verified: boolean;
  date_of_birth: Date | null;
  id_verification_status: "not_submitted" | "pending" | "verified" | "rejected";
  id_verification_submitted_at: Date | null;
  created_at: Date;
  updated_at: Date;
  deleted_at: Date | null;
}

const USER_SELECT_BASE = `id, email, username, password_hash, display_name, bio, avatar_url, banner_url,
  social_rating, total_ratings, events_hosted, events_attended, is_email_verified,
  date_of_birth, id_verification_status, id_verification_submitted_at,
  created_at, updated_at, deleted_at`;

/** Fields returned for the authenticated user's own profile (includes email). */
export type SelfUser = Omit<UserRow, "password_hash">;

/** Fields returned for any other user's public profile (no password_hash, no email). */
export type PublicUser = Omit<UserRow, "password_hash" | "email">;

export async function createUser(
  email: string,
  username: string,
  passwordHash: string,
  displayName: string,
  dateOfBirth?: string
): Promise<UserRow> {
  const id = uuidv4();
  await query(
    `INSERT INTO users (id, email, username, password_hash, display_name, date_of_birth)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [id, email, username, passwordHash, displayName, dateOfBirth ?? null]
  );
  const result = await query<UserRow>(
    `SELECT ${USER_SELECT_BASE} FROM users WHERE id = ?`,
    [id]
  );
  return result.rows[0]!;
}

export async function findUserByEmail(
  email: string
): Promise<UserRow | null> {
  const result = await query<UserRow>(
    `SELECT ${USER_SELECT_BASE} FROM users WHERE email = ? AND deleted_at IS NULL`,
    [email]
  );
  return result.rows[0] || null;
}

/**
 * Hard-delete a user row by email.
 * Only used to clean up orphaned registration records (user created in our DB
 * but Supabase Auth signup failed before the email was sent). These rows have
 * no associated data (user never verified or logged in), so a hard delete is safe.
 */
export async function hardDeleteUserByEmail(email: string): Promise<void> {
  await query(`DELETE FROM users WHERE email = ?`, [email]);
}

export async function findUserByUsername(
  username: string
): Promise<UserRow | null> {
  const result = await query<UserRow>(
    `SELECT ${USER_SELECT_BASE} FROM users WHERE username = ? AND deleted_at IS NULL`,
    [username]
  );
  return result.rows[0] || null;
}

export async function findUserById(id: string): Promise<UserRow | null> {
  const result = await query<UserRow>(
    `SELECT ${USER_SELECT_BASE} FROM users WHERE id = ? AND deleted_at IS NULL`,
    [id]
  );
  return result.rows[0] || null;
}

export async function getSelfProfile(id: string): Promise<SelfUser | null> {
  const result = await query<SelfUser>(
    `SELECT id, email, username, display_name, bio, avatar_url, banner_url,
            social_rating, total_ratings, events_hosted, events_attended,
            is_email_verified, date_of_birth, id_verification_status,
            id_verification_submitted_at, created_at, updated_at, deleted_at
     FROM users WHERE id = ? AND deleted_at IS NULL`,
    [id]
  );
  return result.rows[0] || null;
}

export async function getPublicProfile(id: string): Promise<PublicUser | null> {
  const result = await query<PublicUser>(
    `SELECT id, username, display_name, bio, avatar_url, banner_url,
            social_rating, total_ratings, events_hosted, events_attended,
            created_at, updated_at, deleted_at
     FROM users WHERE id = ? AND deleted_at IS NULL`,
    [id]
  );
  return result.rows[0] || null;
}

export async function updateUserProfile(
  id: string,
  fields: {
    display_name?: string;
    bio?: string;
    avatar_url?: string;
    banner_url?: string | null;
  }
): Promise<PublicUser | null> {
  const setClauses: string[] = [];
  const values: any[] = [];

  if (fields.display_name !== undefined) {
    setClauses.push(`display_name = ?`);
    values.push(fields.display_name);
  }
  if (fields.bio !== undefined) {
    setClauses.push(`bio = ?`);
    values.push(fields.bio);
  }
  if (fields.avatar_url !== undefined) {
    setClauses.push(`avatar_url = ?`);
    values.push(fields.avatar_url);
  }
  if (fields.banner_url !== undefined) {
    setClauses.push(`banner_url = ?`);
    values.push(fields.banner_url);
  }

  if (setClauses.length === 0) return getPublicProfile(id);

  values.push(id);
  await query(
    `UPDATE users SET ${setClauses.join(", ")}
     WHERE id = ? AND deleted_at IS NULL`,
    values
  );
  return getPublicProfile(id);
}

// ============================================
// REFRESH TOKEN QUERIES
// ============================================

export async function storeRefreshToken(
  userId: string,
  tokenHash: string,
  expiresAt: Date
): Promise<void> {
  const id = uuidv4();
  await query(
    `INSERT INTO refresh_tokens (id, user_id, token_hash, expires_at)
     VALUES (?, ?, ?, ?)`,
    [id, userId, tokenHash, expiresAt]
  );
}

export async function findRefreshToken(
  tokenHash: string
): Promise<{ id: string; user_id: string; expires_at: Date } | null> {
  const result = await query<{ id: string; user_id: string; expires_at: Date }>(
    `SELECT id, user_id, expires_at FROM refresh_tokens WHERE token_hash = ?`,
    [tokenHash]
  );
  return result.rows[0] || null;
}

export async function deleteRefreshToken(tokenHash: string): Promise<void> {
  await query(`DELETE FROM refresh_tokens WHERE token_hash = ?`, [tokenHash]);
}

export async function deleteAllRefreshTokensForUser(
  userId: string
): Promise<void> {
  await query(`DELETE FROM refresh_tokens WHERE user_id = ?`, [userId]);
}

export async function deleteExpiredRefreshTokens(): Promise<void> {
  await query(`DELETE FROM refresh_tokens WHERE expires_at < NOW()`, []);
}

export async function searchUsers(
  term: string,
  limit: number
): Promise<PublicUser[]> {
  const safeTerm = term.replace(/[%_\\]/g, (c) => `\\${c}`);
  const like = `%${safeTerm}%`;
  const safeLimit = Math.max(1, Math.min(limit, 50));

  // pg_trgm similarity for fuzzy, typo-tolerant ranked search.
  const result = await query<PublicUser>(
    `SELECT id, username, display_name, avatar_url, bio,
            social_rating, events_hosted, events_attended, created_at,
            GREATEST(similarity(username, ?), similarity(display_name, ?)) AS _rank
     FROM users
     WHERE deleted_at IS NULL
       AND (
         similarity(username, ?) > 0.1
         OR similarity(display_name, ?) > 0.1
         OR username ILIKE ?
         OR display_name ILIKE ?
       )
     ORDER BY _rank DESC, social_rating DESC
     LIMIT ?`,
    [term, term, term, term, like, like, safeLimit]
  );
  return result.rows;
}

export async function changeUserPassword(id: string, newHash: string): Promise<void> {
  await query(`UPDATE users SET password_hash = ? WHERE id = ?`, [newHash, id]);
}

export async function softDeleteUser(id: string): Promise<void> {
  await query(`UPDATE users SET deleted_at = NOW() WHERE id = ?`, [id]);
}

/** Mark a user's ID verification as 'pending' after document submission. */
export async function markIdVerificationSubmitted(userId: string): Promise<void> {
  await query(
    `UPDATE users
     SET id_verification_status = 'pending', id_verification_submitted_at = NOW()
     WHERE id = ? AND deleted_at IS NULL`,
    [userId]
  );
}

/** Returns the user's age in years, or null if date_of_birth is not set. */
export function calculateAge(dateOfBirth: Date | null): number | null {
  if (!dateOfBirth) return null;
  const today = new Date();
  const birth = new Date(dateOfBirth);
  let age = today.getFullYear() - birth.getFullYear();
  if (today < new Date(today.getFullYear(), birth.getMonth(), birth.getDate())) {
    age--;
  }
  return age;
}

import { query } from "./connection";
import { v4 as uuidv4 } from "uuid";

// ============================================
// TYPES
// ============================================

export type VerificationStatus = "pending" | "approved" | "rejected" | "flagged";

export interface HostVerificationRow {
  id: string;
  user_id: string;
  pan_number: string;
  pan_name: string;
  pan_image_url: string;
  aadhaar_number: string;
  aadhaar_name: string;
  aadhaar_image_url: string;
  bank_account_number: string;
  bank_ifsc: string;
  bank_account_name: string;
  bank_name: string;
  status: VerificationStatus;
  rejection_reason: string | null;
  auto_flags: string[] | null;
  submitted_at: Date;
  reviewed_at: Date | null;
  reviewed_by: string | null;
  created_at: Date;
  updated_at: Date;
}

// Safe public-facing view (masks sensitive fields)
export interface HostVerificationPublic {
  id: string;
  user_id: string;
  pan_name: string;
  pan_number_masked: string;   // e.g. ABCDE****F
  aadhaar_name: string;
  aadhaar_number_masked: string;
  bank_name: string;
  bank_account_name: string;
  bank_account_masked: string; // e.g. ******1234
  bank_ifsc: string;
  status: VerificationStatus;
  rejection_reason: string | null;
  auto_flags: string[] | null;
  submitted_at: Date;
  reviewed_at: Date | null;
}

// ============================================
// HELPERS
// ============================================

function maskPan(pan: string): string {
  if (pan.length !== 10) return "**********";
  return `${pan.slice(0, 5)}****${pan[9]}`;
}

function maskAccountNumber(acc: string): string {
  if (acc.length < 4) return "****";
  return `${"*".repeat(acc.length - 4)}${acc.slice(-4)}`;
}

function maskAadhaar(aadhaar: string): string {
  if (aadhaar.length !== 12) return "************";
  return `********${aadhaar.slice(-4)}`;
}

function toPublic(row: HostVerificationRow): HostVerificationPublic {
  return {
    id: row.id,
    user_id: row.user_id,
    pan_name: row.pan_name,
    pan_number_masked: maskPan(row.pan_number),
    aadhaar_name: row.aadhaar_name,
    aadhaar_number_masked: maskAadhaar(row.aadhaar_number),
    bank_name: row.bank_name,
    bank_account_name: row.bank_account_name,
    bank_account_masked: maskAccountNumber(row.bank_account_number),
    bank_ifsc: row.bank_ifsc,
    status: row.status,
    rejection_reason: row.rejection_reason,
    auto_flags: row.auto_flags,
    submitted_at: row.submitted_at,
    reviewed_at: row.reviewed_at,
  };
}

// ============================================
// QUERIES
// ============================================

export async function getHostVerification(
  userId: string
): Promise<HostVerificationPublic | null> {
  const { rows } = await query<HostVerificationRow>(
    `SELECT * FROM host_verifications WHERE user_id = ? LIMIT 1`,
    [userId]
  );
  return rows[0] ? toPublic(rows[0]) : null;
}

/** Admin-only: full row including raw PAN and account number */
export async function getHostVerificationRaw(
  userId: string
): Promise<HostVerificationRow | null> {
  const { rows } = await query<HostVerificationRow>(
    `SELECT * FROM host_verifications WHERE user_id = ? LIMIT 1`,
    [userId]
  );
  return rows[0] ?? null;
}

export async function createHostVerification(input: {
  userId: string;
  panNumber: string;
  panName: string;
  panImageUrl: string;
  aadhaarNumber: string;
  aadhaarName: string;
  aadhaarImageUrl: string;
  bankAccountNumber: string;
  bankIfsc: string;
  bankAccountName: string;
  bankName: string;
  autoFlags: string[] | null;
}): Promise<HostVerificationPublic> {
  const id = uuidv4();
  const flagsJson = input.autoFlags ? JSON.stringify(input.autoFlags) : null;
  const statusInit: VerificationStatus = input.autoFlags && input.autoFlags.length > 0 ? "flagged" : "pending";

  await query(
    `INSERT INTO host_verifications
      (id, user_id, pan_number, pan_name, pan_image_url,
       aadhaar_number, aadhaar_name, aadhaar_image_url,
       bank_account_number, bank_ifsc, bank_account_name, bank_name,
       status, auto_flags, submitted_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())`,
    [
      id,
      input.userId,
      input.panNumber.toUpperCase(),
      input.panName,
      input.panImageUrl,
      input.aadhaarNumber,
      input.aadhaarName,
      input.aadhaarImageUrl,
      input.bankAccountNumber,
      input.bankIfsc.toUpperCase(),
      input.bankAccountName,
      input.bankName,
      statusInit,
      flagsJson,
    ]
  );

  const row = await getHostVerificationRaw(input.userId);
  return toPublic(row!);
}

export async function updateHostVerification(input: {
  userId: string;
  panNumber: string;
  panName: string;
  panImageUrl: string;
  aadhaarNumber: string;
  aadhaarName: string;
  aadhaarImageUrl: string;
  bankAccountNumber: string;
  bankIfsc: string;
  bankAccountName: string;
  bankName: string;
  autoFlags: string[] | null;
}): Promise<HostVerificationPublic> {
  const flagsJson = input.autoFlags ? JSON.stringify(input.autoFlags) : null;
  const statusInit: VerificationStatus = input.autoFlags && input.autoFlags.length > 0 ? "flagged" : "pending";

  await query(
    `UPDATE host_verifications SET
       pan_number          = ?,
       pan_name            = ?,
       pan_image_url       = ?,
      aadhaar_number      = ?,
      aadhaar_name        = ?,
      aadhaar_image_url   = ?,
       bank_account_number = ?,
       bank_ifsc           = ?,
       bank_account_name   = ?,
       bank_name           = ?,
       status              = ?,
       auto_flags          = ?,
       rejection_reason    = NULL,
       reviewed_at         = NULL,
       reviewed_by         = NULL,
       submitted_at        = NOW(),
       updated_at          = NOW()
     WHERE user_id = ?`,
    [
      input.panNumber.toUpperCase(),
      input.panName,
      input.panImageUrl,
      input.aadhaarNumber,
      input.aadhaarName,
      input.aadhaarImageUrl,
      input.bankAccountNumber,
      input.bankIfsc.toUpperCase(),
      input.bankAccountName,
      input.bankName,
      statusInit,
      flagsJson,
      input.userId,
    ]
  );

  const row = await getHostVerificationRaw(input.userId);
  return toPublic(row!);
}

/** Admin: approve or reject a verification */
export async function reviewHostVerification(
  userId: string,
  reviewerId: string,
  status: "approved" | "rejected",
  rejectionReason?: string
): Promise<void> {
  await query(
    `UPDATE host_verifications SET
       status           = ?,
       rejection_reason = ?,
       reviewed_at      = NOW(),
       reviewed_by      = ?,
       updated_at       = NOW()
     WHERE user_id = ?`,
    [status, rejectionReason ?? null, reviewerId, userId]
  );
}

/** Admin: list all verifications by status */
export async function listHostVerifications(
  status?: VerificationStatus,
  limit = 50,
  offset = 0
): Promise<HostVerificationRow[]> {
  if (status) {
    const { rows } = await query<HostVerificationRow>(
      `SELECT * FROM host_verifications WHERE status = ? ORDER BY submitted_at ASC LIMIT ? OFFSET ?`,
      [status, limit, offset]
    );
    return rows;
  }
  const { rows } = await query<HostVerificationRow>(
    `SELECT * FROM host_verifications ORDER BY submitted_at ASC LIMIT ? OFFSET ?`,
    [limit, offset]
  );
  return rows;
}

export { toPublic as toPublicVerification };

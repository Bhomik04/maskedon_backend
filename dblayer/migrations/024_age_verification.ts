import { query } from "../connection";

export async function up(): Promise<void> {
  // Add date_of_birth and ID verification status to users
  await query(
    `ALTER TABLE users
       ADD COLUMN IF NOT EXISTS date_of_birth          DATE         NULL,
       ADD COLUMN IF NOT EXISTS id_verification_status VARCHAR(20)  NOT NULL DEFAULT 'not_submitted',
       ADD COLUMN IF NOT EXISTS id_verification_submitted_at TIMESTAMP NULL`,
    []
  );

  await query(
    `ALTER TABLE users
       DROP CONSTRAINT IF EXISTS chk_users_id_verification_status`,
    []
  );

  await query(
    `ALTER TABLE users
       ADD CONSTRAINT chk_users_id_verification_status
         CHECK (id_verification_status IN ('not_submitted','pending','verified','rejected'))`,
    []
  );

  console.log("Migration 024: date_of_birth and id_verification columns added to users.");
}

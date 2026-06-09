import { query } from "../connection";

/**
 * Migration 029 — Host KYC Aadhaar fields
 *
 * Adds Aadhaar identity fields to host_verifications so verification requires
 * PAN + Aadhaar + bank details.
 */
export async function up(): Promise<void> {
  await query(`
    ALTER TABLE host_verifications
      ADD COLUMN IF NOT EXISTS aadhaar_number VARCHAR(12),
      ADD COLUMN IF NOT EXISTS aadhaar_name VARCHAR(200),
      ADD COLUMN IF NOT EXISTS aadhaar_image_url VARCHAR(500)
  `);

  await query(`
    UPDATE host_verifications
    SET
      aadhaar_number = COALESCE(aadhaar_number, ''),
      aadhaar_name = COALESCE(aadhaar_name, pan_name),
      aadhaar_image_url = COALESCE(aadhaar_image_url, pan_image_url)
  `);

  await query(`
    ALTER TABLE host_verifications
      ALTER COLUMN aadhaar_number SET NOT NULL,
      ALTER COLUMN aadhaar_name SET NOT NULL,
      ALTER COLUMN aadhaar_image_url SET NOT NULL
  `);

  await query(`
    ALTER TABLE host_verifications
      DROP CONSTRAINT IF EXISTS chk_host_verifications_aadhaar_number
  `);

  await query(`
    ALTER TABLE host_verifications
      ADD CONSTRAINT chk_host_verifications_aadhaar_number
      CHECK (aadhaar_number ~ '^[0-9]{12}$')
  `);
}

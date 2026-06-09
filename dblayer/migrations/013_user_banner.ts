import { query } from "../connection";

export async function up() {
  await query(
    `ALTER TABLE users ADD COLUMN IF NOT EXISTS banner_url TEXT DEFAULT NULL`,
    []
  );
}

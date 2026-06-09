import { query } from "../connection";

export async function up(): Promise<void> {
  await query(`
    CREATE TABLE IF NOT EXISTS photo_saves (
      id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
      photo_id      UUID        NOT NULL REFERENCES photos(id) ON DELETE CASCADE,
      user_id       UUID        NOT NULL REFERENCES users(id)  ON DELETE CASCADE,
      created_at    TIMESTAMP   NOT NULL DEFAULT NOW(),
      UNIQUE (photo_id, user_id)
    )
  `);

  await query(`
    CREATE INDEX IF NOT EXISTS idx_photo_saves_user
      ON photo_saves (user_id, created_at DESC)
  `);

  await query(`
    CREATE INDEX IF NOT EXISTS idx_photo_saves_photo
      ON photo_saves (photo_id)
  `);
}

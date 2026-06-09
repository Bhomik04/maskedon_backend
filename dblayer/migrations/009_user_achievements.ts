import { query } from "../connection";

export async function up(): Promise<void> {
  await query(`
    CREATE TABLE IF NOT EXISTS user_achievements (
      id UUID PRIMARY KEY,
      user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      achievement_key VARCHAR(80) NOT NULL,
      achievement_name VARCHAR(120) NOT NULL,
      unlocked_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      CONSTRAINT uq_user_achievement UNIQUE (user_id, achievement_key)
    )
  `);

  await query(`
    CREATE INDEX IF NOT EXISTS idx_user_achievements_user
    ON user_achievements (user_id)
  `);

  await query(`
    CREATE INDEX IF NOT EXISTS idx_user_achievements_unlocked_at
    ON user_achievements (unlocked_at DESC)
  `);
}

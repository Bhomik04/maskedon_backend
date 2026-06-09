import { query } from "../connection";

/**
 * Migration 003: Replace individual ratings with crowd ratings system.
 *
 * New system: After each event, every participant rates the overall crowd/vibe (1-5).
 * The average crowd rating for a event becomes each participant's rating for that event.
 * A user's social_rating = average of all their event crowd averages.
 */
export async function up(): Promise<void> {
  // Create the crowd_ratings table
  await query(`
    CREATE TABLE IF NOT EXISTS crowd_ratings (
      id UUID PRIMARY KEY,
      user_id UUID NOT NULL,
      event_id UUID NOT NULL,
      score SMALLINT NOT NULL CHECK (score >= 1 AND score <= 5),
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      CONSTRAINT uq_crowd_rating_user_event UNIQUE (user_id, event_id),
      CONSTRAINT fk_crowd_ratings_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
      CONSTRAINT fk_crowd_ratings_event FOREIGN KEY (event_id) REFERENCES events(id) ON DELETE CASCADE
    )
  `);

  await query(`CREATE INDEX IF NOT EXISTS idx_crowd_ratings_event ON crowd_ratings (event_id)`);
  await query(`CREATE INDEX IF NOT EXISTS idx_crowd_ratings_user ON crowd_ratings (user_id)`);

  // Reset all user ratings since the old system is being replaced
  await query(`UPDATE users SET social_rating = 0, total_ratings = 0`);

  console.log("Migration 003: crowd_ratings table created, user ratings reset.");
}

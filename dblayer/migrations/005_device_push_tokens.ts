import { query } from "../connection";

/**
 * Migration 005: Add device_push_tokens table for FCM / APNs push notifications.
 *
 * Each row stores a single device token for a user.  A user may have many devices.
 * Tokens are globally unique (UNIQUE constraint on `token`) so the same physical
 * device is never duplicated even if the user re-registers.
 */
export async function up(): Promise<void> {
  await query(`
    CREATE TABLE IF NOT EXISTS device_push_tokens (
      id         UUID         PRIMARY KEY,
      user_id    UUID         NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      token      TEXT         NOT NULL,
      platform   VARCHAR(10)  NOT NULL,
      created_at TIMESTAMP    DEFAULT CURRENT_TIMESTAMP,
      CONSTRAINT chk_platform CHECK (platform IN ('fcm', 'apns')),
      CONSTRAINT uq_push_token UNIQUE (token)
    )
  `);

  await query(`CREATE INDEX IF NOT EXISTS idx_push_tokens_user ON device_push_tokens (user_id)`);

  console.log("Migration 005: device_push_tokens table created.");
}

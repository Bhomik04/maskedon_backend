import { query } from "../connection";

export async function up() {
  await query(
    `CREATE TABLE IF NOT EXISTS conversations (
       id UUID PRIMARY KEY,
       event_id UUID NOT NULL,
       guest_id UUID NOT NULL,
       host_id UUID NOT NULL,
       created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
       CONSTRAINT uq_conversations_event_guest UNIQUE (event_id, guest_id),
       CONSTRAINT fk_conversations_event FOREIGN KEY (event_id) REFERENCES events(id) ON DELETE CASCADE,
       CONSTRAINT fk_conversations_guest FOREIGN KEY (guest_id) REFERENCES users(id) ON DELETE CASCADE,
       CONSTRAINT fk_conversations_host FOREIGN KEY (host_id) REFERENCES users(id) ON DELETE CASCADE
     )`,
    []
  );

  await query(
    `CREATE INDEX IF NOT EXISTS idx_conversations_event ON conversations (event_id)`,
    []
  );

  await query(
    `CREATE INDEX IF NOT EXISTS idx_conversations_guest ON conversations (guest_id)`,
    []
  );

  await query(
    `CREATE INDEX IF NOT EXISTS idx_conversations_host ON conversations (host_id)`,
    []
  );

  await query(
    `CREATE TABLE IF NOT EXISTS messages (
       id UUID PRIMARY KEY,
       conversation_id UUID NOT NULL,
       sender_id UUID NOT NULL,
       body TEXT NOT NULL,
       created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
       read_at TIMESTAMP NULL,
       CONSTRAINT chk_messages_body_length CHECK (char_length(body) <= 2000),
       CONSTRAINT fk_messages_conversation FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE,
       CONSTRAINT fk_messages_sender FOREIGN KEY (sender_id) REFERENCES users(id) ON DELETE CASCADE
     )`,
    []
  );

  await query(
    `CREATE INDEX IF NOT EXISTS idx_messages_conversation_created ON messages (conversation_id, created_at DESC)`,
    []
  );

  await query(
    `CREATE INDEX IF NOT EXISTS idx_messages_conversation_read ON messages (conversation_id, read_at)`,
    []
  );

  await query(
    `CREATE TABLE IF NOT EXISTS event_announcements (
       id UUID PRIMARY KEY,
       event_id UUID NOT NULL,
       host_id UUID NOT NULL,
       body TEXT NOT NULL,
       created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
       CONSTRAINT chk_event_announcements_body_length CHECK (char_length(body) <= 2000),
       CONSTRAINT fk_event_announcements_event FOREIGN KEY (event_id) REFERENCES events(id) ON DELETE CASCADE,
       CONSTRAINT fk_event_announcements_host FOREIGN KEY (host_id) REFERENCES users(id) ON DELETE CASCADE
     )`,
    []
  );

  await query(
    `CREATE INDEX IF NOT EXISTS idx_event_announcements_event_created ON event_announcements (event_id, created_at DESC)`,
    []
  );
}
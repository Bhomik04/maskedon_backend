import { query } from "../connection";

export async function up(): Promise<void> {
  // Add a cryptographically random one-time QR token to every attendee row
  await query(
    `ALTER TABLE event_attendees
       ADD COLUMN qr_token      VARCHAR(64)  NULL UNIQUE,
       ADD COLUMN checked_in_at TIMESTAMP    NULL`,
    []
  );

  console.log("Migration 026: qr_token and checked_in_at added to event_attendees.");
}

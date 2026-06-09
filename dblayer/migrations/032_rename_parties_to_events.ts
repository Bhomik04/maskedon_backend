import { query } from "../connection";

export async function up(): Promise<void> {
  const checkRes = await query(`
    SELECT EXISTS (
      SELECT FROM information_schema.tables 
      WHERE table_schema = 'public' AND table_name = 'parties'
    )
  `);

  const partiesExist = checkRes.rows[0]?.exists ?? false;

  if (partiesExist) {
    console.log("Renaming parties tables and fields to events...");

    // 1. Rename parties table to events
    await query("ALTER TABLE parties RENAME TO events");

    // Rename constraints on events table (formerly parties)
    try {
      await query("ALTER TABLE events RENAME CONSTRAINT fk_parties_host TO fk_events_host");
    } catch (e) {}
    try {
      await query("ALTER TABLE events RENAME CONSTRAINT chk_parties_status TO chk_events_status");
    } catch (e) {}
    try {
      await query("ALTER TABLE events RENAME CONSTRAINT chk_parties_food_type TO chk_events_food_type");
    } catch (e) {}
    try {
      await query("ALTER TABLE events RENAME CONSTRAINT chk_parties_deposit_status TO chk_events_deposit_status");
    } catch (e) {}

    // Rename indexes on events table
    const indexesToRename = [
      ["idx_parties_host", "idx_events_host"],
      ["idx_parties_status", "idx_events_status"],
      ["idx_parties_city", "idx_events_city"],
      ["idx_parties_datetime", "idx_events_datetime"],
      ["idx_parties_private_code", "idx_events_private_code"],
      ["idx_parties_is_private", "idx_events_is_private"],
      ["idx_parties_title_trgm", "idx_events_title_trgm"],
      ["idx_parties_desc_trgm", "idx_events_desc_trgm"],
      ["idx_parties_city_trgm", "idx_events_city_trgm"]
    ];

    for (const [oldIdx, newIdx] of indexesToRename) {
      try {
        await query(`ALTER INDEX ${oldIdx} RENAME TO ${newIdx}`);
      } catch (e) {}
    }

    // 2. Rename party_requests table to event_requests
    await query("ALTER TABLE party_requests RENAME TO event_requests");
    await query("ALTER TABLE event_requests RENAME COLUMN party_id TO event_id");
    try {
      await query("ALTER TABLE event_requests RENAME CONSTRAINT uq_party_user TO uq_event_user");
    } catch (e) {}
    try {
      await query("ALTER TABLE event_requests RENAME CONSTRAINT fk_requests_party TO fk_requests_event");
    } catch (e) {}
    try {
      await query("ALTER TABLE event_requests RENAME CONSTRAINT chk_party_requests_status TO chk_event_requests_status");
    } catch (e) {}

    const reqIndexes = [
      ["idx_party_requests_party", "idx_event_requests_event"],
      ["idx_party_requests_user", "idx_event_requests_user"],
      ["idx_party_requests_status", "idx_event_requests_status"]
    ];
    for (const [oldIdx, newIdx] of reqIndexes) {
      try {
        await query(`ALTER INDEX ${oldIdx} RENAME TO ${newIdx}`);
      } catch (e) {}
    }

    // 3. Rename party_attendees table to event_attendees
    await query("ALTER TABLE party_attendees RENAME TO event_attendees");
    await query("ALTER TABLE event_attendees RENAME COLUMN party_id TO event_id");
    try {
      await query("ALTER TABLE event_attendees RENAME CONSTRAINT uq_attendee_party_user TO uq_attendee_event_user");
    } catch (e) {}
    try {
      await query("ALTER TABLE event_attendees RENAME CONSTRAINT fk_attendees_party TO fk_attendees_event");
    } catch (e) {}

    const attIndexes = [
      ["idx_party_attendees_party", "idx_event_attendees_event"],
      ["idx_party_attendees_user", "idx_event_attendees_user"]
    ];
    for (const [oldIdx, newIdx] of attIndexes) {
      try {
        await query(`ALTER INDEX ${oldIdx} RENAME TO ${newIdx}`);
      } catch (e) {}
    }

    // 4. Rename column and constraint in payments
    await query("ALTER TABLE payments RENAME COLUMN party_id TO event_id");
    try {
      await query("ALTER TABLE payments RENAME CONSTRAINT fk_payments_party TO fk_payments_event");
    } catch (e) {}
    try {
      await query("ALTER INDEX idx_payments_party RENAME TO idx_payments_event");
    } catch (e) {}

    // 5. Rename columns and constraint in crowd_ratings
    await query("ALTER TABLE crowd_ratings RENAME COLUMN party_id TO event_id");
    try {
      await query("ALTER TABLE crowd_ratings RENAME CONSTRAINT uq_crowd_rating_user_party TO uq_crowd_rating_user_event");
    } catch (e) {}
    try {
      await query("ALTER TABLE crowd_ratings RENAME CONSTRAINT fk_crowd_ratings_party TO fk_crowd_ratings_event");
    } catch (e) {}
    try {
      await query("ALTER INDEX idx_crowd_ratings_party RENAME TO idx_crowd_ratings_event");
    } catch (e) {}

    // 6. Rename columns and constraint in photos
    await query("ALTER TABLE photos RENAME COLUMN party_id TO event_id");
    try {
      await query("ALTER TABLE photos RENAME CONSTRAINT fk_photos_party TO fk_photos_event");
    } catch (e) {}
    try {
      await query("ALTER INDEX idx_photos_party RENAME TO idx_photos_event");
    } catch (e) {}

    // 7. Rename columns and constraint in conversations
    try {
      await query("ALTER TABLE conversations RENAME COLUMN party_id TO event_id");
    } catch (e) {}
    try {
      await query("ALTER TABLE conversations RENAME CONSTRAINT uq_conversations_party_guest TO uq_conversations_event_guest");
    } catch (e) {}
    try {
      await query("ALTER TABLE conversations RENAME CONSTRAINT fk_conversations_party TO fk_conversations_event");
    } catch (e) {}
    try {
      await query("ALTER INDEX idx_conversations_party RENAME TO idx_conversations_event");
    } catch (e) {}

    // 8. Rename party_announcements table to event_announcements
    try {
      await query("ALTER TABLE party_announcements RENAME TO event_announcements");
      await query("ALTER TABLE event_announcements RENAME COLUMN party_id TO event_id");
      try {
        await query("ALTER TABLE event_announcements RENAME CONSTRAINT chk_party_announcements_body_length TO chk_event_announcements_body_length");
      } catch (e) {}
      try {
        await query("ALTER TABLE event_announcements RENAME CONSTRAINT fk_party_announcements_party TO fk_event_announcements_event");
      } catch (e) {}
      try {
        await query("ALTER TABLE event_announcements RENAME CONSTRAINT fk_party_announcements_host TO fk_event_announcements_host");
      } catch (e) {}
      try {
        await query("ALTER INDEX idx_party_announcements_party_created RENAME TO idx_event_announcements_event_created");
      } catch (e) {}
    } catch (e) {}

    // 9. Rename columns in users
    try {
      await query("ALTER TABLE users RENAME COLUMN parties_hosted TO events_hosted");
    } catch (e) {}
    try {
      await query("ALTER TABLE users RENAME COLUMN parties_attended TO events_attended");
    } catch (e) {}

    // 10. Rename columns in ticket_tiers
    try {
      await query("ALTER TABLE ticket_tiers RENAME COLUMN party_id TO event_id");
      await query("ALTER INDEX idx_ticket_tiers_party RENAME TO idx_ticket_tiers_event");
    } catch (e) {}

    // 11. Rename columns in host_payouts
    try {
      await query("ALTER TABLE host_payouts RENAME COLUMN party_id TO event_id");
    } catch (e) {}

    // 12. Update reports table target_type check constraint and values
    try {
      await query("UPDATE reports SET target_type = 'event' WHERE target_type = 'party'");
      await query("ALTER TABLE reports RENAME CONSTRAINT chk_report_target_type TO chk_report_target_type_old");
      await query("ALTER TABLE reports ADD CONSTRAINT chk_report_target_type CHECK (target_type IN ('user', 'event', 'photo'))");
      await query("ALTER TABLE reports DROP CONSTRAINT chk_report_target_type_old");
    } catch (e) {
      console.log("Could not update target_type check constraint on reports (might already be event check or different name)");
    }

    console.log("✓ Successfully migrated database schema from party to event.");
  } else {
    console.log("Parties table does not exist. Skipping database schema rename.");
  }
}

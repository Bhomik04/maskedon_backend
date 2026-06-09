import { query } from "../connection";

/**
 * Migration 027 — Multi-tier ticket pricing
 *
 * 1. Creates `ticket_tiers` table so hosts can define multiple pricing tiers
 *    (Stag, Couple, Family Pack, VIP, etc.) per event.
 * 2. Adds `tier_id` to `payments` and `event_requests` for tracking which tier
 *    a payment / request belongs to.
 * 3. Adds group-booking columns to `event_attendees` so that a Couple or Family
 *    Pack ticket generates one row per slot, all sharing a `group_id`.
 */
export async function up(): Promise<void> {
  // 1. ticket_tiers table
  await query(`
    CREATE TABLE IF NOT EXISTS ticket_tiers (
      id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
      event_id    UUID        NOT NULL REFERENCES events(id) ON DELETE CASCADE,
      name        VARCHAR(100) NOT NULL,
      description VARCHAR(300) NULL,
      price       INT         NOT NULL DEFAULT 0,
      slots       INT         NOT NULL DEFAULT 1,
      max_quantity INT        NULL,
      sold_count  INT         NOT NULL DEFAULT 0,
      sort_order  INT         NOT NULL DEFAULT 0,
      is_active   BOOLEAN     NOT NULL DEFAULT TRUE,
      created_at  TIMESTAMP   NOT NULL DEFAULT NOW()
    )
  `);

  await query(`
    CREATE INDEX IF NOT EXISTS idx_ticket_tiers_event ON ticket_tiers(event_id)
  `);

  // 2. Add tier_id to payments
  await query(`
    ALTER TABLE payments
      ADD COLUMN IF NOT EXISTS tier_id UUID NULL REFERENCES ticket_tiers(id) ON DELETE SET NULL
  `);

  // 3. Add tier_id to event_requests
  await query(`
    ALTER TABLE event_requests
      ADD COLUMN IF NOT EXISTS tier_id UUID NULL REFERENCES ticket_tiers(id) ON DELETE SET NULL
  `);

  // 4. Add group-booking columns to event_attendees
  await query(`
    ALTER TABLE event_attendees
      ADD COLUMN IF NOT EXISTS tier_id    UUID NULL REFERENCES ticket_tiers(id) ON DELETE SET NULL,
      ADD COLUMN IF NOT EXISTS group_id   UUID NULL,
      ADD COLUMN IF NOT EXISTS group_size INT  NOT NULL DEFAULT 1,
      ADD COLUMN IF NOT EXISTS slot_index INT  NOT NULL DEFAULT 1
  `);
}

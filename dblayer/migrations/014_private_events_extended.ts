import { query } from "../connection";

export async function up() {
  // Privacy & access controls
  await query(
    `ALTER TABLE events
       ADD COLUMN IF NOT EXISTS is_private BOOLEAN NOT NULL DEFAULT FALSE,
       ADD COLUMN IF NOT EXISTS private_code VARCHAR(10) UNIQUE NULL,
       ADD COLUMN IF NOT EXISTS allow_photos BOOLEAN NOT NULL DEFAULT TRUE`,
    []
  );

  // Food & substance metadata
  await query(
    `ALTER TABLE events
       ADD COLUMN IF NOT EXISTS food_type VARCHAR(20) NULL
         CONSTRAINT chk_events_food_type CHECK (food_type IN ('veg', 'non_veg', 'vegan')),
       ADD COLUMN IF NOT EXISTS allows_alcohol BOOLEAN NOT NULL DEFAULT FALSE,
       ADD COLUMN IF NOT EXISTS allows_smoking BOOLEAN NOT NULL DEFAULT FALSE,
       ADD COLUMN IF NOT EXISTS allows_other_substances BOOLEAN NOT NULL DEFAULT FALSE`,
    []
  );

  // Structured location
  await query(
    `ALTER TABLE events
       ADD COLUMN IF NOT EXISTS location_country VARCHAR(100) NULL,
       ADD COLUMN IF NOT EXISTS location_state VARCHAR(100) NULL,
       ADD COLUMN IF NOT EXISTS location_district VARCHAR(100) NULL`,
    []
  );

  // Index for private code lookups
  await query(
    `CREATE INDEX IF NOT EXISTS idx_events_private_code ON events (private_code)`,
    []
  );

  // Index to efficiently exclude private events from discovery
  await query(
    `CREATE INDEX IF NOT EXISTS idx_events_is_private ON events (is_private)`,
    []
  );
}

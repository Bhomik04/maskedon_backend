import { query } from "../connection";

export async function up(): Promise<void> {
  // Make max_capacity nullable so new events don't require a capacity limit.
  // Existing events keep their current value; new events created without this
  // field will have NULL (meaning unlimited).
  await query(
    `ALTER TABLE events ALTER COLUMN max_capacity DROP NOT NULL`,
    []
  );

  console.log("Migration 022: max_capacity made nullable (unlimited events).");
}

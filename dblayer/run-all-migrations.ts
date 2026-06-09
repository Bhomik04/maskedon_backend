/**
 * Unified migration runner.
 * Runs all migrations in order (001–007), skipping any already recorded in the
 * `migrations` tracking table.  Safe to run multiple times — idempotent.
 *
 * Usage:  cd backend && npm run migrate:all
 */
import fs from "fs";
import path from "path";
import dotenv from "dotenv";
dotenv.config({ path: path.join(__dirname, "../.env") });

import { getConnection, testConnection, query } from "./connection";

// --- migration modules (003-007 export up(); 002+004 now also export up()) ---
import { up as up002 } from "./migrations/002_add_photo_comments";
import { up as up003 } from "./migrations/003_crowd_ratings";
import { up as up004 } from "./migrations/004_photo_views";
import { up as up005 } from "./migrations/005_device_push_tokens";
import { up as up006 } from "./migrations/006_reports";
import { up as up009 } from "./migrations/009_user_achievements";
import { up as up010 } from "./migrations/010_global_visibility";
import { up as up011 } from "./migrations/011_discovery_engine";
import { up as up012 } from "./migrations/012_bug_reports";
import { up as up013 } from "./migrations/013_user_banner";
import { up as up014 } from "./migrations/014_private_events_extended";
import { up as up015 } from "./migrations/015_messaging";
import { up as up016 } from "./migrations/016_friends_only_photos";
import { up as up017 } from "./migrations/017_search_indexes";
import { up as up018 } from "./migrations/018_comment_threads_and_pins";
import { up as up019 } from "./migrations/019_razorpay_payments";
import { up as up020 } from "./migrations/020_email_verification";
import { up as up021 } from "./migrations/021_refund_tracking";
import { up as up022 } from "./migrations/022_max_capacity_nullable";
import { up as up023 } from "./migrations/023_commission_and_deposit";
import { up as up024 } from "./migrations/024_age_verification";
import { up as up025 } from "./migrations/025_photo_saves";
import { up as up026 } from "./migrations/026_ticket_qr_tokens";
import { up as up027 } from "./migrations/027_ticket_tiers";
import { up as up028 } from "./migrations/028_host_verification";
import { up as up029 } from "./migrations/029_host_verification_add_aadhaar";
import { up as up030 } from "./migrations/030_auth_schema_repair";
import { up as up031 } from "./migrations/031_financial_jobs";
import { up as up032 } from "./migrations/032_rename_parties_to_events";
import { up as up033 } from "./migrations/033_refund_requests_and_holding";

interface Migration {
  name: string;
  up: () => Promise<void>;
}

interface RunAllMigrationsOptions {
  exitOnFinish?: boolean;
}

const MIGRATIONS: Migration[] = [
  { name: "003_crowd_ratings",        up: up003 },
  { name: "004_photo_views",          up: up004 },
  { name: "005_device_push_tokens",   up: up005 },
  { name: "006_reports",              up: up006 },
  { name: "009_user_achievements",    up: up009 },
  { name: "010_global_visibility",    up: up010 },
  { name: "011_discovery_engine",     up: up011 },
  { name: "012_bug_reports",          up: up012 },
  { name: "013_user_banner",           up: up013 },
  { name: "014_private_events_extended", up: up014 },
  { name: "015_messaging",             up: up015 },
  { name: "016_friends_only_photos",   up: up016 },
  { name: "017_search_indexes",          up: up017 },
  { name: "018_comment_threads_and_pins", up: up018 },
  { name: "019_razorpay_payments",        up: up019 },
  { name: "020_email_verification",       up: up020 },
  { name: "021_refund_tracking",          up: up021 },
  { name: "022_max_capacity_nullable",     up: up022 },
  { name: "023_commission_and_deposit",    up: up023 },
  { name: "024_age_verification",           up: up024 },
  { name: "025_photo_saves",                up: up025 },
  { name: "026_ticket_qr_tokens",           up: up026 },
  { name: "027_ticket_tiers",               up: up027 },
  { name: "028_host_verification",           up: up028 },
  { name: "029_host_verification_add_aadhaar", up: up029 },
  { name: "030_auth_schema_repair",           up: up030 },
  { name: "031_financial_jobs",               up: up031 },
  { name: "032_rename_parties_to_events",     up: up032 },
  { name: "033_refund_requests_and_holding",  up: up033 },
];

// --- initial schema (001) handled separately via schema.sql ---
async function runInitialSchema(conn: any): Promise<void> {
  const migrationName = "001_initial_schema";
  const [rows] = await conn.execute(
    "SELECT id FROM migrations WHERE name = ?",
    [migrationName]
  );
  if (Array.isArray(rows) && rows.length > 0) {
    console.log(`  ⏭  "${migrationName}" already applied — skipping.`);
    return;
  }

  const schemaPath = path.join(__dirname, "schema.sql");
  const sql = fs.readFileSync(schemaPath, "utf-8");
  const statements = sql
    .split(";")
    .map((s) =>
      s
        .split("\n")
        .filter((line) => !line.trim().startsWith("--"))
        .join("\n")
        .trim()
    )
    .filter((s) => s.length > 0);

  await conn.beginTransaction();
  for (const stmt of statements) {
    await conn.execute(stmt);
  }
  await conn.execute("INSERT INTO migrations (name) VALUES (?)", [migrationName]);
  await conn.commit();
  console.log(`  ✓  "${migrationName}" applied.`);
}

// --- 002 handled separately (needs the isolated up() + tracking) ---
async function run002(conn: any): Promise<void> {
  const migrationName = "002_add_photo_comments";
  const [rows] = await conn.execute(
    "SELECT id FROM migrations WHERE name = ?",
    [migrationName]
  );
  if (Array.isArray(rows) && rows.length > 0) {
    console.log(`  ⏭  "${migrationName}" already applied — skipping.`);
    return;
  }
  await conn.beginTransaction();
  await up002();
  await conn.execute("INSERT INTO migrations (name) VALUES (?)", [migrationName]);
  await conn.commit();
  console.log(`  ✓  "${migrationName}" applied.`);
}

export async function runAllMigrations(options: RunAllMigrationsOptions = {}) {
  const { exitOnFinish = true } = options;

  console.log("\n=== maskedOn Migration Runner ===\n");

  const connected = await testConnection();
  if (!connected) {
    console.error("Cannot run migrations — database connection failed.");
    if (exitOnFinish) {
      process.exit(1);
    }
    throw new Error("Cannot run migrations — database connection failed.");
  }

  const conn = await getConnection();

  try {
    // Ensure tracking table exists
    await conn.execute(`
      CREATE TABLE IF NOT EXISTS migrations (
        id           INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
        name         VARCHAR(255) NOT NULL UNIQUE,
        executed_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Rename old migration track record if exists
    try {
      await conn.execute("UPDATE migrations SET name = '014_private_events_extended' WHERE name = '014_private_parties_extended'");
    } catch (e) {}

    // 001 — initial schema
    await runInitialSchema(conn);

    // 002 — photo_comments (needs transactional tracking via conn)
    await run002(conn);

    // 003-007 — standard up() exports
    for (const mig of MIGRATIONS) {
      const [rows] = await conn.execute(
        "SELECT id FROM migrations WHERE name = ?",
        [mig.name]
      );
      if (Array.isArray(rows) && rows.length > 0) {
        console.log(`  ⏭  "${mig.name}" already applied — skipping.`);
        continue;
      }

      console.log(`  ▶  Running "${mig.name}"...`);
      await conn.beginTransaction();
      try {
        await mig.up();
        await conn.execute("INSERT INTO migrations (name) VALUES (?)", [mig.name]);
        await conn.commit();
        console.log(`  ✓  "${mig.name}" applied.`);
      } catch (err) {
        await conn.rollback();
        console.error(`  ✗  "${mig.name}" FAILED:`, err);
        if (exitOnFinish) {
          process.exit(1);
        }
        throw err;
      }
    }

    console.log("\n=== All migrations complete ===\n");
  } finally {
    conn.release();
  }

  if (exitOnFinish) {
    process.exit(0);
  }
}

if (require.main === module) {
  void runAllMigrations();
}

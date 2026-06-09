require("dotenv").config();
const { Client } = require("pg");

async function clearDatabase() {
  const client = new Client({
    connectionString: process.env.DATABASE_URL,
    ssl: {
      rejectUnauthorized: (process.env.DB_SSL_REJECT_UNAUTHORIZED || "false") === "true",
    },
  });

  await client.connect();

  const { rows } = await client.query(
    "SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename <> 'migrations' ORDER BY tablename"
  );

  if (!rows.length) {
    console.log("No public tables found to truncate.");
    await client.end();
    return;
  }

  const tables = rows.map((r) => `"public"."${String(r.tablename).replace(/"/g, '""')}"`);
  const truncateSql = `TRUNCATE TABLE ${tables.join(", ")} RESTART IDENTITY CASCADE`;

  await client.query(truncateSql);
  await client.end();

  console.log("Truncated tables:", rows.map((r) => r.tablename).join(", "));
}

clearDatabase().catch((error) => {
  console.error("Cleanup failed:", error.message);
  process.exit(1);
});

import fs from "fs";
import path from "path";
import pool, { testConnection } from "./connection";

async function importSqlFile() {
  const connected = await testConnection();
  if (!connected) {
    console.error("Cannot import SQL file - database connection failed.");
    process.exit(1);
  }

  const argPath = process.argv[2];
  const resolvedPath = argPath
    ? path.isAbsolute(argPath)
      ? argPath
      : path.resolve(process.cwd(), argPath)
    : path.resolve(__dirname, "migrations", "maskon_database2.sql");

  if (!fs.existsSync(resolvedPath)) {
    console.error(`SQL file not found: ${resolvedPath}`);
    process.exit(1);
  }

  const sql = fs.readFileSync(resolvedPath, "utf-8").trim();
  if (!sql) {
    console.error(`SQL file is empty: ${resolvedPath}`);
    process.exit(1);
  }

  try {
    await pool.query(sql);
    console.log(`SQL import completed successfully: ${resolvedPath}`);
  } catch (err) {
    console.error("SQL import failed:", err);
    process.exit(1);
  } finally {
    await pool.end();
  }

  process.exit(0);
}

importSqlFile();

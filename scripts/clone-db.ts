import { Client } from "pg";
import * as dotenv from "dotenv";
import * as path from "path";

// Load backend env variables
dotenv.config({ path: path.join(__dirname, "../.env") });

const prodUrl = "postgresql://postgres.jlqcthlvzqxicdtqlowr:1029384756.23022003.Masked@aws-1-ap-south-1.pooler.supabase.com:5432/postgres";
const devUrl = "postgresql://postgres.aulqrcteudddqcyrukgi:Masked@man12@aws-1-ap-southeast-1.pooler.supabase.com:5432/postgres";

async function getTableColumns(client: Client, tableName: string): Promise<string[]> {
  const res = await client.query(`
    SELECT column_name 
    FROM information_schema.columns 
    WHERE table_schema = 'public' AND table_name = $1
  `, [tableName]);
  return res.rows.map((r: any) => r.column_name);
}

async function run() {
  console.log("Connecting to Production Database...");
  const prodClient = new Client({ connectionString: prodUrl });
  await prodClient.connect();

  console.log("Connecting to Development Database...");
  const devClient = new Client({ connectionString: devUrl });
  await devClient.connect();

  try {
    // 1. Get all public base tables from production
    const prodTableRes = await prodClient.query(`
      SELECT table_name 
      FROM information_schema.tables 
      WHERE table_schema = 'public' 
        AND table_type = 'BASE TABLE'
        AND table_name NOT IN ('schema_migrations', 'pg_stat_statements')
    `);
    const prodTables: string[] = prodTableRes.rows.map((r: any) => r.table_name);

    // Get all public base tables from development
    const devTableRes = await devClient.query(`
      SELECT table_name 
      FROM information_schema.tables 
      WHERE table_schema = 'public' 
        AND table_type = 'BASE TABLE'
        AND table_name NOT IN ('schema_migrations', 'pg_stat_statements')
    `);
    const devTables: string[] = devTableRes.rows.map((r: any) => r.table_name);

    // Intersect tables to only copy what exists in both databases
    const tables = prodTables.filter(t => devTables.includes(t));
    console.log(`Found ${tables.length} common tables in both public schemas.`);
    const skippedTables = prodTables.filter(t => !devTables.includes(t));
    if (skippedTables.length > 0) {
      console.log(`Skipping ${skippedTables.length} tables not present in dev:`, skippedTables);
    }

    // 2. Fetch all foreign key relationships to determine dependencies
    const fkRes = await prodClient.query(`
      SELECT DISTINCT
          tc.table_name AS table_name,
          ccu.table_name AS foreign_table_name
      FROM
          information_schema.table_constraints AS tc
          JOIN information_schema.key_column_usage AS kcu
            ON tc.constraint_name = kcu.constraint_name
            AND tc.table_schema = kcu.table_schema
          JOIN information_schema.constraint_column_usage AS ccu
            ON ccu.constraint_name = tc.constraint_name
            AND ccu.table_schema = tc.table_schema
      WHERE tc.constraint_type = 'FOREIGN KEY'
        AND tc.table_schema = 'public'
    `);

    // Build dependency map: table -> list of tables it depends on
    const dependencies: Record<string, Set<string>> = {};
    for (const table of tables) {
      dependencies[table] = new Set<string>();
    }

    for (const row of fkRes.rows) {
      const { table_name, foreign_table_name } = row;
      // Skip self-references and references to excluded/uncommon tables
      if (table_name !== foreign_table_name && dependencies[table_name] && dependencies[foreign_table_name]) {
        dependencies[table_name].add(foreign_table_name);
      }
    }

    // 3. Topological Sort (Kahn's Algorithm)
    const inDegree: Record<string, number> = {};
    const adjList: Record<string, string[]> = {};
    for (const table of tables) {
      inDegree[table] = 0;
      adjList[table] = [];
    }

    for (const [table, deps] of Object.entries(dependencies)) {
      for (const dep of deps) {
        adjList[dep].push(table);
        inDegree[table]++;
      }
    }

    const queue: string[] = [];
    for (const table of tables) {
      if (inDegree[table] === 0) {
        queue.push(table);
      }
    }

    const sortedTables: string[] = [];
    while (queue.length > 0) {
      const u = queue.shift()!;
      sortedTables.push(u);

      for (const v of adjList[u]) {
        inDegree[v]--;
        if (inDegree[v] === 0) {
          queue.push(v);
        }
      }
    }

    if (sortedTables.length !== tables.length) {
      console.warn("Warning: Cyclic dependency detected! Using fallback ordering.");
      sortedTables.length = 0;
      if (tables.includes("users")) {
        sortedTables.push("users");
      }
      for (const t of tables) {
        if (t !== "users") sortedTables.push(t);
      }
    } else {
      console.log("Topologically sorted tables (correct insert order):", sortedTables);
    }

    // 4. Truncate dev tables in reverse topological order (child tables first)
    console.log("\n--- Truncating dev tables in reverse order ---");
    const reverseSorted = [...sortedTables].reverse();
    for (const table of reverseSorted) {
      console.log(`Truncating ${table}...`);
      try {
        await devClient.query(`TRUNCATE TABLE "${table}" CASCADE`);
      } catch (err: any) {
        console.warn(`Truncate failed for ${table}: ${err.message}`);
      }
    }

    // 5. Insert rows in topological order (parent tables first)
    for (const table of sortedTables) {
      console.log(`\n--- Syncing table: ${table} ---`);

      // Intersect columns to only copy fields present in both databases
      const prodCols = await getTableColumns(prodClient, table);
      const devCols = await getTableColumns(devClient, table);
      const commonCols = prodCols.filter(c => devCols.includes(c));
      
      const skippedCols = prodCols.filter(c => !devCols.includes(c));
      if (skippedCols.length > 0) {
        console.log(`Skipping columns not present in dev:`, skippedCols);
      }

      if (commonCols.length === 0) {
        console.log(`No common columns found. Skipping.`);
        continue;
      }

      const colNamesStr = commonCols.map(c => `"${c}"`).join(", ");

      // Get columns and data from production (only query common columns)
      const querySelect = `SELECT ${colNamesStr} FROM "${table}"`;
      const dataRes = await prodClient.query(querySelect);
      const rows = dataRes.rows;
      console.log(`Production rows count: ${rows.length}`);

      if (rows.length === 0) {
        console.log(`No rows to insert.`);
        continue;
      }

      console.log(`Inserting rows into dev...`);
      for (const row of rows) {
        const values = commonCols.map(col => {
          const val = row[col];
          if (val !== null && typeof val === "object" && !(val instanceof Date)) {
            return JSON.stringify(val);
          }
          return val;
        });
        const placeholders = commonCols.map((_, i) => `$${i + 1}`).join(", ");
        const queryText = `INSERT INTO "${table}" (${colNamesStr}) VALUES (${placeholders})`;
        try {
          await devClient.query(queryText, values);
        } catch (insertErr: any) {
          if (insertErr.code === "428C9") {
            const overrideQuery = `INSERT INTO "${table}" (${colNamesStr}) OVERRIDING SYSTEM VALUE VALUES (${placeholders})`;
            await devClient.query(overrideQuery, values);
          } else {
            throw insertErr;
          }
        }
      }
      console.log(`Successfully synced ${table}.`);
    }

    console.log("\nDatabase clone completed successfully!");
  } catch (error) {
    console.error("Error cloning database:", error);
  } finally {
    await prodClient.end();
    await devClient.end();
  }
}

run();

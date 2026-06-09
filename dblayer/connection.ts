import { Pool, PoolClient, QueryResult as PgQueryResult, types } from "pg";
import dns from "dns";
import dotenv from "dotenv";

dotenv.config();

if (process.env.NODE_ENV === "production" && !process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL must be set in production");
}

// Render networking can fail on some IPv6-only resolutions for external DB hosts.
// Prefer IPv4 unless explicitly overridden.
dns.setDefaultResultOrder((process.env.DB_DNS_RESULT_ORDER || "ipv4first") as "ipv4first" | "verbatim");

// Parse PostgreSQL NUMERIC and BIGINT values as numbers to preserve existing behavior.
types.setTypeParser(1700, (val) => Number(val));
types.setTypeParser(20, (val) => Number(val));

function convertPlaceholders(sql: string): string {
  let index = 0;
  return sql.replace(/\?/g, () => {
    index += 1;
    return `$${index}`;
  });
}

const pool = new Pool(
  process.env.DATABASE_URL
    ? {
        connectionString: process.env.DATABASE_URL,
        max: parseInt(process.env.DB_POOL_MAX || "20", 10),
        ssl: {
          // Default to TRUE in production to prevent MitM attacks on DB traffic.
          // Set DB_SSL_REJECT_UNAUTHORIZED=false only if using a self-signed cert you control.
          rejectUnauthorized: (process.env.DB_SSL_REJECT_UNAUTHORIZED ?? (process.env.NODE_ENV === "production" ? "true" : "false")) === "true",
        },
      }
    : {
        host: process.env.DB_HOST || "localhost",
        port: parseInt(process.env.DB_PORT || "5432", 10),
        database: process.env.DB_NAME || "maskedon",
        user: process.env.DB_USER || "postgres",
        password: process.env.DB_PASSWORD || "",
        max: parseInt(process.env.DB_POOL_MAX || "20", 10),
        ssl:
          (process.env.DB_SSL || "false") === "true"
            ? {
                rejectUnauthorized:
                  (process.env.DB_SSL_REJECT_UNAUTHORIZED || "false") === "true",
              }
            : undefined,
      }
);

export interface QueryResult<T = any> {
  rows: T[];
  affectedRows: number;
  insertId: number;
}

function isSelectQuery(sql: string): boolean {
  return /^\s*select\b/i.test(sql);
}

export async function query<T = any>(
  text: string,
  params?: any[]
): Promise<QueryResult<T>> {
  const sql = convertPlaceholders(text);
  const result = await pool.query(sql, params);

  if (isSelectQuery(text)) {
    return { rows: result.rows as T[], affectedRows: 0, insertId: 0 };
  }

  return {
    rows: result.rows as T[],
    affectedRows: result.rowCount ?? 0,
    insertId: 0,
  };
}

class PgCompatConnection {
  constructor(private readonly client: PoolClient) {}

  async execute(text: string, params?: any[]): Promise<[any]> {
    const sql = convertPlaceholders(text);
    const result = await this.client.query(sql, params);

    if (isSelectQuery(text)) {
      return [result.rows];
    }

    return [{ affectedRows: result.rowCount ?? 0, insertId: 0 }];
  }

  async beginTransaction(): Promise<void> {
    await this.client.query("BEGIN");
  }

  async commit(): Promise<void> {
    await this.client.query("COMMIT");
  }

  async rollback(): Promise<void> {
    await this.client.query("ROLLBACK");
  }

  release(): void {
    this.client.release();
  }
}

export async function getConnection() {
  const client = await pool.connect();
  return new PgCompatConnection(client);
}

export async function testConnection(): Promise<boolean> {
  try {
    await pool.query("SELECT 1");
    console.log("✓ Database connected successfully");
    return true;
  } catch (err) {
    console.error("✗ Database connection failed:", err);
    return false;
  }
}

export default pool;

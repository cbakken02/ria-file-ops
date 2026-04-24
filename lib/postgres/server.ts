import "server-only";
import {
  Pool,
  type PoolClient,
  type PoolConfig,
  type QueryResult,
  type QueryResultRow,
} from "pg";
import { isSupabasePersistence } from "@/lib/persistence/backend";

declare global {
  // eslint-disable-next-line no-var
  var __riaFileOpsPostgresPool: Pool | undefined;
}

if (typeof window !== "undefined") {
  throw new Error("lib/postgres/server.ts can only be imported on the server.");
}

export function getSupabaseDatabaseUrl() {
  return (
    process.env.SUPABASE_DB_URL_POOLER?.trim() ||
    process.env.SUPABASE_DB_URL?.trim() ||
    null
  );
}

export function isSupabaseDatabaseConfigured() {
  return Boolean(getSupabaseDatabaseUrl());
}

export function getPostgresPool() {
  if (!isSupabasePersistence()) {
    throw new Error(
      "Postgres pool requested while PERSISTENCE_BACKEND is not set to \"supabase\".",
    );
  }

  const existingPool = global.__riaFileOpsPostgresPool;
  if (existingPool) {
    return existingPool;
  }

  const connectionString = getSupabaseDatabaseUrl();
  if (!connectionString) {
    throw new Error(
      "Supabase persistence requires SUPABASE_DB_URL_POOLER or SUPABASE_DB_URL to be configured.",
    );
  }

  const pool = new Pool(buildPoolConfig(connectionString));
  global.__riaFileOpsPostgresPool = pool;
  return pool;
}

export async function withPostgresClient<T>(
  handler: (client: PoolClient) => Promise<T>,
) {
  const pool = getPostgresPool();
  const client = await pool.connect();

  try {
    return await handler(client);
  } finally {
    client.release();
  }
}

export async function queryPostgres<Row extends QueryResultRow = QueryResultRow>(
  text: string,
  params: unknown[] = [],
) : Promise<QueryResult<Row>> {
  return withPostgresClient((client) =>
    client.query<Row>(text, params),
  );
}

function buildPoolConfig(connectionString: string): PoolConfig {
  return {
    connectionString,
    max: 5,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 10_000,
    allowExitOnIdle: true,
    ssl: shouldUseSsl(connectionString) ? { rejectUnauthorized: false } : undefined,
  };
}

function shouldUseSsl(connectionString: string) {
  try {
    const url = new URL(connectionString);
    return !["localhost", "127.0.0.1"].includes(url.hostname);
  } catch {
    return true;
  }
}

import "server-only";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  Pool,
  type PoolClient,
  type PoolConfig,
  type QueryResult,
  type QueryResultRow,
} from "pg";
import { Worker } from "node:worker_threads";
import { isSupabasePersistence } from "@/lib/persistence/backend";

declare global {
  // eslint-disable-next-line no-var
  var __riaFileOpsPostgresPool: Pool | undefined;
}

if (typeof window !== "undefined") {
  throw new Error("lib/postgres/server.ts can only be imported on the server.");
}

export type PostgresStatement = {
  text: string;
  params?: unknown[];
};

export type PostgresSyncQueryResult<Row extends QueryResultRow = QueryResultRow> = {
  rows: Row[];
  rowCount: number;
};

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
): Promise<QueryResult<Row>> {
  return withPostgresClient((client) =>
    client.query<Row>(text, params),
  );
}

export function queryPostgresSync<Row extends QueryResultRow = QueryResultRow>(
  text: string,
  params: unknown[] = [],
) {
  return runPostgresStatementsSync<Row>([{ text, params }]);
}

export function runPostgresStatementsSync<Row extends QueryResultRow = QueryResultRow>(
  statements: PostgresStatement[],
  options: {
    useTransaction?: boolean;
    resultIndex?: number;
  } = {},
): PostgresSyncQueryResult<Row> {
  if (!isSupabasePersistence()) {
    throw new Error(
      "Synchronous Postgres query requested while PERSISTENCE_BACKEND is not set to \"supabase\".",
    );
  }

  const connectionString = getSupabaseDatabaseUrl();
  if (!connectionString) {
    throw new Error(
      "Supabase persistence requires SUPABASE_DB_URL_POOLER or SUPABASE_DB_URL to be configured.",
    );
  }

  if (!Array.isArray(statements) || statements.length === 0) {
    throw new Error("At least one Postgres statement is required.");
  }

  const resultPath = path.join(
    os.tmpdir(),
    `ria-file-ops-postgres-sync-${crypto.randomUUID()}.json`,
  );
  const signal = new Int32Array(new SharedArrayBuffer(4));
  const worker = new Worker(POSTGRES_SYNC_WORKER_SOURCE, {
    eval: true,
    workerData: {
      connectionString,
      ssl: shouldUseSsl(connectionString),
      statements: statements.map((statement) => ({
        text: statement.text,
        params: statement.params ?? [],
      })),
      useTransaction: options.useTransaction ?? false,
      resultIndex: options.resultIndex ?? (statements.length - 1),
      resultPath,
      signalBuffer: signal.buffer,
    },
  });

  try {
    Atomics.wait(signal, 0, 0);
    const serialized = fs.readFileSync(resultPath, "utf8");
    const payload = JSON.parse(serialized) as
      | {
          ok: true;
          result: PostgresSyncQueryResult<Row>;
        }
      | {
          ok: false;
          error?: {
            message?: string;
            stack?: string | null;
          };
        };

    if (!payload.ok) {
      throw new Error(
        payload.error?.message ||
          "Synchronous Postgres worker failed without an error message.",
      );
    }

    return payload.result;
  } finally {
    try {
      worker.terminate();
    } catch {}

    try {
      fs.unlinkSync(resultPath);
    } catch {}
  }
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

const POSTGRES_SYNC_WORKER_SOURCE = `
const fs = require("node:fs");
const { Pool } = require("pg");
const { workerData } = require("node:worker_threads");

async function main() {
  const signal = new Int32Array(workerData.signalBuffer);
  const pool = new Pool({
    connectionString: workerData.connectionString,
    max: 1,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 10_000,
    allowExitOnIdle: true,
    ssl: workerData.ssl ? { rejectUnauthorized: false } : undefined,
  });

  let client = null;

  try {
    client = await pool.connect();

    if (workerData.useTransaction) {
      await client.query("BEGIN");
    }

    const results = [];

    for (const statement of workerData.statements) {
      const result = await client.query(statement.text, statement.params);
      results.push({
        rows: result.rows,
        rowCount: typeof result.rowCount === "number" ? result.rowCount : 0,
      });
    }

    if (workerData.useTransaction) {
      await client.query("COMMIT");
    }

    const selected = results[workerData.resultIndex] || { rows: [], rowCount: 0 };

    fs.writeFileSync(
      workerData.resultPath,
      JSON.stringify({ ok: true, result: selected }),
      "utf8",
    );
  } catch (error) {
    try {
      if (workerData.useTransaction && client) {
        await client.query("ROLLBACK");
      }
    } catch {}

    fs.writeFileSync(
      workerData.resultPath,
      JSON.stringify({
        ok: false,
        error: {
          message: error && error.message ? error.message : "Postgres worker failed.",
          stack: error && error.stack ? error.stack : null,
        },
      }),
      "utf8",
    );
  } finally {
    try {
      if (client) {
        client.release();
      }
    } catch {}

    try {
      await pool.end();
    } catch {}

    Atomics.store(signal, 0, 1);
    Atomics.notify(signal, 0, 1);
  }
}

main();
`;

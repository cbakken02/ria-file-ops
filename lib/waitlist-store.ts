import "server-only";
import { createRequire } from "node:module";
import fs from "node:fs";
import path from "node:path";
import { isSupabasePersistence } from "@/lib/persistence/backend";
import { queryPostgresSync } from "@/lib/postgres/server";
import type {
  WaitlistSignup,
  WaitlistSignupInput,
  WaitlistSignupStatus,
  WaitlistSignupUpsertResult,
} from "@/lib/waitlist-signups";

type SqliteDatabase = import("better-sqlite3").Database;
type SqliteStatement = import("better-sqlite3").Statement;

type WaitlistSignupRow = {
  alreadyExisted?: boolean;
  createdAt: string;
  email: string;
  fileSystemOther: string | null;
  fileSystems: unknown;
  fileSystemsJson?: string;
  firm: string;
  id: string;
  name: string;
  notes: string | null;
  painPoints: unknown;
  painPointsJson?: string;
  phone: string | null;
  source: WaitlistSignup["source"];
  status: WaitlistSignup["status"];
  updatedAt: string;
};

type SqliteStatements = {
  insertSignup: SqliteStatement;
  selectByEmail: SqliteStatement;
  selectById: SqliteStatement;
  selectAll: SqliteStatement;
  updateSignup: SqliteStatement;
  updateSignupStatus: SqliteStatement;
};

const require = createRequire(import.meta.url);
const WAITLIST_SELECT_COLUMNS = `
  id,
  created_at AS "createdAt",
  updated_at AS "updatedAt",
  name,
  email,
  firm,
  phone,
  file_systems AS "fileSystems",
  file_system_other AS "fileSystemOther",
  pain_points AS "painPoints",
  notes,
  status,
  source
`;

let sqliteDatabase: SqliteDatabase | null = null;
let sqliteStatements: SqliteStatements | null = null;

export function upsertWaitlistSignup(
  input: WaitlistSignupInput,
): WaitlistSignupUpsertResult {
  return isSupabasePersistence()
    ? upsertPostgresWaitlistSignup(input)
    : upsertSqliteWaitlistSignup(input);
}

export function getWaitlistSignups(): WaitlistSignup[] {
  if (isSupabasePersistence()) {
    const result = queryPostgresSync<WaitlistSignupRow>(
      `
        SELECT ${WAITLIST_SELECT_COLUMNS}
        FROM public.waitlist_signups
        ORDER BY created_at DESC, id DESC
      `,
    );

    return result.rows
      .map(mapWaitlistSignupRow)
      .filter((signup): signup is WaitlistSignup => Boolean(signup));
  }

  return (getSqliteStatements().selectAll.all() as WaitlistSignupRow[])
    .map(mapWaitlistSignupRow)
    .filter((signup): signup is WaitlistSignup => Boolean(signup));
}

export function setWaitlistSignupStatus(input: {
  id: string;
  status: WaitlistSignupStatus;
}): WaitlistSignup | null {
  if (isSupabasePersistence()) {
    const result = queryPostgresSync<WaitlistSignupRow>(
      `
        UPDATE public.waitlist_signups
        SET status = $2, updated_at = now()
        WHERE id = $1
        RETURNING ${WAITLIST_SELECT_COLUMNS}
      `,
      [input.id, input.status],
    );

    return mapWaitlistSignupRow(result.rows[0]) ?? null;
  }

  const statements = getSqliteStatements();
  statements.updateSignupStatus.run(
    input.status,
    new Date().toISOString(),
    input.id,
  );

  return mapWaitlistSignupRow(
    statements.selectById.get(input.id) as WaitlistSignupRow | undefined,
  ) ?? null;
}

function upsertPostgresWaitlistSignup(
  input: WaitlistSignupInput,
): WaitlistSignupUpsertResult {
  const result = queryPostgresSync<WaitlistSignupRow>(
    `
      WITH existing AS (
        SELECT id
        FROM public.waitlist_signups
        WHERE email = $2
      ),
      upserted AS (
        INSERT INTO public.waitlist_signups (
          name,
          email,
          firm,
          phone,
          file_systems,
          file_system_other,
          pain_points,
          notes,
          source
        ) VALUES ($1, $2, $3, $4, $5::text[], $6, $7::text[], $8, $9)
        ON CONFLICT (email) DO UPDATE
        SET
          name = EXCLUDED.name,
          firm = EXCLUDED.firm,
          phone = EXCLUDED.phone,
          file_systems = EXCLUDED.file_systems,
          file_system_other = EXCLUDED.file_system_other,
          pain_points = EXCLUDED.pain_points,
          notes = EXCLUDED.notes,
          source = EXCLUDED.source,
          updated_at = now()
        RETURNING ${WAITLIST_SELECT_COLUMNS}
      )
      SELECT
        upserted.*,
        EXISTS (SELECT 1 FROM existing) AS "alreadyExisted"
      FROM upserted
    `,
    [
      input.name,
      input.email,
      input.firm,
      input.phone,
      input.fileSystems,
      input.fileSystemOther,
      input.painPoints,
      input.notes,
      input.source,
    ],
  );
  const row = result.rows[0];
  const signup = mapWaitlistSignupRow(row);

  if (!signup) {
    throw new Error("Waitlist signup was not returned after saving.");
  }

  return {
    alreadyExisted: Boolean(row?.alreadyExisted),
    signup,
  };
}

function upsertSqliteWaitlistSignup(
  input: WaitlistSignupInput,
): WaitlistSignupUpsertResult {
  const statements = getSqliteStatements();
  const existing = statements.selectByEmail.get(input.email) as
    | WaitlistSignupRow
    | undefined;
  const now = new Date().toISOString();
  const fileSystemsJson = JSON.stringify(input.fileSystems);
  const painPointsJson = JSON.stringify(input.painPoints);

  if (existing) {
    statements.updateSignup.run(
      now,
      input.name,
      input.firm,
      input.phone,
      fileSystemsJson,
      input.fileSystemOther,
      painPointsJson,
      input.notes,
      input.source,
      input.email,
    );
  } else {
    statements.insertSignup.run(
      crypto.randomUUID(),
      now,
      now,
      input.name,
      input.email,
      input.firm,
      input.phone,
      fileSystemsJson,
      input.fileSystemOther,
      painPointsJson,
      input.notes,
      "new",
      input.source,
    );
  }

  const signup = mapWaitlistSignupRow(
    statements.selectByEmail.get(input.email) as WaitlistSignupRow | undefined,
  );

  if (!signup) {
    throw new Error("Waitlist signup was not returned after saving.");
  }

  return {
    alreadyExisted: Boolean(existing),
    signup,
  };
}

function getSqliteStatements(): SqliteStatements {
  if (sqliteStatements) {
    return sqliteStatements;
  }

  const database = getSqliteDatabase();
  sqliteStatements = {
    insertSignup: database.prepare(`
      INSERT INTO waitlist_signups (
        id,
        created_at,
        updated_at,
        name,
        email,
        firm,
        phone,
        file_systems_json,
        file_system_other,
        pain_points_json,
        notes,
        status,
        source
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `),
    selectAll: database.prepare(`
      SELECT ${sqliteWaitlistSelectColumns()}
      FROM waitlist_signups
      ORDER BY created_at DESC, id DESC
    `),
    selectByEmail: database.prepare(`
      SELECT ${sqliteWaitlistSelectColumns()}
      FROM waitlist_signups
      WHERE email = ?
      LIMIT 1
    `),
    selectById: database.prepare(`
      SELECT ${sqliteWaitlistSelectColumns()}
      FROM waitlist_signups
      WHERE id = ?
      LIMIT 1
    `),
    updateSignup: database.prepare(`
      UPDATE waitlist_signups
      SET
        updated_at = ?,
        name = ?,
        firm = ?,
        phone = ?,
        file_systems_json = ?,
        file_system_other = ?,
        pain_points_json = ?,
        notes = ?,
        source = ?
      WHERE email = ?
    `),
    updateSignupStatus: database.prepare(`
      UPDATE waitlist_signups
      SET status = ?, updated_at = ?
      WHERE id = ?
    `),
  };

  return sqliteStatements;
}

function getSqliteDatabase(): SqliteDatabase {
  if (sqliteDatabase) {
    return sqliteDatabase;
  }

  const Database = require("better-sqlite3") as typeof import("better-sqlite3");
  const dataDir = path.join(process.cwd(), "data");
  fs.mkdirSync(dataDir, { recursive: true });

  sqliteDatabase = new Database(path.join(dataDir, "ria-file-ops.db"));
  sqliteDatabase.exec(`
    CREATE TABLE IF NOT EXISTS waitlist_signups (
      id TEXT PRIMARY KEY,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      name TEXT NOT NULL,
      email TEXT NOT NULL UNIQUE COLLATE NOCASE,
      firm TEXT NOT NULL,
      phone TEXT,
      file_systems_json TEXT NOT NULL DEFAULT '[]',
      file_system_other TEXT,
      pain_points_json TEXT NOT NULL DEFAULT '[]',
      notes TEXT,
      status TEXT NOT NULL DEFAULT 'new',
      source TEXT NOT NULL DEFAULT 'join_waitlist_page'
    );

    CREATE INDEX IF NOT EXISTS waitlist_signups_created_at_idx
      ON waitlist_signups (created_at);

    CREATE INDEX IF NOT EXISTS waitlist_signups_status_idx
      ON waitlist_signups (status);
  `);

  return sqliteDatabase;
}

function sqliteWaitlistSelectColumns() {
  return `
    id,
    created_at AS "createdAt",
    updated_at AS "updatedAt",
    name,
    email,
    firm,
    phone,
    file_systems_json AS "fileSystemsJson",
    file_system_other AS "fileSystemOther",
    pain_points_json AS "painPointsJson",
    notes,
    status,
    source
  `;
}

function mapWaitlistSignupRow(
  row: WaitlistSignupRow | undefined,
): WaitlistSignup | undefined {
  if (!row) {
    return undefined;
  }

  return {
    createdAt: row.createdAt,
    email: row.email,
    fileSystemOther: row.fileSystemOther,
    fileSystems: normalizeStringArray(row.fileSystemsJson ?? row.fileSystems).filter(
      (value): value is WaitlistSignup["fileSystems"][number] =>
        typeof value === "string",
    ),
    firm: row.firm,
    id: row.id,
    name: row.name,
    notes: row.notes,
    painPoints: normalizeStringArray(row.painPointsJson ?? row.painPoints).filter(
      (value): value is WaitlistSignup["painPoints"][number] =>
        typeof value === "string",
    ),
    phone: row.phone,
    source: row.source,
    status: row.status,
    updatedAt: row.updatedAt,
  };
}

function normalizeStringArray(value: unknown) {
  if (Array.isArray(value)) {
    return value.filter((item): item is string => typeof item === "string");
  }

  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value) as unknown;
      return Array.isArray(parsed)
        ? parsed.filter((item): item is string => typeof item === "string")
        : [];
    } catch {
      return [];
    }
  }

  return [];
}

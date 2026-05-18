import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  getPersistenceBackend,
  isSupabasePersistence,
} from "../lib/persistence/backend.ts";
import {
  isProductionLikeRuntime,
  isRealDataPreviewRuntime,
} from "../lib/runtime-environment.ts";
import { writePreviewSnapshot } from "../lib/preview-snapshot.ts";

const VALID_APP_ENCRYPTION_KEY =
  "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";

test("production-like runtime without PERSISTENCE_BACKEND fails closed", () => {
  assert.throws(
    () =>
      getPersistenceBackend({
        NODE_ENV: "production",
      }),
    /PERSISTENCE_BACKEND is required/i,
  );
});

test("production-like runtime with PERSISTENCE_BACKEND=sqlite fails closed", () => {
  assert.throws(
    () =>
      getPersistenceBackend({
        VERCEL_ENV: "production",
        PERSISTENCE_BACKEND: "sqlite",
      }),
    /sqlite.*not allowed/i,
  );
});

test("invalid PERSISTENCE_BACKEND error does not include raw env value", () => {
  const rawInvalidValue = "invalid-backend-sensitive-sentinel";

  assert.throws(
    () =>
      getPersistenceBackend({
        NODE_ENV: "development",
        PERSISTENCE_BACKEND: rawInvalidValue,
      }),
    (error) => {
      assert.match(
        error.message,
        /Unsupported PERSISTENCE_BACKEND value\. Expected one of: supabase, sqlite\./,
      );
      assert.equal(error.message.includes(rawInvalidValue), false);
      assert.equal(error.message.includes("sensitive-sentinel"), false);
      return true;
    },
  );
});

test("production-like runtime with complete Supabase config selects Supabase", () => {
  const env = {
    APP_ENV: "production",
    PERSISTENCE_BACKEND: "supabase",
    SUPABASE_DB_URL_POOLER: "supabase-pooler-db-url",
    APP_ENCRYPTION_KEY: VALID_APP_ENCRYPTION_KEY,
  };

  assert.equal(getPersistenceBackend(env), "supabase");
  assert.equal(isSupabasePersistence(env), true);
});

test("production-like Supabase config requires database URL and encryption key", () => {
  assert.throws(
    () =>
      getPersistenceBackend({
        APP_ENV: "production",
        PERSISTENCE_BACKEND: "supabase",
      }),
    /SUPABASE_DB_URL_POOLER or SUPABASE_DB_URL.*APP_ENCRYPTION_KEY/i,
  );

  assert.throws(
    () =>
      getPersistenceBackend({
        APP_ENV: "production",
        PERSISTENCE_BACKEND: "supabase",
        SUPABASE_DB_URL: "supabase-direct-db-url",
        APP_ENCRYPTION_KEY: "not-a-valid-key",
      }),
    /APP_ENCRYPTION_KEY must decode to exactly 32 bytes/i,
  );
});

test("local and test runtimes keep explicit SQLite behavior", () => {
  assert.equal(getPersistenceBackend({ NODE_ENV: "test" }), "sqlite");
  assert.equal(
    getPersistenceBackend({
      NODE_ENV: "production",
      APP_ENV: "local",
    }),
    "sqlite",
  );
  assert.equal(
    getPersistenceBackend({
      NODE_ENV: "development",
      PERSISTENCE_BACKEND: "sqlite",
    }),
    "sqlite",
  );
});

test("real-data preview markers are production-like", () => {
  const env = {
    VERCEL_ENV: "preview",
    NODE_ENV: "development",
    DATA_INTELLIGENCE_V2_DEV_MOCK_ENABLED: "false",
    DATA_INTELLIGENCE_V2_ALLOW_SENSITIVE_REVEAL: "true",
  };

  assert.equal(isRealDataPreviewRuntime(env), true);
  assert.equal(isProductionLikeRuntime(env), true);
  assert.throws(() => getPersistenceBackend(env), /real-data preview/i);
});

test("production-like runtime does not write local data files when misconfigured", async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "prod-persistence-"));
  const previousCwd = process.cwd();
  const previousNodeEnv = process.env.NODE_ENV;
  const previousBackend = process.env.PERSISTENCE_BACKEND;

  try {
    process.chdir(tempDir);
    process.env.NODE_ENV = "production";
    delete process.env.PERSISTENCE_BACKEND;

    assert.throws(
      () =>
        getPersistenceBackend({
          NODE_ENV: "production",
        }),
      /PERSISTENCE_BACKEND is required/i,
    );
    await assert.rejects(
      () =>
        writePreviewSnapshot({
          destinationRoot: null,
          items: [],
          readyCount: 0,
          reviewCount: 0,
          reviewPosture: "test",
          sourceFolder: null,
        }),
      /PERSISTENCE_BACKEND is required/i,
    );
    assert.equal(fs.existsSync(path.join(tempDir, "data")), false);
  } finally {
    if (previousNodeEnv === undefined) {
      delete process.env.NODE_ENV;
    } else {
      process.env.NODE_ENV = previousNodeEnv;
    }
    if (previousBackend === undefined) {
      delete process.env.PERSISTENCE_BACKEND;
    } else {
      process.env.PERSISTENCE_BACKEND = previousBackend;
    }
    process.chdir(previousCwd);
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

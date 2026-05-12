import assert from "node:assert/strict";
import test from "node:test";

import {
  getClientMemoryRulesByOwnerEmail,
  getFilingEventByOwnerAndId,
  getFilingEventsByOwnerEmail,
  getFirmSettingsByOwnerEmail,
  getPrimaryStorageConnectionByOwnerEmail,
  getReviewDecisionByOwnerAndFile,
  getReviewDecisionsByOwnerEmail,
  getStorageConnectionByOwnerAndId,
  getStorageConnectionsByOwnerEmail,
} from "../lib/db.ts";
import { readPreviewSnapshot } from "../lib/preview-snapshot.ts";

const ownerEmail = "owner@example.com";

test("Supabase read-only app-state calls fall back when persistence is unavailable", async (t) => {
  const previousBackend = process.env.PERSISTENCE_BACKEND;
  const previousPooler = process.env.SUPABASE_DB_URL_POOLER;
  const previousDirect = process.env.SUPABASE_DB_URL;
  const warn = t.mock.method(console, "warn", () => {});

  process.env.PERSISTENCE_BACKEND = "supabase";
  delete process.env.SUPABASE_DB_URL_POOLER;
  delete process.env.SUPABASE_DB_URL;

  try {
    assert.equal(getFirmSettingsByOwnerEmail(ownerEmail), undefined);
    assert.deepEqual(getReviewDecisionsByOwnerEmail(ownerEmail), []);
    assert.deepEqual(getClientMemoryRulesByOwnerEmail(ownerEmail), []);
    assert.equal(getReviewDecisionByOwnerAndFile(ownerEmail, "file-1"), undefined);
    assert.deepEqual(getFilingEventsByOwnerEmail(ownerEmail), []);
    assert.equal(getFilingEventByOwnerAndId(ownerEmail, "event-1"), null);
    assert.deepEqual(getStorageConnectionsByOwnerEmail(ownerEmail), []);
    assert.equal(getPrimaryStorageConnectionByOwnerEmail(ownerEmail), undefined);
    assert.equal(
      getStorageConnectionByOwnerAndId(ownerEmail, "connection-1"),
      undefined,
    );
    assert.equal(await readPreviewSnapshot(ownerEmail), null);
    assert.equal(warn.mock.callCount() >= 1, true);
  } finally {
    if (previousBackend === undefined) {
      delete process.env.PERSISTENCE_BACKEND;
    } else {
      process.env.PERSISTENCE_BACKEND = previousBackend;
    }

    if (previousPooler === undefined) {
      delete process.env.SUPABASE_DB_URL_POOLER;
    } else {
      process.env.SUPABASE_DB_URL_POOLER = previousPooler;
    }

    if (previousDirect === undefined) {
      delete process.env.SUPABASE_DB_URL;
    } else {
      process.env.SUPABASE_DB_URL = previousDirect;
    }
  }
});

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const TEST_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(TEST_DIR, "../..");
const DOC_PATH = path.join(
  REPO_ROOT,
  "docs/data-intelligence-v2/supabase-cli-auth-troubleshooting.md",
);

const RAW_SSN = "123-45-6789";
const RAW_ACCOUNT = "9876543210123456";

test("Supabase CLI auth troubleshooting doc is safe and actionable", async () => {
  const source = await readFile(DOC_PATH, "utf8");

  assert.match(source, /supabase migration list/i);
  assert.match(source, /before any controlled preview migration apply/i);
  assert.match(source, /20260424/);
  assert.match(source, /20260425/);
  assert.match(source, /20260426/);
  assert.match(source, /20260429/);
  assert.match(source, /20260430/);
  assert.match(source, /SUPABASE_ACCESS_TOKEN/);
  assert.match(source, /SUPABASE_DB_PASSWORD/);
  assert.match(source, /SUPABASE_PROJECT_ID/);
  assert.match(source, /circuit breaker/i);
  assert.match(source, /Do not run migration repair/i);

  assertNoSensitiveOutput(source);
});

function assertNoSensitiveOutput(output) {
  assert.equal(output.includes(RAW_SSN), false);
  assert.equal(output.includes(RAW_ACCOUNT), false);
  assert.equal(/\bsk-[A-Za-z0-9_-]{12,}\b/.test(output), false);
  assert.equal(/postgres(?:ql)?:\/\/[^"\s]+/i.test(output), false);
  assert.equal(/SUPABASE_DB_PASSWORD\s*=\s*[^`\s]+/.test(output), false);
}

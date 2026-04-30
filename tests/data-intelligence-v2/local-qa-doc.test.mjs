import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const TEST_DIR = path.dirname(fileURLToPath(import.meta.url));
const DOC_PATH = path.resolve(
  TEST_DIR,
  "../../docs/data-intelligence-v2/local-qa.md",
);

test("local QA doc covers dev mock setup and safety checks", async () => {
  const source = await readFile(DOC_PATH, "utf8");

  for (const flag of [
    "DATA_INTELLIGENCE_V2_ENABLED=true",
    "DATA_INTELLIGENCE_V2_CHAT_API_ENABLED=true",
    "DATA_INTELLIGENCE_V2_REVEAL_API_ENABLED=true",
    "DATA_INTELLIGENCE_V2_UI_ENABLED=true",
    "DATA_INTELLIGENCE_V2_ALLOW_SENSITIVE_REVEAL=true",
    "DATA_INTELLIGENCE_V2_DEV_MOCK_ENABLED=true",
  ]) {
    assert.match(source, new RegExp(escapeRegExp(flag)));
  }

  assert.match(source, /disabled when `NODE_ENV=production`/);
  assert.match(source, /\/api\/data-intelligence\/v2\/chat/);
  assert.match(source, /\/api\/data-intelligence\/v2\/reveal/);
  assert.match(source, /not `\/api\/query-assistant`/);
  assert.match(source, /does not call OpenAI/);
  assert.match(source, /localStorage or sessionStorage/);
  assert.equal(source.includes("9999000011112222"), false);
  assert.equal(source.includes("999-99-1234"), false);
  assert.equal(/sk-[A-Za-z0-9]{20,}/.test(source), false);
  assert.equal(/(?:access|refresh)[_-]?token\s*[:=]/i.test(source), false);
});

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

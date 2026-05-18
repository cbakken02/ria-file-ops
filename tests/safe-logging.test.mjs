import assert from "node:assert/strict";
import test from "node:test";

import {
  getSafeErrorMetadata,
  hashLogIdentifier,
  redactSensitiveLogText,
} from "../lib/safe-logging.ts";

test("redactSensitiveLogText removes sensitive-shaped log details", () => {
  const redacted = redactSensitiveLogText(
    "Failed for advisor@example.test with password=placeholder-value",
  );

  assert.equal(redacted.includes("advisor@example.test"), false);
  assert.equal(redacted.includes("placeholder-value"), false);
  assert.match(redacted, /\[redacted-email\]/);
  assert.match(redacted, /password=\[redacted\]/);
});

test("getSafeErrorMetadata can omit provider error messages", () => {
  const metadata = getSafeErrorMetadata(
    new Error("Provider failed for user@example.test"),
    { includeMessage: false },
  );

  assert.deepEqual(metadata, { errorName: "Error" });
});

test("getSafeErrorMetadata truncates long redacted messages", () => {
  const metadata = getSafeErrorMetadata(
    new Error(`problem ${"x".repeat(400)}`),
  );

  assert.equal(metadata.errorName, "Error");
  assert.ok(metadata.message);
  assert.equal(metadata.message.length, 243);
  assert.equal(metadata.message.endsWith("..."), true);
});

test("hashLogIdentifier is stable and does not expose raw identifiers", () => {
  const first = hashLogIdentifier("drive-file-id-for-test");
  const second = hashLogIdentifier("drive-file-id-for-test");

  assert.equal(first, second);
  assert.match(first, /^[a-f0-9]{12}$/);
  assert.equal(first.includes("drive-file-id-for-test"), false);
});

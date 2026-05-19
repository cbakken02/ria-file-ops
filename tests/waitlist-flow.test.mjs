import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  WAITLIST_GENERIC_FAILURE_MESSAGE,
  WAITLIST_RATE_LIMIT_MESSAGE,
  checkWaitlistSubmissionAbuse,
} from "../lib/waitlist-abuse-protection.ts";
import {
  WAITLIST_HONEYPOT_FIELD_NAME,
  validateWaitlistSignupFormData,
} from "../lib/waitlist-signups.ts";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function readRepoFile(relativePath) {
  return fs.readFileSync(path.join(repoRoot, relativePath), "utf8");
}

function createValidWaitlistFormData(email = "jane@example.com") {
  const formData = new FormData();
  formData.set("name", "Jane Advisor");
  formData.set("email", email);
  formData.set("firm", "Advisory Ops LLC");
  formData.append("fileSystems", "google_drive");
  return formData;
}

test("waitlist validation normalizes email and rejects invalid selections", () => {
  const valid = new FormData();
  valid.set("name", "  Jane Advisor  ");
  valid.set("email", "  JANE@Example.COM ");
  valid.set("firm", " Advisory Ops LLC ");
  valid.append("fileSystems", "google_drive");
  valid.append("fileSystems", "google_drive");
  valid.append("fileSystems", "sharepoint_onedrive");
  valid.append("painPoints", "inconsistent_file_names");

  const result = validateWaitlistSignupFormData(valid);
  assert.equal(result.ok, true);
  assert.equal(result.input.email, "jane@example.com");
  assert.deepEqual(result.input.fileSystems, [
    "google_drive",
    "sharepoint_onedrive",
  ]);
  assert.deepEqual(result.input.painPoints, ["inconsistent_file_names"]);

  const invalid = new FormData();
  invalid.set("name", "Jane Advisor");
  invalid.set("email", "jane@example.com");
  invalid.set("firm", "Advisory Ops LLC");
  invalid.append("fileSystems", "google_drive");
  invalid.append("fileSystems", "unexpected_storage");

  const invalidResult = validateWaitlistSignupFormData(invalid);
  assert.equal(invalidResult.ok, false);
  assert.equal(invalidResult.fieldErrors.fileSystems, "Select a valid file location.");
});

test("valid waitlist submissions pass basic abuse protection", () => {
  const result = checkWaitlistSubmissionAbuse({
    formData: createValidWaitlistFormData(),
    headers: new Headers({ "x-forwarded-for": "203.0.113.70" }),
    store: new Map(),
  });

  assert.equal(result.ok, true);
});

test("honeypot-filled waitlist submissions are rejected with a generic message", () => {
  const formData = createValidWaitlistFormData();
  formData.set(WAITLIST_HONEYPOT_FIELD_NAME, "https://bot.example");

  const result = checkWaitlistSubmissionAbuse({
    formData,
    headers: new Headers({ "x-forwarded-for": "203.0.113.71" }),
    store: new Map(),
  });

  assert.equal(result.ok, false);
  assert.equal(result.message, WAITLIST_GENERIC_FAILURE_MESSAGE);
  assert.doesNotMatch(result.message, /honeypot|bot|spam/i);
});

test("waitlist submissions are rate limited by email and IP without raw identifiers", () => {
  const emailStore = new Map();
  const headers = new Headers({ "x-forwarded-for": "203.0.113.72" });

  for (let index = 0; index < 3; index += 1) {
    assert.equal(
      checkWaitlistSubmissionAbuse({
        formData: createValidWaitlistFormData("jane@example.com"),
        headers,
        now: 1_000 + index,
        store: emailStore,
      }).ok,
      true,
    );
  }

  const emailLimited = checkWaitlistSubmissionAbuse({
    formData: createValidWaitlistFormData("JANE@EXAMPLE.COM"),
    headers,
    now: 2_000,
    store: emailStore,
  });
  assert.equal(emailLimited.ok, false);
  assert.equal(emailLimited.message, WAITLIST_RATE_LIMIT_MESSAGE);
  assert.equal(JSON.stringify([...emailStore.keys()]).includes("jane@example.com"), false);

  const ipStore = new Map();
  for (let index = 0; index < 5; index += 1) {
    assert.equal(
      checkWaitlistSubmissionAbuse({
        formData: createValidWaitlistFormData(`person-${index}@example.com`),
        headers: new Headers({ "x-forwarded-for": "203.0.113.73" }),
        now: 3_000 + index,
        store: ipStore,
      }).ok,
      true,
    );
  }

  const ipLimited = checkWaitlistSubmissionAbuse({
    formData: createValidWaitlistFormData("person-six@example.com"),
    headers: new Headers({ "x-forwarded-for": "203.0.113.73" }),
    now: 4_000,
    store: ipStore,
  });
  assert.equal(ipLimited.ok, false);
  assert.equal(ipLimited.message, WAITLIST_RATE_LIMIT_MESSAGE);
  assert.equal(JSON.stringify([...ipStore.keys()]).includes("203.0.113.73"), false);
});

test("landing page routes waitlist CTAs to the restored waitlist flow", () => {
  const pageSource = readRepoFile("app/page.tsx");
  const demoSource = readRepoFile("app/guided-filing-demo.tsx");
  const combinedSource = `${pageSource}\n${demoSource}`;

  assert.match(pageSource, /waitlistHref = "\/join-waitlist"/);
  assert.match(pageSource, /GuidedFilingDemo/);
  assert.match(pageSource, /FAQAccordion/);
  assert.match(pageSource, /Document intelligence for RIA operations/);
  assert.match(pageSource, /Clean up files\. Extract client data\. Prep advisor workflows\./);
  assert.equal(pageSource.includes("mailto:"), false);
  assert.equal(pageSource.includes("See Workflow"), false);

  for (const expectedDemoCopy of [
    "Drag statement.pdf into Client Uploads.",
    "Detect upload",
    "Edit Details",
    "Save Details",
    "Approve & File",
    "Schwab",
  ]) {
    assert.match(
      combinedSource,
      new RegExp(expectedDemoCopy.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")),
    );
  }
  assert.match(combinedSource, /Your team still approves the\s+final move\./);
});

test("waitlist admin and export routes require explicit admin authorization", () => {
  const adminGuardSource = readRepoFile("lib/admin.ts");
  const adminPageSource = readRepoFile("app/admin/waitlist/page.tsx");
  const exportRouteSource = readRepoFile("app/admin/waitlist/export/route.ts");
  const adminActionSource = readRepoFile("app/admin/waitlist/actions.ts");

  assert.match(adminGuardSource, /auth\(\)/);
  assert.match(adminGuardSource, /WAITLIST_ADMIN_EMAILS/);
  assert.match(adminGuardSource, /ADMIN_EMAILS/);
  assert.match(adminGuardSource, /notFound\(\)/);
  assert.match(adminGuardSource, /redirect\("\/login"\)/);
  assert.match(adminPageSource, /await requireWaitlistAdminSession\(\)/);
  assert.match(exportRouteSource, /await requireWaitlistAdminSession\(\)/);
  assert.match(adminActionSource, /await requireWaitlistAdminSession\(\)/);
});

test("waitlist migration is additive and keeps the public table behind RLS", () => {
  const migrationSource = readRepoFile(
    "supabase/migrations/20260516025839_create_waitlist_signups.sql",
  );

  assert.match(migrationSource, /create table if not exists public\.waitlist_signups/i);
  assert.match(migrationSource, /create unique index if not exists waitlist_signups_email_idx/i);
  assert.match(migrationSource, /enable row level security/i);
  assert.doesNotMatch(migrationSource, /\b(drop|truncate|delete)\b/i);
});

test("waitlist persistence stays behind the central persistence backend boundary", () => {
  const storeSource = readRepoFile("lib/waitlist-store.ts");
  const actionSource = readRepoFile("app/join-waitlist/actions.ts");
  const formSource = readRepoFile("app/join-waitlist/waitlist-form.tsx");

  assert.match(storeSource, /isSupabasePersistence/);
  assert.match(storeSource, /queryPostgresSync/);
  assert.match(storeSource, /getSqliteDatabase/);
  assert.match(actionSource, /getSafeErrorMetadata/);
  assert.match(actionSource, /checkWaitlistSubmissionAbuse/);
  assert.match(actionSource, /await headers\(\)/);
  assert.match(formSource, /WAITLIST_HONEYPOT_FIELD_NAME/);
  assert.equal(actionSource.includes("console.error(\"[waitlist] signup failed\", error)"), false);
});

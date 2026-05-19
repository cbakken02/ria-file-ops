import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { validateWaitlistSignupFormData } from "../lib/waitlist-signups.ts";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function readRepoFile(relativePath) {
  return fs.readFileSync(path.join(repoRoot, relativePath), "utf8");
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

  assert.match(storeSource, /isSupabasePersistence/);
  assert.match(storeSource, /queryPostgresSync/);
  assert.match(storeSource, /getSqliteDatabase/);
  assert.match(actionSource, /getSafeErrorMetadata/);
  assert.equal(actionSource.includes("console.error(\"[waitlist] signup failed\", error)"), false);
});

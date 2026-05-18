import assert from "node:assert/strict";
import test from "node:test";

import {
  AppPrincipalError,
  assertOwnerKeyMatchesPrincipal,
  buildWorkspaceIdFromOwnerKey,
  getApiPrincipalFromSession,
  getAppPrincipalFromSession,
  getLegacyOwnerEmail,
  normalizeOwnerEmail,
} from "../lib/auth/principal.ts";

test("principal normalizes email and keeps legacy owner compatibility", () => {
  const principal = getAppPrincipalFromSession({
    user: {
      email: "  OWNER@Example.COM  ",
      id: "google-user-1",
    },
  });

  assert.equal(principal.userId, "google-user-1");
  assert.equal(principal.email, "owner@example.com");
  assert.equal(principal.normalizedEmail, "owner@example.com");
  assert.equal(principal.ownerKey, "owner@example.com");
  assert.equal(principal.legacyOwnerEmail, "owner@example.com");
  assert.equal(getLegacyOwnerEmail(principal), "owner@example.com");
  assert.equal(principal.role, "owner");
  assert.equal(
    principal.workspaceId,
    buildWorkspaceIdFromOwnerKey("owner@example.com"),
  );
});

test("principal workspace id is stable and derived from the owner key", () => {
  const first = buildWorkspaceIdFromOwnerKey("Owner@Example.com");
  const second = buildWorkspaceIdFromOwnerKey(" owner@example.com ");

  assert.equal(first, second);
  assert.match(first, /^workspace:[a-f0-9]{16}$/);
});

test("missing principal email fails closed", () => {
  assert.throws(
    () => normalizeOwnerEmail("   "),
    (error) =>
      error instanceof AppPrincipalError &&
      error.status === 401 &&
      error.message === "A signed-in email is required.",
  );

  assert.throws(
    () => getAppPrincipalFromSession({ user: { email: "" } }),
    AppPrincipalError,
  );
});

test("API principal helper returns unauthorized for no session", async () => {
  const result = await getApiPrincipalFromSession(null);

  assert.equal(result.ok, false);
  assert.equal(result.status, 401);
  assert.equal(result.response.status, 401);
});

test("owner-key assertion normalizes compatible legacy owner values", () => {
  const principal = getAppPrincipalFromSession({
    user: { email: "owner@example.com" },
  });

  assert.doesNotThrow(() =>
    assertOwnerKeyMatchesPrincipal(principal, "  OWNER@example.com "),
  );
  assert.throws(
    () => assertOwnerKeyMatchesPrincipal(principal, "other@example.com"),
    (error) => error instanceof AppPrincipalError && error.status === 403,
  );
});

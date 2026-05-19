import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  getGoogleSignInAuthorizationParams,
  shouldForceGoogleAccountSelection,
} from "../lib/auth/google-signin.ts";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function readRepoFile(relativePath) {
  return fs.readFileSync(path.join(repoRoot, relativePath), "utf8");
}

test("explicit app logout is the only login-page reason that forces Google account selection", () => {
  assert.equal(shouldForceGoogleAccountSelection("logged_out"), true);

  for (const reason of [
    undefined,
    null,
    "",
    "idle_timeout",
    "absolute_timeout",
    "invalidated",
    "access_denied",
    "unauthorized",
  ]) {
    assert.equal(shouldForceGoogleAccountSelection(reason), false);
  }
});

test("post-logout Google sign-in requests account picker without forcing password reauth or consent", () => {
  assert.deepEqual(
    getGoogleSignInAuthorizationParams({ forceAccountSelection: true }),
    { prompt: "select_account" },
  );
  assert.equal(
    getGoogleSignInAuthorizationParams({ forceAccountSelection: false }),
    undefined,
  );
});

test("login page wires explicit logout reason to the Google account picker prompt", () => {
  const loginSource = readRepoFile("app/login/page.tsx");
  const buttonSource = readRepoFile("components/google-sign-in-button.tsx");

  assert.match(loginSource, /shouldForceGoogleAccountSelection\(reason\)/);
  assert.match(
    loginSource,
    /forceAccountSelection=\{forceAccountSelection\}/,
  );
  assert.match(
    buttonSource,
    /signIn\("google", \{ callbackUrl \}, authorizationParams\)/,
  );
  assert.match(buttonSource, /getGoogleSignInAuthorizationParams/);
  assert.doesNotMatch(`${loginSource}\n${buttonSource}`, /prompt:\s*"login"/);
  assert.doesNotMatch(`${loginSource}\n${buttonSource}`, /prompt:\s*"consent"/);
});

test("explicit logout clears app session state before returning to post-logout login", () => {
  const accountMenuSource = readRepoFile("components/account-menu.tsx");
  const signOutButtonSource = readRepoFile("components/sign-out-button.tsx");
  const logoutRouteSource = readRepoFile("app/api/session/logout/route.ts");

  for (const source of [accountMenuSource, signOutButtonSource]) {
    assert.match(source, /fetch\("\/api\/session\/logout"/);
    assert.match(source, /method:\s*"POST"/);
    assert.match(
      source,
      /signOut\(\{\s*callbackUrl:\s*"\/login\?reason=logged_out"/s,
    );
  }

  assert.match(logoutRouteSource, /invalidateSessionActivityForSession/);
  assert.doesNotMatch(logoutRouteSource, /deleteStorageConnection/i);
});

test("dashboard still depends on server-side app session verification", () => {
  const dashboardSource = readRepoFile("app/dashboard/page.tsx");
  const sessionSource = readRepoFile("lib/session.ts");
  const principalSource = readRepoFile("lib/auth/principal.ts");

  assert.match(dashboardSource, /await requireSession\(\)/);
  assert.match(sessionSource, /auth\(\)/);
  assert.match(sessionSource, /getAppPrincipalResultFromSession\(session\)/);
  assert.match(sessionSource, /redirect\(loginPath\)/);
  assert.match(principalSource, /enforceSessionActivity\(session, principal/);
});

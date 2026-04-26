import assert from "node:assert/strict";
import test from "node:test";

import {
  normalizeRequestHost,
  shouldRedirectToCanonicalProductionHost,
} from "../lib/vercel-canonical-host.ts";

test("proxy keeps Vercel preview deployments on their branch preview host", () => {
  assert.equal(
    shouldRedirectToCanonicalProductionHost({
      host: "ria-file-ops-git-chore-local-de-824f7c-cbakken02-1285s-projects.vercel.app",
      vercelEnv: "preview",
    }),
    false,
  );
});

test("proxy redirects production deployment aliases to the canonical production host", () => {
  assert.equal(
    shouldRedirectToCanonicalProductionHost({
      host: "ria-file-ffz7py4oo-cbakken02-1285s-projects.vercel.app",
      vercelEnv: "production",
    }),
    true,
  );
});

test("proxy leaves the canonical production host alone", () => {
  assert.equal(
    shouldRedirectToCanonicalProductionHost({
      host: "ria-file-ops.vercel.app",
      vercelEnv: "production",
    }),
    false,
  );
});

test("proxy normalizes forwarded hosts before redirect checks", () => {
  assert.equal(
    normalizeRequestHost("RIA-FILE-OPS.VERCEL.APP:443"),
    "ria-file-ops.vercel.app",
  );
});

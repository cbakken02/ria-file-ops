import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { PRODUCT_NAV_ITEMS } from "../lib/product-navigation.ts";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));

function readRepoFile(relativePath) {
  return readFileSync(path.join(repoRoot, relativePath), "utf8");
}

test("product navigation uses current workspace route names", () => {
  assert.deepEqual(
    PRODUCT_NAV_ITEMS.map((item) => ({
      href: item.href,
      label: item.label,
    })),
    [
      { href: "/dashboard", label: "Dashboard" },
      { href: "/intake", label: "Intake" },
      { href: "/clean-up", label: "Clean Up" },
      { href: "/data-intelligence", label: "Data Intelligence" },
      { href: "/history", label: "Filing history" },
    ],
  );
});

test("product shell prefetches workspace navigation instead of blocking clicks", () => {
  const shellSource = readRepoFile("components/product-shell.tsx");
  const navSource = readRepoFile("components/product-nav.tsx");

  assert.equal(shellSource.includes("prefetch={false}"), false);
  assert.match(navSource, /prefetch=\{true\}/);
  assert.match(navSource, /router\.prefetch\(item\.href\)/);
  assert.match(navSource, /onNavigate=\{setOptimisticPath\}/);
  assert.match(navSource, /onNavigate=\{\(\) => onNavigate\(item\.href\)\}/);
});

import assert from "node:assert/strict";
import test from "node:test";

import { PRODUCT_NAV_ITEMS } from "../lib/product-navigation.ts";

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

import assert from "node:assert/strict";
import test from "node:test";

import { serializeJsonbParameter } from "../lib/persistence/supabase-app-state-store.ts";

test("Supabase jsonb parameters are serialized as valid JSON strings", () => {
  assert.equal(serializeJsonbParameter(["parent-1", "parent-2"]), '["parent-1","parent-2"]');
  assert.equal(serializeJsonbParameter(["reason"]), '["reason"]');
  assert.equal(serializeJsonbParameter(null), null);
  assert.equal(serializeJsonbParameter(undefined), null);
});

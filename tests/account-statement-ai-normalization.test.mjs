import assert from "node:assert/strict";
import test from "node:test";

import {
  normalizeAccountStatementAccountType,
} from "../lib/account-statement-ai-normalization.ts";

test("account statement account type normalization maps branded checking labels to Checking", () => {
  const normalized = normalizeAccountStatementAccountType(
    "U.S. Bank Smartly Checking",
  );

  assert.deepEqual(normalized, {
    rawValue: "U.S. Bank Smartly Checking",
    finalValue: "Checking",
    changed: true,
    ruleId: "checking_keyword",
  });
});

test("account statement account type normalization canonicalizes Roth IRA aliases", () => {
  const normalized = normalizeAccountStatementAccountType(
    "Roth Individual Retirement Account",
  );

  assert.deepEqual(normalized, {
    rawValue: "Roth Individual Retirement Account",
    finalValue: "Roth IRA",
    changed: true,
    ruleId: "roth_ira",
  });
});

test("account statement account type normalization canonicalizes 401k aliases", () => {
  const normalized = normalizeAccountStatementAccountType("401k plan");

  assert.deepEqual(normalized, {
    rawValue: "401k plan",
    finalValue: "401(k)",
    changed: true,
    ruleId: "401k",
  });
});

test("account statement account type normalization preserves annuity subtype specificity", () => {
  const normalized = normalizeAccountStatementAccountType(
    "Corebridge Fixed Indexed Annuity",
  );

  assert.deepEqual(normalized, {
    rawValue: "Corebridge Fixed Indexed Annuity",
    finalValue: "Fixed Indexed Annuity",
    changed: true,
    ruleId: "fixed_indexed_annuity",
  });
});

test("account statement account type normalization leaves unknown values raw and unmodified", () => {
  const normalized = normalizeAccountStatementAccountType(
    "Premier Advisory Relationship",
  );

  assert.deepEqual(normalized, {
    rawValue: "Premier Advisory Relationship",
    finalValue: "Premier Advisory Relationship",
    changed: false,
    ruleId: null,
  });
});

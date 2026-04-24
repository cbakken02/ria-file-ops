import type { CanonicalAccountValue } from "@/lib/canonical-extracted-document";

type NormalizationRule = {
  id: string;
  finalValue: string;
  matches: (value: string) => boolean;
};

type InstitutionNormalizationRule = NormalizationRule & {
  rawValue: string | null;
  rawPatterns: RegExp[];
};

type ValueKindNormalizationRule = {
  id: string;
  finalValue: CanonicalAccountValue["kind"];
  matches: (value: string) => boolean;
};

export type NormalizedAccountStatementField = {
  rawValue: string | null;
  finalValue: string | null;
  changed: boolean;
  ruleId: string | null;
};

const CUSTODIAN_NORMALIZATION_RULES: InstitutionNormalizationRule[] = [
  {
    id: "us_bank_national_association",
    rawValue: "U.S. Bank National Association",
    finalValue: "U.S. Bank",
    rawPatterns: [/\bu\.?\s*s\.?\s*bank national association\b/i],
    matches: (value) =>
      /\bu\.?\s*s\.?\s*bank national association\b/i.test(value) ||
      /\bu\.?\s*s\.?\s*bank\b/i.test(value),
  },
  {
    id: "fidelity_investments",
    rawValue: "Fidelity Investments",
    finalValue: "Fidelity",
    rawPatterns: [/\bfidelity investments\b/i],
    matches: (value) =>
      /\bfidelity investments\b/i.test(value) || /\bfidelity\b/i.test(value),
  },
  {
    id: "charles_schwab",
    rawValue: "Charles Schwab & Co., Inc.",
    finalValue: "Charles Schwab",
    rawPatterns: [/\bcharles schwab\s*&\s*co\.,?\s*inc\.?\b/i],
    matches: (value) =>
      /\bcharles schwab\s*&\s*co\.,?\s*inc\.?\b/i.test(value) ||
      /\bcharles schwab\b/i.test(value) ||
      /\bschwab\b/i.test(value),
  },
  {
    id: "vanguard_group",
    rawValue: "The Vanguard Group, Inc.",
    finalValue: "Vanguard",
    rawPatterns: [/\bthe vanguard group,?\s*inc\.?\b/i],
    matches: (value) =>
      /\bthe vanguard group,?\s*inc\.?\b/i.test(value) ||
      /\bvanguard\b/i.test(value),
  },
  {
    id: "empower_retirement",
    rawValue: "Empower Retirement, LLC",
    finalValue: "Empower",
    rawPatterns: [/\bempower retirement,?\s*l\.?l\.?c\.?\b/i],
    matches: (value) =>
      /\bempower retirement,?\s*l\.?l\.?c\.?\b/i.test(value) ||
      /\bempower\b/i.test(value),
  },
  {
    id: "jackson_national_life",
    rawValue: "Jackson National Life Insurance Company",
    finalValue: "Jackson",
    rawPatterns: [/\bjackson national life insurance company\b/i],
    matches: (value) =>
      /\bjackson national life insurance company\b/i.test(value) ||
      /\bjackson\b/i.test(value),
  },
];

const ACCOUNT_TYPE_NORMALIZATION_RULES: NormalizationRule[] = [
  createPatternRule("fixed_indexed_annuity", "Fixed Indexed Annuity", [
    /\bfixed indexed annuity\b/i,
    /\bfixed index annuity\b/i,
  ]),
  createPatternRule("variable_annuity", "Variable Annuity", [
    /\bvariable annuity\b/i,
  ]),
  createPatternRule("fixed_annuity", "Fixed Annuity", [/\bfixed annuity\b/i]),
  createPatternRule("roth_ira", "Roth IRA", [
    /\broth\s+ira\b/i,
    /\broth\s+individual retirement (?:account|arrangement)\b/i,
  ]),
  createPatternRule("traditional_ira", "Traditional IRA", [
    /\btraditional\s+ira\b/i,
    /\btraditional\s+individual retirement (?:account|arrangement)\b/i,
  ]),
  createPatternRule("rollover_ira", "Rollover IRA", [
    /\broll[\s-]?over\s+ira\b/i,
    /\broll[\s-]?over\s+individual retirement (?:account|arrangement)\b/i,
  ]),
  createPatternRule("sep_ira", "SEP IRA", [
    /\bsep\s+ira\b/i,
    /\bsimplified employee pension\b.*\b(?:ira|account|arrangement)\b/i,
  ]),
  createPatternRule("simple_ira", "SIMPLE IRA", [
    /\bsimple\s+ira\b/i,
    /\bsavings incentive match plan for employees\b.*\b(?:ira|account|arrangement)\b/i,
  ]),
  createPatternRule("401k", "401(k)", [/\b401\s*(?:\(\s*k\s*\)|k)\b/i]),
  createPatternRule("employer_retirement_plan", "401(k)", [
    /\b401\s*(?:\(\s*k\s*\)|k)\s+savings plan\b/i,
    /\b401\s*(?:\(\s*k\s*\)|k)\s+plan\b/i,
    /\bretirement savings plan\b/i,
    /\bemployer-sponsored retirement plan\b/i,
    /\bemployer-sponsored plan\b/i,
    /\bemployer retirement plan\b/i,
    /\bretirement plan\b/i,
  ]),
  createPatternRule("403b", "403(b)", [/\b403\s*(?:\(\s*b\s*\)|b)\b/i]),
  createPatternRule("hsa", "HSA", [
    /\bhsa\b/i,
    /\bhealth savings account\b/i,
  ]),
  createPatternRule("brokerage", "Brokerage", [/\bbrokerage(?: account)?\b/i]),
  {
    id: "checking_keyword",
    finalValue: "Checking",
    matches: (value) =>
      /\bchecking\b/i.test(value) && !/\bsavings\b/i.test(value),
  },
  {
    id: "savings_keyword",
    finalValue: "Savings",
    matches: (value) =>
      /\bsavings\b/i.test(value) && !/\bchecking\b/i.test(value),
  },
  createPatternRule("annuity", "Annuity", [/\bannuity\b/i]),
];

const ACCOUNT_VALUE_KIND_NORMALIZATION_RULES: ValueKindNormalizationRule[] = [
  createValueKindPatternRule("beginning_balance", "beginning_balance", [
    /\bbeginning balance\b/i,
    /\bopening balance\b/i,
    /\bstarting balance\b/i,
  ]),
  createValueKindPatternRule("ending_balance", "ending_balance", [
    /\bending balance\b/i,
    /\bclosing balance\b/i,
  ]),
  createValueKindPatternRule("available_balance", "available_balance", [
    /\bavailable balance\b/i,
    /\bavailable to withdraw\b/i,
  ]),
  createValueKindPatternRule("market_value", "market_value", [
    /\bmarket value\b/i,
  ]),
  createValueKindPatternRule("vested_balance", "vested_balance", [
    /\bvested balance\b/i,
    /\bvested account balance\b/i,
  ]),
  createValueKindPatternRule("loan_balance", "loan_balance", [
    /\bloan balance\b/i,
    /\boutstanding loan\b/i,
  ]),
  createValueKindPatternRule("surrender_value", "surrender_value", [
    /\bcash surrender value\b/i,
    /\bsurrender value\b/i,
  ]),
  createValueKindPatternRule("death_benefit", "death_benefit", [
    /\bdeath benefit\b/i,
  ]),
  createValueKindPatternRule("cash_value", "cash_value", [
    /\bcash value\b/i,
  ]),
  createValueKindPatternRule("contribution_balance", "contribution_balance", [
    /\bcontribution balance\b/i,
    /\bcontributions? total\b/i,
    /\bemployee contributions?\b/i,
  ]),
  createValueKindPatternRule("current_balance", "current_balance", [
    /\bcurrent balance\b/i,
    /\bcurrent value\b/i,
    /\bcontract value\b/i,
    /\baccount value\b/i,
    /\btotal value\b/i,
  ]),
];

export function normalizeAccountStatementCustodian(
  value: string | null | undefined,
): NormalizedAccountStatementField {
  return applyNormalizationRules(value, CUSTODIAN_NORMALIZATION_RULES);
}

export function detectRawAccountStatementInstitutionName(
  value: string | null | undefined,
) {
  const rawValue = normalizeWhitespace(value ?? "");
  if (!rawValue) {
    return null;
  }

  for (const rule of CUSTODIAN_NORMALIZATION_RULES) {
    if (rule.rawPatterns.some((pattern) => pattern.test(rawValue))) {
      return rule.rawValue;
    }
  }

  return null;
}

export function normalizeAccountStatementAccountType(
  value: string | null | undefined,
): NormalizedAccountStatementField {
  return applyNormalizationRules(value, ACCOUNT_TYPE_NORMALIZATION_RULES);
}

export function normalizeAccountStatementValueKind(input: {
  kind: string | null | undefined;
  label?: string | null | undefined;
}): CanonicalAccountValue["kind"] {
  const rawKind = normalizeWhitespace(input.kind ?? "");
  const rawLabel = normalizeWhitespace(input.label ?? "");
  const matchText = [rawKind, rawLabel].filter(Boolean).join(" ");

  if (!matchText) {
    return "other";
  }

  for (const rule of ACCOUNT_VALUE_KIND_NORMALIZATION_RULES) {
    if (rule.matches(matchText)) {
      return rule.finalValue;
    }
  }

  return "other";
}

function applyNormalizationRules(
  value: string | null | undefined,
  rules: NormalizationRule[],
): NormalizedAccountStatementField {
  const rawValue = normalizeWhitespace(value ?? "");
  if (!rawValue) {
    return {
      rawValue: null,
      finalValue: null,
      changed: false,
      ruleId: null,
    };
  }

  for (const rule of rules) {
    if (!rule.matches(rawValue)) {
      continue;
    }

    return {
      rawValue,
      finalValue: rule.finalValue,
      changed: rawValue !== rule.finalValue,
      ruleId: rule.id,
    };
  }

  return {
    rawValue,
    finalValue: rawValue,
    changed: false,
    ruleId: null,
  };
}

function createPatternRule(
  id: string,
  finalValue: string,
  patterns: RegExp[],
): NormalizationRule {
  return {
    id,
    finalValue,
    matches: (value) => patterns.some((pattern) => pattern.test(value)),
  };
}

function createValueKindPatternRule(
  id: string,
  finalValue: CanonicalAccountValue["kind"],
  patterns: RegExp[],
): ValueKindNormalizationRule {
  return {
    id,
    finalValue,
    matches: (value) => patterns.some((pattern) => pattern.test(value)),
  };
}

function normalizeWhitespace(value: string) {
  return value.replace(/\s+/g, " ").trim();
}

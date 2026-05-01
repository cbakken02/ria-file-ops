import {
  TAX_DOCUMENT_SUBTYPES,
  getTaxDocumentSubtypeLabel,
  normalizeTaxDocumentSubtype,
} from "@/lib/tax-document-types";

export type NamingTokenId =
  | "last_name"
  | "first_name"
  | "client2_last_name"
  | "client2_first_name"
  | "document_type"
  | "account_type"
  | "account_last4"
  | "custodian"
  | "tax_year"
  | "document_date"
  | "id_type"
  | "entity_name";

export type NamingRuleDocumentType =
  | "default"
  | "account_statement"
  | "money_movement_form"
  | "tax_document"
  | "identity_document"
  | "planning_document"
  | "legal_document";

export type NamingRulesConfig = {
  version: 1;
  rules: Record<NamingRuleDocumentType, NamingTokenId[]>;
};

export type NamingRuleContext = {
  accountLast4?: string | null;
  accountType?: string | null;
  clientName?: string | null;
  clientName2?: string | null;
  clientFolder?: string | null;
  custodian?: string | null;
  detectedClient?: string | null;
  detectedClient2?: string | null;
  documentDate?: string | null;
  documentTypeId: NamingRuleDocumentType;
  documentTypeLabel?: string | null;
  entityName?: string | null;
  extension?: string | null;
  fallbackName?: string | null;
  idType?: string | null;
  ownershipType?: "single" | "joint" | null;
  sourceName?: string | null;
  taxYear?: string | null;
};

export type DocumentFilenamePlanInput = {
  accountLast4?: string | null;
  accountType?: string | null;
  clientName?: string | null;
  clientName2?: string | null;
  custodian?: string | null;
  detectedClient?: string | null;
  detectedClient2?: string | null;
  documentDate?: string | null;
  documentTypeId?: NamingRuleDocumentType;
  documentTypeLabel: string;
  entityName?: string | null;
  extension?: string | null;
  fallbackName?: string | null;
  householdFolder?: string | null;
  idType?: string | null;
  ownershipType?: "single" | "joint" | null;
  rules: NamingRulesConfig;
  sourceName?: string | null;
  taxYear?: string | null;
};

type TokenDefinition = {
  id: NamingTokenId;
  label: string;
  shortLabel: string;
};

type RuleDefinition = {
  defaultTokens: NamingTokenId[];
  exampleContext: NamingRuleContext;
  label: string;
  supportedTokens: NamingTokenId[];
};

const DOCUMENT_SUBTYPE_OPTIONS: Partial<Record<NamingRuleDocumentType, string[]>> = {
  account_statement: [
    "Monthly statement",
    "Quarterly statement",
    "Annual statement",
    "Performance report",
  ],
  money_movement_form: [
    "ACH form",
    "Wire form",
    "Journal form",
    "Transfer form",
    "Standing letter",
  ],
  tax_document: [...TAX_DOCUMENT_SUBTYPES],
  identity_document: [
    "Driver License",
    "Passport",
    "Social Security Card",
    "State ID",
    "Birth Certificate",
  ],
  planning_document: [
    "Meeting notes",
    "Financial plan",
    "Retirement analysis",
    "Recommendation letter",
    "Action items",
  ],
  legal_document: [
    "Trust document",
    "Will",
    "Power of Attorney",
    "LLC document",
    "Beneficiary form",
  ],
};

export const NAMING_TOKEN_DEFINITIONS: TokenDefinition[] = [
  { id: "last_name", label: "Client 1 last name", shortLabel: "Client1Last" },
  { id: "first_name", label: "Client 1 first name", shortLabel: "Client1First" },
  {
    id: "client2_last_name",
    label: "Client 2 last name (if identified)",
    shortLabel: "Client2Last",
  },
  {
    id: "client2_first_name",
    label: "Client 2 first name (if identified)",
    shortLabel: "Client2First",
  },
  { id: "document_type", label: "Document type", shortLabel: "DocType" },
  { id: "account_type", label: "Account type", shortLabel: "AcctType" },
  { id: "account_last4", label: "Account last 4", shortLabel: "Last4" },
  { id: "custodian", label: "Custodian", shortLabel: "Custodian" },
  { id: "tax_year", label: "Tax year", shortLabel: "TaxYear" },
  { id: "document_date", label: "Document date", shortLabel: "Date" },
  { id: "id_type", label: "ID type", shortLabel: "IDType" },
  { id: "entity_name", label: "Entity name", shortLabel: "EntityName" },
];

const tokenMap = new Map(
  NAMING_TOKEN_DEFINITIONS.map((definition) => [definition.id, definition]),
);

export const NAMING_RULE_DEFINITIONS: Record<
  NamingRuleDocumentType,
  RuleDefinition
> = {
  default: {
    label: "Default",
    supportedTokens: [
      "last_name",
      "first_name",
      "client2_last_name",
      "client2_first_name",
      "document_type",
      "document_date",
      "custodian",
    ],
    defaultTokens: [
      "last_name",
      "first_name",
      "client2_first_name",
      "document_type",
      "document_date",
    ],
    exampleContext: {
      clientFolder: "Bakken_Christopher",
      clientName2: "Mary Bakken",
      custodian: "Fidelity",
      documentDate: "2026-04-08",
      documentTypeId: "default",
      documentTypeLabel: "Meeting notes",
      extension: ".pdf",
      ownershipType: "joint",
    },
  },
  account_statement: {
    label: "Account statement",
    supportedTokens: [
      "last_name",
      "first_name",
      "client2_last_name",
      "client2_first_name",
      "document_type",
      "account_type",
      "account_last4",
      "custodian",
      "document_date",
    ],
    defaultTokens: [
      "last_name",
      "first_name",
      "client2_first_name",
      "document_type",
      "account_type",
      "account_last4",
    ],
    exampleContext: {
      accountLast4: "0456",
      accountType: "Roth IRA",
      clientFolder: "Bakken_Christopher",
      clientName2: "Mary Bakken",
      custodian: "Fidelity",
      documentTypeId: "account_statement",
      extension: ".pdf",
      ownershipType: "joint",
    },
  },
  money_movement_form: {
    label: "Money movement form",
    supportedTokens: [
      "last_name",
      "first_name",
      "client2_last_name",
      "client2_first_name",
      "document_type",
      "account_type",
      "account_last4",
      "custodian",
      "document_date",
    ],
    defaultTokens: [
      "last_name",
      "first_name",
      "client2_first_name",
      "document_type",
      "account_type",
      "account_last4",
    ],
    exampleContext: {
      accountLast4: "0456",
      accountType: "Roth IRA",
      clientFolder: "Bakken_Christopher",
      clientName2: "Mary Bakken",
      custodian: "Fidelity",
      documentTypeId: "money_movement_form",
      extension: ".pdf",
      ownershipType: "joint",
    },
  },
  tax_document: {
    label: "Tax document",
    supportedTokens: [
      "last_name",
      "first_name",
      "client2_last_name",
      "client2_first_name",
      "document_type",
      "tax_year",
      "custodian",
      "document_date",
    ],
    defaultTokens: [
      "last_name",
      "first_name",
      "client2_first_name",
      "custodian",
      "document_type",
      "tax_year",
    ],
    exampleContext: {
      clientFolder: "Bakken_Christopher",
      clientName2: "Mary Bakken",
      custodian: "Coinbase",
      documentTypeId: "tax_document",
      documentTypeLabel: "form_1099_da",
      extension: ".pdf",
      ownershipType: "joint",
      taxYear: "2025",
    },
  },
  identity_document: {
    label: "Identity document",
    supportedTokens: [
      "last_name",
      "first_name",
      "id_type",
      "document_date",
      "document_type",
    ],
    defaultTokens: ["last_name", "first_name", "id_type"],
    exampleContext: {
      clientFolder: "Bakken_Christopher",
      documentTypeId: "identity_document",
      extension: ".png",
      idType: "Driver License",
    },
  },
  planning_document: {
    label: "Planning / advice document",
    supportedTokens: [
      "last_name",
      "first_name",
      "client2_last_name",
      "client2_first_name",
      "document_type",
      "document_date",
      "entity_name",
    ],
    defaultTokens: [
      "last_name",
      "first_name",
      "client2_first_name",
      "document_type",
      "document_date",
    ],
    exampleContext: {
      clientFolder: "Bakken_Christopher",
      clientName2: "Mary Bakken",
      documentDate: "2026-04-08",
      documentTypeId: "planning_document",
      documentTypeLabel: "Meeting notes",
      extension: ".pdf",
      ownershipType: "joint",
    },
  },
  legal_document: {
    label: "Legal / estate document",
    supportedTokens: [
      "last_name",
      "first_name",
      "client2_last_name",
      "client2_first_name",
      "document_type",
      "entity_name",
      "document_date",
    ],
    defaultTokens: [
      "last_name",
      "first_name",
      "client2_first_name",
      "document_type",
      "entity_name",
    ],
    exampleContext: {
      clientFolder: "Bakken_Christopher",
      clientName2: "Mary Bakken",
      documentTypeId: "legal_document",
      documentTypeLabel: "Trust document",
      entityName: "Bakken Family Trust",
      extension: ".pdf",
      ownershipType: "joint",
    },
  },
};

export function getDefaultNamingRules(): NamingRulesConfig {
  return {
    version: 1,
    rules: {
      default: [...NAMING_RULE_DEFINITIONS.default.defaultTokens],
      account_statement: [
        ...NAMING_RULE_DEFINITIONS.account_statement.defaultTokens,
      ],
      money_movement_form: [
        ...NAMING_RULE_DEFINITIONS.money_movement_form.defaultTokens,
      ],
      tax_document: [...NAMING_RULE_DEFINITIONS.tax_document.defaultTokens],
      identity_document: [
        ...NAMING_RULE_DEFINITIONS.identity_document.defaultTokens,
      ],
      planning_document: [
        ...NAMING_RULE_DEFINITIONS.planning_document.defaultTokens,
      ],
      legal_document: [...NAMING_RULE_DEFINITIONS.legal_document.defaultTokens],
    },
  };
}

export function parseNamingRules(
  raw: string | null | undefined,
  legacyConvention?: string | null | undefined,
) {
  const fallback = getDefaultNamingRules();

  if (!raw) {
    return applyLegacyFallback(fallback, legacyConvention);
  }

  try {
    const parsed = JSON.parse(raw) as Partial<NamingRulesConfig>;

    if (parsed.version !== 1 || !parsed.rules) {
      return applyLegacyFallback(fallback, legacyConvention);
    }

    const legacyRules = parsed.rules as Partial<
      Record<NamingRuleDocumentType, NamingTokenId[]>
    >;

    return {
      version: 1,
      rules: {
        default: upgradeLegacyRecommendedRule(
          "default",
          sanitizeRuleTokens("default", legacyRules.default),
        ),
        account_statement: upgradeLegacyRecommendedRule(
          "account_statement",
          sanitizeRuleTokens("account_statement", legacyRules.account_statement),
        ),
        money_movement_form: upgradeLegacyRecommendedRule(
          "money_movement_form",
          sanitizeRuleTokens("money_movement_form", legacyRules.money_movement_form),
        ),
        tax_document: upgradeLegacyRecommendedRule(
          "tax_document",
          sanitizeRuleTokens("tax_document", legacyRules.tax_document),
        ),
        identity_document: upgradeLegacyRecommendedRule(
          "identity_document",
          sanitizeRuleTokens("identity_document", legacyRules.identity_document),
        ),
        planning_document: upgradeLegacyRecommendedRule(
          "planning_document",
          sanitizeRuleTokens("planning_document", legacyRules.planning_document),
        ),
        legal_document: upgradeLegacyRecommendedRule(
          "legal_document",
          sanitizeRuleTokens("legal_document", legacyRules.legal_document),
        ),
      },
    } satisfies NamingRulesConfig;
  } catch {
    return applyLegacyFallback(fallback, legacyConvention);
  }
}

export function serializeNamingRules(config: NamingRulesConfig) {
  return JSON.stringify(config);
}

export function getNamingRuleDefinition(documentType: NamingRuleDocumentType) {
  return NAMING_RULE_DEFINITIONS[documentType];
}

export function getNamingDocumentTypeLabel(documentType: NamingRuleDocumentType) {
  return NAMING_RULE_DEFINITIONS[documentType].label;
}

export function getDetectedDocumentSubtype(
  documentTypeId: NamingRuleDocumentType,
  detectedDocumentType: string | null | undefined,
) {
  const normalized = (detectedDocumentType ?? "").trim();
  if (!normalized) {
    return null;
  }

  if (documentTypeId === "tax_document") {
    return normalizeTaxDocumentSubtype(normalized);
  }

  return normalized === getNamingDocumentTypeLabel(documentTypeId) ? null : normalized;
}

export function getDocumentSubtypeOptions(
  documentTypeId: NamingRuleDocumentType,
  currentSubtype?: string | null,
) {
  const options = [...(DOCUMENT_SUBTYPE_OPTIONS[documentTypeId] ?? [])];
  const normalizedCurrent =
    documentTypeId === "tax_document"
      ? normalizeTaxDocumentSubtype(currentSubtype)
      : (currentSubtype ?? "").trim();

  if (normalizedCurrent && !options.includes(normalizedCurrent)) {
    options.unshift(normalizedCurrent);
  }

  return options;
}

export function getDocumentSubtypeLabel(
  documentTypeId: NamingRuleDocumentType,
  subtype: string | null | undefined,
) {
  if (documentTypeId === "tax_document") {
    return getTaxDocumentSubtypeLabel(subtype) ?? "Tax Document";
  }

  return subtype ?? "";
}

export function getNamingDocumentTypeOptions() {
  return (
    Object.entries(NAMING_RULE_DEFINITIONS) as Array<
      [NamingRuleDocumentType, RuleDefinition]
    >
  ).map(([id, definition]) => ({
    id,
    label: definition.label,
  }));
}

export function getAvailableTokensForDocumentType(
  documentType: NamingRuleDocumentType,
) {
  return NAMING_RULE_DEFINITIONS[documentType].supportedTokens.map((tokenId) =>
    tokenMap.get(tokenId),
  ).filter((value): value is TokenDefinition => Boolean(value));
}

export function getRulePatternSummary(tokens: NamingTokenId[]) {
  return tokens
    .map((token) => tokenMap.get(token)?.shortLabel ?? token)
    .join("_");
}

export function getDefaultNamingConventionSummary(config: NamingRulesConfig) {
  return getRulePatternSummary(config.rules.default);
}

export function isRuleUsingRecommendedDefault(
  config: NamingRulesConfig,
  documentType: NamingRuleDocumentType,
) {
  const current = config.rules[documentType];
  const recommended = NAMING_RULE_DEFINITIONS[documentType].defaultTokens;
  return current.join("|") === recommended.join("|");
}

export function getNamingRuleExample(
  config: NamingRulesConfig,
  documentType: NamingRuleDocumentType,
) {
  const definition = NAMING_RULE_DEFINITIONS[documentType];
  return buildFilenameFromNamingRules({
    ...definition.exampleContext,
    rules: config,
  });
}

export function getDocumentTypeIdFromLabel(label: string | null | undefined) {
  const normalized = (label ?? "").trim().toLowerCase();

  if (!normalized) {
    return "default";
  }

  if (normalized.includes("statement")) {
    return "account_statement";
  }

  if (normalized.includes("money movement")) {
    return "money_movement_form";
  }

  if (
    normalized.includes("tax") ||
    normalized.includes("tax return") ||
    normalized.includes("1040") ||
    normalized.includes("state return") ||
    normalized.includes("extension") ||
    normalized.includes("estimated payment") ||
    normalized.includes("estimated tax") ||
    normalized.includes("1099") ||
    normalized.includes("1098") ||
    normalized.includes("w-2") ||
    normalized.includes("w2") ||
    normalized.includes("k-1") ||
    normalized.includes("notice")
  ) {
    return "tax_document";
  }

  if (normalized.includes("identity")) {
    return "identity_document";
  }

  if (normalized.includes("legal") || normalized.includes("trust")) {
    return "legal_document";
  }

  if (
    normalized.includes("meeting") ||
    normalized.includes("planning") ||
    normalized.includes("advice")
  ) {
    return "planning_document";
  }

  return "default";
}

export function getDocumentTypeLabelForFilename(
  documentTypeId: NamingRuleDocumentType,
  documentTypeLabel?: string | null,
) {
  if (documentTypeId === "account_statement") {
    return "Statement";
  }

  if (documentTypeId === "money_movement_form") {
    return "Money Movement";
  }

  if (documentTypeId === "tax_document") {
    const taxSubtypeLabel = getTaxDocumentSubtypeLabel(documentTypeLabel);
    return taxSubtypeLabel
      ? taxSubtypeLabel
      : documentTypeLabel && documentTypeLabel !== "Tax document"
        ? documentTypeLabel
      : "Tax Document";
  }

  if (documentTypeId === "identity_document") {
    return "ID";
  }

  if (documentTypeId === "planning_document") {
    return documentTypeLabel ?? "Planning Document";
  }

  if (documentTypeId === "legal_document") {
    return documentTypeLabel ?? "Legal Document";
  }

  return documentTypeLabel ?? "Document";
}

export function buildFilenameFromNamingRules(
  input: NamingRuleContext & { rules: NamingRulesConfig },
) {
  const rule = input.rules.rules[input.documentTypeId] ?? input.rules.rules.default;
  const extension = normalizeExtension(
    input.extension ?? detectExtension(input.sourceName ?? input.fallbackName ?? ""),
  );
  const clientName = resolveClientNameParts(
    input.clientName,
    input.detectedClient,
    input.clientFolder,
  );
  const clientTwoName = resolveSecondaryClientNameParts(
    input.clientName2,
    input.detectedClient2,
  );
  let usedClientPlaceholder = false;
  const parts = rule
    .map((token) => {
      if (
        (token === "last_name" || token === "first_name") &&
        !clientName.first &&
        !clientName.last
      ) {
        if (usedClientPlaceholder) {
          return null;
        }

        usedClientPlaceholder = true;
        return "Needs_Client_Match";
      }

      return resolveTokenValue(token, input, clientName, clientTwoName);
    })
    .filter(Boolean);

  const basename = parts.length
    ? parts.join("_")
    : sanitizeFilenameSegment(input.fallbackName ?? "Document");

  return `${basename}${extension}`;
}

export function buildDocumentFilenamePlan(input: DocumentFilenamePlanInput) {
  return buildFilenameFromNamingRules({
    accountLast4: normalizeOptionalPlanValue(input.accountLast4),
    accountType: normalizeOptionalPlanValue(input.accountType),
    clientFolder: normalizeOptionalPlanValue(input.householdFolder),
    clientName: normalizeOptionalPlanValue(input.clientName),
    clientName2: normalizeOptionalPlanValue(input.clientName2),
    custodian: normalizeOptionalPlanValue(input.custodian),
    detectedClient: normalizeOptionalPlanValue(input.detectedClient),
    detectedClient2: normalizeOptionalPlanValue(input.detectedClient2),
    documentDate: normalizeOptionalPlanValue(input.documentDate),
    documentTypeId:
      input.documentTypeId ?? getDocumentTypeIdFromLabel(input.documentTypeLabel),
    documentTypeLabel: input.documentTypeLabel,
    entityName: normalizeOptionalPlanValue(input.entityName),
    extension: normalizeOptionalPlanValue(input.extension),
    fallbackName: normalizeOptionalPlanValue(input.fallbackName),
    idType: normalizeOptionalPlanValue(input.idType),
    ownershipType: input.ownershipType ?? null,
    rules: input.rules,
    sourceName: normalizeOptionalPlanValue(input.sourceName),
    taxYear: normalizeOptionalPlanValue(input.taxYear),
  });
}

function resolveTokenValue(
  token: NamingTokenId,
  input: NamingRuleContext,
  clientName = resolveClientNameParts(
    input.clientName,
    input.detectedClient,
    input.clientFolder,
  ),
  clientTwoName = resolveSecondaryClientNameParts(
    input.clientName2,
    input.detectedClient2,
  ),
) {
  if (token === "last_name") {
    return sanitizeFilenameSegment(clientName.last ?? null);
  }

  if (token === "first_name") {
    return sanitizeFilenameSegment(clientName.first ?? null);
  }

  if (token === "client2_last_name") {
    if (input.ownershipType !== "joint") {
      return null;
    }
    if (
      clientTwoName.last &&
      clientName.last &&
      clientTwoName.last.toLowerCase() === clientName.last.toLowerCase()
    ) {
      return null;
    }
    return sanitizeFilenameSegment(clientTwoName.last ?? null);
  }

  if (token === "client2_first_name") {
    if (input.ownershipType !== "joint") {
      return null;
    }
    return sanitizeFilenameSegment(clientTwoName.first ?? null);
  }

  if (token === "document_type") {
    return sanitizeFilenameSegment(
      getDocumentTypeLabelForFilename(input.documentTypeId, input.documentTypeLabel),
    );
  }

  if (token === "account_type") {
    return sanitizeFilenameSegment(input.accountType ?? null);
  }

  if (token === "account_last4") {
    return normalizeAccountLast4(input.accountLast4 ?? null);
  }

  if (token === "custodian") {
    return sanitizeFilenameSegment(input.custodian ?? null);
  }

  if (token === "tax_year") {
    return sanitizeFilenameSegment(input.taxYear ?? null);
  }

  if (token === "document_date") {
    return sanitizeFilenameSegment(input.documentDate ?? null);
  }

  if (token === "id_type") {
    return sanitizeFilenameSegment(input.idType ?? null);
  }

  if (token === "entity_name") {
    return sanitizeFilenameSegment(input.entityName ?? null);
  }

  return null;
}

function normalizeOptionalPlanValue(value: string | null | undefined) {
  const normalized = value?.trim();
  return normalized ? normalized : null;
}

function sanitizeRuleTokens(
  documentType: NamingRuleDocumentType,
  value: NamingTokenId[] | undefined,
) {
  const supported = new Set(NAMING_RULE_DEFINITIONS[documentType].supportedTokens);
  const cleaned = (value ?? []).filter((token) => supported.has(token));
  return cleaned.length
    ? cleaned
    : [...NAMING_RULE_DEFINITIONS[documentType].defaultTokens];
}

function upgradeLegacyRecommendedRule(
  documentType: NamingRuleDocumentType,
  tokens: NamingTokenId[],
) {
  const legacyRecommendedRules: Partial<
    Record<NamingRuleDocumentType, NamingTokenId[][]>
  > = {
    default: [
      ["last_name", "first_name", "document_type", "document_date"],
      [
        "last_name",
        "first_name",
        "client2_first_name",
        "client2_last_name",
        "document_type",
        "document_date",
      ],
    ],
    account_statement: [
      [
        "last_name",
        "first_name",
        "document_type",
        "account_type",
        "account_last4",
      ],
      [
        "last_name",
        "first_name",
        "client2_first_name",
        "client2_last_name",
        "document_type",
        "account_type",
        "account_last4",
      ],
    ],
    money_movement_form: [
      [
        "last_name",
        "first_name",
        "document_type",
        "account_type",
        "account_last4",
      ],
      [
        "last_name",
        "first_name",
        "client2_first_name",
        "client2_last_name",
        "document_type",
        "account_type",
        "account_last4",
      ],
    ],
    tax_document: [
      ["last_name", "first_name", "document_type", "tax_year"],
      [
        "last_name",
        "first_name",
        "client2_first_name",
        "document_type",
        "tax_year",
      ],
      [
        "last_name",
        "first_name",
        "client2_first_name",
        "client2_last_name",
        "document_type",
        "tax_year",
      ],
    ],
    planning_document: [
      ["last_name", "first_name", "document_type", "document_date"],
      [
        "last_name",
        "first_name",
        "client2_first_name",
        "client2_last_name",
        "document_type",
        "document_date",
      ],
    ],
    legal_document: [
      ["last_name", "first_name", "document_type", "entity_name"],
      [
        "last_name",
        "first_name",
        "client2_first_name",
        "client2_last_name",
        "document_type",
        "entity_name",
      ],
    ],
  };

  const legacyRecommended = legacyRecommendedRules[documentType];

  if (
    legacyRecommended?.some(
      (candidate) => tokens.join("|") === candidate.join("|"),
    )
  ) {
    return [...NAMING_RULE_DEFINITIONS[documentType].defaultTokens];
  }

  return tokens;
}

function applyLegacyFallback(
  fallback: NamingRulesConfig,
  legacyConvention?: string | null,
) {
  if (!legacyConvention) {
    return fallback;
  }

  const normalized = legacyConvention.toLowerCase();
  if (
    normalized.includes("last") &&
    normalized.includes("first") &&
    normalized.includes("doc") &&
    normalized.includes("date")
  ) {
    fallback.rules.default = [
      "last_name",
      "first_name",
      "document_type",
      "document_date",
    ];
  }

  return fallback;
}

export function resolveClientNameParts(
  clientName: string | null | undefined,
  detectedClient: string | null | undefined,
  clientFolder: string | null | undefined,
) {
  const directName = parsePersonName(clientName);
  if (directName) {
    return directName;
  }

  const detectedName = parsePersonName(detectedClient);
  if (detectedName) {
    return detectedName;
  }

  if (clientFolder) {
    const folderParts = clientFolder.split("_").filter(Boolean);
    if (folderParts.length >= 2) {
      return {
        first: folderParts.slice(1).join(" "),
        last: folderParts[0],
      };
    }
  }

  return {
    first: null,
    last: null,
  };
}

export function getClientDisplayName(input: {
  clientName?: string | null;
  detectedClient?: string | null;
  clientFolder?: string | null;
}) {
  const parts = resolveClientNameParts(
    input.clientName,
    input.detectedClient,
    input.clientFolder,
  );

  if (!parts.first && !parts.last) {
    return "";
  }

  return [parts.first, parts.last].filter(Boolean).join(" ");
}

export function getClientDisplayNameSecondary(input: {
  clientName2?: string | null;
  detectedClient2?: string | null;
}) {
  const parts = resolveSecondaryClientNameParts(
    input.clientName2,
    input.detectedClient2,
  );

  if (!parts.first && !parts.last) {
    return "";
  }

  return [parts.first, parts.last].filter(Boolean).join(" ");
}

function resolveSecondaryClientNameParts(
  clientName2: string | null | undefined,
  detectedClient2: string | null | undefined,
) {
  const directName = parsePersonName(clientName2);
  if (directName) {
    return directName;
  }

  const detectedName = parsePersonName(detectedClient2);
  if (detectedName) {
    return detectedName;
  }

  return {
    first: null,
    last: null,
  };
}

function parsePersonName(value: string | null | undefined) {
  if (!value) {
    return null;
  }

  const parts = value
    .trim()
    .replaceAll("_", " ")
    .split(/\s+/)
    .filter(Boolean);

  if (parts.length >= 2) {
    return {
      first: parts[0],
      last: parts[parts.length - 1],
    };
  }

  return null;
}

function sanitizeFilenameSegment(value: string | null | undefined) {
  if (!value) {
    return null;
  }

  const normalized = value
    .trim()
    .replace(/&/g, " and ")
    .replace(/[^A-Za-z0-9\s'-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  if (!normalized) {
    return null;
  }

  return normalized.replace(/\s+/g, "_");
}

function normalizeAccountLast4(value: string | null | undefined) {
  if (!value) {
    return null;
  }

  const digits = value.replace(/\D/g, "").slice(-4);
  return digits.length === 4 ? `x${digits}` : null;
}

function normalizeExtension(value: string) {
  if (!value) {
    return "";
  }

  return value.startsWith(".") ? value.toLowerCase() : `.${value.toLowerCase()}`;
}

function detectExtension(filename: string) {
  const match = filename.match(/(\.[A-Za-z0-9]+)$/);
  return match?.[1] ?? "";
}

export type DataIntelligenceConversationMessage = {
  role: "user" | "assistant";
  text: string;
};

export type DataIntelligenceConversationFamilyScope =
  | "statement"
  | "bank_statement"
  | "credit_card_statement"
  | "identity_document"
  | "driver_license"
  | "state_id";

export type DataIntelligenceConversationTurnKind =
  | "list"
  | "summary"
  | "detail"
  | "existence"
  | "status"
  | "not_found"
  | "ambiguous"
  | "unsupported";

export type DataIntelligenceConversationSourceRef = {
  sourceFileId: string | null;
  sourceName: string | null;
  documentDate: string | null;
  statementEndDate: string | null;
  institutionName: string | null;
  accountType: string | null;
  accountLast4: string | null;
  maskedAccountNumber: string | null;
  partyDisplayName: string | null;
  idType: string | null;
  expirationDate: string | null;
};

export type DataIntelligenceConversationRequestedField =
  | "document"
  | "value"
  | "account_number"
  | "contact"
  | "identity_document"
  | "dob"
  | "address"
  | "expiration"
  | null;

export type DataIntelligenceConversationState = {
  activeClientName: string | null;
  activeFamilyScope: DataIntelligenceConversationFamilyScope | null;
  activeAccountType: string | null;
  activeStatementSource: DataIntelligenceConversationSourceRef | null;
  alternateStatementSources: DataIntelligenceConversationSourceRef[];
  lastIntent: string | null;
  lastTurnKind: DataIntelligenceConversationTurnKind | null;
  lastRequestedField: DataIntelligenceConversationRequestedField;
  lastPrimarySource: DataIntelligenceConversationSourceRef | null;
  lastSources: DataIntelligenceConversationSourceRef[];
};

export const DATA_INTELLIGENCE_HISTORY_MAX_MESSAGES = 8;
export const DATA_INTELLIGENCE_HISTORY_MAX_TEXT_LENGTH = 800;
export const DATA_INTELLIGENCE_STATE_MAX_SOURCES = 5;
const DATA_INTELLIGENCE_STATE_MAX_TEXT_LENGTH = 160;
const DATA_INTELLIGENCE_STATE_ACCOUNT_TYPES = new Set([
  "Checking",
  "Savings",
  "Credit Card",
  "Brokerage",
  "Roth IRA",
  "Traditional IRA",
  "Rollover IRA",
  "SEP IRA",
  "SIMPLE IRA",
  "401(k)",
  "403(b)",
  "HSA",
  "Annuity",
  "Variable Annuity",
  "Fixed Annuity",
  "Fixed Indexed Annuity",
  "IRA",
]);
const DATA_INTELLIGENCE_STATE_REQUESTED_FIELDS =
  new Set<Exclude<DataIntelligenceConversationRequestedField, null>>([
    "document",
    "value",
    "account_number",
    "contact",
    "identity_document",
    "dob",
    "address",
    "expiration",
  ]);
const DATA_INTELLIGENCE_STATE_FAMILY_SCOPES =
  new Set<DataIntelligenceConversationFamilyScope>([
    "statement",
    "bank_statement",
    "credit_card_statement",
    "identity_document",
    "driver_license",
    "state_id",
  ]);
const DATA_INTELLIGENCE_STATE_TURN_KINDS =
  new Set<DataIntelligenceConversationTurnKind>([
    "list",
    "summary",
    "detail",
    "existence",
    "status",
    "not_found",
    "ambiguous",
    "unsupported",
  ]);

export function sanitizeDataIntelligenceConversationHistory(
  value: unknown,
): DataIntelligenceConversationMessage[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .slice(-DATA_INTELLIGENCE_HISTORY_MAX_MESSAGES)
    .map((entry): DataIntelligenceConversationMessage | null => {
      if (!entry || typeof entry !== "object") {
        return null;
      }

      const candidate = entry as { role?: unknown; text?: unknown };
      const role =
        candidate.role === "user" || candidate.role === "assistant"
          ? candidate.role
          : null;
      const text =
        typeof candidate.text === "string"
          ? candidate.text.trim().slice(0, DATA_INTELLIGENCE_HISTORY_MAX_TEXT_LENGTH)
          : "";

      if (!role || !text) {
        return null;
      }

      return {
        role,
        text,
      };
    })
    .filter(
      (entry): entry is DataIntelligenceConversationMessage => Boolean(entry),
    );
}

export function sanitizeDataIntelligenceConversationState(
  value: unknown,
): DataIntelligenceConversationState | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  const candidate = value as Record<string, unknown>;
  const activeClientName = readBoundedString(candidate.activeClientName);
  const lastSources = readSourceRefs(candidate.lastSources);
  const lastPrimarySource =
    readSourceRef(candidate.lastPrimarySource) ?? lastSources[0] ?? null;
  const activeStatementSource =
    readSourceRef(candidate.activeStatementSource) ??
    lastSources.find((source) => Boolean(source.accountType)) ??
    null;

  return {
    activeClientName,
    activeFamilyScope: readEnum(
      candidate.activeFamilyScope,
      DATA_INTELLIGENCE_STATE_FAMILY_SCOPES,
    ),
    activeAccountType:
      readEnum(candidate.activeAccountType, DATA_INTELLIGENCE_STATE_ACCOUNT_TYPES) ??
      null,
    activeStatementSource,
    alternateStatementSources: readSourceRefs(candidate.alternateStatementSources)
      .filter((source) => Boolean(source.accountType))
      .slice(0, DATA_INTELLIGENCE_STATE_MAX_SOURCES),
    lastIntent: readBoundedString(candidate.lastIntent),
    lastTurnKind: readEnum(
      candidate.lastTurnKind,
      DATA_INTELLIGENCE_STATE_TURN_KINDS,
    ),
    lastRequestedField:
      readEnum(candidate.lastRequestedField, DATA_INTELLIGENCE_STATE_REQUESTED_FIELDS) ??
      null,
    lastPrimarySource,
    lastSources,
  };
}

export function deriveDataIntelligenceConversationStateFromResult(input: {
  previousState: DataIntelligenceConversationState | null;
  result: {
    status: string;
    intent: string | null;
    sources: unknown[];
    presentation?: { mode?: string | null };
  };
}): DataIntelligenceConversationState {
  const previous = input.previousState;
  const sources = readSourceRefs(input.result.sources);
  const statementSources = sources.filter((source) => Boolean(source.accountType));
  const activeStatementSource = deriveActiveStatementSource({
    previous,
    result: input.result,
    statementSources,
  });
  const alternateStatementSources = deriveAlternateStatementSources({
    previous,
    statementSources,
    activeStatementSource,
  });
  const primarySource = sources[0] ?? previous?.lastPrimarySource ?? null;
  const activeClientName =
    firstPresentString(
      sources.map((source) => source.partyDisplayName),
    ) ??
    previous?.activeClientName ??
    null;
  const activeAccountType =
    activeStatementSource?.accountType ??
    deriveActiveAccountType(sources) ??
    previous?.activeAccountType ??
    null;
  const activeFamilyScope =
    deriveFamilyScope(input.result.intent, sources, activeAccountType) ??
    previous?.activeFamilyScope ??
    null;

  return {
    activeClientName,
    activeFamilyScope,
    activeAccountType,
    activeStatementSource,
    alternateStatementSources,
    lastIntent: input.result.intent ?? previous?.lastIntent ?? null,
    lastTurnKind: deriveTurnKind(input.result) ?? previous?.lastTurnKind ?? null,
    lastRequestedField:
      deriveRequestedField(input.result.intent) ??
      previous?.lastRequestedField ??
      null,
    lastPrimarySource: primarySource,
    lastSources: sources.length > 0 ? sources : previous?.lastSources ?? [],
  };
}

function deriveActiveStatementSource(input: {
  previous: DataIntelligenceConversationState | null;
  result: {
    status: string;
    intent: string | null;
  };
  statementSources: DataIntelligenceConversationSourceRef[];
}) {
  if (input.statementSources.length > 0) {
    return input.statementSources[0]!;
  }

  if (
    input.result.status === "answered" ||
    input.result.status === "not_found" ||
    input.result.status === "unsupported"
  ) {
    return input.previous?.activeStatementSource ?? null;
  }

  return input.previous?.activeStatementSource ?? null;
}

function deriveAlternateStatementSources(input: {
  previous: DataIntelligenceConversationState | null;
  statementSources: DataIntelligenceConversationSourceRef[];
  activeStatementSource: DataIntelligenceConversationSourceRef | null;
}) {
  const currentAlternates = input.statementSources.filter(
    (source) => !sameConversationSource(source, input.activeStatementSource),
  );
  const previousAlternates =
    input.previous?.alternateStatementSources.filter(
      (source) => !sameConversationSource(source, input.activeStatementSource),
    ) ?? [];
  const previousActive = input.previous?.activeStatementSource;
  const candidates = [
    ...currentAlternates,
    ...(previousActive &&
    !sameConversationSource(previousActive, input.activeStatementSource)
      ? [previousActive]
      : []),
    ...previousAlternates,
  ];

  return dedupeConversationSources(candidates).slice(
    0,
    DATA_INTELLIGENCE_STATE_MAX_SOURCES,
  );
}

function deriveRequestedField(
  intent: string | null,
): DataIntelligenceConversationRequestedField {
  switch (intent) {
    case "latest_account_document":
    case "statement_existence":
    case "statement_list":
      return "document";
    case "latest_account_snapshot":
      return "value";
    case "account_identifier_lookup":
      return "account_number";
    case "latest_account_contact":
      return "contact";
    case "identity_document_existence":
    case "latest_identity_document":
      return "identity_document";
    case "latest_identity_dob":
      return "dob";
    case "latest_identity_address":
      return "address";
    case "latest_identity_expiration":
    case "unexpired_driver_license_check":
      return "expiration";
    default:
      return null;
  }
}

function deriveActiveAccountType(
  sources: DataIntelligenceConversationSourceRef[],
) {
  const types = Array.from(
    new Set(
      sources
        .map((source) => source.accountType)
        .filter((value): value is string => Boolean(value)),
    ),
  );

  return types.length === 1 ? types[0]! : null;
}

function deriveFamilyScope(
  intent: string | null,
  sources: DataIntelligenceConversationSourceRef[],
  activeAccountType: string | null,
): DataIntelligenceConversationFamilyScope | null {
  if (intent?.startsWith("identity_") || intent?.includes("identity")) {
    return deriveIdentityScope(sources);
  }

  if (intent === "unexpired_driver_license_check") {
    return "driver_license";
  }

  if (
    intent?.includes("statement") ||
    intent?.includes("account") ||
    sources.some((source) => Boolean(source.accountType))
  ) {
    if (activeAccountType === "Credit Card") {
      return "credit_card_statement";
    }

    const accountTypes = new Set(
      sources
        .map((source) => source.accountType)
        .filter((value): value is string => Boolean(value)),
    );

    if (
      accountTypes.size > 0 &&
      Array.from(accountTypes).every((type) => type === "Checking" || type === "Savings")
    ) {
      return "bank_statement";
    }

    return "statement";
  }

  return null;
}

function deriveIdentityScope(
  sources: DataIntelligenceConversationSourceRef[],
): DataIntelligenceConversationFamilyScope {
  const idType = firstPresentString(sources.map((source) => source.idType));
  if (idType && /driver/i.test(idType)) {
    return "driver_license";
  }

  if (idType && /state/i.test(idType)) {
    return "state_id";
  }

  return "identity_document";
}

function deriveTurnKind(input: {
  status: string;
  intent: string | null;
  presentation?: { mode?: string | null };
}): DataIntelligenceConversationTurnKind | null {
  if (input.status === "not_found") {
    return "not_found";
  }

  if (input.status === "ambiguous") {
    return "ambiguous";
  }

  if (input.status === "unsupported") {
    return "unsupported";
  }

  if (input.intent?.endsWith("_existence")) {
    return "existence";
  }

  if (input.intent === "statement_list") {
    return "list";
  }

  if (input.intent === "unexpired_driver_license_check") {
    return "status";
  }

  if (input.presentation?.mode === "summary_answer") {
    return "summary";
  }

  return input.status === "answered" ? "detail" : null;
}

function readSourceRefs(value: unknown) {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .slice(0, DATA_INTELLIGENCE_STATE_MAX_SOURCES)
    .map(readSourceRef)
    .filter(
      (
        source,
      ): source is DataIntelligenceConversationSourceRef => Boolean(source),
    );
}

function readSourceRef(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  const candidate = value as Record<string, unknown>;
  const source: DataIntelligenceConversationSourceRef = {
    sourceFileId: readBoundedString(candidate.sourceFileId),
    sourceName: readBoundedString(candidate.sourceName),
    documentDate: readBoundedString(candidate.documentDate),
    statementEndDate: readBoundedString(candidate.statementEndDate),
    institutionName: readBoundedString(candidate.institutionName),
    accountType:
      readEnum(candidate.accountType, DATA_INTELLIGENCE_STATE_ACCOUNT_TYPES) ??
      readBoundedString(candidate.accountType),
    accountLast4: readLast4(candidate.accountLast4),
    maskedAccountNumber: readMaskedAccountNumber(candidate.maskedAccountNumber),
    partyDisplayName: readBoundedString(candidate.partyDisplayName),
    idType: readBoundedString(candidate.idType),
    expirationDate: readBoundedString(candidate.expirationDate),
  };

  return Object.values(source).some((entry) => Boolean(entry)) ? source : null;
}

function readBoundedString(value: unknown) {
  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();
  return trimmed ? trimmed.slice(0, DATA_INTELLIGENCE_STATE_MAX_TEXT_LENGTH) : null;
}

function readLast4(value: unknown) {
  const text = readBoundedString(value);
  if (!text) {
    return null;
  }

  const digits = text.replace(/\D/g, "");
  return digits.length === 4 ? digits : null;
}

function readMaskedAccountNumber(value: unknown) {
  const text = readBoundedString(value);
  if (!text) {
    return null;
  }

  return /[xX*•]/.test(text) ? text : null;
}

function readEnum<T extends string>(
  value: unknown,
  allowedValues: Set<T>,
) {
  return allowedValues.has(value as T) ? (value as T) : null;
}

function firstPresentString(values: Array<string | null | undefined>) {
  return values.find((value): value is string => Boolean(value)) ?? null;
}

function dedupeConversationSources(
  sources: DataIntelligenceConversationSourceRef[],
) {
  const seen = new Set<string>();
  const deduped: DataIntelligenceConversationSourceRef[] = [];

  for (const source of sources) {
    const key = conversationSourceKey(source);
    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    deduped.push(source);
  }

  return deduped;
}

function sameConversationSource(
  left: DataIntelligenceConversationSourceRef | null | undefined,
  right: DataIntelligenceConversationSourceRef | null | undefined,
) {
  if (!left || !right) {
    return false;
  }

  return conversationSourceKey(left) === conversationSourceKey(right);
}

function conversationSourceKey(source: DataIntelligenceConversationSourceRef) {
  return [
    source.sourceFileId,
    source.sourceName,
    source.accountType,
    source.accountLast4,
    source.idType,
  ]
    .filter(Boolean)
    .join("::");
}

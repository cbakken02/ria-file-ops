import {
  findAccountValuesForDocumentSnapshot,
  findLatestAccountIdentifierForAccount,
  findLatestAccountSnapshotsForParty,
  findLatestContactsForAccount,
  findLatestDocumentForAccount,
  findLatestDriverLicenseStatusForParty,
  findLatestIdentityAddressForParty,
  findLatestIdentityDobForParty,
  findLatestIdentityDocumentForParty,
  findLatestIdentityExpirationForParty,
  listFirmDocumentParties,
  type FirmDocumentAccountValue,
  type FirmDocumentLatestAccountIdentifier,
  type FirmDocumentLatestAccountSnapshot,
  type FirmDocumentLatestContact,
  type FirmDocumentPartyMatch,
} from "@/lib/firm-document-query";

export type QueryAssistantIntent =
  | "statement_existence"
  | "statement_list"
  | "account_identifier_lookup"
  | "latest_account_snapshot"
  | "latest_account_document"
  | "latest_account_contact"
  | "identity_document_existence"
  | "latest_identity_document"
  | "latest_identity_dob"
  | "latest_identity_address"
  | "latest_identity_expiration"
  | "unexpired_driver_license_check";

export type QueryAssistantResultStatus =
  | "answered"
  | "not_found"
  | "ambiguous"
  | "unsupported";

export type QueryAssistantSource = {
  sourceFileId?: string | null;
  sourceName: string | null;
  documentDate: string | null;
  statementEndDate?: string | null;
  institutionName?: string | null;
  accountType?: string | null;
  registrationType?: string | null;
  partyDisplayName?: string | null;
  accountLast4?: string | null;
  accountNumber?: string | null;
  maskedAccountNumber?: string | null;
  valueLabel?: string | null;
  valueAmount?: string | null;
  contactValue?: string | null;
  birthDate?: string | null;
  addressText?: string | null;
  issuingAuthority?: string | null;
  expirationDate?: string | null;
  idType?: string | null;
};

export type QueryAssistantPresentationMode =
  | "concise_answer"
  | "concise_answer_with_source"
  | "summary_answer"
  | "ambiguity_prompt"
  | "not_found"
  | "unsupported";

export type QueryAssistantPresentation = {
  mode: QueryAssistantPresentationMode;
  shellTone: "assistant" | "warning";
  showTitle: boolean;
  showDetails: boolean;
  detailLabel: string | null;
  showSourceLine: boolean;
  sourceLine: string | null;
  showSources: boolean;
  followUp: string | null;
};

export type QueryAssistantResult = {
  status: QueryAssistantResultStatus;
  intent: QueryAssistantIntent | null;
  question: string;
  title: string;
  answer: string;
  details: string[];
  sources: QueryAssistantSource[];
  presentation: QueryAssistantPresentation;
  debug?: Record<string, unknown>;
};

type QueryAssistantDraftResult = Omit<QueryAssistantResult, "presentation"> & {
  presentation?: Partial<QueryAssistantPresentation>;
};

export type AskFirmDocumentAssistantInput = {
  ownerEmail: string;
  question: string;
  dbPath?: string | null;
  retrievalPlan?: QueryAssistantRetrievalPlan | null;
  retrievalQuestion?: string | null;
};

type AssistantCues = {
  intent: QueryAssistantIntent | null;
  accountType: string | null;
  contactPurpose: "rollover_support" | "customer_service" | null;
  contactMethod: "phone" | "website" | null;
  identityKind: "driver_license" | "state_id" | null;
  valuePreference: string | null;
};

export type QueryAssistantResponseMode =
  | "direct_answer"
  | "summary_with_matches"
  | "answer_with_follow_up"
  | "clarifying_question"
  | "bounded_failure";

export type QueryAssistantQuestionType =
  | "existence"
  | "count_list"
  | "account_identifier"
  | "latest_document"
  | "latest_snapshot"
  | "latest_contact"
  | "latest_fact"
  | "status_check"
  | "unsupported";

export type QueryAssistantDocumentFamily =
  | "account_statement"
  | "identity_document"
  | null;

export type QueryAssistantFamilyScope =
  | "statement"
  | "bank_statement"
  | "credit_card_statement"
  | "identity_document"
  | "driver_license"
  | "state_id"
  | null;

export type QueryAssistantRetrievalPlan = {
  intent: QueryAssistantIntent | null;
  documentFamily: QueryAssistantDocumentFamily;
  questionType: QueryAssistantQuestionType;
  familyScope: QueryAssistantFamilyScope;
  accountType: string | null;
  accountFieldRequest: "account_number" | "routing_number" | null;
  contactPurpose: "rollover_support" | "customer_service" | null;
  contactMethod: "phone" | "website" | null;
  identityKind: "driver_license" | "state_id" | null;
  valuePreference: string | null;
  clarificationTarget: "account_type" | "identity_kind" | null;
  preferredResponseMode: QueryAssistantResponseMode;
};

type PartyResolution =
  | {
      status: "resolved";
      party: FirmDocumentPartyMatch;
    }
  | {
      status: "not_found";
      matches: FirmDocumentPartyMatch[];
    }
  | {
      status: "ambiguous";
      matches: FirmDocumentPartyMatch[];
    };

const ACCOUNT_TYPE_RULES: Array<{ canonical: string; pattern: RegExp }> = [
  { canonical: "Roth IRA", pattern: /\broth\s+ira\b/i },
  { canonical: "Traditional IRA", pattern: /\btraditional\s+ira\b/i },
  { canonical: "Rollover IRA", pattern: /\brollover\s+ira\b/i },
  { canonical: "SEP IRA", pattern: /\bsep\s+ira\b/i },
  { canonical: "SIMPLE IRA", pattern: /\bsimple\s+ira\b/i },
  { canonical: "401(k)", pattern: /\b401\s*\(?k\)?\b|\bemployer[- ]sponsored plan\b|\bretirement plan\b/i },
  { canonical: "403(b)", pattern: /\b403\s*\(?b\)?\b/i },
  { canonical: "Brokerage", pattern: /\bbrokerage\b/i },
  { canonical: "Credit Card", pattern: /\bcredit card\b|\bvisa\b|\bmastercard\b|\bmaster card\b|\bamex\b|\bamerican express\b/i },
  { canonical: "Checking", pattern: /\bchecking\b/i },
  { canonical: "Savings", pattern: /\bsavings\b/i },
  { canonical: "HSA", pattern: /\bhsa\b|\bhealth savings account\b/i },
  { canonical: "Annuity", pattern: /\bannuity\b/i },
  { canonical: "IRA", pattern: /\bira\b/i },
];

const VALUE_KIND_PATTERNS: Array<{ kind: string; pattern: RegExp }> = [
  { kind: "market_value", pattern: /\bmarket value\b/i },
  { kind: "ending_balance", pattern: /\bending balance\b/i },
  { kind: "available_balance", pattern: /\bavailable balance\b/i },
  { kind: "current_balance", pattern: /\bcurrent balance\b|\bbalance\b/i },
  { kind: "cash_value", pattern: /\bcash value\b/i },
  { kind: "vested_balance", pattern: /\bvested balance\b/i },
  { kind: "loan_balance", pattern: /\bloan balance\b/i },
];

const VALUE_KIND_PRIORITY = [
  "market_value",
  "ending_balance",
  "current_balance",
  "available_balance",
  "cash_value",
  "vested_balance",
  "contribution_balance",
  "loan_balance",
  "beginning_balance",
  "other",
] as const;

const BANK_STATEMENT_ACCOUNT_TYPES = new Set(["Checking", "Savings"]);
const CREDIT_CARD_STATEMENT_ACCOUNT_TYPES = new Set(["Credit Card"]);

export function askFirmDocumentAssistant(
  input: AskFirmDocumentAssistantInput,
): QueryAssistantResult {
  const question = input.question.trim();
  const retrievalQuestion = input.retrievalQuestion?.trim() || question;
  if (!question) {
    return presentResult({
      status: "unsupported",
      intent: null,
      question,
      title: "Question needed",
      answer: "Ask a question about a client's latest statement or identity document.",
      details: [
        "Examples: \"latest 401(k) balance for Christopher Bakken\"",
        "\"rollover support phone for Christopher Bakken's 401(k)\"",
        "\"what is Christopher Bakken's DOB?\"",
      ],
      sources: [],
    });
  }

  const plan = input.retrievalPlan ?? buildQueryAssistantRetrievalPlan(retrievalQuestion);
  if (!plan.intent) {
    return presentResult(
      unsupportedResult(
      question,
      "Unsupported question",
      "I can only answer a small set of statement and identity-document questions right now.",
      ),
      plan,
    );
  }

  const partyResolution = resolvePartyFromQuestion({
    ownerEmail: input.ownerEmail,
    dbPath: input.dbPath ?? null,
    question: retrievalQuestion,
    plan,
  });
  const executionInput = {
    ...input,
    question: retrievalQuestion,
  };

  if (partyResolution.status === "not_found") {
    return presentResult(clientNeededOrNotFoundResult(question, plan.intent), plan);
  }

  if (partyResolution.status === "ambiguous") {
    return presentResult({
      status: "ambiguous",
      intent: plan.intent,
      question,
      title: "Client match is ambiguous",
      answer: "I found more than one possible client match, so I'm not guessing.",
      details: partyResolution.matches
        .slice(0, 5)
        .map((match) => formatPartyMatchDetail(match)),
      sources: [],
    }, plan);
  }

  switch (plan.intent) {
    case "statement_existence":
      return presentResult(
        answerStatementExistence(executionInput, partyResolution.party, plan),
        plan,
      );
    case "statement_list":
      return presentResult(
        answerStatementList(executionInput, partyResolution.party, plan),
        plan,
      );
    case "account_identifier_lookup":
      return presentResult(
        answerAccountIdentifierLookup(executionInput, partyResolution.party, plan),
        plan,
      );
    case "latest_account_snapshot":
      return presentResult(
        answerLatestAccountSnapshot(executionInput, partyResolution.party, plan),
        plan,
      );
    case "latest_account_document":
      return presentResult(
        answerLatestAccountDocument(executionInput, partyResolution.party, plan),
        plan,
      );
    case "latest_account_contact":
      return presentResult(
        answerLatestAccountContact(executionInput, partyResolution.party, plan),
        plan,
      );
    case "identity_document_existence":
      return presentResult(
        answerIdentityDocumentExistence(executionInput, partyResolution.party, plan),
        plan,
      );
    case "latest_identity_document":
      return presentResult(
        answerLatestIdentityDocument(executionInput, partyResolution.party, plan),
        plan,
      );
    case "latest_identity_dob":
      return presentResult(
        answerLatestIdentityDob(executionInput, partyResolution.party, plan),
        plan,
      );
    case "latest_identity_address":
      return presentResult(
        answerLatestIdentityAddress(executionInput, partyResolution.party, plan),
        plan,
      );
    case "latest_identity_expiration":
      return presentResult(
        answerLatestIdentityExpiration(executionInput, partyResolution.party, plan),
        plan,
      );
    case "unexpired_driver_license_check":
      return presentResult(
        answerDriverLicenseStatus(executionInput, partyResolution.party, plan),
        plan,
      );
    default:
      return presentResult(
        unsupportedResult(
          question,
          "Unsupported question",
          "That question type is not wired into the assistant yet.",
        ),
        plan,
      );
  }
}

export function buildQueryAssistantRetrievalPlan(
  question: string,
): QueryAssistantRetrievalPlan {
  const normalized = normalizeQuestion(question);
  const accountType = extractAccountType(question);
  const identityKind = extractIdentityKind(normalized);
  const familyScope = resolveFamilyScope(question, accountType, identityKind);
  const accountFieldRequest = extractAccountFieldRequest(question);
  const contactMethod = /\bwebsite\b|\bweb site\b|\burl\b|\bsite\b/i.test(question)
    ? "website"
    : /\bphone\b|\bcall\b|\bnumber\b/i.test(question)
      ? "phone"
      : null;
  const contactPurpose = /\brollover\b/i.test(question)
    ? "rollover_support"
    : /\bcustomer service\b|\bsupport\b|\bcontact\b|\bphone\b/i.test(question)
      ? "customer_service"
      : null;
  const valuePreference =
    VALUE_KIND_PATTERNS.find((rule) => rule.pattern.test(question))?.kind ??
    null;

  let intent: QueryAssistantIntent | null = null;
  let documentFamily: QueryAssistantDocumentFamily = null;
  let questionType: QueryAssistantQuestionType = "unsupported";
  let clarificationTarget: "account_type" | "identity_kind" | null = null;
  let preferredResponseMode: QueryAssistantResponseMode = "bounded_failure";

  const asksLatest = /\blatest\b|\bmost recent\b|\bnewest\b|\bcurrent\b/i.test(
    question,
  );
  const asksExistence =
    /\bdo we have\b|\bon file\b|\bany\b|\bhave\b.*\b(on file|available)\b|\b(?:does|has|have)\b.*\bstatements?\b.*\buploaded\b|\bexists?\b/i.test(
      question,
    );
  const asksCountList =
    /\bhow many\b|\blist\b|\bshow\b|\bwhich\b.*\bstatements?\b|\bwhat\b.*\bstatements\b|\bstatements\b.*\buploaded\b/i.test(
      question,
    );
  const mentionsStatement =
    /\bstatements?\b|\bdocuments?\b/i.test(question) || accountType !== null;
  const mentionsIdentity =
    /\bid\b|\bidentity\b|\blicense\b|\bdriver'?s?\s+license\b|\bstate id\b/i.test(
      question,
    );

  if (/\bdob\b|\bdate of birth\b|\bborn\b/i.test(question)) {
    intent = "latest_identity_dob";
    documentFamily = "identity_document";
    questionType = "latest_fact";
    preferredResponseMode = "direct_answer";
  } else if (accountFieldRequest) {
    intent = "account_identifier_lookup";
    documentFamily = "account_statement";
    questionType = "account_identifier";
    clarificationTarget = accountType ? null : "account_type";
    preferredResponseMode = accountType
      ? "direct_answer"
      : "answer_with_follow_up";
  } else if (
    /\bunexpired\b|\bexpired\b|\bon file\b/i.test(question) &&
    /\bdriver'?s?\s+license\b|\blicense\b/i.test(question)
  ) {
    intent = "unexpired_driver_license_check";
    documentFamily = "identity_document";
    questionType = "status_check";
    preferredResponseMode = "direct_answer";
  } else if (
    /\bexpiration\b|\bexpire\b|\bexpires\b/i.test(question) &&
    (identityKind !== null || /\bid\b|\blicense\b/i.test(question))
  ) {
    intent = "latest_identity_expiration";
    documentFamily = "identity_document";
    questionType = "latest_fact";
    preferredResponseMode = "direct_answer";
  } else if (
    /\baddress\b/i.test(question) &&
    (identityKind !== null || /\bid\b|\blicense\b/i.test(question))
  ) {
    intent = "latest_identity_address";
    documentFamily = "identity_document";
    questionType = "latest_fact";
    preferredResponseMode = "direct_answer";
  } else if (asksExistence && mentionsIdentity) {
    intent = "identity_document_existence";
    documentFamily = "identity_document";
    questionType = "existence";
    preferredResponseMode = "summary_with_matches";
  } else if (
    /\blatest\b.*\b(id|license|state id)\b/i.test(question) ||
    /\bmost recent\b.*\b(id|license|state id)\b/i.test(question)
  ) {
    intent = "latest_identity_document";
    documentFamily = "identity_document";
    questionType = "latest_document";
    preferredResponseMode = "direct_answer";
  } else if (
    /\brollover\b|\bcustomer service\b|\bcontact\b|\bphone\b|\bwebsite\b|\bsupport\b/i.test(
      question,
    )
  ) {
    intent = "latest_account_contact";
    documentFamily = "account_statement";
    questionType = "latest_contact";
    clarificationTarget = accountType ? null : "account_type";
    preferredResponseMode = accountType
      ? "direct_answer"
      : "answer_with_follow_up";
  } else if (asksCountList && (mentionsStatement || familyScope === "bank_statement")) {
    intent = "statement_list";
    documentFamily = "account_statement";
    questionType = "count_list";
    preferredResponseMode = "summary_with_matches";
  } else if (asksExistence && (mentionsStatement || familyScope === "bank_statement")) {
    intent = "statement_existence";
    documentFamily = "account_statement";
    questionType = "existence";
    preferredResponseMode = "summary_with_matches";
  } else if (
    /\blatest\b.*\b(document|statement)\b|\bmost recent\b.*\b(document|statement)\b/i.test(
      question,
    )
  ) {
    intent = "latest_account_document";
    documentFamily = "account_statement";
    questionType = "latest_document";
    clarificationTarget = accountType ? null : "account_type";
    preferredResponseMode = accountType
      ? "direct_answer"
      : "answer_with_follow_up";
  } else if (
    /\bsnapshot\b|\bbalance\b|\bmarket value\b|\bstatement\b/i.test(question) ||
    accountType !== null
  ) {
    intent = "latest_account_snapshot";
    documentFamily = "account_statement";
    questionType = "latest_snapshot";
    clarificationTarget = accountType ? null : "account_type";
    preferredResponseMode =
      accountType || familyScope === "bank_statement"
        ? "answer_with_follow_up"
        : "clarifying_question";
  } else if (
    /\b(id|license|state id|driver license)\b/i.test(question)
  ) {
    intent = "latest_identity_document";
    documentFamily = "identity_document";
    questionType = asksLatest ? "latest_document" : "existence";
    preferredResponseMode = asksLatest
      ? "direct_answer"
      : "summary_with_matches";
    if (questionType === "existence") {
      intent = "identity_document_existence";
    }
  }

  return {
    intent,
    documentFamily,
    questionType,
    familyScope,
    accountType,
    accountFieldRequest,
    contactPurpose,
    contactMethod,
    identityKind,
    valuePreference,
    clarificationTarget,
    preferredResponseMode,
  };
}

export function detectAssistantCues(question: string): AssistantCues {
  const plan = buildQueryAssistantRetrievalPlan(question);

  return {
    intent: plan.intent,
    accountType: plan.accountType,
    contactPurpose: plan.contactPurpose,
    contactMethod: plan.contactMethod,
    identityKind: plan.identityKind,
    valuePreference: plan.valuePreference,
  };
}

function answerStatementExistence(
  input: AskFirmDocumentAssistantInput,
  party: FirmDocumentPartyMatch,
  plan: QueryAssistantRetrievalPlan,
): QueryAssistantDraftResult {
  const snapshots = getMatchingStatementSnapshots(input, party, plan);
  if (snapshots.length === 0) {
    return notFoundResult(
      input.question,
      plan.intent,
      `No ${describeStatementScope(plan, snapshots.length)} found`,
      `I couldn't find ${withIndefiniteArticle(describeStatementScope(plan, 1))} for ${party.canonicalDisplayName}.`,
    );
  }

  const latest = snapshots[0]!;
  const latestDate = latest.statementEndDate ?? latest.documentDate;
  const subject = party.canonicalDisplayName ?? "This client";
  const scopeLabel = describeStatementScope(plan, snapshots.length);
  const titleScope = capitalizeLabel(describeStatementScope(plan, 2));
  const additionalTypesSentence = buildAdditionalStatementTypesSentence(
    snapshots,
    plan,
    latest,
  );

  return {
    status: "answered",
    intent: plan.intent,
    question: input.question,
    title: `${titleScope} on file`,
    answer:
      snapshots.length === 1
        ? `Yes. ${subject} has ${withIndefiniteArticle(scopeLabel)} on file. The latest is ${describeSnapshotRecord(latest)}${latestDate ? ` dated ${latestDate}` : ""}.`
        : `Yes. ${subject} has ${snapshots.length} ${scopeLabel} on file. The latest is ${describeSnapshotRecord(latest)}${latestDate ? ` dated ${latestDate}` : ""}.${additionalTypesSentence}`,
    details: snapshots.length > 1 ? buildStatementMatchDetails(snapshots, plan) : [],
    sources: buildStatementSources(input, snapshots),
  };
}

function answerStatementList(
  input: AskFirmDocumentAssistantInput,
  party: FirmDocumentPartyMatch,
  plan: QueryAssistantRetrievalPlan,
): QueryAssistantDraftResult {
  const snapshots = getMatchingStatementSnapshots(input, party, plan);
  if (snapshots.length === 0) {
    return notFoundResult(
      input.question,
      plan.intent,
      `No ${describeStatementScope(plan, 2)} found`,
      `I couldn't find any matching ${describeStatementScope(plan, 2)} for ${party.canonicalDisplayName}.`,
    );
  }

  const latest = snapshots[0]!;
  const coveragePhrase = buildStatementCoveragePhrase(snapshots, plan);

  return {
    status: "answered",
    intent: plan.intent,
    question: input.question,
    title: `${capitalizeLabel(describeStatementScope(plan, 2))} on file`,
    answer: `I found ${snapshots.length} ${describeStatementScope(plan, snapshots.length)} for ${party.canonicalDisplayName}${coveragePhrase}. The latest is ${describeSnapshotRecord(latest)}${formatSnapshotDateSuffix(latest)}.`,
    details: buildStatementMatchDetails(snapshots, plan),
    sources: buildStatementSources(input, snapshots),
  };
}

function answerLatestAccountSnapshot(
  input: AskFirmDocumentAssistantInput,
  party: FirmDocumentPartyMatch,
  plan: QueryAssistantRetrievalPlan,
): QueryAssistantDraftResult {
  const snapshots = getMatchingStatementSnapshots(input, party, plan);

  if (snapshots.length === 0) {
    const scopeLabel = describeStatementScope(plan, 1);
    return notFoundResult(
      input.question,
      plan.intent,
      `No ${scopeLabel} found`,
      `I couldn't find ${withIndefiniteArticle(scopeLabel)} for ${party.canonicalDisplayName}.`,
    );
  }

  if (plan.accountType && snapshots.length > 1) {
    return {
      status: "ambiguous",
      intent: plan.intent,
      question: input.question,
      title: "Multiple matching accounts",
      answer: `I found more than one ${plan.accountType} for ${party.canonicalDisplayName}, so I need a narrower question.`,
      details: snapshots.slice(0, 5).map((snapshot) => formatSnapshotOption(snapshot)),
      sources: [],
    };
  }

  const snapshot = snapshots[0]!;
  const values = findAccountValuesForDocumentSnapshot({
    ownerEmail: input.ownerEmail,
    dbPath: input.dbPath ?? null,
    documentAccountSnapshotId: snapshot.documentAccountSnapshotId,
  });
  const preferredValue = selectPreferredAccountValue(values, plan.valuePreference);
  const balanceText = preferredValue
    ? `${formatValueKind(preferredValue.kind)} ${formatMoney(preferredValue.amount, preferredValue.currency)}`
    : null;
  const scopeLabel = describeStatementScope(plan, 1);
  const titleLabel = `Latest ${scopeLabel}`;
  const subject = party.canonicalDisplayName ?? "This client";
  const statementLabel = `latest ${scopeLabel}`;

  return {
    status: "answered",
    intent: plan.intent,
    question: input.question,
    title: titleLabel,
    answer: balanceText
      ? `${subject}'s ${statementLabel} is ${describeSnapshotRecord(snapshot)}. ${balanceText}.`
      : `${subject}'s ${statementLabel} is ${describeSnapshotRecord(snapshot)}.`,
    details: buildFollowUpSuggestion(snapshots, plan),
    sources: buildStatementSources(input, [snapshot]).map((source) => ({
      ...source,
      valueLabel: preferredValue
        ? preferredValue.label ?? formatValueKind(preferredValue.kind)
        : null,
      valueAmount: preferredValue
        ? formatMoney(preferredValue.amount, preferredValue.currency)
        : null,
    })),
  };
}

function answerLatestAccountDocument(
  input: AskFirmDocumentAssistantInput,
  party: FirmDocumentPartyMatch,
  plan: QueryAssistantRetrievalPlan,
): QueryAssistantDraftResult {
  const snapshots = getMatchingStatementSnapshots(input, party, plan);

  if (snapshots.length === 0) {
    return notFoundResult(
      input.question,
      plan.intent,
      `No ${describeStatementScope(plan, 1)} found`,
      `I couldn't find ${withIndefiniteArticle(describeStatementScope(plan, 1))} for ${party.canonicalDisplayName}.`,
    );
  }

  if (plan.accountType && snapshots.length > 1) {
    return {
      status: "ambiguous",
      intent: plan.intent,
      question: input.question,
      title: "Multiple matching accounts",
      answer: `I found more than one ${plan.accountType} for ${party.canonicalDisplayName}, so I'm not picking a document automatically.`,
      details: snapshots.map((snapshot) => formatSnapshotOption(snapshot)),
      sources: [],
    };
  }

  const latestSnapshot = snapshots[0]!;
  const latestDocument = findLatestDocumentForAccount({
    ownerEmail: input.ownerEmail,
    dbPath: input.dbPath ?? null,
    accountId: latestSnapshot.accountId,
  });

  if (!latestDocument) {
    return notFoundResult(
      input.question,
      plan.intent,
      "Latest document not found",
      `I found the account, but not a latest document row for ${party.canonicalDisplayName}.`,
    );
  }

  return {
    status: "answered",
    intent: plan.intent,
    question: input.question,
    title: `Latest ${describeStatementScope(plan, 1)}`,
    answer: plan.accountType
      ? `The latest ${plan.accountType} statement for ${party.canonicalDisplayName} is ${latestDocument.sourceName ?? "an unknown file"}.`
      : `The latest ${describeStatementScope(plan, 1)} for ${party.canonicalDisplayName} is ${latestDocument.sourceName ?? "an unknown file"}.`,
    details: buildFollowUpSuggestion(snapshots, plan),
    sources: buildStatementSources(input, [latestSnapshot]),
  };
}

function answerLatestAccountContact(
  input: AskFirmDocumentAssistantInput,
  party: FirmDocumentPartyMatch,
  plan: QueryAssistantRetrievalPlan,
): QueryAssistantDraftResult {
  const snapshots = getMatchingStatementSnapshots(input, party, plan);
  if (snapshots.length === 0) {
    return notFoundResult(
      input.question,
      plan.intent,
      "No statement found",
      `I couldn't find a statement for ${party.canonicalDisplayName} that includes that contact.`,
    );
  }

  if (plan.accountType && snapshots.length > 1) {
    return {
      status: "ambiguous",
      intent: plan.intent,
      question: input.question,
      title: "Multiple matching accounts",
      answer: `I found more than one ${plan.accountType} for ${party.canonicalDisplayName}, so I'm not choosing a contact automatically.`,
      details: snapshots.map((snapshot) => formatSnapshotOption(snapshot)),
      sources: [],
    };
  }

  const contactMatches = collectLatestContactsForSnapshots(input, snapshots, plan);
  if (contactMatches.length === 0) {
    const scopeLabel = plan.accountType
      ? `latest ${plan.accountType} document`
      : `latest ${describeStatementScope(plan, 1)}`;
    return notFoundResult(
      input.question,
      plan.intent,
      "No contact found",
      `I couldn't find that contact on the ${scopeLabel} for ${party.canonicalDisplayName}.`,
    );
  }

  const primary = contactMatches[0]!;
  const contactLabel = `${formatPurpose(primary.contact.purpose)} ${primary.contact.method}`;
  const accountLabel =
    plan.accountType ?? primary.snapshot.normalizedAccountType ?? "statement";

  return {
    status: "answered",
    intent: plan.intent,
    question: input.question,
    title: `Latest ${contactLabel}`,
    answer: `The ${contactLabel.toLowerCase()} on ${party.canonicalDisplayName}'s ${accountLabel} is ${primary.contact.normalizedValue ?? primary.contact.rawValue ?? "not available"}.`,
    details: buildContactFollowUpSuggestion(contactMatches, plan),
    sources: [
      {
        sourceFileId: primary.contact.sourceFileId,
        sourceName: primary.contact.sourceName,
        documentDate: primary.contact.documentDate,
        statementEndDate: primary.contact.statementEndDate,
        institutionName: primary.contact.institutionName,
        accountType: accountLabel,
        contactValue:
          primary.contact.normalizedValue ?? primary.contact.rawValue ?? null,
      },
    ],
  };
}

function answerAccountIdentifierLookup(
  input: AskFirmDocumentAssistantInput,
  party: FirmDocumentPartyMatch,
  plan: QueryAssistantRetrievalPlan,
): QueryAssistantDraftResult {
  const snapshots = getMatchingStatementSnapshots(input, party, plan);
  const requestedField = plan.accountFieldRequest;
  const accountLabel = plan.accountType
    ? `${plan.accountType} account`
    : `${describeStatementScope(plan, 1)} account`;

  if (!requestedField) {
    return unsupportedResult(
      input.question,
      "Unsupported account detail request",
      "I can only look up account-number style fields when the question asks for them explicitly.",
    );
  }

  if (snapshots.length === 0) {
    const fieldLabel =
      requestedField === "routing_number" ? "routing details" : "account number";
    return notFoundResult(
      input.question,
      plan.intent,
      `${capitalizeLabel(fieldLabel)} not found`,
      `I couldn't find ${withIndefiniteArticle(accountLabel)} for ${party.canonicalDisplayName} with ${fieldLabel} on file.`,
    );
  }

  if (snapshots.length > 1) {
    return {
      status: "ambiguous",
      intent: plan.intent,
      question: input.question,
      title: "Multiple matching accounts",
      answer: `I found more than one matching account for ${party.canonicalDisplayName}, so I need a narrower question before I show account details.`,
      details: snapshots.slice(0, 5).map((snapshot) => formatSnapshotOption(snapshot)),
      sources: [],
    };
  }

  const snapshot = snapshots[0]!;
  const identifier = findLatestAccountIdentifierForAccount({
    ownerEmail: input.ownerEmail,
    dbPath: input.dbPath ?? null,
    accountId: snapshot.accountId,
  });

  if (!identifier) {
    return notFoundResult(
      input.question,
      plan.intent,
      "Account details not found",
      `I found the matching account for ${party.canonicalDisplayName}, but not a stored identifier row for it.`,
    );
  }

  if (requestedField === "routing_number") {
    return notFoundResult(
      input.question,
      plan.intent,
      "Routing details not found",
      `I found the matching ${accountLabel} for ${party.canonicalDisplayName}, but I don't have routing details stored for it.`,
    );
  }

  if (!identifier.accountNumber) {
    const maskedDescription = identifier.maskedAccountNumber
      ? ` I only have a masked account number stored${identifier.maskedAccountNumber ? ` (${identifier.maskedAccountNumber})` : ""}.`
      : "";
    return notFoundResult(
      input.question,
      plan.intent,
      "Full account number not found",
      `I found the matching ${accountLabel} for ${party.canonicalDisplayName}, but I don't have a full account number stored for it.${maskedDescription}`.trim(),
    );
  }

  const descriptor = compact([
    identifier.institutionName,
    identifier.normalizedAccountType,
  ]).join(" ");

  return {
    status: "answered",
    intent: plan.intent,
    question: input.question,
    title: "Full account number",
    answer: `The full account number on ${party.canonicalDisplayName}'s ${descriptor || "matching"} account is ${identifier.accountNumber}.`,
    details: [],
    sources: [
      {
        sourceFileId: identifier.sourceFileId,
        sourceName: identifier.sourceName,
        documentDate: identifier.documentDate,
        statementEndDate: identifier.statementEndDate,
        institutionName: identifier.institutionName,
        accountType: identifier.normalizedAccountType,
        accountNumber: identifier.accountNumber,
        accountLast4: identifier.accountLast4,
        maskedAccountNumber: identifier.maskedAccountNumber,
      },
    ],
  };
}

function answerIdentityDocumentExistence(
  input: AskFirmDocumentAssistantInput,
  party: FirmDocumentPartyMatch,
  plan: QueryAssistantRetrievalPlan,
): QueryAssistantDraftResult {
  const latestIdentityDocument = findLatestIdentityDocumentForParty({
    ownerEmail: input.ownerEmail,
    dbPath: input.dbPath ?? null,
    partyId: party.partyId,
    idKind: plan.identityKind,
  });

  if (!latestIdentityDocument) {
    return notFoundResult(
      input.question,
      plan.intent,
      "No matching identity document found",
      `I couldn't find a matching ID on file for ${party.canonicalDisplayName}.`,
    );
  }

  const idLabel = latestIdentityDocument.idType ?? "identity document";
  return {
    status: "answered",
    intent: plan.intent,
    question: input.question,
    title: "Identity document on file",
    answer: `Yes. I found a ${idLabel} on file for ${party.canonicalDisplayName}${latestIdentityDocument.expirationDate ? `, expiring ${latestIdentityDocument.expirationDate}` : ""}.`,
    details: [],
    sources: [
      {
        sourceFileId: latestIdentityDocument.sourceFileId,
        sourceName: latestIdentityDocument.sourceName,
        documentDate: latestIdentityDocument.documentDate,
        partyDisplayName:
          latestIdentityDocument.partyDisplayName ?? party.canonicalDisplayName,
        birthDate: latestIdentityDocument.birthDate,
        addressText: latestIdentityDocument.addressRawText,
        issuingAuthority: latestIdentityDocument.issuingAuthority,
        expirationDate: latestIdentityDocument.expirationDate,
        idType: latestIdentityDocument.idType,
      },
    ],
  };
}

function answerLatestIdentityDocument(
  input: AskFirmDocumentAssistantInput,
  party: FirmDocumentPartyMatch,
  plan: QueryAssistantRetrievalPlan,
): QueryAssistantDraftResult {
  const latestIdentityDocument = findLatestIdentityDocumentForParty({
    ownerEmail: input.ownerEmail,
    dbPath: input.dbPath ?? null,
    partyId: party.partyId,
    idKind: plan.identityKind,
  });

  if (!latestIdentityDocument) {
    return notFoundResult(
      input.question,
      plan.intent,
      "No matching identity document found",
      `I couldn't find a matching identity document for ${party.canonicalDisplayName}.`,
    );
  }

  return {
    status: "answered",
    intent: plan.intent,
    question: input.question,
    title: "Latest identity document",
    answer: `The latest ${latestIdentityDocument.idType ?? "identity document"} on file for ${party.canonicalDisplayName} is ${latestIdentityDocument.sourceName ?? "an unknown file"}${latestIdentityDocument.expirationDate ? `. It expires on ${latestIdentityDocument.expirationDate}` : "."}`,
    details: [],
    sources: [
      {
        sourceFileId: latestIdentityDocument.sourceFileId,
        sourceName: latestIdentityDocument.sourceName,
        documentDate: latestIdentityDocument.documentDate,
        partyDisplayName:
          latestIdentityDocument.partyDisplayName ?? party.canonicalDisplayName,
        birthDate: latestIdentityDocument.birthDate,
        addressText: latestIdentityDocument.addressRawText,
        issuingAuthority: latestIdentityDocument.issuingAuthority,
        expirationDate: latestIdentityDocument.expirationDate,
        idType: latestIdentityDocument.idType,
      },
    ],
  };
}

function answerLatestIdentityDob(
  input: AskFirmDocumentAssistantInput,
  party: FirmDocumentPartyMatch,
  plan: QueryAssistantRetrievalPlan,
): QueryAssistantDraftResult {
  const latestDob = findLatestIdentityDobForParty({
    ownerEmail: input.ownerEmail,
    dbPath: input.dbPath ?? null,
    partyId: party.partyId,
  });

  if (!latestDob) {
    return notFoundResult(
      input.question,
      plan.intent,
      "DOB not found",
      `I couldn't find a DOB for ${party.canonicalDisplayName} in the identity-document store.`,
    );
  }

  return {
    status: "answered",
    intent: plan.intent,
    question: input.question,
    title: "Latest DOB on file",
    answer: `${party.canonicalDisplayName}'s DOB on the latest ID on file is ${latestDob.birthDate}.`,
    details: [],
    sources: [
      {
        sourceFileId: latestDob.sourceFileId,
        sourceName: latestDob.sourceName,
        documentDate: latestDob.documentDate,
        partyDisplayName: latestDob.partyDisplayName ?? party.canonicalDisplayName,
        birthDate: latestDob.birthDate,
        idType: latestDob.idType,
      },
    ],
  };
}

function answerLatestIdentityAddress(
  input: AskFirmDocumentAssistantInput,
  party: FirmDocumentPartyMatch,
  plan: QueryAssistantRetrievalPlan,
): QueryAssistantDraftResult {
  const latestAddress = findLatestIdentityAddressForParty({
    ownerEmail: input.ownerEmail,
    dbPath: input.dbPath ?? null,
    partyId: party.partyId,
  });

  if (!latestAddress) {
    return notFoundResult(
      input.question,
      plan.intent,
      "ID address not found",
      `I couldn't find an identity-document address for ${party.canonicalDisplayName}.`,
    );
  }

  return {
    status: "answered",
    intent: plan.intent,
    question: input.question,
    title: "Latest ID address",
    answer: `The address on ${party.canonicalDisplayName}'s latest ID is ${latestAddress.addressRawText}.`,
    details: [],
    sources: [
      {
        sourceFileId: latestAddress.sourceFileId,
        sourceName: latestAddress.sourceName,
        documentDate: latestAddress.documentDate,
        partyDisplayName:
          latestAddress.partyDisplayName ?? party.canonicalDisplayName,
        addressText: latestAddress.addressRawText,
        idType: latestAddress.idType,
      },
    ],
  };
}

function answerLatestIdentityExpiration(
  input: AskFirmDocumentAssistantInput,
  party: FirmDocumentPartyMatch,
  plan: QueryAssistantRetrievalPlan,
): QueryAssistantDraftResult {
  const latestExpiration = findLatestIdentityExpirationForParty({
    ownerEmail: input.ownerEmail,
    dbPath: input.dbPath ?? null,
    partyId: party.partyId,
    idKind: plan.identityKind,
  });

  if (!latestExpiration) {
    return notFoundResult(
      input.question,
      plan.intent,
      "ID expiration not found",
      `I couldn't find an expiration date for ${party.canonicalDisplayName}'s latest identity document.`,
    );
  }

  return {
    status: "answered",
    intent: plan.intent,
    question: input.question,
    title: "Latest ID expiration",
    answer: `${party.canonicalDisplayName}'s latest ${latestExpiration.idType ?? "identity document"} expires on ${latestExpiration.expirationDate}.`,
    details: [],
    sources: [
      {
        sourceFileId: latestExpiration.sourceFileId,
        sourceName: latestExpiration.sourceName,
        documentDate: latestExpiration.documentDate,
        partyDisplayName:
          latestExpiration.partyDisplayName ?? party.canonicalDisplayName,
        expirationDate: latestExpiration.expirationDate,
        idType: latestExpiration.idType,
      },
    ],
  };
}

function answerDriverLicenseStatus(
  input: AskFirmDocumentAssistantInput,
  party: FirmDocumentPartyMatch,
  plan: QueryAssistantRetrievalPlan,
): QueryAssistantDraftResult {
  const licenseStatus = findLatestDriverLicenseStatusForParty({
    ownerEmail: input.ownerEmail,
    dbPath: input.dbPath ?? null,
    partyId: party.partyId,
  });

  if (licenseStatus.status === "not_found") {
    return notFoundResult(
      input.question,
      plan.intent,
      "No driver's license found",
      `I couldn't find a driver's license on file for ${party.canonicalDisplayName}.`,
    );
  }

  if (licenseStatus.status === "missing_expiration") {
    return {
      status: "answered",
      intent: plan.intent,
      question: input.question,
      title: "Driver's license status is incomplete",
      answer: `I found a driver's license for ${party.canonicalDisplayName}, but the latest document does not include a readable expiration date.`,
      details: [],
      sources: [
        {
          sourceFileId: licenseStatus.sourceFileId,
          sourceName: licenseStatus.sourceName,
          documentDate: licenseStatus.documentDate,
          partyDisplayName:
            licenseStatus.partyDisplayName ?? party.canonicalDisplayName,
          expirationDate: licenseStatus.expirationDate,
          idType: licenseStatus.idType,
        },
      ],
    };
  }

  return {
    status: "answered",
    intent: plan.intent,
    question: input.question,
    title: "Driver's license status",
    answer: licenseStatus.isUnexpired
      ? `Yes. ${party.canonicalDisplayName} has an unexpired driver's license on file.`
      : `No. ${party.canonicalDisplayName}'s latest driver's license on file is expired.`,
    details: [],
    sources: [
      {
        sourceFileId: licenseStatus.sourceFileId,
        sourceName: licenseStatus.sourceName,
        documentDate: licenseStatus.documentDate,
        partyDisplayName:
          licenseStatus.partyDisplayName ?? party.canonicalDisplayName,
        expirationDate: licenseStatus.expirationDate,
        idType: licenseStatus.idType,
      },
    ],
  };
}

function resolvePartyFromQuestion(input: {
  ownerEmail: string;
  dbPath: string | null;
  question: string;
  plan: QueryAssistantRetrievalPlan;
}): PartyResolution {
  const parties = listFirmDocumentParties({
    ownerEmail: input.ownerEmail,
    dbPath: input.dbPath,
  });
  const normalizedQuestion = normalizeQuestion(input.question);
  const relaxedQuestion = dropSingleLetterTokens(normalizedQuestion);

  const scoredMatches = parties
    .map((party) => {
      const exactName = normalizeQuestion(party.canonicalDisplayName ?? "");
      const relaxedName = dropSingleLetterTokens(exactName);
      const signatureName = extractNameSignature(exactName);
      const exactMatch = exactName && normalizedQuestion.includes(exactName);
      const exactMatchInRelaxedQuestion =
        exactName &&
        relaxedQuestion !== normalizedQuestion &&
        relaxedQuestion.includes(exactName);
      const relaxedMatch =
        relaxedName &&
        (normalizedQuestion.includes(relaxedName) ||
          (relaxedQuestion !== normalizedQuestion &&
            relaxedQuestion.includes(relaxedName)));
      const signatureMatch =
        signatureName &&
        signatureName !== exactName &&
        signatureName !== relaxedName &&
        relaxedQuestion.includes(signatureName);

      if (
        !exactMatch &&
        !exactMatchInRelaxedQuestion &&
        !relaxedMatch &&
        !signatureMatch
      ) {
        return null;
      }

      const matchedText = exactMatch
        ? exactName
        : exactMatchInRelaxedQuestion
          ? exactName
          : relaxedMatch
            ? relaxedName
            : signatureName;

      return {
        party,
        score: exactMatch ? 4 : exactMatchInRelaxedQuestion ? 3 : relaxedMatch ? 2 : 1,
        length: matchedText.length,
      };
    })
    .filter((value): value is { party: FirmDocumentPartyMatch; score: number; length: number } => Boolean(value))
    .sort((left, right) => {
      if (right.score !== left.score) {
        return right.score - left.score;
      }
      if (right.length !== left.length) {
        return right.length - left.length;
      }
      return (left.party.canonicalDisplayName ?? "").localeCompare(
        right.party.canonicalDisplayName ?? "",
      );
    });

  if (scoredMatches.length === 0) {
    return {
      status: "not_found",
      matches: [],
    };
  }

  const supportedMatches = scoredMatches.filter((match) =>
    partySupportsIntent({
      ownerEmail: input.ownerEmail,
      dbPath: input.dbPath,
      question: input.question,
      party: match.party,
      plan: input.plan,
    }),
  );

  if (supportedMatches.length > 0) {
    const bestSupportedScore = supportedMatches[0]!.score;
    const bestSupportedMatches = supportedMatches
      .filter((match) => match.score === bestSupportedScore)
      .map((match) => match.party);

    const equivalentSupportedMatches = shouldCollapseEquivalentPartyMatches(input.plan)
      ? collapseEquivalentPartyMatches(bestSupportedMatches)
      : bestSupportedMatches;

    if (equivalentSupportedMatches.length > 1) {
      return {
        status: "ambiguous",
        matches: equivalentSupportedMatches,
      };
    }

    return {
      status: "resolved",
      party: equivalentSupportedMatches[0]!,
    };
  }

  const bestScore = scoredMatches[0]!.score;
  const bestMatches = scoredMatches
    .filter((match) => match.score === bestScore)
    .map((match) => match.party);

  if (bestMatches.length > 1) {
    return {
      status: "ambiguous",
      matches: bestMatches,
    };
  }

  return {
    status: "resolved",
    party: bestMatches[0]!,
  };
}

function collapseEquivalentPartyMatches(matches: FirmDocumentPartyMatch[]) {
  if (matches.length <= 1) {
    return matches;
  }

  const firstKey = buildEquivalentPartyKey(matches[0]!);
  if (!firstKey) {
    return matches;
  }

  return matches.every((match) => buildEquivalentPartyKey(match) === firstKey)
    ? [matches[0]!]
    : matches;
}

function buildEquivalentPartyKey(party: FirmDocumentPartyMatch) {
  const nameSignature = extractNameSignature(
    normalizeQuestion(party.canonicalDisplayName ?? ""),
  );
  const addressSignature = normalizePartyAddressSignature(party.addressSignature);

  if (!nameSignature || !addressSignature) {
    return null;
  }

  return [party.kind, nameSignature, addressSignature].join("|");
}

function shouldCollapseEquivalentPartyMatches(plan: QueryAssistantRetrievalPlan) {
  if (!plan.intent) {
    return false;
  }

  return [
    "statement_existence",
    "statement_list",
    "latest_account_document",
    "latest_account_snapshot",
    "statement_account_value",
    "account_routing_number",
    "account_number",
    "account_contact",
  ].includes(plan.intent);
}

function partySupportsIntent(input: {
  ownerEmail: string;
  dbPath: string | null;
  question: string;
  party: FirmDocumentPartyMatch;
  plan: QueryAssistantRetrievalPlan;
}) {
  const base = {
    ownerEmail: input.ownerEmail,
    dbPath: input.dbPath,
    partyId: input.party.partyId,
  };

  switch (input.plan.intent) {
    case "statement_existence":
    case "statement_list":
    case "account_identifier_lookup":
    case "latest_account_snapshot":
    case "latest_account_document":
    case "latest_account_contact":
      return getMatchingStatementSnapshots(
        {
          ownerEmail: input.ownerEmail,
          dbPath: input.dbPath,
          question: input.question,
        },
        input.party,
        input.plan,
      ).length > 0;
    case "identity_document_existence":
    case "latest_identity_document":
      return Boolean(
        findLatestIdentityDocumentForParty({
          ...base,
          idKind: input.plan.identityKind,
        }),
      );
    case "latest_identity_dob":
      return Boolean(findLatestIdentityDobForParty(base));
    case "latest_identity_address":
      return Boolean(findLatestIdentityAddressForParty(base));
    case "latest_identity_expiration":
      return Boolean(
        findLatestIdentityExpirationForParty({
          ...base,
          idKind: input.plan.identityKind,
        }),
      );
    case "unexpired_driver_license_check":
      return (
        findLatestDriverLicenseStatusForParty(base).status !== "not_found"
      );
    default:
      return true;
  }
}

function selectPreferredAccountValue(
  values: FirmDocumentAccountValue[],
  preferredKind: string | null,
) {
  if (values.length === 0) {
    return null;
  }

  if (preferredKind) {
    const exact = values.find((value) => value.kind === preferredKind);
    if (exact) {
      return exact;
    }
  }

  for (const kind of VALUE_KIND_PRIORITY) {
    const match = values.find((value) => value.kind === kind);
    if (match) {
      return match;
    }
  }

  return values[0] ?? null;
}

function getMatchingStatementSnapshots(
  input: Pick<AskFirmDocumentAssistantInput, "ownerEmail" | "dbPath" | "question">,
  party: FirmDocumentPartyMatch,
  plan: QueryAssistantRetrievalPlan,
) {
  const snapshots = getStatementQueryParties(input, party).flatMap((queryParty) =>
    findLatestAccountSnapshotsForParty({
      ownerEmail: input.ownerEmail,
      dbPath: input.dbPath ?? null,
      partyId: queryParty.partyId,
      normalizedAccountType: plan.accountType,
      limit: 25,
    }),
  );
  const dedupedSnapshots = Array.from(
    new Map(
      snapshots.map((snapshot) => [snapshot.documentAccountSnapshotId, snapshot]),
    ).values(),
  );

  const familyFiltered = dedupedSnapshots.filter((snapshot) =>
    matchesStatementFamilyScope(snapshot, plan),
  );
  const institutionFiltered = filterSnapshotsByInstitutionHint(
    input,
    familyFiltered,
  );

  return sortSnapshotsByRecency(institutionFiltered);
}

function getStatementQueryParties(
  input: Pick<AskFirmDocumentAssistantInput, "ownerEmail" | "dbPath">,
  party: FirmDocumentPartyMatch,
) {
  const nameSignature = extractNameSignature(
    normalizeQuestion(party.canonicalDisplayName ?? ""),
  );
  const addressSignature = normalizePartyAddressSignature(party.addressSignature);

  if (!nameSignature || !addressSignature) {
    return [party];
  }

  const relatedParties = listFirmDocumentParties({
    ownerEmail: input.ownerEmail,
    dbPath: input.dbPath ?? null,
  }).filter((candidate) => {
    if (candidate.partyId === party.partyId) {
      return true;
    }

    if (candidate.kind !== party.kind) {
      return false;
    }

    if (normalizePartyAddressSignature(candidate.addressSignature) !== addressSignature) {
      return false;
    }

    return (
      extractNameSignature(normalizeQuestion(candidate.canonicalDisplayName ?? "")) ===
      nameSignature
    );
  });

  return relatedParties.length > 0 ? relatedParties : [party];
}

function normalizePartyAddressSignature(value: string | null | undefined) {
  return normalizeQuestion(value ?? "");
}

function matchesStatementFamilyScope(
  snapshot: FirmDocumentLatestAccountSnapshot,
  plan: QueryAssistantRetrievalPlan,
) {
  if (plan.accountType) {
    return true;
  }

  if (plan.familyScope === "bank_statement") {
    return BANK_STATEMENT_ACCOUNT_TYPES.has(snapshot.normalizedAccountType ?? "");
  }

  if (plan.familyScope === "credit_card_statement") {
    return CREDIT_CARD_STATEMENT_ACCOUNT_TYPES.has(
      snapshot.normalizedAccountType ?? "",
    );
  }

  return true;
}

function filterSnapshotsByInstitutionHint(
  input: Pick<AskFirmDocumentAssistantInput, "question">,
  snapshots: FirmDocumentLatestAccountSnapshot[],
) {
  if (snapshots.length < 2) {
    return snapshots;
  }

  const normalizedQuestion = normalizeQuestion(input.question ?? "");
  if (!normalizedQuestion) {
    return snapshots;
  }

  const matches = snapshots.filter((snapshot) =>
    questionMentionsInstitution(normalizedQuestion, snapshot.institutionName),
  );

  return matches.length > 0 ? matches : snapshots;
}

function questionMentionsInstitution(
  normalizedQuestion: string,
  institutionName: string | null,
) {
  if (!institutionName) {
    return false;
  }

  const normalizedInstitution = normalizeQuestion(institutionName);
  if (!normalizedInstitution) {
    return false;
  }

  if (normalizedQuestion.includes(normalizedInstitution)) {
    return true;
  }

  const signature = extractInstitutionSignature(normalizedInstitution);
  return Boolean(signature && normalizedQuestion.includes(signature));
}

function extractInstitutionSignature(normalizedInstitution: string) {
  const tokens = normalizedInstitution
    .split(/\s+/)
    .filter(
      (token) =>
        token &&
        !new Set([
          "national",
          "association",
          "investments",
          "retirement",
          "group",
          "inc",
          "llc",
          "company",
          "life",
        ]).has(token),
    );

  return tokens.slice(0, 2).join(" ").trim();
}

function sortSnapshotsByRecency(
  snapshots: FirmDocumentLatestAccountSnapshot[],
) {
  return [...snapshots].sort((left, right) => {
    const leftDate =
      left.statementEndDate ?? left.documentDate ?? left.analyzedAt ?? "";
    const rightDate =
      right.statementEndDate ?? right.documentDate ?? right.analyzedAt ?? "";

    if (rightDate !== leftDate) {
      return rightDate.localeCompare(leftDate);
    }

    const leftDocumentDate = left.documentDate ?? "";
    const rightDocumentDate = right.documentDate ?? "";
    if (rightDocumentDate !== leftDocumentDate) {
      return rightDocumentDate.localeCompare(leftDocumentDate);
    }

    const leftAnalyzedAt = left.analyzedAt ?? "";
    const rightAnalyzedAt = right.analyzedAt ?? "";
    if (rightAnalyzedAt !== leftAnalyzedAt) {
      return rightAnalyzedAt.localeCompare(leftAnalyzedAt);
    }

    return (right.documentId ?? "").localeCompare(left.documentId ?? "");
  });
}

function collectLatestContactsForSnapshots(
  input: Pick<AskFirmDocumentAssistantInput, "ownerEmail" | "dbPath">,
  snapshots: FirmDocumentLatestAccountSnapshot[],
  plan: QueryAssistantRetrievalPlan,
) {
  return snapshots
    .flatMap((snapshot) =>
      findLatestContactsForAccount({
        ownerEmail: input.ownerEmail,
        dbPath: input.dbPath ?? null,
        accountId: snapshot.accountId,
        purpose: plan.contactPurpose,
        method: plan.contactMethod,
        limit: 3,
      }).map((contact) => ({ snapshot, contact })),
    )
    .sort((left, right) => {
      const leftDate =
        left.contact.statementEndDate ??
        left.contact.documentDate ??
        left.snapshot.statementEndDate ??
        left.snapshot.documentDate ??
        "";
      const rightDate =
        right.contact.statementEndDate ??
        right.contact.documentDate ??
        right.snapshot.statementEndDate ??
        right.snapshot.documentDate ??
        "";

      return rightDate.localeCompare(leftDate);
    });
}

function describeStatementScope(
  plan: QueryAssistantRetrievalPlan,
  count: number,
) {
  const plural = count !== 1;

  if (plan.accountType) {
    return `${plan.accountType} statement${plural ? "s" : ""}`;
  }

  if (plan.familyScope === "bank_statement") {
    return `bank statement${plural ? "s" : ""}`;
  }

  if (plan.familyScope === "credit_card_statement") {
    return `credit card statement${plural ? "s" : ""}`;
  }

  return `statement${plural ? "s" : ""}`;
}

function describeSnapshotRecord(snapshot: FirmDocumentLatestAccountSnapshot) {
  return compact([
    snapshot.institutionName ?? "Unknown institution",
    snapshot.normalizedAccountType ?? "statement",
    snapshot.accountLast4 ? `x${snapshot.accountLast4}` : null,
  ]).join(" ");
}

function formatSnapshotDateSuffix(snapshot: {
  statementEndDate: string | null;
  documentDate: string | null;
}) {
  const date = snapshot.statementEndDate ?? snapshot.documentDate;
  return date ? ` dated ${date}` : "";
}

function buildStatementMatchDetails(
  snapshots: FirmDocumentLatestAccountSnapshot[],
  plan: QueryAssistantRetrievalPlan,
) {
  return compact([
    ...snapshots.slice(0, 5).map((snapshot) => formatSnapshotOption(snapshot)),
    ...buildFollowUpSuggestion(snapshots, plan),
  ]);
}

function buildStatementCoveragePhrase(
  snapshots: FirmDocumentLatestAccountSnapshot[],
  plan: QueryAssistantRetrievalPlan,
) {
  if (plan.accountType) {
    return "";
  }

  const types = collectDistinctStatementTypes(snapshots);
  if (types.length <= 1) {
    return "";
  }

  return ` across ${formatConjoinedNaturalList(types)}`;
}

function buildAdditionalStatementTypesSentence(
  snapshots: FirmDocumentLatestAccountSnapshot[],
  plan: QueryAssistantRetrievalPlan,
  latest: FirmDocumentLatestAccountSnapshot,
) {
  if (plan.accountType) {
    return "";
  }

  const latestType = latest.normalizedAccountType ?? null;
  const additionalTypes = collectDistinctStatementTypes(snapshots).filter(
    (type) => type !== latestType,
  );

  if (additionalTypes.length === 0) {
    return "";
  }

  return ` I also found ${formatConjoinedNaturalList(
    additionalTypes.map((type) => `${type} statements`),
  )}.`;
}

function collectDistinctStatementTypes(
  snapshots: FirmDocumentLatestAccountSnapshot[],
) {
  return Array.from(
    new Set(
      snapshots
        .map((snapshot) => snapshot.normalizedAccountType)
        .filter((value): value is string => Boolean(value)),
    ),
  );
}

function buildStatementSources(
  input: Pick<AskFirmDocumentAssistantInput, "ownerEmail" | "dbPath">,
  snapshots: FirmDocumentLatestAccountSnapshot[],
): QueryAssistantSource[] {
  return snapshots.slice(0, 3).map((snapshot) => {
    const identifier = findLatestAccountIdentifierForAccount({
      ownerEmail: input.ownerEmail,
      dbPath: input.dbPath ?? null,
      accountId: snapshot.accountId,
    });

    return {
      sourceFileId: snapshot.sourceFileId,
      sourceName: snapshot.sourceName,
      documentDate: snapshot.documentDate,
      statementEndDate: snapshot.statementEndDate,
      institutionName: snapshot.institutionName,
      accountType: snapshot.normalizedAccountType,
      registrationType: snapshot.registrationType,
      partyDisplayName: snapshot.partyDisplayName,
      accountLast4: identifier?.accountLast4 ?? snapshot.accountLast4,
      accountNumber: identifier?.accountNumber ?? null,
      maskedAccountNumber:
        identifier?.maskedAccountNumber ?? snapshot.maskedAccountNumber,
    };
  });
}

function buildFollowUpSuggestion(
  snapshots: FirmDocumentLatestAccountSnapshot[],
  plan: QueryAssistantRetrievalPlan,
) {
  void snapshots;
  void plan;
  return [];
}

function buildContactFollowUpSuggestion(
  matches: Array<{
    snapshot: FirmDocumentLatestAccountSnapshot;
    contact: FirmDocumentLatestContact;
  }>,
  plan: QueryAssistantRetrievalPlan,
) {
  void matches;
  void plan;
  return [];
}

function extractAccountType(question: string) {
  return ACCOUNT_TYPE_RULES.find((rule) => rule.pattern.test(question))?.canonical ?? null;
}

function extractIdentityKind(normalizedQuestion: string) {
  if (/\bstate id\b|\bstate identification\b/.test(normalizedQuestion)) {
    return "state_id";
  }

  if (/\bdriver license\b|\bdrivers license\b|\blicense\b/.test(normalizedQuestion)) {
    return "driver_license";
  }

  return null;
}

function extractAccountFieldRequest(
  question: string,
): "account_number" | "routing_number" | null {
  if (
    /\brouting number\b|\brouting details\b|\baba number\b|\baba routing\b/i.test(
      question,
    )
  ) {
    return "routing_number";
  }

  if (
    /\bfull account number\b|\baccount number\b|\bacct number\b|\bacct #\b/i.test(
      question,
    )
  ) {
    return "account_number";
  }

  return null;
}

function resolveFamilyScope(
  question: string,
  accountType: string | null,
  identityKind: "driver_license" | "state_id" | null,
): QueryAssistantFamilyScope {
  if (identityKind === "driver_license") {
    return "driver_license";
  }

  if (identityKind === "state_id") {
    return "state_id";
  }

  if (/\bbank statements?\b/i.test(question)) {
    return "bank_statement";
  }

  if (/\bcredit card statements?\b|\bcredit statements?\b/i.test(question)) {
    return "credit_card_statement";
  }

  if (accountType && BANK_STATEMENT_ACCOUNT_TYPES.has(accountType)) {
    return "bank_statement";
  }

  if (accountType && CREDIT_CARD_STATEMENT_ACCOUNT_TYPES.has(accountType)) {
    return "credit_card_statement";
  }

  if (/\bstatement\b|\bdocument\b/i.test(question) || accountType) {
    return "statement";
  }

  if (/\bid\b|\bidentity\b|\blicense\b/i.test(question)) {
    return "identity_document";
  }

  return null;
}

function normalizeQuestion(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function dropSingleLetterTokens(value: string) {
  return value
    .split(/\s+/)
    .filter((token) => token.length > 1)
    .join(" ")
    .trim();
}

function extractNameSignature(value: string) {
  const tokens = value.split(/\s+/).filter(Boolean);
  if (tokens.length < 2) {
    return value;
  }

  return `${tokens[0] ?? ""} ${tokens[tokens.length - 1] ?? ""}`.trim();
}

function formatMoney(amount: string | null, currency: string | null) {
  if (!amount) {
    return "amount unavailable";
  }

  const numeric = Number(amount);
  if (!Number.isFinite(numeric)) {
    return amount;
  }

  try {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: currency || "USD",
      maximumFractionDigits: 2,
    }).format(numeric);
  } catch {
    return amount;
  }
}

function formatValueKind(kind: string) {
  return kind
    .replace(/_/g, " ")
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

function formatPurpose(purpose: string) {
  return purpose
    .replace(/_/g, " ")
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

function unsupportedResult(
  question: string,
  title: string,
  answer: string,
  extraDetail?: string,
): QueryAssistantDraftResult {
  return {
    status: "unsupported",
    intent: null,
    question,
    title,
    answer,
    details: compact([extraDetail ?? null]),
    sources: [],
  };
}

function notFoundResult(
  question: string,
  intent: QueryAssistantIntent | null,
  title: string,
  answer: string,
): QueryAssistantDraftResult {
  return {
    status: "not_found",
    intent,
    question,
    title,
    answer,
    details: [],
    sources: [],
  };
}

function clientNeededOrNotFoundResult(
  question: string,
  intent: QueryAssistantIntent | null,
): QueryAssistantDraftResult {
  if (questionAppearsToOmitClient(question)) {
    return {
      status: "ambiguous",
      intent,
      question,
      title: "Client needed",
      answer: "Which client do you want me to check?",
      details: [],
      sources: [],
    };
  }

  return {
    status: "not_found",
    intent,
    question,
    title: "Client not found",
    answer:
      "I couldn't find that client in the uploaded document data. Try the client's stored display name.",
    details: [],
    sources: [],
  };
}

function questionAppearsToOmitClient(question: string) {
  if (/\b(?:for|about)\s+[A-Z][a-z]+(?:\s+[A-Z][a-z]+){1,3}\b/.test(question)) {
    return false;
  }

  const normalized = normalizeQuestion(question);
  for (const match of normalized.matchAll(/\b(?:for|about)\s+([a-z]+(?:\s+[a-z]+){1,3})\b/g)) {
    const nameLikeTokens = match[1]!
      .split(/\s+/)
      .filter((token) => !isClientlessQuestionStopToken(token));
    if (nameLikeTokens.length >= 2) {
      return false;
    }
  }

  if (questionContainsNameLikePhrase(normalized)) {
    return false;
  }

  return true;
}

function questionContainsNameLikePhrase(normalizedQuestion: string) {
  const tokens = normalizedQuestion.split(/\s+/).filter(Boolean);
  for (let index = 0; index < tokens.length - 1; index += 1) {
    const pair = [tokens[index]!, tokens[index + 1]!];
    if (
      pair.every(
        (token) =>
          token.length > 1 &&
          !isClientlessQuestionStopToken(token) &&
          !isAdditionalClientlessQuestionStopToken(token),
      )
    ) {
      return true;
    }
  }

  return false;
}

function isClientlessQuestionStopToken(token: string) {
  return new Set([
    "a",
    "an",
    "and",
    "any",
    "available",
    "bank",
    "card",
    "checking",
    "client",
    "credit",
    "current",
    "document",
    "documents",
    "driver",
    "expiration",
    "file",
    "have",
    "id",
    "ira",
    "latest",
    "license",
    "on",
    "phone",
    "savings",
    "same",
    "statement",
    "statements",
    "support",
    "that",
    "the",
    "we",
    "what",
  ]).has(token);
}

function isAdditionalClientlessQuestionStopToken(token: string) {
  return new Set([
    "about",
    "account",
    "balance",
    "customer",
    "does",
    "employer",
    "from",
    "has",
    "is",
    "market",
    "number",
    "plan",
    "retirement",
    "routing",
    "service",
    "sponsored",
    "there",
    "uploaded",
    "value",
    "was",
    "with",
  ]).has(token);
}

function presentResult(
  result: QueryAssistantDraftResult,
  plan?: QueryAssistantRetrievalPlan | null,
): QueryAssistantResult {
  const explicitPresentation = result.presentation ?? {};
  const derivedMode =
    explicitPresentation.mode ?? derivePresentationMode(result, plan ?? null);
  const split = splitPresentationDetails(result.details);
  const sourceLine =
    explicitPresentation.sourceLine ??
    buildPresentationSourceLine(result.sources[0] ?? null);

  return {
    ...result,
    details: split.details,
    presentation: {
      mode: derivedMode,
      shellTone:
        explicitPresentation.shellTone ?? defaultShellToneForMode(derivedMode),
      showTitle:
        explicitPresentation.showTitle ?? defaultShowTitleForMode(derivedMode),
      showDetails:
        explicitPresentation.showDetails ??
        defaultShowDetailsForMode(derivedMode, split.details.length),
      detailLabel:
        explicitPresentation.detailLabel ?? defaultDetailLabelForMode(derivedMode),
      showSourceLine:
        explicitPresentation.showSourceLine ??
        defaultShowSourceLineForMode(derivedMode, Boolean(sourceLine)),
      sourceLine,
      showSources:
        explicitPresentation.showSources ??
        defaultShowSourcesForMode(derivedMode, result.sources.length),
      followUp: explicitPresentation.followUp ?? split.followUp,
    },
  };
}

function defaultShellToneForMode(mode: QueryAssistantPresentationMode) {
  switch (mode) {
    case "ambiguity_prompt":
    case "not_found":
    case "unsupported":
      return "warning";
    default:
      return "assistant";
  }
}

function derivePresentationMode(
  result: QueryAssistantDraftResult,
  plan: QueryAssistantRetrievalPlan | null,
): QueryAssistantPresentationMode {
  if (result.status === "ambiguous") {
    return "ambiguity_prompt";
  }

  if (result.status === "not_found") {
    return "not_found";
  }

  if (result.status === "unsupported") {
    return "unsupported";
  }

  if (
    plan?.preferredResponseMode === "summary_with_matches" ||
    plan?.questionType === "count_list" ||
    plan?.questionType === "existence"
  ) {
    return "summary_answer";
  }

  return result.sources.length > 0
    ? "concise_answer_with_source"
    : "concise_answer";
}

function splitPresentationDetails(details: string[]) {
  const followUpDetails = details.filter((detail) => isFollowUpDetail(detail));
  const nonFollowUpDetails = details.filter((detail) => !isFollowUpDetail(detail));

  return {
    details: nonFollowUpDetails,
    followUp: followUpDetails[0] ?? null,
  };
}

function isFollowUpDetail(detail: string) {
  return /^(If you want|I also found)\b/.test(detail);
}

function defaultShowTitleForMode(mode: QueryAssistantPresentationMode) {
  return mode === "ambiguity_prompt";
}

function defaultShowDetailsForMode(
  mode: QueryAssistantPresentationMode,
  detailCount: number,
) {
  if (detailCount === 0) {
    return false;
  }

  return mode === "summary_answer" || mode === "ambiguity_prompt" || mode === "unsupported";
}

function defaultDetailLabelForMode(mode: QueryAssistantPresentationMode) {
  switch (mode) {
    case "summary_answer":
      return "Matches";
    case "ambiguity_prompt":
      return "Possible matches";
    case "unsupported":
      return "Try asking";
    default:
      return null;
  }
}

function defaultShowSourceLineForMode(
  mode: QueryAssistantPresentationMode,
  hasSourceLine: boolean,
) {
  if (!hasSourceLine) {
    return false;
  }

  return mode === "concise_answer_with_source" || mode === "summary_answer";
}

function defaultShowSourcesForMode(
  mode: QueryAssistantPresentationMode,
  sourceCount: number,
) {
  void mode;
  void sourceCount;
  return false;
}

function buildPresentationSourceLine(source: QueryAssistantSource | null) {
  if (!source) {
    return null;
  }

  const sourceBits = compact([
    source.sourceName ? `Source: ${source.sourceName}` : null,
    source.documentDate ? `Document date ${source.documentDate}` : null,
    source.statementEndDate ? `Statement end ${source.statementEndDate}` : null,
    source.expirationDate ? `Expiration ${source.expirationDate}` : null,
  ]);

  return sourceBits.length > 0 ? sourceBits.join(" • ") : null;
}

function compact(values: Array<string | null | undefined>) {
  return values.filter((value): value is string => Boolean(value));
}

function capitalizeLabel(value: string) {
  if (!value) {
    return value;
  }

  return value.charAt(0).toUpperCase() + value.slice(1);
}

function withIndefiniteArticle(value: string) {
  const article = /^[aeiou]/i.test(value) ? "an" : "a";
  return `${article} ${value}`;
}

function formatNaturalList(values: string[]) {
  if (values.length === 0) {
    return "";
  }

  if (values.length === 1) {
    return values[0]!;
  }

  if (values.length === 2) {
    return `${values[0]} or ${values[1]}`;
  }

  return `${values.slice(0, -1).join(", ")}, or ${values[values.length - 1]}`;
}

function formatConjoinedNaturalList(values: string[]) {
  if (values.length === 0) {
    return "";
  }

  if (values.length === 1) {
    return values[0]!;
  }

  if (values.length === 2) {
    return `${values[0]} and ${values[1]}`;
  }

  return `${values.slice(0, -1).join(", ")}, and ${values[values.length - 1]}`;
}

function formatPartyMatchDetail(match: FirmDocumentPartyMatch) {
  return compact([
    match.canonicalDisplayName ?? "Unknown",
    match.addressSignature ? `Address ${match.addressSignature}` : null,
    `Party ${match.partyId}`,
  ]).join(" | ");
}

function formatSnapshotOption(snapshot: {
  institutionName: string | null;
  normalizedAccountType: string | null;
  accountLast4: string | null;
  statementEndDate: string | null;
}) {
  return compact([
    snapshot.institutionName ?? "Unknown institution",
    snapshot.normalizedAccountType ?? null,
    snapshot.accountLast4 ? `x${snapshot.accountLast4}` : null,
    snapshot.statementEndDate
      ? `Statement end ${snapshot.statementEndDate}`
      : null,
  ]).join(" | ");
}

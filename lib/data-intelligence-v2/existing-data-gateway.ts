import {
  findAccountValuesForDocumentSnapshot,
  findLatestAccountSnapshotsForParty,
  findLatestDriverLicenseStatusForParty,
  findLatestIdentityAddressForParty,
  findLatestIdentityDobForParty,
  findLatestIdentityDocumentForParty,
  findTaxDocumentsForParty,
  listFirmDocumentParties,
  resolveFirmDocumentPartyByName,
  type FirmDocumentLatestAccountSnapshot,
  type FirmDocumentLatestIdentityFacts,
  type FirmDocumentPartyMatch,
  type FirmDocumentTaxDocument,
} from "@/lib/firm-document-query";
import { sanitizeTextForModel } from "@/lib/data-intelligence-v2/safe-memory";
import type {
  AccountSummary,
  AccountSummaryResult,
  ClientDataGateway,
  ClientResolutionCandidate,
  ClientResolutionResult,
  IdentityStatusResult,
  IdentityStatusSummary,
  StatementSummary,
  StatementSummaryResult,
  TaxDocumentSummary,
  TaxDocumentSummaryResult,
  WorkflowRequirementResult,
  WorkflowRequirementSummary,
} from "@/lib/data-intelligence-v2/data-gateway";
import type {
  V2IdentityStatusField,
  V2SourceRef,
  V2WorkflowType,
} from "@/lib/data-intelligence-v2/types";

const DEFAULT_LIMIT = 10;
const DEFAULT_IDENTITY_FIELDS: V2IdentityStatusField[] = [
  "ssn",
  "tax_id",
  "dob",
  "drivers_license",
  "passport",
  "government_id",
  "address",
  "phone",
  "email",
];

export class ExistingDataIntelligenceV2Gateway implements ClientDataGateway {
  async resolveClient(args: {
    ownerEmail: string;
    query: string;
    limit?: number;
  }): Promise<ClientResolutionResult> {
    const limit = clampLimit(args.limit);
    const query = args.query.trim();
    if (!query) {
      return {
        candidates: [],
        sourceRefs: [],
        missing: [
          {
            item: "client",
            checked: ["client name query"],
            reason: "No client search query was provided.",
          },
        ],
      };
    }

    const resolved = resolveFirmDocumentPartyByName({
      ownerEmail: args.ownerEmail,
      name: query,
    });
    const exactMatches = resolved.matches.map(mapPartyCandidate);

    const candidates =
      exactMatches.length > 0
        ? exactMatches
        : listFirmDocumentParties({ ownerEmail: args.ownerEmail })
            .filter((party) => partyMatchesQuery(party, query))
            .slice(0, limit)
            .map(mapPartyCandidate);

    const sourceRefs = dedupeSourceRefs(
      candidates.flatMap((candidate) => candidate.sourceRefs),
    );

    return {
      candidates: candidates.slice(0, limit),
      sourceRefs,
      missing:
        candidates.length === 0
          ? [
              {
                item: "client",
                checked: ["stable party/client records"],
                reason: "No matching client record was found.",
              },
            ]
          : [],
    };
  }

  async getAccounts(args: {
    ownerEmail: string;
    clientId: string;
    accountType?: string;
    custodian?: string;
    includeClosed?: boolean;
    limit?: number;
  }): Promise<AccountSummaryResult> {
    const snapshots = findLatestAccountSnapshotsForParty({
      ownerEmail: args.ownerEmail,
      partyId: args.clientId,
      normalizedAccountType: normalizeOptionalFilter(args.accountType),
      limit: clampLimit(args.limit),
    }).filter((snapshot) => matchesCustodian(snapshot, args.custodian));

    const accounts = snapshots.map((snapshot) =>
      this.mapAccountSummary(args.ownerEmail, snapshot),
    );

    return {
      accounts,
      sourceRefs: dedupeSourceRefs(
        accounts.flatMap((account) => account.sourceRefs),
      ),
      missing:
        accounts.length === 0
          ? [
              {
                item: "account",
                checked: ["latest account snapshot records"],
                reason: "No account records matched the requested filters.",
              },
            ]
          : [],
    };
  }

  async getLatestStatements(args: {
    ownerEmail: string;
    clientId: string;
    accountType?: string;
    custodian?: string;
    maxAgeDays?: number;
    limit?: number;
  }): Promise<StatementSummaryResult> {
    const snapshots = findLatestAccountSnapshotsForParty({
      ownerEmail: args.ownerEmail,
      partyId: args.clientId,
      normalizedAccountType: normalizeOptionalFilter(args.accountType),
      limit: clampLimit(args.limit),
    }).filter((snapshot) => matchesCustodian(snapshot, args.custodian));

    const statements = snapshots.map((snapshot) =>
      this.mapStatementSummary(args.ownerEmail, snapshot, args.maxAgeDays),
    );

    return {
      statements,
      sourceRefs: dedupeSourceRefs(
        statements.flatMap((statement) => statement.sourceRefs),
      ),
      missing:
        statements.length === 0
          ? [
              {
                item: "latest statement",
                checked: ["latest account snapshot records"],
                reason: "No statement records matched the requested filters.",
              },
            ]
          : [],
    };
  }

  async getTaxDocuments(args: {
    ownerEmail: string;
    clientId: string;
    taxYear?: number;
    formTypes?: string[];
    limit?: number;
  }): Promise<TaxDocumentSummaryResult> {
    const formTypes = (args.formTypes ?? []).map(normalizeFilter).filter(Boolean);
    const documents = findTaxDocumentsForParty({
      ownerEmail: args.ownerEmail,
      partyId: args.clientId,
      taxYear: args.taxYear ? String(args.taxYear) : null,
      limit: clampLimit(args.limit),
    }).filter((document) => {
      if (formTypes.length === 0) {
        return true;
      }

      const subtype = normalizeFilter(document.documentSubtype);
      const idType = normalizeFilter(document.idType);
      return formTypes.includes(subtype) || formTypes.includes(idType);
    });

    const taxDocuments = documents.map(mapTaxDocumentSummary);

    return {
      taxDocuments,
      sourceRefs: dedupeSourceRefs(
        taxDocuments.flatMap((document) => document.sourceRefs),
      ),
      missing:
        taxDocuments.length === 0
          ? [
              {
                item: "tax document",
                checked: ["tax document metadata"],
                reason: "No tax documents matched the requested filters.",
              },
            ]
          : [],
    };
  }

  async getIdentityStatus(args: {
    ownerEmail: string;
    clientId: string;
    fields?: V2IdentityStatusField[];
  }): Promise<IdentityStatusResult> {
    const fields = args.fields?.length ? args.fields : DEFAULT_IDENTITY_FIELDS;
    const statuses = fields.map((field) =>
      this.getSingleIdentityStatus(args.ownerEmail, args.clientId, field),
    );

    return {
      statuses,
      sourceRefs: dedupeSourceRefs(
        statuses.flatMap((status) => status.sourceRefs),
      ),
      missing: statuses
        .filter(
          (status) =>
            status.status === "not_found" || status.status === "unknown",
        )
        .map((status) => ({
          item: status.label,
          checked: ["identity/document status records"],
          reason:
            status.status === "unknown"
              ? "This status is not available through the current structured query layer."
              : "No matching identity fact was found.",
        })),
    };
  }

  async checkWorkflowRequirements(args: {
    ownerEmail: string;
    clientId: string;
    workflowType: V2WorkflowType;
  }): Promise<WorkflowRequirementResult> {
    const [accounts, statements, identity, taxDocuments] = await Promise.all([
      this.getAccounts({
        ownerEmail: args.ownerEmail,
        clientId: args.clientId,
        limit: 5,
      }),
      this.getLatestStatements({
        ownerEmail: args.ownerEmail,
        clientId: args.clientId,
        maxAgeDays: 120,
        limit: 5,
      }),
      this.getIdentityStatus({
        ownerEmail: args.ownerEmail,
        clientId: args.clientId,
        fields: workflowIdentityFields(args.workflowType),
      }),
      args.workflowType === "tax_prep"
        ? this.getTaxDocuments({
            ownerEmail: args.ownerEmail,
            clientId: args.clientId,
            limit: 5,
          })
        : Promise.resolve({
            taxDocuments: [],
            sourceRefs: [],
            missing: [],
          }),
    ]);

    const requirements = buildWorkflowRequirements(
      args.workflowType,
      accounts,
      statements,
      identity,
      taxDocuments,
    );

    return {
      workflowType: args.workflowType,
      requirements,
      sourceRefs: dedupeSourceRefs(
        requirements.flatMap((requirement) => requirement.sourceRefs),
      ),
      missing: requirements
        .filter((requirement) => requirement.status !== "available")
        .map((requirement) => ({
          item: requirement.label,
          checked: requirement.checked,
          reason: requirement.summary,
        })),
    };
  }

  private mapAccountSummary(
    ownerEmail: string,
    snapshot: FirmDocumentLatestAccountSnapshot,
  ): AccountSummary {
    const values = findAccountValuesForDocumentSnapshot({
      ownerEmail,
      documentAccountSnapshotId: snapshot.documentAccountSnapshotId,
    });
    const firstValue = values[0] ?? null;
    const sourceRefs = [
      sourceRefFromDocument(snapshot, "account_record", "Account record"),
    ];

    return {
      accountId: snapshot.accountId,
      label: buildAccountLabel(snapshot),
      custodian: safeNullableText(snapshot.institutionName),
      accountType: safeNullableText(
        snapshot.normalizedAccountType ?? snapshot.observedAccountTypeRaw,
      ),
      accountStatus: "unknown",
      maskedAccountNumber: safeNullableText(snapshot.maskedAccountNumber),
      accountLast4: safeNullableText(snapshot.accountLast4),
      balance: coerceAmount(firstValue?.amount ?? null),
      balanceLabel: safeNullableText(firstValue?.label ?? firstValue?.kind),
      latestStatementDate:
        snapshot.statementEndDate ?? snapshot.documentDate ?? null,
      sourceRefs,
    };
  }

  private mapStatementSummary(
    ownerEmail: string,
    snapshot: FirmDocumentLatestAccountSnapshot,
    maxAgeDays?: number,
  ): StatementSummary {
    const account = this.mapAccountSummary(ownerEmail, snapshot);
    const statementDate = snapshot.statementEndDate ?? snapshot.documentDate;

    return {
      statementId: snapshot.documentAccountSnapshotId,
      accountId: snapshot.accountId,
      label: safeText(snapshot.sourceName ?? "Latest statement"),
      statementDate,
      custodian: account.custodian,
      accountType: account.accountType,
      maskedAccountNumber: account.maskedAccountNumber,
      accountLast4: account.accountLast4,
      balance: account.balance,
      stalenessStatus: getStalenessStatus(statementDate, maxAgeDays),
      sourceRefs: [
        sourceRefFromDocument(snapshot, "uploaded_document", "Statement"),
      ],
    };
  }

  private getSingleIdentityStatus(
    ownerEmail: string,
    clientId: string,
    field: V2IdentityStatusField,
  ): IdentityStatusSummary {
    if (field === "dob") {
      const record = findLatestIdentityDobForParty({
        ownerEmail,
        partyId: clientId,
      });
      return identityStatus(
        field,
        "client.dobStatus",
        "Date of birth status",
        record ? "on_file" : "not_found",
        record ? [sourceRefFromDocument(record, "identity_record", "Identity document")] : [],
      );
    }

    if (field === "address") {
      const record = findLatestIdentityAddressForParty({
        ownerEmail,
        partyId: clientId,
      });
      return identityStatus(
        field,
        "client.addressStatus",
        "Address status",
        record ? "on_file" : "not_found",
        record ? [sourceRefFromDocument(record, "identity_record", "Identity document")] : [],
      );
    }

    if (field === "drivers_license") {
      const record = findLatestDriverLicenseStatusForParty({
        ownerEmail,
        partyId: clientId,
      });
      return {
        ...identityStatus(
          field,
          "identity.driverLicenseStatus",
          "Driver license status",
          record.status,
          record.documentId
            ? [sourceRefFromDocument(record, "identity_record", "Driver license")]
            : [],
        ),
        expirationDate: record.expirationDate,
      };
    }

    if (field === "passport") {
      return statusFromIdentityFacts(
        field,
        "identity.passportStatus",
        "Passport status",
        findLatestIdentityDocumentForParty({
          ownerEmail,
          partyId: clientId,
          idKind: "passport",
        }),
      );
    }

    if (field === "government_id") {
      return statusFromIdentityFacts(
        field,
        "identity.governmentIdStatus",
        "Government ID status",
        findLatestIdentityDocumentForParty({
          ownerEmail,
          partyId: clientId,
          idKind: "state_id",
        }) ??
          findLatestIdentityDocumentForParty({
            ownerEmail,
            partyId: clientId,
            idKind: "government_id",
          }),
      );
    }

    return identityStatus(
      field,
      identityFieldKey(field),
      identityFieldLabel(field),
      "unknown",
      [],
    );
  }
}

function mapPartyCandidate(
  party: FirmDocumentPartyMatch,
): ClientResolutionCandidate {
  const sourceRefs = [
    {
      sourceId: `system:party:${safeText(party.partyId)}`,
      sourceType: "system_record" as const,
      label: "Client identity record",
      confidence: "medium" as const,
    },
  ];

  return {
    clientId: party.partyId,
    displayName: safeText(party.canonicalDisplayName ?? "Unnamed client"),
    sourceRefs,
  };
}

function mapTaxDocumentSummary(
  document: FirmDocumentTaxDocument,
): TaxDocumentSummary {
  const sourceRefs = [
    sourceRefFromDocument(document, "tax_record", "Tax document"),
  ];

  return {
    documentId: document.documentId,
    label: safeText(document.sourceName ?? "Tax document"),
    taxYear: safeNullableText(document.taxYear),
    formType: safeNullableText(document.documentSubtype ?? document.idType),
    status: "available",
    sourceRefs,
  };
}

function statusFromIdentityFacts(
  field: V2IdentityStatusField,
  fieldKey: string,
  label: string,
  record: FirmDocumentLatestIdentityFacts | null,
): IdentityStatusSummary {
  if (!record) {
    return identityStatus(field, fieldKey, label, "not_found", []);
  }

  const status = record.expirationDate
    ? record.expirationDate >= currentIsoDate()
      ? "unexpired"
      : "expired"
    : "on_file";

  return {
    ...identityStatus(field, fieldKey, label, status, [
      sourceRefFromDocument(record, "identity_record", label),
    ]),
    expirationDate: record.expirationDate,
  };
}

function identityStatus(
  field: V2IdentityStatusField,
  fieldKey: string,
  label: string,
  status: IdentityStatusSummary["status"],
  sourceRefs: V2SourceRef[],
): IdentityStatusSummary {
  return {
    field,
    fieldKey,
    label,
    status,
    sourceRefs,
  };
}

function identityFieldKey(field: V2IdentityStatusField) {
  const fieldKeys: Record<V2IdentityStatusField, string> = {
    ssn: "client.ssnStatus",
    tax_id: "client.taxIdStatus",
    dob: "client.dobStatus",
    drivers_license: "identity.driverLicenseStatus",
    passport: "identity.passportStatus",
    government_id: "identity.governmentIdStatus",
    address: "client.addressStatus",
    phone: "client.phoneStatus",
    email: "client.emailStatus",
  };

  return fieldKeys[field];
}

function identityFieldLabel(field: V2IdentityStatusField) {
  const labels: Record<V2IdentityStatusField, string> = {
    ssn: "SSN status",
    tax_id: "Tax ID status",
    dob: "Date of birth status",
    drivers_license: "Driver license status",
    passport: "Passport status",
    government_id: "Government ID status",
    address: "Address status",
    phone: "Phone status",
    email: "Email status",
  };

  return labels[field];
}

function buildWorkflowRequirements(
  workflowType: V2WorkflowType,
  accounts: AccountSummaryResult,
  statements: StatementSummaryResult,
  identity: IdentityStatusResult,
  taxDocuments: TaxDocumentSummaryResult,
): WorkflowRequirementSummary[] {
  const requirements: WorkflowRequirementSummary[] = [];

  if (
    [
      "new_account",
      "transfer",
      "rollover",
      "beneficiary_update",
      "cash_management",
      "general_client_service",
    ].includes(workflowType)
  ) {
    requirements.push(
      requirementFromCount(
        "accounts_available",
        "Account records",
        accounts.accounts.length,
        ["latest account snapshot records"],
        accounts.sourceRefs,
      ),
    );
  }

  if (
    [
      "new_account",
      "transfer",
      "rollover",
      "document_verification",
      "general_client_service",
    ].includes(workflowType)
  ) {
    requirements.push(
      requirementFromCount(
        "latest_statement_available",
        "Latest statement",
        statements.statements.length,
        ["latest statement records"],
        statements.sourceRefs,
        statements.statements.some(
          (statement) => statement.stalenessStatus === "stale",
        )
          ? "stale"
          : undefined,
      ),
    );
  }

  if (
    ["new_account", "address_change", "document_verification"].includes(
      workflowType,
    )
  ) {
    const identityAvailable = identity.statuses.filter((status) =>
      ["on_file", "unexpired"].includes(status.status),
    );
    requirements.push(
      requirementFromCount(
        "identity_status_available",
        "Identity status",
        identityAvailable.length,
        ["identity/document status records"],
        identity.sourceRefs,
      ),
    );
  }

  if (workflowType === "tax_prep") {
    requirements.push(
      requirementFromCount(
        "tax_documents_available",
        "Tax documents",
        taxDocuments.taxDocuments.length,
        ["tax document metadata"],
        taxDocuments.sourceRefs,
      ),
    );
  }

  if (requirements.length === 0) {
    requirements.push({
      requirementId: "general_structured_records_checked",
      label: "Structured records",
      status: "unknown",
      checked: ["account, statement, identity, and tax document metadata"],
      summary:
        "No workflow-specific rule set exists yet, so only general structured availability was checked.",
      sourceRefs: dedupeSourceRefs([
        ...accounts.sourceRefs,
        ...statements.sourceRefs,
        ...identity.sourceRefs,
        ...taxDocuments.sourceRefs,
      ]),
    });
  }

  return requirements;
}

function requirementFromCount(
  requirementId: string,
  label: string,
  count: number,
  checked: string[],
  sourceRefs: V2SourceRef[],
  forcedStatus?: "stale",
): WorkflowRequirementSummary {
  const status =
    count === 0 ? "missing" : forcedStatus === "stale" ? "stale" : "available";

  return {
    requirementId,
    label,
    status,
    checked,
    summary:
      status === "available"
        ? `${label} available in structured records.`
        : status === "stale"
          ? `${label} found, but at least one record appears stale for the workflow window.`
          : `${label} not found in structured records.`,
    sourceRefs,
  };
}

function workflowIdentityFields(
  workflowType: V2WorkflowType,
): V2IdentityStatusField[] {
  if (workflowType === "address_change") {
    return ["address", "drivers_license"];
  }

  if (workflowType === "new_account" || workflowType === "document_verification") {
    return ["dob", "address", "drivers_license", "passport", "government_id"];
  }

  return ["drivers_license", "passport", "government_id"];
}

function sourceRefFromDocument(
  record: {
    documentId?: string | null;
    sourceName?: string | null;
    documentDate?: string | null;
  },
  sourceType: V2SourceRef["sourceType"],
  fallbackLabel: string,
): V2SourceRef {
  const documentId = safeNullableText(record.documentId);
  const date = safeNullableText(record.documentDate);

  return {
    sourceId: documentId ? `document:${documentId}` : `source:${fallbackLabel}`,
    sourceType,
    label: safeText(record.sourceName ?? fallbackLabel),
    ...(documentId ? { documentId } : {}),
    ...(date ? { date } : {}),
    confidence: documentId ? "high" : "medium",
  };
}

function dedupeSourceRefs(sourceRefs: V2SourceRef[]): V2SourceRef[] {
  const seen = new Set<string>();
  const deduped: V2SourceRef[] = [];

  for (const sourceRef of sourceRefs) {
    const key = `${sourceRef.sourceType}:${sourceRef.sourceId}`;
    if (!seen.has(key)) {
      seen.add(key);
      deduped.push(sourceRef);
    }
  }

  return deduped;
}

function buildAccountLabel(snapshot: FirmDocumentLatestAccountSnapshot) {
  return safeText(
    [
      snapshot.institutionName,
      snapshot.normalizedAccountType ?? snapshot.observedAccountTypeRaw,
      snapshot.accountLast4 ? `ending ${snapshot.accountLast4}` : null,
    ]
      .filter(Boolean)
      .join(" "),
  );
}

function matchesCustodian(
  snapshot: FirmDocumentLatestAccountSnapshot,
  custodian?: string,
) {
  if (!custodian?.trim()) {
    return true;
  }

  return normalizeFilter(snapshot.institutionName).includes(
    normalizeFilter(custodian),
  );
}

function partyMatchesQuery(party: FirmDocumentPartyMatch, query: string) {
  const displayName = normalizeFilter(party.canonicalDisplayName);
  const normalizedQuery = normalizeFilter(query);

  return (
    Boolean(displayName) &&
    (displayName.includes(normalizedQuery) ||
      normalizedQuery.includes(displayName))
  );
}

function normalizeOptionalFilter(value?: string) {
  return value?.trim() ? normalizeFilter(value) : null;
}

function normalizeFilter(value?: string | null) {
  return value?.trim().toLowerCase().replace(/\s+/g, "_") ?? "";
}

function safeText(value: string) {
  return sanitizeTextForModel(value).trim();
}

function safeNullableText(value?: string | null) {
  return value?.trim() ? safeText(value) : null;
}

function coerceAmount(value?: string | null): string | number | null {
  if (!value?.trim()) {
    return null;
  }

  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : safeText(value);
}

function getStalenessStatus(
  statementDate?: string | null,
  maxAgeDays?: number,
): StatementSummary["stalenessStatus"] {
  if (!statementDate || !maxAgeDays) {
    return "unknown";
  }

  const parsed = Date.parse(statementDate);
  if (!Number.isFinite(parsed)) {
    return "unknown";
  }

  const ageMs = Date.now() - parsed;
  return ageMs > maxAgeDays * 24 * 60 * 60 * 1000 ? "stale" : "current";
}

function currentIsoDate() {
  return new Date().toISOString().slice(0, 10);
}

function clampLimit(limit?: number) {
  if (!Number.isInteger(limit) || !limit || limit < 1) {
    return DEFAULT_LIMIT;
  }

  return Math.min(limit, 50);
}

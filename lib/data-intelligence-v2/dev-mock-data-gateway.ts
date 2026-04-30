import type {
  ClientDataGateway,
  WorkflowRequirementSummary,
} from "@/lib/data-intelligence-v2/data-gateway";
import {
  DEV_MOCK_ACCOUNT,
  DEV_MOCK_CLIENTS,
  DEV_MOCK_IDENTITY_STATUS_FIELDS,
  DEV_MOCK_SOURCE_REFS,
  DEV_MOCK_TAX_DOCUMENT,
  getDevMockClient,
} from "@/lib/data-intelligence-v2/dev-mock-fixtures";
import {
  assertNoUnsafeModelContent,
  sanitizeTextForModel,
} from "@/lib/data-intelligence-v2/safe-memory";
import type {
  V2IdentityStatusField,
  V2MissingDataItem,
  V2SourceRef,
  V2WorkflowType,
} from "@/lib/data-intelligence-v2/types";

export class DevMockDataIntelligenceV2Gateway implements ClientDataGateway {
  async resolveClient(args: {
    ownerEmail: string;
    query: string;
    limit?: number;
  }) {
    const query = args.query.trim().toLowerCase();
    const limit = Math.max(1, args.limit ?? 10);
    const matches =
      query === "demo"
        ? DEV_MOCK_CLIENTS
        : DEV_MOCK_CLIENTS.filter((client) =>
            client.displayName.toLowerCase().includes(query),
          );

    const result = {
      candidates: matches.slice(0, limit).map((client) => ({
        clientId: client.clientId,
        displayName: client.displayName,
        householdId: client.householdId,
        sourceRefs: [DEV_MOCK_SOURCE_REFS.client],
      })),
      sourceRefs: matches.length > 0 ? [DEV_MOCK_SOURCE_REFS.client] : [],
      missing:
        matches.length === 0
          ? [
              missingItem({
                item: "client",
                checked: ["mock client records"],
                reason: "No matching mock client was found.",
              }),
            ]
          : [],
    };

    assertNoUnsafeModelContent(result);
    return result;
  }

  async getAccounts(args: {
    ownerEmail: string;
    clientId: string;
    accountType?: string;
    custodian?: string;
    includeClosed?: boolean;
    limit?: number;
  }) {
    const client = getDevMockClient(args.clientId);
    const matchesClient = Boolean(client && args.clientId === DEV_MOCK_ACCOUNT.clientId);
    const matchesType = !args.accountType
      ? true
      : DEV_MOCK_ACCOUNT.accountType
          .toLowerCase()
          .includes(args.accountType.toLowerCase());
    const matchesCustodian = !args.custodian
      ? true
      : DEV_MOCK_ACCOUNT.custodian
          .toLowerCase()
          .includes(args.custodian.toLowerCase());
    const accounts =
      matchesClient && matchesType && matchesCustodian
        ? [
            {
              accountId: DEV_MOCK_ACCOUNT.accountId,
              label: DEV_MOCK_ACCOUNT.label,
              custodian: DEV_MOCK_ACCOUNT.custodian,
              accountType: DEV_MOCK_ACCOUNT.accountType,
              accountStatus: DEV_MOCK_ACCOUNT.accountStatus,
              maskedAccountNumber: DEV_MOCK_ACCOUNT.maskedAccountNumber,
              accountLast4: DEV_MOCK_ACCOUNT.accountLast4,
              balance: DEV_MOCK_ACCOUNT.balance,
              balanceLabel: DEV_MOCK_ACCOUNT.balanceLabel,
              latestStatementDate: DEV_MOCK_ACCOUNT.latestStatementDate,
              sourceRefs: [DEV_MOCK_SOURCE_REFS.account],
            },
          ]
        : [];

    const result = {
      accounts,
      sourceRefs: accounts.length > 0 ? [DEV_MOCK_SOURCE_REFS.account] : [],
      missing:
        accounts.length === 0
          ? [
              missingItem({
                item: "account",
                checked: ["mock account records"],
                reason: "No matching mock account was found.",
              }),
            ]
          : [],
    };

    assertNoUnsafeModelContent(result);
    return result;
  }

  async getLatestStatements(args: {
    ownerEmail: string;
    clientId: string;
    accountType?: string;
    custodian?: string;
    maxAgeDays?: number;
    limit?: number;
  }) {
    const client = getDevMockClient(args.clientId);
    const hasStatement = Boolean(client && args.clientId === DEV_MOCK_ACCOUNT.clientId);
    const result = {
      statements: hasStatement
        ? [
            {
              statementId: "mock_statement_1",
              accountId: DEV_MOCK_ACCOUNT.accountId,
              label: "Mock latest Schwab statement",
              statementDate: DEV_MOCK_ACCOUNT.latestStatementDate,
              custodian: DEV_MOCK_ACCOUNT.custodian,
              accountType: DEV_MOCK_ACCOUNT.accountType,
              maskedAccountNumber: DEV_MOCK_ACCOUNT.maskedAccountNumber,
              accountLast4: DEV_MOCK_ACCOUNT.accountLast4,
              balance: DEV_MOCK_ACCOUNT.balance,
              stalenessStatus: "current" as const,
              sourceRefs: [DEV_MOCK_SOURCE_REFS.statement],
            },
          ]
        : [],
      sourceRefs: hasStatement ? [DEV_MOCK_SOURCE_REFS.statement] : [],
      missing: hasStatement
        ? []
        : [
            missingItem({
              item: "latest statement",
              checked: ["mock latest statement records"],
              reason: "No matching mock statement was found.",
            }),
          ],
    };

    assertNoUnsafeModelContent(result);
    return result;
  }

  async getTaxDocuments(args: {
    ownerEmail: string;
    clientId: string;
    taxYear?: number;
    formTypes?: string[];
    limit?: number;
  }) {
    const client = getDevMockClient(args.clientId);
    const matchesYear =
      !args.taxYear || args.taxYear === DEV_MOCK_TAX_DOCUMENT.taxYear;
    const formTypes = (args.formTypes ?? []).map((formType) =>
      formType.toLowerCase(),
    );
    const matchesForm =
      formTypes.length === 0 ||
      formTypes.includes(DEV_MOCK_TAX_DOCUMENT.formType.toLowerCase());
    const hasDocument = Boolean(client && matchesYear && matchesForm);
    const result = {
      taxDocuments: hasDocument
        ? [
            {
              documentId: DEV_MOCK_TAX_DOCUMENT.documentId,
              label: DEV_MOCK_TAX_DOCUMENT.label,
              taxYear: DEV_MOCK_TAX_DOCUMENT.taxYear,
              formType: DEV_MOCK_TAX_DOCUMENT.formType,
              status: DEV_MOCK_TAX_DOCUMENT.status,
              sourceRefs: [DEV_MOCK_SOURCE_REFS.tax],
            },
          ]
        : [],
      sourceRefs: hasDocument ? [DEV_MOCK_SOURCE_REFS.tax] : [],
      missing: hasDocument
        ? []
        : [
            missingItem({
              item: "tax document",
              checked: ["mock tax document metadata"],
              reason: "No matching mock tax document was found.",
            }),
          ],
    };

    assertNoUnsafeModelContent(result);
    return result;
  }

  async getIdentityStatus(args: {
    ownerEmail: string;
    clientId: string;
    fields?: V2IdentityStatusField[];
  }) {
    const client = getDevMockClient(args.clientId);
    const fields = args.fields ?? (Object.keys(
      DEV_MOCK_IDENTITY_STATUS_FIELDS,
    ) as V2IdentityStatusField[]);
    const statuses = client
      ? fields.map((field) => ({
          field,
          fieldKey: DEV_MOCK_IDENTITY_STATUS_FIELDS[field].fieldKey,
          label: DEV_MOCK_IDENTITY_STATUS_FIELDS[field].label,
          status: DEV_MOCK_IDENTITY_STATUS_FIELDS[field].status,
          expirationDate: DEV_MOCK_IDENTITY_STATUS_FIELDS[field].expirationDate,
          sourceRefs: [DEV_MOCK_SOURCE_REFS.identity],
        }))
      : [];
    const result = {
      statuses,
      sourceRefs: statuses.length > 0 ? [DEV_MOCK_SOURCE_REFS.identity] : [],
      missing:
        statuses.length === 0
          ? [
              missingItem({
                item: "identity status",
                checked: ["mock identity status records"],
                reason: "No mock identity status records were found.",
              }),
            ]
          : [],
    };

    assertNoUnsafeModelContent(result);
    return result;
  }

  async checkWorkflowRequirements(args: {
    ownerEmail: string;
    clientId: string;
    workflowType: V2WorkflowType;
  }) {
    const client = getDevMockClient(args.clientId);
    const requirements = client
      ? requirementsForWorkflow(args.workflowType)
      : [];
    const result = {
      workflowType: args.workflowType,
      requirements,
      sourceRefs: dedupeSourceRefs(
        requirements.flatMap((requirement) => requirement.sourceRefs),
      ),
      missing: requirements
        .filter((requirement) => requirement.status === "missing")
        .map((requirement) =>
          missingItem({
            item: requirement.label,
            checked: requirement.checked,
            reason: requirement.summary,
            suggestedNextStep: "Request or upload the missing mock document.",
          }),
        ),
    };

    assertNoUnsafeModelContent(result);
    return result;
  }
}

function requirementsForWorkflow(
  workflowType: V2WorkflowType,
): WorkflowRequirementSummary[] {
  const common: WorkflowRequirementSummary[] = [
    {
      requirementId: "identity_status",
      label: "Identity status",
      status: "available",
      checked: ["mock identity status records"],
      summary: "Status-only identity facts are on file.",
      sourceRefs: [DEV_MOCK_SOURCE_REFS.identity],
    },
    {
      requirementId: "latest_statement",
      label: "Latest statement",
      status: "available",
      checked: ["mock latest statement records"],
      summary: "A current mock statement is available.",
      sourceRefs: [DEV_MOCK_SOURCE_REFS.statement],
    },
  ];

  if (workflowType === "tax_prep") {
    return [
      {
        requirementId: "tax_document",
        label: "Tax document",
        status: "available",
        checked: ["mock tax document metadata"],
        summary: "A mock tax document is available.",
        sourceRefs: [DEV_MOCK_SOURCE_REFS.tax],
      },
      {
        requirementId: "advisor_review",
        label: "Advisor review",
        status: "missing",
        checked: ["mock workflow checklist"],
        summary: "Advisor review has not been marked complete in mock data.",
        sourceRefs: [],
      },
    ];
  }

  if (workflowType === "transfer" || workflowType === "new_account") {
    return [
      ...common,
      {
        requirementId: "signed_forms",
        label: "Signed forms",
        status: "missing",
        checked: ["mock workflow checklist"],
        summary: "Signed paperwork is not marked complete in mock data.",
        sourceRefs: [],
      },
    ];
  }

  return common;
}

function missingItem(args: {
  item: string;
  checked: string[];
  reason: string;
  suggestedNextStep?: string;
}): V2MissingDataItem {
  return {
    item: sanitizeTextForModel(args.item),
    checked: args.checked.map(sanitizeTextForModel),
    reason: sanitizeTextForModel(args.reason),
    ...(args.suggestedNextStep
      ? { suggestedNextStep: sanitizeTextForModel(args.suggestedNextStep) }
      : {}),
  };
}

function dedupeSourceRefs(sourceRefs: V2SourceRef[]) {
  const seen = new Set<string>();
  return sourceRefs.filter((sourceRef) => {
    const key = `${sourceRef.sourceType}:${sourceRef.sourceId}`;
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}

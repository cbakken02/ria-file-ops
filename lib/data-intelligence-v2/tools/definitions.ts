import type {
  RevealPurpose,
  SensitiveRevealFieldKey,
  V2IdentityStatusField,
  V2ToolName,
  V2WorkflowType,
} from "@/lib/data-intelligence-v2/types";

export type ResolveClientToolArgs = {
  query: string;
  limit?: number;
};

export type GetAccountsToolArgs = {
  clientId: string;
  accountType?: string;
  custodian?: string;
  includeClosed?: boolean;
  limit?: number;
};

export type GetLatestStatementsToolArgs = {
  clientId: string;
  accountType?: string;
  custodian?: string;
  maxAgeDays?: number;
  limit?: number;
};

export type GetTaxDocumentsToolArgs = {
  clientId: string;
  taxYear?: number;
  formTypes?: string[];
  limit?: number;
};

export type GetIdentityStatusToolArgs = {
  clientId: string;
  fields?: V2IdentityStatusField[];
};

export type CheckWorkflowRequirementsToolArgs = {
  clientId: string;
  workflowType: V2WorkflowType;
};

export type CreateSensitiveRevealToolArgs = {
  clientId?: string;
  accountId?: string;
  documentId?: string;
  sourceId?: string;
  fieldKey: SensitiveRevealFieldKey;
  purpose: RevealPurpose;
  label?: string;
};

export type V2ToolArgs =
  | ResolveClientToolArgs
  | GetAccountsToolArgs
  | GetLatestStatementsToolArgs
  | GetTaxDocumentsToolArgs
  | GetIdentityStatusToolArgs
  | CheckWorkflowRequirementsToolArgs
  | CreateSensitiveRevealToolArgs;

export type V2ToolDefinition = {
  name: V2ToolName;
  description: string;
  parameters: {
    type: "object";
    required: string[];
    additionalProperties: false;
    properties: Record<string, unknown>;
  };
};

export const IDENTITY_STATUS_FIELDS: V2IdentityStatusField[] = [
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

export const WORKFLOW_TYPES: V2WorkflowType[] = [
  "new_account",
  "transfer",
  "rollover",
  "tax_prep",
  "beneficiary_update",
  "address_change",
  "cash_management",
  "document_verification",
  "general_client_service",
];

export const SENSITIVE_REVEAL_FIELD_KEYS: SensitiveRevealFieldKey[] = [
  "client.ssn",
  "client.taxId",
  "client.dob",
  "client.address",
  "client.phone",
  "client.email",
  "account.fullAccountNumber",
  "identity.driverLicenseNumber",
  "identity.passportNumber",
  "identity.governmentIdNumber",
];

export const REVEAL_PURPOSES: RevealPurpose[] = [
  "form_completion",
  "advisor_task",
  "client_service",
  "identity_verification",
  "user_followup",
  "other",
];

export const V2_TOOL_DEFINITIONS: V2ToolDefinition[] = [
  {
    name: "resolve_client",
    description:
      "Resolve a client/person from structured client records. Use this before other client-specific tools when the user names a client. Returns safe candidate names and internal client IDs only.",
    parameters: {
      type: "object",
      required: ["query"],
      additionalProperties: false,
      properties: {
        query: { type: "string", minLength: 1 },
        limit: { type: "integer", minimum: 1, maximum: 50 },
      },
    },
  },
  {
    name: "get_accounts",
    description:
      "Get safe account summaries for a resolved client after resolve_client succeeds. Use for account lists, account summaries, account types, custodians, balances, status, masked account numbers, and last4. Never returns full account numbers or external source file IDs.",
    parameters: {
      type: "object",
      required: ["clientId"],
      additionalProperties: false,
      properties: {
        clientId: { type: "string", minLength: 1 },
        accountType: { type: "string" },
        custodian: { type: "string" },
        includeClosed: { type: "boolean" },
        limit: { type: "integer", minimum: 1, maximum: 50 },
      },
    },
  },
  {
    name: "get_latest_statements",
    description:
      "Get latest statement metadata for a resolved client after resolve_client succeeds. Use for latest statement, statement date, stale/missing statement, custodian-specific statement, and statement-backed account facts.",
    parameters: {
      type: "object",
      required: ["clientId"],
      additionalProperties: false,
      properties: {
        clientId: { type: "string", minLength: 1 },
        accountType: { type: "string" },
        custodian: { type: "string" },
        maxAgeDays: { type: "integer", minimum: 1 },
        limit: { type: "integer", minimum: 1, maximum: 50 },
      },
    },
  },
  {
    name: "get_tax_documents",
    description:
      "Get safe tax document metadata for a resolved client after resolve_client succeeds. Use for tax forms, tax-year availability, missing tax documents, and tax document status. Does not return SSNs, tax IDs, or raw tax identifiers.",
    parameters: {
      type: "object",
      required: ["clientId"],
      additionalProperties: false,
      properties: {
        clientId: { type: "string", minLength: 1 },
        taxYear: { type: "integer", minimum: 1900 },
        formTypes: { type: "array", items: { type: "string" } },
        limit: { type: "integer", minimum: 1, maximum: 50 },
      },
    },
  },
  {
    name: "get_identity_status",
    description:
      "Get status-only identity facts for a resolved client after resolve_client succeeds. Use for SSN/DOB/address/contact/driver license/passport/government ID on-file or expiration status. Raw identity values are never returned.",
    parameters: {
      type: "object",
      required: ["clientId"],
      additionalProperties: false,
      properties: {
        clientId: { type: "string", minLength: 1 },
        fields: {
          type: "array",
          items: { type: "string", enum: IDENTITY_STATUS_FIELDS },
        },
      },
    },
  },
  {
    name: "check_workflow_requirements",
    description:
      "Check conservative structured-data requirements for common RIA file operations workflows after resolve_client succeeds. Use for new account, transfer, rollover, tax prep, beneficiary, address-change, cash-management, document-verification, and general client-service tasks.",
    parameters: {
      type: "object",
      required: ["clientId", "workflowType"],
      additionalProperties: false,
      properties: {
        clientId: { type: "string", minLength: 1 },
        workflowType: { type: "string", enum: WORKFLOW_TYPES },
      },
    },
  },
  {
    name: "create_sensitive_reveal",
    description:
      "Create a secure reveal card for an authorized user to view a sensitive value outside the model after resolve_client and any needed account/document context. Use when the user asks for SSN, tax ID, DOB, address, phone, email, full account number, driver license, passport, or government ID. The tool never returns the raw value.",
    parameters: {
      type: "object",
      required: ["fieldKey", "purpose"],
      additionalProperties: false,
      properties: {
        clientId: { type: "string", minLength: 1 },
        accountId: { type: "string", minLength: 1 },
        documentId: { type: "string", minLength: 1 },
        sourceId: { type: "string", minLength: 1 },
        fieldKey: { type: "string", enum: SENSITIVE_REVEAL_FIELD_KEYS },
        purpose: { type: "string", enum: REVEAL_PURPOSES },
        label: { type: "string" },
      },
    },
  },
];

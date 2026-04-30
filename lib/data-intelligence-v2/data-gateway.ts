import type {
  DataIntelligenceV2AuthContext,
  V2IdentityStatusField,
  V2MissingDataItem,
  V2SourceRef,
  V2WorkflowType,
} from "@/lib/data-intelligence-v2/types";
import type { RevealTokenService } from "@/lib/data-intelligence-v2/reveal-token-service";

export type ClientResolutionCandidate = {
  clientId: string;
  displayName: string;
  householdId?: string;
  sourceRefs: V2SourceRef[];
};

export type ClientResolutionResult = {
  candidates: ClientResolutionCandidate[];
  sourceRefs: V2SourceRef[];
  missing: V2MissingDataItem[];
};

export type AccountSummary = {
  accountId: string;
  label: string;
  custodian?: string | null;
  accountType?: string | null;
  accountStatus?: "open" | "closed" | "unknown";
  maskedAccountNumber?: string | null;
  accountLast4?: string | null;
  balance?: string | number | null;
  balanceLabel?: string | null;
  latestStatementDate?: string | null;
  sourceRefs: V2SourceRef[];
};

export type AccountSummaryResult = {
  accounts: AccountSummary[];
  sourceRefs: V2SourceRef[];
  missing: V2MissingDataItem[];
};

export type StatementSummary = {
  statementId: string;
  accountId?: string;
  label: string;
  statementDate?: string | null;
  custodian?: string | null;
  accountType?: string | null;
  maskedAccountNumber?: string | null;
  accountLast4?: string | null;
  balance?: string | number | null;
  stalenessStatus?: "current" | "stale" | "unknown";
  sourceRefs: V2SourceRef[];
};

export type StatementSummaryResult = {
  statements: StatementSummary[];
  sourceRefs: V2SourceRef[];
  missing: V2MissingDataItem[];
};

export type TaxDocumentSummary = {
  documentId: string;
  label: string;
  taxYear?: number | string | null;
  formType?: string | null;
  status?: "available" | "not_found" | "unknown";
  sourceRefs: V2SourceRef[];
};

export type TaxDocumentSummaryResult = {
  taxDocuments: TaxDocumentSummary[];
  sourceRefs: V2SourceRef[];
  missing: V2MissingDataItem[];
};

export type IdentityStatusValue =
  | "on_file"
  | "not_found"
  | "expired"
  | "unexpired"
  | "missing_expiration"
  | "unknown";

export type IdentityStatusSummary = {
  field: V2IdentityStatusField;
  fieldKey: string;
  label: string;
  status: IdentityStatusValue;
  expirationDate?: string | null;
  sourceRefs: V2SourceRef[];
};

export type IdentityStatusResult = {
  statuses: IdentityStatusSummary[];
  sourceRefs: V2SourceRef[];
  missing: V2MissingDataItem[];
};

export type WorkflowRequirementSummary = {
  requirementId: string;
  label: string;
  status: "available" | "missing" | "stale" | "unknown";
  checked: string[];
  summary: string;
  sourceRefs: V2SourceRef[];
};

export type WorkflowRequirementResult = {
  workflowType: V2WorkflowType;
  requirements: WorkflowRequirementSummary[];
  sourceRefs: V2SourceRef[];
  missing: V2MissingDataItem[];
};

export interface ClientDataGateway {
  resolveClient(args: {
    ownerEmail: string;
    query: string;
    limit?: number;
  }): Promise<ClientResolutionResult>;

  getAccounts(args: {
    ownerEmail: string;
    clientId: string;
    accountType?: string;
    custodian?: string;
    includeClosed?: boolean;
    limit?: number;
  }): Promise<AccountSummaryResult>;

  getLatestStatements(args: {
    ownerEmail: string;
    clientId: string;
    accountType?: string;
    custodian?: string;
    maxAgeDays?: number;
    limit?: number;
  }): Promise<StatementSummaryResult>;

  getTaxDocuments(args: {
    ownerEmail: string;
    clientId: string;
    taxYear?: number;
    formTypes?: string[];
    limit?: number;
  }): Promise<TaxDocumentSummaryResult>;

  getIdentityStatus(args: {
    ownerEmail: string;
    clientId: string;
    fields?: V2IdentityStatusField[];
  }): Promise<IdentityStatusResult>;

  checkWorkflowRequirements(args: {
    ownerEmail: string;
    clientId: string;
    workflowType: V2WorkflowType;
  }): Promise<WorkflowRequirementResult>;
}

export type V2ToolExecutionContext = {
  authContext: DataIntelligenceV2AuthContext;
  dataGateway?: ClientDataGateway;
  revealTokenService?: RevealTokenService;
};

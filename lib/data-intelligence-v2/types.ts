export type ModelExposureClassification =
  | "safe_to_model"
  | "client_confidential_to_model"
  | "masked_only_to_model"
  | "reveal_card_only_never_to_model"
  | "never_expose";

export type DefaultMaskingStrategy =
  | "none"
  | "last4"
  | "masked"
  | "hidden"
  | "date_status_only"
  | "city_state_only";

export type FieldCategory =
  | "client"
  | "household"
  | "account"
  | "statement"
  | "tax_document"
  | "identity_document"
  | "contact"
  | "uploaded_document"
  | "source"
  | "system"
  | "unknown";

export type SensitiveField =
  | "ssn"
  | "tax_id"
  | "full_account_number"
  | "driver_license_number"
  | "passport_number"
  | "government_id_number"
  | "dob"
  | "address"
  | "phone"
  | "email";

export type DataFieldDefinition = {
  fieldKey: string;
  label: string;
  category: FieldCategory;
  aliases: string[];
  classification: ModelExposureClassification;
  defaultMasking: DefaultMaskingStrategy;
  canSendToModel: boolean;
  canRevealToAuthorizedUser: boolean;
  requiresRevealPurpose: boolean;
  sensitiveField?: SensitiveField;
  notes?: string;
};

export type DataIntelligenceV2AuthContext = {
  userEmail: string;
  ownerEmail: string;
  userId?: string;
  firmId?: string;
  role?: "admin" | "advisor" | "csa" | "ops" | "readonly";
  allowedOwnerEmails?: string[];
  allowedClientIds?: string[];
  allowSensitiveReveal?: boolean;
};

export type RevealPurpose =
  | "form_completion"
  | "advisor_task"
  | "client_service"
  | "identity_verification"
  | "user_followup"
  | "other";

export type PolicyDecision = {
  allowed: boolean;
  reason: string;
};

export type VisibleConversationMessage = {
  role: "user" | "assistant" | "system";
  content?: string;
  text?: string;
  createdAt?: string;
  structuredResponse?: unknown;
};

export type LLMSafeConversationMessage = {
  role: "user" | "assistant" | "system";
  content: string;
};

export type SecureRevealReference = {
  revealCardId: string;
  clientId?: string;
  field: SensitiveField;
  label: string;
  actualValueWasNotShownToModel: true;
};

export type SafeConversationState = {
  activeClientId?: string;
  activeHouseholdId?: string;
  activeWorkflow?: string;
  lastResolvedClients?: Array<{
    clientId: string;
    displayName: string;
    householdId?: string;
  }>;
  lastMentionedAccounts?: Array<{
    accountId: string;
    label: string;
    custodian?: string;
    accountType?: string;
    last4?: string;
  }>;
  lastMentionedDocuments?: Array<{
    documentId: string;
    label: string;
    documentType?: string;
    date?: string;
  }>;
  lastSensitiveReveals?: SecureRevealReference[];
  missingItems?: Array<{
    item: string;
    reason: string;
    suggestedNextStep?: string;
  }>;
};

export type V2ToolName =
  | "resolve_client"
  | "get_accounts"
  | "get_latest_statements"
  | "get_tax_documents"
  | "get_identity_status"
  | "check_workflow_requirements"
  | "create_sensitive_reveal";

export type V2ToolStatus =
  | "success"
  | "not_found"
  | "ambiguous"
  | "denied"
  | "error";

export type V2SourceRef = {
  sourceId: string;
  sourceType:
    | "uploaded_document"
    | "extracted_fact"
    | "account_record"
    | "identity_record"
    | "tax_record"
    | "system_record";
  label: string;
  documentId?: string;
  page?: number;
  date?: string;
  confidence: "high" | "medium" | "low";
};

export type V2SafeFact = {
  factId: string;
  fieldKey: string;
  label: string;
  value: string | number | boolean | null;
  displayValue: string;
  sourceRefs: V2SourceRef[];
  confidence: "high" | "medium" | "low";
};

export type V2MissingDataItem = {
  item: string;
  checked: string[];
  reason: string;
  suggestedNextStep?: string;
};

export type V2ToolResult = {
  toolName: V2ToolName;
  status: V2ToolStatus;
  summary: string;
  facts: V2SafeFact[];
  missing: V2MissingDataItem[];
  sourceRefs: V2SourceRef[];
  secureRevealCards: ModelSafeRevealCard[];
  allowedClaims: string[];
  disallowedClaims: string[];
};

export type V2WorkflowType =
  | "new_account"
  | "transfer"
  | "rollover"
  | "tax_prep"
  | "beneficiary_update"
  | "address_change"
  | "cash_management"
  | "document_verification"
  | "general_client_service";

export type V2IdentityStatusField =
  | "ssn"
  | "tax_id"
  | "dob"
  | "drivers_license"
  | "passport"
  | "government_id"
  | "address"
  | "phone"
  | "email";

export type SensitiveRevealFieldKey =
  | "client.ssn"
  | "client.taxId"
  | "client.dob"
  | "client.address"
  | "client.phone"
  | "client.email"
  | "account.fullAccountNumber"
  | "identity.driverLicenseNumber"
  | "identity.passportNumber"
  | "identity.governmentIdNumber";

export type SensitiveValueStatus =
  | "on_file"
  | "not_found"
  | "unknown"
  | "not_supported";

export type SensitiveValueTarget = {
  ownerEmail: string;
  clientId?: string;
  accountId?: string;
  documentId?: string;
  sourceId?: string;
  fieldKey: SensitiveRevealFieldKey;
};

export type ModelSafeRevealCard = {
  revealCardId: string;
  fieldKey: SensitiveRevealFieldKey;
  fieldLabel: string;
  clientId?: string;
  accountId?: string;
  documentId?: string;
  label: string;
  maskedValue?: string;
  status: SensitiveValueStatus;
  expiresAt: string;
  actualValueWasNotShownToModel: true;
};

export type RevealCardRecord = {
  revealCardId: string;
  ownerEmail: string;
  userEmail: string;
  userId?: string;
  firmId?: string;
  role?: DataIntelligenceV2AuthContext["role"];
  clientId?: string;
  accountId?: string;
  documentId?: string;
  sourceId?: string;
  fieldKey: SensitiveRevealFieldKey;
  fieldLabel: string;
  label: string;
  purpose: RevealPurpose;
  createdAt: string;
  expiresAt: string;
  oneTimeUse: boolean;
  consumedAt?: string;
  revokedAt?: string;
  actualValueWasNotShownToModel: true;
};

export type CreateRevealCardArgs = {
  authContext: DataIntelligenceV2AuthContext;
  requestedOwnerEmail: string;
  clientId?: string;
  accountId?: string;
  documentId?: string;
  sourceId?: string;
  fieldKey: SensitiveRevealFieldKey;
  purpose: RevealPurpose;
  label?: string;
  expiresInMs?: number;
  oneTimeUse?: boolean;
};

export type RevealSensitiveValueArgs = {
  authContext: DataIntelligenceV2AuthContext;
  revealCardId: string;
};

export type RevealedSensitiveValue = {
  revealCardId: string;
  fieldKey: SensitiveRevealFieldKey;
  label: string;
  value: string;
  expiresAt: string;
};

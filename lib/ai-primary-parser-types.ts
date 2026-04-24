export type ParsedDocumentTypeId =
  | "default"
  | "account_statement"
  | "money_movement_form"
  | "tax_return"
  | "tax_document"
  | "identity_document"
  | "planning_document"
  | "legal_document";

export type ParsedFieldKey =
  | "documentTypeId"
  | "documentSubtype"
  | "detectedClient"
  | "detectedClient2"
  | "ownershipType"
  | "accountLast4"
  | "accountType"
  | "custodian"
  | "documentDate"
  | "entityName"
  | "idType"
  | "taxYear";

export type ParsedFieldOwnership = {
  owner: "ai" | "logic" | "metadata_fallback" | "review";
  source: string;
  confidence?: number | null;
  raw?: string | null;
};

export type ParsedExtractedPartyRole = "owner" | "joint_owner" | "other";

export type ParsedExtractedParty = {
  id: string | null;
  name: string | null;
  roles: ParsedExtractedPartyRole[];
  address: string | null;
};

export type ParsedExtractedInstitution = {
  id: string | null;
  name: string | null;
};

export type ParsedExtractedContactMethod =
  | "phone"
  | "website"
  | "email"
  | "other";

export type ParsedExtractedContactPurpose =
  | "customer_service"
  | "general_support"
  | "rollover_support"
  | "beneficiary_services"
  | "other";

export type ParsedExtractedContact = {
  id: string | null;
  institutionId: string | null;
  method: ParsedExtractedContactMethod | null;
  purpose: ParsedExtractedContactPurpose | null;
  value: string | null;
};

export type ParsedExtractedValue = {
  kind: string | null;
  label: string | null;
  money: {
    amount: string | null;
    currency: string | null;
  } | null;
  dateId: string | null;
};

export type ParsedExtractedAccount = {
  id: string | null;
  institutionIds: string[];
  accountNumber: string | null;
  maskedAccountNumber: string | null;
  accountLast4: string | null;
  accountType: string | null;
  registrationType: string | null;
  values: ParsedExtractedValue[];
};

export type ParsedExtractedAccountParty = {
  id: string | null;
  accountId: string | null;
  partyId: string | null;
  roles: ParsedExtractedPartyRole[];
};

export type ParsedExtractedDateKind =
  | "document_date"
  | "statement_period_start"
  | "statement_period_end"
  | "as_of_date"
  | "other";

export type ParsedExtractedDateScope =
  | "document"
  | "account"
  | "party"
  | "institution"
  | "accountParty";

export type ParsedExtractedDate = {
  id: string | null;
  kind: ParsedExtractedDateKind | null;
  value: string | null;
  scope: ParsedExtractedDateScope | null;
  entityId: string | null;
};

export type ParsedExtractedDocumentFacts = {
  entityName: string | null;
  idType: string | null;
  taxYear: string | null;
};

export type ParsedDocumentResult = {
  values: {
    documentTypeId?: ParsedDocumentTypeId | null;
    documentSubtype?: string | null;
    documentLabel?: string | null;
    detectedClient?: string | null;
    detectedClient2?: string | null;
    ownershipType?: "single" | "joint" | null;
    metadata?: {
      accountLast4?: string | null;
      accountType?: string | null;
      custodian?: string | null;
      documentDate?: string | null;
      entityName?: string | null;
      idType?: string | null;
      taxYear?: string | null;
    };
  };
  extracted?: {
    parties: ParsedExtractedParty[];
    institutions: ParsedExtractedInstitution[];
    contacts: ParsedExtractedContact[];
    accounts: ParsedExtractedAccount[];
    accountParties: ParsedExtractedAccountParty[];
    dates: ParsedExtractedDate[];
    documentFacts: ParsedExtractedDocumentFacts;
  };
  ownership: Partial<Record<ParsedFieldKey, ParsedFieldOwnership>>;
  debug?: {
    aiModel?: string | null;
    aiPromptVersion?: string | null;
    aiRawSummary?: string | null;
    aiEnabled?: boolean;
    aiAttempted?: boolean;
    aiUsed?: boolean;
    aiFailureReason?: string | null;
  };
};

export type AnalysisProfile = "legacy" | "preview_ai_primary";

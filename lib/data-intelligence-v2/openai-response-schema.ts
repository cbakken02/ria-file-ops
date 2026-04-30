const confidenceSchema = {
  type: "string",
  enum: ["high", "medium", "low"],
};

const sourceRefSchema = {
  type: "object",
  additionalProperties: false,
  required: [
    "sourceId",
    "sourceType",
    "label",
    "documentId",
    "page",
    "date",
    "confidence",
  ],
  properties: {
    sourceId: { type: "string" },
    sourceType: {
      type: "string",
      enum: [
        "uploaded_document",
        "extracted_fact",
        "account_record",
        "identity_record",
        "tax_record",
        "system_record",
      ],
    },
    label: { type: "string" },
    documentId: { type: ["string", "null"] },
    page: { type: ["number", "null"] },
    date: { type: ["string", "null"] },
    confidence: confidenceSchema,
  },
};

const missingDataItemSchema = {
  type: "object",
  additionalProperties: false,
  required: ["item", "checked", "reason", "suggestedNextStep"],
  properties: {
    item: { type: "string" },
    checked: { type: "array", items: { type: "string" } },
    reason: { type: "string" },
    suggestedNextStep: { type: ["string", "null"] },
  },
};

const secureRevealCardSchema = {
  type: "object",
  additionalProperties: false,
  required: [
    "revealCardId",
    "fieldKey",
    "fieldLabel",
    "clientId",
    "accountId",
    "documentId",
    "label",
    "maskedValue",
    "status",
    "expiresAt",
    "actualValueWasNotShownToModel",
  ],
  properties: {
    revealCardId: { type: "string" },
    fieldKey: {
      type: "string",
      enum: [
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
      ],
    },
    fieldLabel: { type: "string" },
    clientId: { type: ["string", "null"] },
    accountId: { type: ["string", "null"] },
    documentId: { type: ["string", "null"] },
    label: { type: "string" },
    maskedValue: { type: ["string", "null"] },
    status: {
      type: "string",
      enum: ["on_file", "not_found", "unknown", "not_supported"],
    },
    expiresAt: { type: "string" },
    actualValueWasNotShownToModel: { type: "boolean" },
  },
};

const draftNoteSchema = {
  type: ["object", "null"],
  additionalProperties: false,
  required: ["audience", "bodyMarkdown", "containsSensitivePlaceholders"],
  properties: {
    audience: { type: "string", enum: ["advisor", "client", "internal"] },
    bodyMarkdown: { type: "string" },
    containsSensitivePlaceholders: { type: "boolean" },
  },
};

const resolvedClientStateSchema = {
  type: "object",
  additionalProperties: false,
  required: ["clientId", "displayName", "householdId"],
  properties: {
    clientId: { type: "string" },
    displayName: { type: "string" },
    householdId: { type: ["string", "null"] },
  },
};

const mentionedAccountStateSchema = {
  type: "object",
  additionalProperties: false,
  required: ["accountId", "label", "custodian", "accountType", "last4"],
  properties: {
    accountId: { type: "string" },
    label: { type: "string" },
    custodian: { type: ["string", "null"] },
    accountType: { type: ["string", "null"] },
    last4: { type: ["string", "null"] },
  },
};

const mentionedDocumentStateSchema = {
  type: "object",
  additionalProperties: false,
  required: ["documentId", "label", "documentType", "date"],
  properties: {
    documentId: { type: "string" },
    label: { type: "string" },
    documentType: { type: ["string", "null"] },
    date: { type: ["string", "null"] },
  },
};

const revealReferenceStateSchema = {
  type: "object",
  additionalProperties: false,
  required: [
    "revealCardId",
    "clientId",
    "field",
    "label",
    "actualValueWasNotShownToModel",
  ],
  properties: {
    revealCardId: { type: "string" },
    clientId: { type: ["string", "null"] },
    field: {
      type: "string",
      enum: [
        "ssn",
        "tax_id",
        "full_account_number",
        "driver_license_number",
        "passport_number",
        "government_id_number",
        "dob",
        "address",
        "phone",
        "email",
      ],
    },
    label: { type: "string" },
    actualValueWasNotShownToModel: { type: "boolean" },
  },
};

const safeStateMissingItemSchema = {
  type: "object",
  additionalProperties: false,
  required: ["item", "reason", "suggestedNextStep"],
  properties: {
    item: { type: "string" },
    reason: { type: "string" },
    suggestedNextStep: { type: ["string", "null"] },
  },
};

const statePatchSchema = {
  type: ["object", "null"],
  additionalProperties: false,
  required: [
    "activeClientId",
    "activeHouseholdId",
    "activeWorkflow",
    "lastResolvedClients",
    "lastMentionedAccounts",
    "lastMentionedDocuments",
    "lastSensitiveReveals",
    "missingItems",
  ],
  properties: {
    activeClientId: { type: ["string", "null"] },
    activeHouseholdId: { type: ["string", "null"] },
    activeWorkflow: { type: ["string", "null"] },
    lastResolvedClients: {
      type: ["array", "null"],
      items: resolvedClientStateSchema,
    },
    lastMentionedAccounts: {
      type: ["array", "null"],
      items: mentionedAccountStateSchema,
    },
    lastMentionedDocuments: {
      type: ["array", "null"],
      items: mentionedDocumentStateSchema,
    },
    lastSensitiveReveals: {
      type: ["array", "null"],
      items: revealReferenceStateSchema,
    },
    missingItems: {
      type: ["array", "null"],
      items: safeStateMissingItemSchema,
    },
  },
};

export const OPENAI_V2_ASSISTANT_RESPONSE_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: [
    "responseType",
    "answerMarkdown",
    "sourceBackedFacts",
    "missingOrUnverified",
    "recommendedSteps",
    "secureRevealCards",
    "draftNote",
    "followupSuggestions",
    "statePatch",
  ],
  properties: {
    responseType: {
      type: "string",
      enum: [
        "task_assist",
        "client_data_answer",
        "missing_data",
        "clarification_needed",
        "general_guidance",
        "error",
      ],
    },
    answerMarkdown: { type: "string" },
    sourceBackedFacts: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["fact", "sourceRefs", "confidence"],
        properties: {
          fact: { type: "string" },
          sourceRefs: { type: "array", items: sourceRefSchema },
          confidence: confidenceSchema,
        },
      },
    },
    missingOrUnverified: {
      type: "array",
      items: missingDataItemSchema,
    },
    recommendedSteps: { type: "array", items: { type: "string" } },
    secureRevealCards: {
      type: "array",
      items: secureRevealCardSchema,
    },
    draftNote: draftNoteSchema,
    followupSuggestions: { type: "array", items: { type: "string" } },
    statePatch: statePatchSchema,
  },
};

export const OPENAI_V2_ASSISTANT_RESPONSE_TEXT_FORMAT = {
  type: "json_schema",
  name: "v2_assistant_response",
  strict: true,
  schema: OPENAI_V2_ASSISTANT_RESPONSE_SCHEMA,
};

export function getOpenAIV2AssistantResponseTextFormat() {
  return OPENAI_V2_ASSISTANT_RESPONSE_TEXT_FORMAT;
}

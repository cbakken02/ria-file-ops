import type {
  DataFieldDefinition,
  DefaultMaskingStrategy,
  SensitiveField,
} from "@/lib/data-intelligence-v2/types";

export const FIELD_CATALOG: DataFieldDefinition[] = [
  {
    fieldKey: "client.name",
    label: "Client name",
    category: "client",
    aliases: ["clientName", "displayName", "name"],
    classification: "safe_to_model",
    defaultMasking: "none",
    canSendToModel: true,
    canRevealToAuthorizedUser: false,
    requiresRevealPurpose: false,
  },
  {
    fieldKey: "client.id",
    label: "Client ID",
    category: "client",
    aliases: ["clientId", "partyId"],
    classification: "client_confidential_to_model",
    defaultMasking: "none",
    canSendToModel: true,
    canRevealToAuthorizedUser: false,
    requiresRevealPurpose: false,
  },
  {
    fieldKey: "client.ssn",
    label: "Social Security number",
    category: "client",
    aliases: ["ssn", "socialSecurityNumber", "social_security_number", "taxIdentifier", "tax_id"],
    classification: "reveal_card_only_never_to_model",
    defaultMasking: "last4",
    canSendToModel: false,
    canRevealToAuthorizedUser: true,
    requiresRevealPurpose: true,
    sensitiveField: "ssn",
  },
  {
    fieldKey: "client.taxId",
    label: "Tax ID",
    category: "client",
    aliases: ["tin", "tax_id", "taxIdentifier", "ein"],
    classification: "reveal_card_only_never_to_model",
    defaultMasking: "last4",
    canSendToModel: false,
    canRevealToAuthorizedUser: true,
    requiresRevealPurpose: true,
    sensitiveField: "tax_id",
  },
  {
    fieldKey: "client.dob",
    label: "Date of birth",
    category: "client",
    aliases: ["dob", "dateOfBirth", "date_of_birth", "birthDate"],
    classification: "reveal_card_only_never_to_model",
    defaultMasking: "date_status_only",
    canSendToModel: false,
    canRevealToAuthorizedUser: true,
    requiresRevealPurpose: true,
    sensitiveField: "dob",
  },
  {
    fieldKey: "client.address",
    label: "Client address",
    category: "client",
    aliases: ["address", "streetAddress", "mailingAddress", "physicalAddress"],
    classification: "reveal_card_only_never_to_model",
    defaultMasking: "city_state_only",
    canSendToModel: false,
    canRevealToAuthorizedUser: true,
    requiresRevealPurpose: true,
    sensitiveField: "address",
  },
  {
    fieldKey: "client.phone",
    label: "Client phone",
    category: "contact",
    aliases: ["phone", "phoneNumber", "mobilePhone", "homePhone"],
    classification: "reveal_card_only_never_to_model",
    defaultMasking: "masked",
    canSendToModel: false,
    canRevealToAuthorizedUser: true,
    requiresRevealPurpose: true,
    sensitiveField: "phone",
  },
  {
    fieldKey: "client.email",
    label: "Client email",
    category: "contact",
    aliases: ["email", "emailAddress"],
    classification: "reveal_card_only_never_to_model",
    defaultMasking: "masked",
    canSendToModel: false,
    canRevealToAuthorizedUser: true,
    requiresRevealPurpose: true,
    sensitiveField: "email",
  },
  {
    fieldKey: "account.fullAccountNumber",
    label: "Full account number",
    category: "account",
    aliases: ["accountNumber", "fullAccountNumber", "account_number", "rawAccountNumber"],
    classification: "reveal_card_only_never_to_model",
    defaultMasking: "last4",
    canSendToModel: false,
    canRevealToAuthorizedUser: true,
    requiresRevealPurpose: true,
    sensitiveField: "full_account_number",
  },
  {
    fieldKey: "account.last4",
    label: "Account last four",
    category: "account",
    aliases: ["last4", "accountLast4", "account_number_last4"],
    classification: "masked_only_to_model",
    defaultMasking: "last4",
    canSendToModel: true,
    canRevealToAuthorizedUser: false,
    requiresRevealPurpose: false,
  },
  {
    fieldKey: "account.maskedAccountNumber",
    label: "Masked account number",
    category: "account",
    aliases: ["maskedAccountNumber", "masked_account_number"],
    classification: "masked_only_to_model",
    defaultMasking: "masked",
    canSendToModel: true,
    canRevealToAuthorizedUser: false,
    requiresRevealPurpose: false,
  },
  {
    fieldKey: "account.balance",
    label: "Account balance",
    category: "account",
    aliases: ["balance", "accountValue", "marketValue"],
    classification: "client_confidential_to_model",
    defaultMasking: "none",
    canSendToModel: true,
    canRevealToAuthorizedUser: false,
    requiresRevealPurpose: false,
  },
  {
    fieldKey: "account.custodian",
    label: "Custodian",
    category: "account",
    aliases: ["custodian", "institution", "institutionName"],
    classification: "client_confidential_to_model",
    defaultMasking: "none",
    canSendToModel: true,
    canRevealToAuthorizedUser: false,
    requiresRevealPurpose: false,
  },
  {
    fieldKey: "account.type",
    label: "Account type",
    category: "account",
    aliases: ["accountType", "registrationType"],
    classification: "client_confidential_to_model",
    defaultMasking: "none",
    canSendToModel: true,
    canRevealToAuthorizedUser: false,
    requiresRevealPurpose: false,
  },
  {
    fieldKey: "statement.date",
    label: "Statement date",
    category: "statement",
    aliases: ["statementDate", "statement_date", "asOfDate"],
    classification: "client_confidential_to_model",
    defaultMasking: "none",
    canSendToModel: true,
    canRevealToAuthorizedUser: false,
    requiresRevealPurpose: false,
  },
  {
    fieldKey: "statement.documentLabel",
    label: "Statement document label",
    category: "statement",
    aliases: ["documentLabel", "sourceLabel"],
    classification: "client_confidential_to_model",
    defaultMasking: "none",
    canSendToModel: true,
    canRevealToAuthorizedUser: false,
    requiresRevealPurpose: false,
  },
  {
    fieldKey: "taxDocument.taxYear",
    label: "Tax year",
    category: "tax_document",
    aliases: ["taxYear", "tax_year"],
    classification: "client_confidential_to_model",
    defaultMasking: "none",
    canSendToModel: true,
    canRevealToAuthorizedUser: false,
    requiresRevealPurpose: false,
  },
  {
    fieldKey: "taxDocument.formType",
    label: "Tax form type",
    category: "tax_document",
    aliases: ["formType", "taxFormType"],
    classification: "client_confidential_to_model",
    defaultMasking: "none",
    canSendToModel: true,
    canRevealToAuthorizedUser: false,
    requiresRevealPurpose: false,
  },
  {
    fieldKey: "identity.driverLicenseNumber",
    label: "Driver license number",
    category: "identity_document",
    aliases: ["driverLicenseNumber", "driversLicenseNumber", "licenseNumber", "dlNumber"],
    classification: "reveal_card_only_never_to_model",
    defaultMasking: "last4",
    canSendToModel: false,
    canRevealToAuthorizedUser: true,
    requiresRevealPurpose: true,
    sensitiveField: "driver_license_number",
  },
  {
    fieldKey: "identity.passportNumber",
    label: "Passport number",
    category: "identity_document",
    aliases: ["passportNumber"],
    classification: "reveal_card_only_never_to_model",
    defaultMasking: "last4",
    canSendToModel: false,
    canRevealToAuthorizedUser: true,
    requiresRevealPurpose: true,
    sensitiveField: "passport_number",
  },
  {
    fieldKey: "identity.governmentIdNumber",
    label: "Government ID number",
    category: "identity_document",
    aliases: ["governmentIdNumber", "government_id_number", "idNumber"],
    classification: "reveal_card_only_never_to_model",
    defaultMasking: "last4",
    canSendToModel: false,
    canRevealToAuthorizedUser: true,
    requiresRevealPurpose: true,
    sensitiveField: "government_id_number",
  },
  {
    fieldKey: "uploadedDocument.id",
    label: "Uploaded document ID",
    category: "uploaded_document",
    aliases: ["documentId", "uploadedDocumentId"],
    classification: "client_confidential_to_model",
    defaultMasking: "none",
    canSendToModel: true,
    canRevealToAuthorizedUser: false,
    requiresRevealPurpose: false,
  },
  {
    fieldKey: "uploadedDocument.sourceFileId",
    label: "Source file ID",
    category: "source",
    aliases: ["sourceFileId", "driveFileId", "googleDriveFileId", "fileId"],
    classification: "never_expose",
    defaultMasking: "hidden",
    canSendToModel: false,
    canRevealToAuthorizedUser: false,
    requiresRevealPurpose: false,
  },
  {
    fieldKey: "system.oauthToken",
    label: "OAuth token",
    category: "system",
    aliases: ["oauthToken", "accessToken", "refreshToken"],
    classification: "never_expose",
    defaultMasking: "hidden",
    canSendToModel: false,
    canRevealToAuthorizedUser: false,
    requiresRevealPurpose: false,
  },
  {
    fieldKey: "system.encryptionKey",
    label: "Encryption key",
    category: "system",
    aliases: ["encryptionKey", "secretKey", "appEncryptionKey"],
    classification: "never_expose",
    defaultMasking: "hidden",
    canSendToModel: false,
    canRevealToAuthorizedUser: false,
    requiresRevealPurpose: false,
  },
  {
    fieldKey: "client.ssnStatus",
    label: "SSN status",
    category: "identity_document",
    aliases: ["ssnStatus", "socialSecurityNumberStatus"],
    classification: "client_confidential_to_model",
    defaultMasking: "none",
    canSendToModel: true,
    canRevealToAuthorizedUser: false,
    requiresRevealPurpose: false,
  },
  {
    fieldKey: "client.taxIdStatus",
    label: "Tax ID status",
    category: "identity_document",
    aliases: ["taxIdStatus", "tinStatus", "taxIdentifierStatus"],
    classification: "client_confidential_to_model",
    defaultMasking: "none",
    canSendToModel: true,
    canRevealToAuthorizedUser: false,
    requiresRevealPurpose: false,
  },
  {
    fieldKey: "client.dobStatus",
    label: "Date of birth status",
    category: "identity_document",
    aliases: ["dobStatus", "dateOfBirthStatus", "birthDateStatus"],
    classification: "client_confidential_to_model",
    defaultMasking: "none",
    canSendToModel: true,
    canRevealToAuthorizedUser: false,
    requiresRevealPurpose: false,
  },
  {
    fieldKey: "client.addressStatus",
    label: "Address status",
    category: "identity_document",
    aliases: ["addressStatus", "mailingAddressStatus"],
    classification: "client_confidential_to_model",
    defaultMasking: "none",
    canSendToModel: true,
    canRevealToAuthorizedUser: false,
    requiresRevealPurpose: false,
  },
  {
    fieldKey: "client.phoneStatus",
    label: "Phone status",
    category: "contact",
    aliases: ["phoneStatus", "phoneNumberStatus"],
    classification: "client_confidential_to_model",
    defaultMasking: "none",
    canSendToModel: true,
    canRevealToAuthorizedUser: false,
    requiresRevealPurpose: false,
  },
  {
    fieldKey: "client.emailStatus",
    label: "Email status",
    category: "contact",
    aliases: ["emailStatus", "emailAddressStatus"],
    classification: "client_confidential_to_model",
    defaultMasking: "none",
    canSendToModel: true,
    canRevealToAuthorizedUser: false,
    requiresRevealPurpose: false,
  },
  {
    fieldKey: "identity.driverLicenseStatus",
    label: "Driver license status",
    category: "identity_document",
    aliases: ["driverLicenseStatus", "driversLicenseStatus"],
    classification: "client_confidential_to_model",
    defaultMasking: "none",
    canSendToModel: true,
    canRevealToAuthorizedUser: false,
    requiresRevealPurpose: false,
  },
  {
    fieldKey: "identity.driverLicenseExpirationDate",
    label: "Driver license expiration date",
    category: "identity_document",
    aliases: ["driverLicenseExpirationDate", "driversLicenseExpirationDate"],
    classification: "client_confidential_to_model",
    defaultMasking: "none",
    canSendToModel: true,
    canRevealToAuthorizedUser: false,
    requiresRevealPurpose: false,
  },
  {
    fieldKey: "identity.passportStatus",
    label: "Passport status",
    category: "identity_document",
    aliases: ["passportStatus"],
    classification: "client_confidential_to_model",
    defaultMasking: "none",
    canSendToModel: true,
    canRevealToAuthorizedUser: false,
    requiresRevealPurpose: false,
  },
  {
    fieldKey: "identity.passportExpirationDate",
    label: "Passport expiration date",
    category: "identity_document",
    aliases: ["passportExpirationDate"],
    classification: "client_confidential_to_model",
    defaultMasking: "none",
    canSendToModel: true,
    canRevealToAuthorizedUser: false,
    requiresRevealPurpose: false,
  },
  {
    fieldKey: "identity.governmentIdStatus",
    label: "Government ID status",
    category: "identity_document",
    aliases: ["governmentIdStatus", "stateIdStatus"],
    classification: "client_confidential_to_model",
    defaultMasking: "none",
    canSendToModel: true,
    canRevealToAuthorizedUser: false,
    requiresRevealPurpose: false,
  },
  {
    fieldKey: "account.id",
    label: "Account ID",
    category: "account",
    aliases: ["accountId"],
    classification: "client_confidential_to_model",
    defaultMasking: "none",
    canSendToModel: true,
    canRevealToAuthorizedUser: false,
    requiresRevealPurpose: false,
  },
  {
    fieldKey: "account.status",
    label: "Account status",
    category: "account",
    aliases: ["accountStatus"],
    classification: "client_confidential_to_model",
    defaultMasking: "none",
    canSendToModel: true,
    canRevealToAuthorizedUser: false,
    requiresRevealPurpose: false,
  },
  {
    fieldKey: "statement.stalenessStatus",
    label: "Statement staleness status",
    category: "statement",
    aliases: ["statementStalenessStatus", "stalenessStatus"],
    classification: "client_confidential_to_model",
    defaultMasking: "none",
    canSendToModel: true,
    canRevealToAuthorizedUser: false,
    requiresRevealPurpose: false,
  },
  {
    fieldKey: "taxDocument.status",
    label: "Tax document status",
    category: "tax_document",
    aliases: ["taxDocumentStatus"],
    classification: "client_confidential_to_model",
    defaultMasking: "none",
    canSendToModel: true,
    canRevealToAuthorizedUser: false,
    requiresRevealPurpose: false,
  },
  {
    fieldKey: "workflow.requirementStatus",
    label: "Workflow requirement status",
    category: "system",
    aliases: ["workflowRequirementStatus", "requirementStatus"],
    classification: "client_confidential_to_model",
    defaultMasking: "none",
    canSendToModel: true,
    canRevealToAuthorizedUser: false,
    requiresRevealPurpose: false,
  },
];

export function getFieldDefinition(
  fieldKey: string,
): DataFieldDefinition | undefined {
  return FIELD_CATALOG.find((definition) => definition.fieldKey === fieldKey);
}

export function getFieldDefinitionByAlias(
  fieldOrAlias: string,
): DataFieldDefinition | undefined {
  const lookupKey = normalizeLookupKey(fieldOrAlias);

  return FIELD_CATALOG.find((definition) => {
    if (normalizeLookupKey(definition.fieldKey) === lookupKey) {
      return true;
    }

    return definition.aliases.some(
      (alias) => normalizeLookupKey(alias) === lookupKey,
    );
  });
}

export function isFieldAllowedForModel(fieldKey: string): boolean {
  return getFieldDefinitionByAlias(fieldKey)?.canSendToModel === true;
}

export function isRevealOnlyField(fieldKey: string): boolean {
  return (
    getFieldDefinitionByAlias(fieldKey)?.classification ===
    "reveal_card_only_never_to_model"
  );
}

export function isNeverExposeField(fieldKey: string): boolean {
  return (
    getFieldDefinitionByAlias(fieldKey)?.classification === "never_expose"
  );
}

export function maskValueForModel(
  fieldKey: string,
  value: unknown,
): string | number | boolean | null {
  const definition = getFieldDefinitionByAlias(fieldKey);
  const masking = definition?.defaultMasking ?? "hidden";

  return applyMaskingStrategy(masking, value, definition?.sensitiveField);
}

function applyMaskingStrategy(
  strategy: DefaultMaskingStrategy,
  value: unknown,
  sensitiveField?: SensitiveField,
): string | number | boolean | null {
  if (value === null || value === undefined) {
    return null;
  }

  switch (strategy) {
    case "none":
      return primitiveOrJsonString(value);
    case "last4": {
      const last4 = String(value).replace(/[^a-zA-Z0-9]/g, "").slice(-4);
      if (!last4) {
        return "[MASKED]";
      }

      if (sensitiveField === "ssn") {
        return `***-**-${last4}`;
      }

      return `****${last4}`;
    }
    case "masked": {
      const text = String(value);
      if (appearsAlreadyMasked(text)) {
        return text;
      }

      return "[MASKED]";
    }
    case "hidden":
      return "[REDACTED]";
    case "date_status_only":
      return "[DATE_ON_FILE_REDACTED]";
    case "city_state_only":
      return "[ADDRESS_REDACTED]";
    default:
      return "[REDACTED]";
  }
}

function primitiveOrJsonString(value: unknown): string | number | boolean | null {
  if (
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  ) {
    return value;
  }

  try {
    return JSON.stringify(value);
  } catch {
    return null;
  }
}

function appearsAlreadyMasked(value: string): boolean {
  const trimmed = value.trim();

  return (
    trimmed === "[MASKED]" ||
    trimmed === "[REDACTED]" ||
    /[*xX]{2,}/.test(trimmed)
  );
}

function normalizeLookupKey(value: string): string {
  return value.trim().toLowerCase().replace(/[^a-z0-9]/g, "");
}

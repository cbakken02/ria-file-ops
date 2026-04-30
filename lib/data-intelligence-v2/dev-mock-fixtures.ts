import type {
  SensitiveRevealFieldKey,
  V2IdentityStatusField,
  V2SourceRef,
} from "@/lib/data-intelligence-v2/types";

// Dev mock fixtures must never contain real customer data. Values here are
// synthetic and exist only for local QA of the V2 copilot safety path.

export const DEV_MOCK_OWNER_EMAIL = "advisor.demo@example.test";

export const DEV_MOCK_CLIENTS = [
  {
    clientId: "mock_client_alex",
    displayName: "Alex Demo",
    householdId: "mock_household_demo",
  },
  {
    clientId: "mock_client_jordan",
    displayName: "Jordan Sample",
    householdId: "mock_household_demo",
  },
  {
    clientId: "mock_client_taylor",
    displayName: "Taylor Test",
    householdId: "mock_household_test",
  },
] as const;

export const DEV_MOCK_ACCOUNT = {
  accountId: "mock_account_schwab_ira",
  clientId: "mock_client_alex",
  label: "Schwab IRA",
  custodian: "Schwab",
  accountType: "IRA",
  accountStatus: "open" as const,
  fullAccountNumber: "9999000011112222",
  maskedAccountNumber: "****2222",
  accountLast4: "2222",
  balance: 125000.25,
  balanceLabel: "Market value",
  latestStatementDate: "2026-03-31",
};

export const DEV_MOCK_TAX_DOCUMENT = {
  documentId: "mock_doc_tax_1099_2023",
  clientId: "mock_client_alex",
  label: "Mock 2023 Form 1099",
  taxYear: 2023,
  formType: "1099",
  status: "available" as const,
};

export const DEV_MOCK_IDENTITY_VALUES: Partial<
  Record<SensitiveRevealFieldKey, string>
> = {
  "client.ssn": "999-99-1234",
  "client.dob": "01/01/1970",
  "client.address": "123 Demo St, Testville, IL 60000",
  "client.phone": "555-010-1234",
  "client.email": "alex.demo@example.test",
  "account.fullAccountNumber": DEV_MOCK_ACCOUNT.fullAccountNumber,
  "identity.driverLicenseNumber": "D0000001234",
  "identity.passportNumber": "P0000001234",
  "identity.governmentIdNumber": "G0000001234",
};

export const DEV_MOCK_IDENTITY_STATUS_FIELDS: Record<
  V2IdentityStatusField,
  {
    fieldKey: string;
    label: string;
    status: "on_file" | "unexpired" | "unknown";
    expirationDate?: string;
  }
> = {
  ssn: {
    fieldKey: "client.ssnStatus",
    label: "SSN status",
    status: "on_file",
  },
  tax_id: {
    fieldKey: "client.taxIdStatus",
    label: "Tax ID status",
    status: "unknown",
  },
  dob: {
    fieldKey: "client.dobStatus",
    label: "DOB status",
    status: "on_file",
  },
  drivers_license: {
    fieldKey: "identity.driverLicenseStatus",
    label: "Driver license status",
    status: "unexpired",
    expirationDate: "2030-01-01",
  },
  passport: {
    fieldKey: "identity.passportStatus",
    label: "Passport status",
    status: "on_file",
    expirationDate: "2031-01-01",
  },
  government_id: {
    fieldKey: "identity.governmentIdStatus",
    label: "Government ID status",
    status: "on_file",
  },
  address: {
    fieldKey: "client.addressStatus",
    label: "Address status",
    status: "on_file",
  },
  phone: {
    fieldKey: "client.phoneStatus",
    label: "Phone status",
    status: "on_file",
  },
  email: {
    fieldKey: "client.emailStatus",
    label: "Email status",
    status: "on_file",
  },
};

export const DEV_MOCK_SOURCE_REFS = {
  client: {
    sourceId: "mock_source_client_1",
    sourceType: "system_record",
    label: "Mock client record",
    documentId: "mock_doc_client_1",
    confidence: "high",
  },
  account: {
    sourceId: "mock_source_account_1",
    sourceType: "account_record",
    label: "Mock account record",
    documentId: "mock_doc_account_1",
    date: "2026-03-31",
    confidence: "high",
  },
  statement: {
    sourceId: "mock_source_statement_1",
    sourceType: "uploaded_document",
    label: "Mock Schwab statement",
    documentId: "mock_doc_statement_1",
    date: "2026-03-31",
    page: 1,
    confidence: "high",
  },
  tax: {
    sourceId: "mock_source_tax_1",
    sourceType: "tax_record",
    label: "Mock tax document",
    documentId: "mock_doc_tax_1099_2023",
    date: "2026-02-15",
    confidence: "high",
  },
  identity: {
    sourceId: "mock_source_identity_1",
    sourceType: "identity_record",
    label: "Mock identity record",
    documentId: "mock_doc_identity_1",
    date: "2026-01-15",
    confidence: "high",
  },
} satisfies Record<string, V2SourceRef>;

export function getDevMockClient(clientId: string) {
  return DEV_MOCK_CLIENTS.find((client) => client.clientId === clientId);
}

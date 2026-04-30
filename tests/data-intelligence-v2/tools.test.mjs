import assert from "node:assert/strict";
import test from "node:test";

import { assertNoUnsafeModelContent } from "../../lib/data-intelligence-v2/safe-memory.ts";
import {
  getV2ToolDefinition,
  isV2ToolName,
  listV2ToolDefinitions,
} from "../../lib/data-intelligence-v2/tools/registry.ts";
import {
  runV2Tool,
  validateV2ToolArgs,
} from "../../lib/data-intelligence-v2/tools/runner.ts";

const authContext = {
  userEmail: "advisor@example.test",
  ownerEmail: "owner@example.test",
  role: "readonly",
};

test("registry exposes all V2 tools", () => {
  const definitions = listV2ToolDefinitions();
  const names = definitions.map((definition) => definition.name).sort();

  assert.deepEqual(names, [
    "check_workflow_requirements",
    "create_sensitive_reveal",
    "get_accounts",
    "get_identity_status",
    "get_latest_statements",
    "get_tax_documents",
    "resolve_client",
  ]);
  assert.equal(isV2ToolName("resolve_client"), true);
  assert.equal(isV2ToolName("not_a_tool"), false);
  assert.equal(getV2ToolDefinition("get_accounts")?.parameters.type, "object");
  assert.match(
    getV2ToolDefinition("get_accounts")?.description ?? "",
    /account summaries/i,
  );
});

test("argument validation rejects missing or unsupported arguments", () => {
  assert.equal(validateV2ToolArgs("resolve_client", {}).valid, false);
  assert.equal(validateV2ToolArgs("get_accounts", {}).valid, false);
  assert.equal(
    validateV2ToolArgs("get_latest_statements", {
      clientId: "client_1",
      maxAgeDays: 90,
    }).valid,
    true,
  );
  assert.equal(
    validateV2ToolArgs("get_tax_documents", {
      clientId: "client_1",
      taxYear: 2024,
      formTypes: ["1099"],
    }).valid,
    true,
  );
  assert.equal(
    validateV2ToolArgs("get_identity_status", {
      clientId: "client_1",
      fields: ["ssn", "dob"],
    }).valid,
    true,
  );
  assert.equal(
    validateV2ToolArgs("get_identity_status", {
      clientId: "client_1",
      fields: ["secret_code"],
    }).valid,
    false,
  );
  assert.equal(
    validateV2ToolArgs("check_workflow_requirements", {
      clientId: "client_1",
      workflowType: "unknown_workflow",
    }).valid,
    false,
  );
  assert.equal(
    validateV2ToolArgs("create_sensitive_reveal", {
      clientId: "client_1",
      fieldKey: "client.ssn",
      purpose: "form_completion",
    }).valid,
    true,
  );
  assert.equal(
    validateV2ToolArgs("create_sensitive_reveal", {
      clientId: "client_1",
      fieldKey: "uploadedDocument.sourceFileId",
      purpose: "form_completion",
    }).valid,
    false,
  );
});

test("resolve_client handles not found, success, and ambiguous results", async () => {
  const notFound = await runV2Tool({
    toolName: "resolve_client",
    args: { query: "No Match" },
    authContext,
    dataGateway: makeGateway({
      resolveClient: async () => ({
        candidates: [],
        sourceRefs: [],
        missing: [
          {
            item: "client",
            checked: ["client records"],
            reason: "No match.",
          },
        ],
      }),
    }),
  });
  assert.equal(notFound.status, "not_found");
  assert.deepEqual(notFound.secureRevealCards, []);

  const success = await runV2Tool({
    toolName: "resolve_client",
    args: { query: "Jane Client" },
    authContext,
    dataGateway: makeGateway({
      resolveClient: async () => ({
        candidates: [
          {
            clientId: "client_1",
            displayName: "Jane Client",
            sourceRefs: [sourceRef("Client record")],
          },
        ],
        sourceRefs: [sourceRef("Client record")],
        missing: [],
      }),
    }),
  });
  assert.equal(success.status, "success");
  assertNoUnsafeModelContent(success);

  const ambiguous = await runV2Tool({
    toolName: "resolve_client",
    args: { query: "Jane" },
    authContext,
    dataGateway: makeGateway({
      resolveClient: async () => ({
        candidates: [
          {
            clientId: "client_1",
            displayName: "Jane Client",
            sourceRefs: [sourceRef("Client record")],
          },
          {
            clientId: "client_2",
            displayName: "Jane Other",
            sourceRefs: [sourceRef("Client record 2", "doc_2")],
          },
        ],
        sourceRefs: [sourceRef("Client record"), sourceRef("Client record 2", "doc_2")],
        missing: [],
      }),
    }),
  });
  assert.equal(ambiguous.status, "ambiguous");
  assertNoUnsafeModelContent(ambiguous);
});

test("get_accounts drops unsafe account and source fields", async () => {
  const result = await runV2Tool({
    toolName: "get_accounts",
    args: { clientId: "client_1" },
    authContext,
    dataGateway: makeGateway({
      getAccounts: async () => ({
        accounts: [
          {
            accountId: "account_1",
            label: "Schwab brokerage",
            custodian: "Schwab",
            accountType: "brokerage",
            fullAccountNumber: "9876543210123456",
            accountNumber: "9876543210123456",
            accountLast4: "3456",
            maskedAccountNumber: "****3456",
            sourceFileId: "drive_file_abc123",
            balance: 123456.78,
            sourceRefs: [sourceRef("Account record")],
          },
        ],
        sourceRefs: [sourceRef("Account record")],
        missing: [],
      }),
    }),
  });
  const serialized = JSON.stringify(result);

  assert.equal(result.status, "success");
  assert.equal(serialized.includes("9876543210123456"), false);
  assert.equal(serialized.includes("drive_file_abc123"), false);
  assert.ok(serialized.includes("3456") || serialized.includes("****3456"));
  assert.ok(serialized.includes("123456.78"));
  assertNoUnsafeModelContent(result);
});

test("get_latest_statements drops unsafe account and source fields", async () => {
  const result = await runV2Tool({
    toolName: "get_latest_statements",
    args: { clientId: "client_1", maxAgeDays: 365 },
    authContext,
    dataGateway: makeGateway({
      getLatestStatements: async () => ({
        statements: [
          {
            statementId: "statement_1",
            accountId: "account_1",
            label: "Latest statement",
            statementDate: "2024-12-31",
            custodian: "Schwab",
            accountType: "brokerage",
            fullAccountNumber: "9876543210123456",
            sourceFileId: "drive_file_abc123",
            sourceRefs: [sourceRef("Statement")],
          },
        ],
        sourceRefs: [sourceRef("Statement")],
        missing: [],
      }),
    }),
  });
  const serialized = JSON.stringify(result);

  assert.equal(result.status, "success");
  assert.equal(serialized.includes("9876543210123456"), false);
  assert.equal(serialized.includes("drive_file_abc123"), false);
  assert.ok(serialized.includes("2024-12-31"));
  assert.ok(serialized.includes("Schwab"));
  assertNoUnsafeModelContent(result);
});

test("get_tax_documents keeps metadata and drops unexpected identifiers", async () => {
  const result = await runV2Tool({
    toolName: "get_tax_documents",
    args: { clientId: "client_1", taxYear: 2024, formTypes: ["1099"] },
    authContext,
    dataGateway: makeGateway({
      getTaxDocuments: async () => ({
        taxDocuments: [
          {
            documentId: "tax_doc_1",
            label: "1099 Composite",
            taxYear: 2024,
            formType: "1099",
            status: "available",
            unexpectedIdentifier: "123-45-6789",
            sourceRefs: [sourceRef("Tax document")],
          },
        ],
        sourceRefs: [sourceRef("Tax document")],
        missing: [],
      }),
    }),
  });
  const serialized = JSON.stringify(result);

  assert.equal(result.status, "success");
  assert.equal(serialized.includes("123-45-6789"), false);
  assert.ok(serialized.includes("2024"));
  assert.ok(serialized.includes("1099"));
  assertNoUnsafeModelContent(result);
});

test("get_identity_status returns status only for sensitive identity fields", async () => {
  const result = await runV2Tool({
    toolName: "get_identity_status",
    args: {
      clientId: "client_1",
      fields: ["ssn", "dob", "address", "phone", "email", "drivers_license"],
    },
    authContext,
    dataGateway: makeGateway({
      getIdentityStatus: async () => ({
        statuses: [
          unsafeIdentityStatus("ssn", "client.ssnStatus", "SSN status"),
          {
            ...unsafeIdentityStatus("dob", "client.dobStatus", "DOB status"),
            dob: "01/23/1960",
          },
          {
            ...unsafeIdentityStatus(
              "address",
              "client.addressStatus",
              "Address status",
            ),
            address: "123 Main St, Chicago, IL 60601",
          },
          {
            ...unsafeIdentityStatus("email", "client.emailStatus", "Email status"),
            email: "client@example.com",
          },
          {
            ...unsafeIdentityStatus("phone", "client.phoneStatus", "Phone status"),
            phone: "312-555-1212",
          },
          {
            ...unsafeIdentityStatus(
              "drivers_license",
              "identity.driverLicenseStatus",
              "Driver license status",
            ),
            driverLicenseNumber: "D123456789",
          },
        ],
        sourceRefs: [sourceRef("Identity record")],
        missing: [],
      }),
    }),
  });
  const serialized = JSON.stringify(result);

  assert.equal(result.status, "success");
  assert.equal(serialized.includes("123-45-6789"), false);
  assert.equal(serialized.includes("01/23/1960"), false);
  assert.equal(serialized.includes("123 Main St"), false);
  assert.equal(serialized.includes("client@example.com"), false);
  assert.equal(serialized.includes("312-555-1212"), false);
  assert.equal(serialized.includes("D123456789"), false);
  assert.ok(serialized.includes("on_file"));
  assert.ok(
    result.disallowedClaims.some((claim) =>
      claim.includes("Do not state raw identity values"),
    ),
  );
  assertNoUnsafeModelContent(result);
});

test("check_workflow_requirements preserves missing items and drops unsafe fields", async () => {
  const result = await runV2Tool({
    toolName: "check_workflow_requirements",
    args: { clientId: "client_1", workflowType: "rollover" },
    authContext,
    dataGateway: makeGateway({
      checkWorkflowRequirements: async () => ({
        workflowType: "rollover",
        requirements: [
          {
            requirementId: "latest_statement_available",
            label: "Latest statement",
            status: "missing",
            checked: ["latest statement records"],
            summary: "Latest statement not found.",
            fullAccountNumber: "9876543210123456",
            sourceRefs: [],
          },
        ],
        sourceRefs: [],
        missing: [
          {
            item: "Latest statement",
            checked: ["latest statement records"],
            reason: "Latest statement not found.",
          },
        ],
      }),
    }),
  });
  const serialized = JSON.stringify(result);

  assert.equal(result.status, "success");
  assert.equal(result.missing.length, 1);
  assert.equal(serialized.includes("9876543210123456"), false);
  assertNoUnsafeModelContent(result);
});

test("runner owns owner scope and readonly can run read-only status tools", async () => {
  const calls = [];
  const gateway = makeGateway({
    getIdentityStatus: async (args) => {
      calls.push(args);
      return {
        statuses: [
          {
            field: "dob",
            fieldKey: "client.dobStatus",
            label: "DOB status",
            status: "on_file",
            sourceRefs: [],
          },
        ],
        sourceRefs: [],
        missing: [],
      };
    },
  });

  const result = await runV2Tool({
    toolName: "get_identity_status",
    args: { clientId: "client_1", fields: ["dob"] },
    authContext: { ...authContext, role: "readonly" },
    dataGateway: gateway,
  });

  assert.equal(result.status, "success");
  assert.equal(calls[0].ownerEmail, authContext.ownerEmail);
  assert.equal(
    validateV2ToolArgs("get_accounts", {
      clientId: "client_1",
      ownerEmail: "other@example.test",
    }).valid,
    false,
  );

  const denied = await runV2Tool({
    toolName: "get_accounts",
    args: { clientId: "client_1" },
    authContext: { ...authContext, ownerEmail: "" },
    dataGateway: gateway,
  });
  assert.equal(denied.status, "denied");
  assertNoUnsafeModelContent(result);
  assertNoUnsafeModelContent(denied);
});

test("runner sanitizes malicious deeply nested gateway payloads", async () => {
  const result = await runV2Tool({
    toolName: "get_tax_documents",
    args: { clientId: "client_1" },
    authContext,
    dataGateway: makeGateway({
      getTaxDocuments: async () => ({
        taxDocuments: [
          {
            documentId: "tax_doc_1",
            label: "Tax document",
            taxYear: 2024,
            formType: "1099",
            status: "available",
            nested: { very: { odd: { ssn: "123-45-6789" } } },
            sourceRefs: [sourceRef("Tax document")],
          },
        ],
        sourceRefs: [sourceRef("Tax document")],
        missing: [],
      }),
    }),
  });
  const serialized = JSON.stringify(result);

  assert.notEqual(serialized.includes("123-45-6789"), true);
  assertNoUnsafeModelContent(result);
});

function sourceRef(label, documentId = "doc_1") {
  return {
    sourceId: `document:${documentId}`,
    sourceType: "uploaded_document",
    label,
    documentId,
    date: "2024-12-31",
    confidence: "high",
  };
}

function unsafeIdentityStatus(field, fieldKey, label) {
  return {
    field,
    fieldKey,
    label,
    status: "on_file",
    ssn: "123-45-6789",
    sourceRefs: [sourceRef("Identity record")],
  };
}

function makeGateway(overrides = {}) {
  return {
    async resolveClient(args) {
      return overrides.resolveClient?.(args) ?? {
        candidates: [],
        sourceRefs: [],
        missing: [],
      };
    },
    async getAccounts(args) {
      return overrides.getAccounts?.(args) ?? {
        accounts: [],
        sourceRefs: [],
        missing: [],
      };
    },
    async getLatestStatements(args) {
      return overrides.getLatestStatements?.(args) ?? {
        statements: [],
        sourceRefs: [],
        missing: [],
      };
    },
    async getTaxDocuments(args) {
      return overrides.getTaxDocuments?.(args) ?? {
        taxDocuments: [],
        sourceRefs: [],
        missing: [],
      };
    },
    async getIdentityStatus(args) {
      return overrides.getIdentityStatus?.(args) ?? {
        statuses: [],
        sourceRefs: [],
        missing: [],
      };
    },
    async checkWorkflowRequirements(args) {
      return overrides.checkWorkflowRequirements?.(args) ?? {
        workflowType: args.workflowType,
        requirements: [],
        sourceRefs: [],
        missing: [],
      };
    },
  };
}

import assert from "node:assert/strict";
import test from "node:test";

import {
  getFieldDefinition,
  isFieldAllowedForModel,
  isNeverExposeField,
  maskValueForModel,
} from "../../lib/data-intelligence-v2/field-catalog.ts";
import {
  authorizeFieldExposureToModel,
  authorizeModelBoundPayload,
  authorizeOwnerScope,
  authorizeSensitiveReveal,
} from "../../lib/data-intelligence-v2/policy.ts";
import {
  containsUnsafeSensitivePattern,
  sanitizeConversationMessagesForModel,
  sanitizeObjectForModel,
  sanitizeTextForModel,
} from "../../lib/data-intelligence-v2/safe-memory.ts";

test("field catalog classifies sensitive and model-safe fields", () => {
  assert.equal(
    getFieldDefinition("client.ssn")?.classification,
    "reveal_card_only_never_to_model",
  );
  assert.equal(
    getFieldDefinition("account.fullAccountNumber")?.classification,
    "reveal_card_only_never_to_model",
  );
  assert.equal(
    getFieldDefinition("client.dob")?.classification,
    "reveal_card_only_never_to_model",
  );
  assert.equal(
    getFieldDefinition("client.address")?.classification,
    "reveal_card_only_never_to_model",
  );
  assert.equal(isFieldAllowedForModel("account.last4"), true);
  assert.equal(isFieldAllowedForModel("account.balance"), true);
  assert.equal(isNeverExposeField("uploadedDocument.sourceFileId"), true);
});

test("field catalog masks reveal-only and hidden values", () => {
  const maskedSsn = maskValueForModel("client.ssn", "123-45-6789");
  assert.equal(typeof maskedSsn, "string");
  assert.ok(maskedSsn.endsWith("6789"));
  assert.equal(maskedSsn.includes("123-45-6789"), false);

  const maskedAccount = maskValueForModel(
    "account.fullAccountNumber",
    "9876543210123456",
  );
  assert.equal(typeof maskedAccount, "string");
  assert.ok(maskedAccount.endsWith("3456"));
  assert.equal(maskedAccount.includes("9876543210123456"), false);

  assert.equal(
    maskValueForModel("uploadedDocument.sourceFileId", "drive_file_abc123"),
    "[REDACTED]",
  );
});

test("text sanitizer redacts common sensitive free-text patterns", () => {
  const input =
    "SSN 123-45-6789, account 9876543210123456, phone 312-555-1212, email client@example.com, DOB 01/23/1960, address 123 Main St, Chicago, IL 60601";

  const output = sanitizeTextForModel(input);

  assert.equal(output.includes("123-45-6789"), false);
  assert.equal(output.includes("9876543210123456"), false);
  assert.equal(output.includes("312-555-1212"), false);
  assert.equal(output.includes("client@example.com"), false);
  assert.equal(output.includes("01/23/1960"), false);
  assert.equal(output.includes("123 Main St"), false);
  assert.match(output, /\[(SSN|ACCOUNT_NUMBER|PHONE|EMAIL|DOB|ADDRESS)_REDACTED\]/);
});

test("object sanitizer redacts V1-like source payloads without mutating input", () => {
  const payload = {
    answer:
      "John's SSN is 123-45-6789 and full account number is 9876543210123456.",
    sources: [
      {
        label: "Schwab Statement",
        sourceFileId: "drive_file_abc123",
        accountNumber: "9876543210123456",
        maskedAccountNumber: "****3456",
        accountNumberLast4: "3456",
        balance: 123456.78,
        statementDate: "2024-12-31",
      },
    ],
    details: {
      dob: "01/23/1960",
      address: "123 Main St, Chicago, IL 60601",
      email: "client@example.com",
      phone: "312-555-1212",
    },
  };
  const original = structuredClone(payload);

  const sanitized = sanitizeObjectForModel(payload);

  assert.deepEqual(payload, original);
  assert.equal(JSON.stringify(sanitized).includes("123-45-6789"), false);
  assert.equal(JSON.stringify(sanitized).includes("9876543210123456"), false);
  assert.equal(JSON.stringify(sanitized).includes("drive_file_abc123"), false);
  assert.equal(sanitized.sources[0].maskedAccountNumber, "****3456");
  assert.equal(sanitized.sources[0].accountNumberLast4, "****3456");
  assert.equal(sanitized.sources[0].balance, 123456.78);
  assert.equal(sanitized.sources[0].statementDate, "2024-12-31");
  assert.equal(containsUnsafeSensitivePattern(sanitized), false);
});

test("conversation sanitizer removes raw sensitive text and summarizes reveal cards", () => {
  const messages = [
    { role: "user", content: "What is the SSN?" },
    { role: "assistant", text: "The SSN is 123-45-6789." },
    {
      role: "assistant",
      text: "I displayed the secure card.",
      structuredResponse: {
        cards: [
          {
            revealCardId: "card_1",
            label: "SSN",
            actualValueWasNotShownToModel: true,
          },
        ],
      },
    },
  ];

  const safeMessages = sanitizeConversationMessagesForModel(messages, {
    maxMessages: 2,
  });
  const safeText = JSON.stringify(safeMessages);

  assert.equal(safeMessages.length, 2);
  assert.equal(safeText.includes("123-45-6789"), false);
  assert.ok(
    safeText.includes(
      "Displayed secure reveal card for SSN. Actual value was not exposed to the model.",
    ),
  );
});

test("policy authorizes owner scope, field exposure, reveal, and model payloads", () => {
  const authContext = {
    userEmail: "advisor@example.com",
    ownerEmail: "owner@example.com",
    role: "advisor",
    allowedClientIds: ["client_1"],
  };

  assert.equal(
    authorizeOwnerScope({
      authContext,
      requestedOwnerEmail: "owner@example.com",
    }).allowed,
    true,
  );
  assert.equal(
    authorizeOwnerScope({
      authContext,
      requestedOwnerEmail: "other@example.com",
    }).allowed,
    false,
  );
  assert.equal(
    authorizeFieldExposureToModel({ fieldKey: "client.ssn" }).allowed,
    false,
  );
  assert.equal(
    authorizeFieldExposureToModel({ fieldKey: "account.balance" }).allowed,
    true,
  );
  assert.equal(
    authorizeSensitiveReveal({
      authContext,
      requestedOwnerEmail: "owner@example.com",
      clientId: "client_1",
      fieldKey: "client.ssn",
      purpose: "form_completion",
    }).allowed,
    false,
  );

  const revealAuthContext = {
    ...authContext,
    allowSensitiveReveal: true,
  };
  assert.equal(
    authorizeSensitiveReveal({
      authContext: revealAuthContext,
      requestedOwnerEmail: "owner@example.com",
      clientId: "client_1",
      fieldKey: "client.ssn",
      purpose: "form_completion",
    }).allowed,
    true,
  );
  assert.equal(
    authorizeSensitiveReveal({
      authContext: {
        ...revealAuthContext,
        role: "readonly",
      },
      requestedOwnerEmail: "owner@example.com",
      clientId: "client_1",
      fieldKey: "client.ssn",
      purpose: "form_completion",
    }).allowed,
    false,
  );

  assert.equal(
    authorizeModelBoundPayload({
      payload: { answer: "The SSN is 123-45-6789." },
    }).allowed,
    false,
  );
  assert.equal(
    authorizeModelBoundPayload({
      payload: sanitizeObjectForModel({
        answer: "The SSN is 123-45-6789.",
        balance: 123456.78,
      }),
    }).allowed,
    true,
  );
});

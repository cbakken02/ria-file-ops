import assert from "node:assert/strict";
import test from "node:test";

import {
  assertNoRevealedValuesInChatPayload,
  buildV2ChatApiRequestBody,
  buildV2VisibleHistoryForApi,
  stripRevealedValuesFromClientMessage,
} from "../../lib/data-intelligence-v2/client-history.ts";

const RAW_SSN = "123-45-6789";
const RAW_ACCOUNT = "9876543210123456";
const RAW_EMAIL = "client@example.com";
const RAW_PHONE = "312-555-1212";
const RAW_DOB = "01/23/1960";
const RAW_ADDRESS = "123 Main St, Chicago, IL 60601";
const RAW_SOURCE_FILE_ID = "drive_file_abc123";

test("user and assistant history is sanitized for the chat API", () => {
  const history = buildV2VisibleHistoryForApi({
    messages: [
      {
        id: "user_1",
        role: "user",
        content: `SSN ${RAW_SSN}, account ${RAW_ACCOUNT}, email ${RAW_EMAIL}, phone ${RAW_PHONE}, DOB ${RAW_DOB}, address ${RAW_ADDRESS}.`,
        createdAt: "2026-04-28T00:00:00.000Z",
      },
      {
        id: "assistant_1",
        role: "assistant",
        content: `I will not repeat ${RAW_SSN} or ${RAW_ACCOUNT}.`,
        createdAt: "2026-04-28T00:00:01.000Z",
        response: safeResponse({
          answerMarkdown: `Unsafe answer ${RAW_EMAIL} ${RAW_PHONE}.`,
        }),
      },
    ],
  });

  assertNoRawSensitiveContent(history);
  assertNoRevealedValuesInChatPayload(history);
});

test("secure reveal metadata is preserved without raw values", () => {
  const history = buildV2VisibleHistoryForApi({
    messages: [
      {
        id: "assistant_1",
        role: "assistant",
        content: "A secure reveal card is available.",
        createdAt: "2026-04-28T00:00:00.000Z",
        response: safeResponse({
          secureRevealCards: [
            {
              revealCardId: "rvl_test_1234567890123456",
              fieldKey: "account.fullAccountNumber",
              fieldLabel: "Full account number",
              accountId: "account_1",
              label: "Account number",
              maskedValue: "****3456",
              status: "on_file",
              expiresAt: "2026-04-28T00:10:00.000Z",
              actualValueWasNotShownToModel: true,
              value: RAW_ACCOUNT,
            },
          ],
        }),
      },
    ],
  });
  const serialized = JSON.stringify(history);

  assert.match(serialized, /rvl_test_1234567890123456/);
  assert.match(serialized, /\*\*\*\*3456/);
  assert.match(serialized, /account.fullAccountNumber/);
  assert.match(serialized, /actualValueWasNotShownToModel/);
  assert.equal(serialized.includes(RAW_ACCOUNT), false);
  assertNoRevealedValuesInChatPayload(history);
});

test("accidental revealed-value fields are stripped without mutating input", () => {
  const original = {
    id: "assistant_1",
    role: "assistant",
    content: "Sensitive data was accidentally attached.",
    createdAt: "2026-04-28T00:00:00.000Z",
    revealedValue: RAW_SSN,
    rawValue: RAW_ACCOUNT,
    fullAccountNumber: RAW_ACCOUNT,
    sourceFileId: RAW_SOURCE_FILE_ID,
    response: safeResponse(),
  };
  const before = JSON.stringify(original);
  const stripped = stripRevealedValuesFromClientMessage(original);
  const serialized = JSON.stringify(stripped);

  assert.equal(JSON.stringify(original), before);
  assert.equal("revealedValue" in stripped, false);
  assert.equal("rawValue" in stripped, false);
  assert.equal("fullAccountNumber" in stripped, false);
  assert.equal("sourceFileId" in stripped, false);
  assert.equal(serialized.includes(RAW_SSN), false);
  assert.equal(serialized.includes(RAW_ACCOUNT), false);
  assert.equal(serialized.includes(RAW_SOURCE_FILE_ID), false);
});

test("request body builder bounds history and keeps payload safe", () => {
  const payload = buildV2ChatApiRequestBody({
    message: `Please use SSN ${RAW_SSN}.`,
    messages: Array.from({ length: 12 }, (_, index) => ({
      id: `msg_${index}`,
      role: index % 2 === 0 ? "user" : "assistant",
      content: `Message ${index} account ${RAW_ACCOUNT}`,
      createdAt: "2026-04-28T00:00:00.000Z",
      ...(index % 2 === 1 ? { response: safeResponse() } : {}),
    })),
    conversationState: {
      activeClientId: "client_1",
    },
  });

  assert.equal(payload.history.length, 8);
  assert.equal(payload.conversationState.activeClientId, "client_1");
  assertNoRawSensitiveContent(payload);
  assertNoRevealedValuesInChatPayload(payload);
});

test("conversation state extra unsafe keys are removed while safe reveal metadata remains", () => {
  const payload = buildV2ChatApiRequestBody({
    message: "Continue.",
    messages: [],
    conversationState: {
      activeClientId: "client_1",
      ssn: RAW_SSN,
      sourceFileId: RAW_SOURCE_FILE_ID,
      lastSensitiveReveals: [
        {
          revealCardId: "rvl_test_1234567890123456",
          clientId: "client_1",
          field: "full_account_number",
          label: "Account number",
          actualValueWasNotShownToModel: true,
        },
      ],
    },
  });
  const serialized = JSON.stringify(payload);

  assert.equal(payload.conversationState.activeClientId, "client_1");
  assert.equal(payload.conversationState.lastSensitiveReveals[0].revealCardId, "rvl_test_1234567890123456");
  assert.equal(serialized.includes(RAW_SSN), false);
  assert.equal(serialized.includes(RAW_SOURCE_FILE_ID), false);
  assertNoRevealedValuesInChatPayload(payload);
});

function safeResponse(overrides = {}) {
  return {
    responseType: "general_guidance",
    answerMarkdown: "Safe answer.",
    sourceBackedFacts: [],
    missingOrUnverified: [],
    recommendedSteps: [],
    secureRevealCards: [],
    followupSuggestions: [],
    ...overrides,
  };
}

function assertNoRawSensitiveContent(value) {
  const serialized = JSON.stringify(value);
  for (const rawValue of [
    RAW_SSN,
    RAW_ACCOUNT,
    RAW_EMAIL,
    RAW_PHONE,
    RAW_DOB,
    RAW_ADDRESS,
    RAW_SOURCE_FILE_ID,
  ]) {
    assert.equal(
      serialized.includes(rawValue),
      false,
      `Expected payload not to include ${rawValue}`,
    );
  }
}

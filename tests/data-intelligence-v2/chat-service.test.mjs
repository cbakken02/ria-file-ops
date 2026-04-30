import assert from "node:assert/strict";
import test from "node:test";

import {
  createToolResult,
} from "../../lib/data-intelligence-v2/tools/result-helpers.ts";
import {
  deriveSafeConversationStateFromToolResults,
  sanitizeSafeConversationState,
} from "../../lib/data-intelligence-v2/conversation-state.ts";
import {
  handleV2ChatApiRequest,
} from "../../lib/data-intelligence-v2/chat-api-handler.ts";
import {
  InMemoryRevealAuditSink,
} from "../../lib/data-intelligence-v2/reveal-audit.ts";
import {
  InMemoryRevealTokenStore,
  RevealTokenService,
} from "../../lib/data-intelligence-v2/reveal-token-service.ts";
import {
  resetDataIntelligenceV2ServiceFactoryForTests,
} from "../../lib/data-intelligence-v2/service-factory.ts";
import { runV2ChatTurn } from "../../lib/data-intelligence-v2/chat-service.ts";
import { runV2ToolLoop } from "../../lib/data-intelligence-v2/tool-loop.ts";

const RAW_SSN = "123-45-6789";
const RAW_ACCOUNT = "9876543210123456";
const RAW_EMAIL = "client@example.com";
const RAW_PHONE = "312-555-1212";
const RAW_DOB = "01/23/1960";
const RAW_ADDRESS = "123 Main St, Chicago, IL 60601";
const RAW_SOURCE_FILE_ID = "drive_file_abc123";

const authContext = {
  userEmail: "owner@example.test",
  ownerEmail: "owner@example.test",
  role: "advisor",
  allowSensitiveReveal: true,
  allowedOwnerEmails: ["owner@example.test"],
  allowedClientIds: ["client_1"],
};

const enabledConfig = {
  enabled: true,
  chatApiEnabled: true,
  uiEnabled: false,
  devMockEnabled: false,
  revealApiEnabled: false,
  allowSensitiveRevealForAuthenticatedUsers: true,
  defaultRevealExpiresInMs: 600000,
  revealStoreBackend: "auto",
  auditBackend: "auto",
  openAiEnabled: false,
  openAiBaseUrl: "https://api.openai.com/v1",
  openAiTimeoutMs: 30000,
  evalOpenAiEnabled: false,
  evalAllowNetwork: false,
};

test("unavailable adapter returns a safe not-configured error response", async () => {
  const originalEnv = snapshotEnv();
  let result;
  try {
    delete process.env.DATA_INTELLIGENCE_V2_OPENAI_ENABLED;
    delete process.env.DATA_INTELLIGENCE_V2_OPENAI_API_KEY;
    delete process.env.OPENAI_API_KEY;
    delete process.env.DATA_INTELLIGENCE_V2_MODEL;
    delete process.env.DATA_INTELLIGENCE_MODEL;
    resetDataIntelligenceV2ServiceFactoryForTests();
    result = await runV2ChatTurn({
      userMessage: "Can you help with a transfer?",
      authContext,
    });
  } finally {
    restoreEnv(originalEnv);
    resetDataIntelligenceV2ServiceFactoryForTests();
  }

  assert.equal(result.status, "error");
  assert.equal(result.response.responseType, "error");
  assert.match(result.response.answerMarkdown, /not configured/i);
  assertNoRawSensitiveContent(result);
});

test("model input sanitization removes visible-history and current-message sensitive values", async () => {
  const adapter = new ScriptedModelAdapter([
    finalResponse(
      safeResponse({
        responseType: "general_guidance",
        answerMarkdown: "I can help once we use structured tools.",
      }),
    ),
  ]);

  const result = await runV2ToolLoop({
    userMessage: `Please remember SSN ${RAW_SSN}.`,
    visibleHistory: [
      {
        role: "user",
        content: `SSN ${RAW_SSN}, account ${RAW_ACCOUNT}, email ${RAW_EMAIL}, phone ${RAW_PHONE}, DOB is ${RAW_DOB}, address ${RAW_ADDRESS}`,
      },
    ],
    safeConversationState: {
      missingItems: [
        {
          item: "contact",
          reason: `Email ${RAW_EMAIL} was pasted by user.`,
        },
      ],
    },
    authContext,
    modelAdapter: adapter,
  });

  assert.equal(adapter.requests.length, 1);
  assertNoRawSensitiveContent(adapter.requests[0].messages);
  assertNoRawSensitiveContent(adapter.requests[0].safeConversationState);
  assertNoRawSensitiveContent(result.modelMessagesSent);
});

test("tool loop resolves a client and account records without leaking unsafe gateway fields", async () => {
  const adapter = new ScriptedModelAdapter([
    toolCalls([
      {
        callId: "call_resolve",
        toolName: "resolve_client",
        args: { query: "John Smith" },
      },
      {
        callId: "call_accounts",
        toolName: "get_accounts",
        args: { clientId: "client_1" },
      },
    ]),
    finalResponse(
      safeResponse({
        responseType: "client_data_answer",
        answerMarkdown:
          "John Smith has a Schwab brokerage account ending in 3456.",
        sourceBackedFacts: [
          {
            fact: "Schwab brokerage account ending in 3456 is available.",
            sourceRefs: [sourceRef("Account record")],
            confidence: "high",
          },
        ],
        recommendedSteps: ["Use the secure reveal flow if the full account number is needed."],
      }),
    ),
  ]);

  const result = await runV2ToolLoop({
    userMessage: "Find John Smith accounts.",
    authContext,
    modelAdapter: adapter,
    dataGateway: makeGateway({
      resolveClient: async () => ({
        candidates: [
          {
            clientId: "client_1",
            displayName: "John Smith",
            sourceRefs: [sourceRef("Client record")],
          },
        ],
        sourceRefs: [sourceRef("Client record")],
        missing: [],
      }),
      getAccounts: async () => ({
        accounts: [
          {
            accountId: "account_1",
            label: "Schwab brokerage",
            custodian: "Schwab",
            accountType: "brokerage",
            fullAccountNumber: RAW_ACCOUNT,
            accountNumber: RAW_ACCOUNT,
            accountLast4: "3456",
            maskedAccountNumber: "****3456",
            sourceFileId: RAW_SOURCE_FILE_ID,
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

  assert.deepEqual(
    result.toolResults.map((toolResult) => toolResult.status),
    ["success", "success"],
  );
  assert.equal(result.response.responseType, "client_data_answer");
  assert.match(result.response.answerMarkdown, /3456/);
  assert.equal(serialized.includes(RAW_ACCOUNT), false);
  assert.equal(serialized.includes(RAW_SOURCE_FILE_ID), false);
  assert.match(serialized, /3456/);
  assert.equal(result.nextConversationState.activeClientId, "client_1");
  assert.equal(result.nextConversationState.lastMentionedAccounts[0].last4, "3456");
  assertNoRawSensitiveContent(result);
});

test("tool loop merges secure reveal cards from tool results into final response", async () => {
  const adapter = new ScriptedModelAdapter([
    toolCalls([
      {
        callId: "call_reveal",
        toolName: "create_sensitive_reveal",
        args: {
          clientId: "client_1",
          accountId: "account_1",
          fieldKey: "account.fullAccountNumber",
          purpose: "form_completion",
        },
      },
    ]),
    finalResponse(
      safeResponse({
        responseType: "task_assist",
        answerMarkdown:
          "A secure reveal card is available for the full account number.",
      }),
    ),
  ]);

  const result = await runV2ToolLoop({
    userMessage: "Show the full account number.",
    authContext,
    modelAdapter: adapter,
    revealTokenService: makeRevealService({
      provider: new FakeSensitiveValueProvider({
        statuses: {
          "account.fullAccountNumber": {
            status: "on_file",
            fieldLabel: "Full account number",
            label: "Account number",
            maskedValue: "****3456",
          },
        },
        rawValues: {
          "account.fullAccountNumber": RAW_ACCOUNT,
        },
      }),
    }),
  });

  assert.equal(result.response.secureRevealCards.length, 1);
  assert.equal(
    result.response.secureRevealCards[0].actualValueWasNotShownToModel,
    true,
  );
  assert.equal(
    result.nextConversationState.lastSensitiveReveals[0].field,
    "full_account_number",
  );
  assert.equal(JSON.stringify(result).includes(RAW_ACCOUNT), false);
});

test("missing data from tools is preserved without implying it exists", async () => {
  const adapter = new ScriptedModelAdapter([
    toolCalls([
      {
        callId: "call_statement",
        toolName: "get_latest_statements",
        args: { clientId: "client_1", maxAgeDays: 365 },
      },
    ]),
    finalResponse(
      safeResponse({
        responseType: "missing_data",
        answerMarkdown:
          "I checked latest statement records and did not find a matching statement.",
        missingOrUnverified: [
          {
            item: "latest statement",
            checked: ["latest statement records"],
            reason: "No matching latest statement was found.",
          },
        ],
      }),
    ),
  ]);

  const result = await runV2ToolLoop({
    userMessage: "Do we have the latest statement?",
    authContext,
    modelAdapter: adapter,
    dataGateway: makeGateway({
      getLatestStatements: async () => ({
        statements: [],
        sourceRefs: [],
        missing: [
          {
            item: "latest statement",
            checked: ["latest statement records"],
            reason: "No matching latest statement was found.",
          },
        ],
      }),
    }),
  });

  assert.equal(result.response.responseType, "missing_data");
  assert.match(result.response.answerMarkdown, /did not find/i);
  assert.equal(result.nextConversationState.missingItems[0].item, "latest statement");
  assertNoRawSensitiveContent(result);
});

test("missing tool results normalize client-data responses to missing_data", async () => {
  const adapter = new ScriptedModelAdapter([
    toolCalls([
      {
        callId: "call_statement",
        toolName: "get_latest_statements",
        args: { clientId: "client_1" },
      },
    ]),
    finalResponse(
      safeResponse({
        responseType: "client_data_answer",
        answerMarkdown:
          "I checked statement records and did not find a matching statement.",
      }),
    ),
  ]);

  const result = await runV2ToolLoop({
    userMessage: "Do we have the latest statement?",
    authContext,
    modelAdapter: adapter,
    dataGateway: makeGateway({
      getLatestStatements: async () => ({
        statements: [],
        sourceRefs: [],
        missing: [
          {
            item: "latest statement",
            checked: ["latest statement records"],
            reason: "No matching latest statement was found.",
          },
        ],
      }),
    }),
  });

  assert.equal(result.response.responseType, "missing_data");
  assert.equal(result.response.missingOrUnverified[0].item, "latest statement");
  assert.equal(result.response.draftNote, undefined);
  assertNoRawSensitiveContent(result);
});

test("workflow tool results normalize to task_assist and add a safe draft note", async () => {
  const adapter = new ScriptedModelAdapter([
    toolCalls([
      {
        callId: "call_workflow",
        toolName: "check_workflow_requirements",
        args: { clientId: "client_1", workflowType: "transfer" },
      },
    ]),
    finalResponse(
      safeResponse({
        responseType: "general_guidance",
        answerMarkdown:
          "I checked transfer requirements and found next steps.",
      }),
    ),
  ]);

  const result = await runV2ToolLoop({
    userMessage: "Advisor task: check transfer requirements.",
    authContext,
    modelAdapter: adapter,
    dataGateway: makeGateway({
      checkWorkflowRequirements: async () => ({
        workflowType: "transfer",
        requirements: [
          {
            requirementId: "latest_statement",
            label: "Latest statement",
            status: "available",
            checked: ["statement records"],
            summary: "Latest statement metadata is available.",
            sourceRefs: [sourceRef("Statement record")],
          },
        ],
        sourceRefs: [sourceRef("Workflow record")],
        missing: [],
      }),
    }),
  });

  assert.equal(result.response.responseType, "task_assist");
  assert.equal(result.response.draftNote.audience, "advisor");
  assert.match(result.response.draftNote.bodyMarkdown, /workflow/i);
  assertNoRawSensitiveContent(result.response.draftNote);
});

test("workflow missing items stay task_assist while non-workflow answers do not get draft notes", async () => {
  const workflowAdapter = new ScriptedModelAdapter([
    toolCalls([
      {
        callId: "call_workflow",
        toolName: "check_workflow_requirements",
        args: { clientId: "client_1", workflowType: "rollover" },
      },
    ]),
    finalResponse(
      safeResponse({
        responseType: "missing_data",
        answerMarkdown:
          "I checked rollover requirements and found missing items.",
      }),
    ),
  ]);

  const workflowResult = await runV2ToolLoop({
    userMessage: "Advisor task: help with rollover prep.",
    authContext,
    modelAdapter: workflowAdapter,
    dataGateway: makeGateway({
      checkWorkflowRequirements: async () => ({
        workflowType: "rollover",
        requirements: [
          {
            requirementId: "distribution_form",
            label: "Distribution form",
            status: "missing",
            checked: ["workflow records"],
            summary: "Distribution form is not on file.",
            sourceRefs: [sourceRef("Workflow record")],
          },
        ],
        sourceRefs: [sourceRef("Workflow record")],
        missing: [
          {
            item: "distribution form",
            checked: ["workflow records"],
            reason: "Distribution form is not on file.",
          },
        ],
      }),
    }),
  });

  assert.equal(workflowResult.response.responseType, "task_assist");
  assert.ok(workflowResult.response.draftNote);
  assert.match(workflowResult.response.draftNote.bodyMarkdown, /missing/i);

  const accountAdapter = new ScriptedModelAdapter([
    toolCalls([
      {
        callId: "call_accounts",
        toolName: "get_accounts",
        args: { clientId: "client_1" },
      },
    ]),
    finalResponse(
      safeResponse({
        responseType: "client_data_answer",
        answerMarkdown: "I found account metadata.",
      }),
    ),
  ]);
  const accountResult = await runV2ToolLoop({
    userMessage: "What accounts are available?",
    authContext,
    modelAdapter: accountAdapter,
    dataGateway: makeGateway({
      getAccounts: async () => ({
        accounts: [
          {
            accountId: "account_1",
            label: "Schwab brokerage",
            custodian: "Schwab",
            accountType: "brokerage",
            accountLast4: "3456",
            maskedAccountNumber: "****3456",
            sourceRefs: [sourceRef("Account record")],
          },
        ],
        sourceRefs: [sourceRef("Account record")],
        missing: [],
      }),
    }),
  });

  assert.equal(accountResult.response.responseType, "client_data_answer");
  assert.equal(accountResult.response.draftNote, undefined);
  assertNoRawSensitiveContent(workflowResult);
  assertNoRawSensitiveContent(accountResult);
});

test("workflow normalization preserves clarification responses", async () => {
  const adapter = new ScriptedModelAdapter([
    toolCalls([
      {
        callId: "call_workflow",
        toolName: "check_workflow_requirements",
        args: { clientId: "client_1", workflowType: "transfer" },
      },
    ]),
    finalResponse(
      safeResponse({
        responseType: "clarification_needed",
        answerMarkdown: "Which transfer workflow should I use?",
      }),
    ),
  ]);

  const result = await runV2ToolLoop({
    userMessage: "Check transfer requirements.",
    authContext,
    modelAdapter: adapter,
    dataGateway: makeGateway({
      checkWorkflowRequirements: async () => ({
        workflowType: "transfer",
        requirements: [
          {
            requirementId: "transfer_form",
            label: "Transfer form",
            status: "unknown",
            checked: ["workflow records"],
            summary: "Transfer form status needs confirmation.",
            sourceRefs: [sourceRef("Workflow record")],
          },
        ],
        sourceRefs: [sourceRef("Workflow record")],
        missing: [],
      }),
    }),
  });

  assert.equal(result.response.responseType, "clarification_needed");
  assert.equal(result.response.draftNote, undefined);
  assertNoRawSensitiveContent(result);
});

test("malicious final model response with raw sensitive values becomes safe error", async () => {
  const adapter = new ScriptedModelAdapter([
    finalResponse(
      safeResponse({
        responseType: "client_data_answer",
        answerMarkdown: `The SSN is ${RAW_SSN}.`,
        draftNote: {
          audience: "advisor",
          bodyMarkdown: `Use account ${RAW_ACCOUNT}.`,
          containsSensitivePlaceholders: false,
        },
      }),
    ),
  ]);

  const result = await runV2ChatTurn({
    userMessage: "Draft the note.",
    authContext,
    modelAdapter: adapter,
  });

  assert.equal(result.response.responseType, "error");
  assertNoRawSensitiveContent(result);
});

test("malicious model tool args cannot override owner scope", async () => {
  const seenOwnerEmails = [];
  const adapter = new ScriptedModelAdapter([
    toolCalls([
      {
        callId: "call_malicious",
        toolName: "get_accounts",
        args: {
          clientId: "client_1",
          ownerEmail: "attacker@example.test",
          userEmail: "attacker@example.test",
          role: "admin",
          allowSensitiveReveal: true,
        },
      },
      {
        callId: "call_valid",
        toolName: "get_accounts",
        args: { clientId: "client_1" },
      },
    ]),
    finalResponse(
      safeResponse({
        responseType: "client_data_answer",
        answerMarkdown: "I used only authorized owner-scoped records.",
      }),
    ),
  ]);

  const result = await runV2ToolLoop({
    userMessage: "Get accounts.",
    authContext,
    modelAdapter: adapter,
    dataGateway: makeGateway({
      getAccounts: async (args) => {
        seenOwnerEmails.push(args.ownerEmail);
        return {
          accounts: [
            {
              accountId: "account_1",
              label: "Schwab brokerage",
              custodian: "Schwab",
              accountType: "brokerage",
              accountLast4: "3456",
              maskedAccountNumber: "****3456",
              sourceRefs: [sourceRef("Account record")],
            },
          ],
          sourceRefs: [sourceRef("Account record")],
          missing: [],
        };
      },
    }),
  });

  assert.equal(result.toolResults[0].status, "error");
  assert.deepEqual(seenOwnerEmails, ["owner@example.test"]);
  assert.equal(JSON.stringify(result).includes("attacker@example.test"), false);
});

test("invalid tool names and invalid args return safe tool errors", async () => {
  const adapter = new ScriptedModelAdapter([
    toolCalls([
      {
        callId: "call_invalid_name",
        toolName: "not_a_tool",
        args: {},
      },
      {
        callId: "call_missing_args",
        toolName: "get_accounts",
        args: {},
      },
    ]),
    finalResponse(
      safeResponse({
        responseType: "error",
        answerMarkdown: "I could not use the requested tool calls safely.",
      }),
    ),
  ]);

  const result = await runV2ToolLoop({
    userMessage: "Use bad tools.",
    authContext,
    modelAdapter: adapter,
  });

  assert.deepEqual(
    result.toolResults.map((toolResult) => toolResult.status),
    ["error", "error"],
  );
  assertNoRawSensitiveContent(result);
});

test("max tool iteration protection returns a safe error response", async () => {
  const adapter = {
    requests: [],
    async run(request) {
      this.requests.push(request);
      return toolCalls([
        {
          callId: `call_${request.iteration}`,
          toolName: "resolve_client",
          args: { query: "John Smith" },
        },
      ]);
    },
  };

  const result = await runV2ToolLoop({
    userMessage: "Keep searching.",
    authContext,
    modelAdapter: adapter,
    dataGateway: makeGateway(),
    maxToolIterations: 2,
  });

  assert.equal(result.response.responseType, "error");
  assert.match(result.response.answerMarkdown, /tool limit/i);
  assert.ok(adapter.requests.length >= 3);
  assertNoRawSensitiveContent(result);
});

test("conversation state derivation tracks safe context and bounds arrays", async () => {
  const revealService = makeRevealService({
    provider: new FakeSensitiveValueProvider({
      statuses: {
        "account.fullAccountNumber": {
          status: "on_file",
          fieldLabel: "Full account number",
          label: "Account number",
          maskedValue: "****3456",
        },
      },
      rawValues: {
        "account.fullAccountNumber": RAW_ACCOUNT,
      },
    }),
  });
  const adapter = new ScriptedModelAdapter([
    toolCalls([
      {
        callId: "call_resolve",
        toolName: "resolve_client",
        args: { query: "John Smith" },
      },
      {
        callId: "call_accounts",
        toolName: "get_accounts",
        args: { clientId: "client_1" },
      },
      {
        callId: "call_tax",
        toolName: "get_tax_documents",
        args: { clientId: "client_1", taxYear: 2024 },
      },
      {
        callId: "call_missing_statement",
        toolName: "get_latest_statements",
        args: { clientId: "client_1" },
      },
      {
        callId: "call_reveal",
        toolName: "create_sensitive_reveal",
        args: {
          clientId: "client_1",
          accountId: "account_1",
          fieldKey: "account.fullAccountNumber",
          purpose: "advisor_task",
        },
      },
    ]),
    finalResponse(
      safeResponse({
        responseType: "task_assist",
        answerMarkdown: "I found safe client, account, tax, and reveal metadata.",
      }),
    ),
  ]);

  const result = await runV2ToolLoop({
    userMessage: "Prep the client packet.",
    authContext,
    modelAdapter: adapter,
    dataGateway: makeGateway({
      resolveClient: async () => ({
        candidates: [
          {
            clientId: "client_1",
            displayName: "John Smith",
            sourceRefs: [sourceRef("Client record")],
          },
        ],
        sourceRefs: [sourceRef("Client record")],
        missing: [],
      }),
      getAccounts: async () => ({
        accounts: [
          {
            accountId: "account_1",
            label: "Schwab brokerage",
            custodian: "Schwab",
            accountType: "brokerage",
            accountLast4: "3456",
            maskedAccountNumber: "****3456",
            sourceRefs: [sourceRef("Account record")],
          },
        ],
        sourceRefs: [sourceRef("Account record")],
        missing: [],
      }),
      getTaxDocuments: async () => ({
        taxDocuments: [
          {
            documentId: "tax_doc_1",
            label: "2024 1099",
            taxYear: 2024,
            formType: "1099",
            status: "available",
            sourceRefs: [sourceRef("2024 1099", "tax_doc_1", "tax_record")],
          },
        ],
        sourceRefs: [sourceRef("2024 1099", "tax_doc_1", "tax_record")],
        missing: [],
      }),
      getLatestStatements: async () => ({
        statements: [],
        sourceRefs: [],
        missing: [
          {
            item: "latest statement",
            checked: ["latest statement records"],
            reason: "No latest statement was found.",
          },
        ],
      }),
    }),
    revealTokenService: revealService,
    safeConversationState: {
      lastMentionedAccounts: Array.from({ length: 12 }, (_, index) => ({
        accountId: `old_account_${index}`,
        label: `Old account ${index} ${RAW_EMAIL}`,
      })),
    },
  });

  assert.equal(result.nextConversationState.activeClientId, "client_1");
  assert.equal(result.nextConversationState.lastMentionedAccounts.length <= 8, true);
  assert.equal(result.nextConversationState.lastMentionedDocuments[0].documentId, "tax_doc_1");
  assert.equal(result.nextConversationState.lastSensitiveReveals[0].field, "full_account_number");
  assert.equal(result.nextConversationState.missingItems[0].item, "latest statement");
  assertNoRawSensitiveContent(result.nextConversationState);

  const sanitizedState = sanitizeSafeConversationState({
    lastMentionedAccounts: Array.from({ length: 12 }, (_, index) => ({
      accountId: `account_${index}`,
      label: `Account ${index} ${RAW_EMAIL}`,
    })),
  });
  assert.equal(sanitizedState.lastMentionedAccounts.length, 8);
  assertNoRawSensitiveContent(sanitizedState);
});

test("pure chat handler validates requests and returns safe no-cache responses", async () => {
  const adapter = new ScriptedModelAdapter([
    finalResponse(
      safeResponse({
        responseType: "general_guidance",
        answerMarkdown: "Use structured tools for client-specific facts.",
      }),
    ),
  ]);

  const disabled = await handleV2ChatApiRequest({
    requestBody: { message: "hello" },
    authContext,
    config: { ...enabledConfig, enabled: false },
    modelAdapter: adapter,
  });
  assert.equal(disabled.status, 404);

  const unauthorized = await handleV2ChatApiRequest({
    requestBody: { message: "hello" },
    authContext: null,
    config: enabledConfig,
    modelAdapter: adapter,
  });
  assert.equal(unauthorized.status, 401);

  const chatDisabled = await handleV2ChatApiRequest({
    requestBody: { message: "hello" },
    authContext,
    config: { ...enabledConfig, chatApiEnabled: false },
    modelAdapter: adapter,
  });
  assert.equal(chatDisabled.status, 404);

  const invalidBody = await handleV2ChatApiRequest({
    requestBody: null,
    authContext,
    config: enabledConfig,
    modelAdapter: adapter,
  });
  assert.equal(invalidBody.status, 400);

  const missingMessage = await handleV2ChatApiRequest({
    requestBody: { history: [] },
    authContext,
    config: enabledConfig,
    modelAdapter: adapter,
  });
  assert.equal(missingMessage.status, 400);

  const success = await handleV2ChatApiRequest({
    requestBody: {
      message: "What can you do?",
      history: [],
      conversationState: {},
    },
    authContext,
    config: enabledConfig,
    modelAdapter: new ScriptedModelAdapter([
      finalResponse(
        safeResponse({
          responseType: "general_guidance",
          answerMarkdown: "Use structured tools for client-specific facts.",
        }),
      ),
    ]),
  });

  assert.equal(success.status, 200);
  assert.equal(success.headers["Cache-Control"], "no-store");
  assert.equal(success.body.status, "success");
  assertNoRawSensitiveContent(success);
});

test("direct state derivation helper accepts safe tool results", () => {
  const state = deriveSafeConversationStateFromToolResults({
    toolResults: [
      createToolResult({
        toolName: "resolve_client",
        status: "success",
        summary: "Resolved client.",
        facts: [
          {
            factId: "client:client_1:id",
            fieldKey: "client.id",
            label: "Client ID",
            value: "client_1",
            displayValue: "client_1",
            sourceRefs: [],
            confidence: "high",
          },
          {
            factId: "client:client_1:name",
            fieldKey: "client.name",
            label: "Client name",
            value: "John Smith",
            displayValue: "John Smith",
            sourceRefs: [],
            confidence: "high",
          },
        ],
      }),
    ],
  });

  assert.equal(state.activeClientId, "client_1");
  assert.equal(state.lastResolvedClients[0].displayName, "John Smith");
});

function safeResponse(overrides = {}) {
  return {
    responseType: "general_guidance",
    answerMarkdown: "I can help with that.",
    sourceBackedFacts: [],
    missingOrUnverified: [],
    recommendedSteps: [],
    secureRevealCards: [],
    followupSuggestions: [],
    ...overrides,
  };
}

function toolCalls(toolCalls) {
  return {
    type: "tool_calls",
    toolCalls,
  };
}

function finalResponse(response) {
  return {
    type: "final_response",
    response,
  };
}

class ScriptedModelAdapter {
  constructor(responses) {
    this.responses = responses;
    this.requests = [];
  }

  async run(request) {
    this.requests.push(request);
    const response = this.responses.shift();
    if (typeof response === "function") {
      return response(request);
    }

    return (
      response ??
      finalResponse(
        safeResponse({
          responseType: "error",
          answerMarkdown: "No scripted model response was available.",
        }),
      )
    );
  }
}

function makeGateway(overrides = {}) {
  return {
    async resolveClient(args) {
      if (overrides.resolveClient) {
        return overrides.resolveClient(args);
      }

      return {
        candidates: [
          {
            clientId: "client_1",
            displayName: "John Smith",
            sourceRefs: [sourceRef("Client record")],
          },
        ],
        sourceRefs: [sourceRef("Client record")],
        missing: [],
      };
    },
    async getAccounts(args) {
      if (overrides.getAccounts) {
        return overrides.getAccounts(args);
      }

      return {
        accounts: [],
        sourceRefs: [],
        missing: [
          {
            item: "account",
            checked: ["account records"],
            reason: "No matching account was found.",
          },
        ],
      };
    },
    async getLatestStatements(args) {
      if (overrides.getLatestStatements) {
        return overrides.getLatestStatements(args);
      }

      return {
        statements: [],
        sourceRefs: [],
        missing: [
          {
            item: "latest statement",
            checked: ["latest statement records"],
            reason: "No latest statement was found.",
          },
        ],
      };
    },
    async getTaxDocuments(args) {
      if (overrides.getTaxDocuments) {
        return overrides.getTaxDocuments(args);
      }

      return {
        taxDocuments: [],
        sourceRefs: [],
        missing: [],
      };
    },
    async getIdentityStatus(args) {
      if (overrides.getIdentityStatus) {
        return overrides.getIdentityStatus(args);
      }

      return {
        statuses: [],
        sourceRefs: [],
        missing: [],
      };
    },
    async checkWorkflowRequirements(args) {
      if (overrides.checkWorkflowRequirements) {
        return overrides.checkWorkflowRequirements(args);
      }

      return {
        workflowType: args.workflowType,
        requirements: [],
        sourceRefs: [],
        missing: [],
      };
    },
  };
}

function makeRevealService({
  provider = new FakeSensitiveValueProvider({
    statuses: {
      "account.fullAccountNumber": {
        status: "on_file",
        fieldLabel: "Full account number",
        label: "Account number",
        maskedValue: "****3456",
      },
    },
    rawValues: {
      "account.fullAccountNumber": RAW_ACCOUNT,
    },
  }),
} = {}) {
  return new RevealTokenService({
    store: new InMemoryRevealTokenStore(),
    sensitiveValueProvider: provider,
    auditSink: new InMemoryRevealAuditSink(),
  });
}

class FakeSensitiveValueProvider {
  constructor({ statuses = {}, rawValues = {} } = {}) {
    this.statuses = statuses;
    this.rawValues = rawValues;
  }

  async getSensitiveValueStatus(args) {
    return (
      this.statuses[args.fieldKey] ?? {
        status: "not_found",
        fieldLabel: args.fieldKey,
        label: args.fieldKey,
      }
    );
  }

  async revealSensitiveValue(args) {
    const status = this.statuses[args.fieldKey];
    const value = this.rawValues[args.fieldKey];
    if (!status || !value) {
      return {
        status: "not_found",
        fieldLabel: args.fieldKey,
        label: args.fieldKey,
      };
    }

    return {
      status: "success",
      fieldLabel: status.fieldLabel,
      label: status.label,
      value,
    };
  }
}

function sourceRef(
  label,
  documentId = "doc_1",
  sourceType = "account_record",
) {
  return {
    sourceId: `source_${documentId}`,
    sourceType,
    label,
    documentId,
    date: "2024-12-31",
    confidence: "high",
  };
}

function snapshotEnv() {
  return { ...process.env };
}

function restoreEnv(snapshot) {
  for (const key of Object.keys(process.env)) {
    if (!(key in snapshot)) {
      delete process.env[key];
    }
  }

  for (const [key, value] of Object.entries(snapshot)) {
    process.env[key] = value;
  }
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
    "attacker@example.test",
  ]) {
    assert.equal(
      serialized.includes(rawValue),
      false,
      `Expected payload not to include ${rawValue}`,
    );
  }
}

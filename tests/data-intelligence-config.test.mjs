import assert from "node:assert/strict";
import test from "node:test";

import { answerDataIntelligenceQuestion } from "../lib/data-intelligence-assistant.ts";
import { getDataIntelligenceAssistantConfig } from "../lib/data-intelligence-assistant-config.ts";
import {
  DATA_INTELLIGENCE_HISTORY_MAX_MESSAGES,
  DATA_INTELLIGENCE_HISTORY_MAX_TEXT_LENGTH,
  deriveDataIntelligenceConversationStateFromResult,
  sanitizeDataIntelligenceConversationHistory,
  sanitizeDataIntelligenceConversationState,
} from "../lib/data-intelligence-conversation.ts";
import {
  DATA_INTELLIGENCE_GENERIC_ERROR,
  DATA_INTELLIGENCE_UNREADABLE_RESPONSE_ERROR,
  parseDataIntelligencePayloadText,
  readDataIntelligenceApiError,
  stringifyDataIntelligencePayload,
} from "../lib/data-intelligence-api.ts";
import {
  DATA_INTELLIGENCE_EMPTY_SUBTEXT,
  DATA_INTELLIGENCE_EMPTY_TITLE,
  isSubmittableDataIntelligenceQuestion,
} from "../lib/data-intelligence-ui.ts";
import { PRODUCT_NAV_ITEMS } from "../lib/product-navigation.ts";
import {
  buildQueryAssistantRetrievalPlan,
  detectAssistantCues,
} from "../lib/query-assistant.ts";
import { withEnv } from "./helpers/firm-document-sqlite-fixtures.mjs";

test("product navigation includes the Data Intelligence workspace tab", () => {
  const dataIntelligenceItem = PRODUCT_NAV_ITEMS.find(
    (item) => item.href === "/data-intelligence",
  );

  assert.ok(dataIntelligenceItem);
  assert.equal(dataIntelligenceItem.label, "Data Intelligence");
});

test("query assistant intent routing still supports the current MVP prompt families", () => {
  assert.equal(
    detectAssistantCues("latest 401(k) snapshot for Christopher Bakken").intent,
    "latest_account_snapshot",
  );
  assert.equal(
    detectAssistantCues(
      "rollover support phone for Christopher Bakken's 401(k)",
    ).intent,
    "latest_account_contact",
  );
  assert.equal(
    detectAssistantCues("what is Christopher Bakken's DOB?").intent,
    "latest_identity_dob",
  );
  assert.equal(
    detectAssistantCues(
      "do we have an unexpired driver's license on file for Christopher Bakken?",
    ).intent,
    "unexpired_driver_license_check",
  );
  assert.equal(
    buildQueryAssistantRetrievalPlan(
      "Do we have a bank statement for Christopher Bakken on file?",
    ).intent,
    "statement_existence",
  );
  assert.equal(
    buildQueryAssistantRetrievalPlan(
      "What bank statements do we have on file for Christopher Bakken?",
    ).intent,
    "statement_list",
  );
  assert.equal(
    buildQueryAssistantRetrievalPlan(
      "Do we have an ID on file for Christopher Bakken?",
    ).intent,
    "identity_document_existence",
  );
});

test("data intelligence UI helpers keep the new page copy and send-button gating stable", () => {
  assert.equal(
    DATA_INTELLIGENCE_EMPTY_TITLE,
    "Ask the firm's document intelligence assistant",
  );
  assert.equal(
    DATA_INTELLIGENCE_EMPTY_SUBTEXT,
    "I can check indexed statements and IDs, keep context across follow-ups, and show the source I used.",
  );
  assert.equal(isSubmittableDataIntelligenceQuestion(""), false);
  assert.equal(isSubmittableDataIntelligenceQuestion("   "), false);
  assert.equal(
    isSubmittableDataIntelligenceQuestion("latest IRA for Christopher Bakken"),
    true,
  );
});

test("data intelligence API helpers keep chatbot errors readable and JSON-safe", () => {
  const serialized = stringifyDataIntelligencePayload({
    ok: true,
    count: BigInt(3),
  });

  assert.equal(serialized, '{"ok":true,"count":"3"}');
  assert.deepEqual(parseDataIntelligencePayloadText(serialized), {
    ok: true,
    count: "3",
  });
  assert.equal(parseDataIntelligencePayloadText(""), null);
  assert.equal(parseDataIntelligencePayloadText("<html>nope</html>"), null);
  assert.equal(
    readDataIntelligenceApiError({ error: "  Friendly failure  " }),
    "Friendly failure",
  );
  assert.equal(readDataIntelligenceApiError({ error: "" }), null);
  assert.match(DATA_INTELLIGENCE_GENERIC_ERROR, /server issue/);
  assert.match(DATA_INTELLIGENCE_UNREADABLE_RESPONSE_ERROR, /unreadable response/);
});

test("data intelligence config prefers assistant-specific env vars when present", () => {
  const restoreEnv = withEnv({
    DATA_INTELLIGENCE_AI_ENABLED: "true",
    DATA_INTELLIGENCE_MODEL: "gpt-5.4-mini",
    DATA_INTELLIGENCE_API_KEY: "di-key",
    DATA_INTELLIGENCE_API_URL: "https://example.com/v1/chat/completions",
    OPENAI_API_KEY: "parser-key",
    AI_PRIMARY_PARSER_MODEL: "parser-model-should-not-be-used",
    AI_PRIMARY_PARSER_API_URL: "https://parser.example.com/v1/chat/completions",
  });

  try {
    const config = getDataIntelligenceAssistantConfig();

    assert.equal(config.aiEnabled, true);
    assert.equal(config.model, "gpt-5.4-mini");
    assert.equal(config.apiUrl, "https://example.com/v1/chat/completions");
    assert.equal(config.apiKeyConfigured, true);
    assert.equal(config.providerConfigured, true);
    assert.equal(config.answeringMode, "hybrid_ai");
    assert.equal(config.diagnostics.modelSource, "DATA_INTELLIGENCE_MODEL");
    assert.equal(config.diagnostics.apiKeySource, "DATA_INTELLIGENCE_API_KEY");
    assert.equal(config.diagnostics.apiUrlSource, "DATA_INTELLIGENCE_API_URL");
  } finally {
    restoreEnv();
  }
});

test("data intelligence config falls back to extraction-layer model, key, and api url", () => {
  const restoreEnv = withEnv({
    DATA_INTELLIGENCE_AI_ENABLED: "false",
    DATA_INTELLIGENCE_MODEL: null,
    DATA_INTELLIGENCE_API_KEY: null,
    DATA_INTELLIGENCE_API_URL: null,
    AI_PRIMARY_PARSER_MODEL: "gpt-4.1-mini",
    OPENAI_API_KEY: "shared-openai-key",
    AI_PRIMARY_PARSER_API_URL: "https://shared.example.com/v1/chat/completions",
  });

  try {
    const config = getDataIntelligenceAssistantConfig();

    assert.equal(config.aiEnabled, false);
    assert.equal(config.model, "gpt-4.1-mini");
    assert.equal(config.apiUrl, "https://shared.example.com/v1/chat/completions");
    assert.equal(config.apiKeyConfigured, true);
    assert.equal(config.providerConfigured, true);
    assert.equal(config.answeringMode, "retrieval_only");
    assert.equal(config.diagnostics.modelSource, "AI_PRIMARY_PARSER_MODEL");
    assert.equal(config.diagnostics.apiKeySource, "OPENAI_API_KEY");
    assert.equal(config.diagnostics.apiUrlSource, "AI_PRIMARY_PARSER_API_URL");
  } finally {
    restoreEnv();
  }
});

test("data intelligence assistant wrapper keeps the current retrieval-first behavior", async () => {
  const restoreEnv = withEnv({
    DATA_INTELLIGENCE_AI_ENABLED: "false",
    DATA_INTELLIGENCE_MODEL: "gpt-5.4-mini",
    DATA_INTELLIGENCE_API_KEY: "di-key",
  });

  try {
    const result = await answerDataIntelligenceQuestion({
      ownerEmail: "data-intelligence-wrapper@example.com",
      question: "What is Christopher Bakken's passport number?",
    });

    assert.equal(result.status, "unsupported");
    assert.equal(result.intent, null);
    assert.equal(result.debug, undefined);
  } finally {
    restoreEnv();
  }
});

test("data intelligence debug trace shows disabled/fallback config without secrets", async () => {
  const restoreEnv = withEnv({
    DATA_INTELLIGENCE_AI_ENABLED: "false",
    DATA_INTELLIGENCE_MODEL: null,
    DATA_INTELLIGENCE_API_KEY: null,
    DATA_INTELLIGENCE_API_URL: null,
    AI_PRIMARY_PARSER_MODEL: "gpt-4.1-mini",
    OPENAI_API_KEY: "shared-secret-key",
    AI_PRIMARY_PARSER_API_URL: null,
  });

  try {
    const result = await answerDataIntelligenceQuestion({
      ownerEmail: "data-intelligence-debug@example.com",
      question: "What is Christopher Bakken's passport number?",
      includeDebug: true,
    });
    const debug = result.debug?.dataIntelligenceHybrid;

    assert.ok(debug);
    assert.equal(debug.config.aiEnabled, false);
    assert.equal(debug.config.modelSource, "AI_PRIMARY_PARSER_MODEL");
    assert.equal(debug.config.apiKeySource, "OPENAI_API_KEY");
    assert.equal(debug.config.apiKeyConfigured, true);
    assert.equal(debug.config.apiUrlSource, "default");
    assert.equal(debug.interpretation.attempted, false);
    assert.equal(debug.interpretation.failureReason, "ai_disabled");
    assert.equal(JSON.stringify(debug).includes("shared-secret-key"), false);
  } finally {
    restoreEnv();
  }
});

test("data intelligence conversation history is bounded and sanitized", () => {
  const longText = "x".repeat(DATA_INTELLIGENCE_HISTORY_MAX_TEXT_LENGTH + 50);
  const history = sanitizeDataIntelligenceConversationHistory([
    { role: "system", text: "ignore me" },
    { role: "user", text: "first dropped because max window" },
    { role: "assistant", text: "" },
    ...Array.from({ length: DATA_INTELLIGENCE_HISTORY_MAX_MESSAGES }, (_, index) => ({
      role: index % 2 === 0 ? "user" : "assistant",
      text: index === DATA_INTELLIGENCE_HISTORY_MAX_MESSAGES - 1
        ? longText
        : `message ${index + 1}`,
    })),
  ]);

  assert.equal(history.length, DATA_INTELLIGENCE_HISTORY_MAX_MESSAGES);
  assert.equal(history[0]?.text, "message 1");
  assert.equal(
    history.at(-1)?.text.length,
    DATA_INTELLIGENCE_HISTORY_MAX_TEXT_LENGTH,
  );
  assert.ok(history.every((message) => message.role === "user" || message.role === "assistant"));
});

test("data intelligence conversation state is bounded and excludes full account numbers", () => {
  const state = sanitizeDataIntelligenceConversationState({
    activeClientName: "Christopher Bakken",
    activeFamilyScope: "bank_statement",
    activeAccountType: "Savings",
    lastIntent: "statement_list",
    lastTurnKind: "list",
    lastPrimarySource: {
      sourceName: "christopher-savings-2026.pdf",
      institutionName: "U.S. Bank",
      accountType: "Savings",
      accountLast4: "7777",
      maskedAccountNumber: "XXXXXXXX7777",
      accountNumber: "665544337777",
      partyDisplayName: "Christopher Bakken",
    },
    lastSources: Array.from({ length: 8 }, (_, index) => ({
      sourceName: `source-${index}.pdf`,
      accountType: "Savings",
      accountLast4: "7777",
      accountNumber: "665544337777",
    })),
  });

  assert.ok(state);
  assert.equal(state.activeClientName, "Christopher Bakken");
  assert.equal(state.activeFamilyScope, "bank_statement");
  assert.equal(state.activeAccountType, "Savings");
  assert.equal(state.lastSources.length, 5);
  assert.equal(state.lastPrimarySource?.maskedAccountNumber, "XXXXXXXX7777");
  assert.equal("accountNumber" in state.lastPrimarySource, false);
});

test("data intelligence conversation state derives active client and result context from assistant results", () => {
  const state = deriveDataIntelligenceConversationStateFromResult({
    previousState: null,
    result: {
      status: "answered",
      intent: "statement_list",
      sources: [
        {
          sourceName: "christopher-checking-2026.pdf",
          institutionName: "U.S. Bank",
          accountType: "Checking",
          accountLast4: "2211",
          maskedAccountNumber: "XXXXXXXX2211",
          partyDisplayName: "Christopher T Bakken",
        },
        {
          sourceName: "christopher-savings-2026.pdf",
          institutionName: "U.S. Bank",
          accountType: "Savings",
          accountLast4: "7777",
          maskedAccountNumber: "XXXXXXXX7777",
          partyDisplayName: "Christopher Bakken",
        },
      ],
      presentation: { mode: "summary_answer" },
    },
  });

  assert.equal(state.activeClientName, "Christopher T Bakken");
  assert.equal(state.activeFamilyScope, "bank_statement");
  assert.equal(state.activeAccountType, "Checking");
  assert.equal(state.activeStatementSource?.sourceName, "christopher-checking-2026.pdf");
  assert.equal(state.alternateStatementSources[0]?.sourceName, "christopher-savings-2026.pdf");
  assert.equal(state.lastIntent, "statement_list");
  assert.equal(state.lastTurnKind, "list");
  assert.equal(state.lastPrimarySource?.sourceName, "christopher-checking-2026.pdf");
});

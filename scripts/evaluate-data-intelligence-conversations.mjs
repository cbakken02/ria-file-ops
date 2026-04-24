import {
  answerDataIntelligenceQuestion,
} from "../lib/data-intelligence-assistant.ts";
import {
  deriveDataIntelligenceConversationStateFromResult,
} from "../lib/data-intelligence-conversation.ts";
import {
  writeCanonicalAccountStatementToSqlite,
  writeCanonicalIdentityDocumentToSqlite,
} from "../lib/firm-document-sqlite.ts";
import {
  buildIdentityCanonicalFixture,
  buildStatementCanonicalFixture,
  makeTempDbEnv,
  withEnv,
} from "../tests/helpers/firm-document-sqlite-fixtures.mjs";

const OWNER_EMAIL = "data-intelligence-conversation-eval@example.com";
const BANNED_ANSWER_PATTERNS = [
  /firm-document store/i,
  /couldn't match that question to a client/i,
  /\bmatching snapshot\b/i,
  /\bmatching 401\(k\) snapshot\b/i,
  /\bdebug\b/i,
];

const scenarios = [
  {
    id: "statement-object-continuity",
    title: "Statement object continuity",
    turns: [
      {
        question: "What is Christopher Bakken's latest bank statement?",
        expect: {
          status: "answered",
          intent: "latest_account_document",
          sourceCount: 1,
          sourceAccountTypes: ["Checking"],
          activeClient: /Christopher/i,
          activeStatementAccountType: "Checking",
          executedPlan: {
            intent: "latest_account_document",
            familyScope: "bank_statement",
          },
        },
      },
      {
        question: "What address is on that statement?",
        expect: {
          status: "answered",
          intent: "latest_account_document",
          sourceCount: 1,
          sourceAccountTypes: ["Checking"],
          activeStatementAccountType: "Checking",
          executedQuestionIncludes: [/Checking/i],
        },
      },
      {
        question: "What is the value of the account on that statement?",
        expect: {
          status: "answered",
          intent: "latest_account_snapshot",
          sourceCount: 1,
          sourceAccountTypes: ["Checking"],
          answerIncludes: [/\$4,321\.09|4321\.09/],
          activeStatementAccountType: "Checking",
          executedPlan: {
            intent: "latest_account_snapshot",
            accountType: "Checking",
          },
        },
      },
      {
        question: "What about on the other bank statement?",
        expect: {
          status: "answered",
          intent: "latest_account_snapshot",
          sourceCount: 1,
          sourceAccountTypes: ["Savings"],
          answerIncludes: [/\$9,800\.55|9800\.55/],
          activeStatementAccountType: "Savings",
          executedPlan: {
            intent: "latest_account_snapshot",
            accountType: "Savings",
          },
        },
      },
      {
        question: "What about on the savings statement?",
        expect: {
          status: "answered",
          intent: "latest_account_snapshot",
          sourceCount: 1,
          sourceAccountTypes: ["Savings"],
          answerIncludes: [/\$9,800\.55|9800\.55/],
          activeStatementAccountType: "Savings",
          executedPlan: {
            intent: "latest_account_snapshot",
            accountType: "Savings",
          },
        },
      },
      {
        question: "What's the value of the account on that statement?",
        expect: {
          status: "answered",
          intent: "latest_account_snapshot",
          sourceCount: 1,
          sourceAccountTypes: ["Savings"],
          answerIncludes: [/\$9,800\.55|9800\.55/],
          activeStatementAccountType: "Savings",
          executedPlan: {
            intent: "latest_account_snapshot",
            accountType: "Savings",
          },
        },
      },
    ],
  },
  {
    id: "statement-follow-up-continuity",
    title: "Statement follow-up continuity",
    turns: [
      {
        question: "What bank statements do we have on file for Christopher Bakken?",
        expect: {
          status: "answered",
          intent: "statement_list",
          sourceCount: 2,
          sourceAccountTypes: ["Checking", "Savings"],
          answerIncludes: [/2 bank statements/i, /Christopher/i],
          activeClient: /Christopher/i,
          executedPlan: {
            familyScope: "bank_statement",
          },
        },
      },
      {
        question: "what about credit card?",
        expect: {
          status: "answered",
          intent: "statement_list",
          sourceCount: 1,
          sourceAccountTypes: ["Credit Card"],
          answerIncludes: [/credit card/i, /Christopher/i],
          activeClient: /Christopher/i,
          executedPlan: {
            familyScope: "credit_card_statement",
            accountType: "Credit Card",
          },
        },
      },
      {
        question: "What's the account number on that one?",
        expect: {
          status: "answered",
          intent: "account_identifier_lookup",
          sourceCount: 1,
          sourceAccountTypes: ["Credit Card"],
          answerIncludes: [/4111111111111111/],
          sourceAccountNumber: "4111111111111111",
          executedPlan: {
            intent: "account_identifier_lookup",
            accountType: "Credit Card",
          },
        },
      },
    ],
  },
  {
    id: "active-client-persistence",
    title: "Active client persistence",
    turns: [
      {
        question: "What bank statements do we have on file for Christopher Bakken?",
        expect: {
          status: "answered",
          intent: "statement_list",
          activeClient: /Christopher/i,
        },
      },
      {
        question: "Do we have an ID on file?",
        expect: {
          status: "answered",
          intent: "identity_document_existence",
          sourceCount: 1,
          answerIncludes: [/Driver License/i, /Christopher/i],
          sourceIdType: "Driver License",
          activeClient: /Christopher/i,
          executedPlan: {
            intent: "identity_document_existence",
          },
        },
      },
      {
        question: "What's the expiration date?",
        expect: {
          status: "answered",
          intent: "latest_identity_expiration",
          sourceCount: 1,
          answerIncludes: [/2032-02-03/],
          sourceExpirationDate: "2032-02-03",
          activeClient: /Christopher/i,
          executedPlan: {
            intent: "latest_identity_expiration",
          },
        },
      },
    ],
  },
  {
    id: "client-replacement",
    title: "Client replacement",
    turns: [
      {
        question: "What bank statements do we have on file for Christopher Bakken?",
        expect: {
          status: "answered",
          intent: "statement_list",
          activeClient: /Christopher/i,
        },
      },
      {
        question: "What about Alex Kim?",
        expect: {
          status: "ambiguous",
          intent: "statement_list",
          answerIncludes: [/more than one possible client/i],
          answerExcludes: [/Christopher/],
          executedQuestionIncludes: [/Alex Kim/i],
        },
      },
    ],
  },
  {
    id: "ambiguity-and-clarification",
    title: "Ambiguity and clarification",
    turns: [
      {
        question: "What is the latest ID for Alex Kim?",
        expect: {
          status: "ambiguous",
          intent: "latest_identity_document",
          answerIncludes: [/more than one possible client/i],
          detailsInclude: [/Alex Kim/i],
        },
      },
      {
        question: "Do we have an ID on file?",
        resetConversation: true,
        expect: {
          status: "ambiguous",
          intent: "identity_document_existence",
          answerIncludes: [/Which client do you want me to check\?/i],
        },
      },
    ],
  },
  {
    id: "not-found-behavior",
    title: "Not-found behavior",
    turns: [
      {
        question: "What is Christopher Bakken's latest 401(k) statement?",
        expect: {
          status: "not_found",
          intent: "latest_account_document",
          answerIncludes: [/couldn't find/i, /401\(k\) statement/i],
        },
      },
      {
        question: "Do we have an ID on file for Jamie Example?",
        resetConversation: true,
        expect: {
          status: "not_found",
          intent: "identity_document_existence",
          answerIncludes: [/couldn't find that client/i],
        },
      },
      {
        question: "Do we have a Roth IRA statement for Christopher Bakken?",
        resetConversation: true,
        expect: {
          status: "not_found",
          intent: "statement_existence",
          answerIncludes: [/couldn't find/i, /Roth IRA statement/i],
        },
      },
    ],
  },
];

const outputJson = process.argv.includes("--json");
const tempDb = makeTempDbEnv("data-intelligence-conversation-eval-");
const restoreEnv = withEnv({
  DATA_INTELLIGENCE_AI_ENABLED: "true",
  DATA_INTELLIGENCE_MODEL: "conversation-eval-mock-model",
  DATA_INTELLIGENCE_API_KEY: "conversation-eval-mock-key",
  DATA_INTELLIGENCE_API_URL: "https://example.com/v1/chat/completions",
});

try {
  seedConversationEvalFixtures(OWNER_EMAIL);
  const report = await runConversationEvalSuite({
    dbPath: tempDb.dbPath,
    ownerEmail: OWNER_EMAIL,
    scenarios,
  });

  if (outputJson) {
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  } else {
    process.stdout.write(formatConversationEvalReport(report));
  }

  if (report.failedTurns > 0) {
    process.exitCode = 1;
  }
} finally {
  restoreEnv();
  tempDb.cleanup();
}

async function runConversationEvalSuite(input) {
  const scenarioReports = [];

  for (const scenario of input.scenarios) {
    scenarioReports.push(
      await runScenario({
        dbPath: input.dbPath,
        ownerEmail: input.ownerEmail,
        scenario,
      }),
    );
  }

  const totalTurns = scenarioReports.reduce(
    (sum, scenario) => sum + scenario.turns.length,
    0,
  );
  const failedTurns = scenarioReports.reduce(
    (sum, scenario) => sum + scenario.turns.filter((turn) => !turn.passed).length,
    0,
  );

  return {
    generatedAt: new Date().toISOString(),
    totalScenarios: scenarioReports.length,
    totalTurns,
    passedTurns: totalTurns - failedTurns,
    failedTurns,
    scenarios: scenarioReports,
  };
}

async function runScenario(input) {
  let history = [];
  let conversationState = null;
  const turnReports = [];
  const modelFetch = createMockModelFetch();

  for (let index = 0; index < input.scenario.turns.length; index += 1) {
    const turn = input.scenario.turns[index];
    if (turn.resetConversation) {
      history = [];
      conversationState = null;
    }

    const result = await answerDataIntelligenceQuestion({
      ownerEmail: input.ownerEmail,
      dbPath: input.dbPath,
      question: turn.question,
      history,
      conversationState,
      modelFetch,
      includeDebug: true,
    });
    const nextState = deriveDataIntelligenceConversationStateFromResult({
      previousState: conversationState,
      result,
    });
    const failures = evaluateTurn({
      result,
      expected: turn.expect,
      conversationState: nextState,
    });

    turnReports.push({
      index: index + 1,
      question: turn.question,
      passed: failures.length === 0,
      failures,
      summary: summarizeResult(result),
      diagnostics: failures.length > 0
        ? buildFailureDiagnostics({
            turn,
            result,
            conversationState: nextState,
          })
        : null,
    });

    history = appendConversationHistory(history, turn.question, result.answer);
    conversationState = nextState;
  }

  return {
    id: input.scenario.id,
    title: input.scenario.title,
    passed: turnReports.every((turn) => turn.passed),
    turns: turnReports,
  };
}

function evaluateTurn(input) {
  const failures = [];
  const { result, expected } = input;

  if (expected.status && result.status !== expected.status) {
    failures.push(`Expected status ${expected.status}, got ${result.status}.`);
  }

  if (expected.intent && result.intent !== expected.intent) {
    failures.push(`Expected intent ${expected.intent}, got ${result.intent}.`);
  }

  if (
    typeof expected.sourceCount === "number" &&
    result.sources.length !== expected.sourceCount
  ) {
    failures.push(
      `Expected ${expected.sourceCount} sources, got ${result.sources.length}.`,
    );
  }

  for (const pattern of expected.answerIncludes ?? []) {
    if (!pattern.test(result.answer)) {
      failures.push(`Expected answer to include ${pattern}.`);
    }
  }

  for (const pattern of expected.answerExcludes ?? []) {
    if (pattern.test(result.answer)) {
      failures.push(`Expected answer not to include ${pattern}.`);
    }
  }

  for (const pattern of expected.detailsInclude ?? []) {
    if (!result.details.some((detail) => pattern.test(detail))) {
      failures.push(`Expected at least one detail to include ${pattern}.`);
    }
  }

  for (const pattern of BANNED_ANSWER_PATTERNS) {
    if (pattern.test(result.answer)) {
      failures.push(`Answer included banned/internal phrase ${pattern}.`);
    }
  }

  if (expected.sourceAccountTypes) {
    const actualTypes = result.sources.map((source) => source.accountType);
    for (const expectedType of expected.sourceAccountTypes) {
      if (!actualTypes.includes(expectedType)) {
        failures.push(`Expected source account type ${expectedType}.`);
      }
    }
  }

  if (
    expected.sourceAccountNumber &&
    !result.sources.some(
      (source) => source.accountNumber === expected.sourceAccountNumber,
    )
  ) {
    failures.push(
      `Expected source account number ${expected.sourceAccountNumber}.`,
    );
  }

  if (
    expected.sourceIdType &&
    !result.sources.some((source) => source.idType === expected.sourceIdType)
  ) {
    failures.push(`Expected source ID type ${expected.sourceIdType}.`);
  }

  if (
    expected.sourceExpirationDate &&
    !result.sources.some(
      (source) => source.expirationDate === expected.sourceExpirationDate,
    )
  ) {
    failures.push(
      `Expected source expiration date ${expected.sourceExpirationDate}.`,
    );
  }

  if (
    expected.activeClient &&
    !expected.activeClient.test(input.conversationState.activeClientName ?? "")
  ) {
    failures.push(
      `Expected active client to match ${expected.activeClient}, got ${input.conversationState.activeClientName ?? "null"}.`,
    );
  }

  if (
    expected.activeStatementAccountType &&
    input.conversationState.activeStatementSource?.accountType !==
      expected.activeStatementAccountType
  ) {
    failures.push(
      `Expected active statement account type ${expected.activeStatementAccountType}, got ${input.conversationState.activeStatementSource?.accountType ?? "null"}.`,
    );
  }

  const debug = result.debug?.dataIntelligenceHybrid;
  if (expected.executedPlan && debug?.executedPlan) {
    for (const [key, value] of Object.entries(expected.executedPlan)) {
      if (debug.executedPlan[key] !== value) {
        failures.push(
          `Expected executedPlan.${key}=${value}, got ${debug.executedPlan[key] ?? "null"}.`,
        );
      }
    }
  }

  for (const pattern of expected.executedQuestionIncludes ?? []) {
    if (!pattern.test(debug?.executedQuestion ?? "")) {
      failures.push(`Expected executed question to include ${pattern}.`);
    }
  }

  return failures;
}

function buildFailureDiagnostics(input) {
  const debug = input.result.debug?.dataIntelligenceHybrid ?? null;
  return {
    userTurn: input.turn.question,
    assistantAnswer: input.result.answer,
    status: input.result.status,
    intent: input.result.intent,
    sources: input.result.sources.map((source) => ({
      sourceName: source.sourceName,
      accountType: source.accountType,
      accountLast4: source.accountLast4,
      idType: source.idType,
      statementEndDate: source.statementEndDate,
      expirationDate: source.expirationDate,
    })),
    activeConversationState: input.conversationState,
    hybridDebug: debug
      ? {
          interpretation: debug.interpretation,
          composition: debug.composition,
          executedQuestion: debug.executedQuestion,
          executedPlan: debug.executedPlan,
          deterministicFallbackPlan: debug.deterministicFallbackPlan,
        }
      : null,
  };
}

function summarizeResult(result) {
  const debug = result.debug?.dataIntelligenceHybrid ?? null;
  return {
    status: result.status,
    intent: result.intent,
    answer: result.answer,
    sourceCount: result.sources.length,
    sourceNames: result.sources.map((source) => source.sourceName).filter(Boolean),
    sourceAccountTypes: result.sources
      .map((source) => source.accountType)
      .filter(Boolean),
    executedQuestion: debug?.executedQuestion ?? null,
    executedPlan: debug?.executedPlan ?? null,
    interpretationAttempted: debug?.interpretation?.attempted ?? null,
    interpretationSucceeded: debug?.interpretation?.succeeded ?? null,
    interpretationFallbackUsed: debug?.interpretation?.fallbackUsed ?? null,
  };
}

function appendConversationHistory(history, question, answer) {
  return [
    ...history,
    { role: "user", text: question },
    { role: "assistant", text: answer },
  ].slice(-8);
}

function createMockModelFetch() {
  return async () =>
    Response.json({
      choices: [
        {
          message: {
            content: "{}",
          },
        },
      ],
    });
}

function seedConversationEvalFixtures(ownerEmail) {
  const canonicals = [
    buildStatementCanonicalFixture({
      ownerName: "Christopher T Bakken",
      rawInstitutionName: "U.S. Bank National Association",
      normalizedInstitutionName: "U.S. Bank",
      rawAccountType: "U.S. Bank Smartly Checking",
      normalizedAccountType: "Checking",
      accountNumber: "665544332211",
      maskedAccountNumber: "XXXXXXXX2211",
      accountLast4: "2211",
      fileId: "christopher-checking-2026",
      sourceName: "christopher-checking-2026.pdf",
      documentDate: "2026-06-30",
      statementStartDate: "2026-06-01",
      statementEndDate: "2026-06-30",
      extractedValues: [
        {
          kind: "ending_balance",
          label: "Ending balance",
          money: { amount: "4321.09", currency: "USD" },
          dateId: "date-end",
        },
      ],
      normalizedValues: [
        {
          kind: "ending_balance",
          label: "Ending balance",
          money: { amount: "4321.09", currency: "USD" },
          dateId: "date-end",
        },
      ],
    }),
    buildStatementCanonicalFixture({
      ownerName: "Christopher Bakken",
      rawInstitutionName: "U.S. Bank National Association",
      normalizedInstitutionName: "U.S. Bank",
      rawAccountType: "U.S. Bank Savings",
      normalizedAccountType: "Savings",
      accountNumber: "665544337777",
      maskedAccountNumber: "XXXXXXXX7777",
      accountLast4: "7777",
      fileId: "christopher-savings-2026",
      sourceName: "christopher-savings-2026.pdf",
      documentDate: "2026-05-31",
      statementStartDate: "2026-05-01",
      statementEndDate: "2026-05-31",
      extractedValues: [
        {
          kind: "ending_balance",
          label: "Ending balance",
          money: { amount: "9800.55", currency: "USD" },
          dateId: "date-end",
        },
      ],
      normalizedValues: [
        {
          kind: "ending_balance",
          label: "Ending balance",
          money: { amount: "9800.55", currency: "USD" },
          dateId: "date-end",
        },
      ],
    }),
    buildStatementCanonicalFixture({
      ownerName: "Christopher Bakken",
      rawInstitutionName: "U.S. Bank National Association",
      normalizedInstitutionName: "U.S. Bank",
      rawAccountType: "Visa Signature Credit Card",
      normalizedAccountType: "Credit Card",
      accountNumber: "4111111111111111",
      maskedAccountNumber: "XXXXXXXXXXXX1111",
      accountLast4: "1111",
      fileId: "christopher-credit-card-2026",
      sourceName: "christopher-credit-card-2026.pdf",
      documentDate: "2026-07-15",
      statementStartDate: "2026-06-16",
      statementEndDate: "2026-07-15",
      extractedValues: [
        {
          kind: "current_balance",
          label: "Current balance",
          money: { amount: "840.12", currency: "USD" },
          dateId: "date-end",
        },
      ],
      normalizedValues: [
        {
          kind: "current_balance",
          label: "Current balance",
          money: { amount: "840.12", currency: "USD" },
          dateId: "date-end",
        },
      ],
    }),
    buildIdentityCanonicalFixture({
      fileId: "christopher-bakken-renewed-id",
      sourceName: "case-06-renewed-license.pdf",
      subtype: "driver_license",
      displayName: "Christopher T Bakken",
      rawName: "CHRISTOPHER T BAKKEN",
      governmentIdValue: "BAKKC85020324",
      maskedGovernmentIdValue: "xxxxxxxxx0324",
      issuingAuthority: "WI",
      birthDate: "1985-02-03",
      issueDate: "2024-03-01",
      documentDate: "2024-03-01",
      expirationDate: "2032-02-03",
    }),
    buildIdentityCanonicalFixture({
      fileId: "alex-kim-wi",
      sourceName: "alex-kim-wi.pdf",
      subtype: "driver_license",
      displayName: "Alex Kim",
      rawName: "ALEX KIM",
      governmentIdValue: "ALEXKIM-WI-1",
      maskedGovernmentIdValue: "xxxxxxxxx-WI-1",
      issuingAuthority: "WI",
      birthDate: "1990-01-01",
      issueDate: "2024-01-01",
      documentDate: "2024-01-01",
      expirationDate: "2030-01-01",
    }),
    buildIdentityCanonicalFixture({
      fileId: "alex-kim-co",
      sourceName: "alex-kim-co.pdf",
      subtype: "state_id",
      displayName: "Alex Kim",
      rawName: "ALEX KIM",
      governmentIdValue: "ALEXKIM-CO-2",
      maskedGovernmentIdValue: "xxxxxxxxx-CO-2",
      issuingAuthority: "CO",
      birthDate: "1994-04-04",
      issueDate: "2025-02-02",
      documentDate: "2025-02-02",
      expirationDate: "2033-04-04",
    }),
  ];

  for (const canonical of canonicals) {
    const common = {
      ownerEmail,
      analysisProfile: "data_intelligence_conversation_eval",
      analysisVersion: "conversation-eval",
      analysisRanAt: "2026-04-22T12:00:00.000Z",
      canonical,
    };

    if (canonical.classification.normalized.documentTypeId === "account_statement") {
      writeCanonicalAccountStatementToSqlite(common);
    } else {
      writeCanonicalIdentityDocumentToSqlite(common);
    }
  }
}

function formatConversationEvalReport(report) {
  const lines = [
    "Data Intelligence conversation eval",
    `Scenarios: ${report.totalScenarios}`,
    `Turns: ${report.passedTurns}/${report.totalTurns} passed`,
    "",
  ];

  for (const scenario of report.scenarios) {
    lines.push(`${scenario.passed ? "✓" : "✗"} ${scenario.id} - ${scenario.title}`);
    for (const turn of scenario.turns) {
      lines.push(
        `  ${turn.passed ? "✓" : "✗"} ${turn.index}. ${turn.question}`,
      );
      lines.push(
        `     ${turn.summary.status}/${turn.summary.intent ?? "none"} | sources=${turn.summary.sourceCount} | executed=${turn.summary.executedPlan?.intent ?? "none"}`,
      );
      if (!turn.passed) {
        for (const failure of turn.failures) {
          lines.push(`     - ${failure}`);
        }
        lines.push(`     diagnostics=${JSON.stringify(turn.diagnostics)}`);
      }
    }
    lines.push("");
  }

  return `${lines.join("\n")}\n`;
}

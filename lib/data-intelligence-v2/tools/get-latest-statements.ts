import type { ClientDataGateway } from "@/lib/data-intelligence-v2/data-gateway";
import type { DataIntelligenceV2AuthContext } from "@/lib/data-intelligence-v2/types";
import type { GetLatestStatementsToolArgs } from "@/lib/data-intelligence-v2/tools/definitions";
import {
  createFact,
  createToolResult,
} from "@/lib/data-intelligence-v2/tools/result-helpers";

export async function runGetLatestStatementsTool(args: {
  toolArgs: GetLatestStatementsToolArgs;
  authContext: DataIntelligenceV2AuthContext;
  dataGateway: ClientDataGateway;
}) {
  const result = await args.dataGateway.getLatestStatements({
    ownerEmail: args.authContext.ownerEmail,
    clientId: args.toolArgs.clientId,
    accountType: args.toolArgs.accountType,
    custodian: args.toolArgs.custodian,
    maxAgeDays: args.toolArgs.maxAgeDays,
    limit: args.toolArgs.limit,
  });

  if (result.statements.length === 0) {
    return createToolResult({
      toolName: "get_latest_statements",
      status: "not_found",
      summary: "No matching latest statements were found.",
      missing: result.missing,
      sourceRefs: result.sourceRefs,
      allowedClaims: ["No matching statement records were found."],
    });
  }

  const facts = result.statements.flatMap((statement) => [
    createFact({
      factId: `statement:${statement.statementId}:date`,
      fieldKey: "statement.date",
      label: "Statement date",
      value: statement.statementDate ?? null,
      sourceRefs: statement.sourceRefs,
    }),
    createFact({
      factId: `statement:${statement.statementId}:custodian`,
      fieldKey: "account.custodian",
      label: "Custodian",
      value: statement.custodian ?? null,
      sourceRefs: statement.sourceRefs,
    }),
    createFact({
      factId: `statement:${statement.statementId}:accountType`,
      fieldKey: "account.type",
      label: "Account type",
      value: statement.accountType ?? null,
      sourceRefs: statement.sourceRefs,
    }),
    createFact({
      factId: `statement:${statement.statementId}:last4`,
      fieldKey: "account.last4",
      label: "Account last4",
      value: statement.accountLast4 ?? null,
      sourceRefs: statement.sourceRefs,
    }),
    createFact({
      factId: `statement:${statement.statementId}:masked`,
      fieldKey: "account.maskedAccountNumber",
      label: "Masked account number",
      value: statement.maskedAccountNumber ?? null,
      sourceRefs: statement.sourceRefs,
    }),
    createFact({
      factId: `statement:${statement.statementId}:balance`,
      fieldKey: "account.balance",
      label: "Statement balance",
      value: statement.balance ?? null,
      sourceRefs: statement.sourceRefs,
    }),
    createFact({
      factId: `statement:${statement.statementId}:staleness`,
      fieldKey: "statement.stalenessStatus",
      label: "Statement staleness",
      value: statement.stalenessStatus ?? "unknown",
      sourceRefs: statement.sourceRefs,
    }),
  ]);

  return createToolResult({
    toolName: "get_latest_statements",
    status: "success",
    summary: `Found ${result.statements.length} latest statement record${result.statements.length === 1 ? "" : "s"}.`,
    facts,
    sourceRefs: result.sourceRefs,
    allowedClaims: [
      "Safe statement metadata is available, including statement date, custodian, account type, masked/last4 account identifiers, balance, and staleness status.",
    ],
    disallowedClaims: [
      "Do not state or infer the full account number from masked or last4 values.",
    ],
  });
}

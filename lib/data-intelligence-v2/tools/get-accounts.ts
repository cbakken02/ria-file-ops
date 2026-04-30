import type { ClientDataGateway } from "@/lib/data-intelligence-v2/data-gateway";
import type { DataIntelligenceV2AuthContext } from "@/lib/data-intelligence-v2/types";
import type { GetAccountsToolArgs } from "@/lib/data-intelligence-v2/tools/definitions";
import {
  createFact,
  createToolResult,
} from "@/lib/data-intelligence-v2/tools/result-helpers";

export async function runGetAccountsTool(args: {
  toolArgs: GetAccountsToolArgs;
  authContext: DataIntelligenceV2AuthContext;
  dataGateway: ClientDataGateway;
}) {
  const result = await args.dataGateway.getAccounts({
    ownerEmail: args.authContext.ownerEmail,
    clientId: args.toolArgs.clientId,
    accountType: args.toolArgs.accountType,
    custodian: args.toolArgs.custodian,
    includeClosed: args.toolArgs.includeClosed,
    limit: args.toolArgs.limit,
  });

  if (result.accounts.length === 0) {
    return createToolResult({
      toolName: "get_accounts",
      status: "not_found",
      summary: "No matching accounts were found.",
      missing: result.missing,
      sourceRefs: result.sourceRefs,
      allowedClaims: ["No matching account records were found."],
    });
  }

  const facts = result.accounts.flatMap((account) => [
    createFact({
      factId: `account:${account.accountId}:id`,
      fieldKey: "account.id",
      label: "Account ID",
      value: account.accountId,
      sourceRefs: account.sourceRefs,
    }),
    createFact({
      factId: `account:${account.accountId}:custodian`,
      fieldKey: "account.custodian",
      label: "Custodian",
      value: account.custodian ?? null,
      sourceRefs: account.sourceRefs,
    }),
    createFact({
      factId: `account:${account.accountId}:type`,
      fieldKey: "account.type",
      label: "Account type",
      value: account.accountType ?? null,
      sourceRefs: account.sourceRefs,
    }),
    createFact({
      factId: `account:${account.accountId}:last4`,
      fieldKey: "account.last4",
      label: "Account last4",
      value: account.accountLast4 ?? null,
      sourceRefs: account.sourceRefs,
    }),
    createFact({
      factId: `account:${account.accountId}:masked`,
      fieldKey: "account.maskedAccountNumber",
      label: "Masked account number",
      value: account.maskedAccountNumber ?? null,
      sourceRefs: account.sourceRefs,
    }),
    createFact({
      factId: `account:${account.accountId}:balance`,
      fieldKey: "account.balance",
      label: account.balanceLabel ?? "Account balance",
      value: account.balance ?? null,
      sourceRefs: account.sourceRefs,
    }),
    createFact({
      factId: `account:${account.accountId}:status`,
      fieldKey: "account.status",
      label: "Account status",
      value: account.accountStatus ?? "unknown",
      sourceRefs: account.sourceRefs,
    }),
  ]);

  return createToolResult({
    toolName: "get_accounts",
    status: "success",
    summary: `Found ${result.accounts.length} account record${result.accounts.length === 1 ? "" : "s"}.`,
    facts,
    sourceRefs: result.sourceRefs,
    allowedClaims: [
      "Safe account metadata is available, including custodian, account type, masked/last4 account identifiers, balances, and source-backed status.",
    ],
    disallowedClaims: [
      "Do not state or infer the full account number from masked or last4 values.",
    ],
  });
}

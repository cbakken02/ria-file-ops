import { authorizeOwnerScope } from "@/lib/data-intelligence-v2/policy";
import type { V2AuditSink } from "@/lib/data-intelligence-v2/audit";
import {
  getDefaultDataGateway,
  getDefaultRevealTokenService,
} from "@/lib/data-intelligence-v2/service-factory";
import {
  assertNoUnsafeModelContent,
  sanitizeObjectForModel,
  sanitizeTextForModel,
} from "@/lib/data-intelligence-v2/safe-memory";
import type {
  ClientDataGateway,
} from "@/lib/data-intelligence-v2/data-gateway";
import type { RevealTokenService } from "@/lib/data-intelligence-v2/reveal-token-service";
import type {
  DataIntelligenceV2AuthContext,
  ModelSafeRevealCard,
  V2ToolName,
  V2ToolResult,
} from "@/lib/data-intelligence-v2/types";
import {
  IDENTITY_STATUS_FIELDS,
  REVEAL_PURPOSES,
  SENSITIVE_REVEAL_FIELD_KEYS,
  WORKFLOW_TYPES,
  type CheckWorkflowRequirementsToolArgs,
  type CreateSensitiveRevealToolArgs,
  type GetAccountsToolArgs,
  type GetIdentityStatusToolArgs,
  type GetLatestStatementsToolArgs,
  type GetTaxDocumentsToolArgs,
  type ResolveClientToolArgs,
  type V2ToolArgs,
} from "@/lib/data-intelligence-v2/tools/definitions";
import { isV2ToolName } from "@/lib/data-intelligence-v2/tools/registry";
import { runCheckWorkflowRequirementsTool } from "@/lib/data-intelligence-v2/tools/check-workflow-requirements";
import { runCreateSensitiveRevealTool } from "@/lib/data-intelligence-v2/tools/create-sensitive-reveal";
import { runGetAccountsTool } from "@/lib/data-intelligence-v2/tools/get-accounts";
import { runGetIdentityStatusTool } from "@/lib/data-intelligence-v2/tools/get-identity-status";
import { runGetLatestStatementsTool } from "@/lib/data-intelligence-v2/tools/get-latest-statements";
import { runGetTaxDocumentsTool } from "@/lib/data-intelligence-v2/tools/get-tax-documents";
import { runResolveClientTool } from "@/lib/data-intelligence-v2/tools/resolve-client";
import {
  createToolResult,
} from "@/lib/data-intelligence-v2/tools/result-helpers";

type ToolArgValidation =
  | { valid: true; args: V2ToolArgs }
  | { valid: false; error: string };

export async function runV2Tool(args: {
  toolName: V2ToolName;
  args: unknown;
  authContext: DataIntelligenceV2AuthContext;
  dataGateway?: ClientDataGateway;
  revealTokenService?: RevealTokenService;
  auditSink?: V2AuditSink;
}): Promise<V2ToolResult> {
  const startedAt = Date.now();
  if (!isV2ToolName(args.toolName)) {
    await recordToolAudit(args.auditSink, {
      authContext: args.authContext,
      toolName: String(args.toolName),
      eventType: "tool_call_error",
      status: "error",
      allowed: false,
      reason: "Unknown V2 tool name.",
      metadata: { durationMs: Date.now() - startedAt },
    });
    return safeErrorResult("resolve_client", "Unknown V2 tool name.");
  }

  await recordToolAudit(args.auditSink, {
    authContext: args.authContext,
    toolName: args.toolName,
    eventType: "tool_call_started",
    status: "started",
    allowed: true,
    reason: "V2 tool call started.",
    metadata: { hasArgsObject: isRecord(args.args) },
  });

  if (!args.authContext.ownerEmail?.trim()) {
    await recordToolAudit(args.auditSink, {
      authContext: args.authContext,
      toolName: args.toolName,
      eventType: "tool_call_denied",
      status: "denied",
      allowed: false,
      reason: "Owner scope is missing.",
      metadata: { durationMs: Date.now() - startedAt },
    });
    return createToolResult({
      toolName: args.toolName,
      status: "denied",
      summary: "Tool execution denied because owner scope is missing.",
      allowedClaims: [],
      disallowedClaims: ["Do not answer from structured records without owner scope."],
    });
  }

  const ownerDecision = authorizeOwnerScope({
    authContext: args.authContext,
    requestedOwnerEmail: args.authContext.ownerEmail,
  });
  if (!ownerDecision.allowed) {
    await recordToolAudit(args.auditSink, {
      authContext: args.authContext,
      toolName: args.toolName,
      eventType: "tool_call_denied",
      status: "denied",
      allowed: false,
      reason: ownerDecision.reason,
      metadata: { durationMs: Date.now() - startedAt },
    });
    return createToolResult({
      toolName: args.toolName,
      status: "denied",
      summary: ownerDecision.reason,
      allowedClaims: [],
      disallowedClaims: ["Do not answer from unauthorized owner scope."],
    });
  }

  const validation = validateV2ToolArgs(args.toolName, args.args);
  if (!validation.valid) {
    await recordToolAudit(args.auditSink, {
      authContext: args.authContext,
      toolName: args.toolName,
      eventType: "tool_call_error",
      status: "error",
      allowed: false,
      reason: validation.error,
      metadata: {
        durationMs: Date.now() - startedAt,
        argKeyCount: isRecord(args.args) ? Object.keys(args.args).length : 0,
      },
    });
    return createToolResult({
      toolName: args.toolName,
      status: "error",
      summary: validation.error,
      allowedClaims: [],
      disallowedClaims: ["Do not infer missing or invalid tool arguments."],
    });
  }

  const dataGateway = args.dataGateway ?? getDefaultDataGateway();
  const revealTokenService =
    args.revealTokenService ?? getDefaultRevealTokenService();

  try {
    const result = await executeTool({
      toolName: args.toolName,
      toolArgs: validation.args,
      authContext: args.authContext,
      dataGateway,
      revealTokenService,
    });
    const sanitized = preserveSecureRevealCards(
      result,
      sanitizeObjectForModel(result) as V2ToolResult,
    );

    try {
      assertNoUnsafeModelContent(sanitized);
    } catch {
      await recordToolAudit(args.auditSink, {
        authContext: args.authContext,
        toolName: args.toolName,
        eventType: "safety_validation_failed",
        status: "unsafe_tool_result",
        allowed: false,
        reason: "Tool result failed model-safety validation.",
        metadata: { durationMs: Date.now() - startedAt },
      });
      return safeErrorResult(
        args.toolName,
        "Tool result failed model-safety validation",
      );
    }

    await recordToolAudit(args.auditSink, {
      authContext: args.authContext,
      toolName: args.toolName,
      eventType:
        sanitized.status === "denied" ? "tool_call_denied" : "tool_call_completed",
      status: sanitized.status,
      allowed: sanitized.status !== "denied" && sanitized.status !== "error",
      reason: "V2 tool call completed.",
      metadata: {
        durationMs: Date.now() - startedAt,
        factCount: sanitized.facts.length,
        missingCount: sanitized.missing.length,
        secureRevealCardCount: sanitized.secureRevealCards.length,
        sourceRefCount: sanitized.sourceRefs.length,
      },
    });
    return sanitized;
  } catch {
    await recordToolAudit(args.auditSink, {
      authContext: args.authContext,
      toolName: args.toolName,
      eventType: "tool_call_error",
      status: "error",
      allowed: false,
      reason: "Tool execution failed before producing a safe result.",
      metadata: { durationMs: Date.now() - startedAt },
    });
    return safeErrorResult(
      args.toolName,
      "Tool execution failed before producing a safe result.",
    );
  }
}

async function recordToolAudit(
  auditSink: V2AuditSink | undefined,
  event: {
    authContext: DataIntelligenceV2AuthContext;
    toolName: string;
    eventType:
      | "tool_call_started"
      | "tool_call_completed"
      | "tool_call_denied"
      | "tool_call_error"
      | "safety_validation_failed";
    status: string;
    allowed: boolean;
    reason: string;
    metadata?: Record<string, unknown>;
  },
) {
  if (!auditSink) {
    return;
  }

  try {
    await auditSink.record({
      eventType: event.eventType,
      eventCategory:
        event.eventType === "safety_validation_failed" ? "safety" : "tool",
      ownerEmail: event.authContext.ownerEmail,
      userEmail: event.authContext.userEmail,
      userId: event.authContext.userId,
      firmId: event.authContext.firmId,
      role: event.authContext.role,
      toolName: event.toolName,
      status: event.status,
      allowed: event.allowed,
      reason: event.reason,
      metadata: event.metadata,
    });
  } catch {
    // Audit failures must not alter tool behavior or expose internal details.
  }
}

function preserveSecureRevealCards(
  original: V2ToolResult,
  sanitized: V2ToolResult,
): V2ToolResult {
  return {
    ...sanitized,
    secureRevealCards: original.secureRevealCards.map(sanitizeRevealCard),
  };
}

function sanitizeRevealCard(card: ModelSafeRevealCard): ModelSafeRevealCard {
  return {
    revealCardId: sanitizeTextForModel(card.revealCardId),
    fieldKey: card.fieldKey,
    fieldLabel: sanitizeTextForModel(card.fieldLabel),
    ...(card.clientId ? { clientId: sanitizeTextForModel(card.clientId) } : {}),
    ...(card.accountId
      ? { accountId: sanitizeTextForModel(card.accountId) }
      : {}),
    ...(card.documentId
      ? { documentId: sanitizeTextForModel(card.documentId) }
      : {}),
    label: sanitizeTextForModel(card.label),
    ...(card.maskedValue
      ? { maskedValue: sanitizeTextForModel(card.maskedValue) }
      : {}),
    status: card.status,
    expiresAt: sanitizeTextForModel(card.expiresAt),
    actualValueWasNotShownToModel: true,
  };
}

export function validateV2ToolArgs(
  toolName: V2ToolName,
  args: unknown,
): ToolArgValidation {
  if (!isV2ToolName(toolName)) {
    return { valid: false, error: "Unknown V2 tool name." };
  }

  if (!isRecord(args)) {
    return { valid: false, error: `${toolName} arguments must be an object.` };
  }

  if ("ownerEmail" in args || "requestedOwnerEmail" in args) {
    return {
      valid: false,
      error: "Tool arguments may not include owner scope.",
    };
  }

  switch (toolName) {
    case "resolve_client":
      return validateResolveClientArgs(args);
    case "get_accounts":
      return validateGetAccountsArgs(args);
    case "get_latest_statements":
      return validateGetLatestStatementsArgs(args);
    case "get_tax_documents":
      return validateGetTaxDocumentsArgs(args);
    case "get_identity_status":
      return validateGetIdentityStatusArgs(args);
    case "check_workflow_requirements":
      return validateCheckWorkflowRequirementsArgs(args);
    case "create_sensitive_reveal":
      return validateCreateSensitiveRevealArgs(args);
  }
}

async function executeTool(args: {
  toolName: V2ToolName;
  toolArgs: V2ToolArgs;
  authContext: DataIntelligenceV2AuthContext;
  dataGateway: ClientDataGateway;
  revealTokenService: RevealTokenService;
}) {
  switch (args.toolName) {
    case "resolve_client":
      return runResolveClientTool({
        toolArgs: args.toolArgs as ResolveClientToolArgs,
        authContext: args.authContext,
        dataGateway: args.dataGateway,
      });
    case "get_accounts":
      return runGetAccountsTool({
        toolArgs: args.toolArgs as GetAccountsToolArgs,
        authContext: args.authContext,
        dataGateway: args.dataGateway,
      });
    case "get_latest_statements":
      return runGetLatestStatementsTool({
        toolArgs: args.toolArgs as GetLatestStatementsToolArgs,
        authContext: args.authContext,
        dataGateway: args.dataGateway,
      });
    case "get_tax_documents":
      return runGetTaxDocumentsTool({
        toolArgs: args.toolArgs as GetTaxDocumentsToolArgs,
        authContext: args.authContext,
        dataGateway: args.dataGateway,
      });
    case "get_identity_status":
      return runGetIdentityStatusTool({
        toolArgs: args.toolArgs as GetIdentityStatusToolArgs,
        authContext: args.authContext,
        dataGateway: args.dataGateway,
      });
    case "check_workflow_requirements":
      return runCheckWorkflowRequirementsTool({
        toolArgs: args.toolArgs as CheckWorkflowRequirementsToolArgs,
        authContext: args.authContext,
        dataGateway: args.dataGateway,
      });
    case "create_sensitive_reveal":
      return runCreateSensitiveRevealTool({
        toolArgs: args.toolArgs as CreateSensitiveRevealToolArgs,
        authContext: args.authContext,
        revealTokenService: args.revealTokenService,
      });
  }
}

function validateResolveClientArgs(args: Record<string, unknown>) {
  const unknownKey = findUnknownKey(args, ["query", "limit"]);
  if (unknownKey) {
    return invalid(`resolve_client does not accept ${unknownKey}.`);
  }

  if (!isNonEmptyString(args.query)) {
    return invalid("resolve_client requires a non-empty query.");
  }

  const limit = readOptionalPositiveInteger(args.limit, "limit");
  if (!limit.valid) {
    return invalid(limit.error);
  }

  return valid({
    query: args.query,
    ...(limit.value ? { limit: limit.value } : {}),
  } satisfies ResolveClientToolArgs);
}

function validateGetAccountsArgs(args: Record<string, unknown>) {
  const unknownKey = findUnknownKey(args, [
    "clientId",
    "accountType",
    "custodian",
    "includeClosed",
    "limit",
  ]);
  if (unknownKey) {
    return invalid(`get_accounts does not accept ${unknownKey}.`);
  }

  if (!isNonEmptyString(args.clientId)) {
    return invalid("get_accounts requires clientId.");
  }

  const limit = readOptionalPositiveInteger(args.limit, "limit");
  if (!limit.valid) {
    return invalid(limit.error);
  }

  if (
    args.includeClosed !== undefined &&
    args.includeClosed !== null &&
    typeof args.includeClosed !== "boolean"
  ) {
    return invalid("includeClosed must be boolean when provided.");
  }

  return valid({
    clientId: args.clientId,
    ...optionalString("accountType", args.accountType),
    ...optionalString("custodian", args.custodian),
    ...(args.includeClosed !== undefined && args.includeClosed !== null
      ? { includeClosed: args.includeClosed }
      : {}),
    ...(limit.value ? { limit: limit.value } : {}),
  } satisfies GetAccountsToolArgs);
}

function validateGetLatestStatementsArgs(args: Record<string, unknown>) {
  const unknownKey = findUnknownKey(args, [
    "clientId",
    "accountType",
    "custodian",
    "maxAgeDays",
    "limit",
  ]);
  if (unknownKey) {
    return invalid(`get_latest_statements does not accept ${unknownKey}.`);
  }

  if (!isNonEmptyString(args.clientId)) {
    return invalid("get_latest_statements requires clientId.");
  }

  const maxAgeDays = readOptionalPositiveInteger(args.maxAgeDays, "maxAgeDays");
  if (!maxAgeDays.valid) {
    return invalid(maxAgeDays.error);
  }

  const limit = readOptionalPositiveInteger(args.limit, "limit");
  if (!limit.valid) {
    return invalid(limit.error);
  }

  return valid({
    clientId: args.clientId,
    ...optionalString("accountType", args.accountType),
    ...optionalString("custodian", args.custodian),
    ...(maxAgeDays.value ? { maxAgeDays: maxAgeDays.value } : {}),
    ...(limit.value ? { limit: limit.value } : {}),
  } satisfies GetLatestStatementsToolArgs);
}

function validateGetTaxDocumentsArgs(args: Record<string, unknown>) {
  const unknownKey = findUnknownKey(args, [
    "clientId",
    "taxYear",
    "formTypes",
    "limit",
  ]);
  if (unknownKey) {
    return invalid(`get_tax_documents does not accept ${unknownKey}.`);
  }

  if (!isNonEmptyString(args.clientId)) {
    return invalid("get_tax_documents requires clientId.");
  }

  if (
    args.taxYear !== undefined &&
    args.taxYear !== null &&
    (!Number.isInteger(args.taxYear) || Number(args.taxYear) < 1900)
  ) {
    return invalid("taxYear must be an integer year when provided.");
  }

  if (
    args.formTypes !== undefined &&
    args.formTypes !== null &&
    (!Array.isArray(args.formTypes) ||
      !args.formTypes.every((entry) => isNonEmptyString(entry)))
  ) {
    return invalid("formTypes must be an array of non-empty strings.");
  }

  const limit = readOptionalPositiveInteger(args.limit, "limit");
  if (!limit.valid) {
    return invalid(limit.error);
  }

  return valid({
    clientId: args.clientId,
    ...(typeof args.taxYear === "number" ? { taxYear: args.taxYear } : {}),
    ...(Array.isArray(args.formTypes) ? { formTypes: args.formTypes } : {}),
    ...(limit.value ? { limit: limit.value } : {}),
  } satisfies GetTaxDocumentsToolArgs);
}

function validateGetIdentityStatusArgs(args: Record<string, unknown>) {
  const unknownKey = findUnknownKey(args, ["clientId", "fields"]);
  if (unknownKey) {
    return invalid(`get_identity_status does not accept ${unknownKey}.`);
  }

  if (!isNonEmptyString(args.clientId)) {
    return invalid("get_identity_status requires clientId.");
  }

  if (args.fields !== undefined && args.fields !== null) {
    if (!Array.isArray(args.fields)) {
      return invalid("fields must be an array when provided.");
    }

    const invalidField = args.fields.find(
      (field) => !IDENTITY_STATUS_FIELDS.includes(field),
    );
    if (invalidField) {
      return invalid(`Unsupported identity status field: ${String(invalidField)}.`);
    }
  }

  return valid({
    clientId: args.clientId,
    ...(Array.isArray(args.fields)
      ? { fields: args.fields as GetIdentityStatusToolArgs["fields"] }
      : {}),
  } satisfies GetIdentityStatusToolArgs);
}

function validateCheckWorkflowRequirementsArgs(args: Record<string, unknown>) {
  const unknownKey = findUnknownKey(args, ["clientId", "workflowType"]);
  if (unknownKey) {
    return invalid(`check_workflow_requirements does not accept ${unknownKey}.`);
  }

  if (!isNonEmptyString(args.clientId)) {
    return invalid("check_workflow_requirements requires clientId.");
  }

  if (
    !isNonEmptyString(args.workflowType) ||
    !WORKFLOW_TYPES.includes(args.workflowType as CheckWorkflowRequirementsToolArgs["workflowType"])
  ) {
    return invalid("Unsupported workflowType.");
  }

  return valid({
    clientId: args.clientId,
    workflowType: args.workflowType as CheckWorkflowRequirementsToolArgs["workflowType"],
  } satisfies CheckWorkflowRequirementsToolArgs);
}

function validateCreateSensitiveRevealArgs(args: Record<string, unknown>) {
  const unknownKey = findUnknownKey(args, [
    "clientId",
    "accountId",
    "documentId",
    "sourceId",
    "fieldKey",
    "purpose",
    "label",
  ]);
  if (unknownKey) {
    return invalid(`create_sensitive_reveal does not accept ${unknownKey}.`);
  }

  if (
    !isNonEmptyString(args.fieldKey) ||
    !SENSITIVE_REVEAL_FIELD_KEYS.includes(
      args.fieldKey as CreateSensitiveRevealToolArgs["fieldKey"],
    )
  ) {
    return invalid("create_sensitive_reveal requires a supported fieldKey.");
  }

  if (
    !isNonEmptyString(args.purpose) ||
    !REVEAL_PURPOSES.includes(args.purpose as CreateSensitiveRevealToolArgs["purpose"])
  ) {
    return invalid("create_sensitive_reveal requires a supported purpose.");
  }

  return valid({
    ...optionalString("clientId", args.clientId),
    ...optionalString("accountId", args.accountId),
    ...optionalString("documentId", args.documentId),
    ...optionalString("sourceId", args.sourceId),
    fieldKey: args.fieldKey as CreateSensitiveRevealToolArgs["fieldKey"],
    purpose: args.purpose as CreateSensitiveRevealToolArgs["purpose"],
    ...optionalString("label", args.label),
  } satisfies CreateSensitiveRevealToolArgs);
}

function safeErrorResult(toolName: V2ToolName, summary: string): V2ToolResult {
  return createToolResult({
    toolName,
    status: "error",
    summary,
    facts: [],
    missing: [],
    sourceRefs: [],
    allowedClaims: [],
    disallowedClaims: ["Do not use failed tool output as a factual source."],
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function readOptionalPositiveInteger(value: unknown, label: string) {
  if (value === undefined || value === null) {
    return { valid: true as const, value: undefined };
  }

  if (!Number.isInteger(value) || Number(value) < 1) {
    return { valid: false as const, error: `${label} must be a positive integer.` };
  }

  return { valid: true as const, value: Number(value) };
}

function optionalString(key: string, value: unknown): Record<string, string> {
  return isNonEmptyString(value) ? { [key]: value } : {};
}

function findUnknownKey(args: Record<string, unknown>, allowedKeys: string[]) {
  return Object.keys(args).find((key) => !allowedKeys.includes(key));
}

function valid(args: V2ToolArgs): ToolArgValidation {
  return { valid: true, args };
}

function invalid(error: string): ToolArgValidation {
  return { valid: false, error };
}

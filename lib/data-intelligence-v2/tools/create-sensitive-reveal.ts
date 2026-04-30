import type { RevealTokenService } from "@/lib/data-intelligence-v2/reveal-token-service";
import type { DataIntelligenceV2AuthContext } from "@/lib/data-intelligence-v2/types";
import type { CreateSensitiveRevealToolArgs } from "@/lib/data-intelligence-v2/tools/definitions";
import {
  createFact,
  createToolResult,
} from "@/lib/data-intelligence-v2/tools/result-helpers";

export async function runCreateSensitiveRevealTool(args: {
  toolArgs: CreateSensitiveRevealToolArgs;
  authContext: DataIntelligenceV2AuthContext;
  revealTokenService: RevealTokenService;
}) {
  const result = await args.revealTokenService.createRevealCard({
    authContext: args.authContext,
    requestedOwnerEmail: args.authContext.ownerEmail,
    clientId: args.toolArgs.clientId,
    accountId: args.toolArgs.accountId,
    documentId: args.toolArgs.documentId,
    sourceId: args.toolArgs.sourceId,
    fieldKey: args.toolArgs.fieldKey,
    purpose: args.toolArgs.purpose,
    label: args.toolArgs.label,
  });

  if (result.status !== "success" || !result.revealCard) {
    return createToolResult({
      toolName: "create_sensitive_reveal",
      status:
        result.status === "denied"
          ? "denied"
          : result.status === "not_found"
            ? "not_found"
            : "error",
      summary: result.summary,
      facts: [
        createFact({
          factId: `reveal:${args.toolArgs.fieldKey}:status`,
          fieldKey: revealStatusFieldKey(args.toolArgs.fieldKey),
          label: "Reveal card status",
          value: result.status,
        }),
      ],
      allowedClaims: [
        "No secure reveal card is available from this tool result.",
      ],
      disallowedClaims: [
        "Do not state the raw sensitive value in natural language.",
        "Do not include raw sensitive values in advisor/client notes.",
        "Do not infer or invent sensitive values.",
      ],
    });
  }

  return createToolResult({
    toolName: "create_sensitive_reveal",
    status: "success",
    summary:
      "A secure reveal card is available. The raw value was not shown to the model.",
    facts: [
      createFact({
        factId: `reveal:${result.revealCard.revealCardId}:status`,
        fieldKey: revealStatusFieldKey(result.revealCard.fieldKey),
        label: result.revealCard.fieldLabel,
        value: result.revealCard.status,
      }),
    ],
    secureRevealCards: [result.revealCard],
    allowedClaims: [
      "A secure reveal card is available.",
      `${result.revealCard.fieldLabel} is on file.`,
      "The raw value was not shown to the model.",
    ],
    disallowedClaims: [
      "Do not state the raw sensitive value in natural language.",
      "Do not include raw sensitive values in advisor/client notes.",
      "Do not infer or invent sensitive values.",
    ],
  });
}

function revealStatusFieldKey(fieldKey: string) {
  const statusFieldKeys: Record<string, string> = {
    "client.ssn": "client.ssnStatus",
    "client.taxId": "client.taxIdStatus",
    "client.dob": "client.dobStatus",
    "client.address": "client.addressStatus",
    "client.phone": "client.phoneStatus",
    "client.email": "client.emailStatus",
    "account.fullAccountNumber": "account.status",
    "identity.driverLicenseNumber": "identity.driverLicenseStatus",
    "identity.passportNumber": "identity.passportStatus",
    "identity.governmentIdNumber": "identity.governmentIdStatus",
  };

  return statusFieldKeys[fieldKey] ?? "workflow.requirementStatus";
}

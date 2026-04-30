import type { ClientDataGateway } from "@/lib/data-intelligence-v2/data-gateway";
import type { DataIntelligenceV2AuthContext } from "@/lib/data-intelligence-v2/types";
import type { GetIdentityStatusToolArgs } from "@/lib/data-intelligence-v2/tools/definitions";
import {
  createFact,
  createToolResult,
} from "@/lib/data-intelligence-v2/tools/result-helpers";

export async function runGetIdentityStatusTool(args: {
  toolArgs: GetIdentityStatusToolArgs;
  authContext: DataIntelligenceV2AuthContext;
  dataGateway: ClientDataGateway;
}) {
  const result = await args.dataGateway.getIdentityStatus({
    ownerEmail: args.authContext.ownerEmail,
    clientId: args.toolArgs.clientId,
    fields: args.toolArgs.fields,
  });

  if (result.statuses.length === 0) {
    return createToolResult({
      toolName: "get_identity_status",
      status: "not_found",
      summary: "No identity status records were found.",
      missing: result.missing,
      sourceRefs: result.sourceRefs,
      allowedClaims: ["No matching identity status records were found."],
    });
  }

  const facts = result.statuses.flatMap((status) => {
    const statusFacts = [
      createFact({
        factId: `identity:${args.toolArgs.clientId}:${status.field}:status`,
        fieldKey: status.fieldKey,
        label: status.label,
        value: status.status,
        sourceRefs: status.sourceRefs,
      }),
    ];

    if (status.expirationDate) {
      const expirationFieldKey =
        status.field === "drivers_license"
          ? "identity.driverLicenseExpirationDate"
          : status.field === "passport"
            ? "identity.passportExpirationDate"
            : "identity.governmentIdStatus";

      statusFacts.push(
        createFact({
          factId: `identity:${args.toolArgs.clientId}:${status.field}:expiration`,
          fieldKey: expirationFieldKey,
          label: `${status.label} expiration`,
          value: status.expirationDate,
          sourceRefs: status.sourceRefs,
        }),
      );
    }

    return statusFacts;
  });

  return createToolResult({
    toolName: "get_identity_status",
    status: "success",
    summary: `Checked ${result.statuses.length} identity status field${result.statuses.length === 1 ? "" : "s"}.`,
    facts,
    missing: result.missing,
    sourceRefs: result.sourceRefs,
    allowedClaims: result.statuses
      .filter((status) => ["on_file", "unexpired"].includes(status.status))
      .map((status) => `${status.label} is ${status.status}.`),
    disallowedClaims: [
      "Do not state raw identity values or include them in notes.",
      "Do not include masked SSN last4; secure reveal cards will handle that later.",
    ],
  });
}

import type { ClientDataGateway } from "@/lib/data-intelligence-v2/data-gateway";
import type { DataIntelligenceV2AuthContext } from "@/lib/data-intelligence-v2/types";
import type { ResolveClientToolArgs } from "@/lib/data-intelligence-v2/tools/definitions";
import {
  createFact,
  createToolResult,
} from "@/lib/data-intelligence-v2/tools/result-helpers";

export async function runResolveClientTool(args: {
  toolArgs: ResolveClientToolArgs;
  authContext: DataIntelligenceV2AuthContext;
  dataGateway: ClientDataGateway;
}) {
  const result = await args.dataGateway.resolveClient({
    ownerEmail: args.authContext.ownerEmail,
    query: args.toolArgs.query,
    limit: args.toolArgs.limit,
  });
  const candidates = result.candidates;

  if (candidates.length === 0) {
    return createToolResult({
      toolName: "resolve_client",
      status: "not_found",
      summary: "No matching client was found.",
      missing: result.missing,
      sourceRefs: result.sourceRefs,
      allowedClaims: ["No matching client was found in structured records."],
    });
  }

  const status = candidates.length === 1 ? "success" : "ambiguous";
  const facts = candidates.flatMap((candidate) => [
    createFact({
      factId: `client:${candidate.clientId}:id`,
      fieldKey: "client.id",
      label: "Client ID",
      value: candidate.clientId,
      sourceRefs: candidate.sourceRefs,
    }),
    createFact({
      factId: `client:${candidate.clientId}:name`,
      fieldKey: "client.name",
      label: "Client name",
      value: candidate.displayName,
      sourceRefs: candidate.sourceRefs,
    }),
  ]);

  return createToolResult({
    toolName: "resolve_client",
    status,
    summary:
      status === "success"
        ? `Resolved client ${candidates[0]?.displayName ?? "record"}.`
        : `Found ${candidates.length} possible clients.`,
    facts,
    sourceRefs: result.sourceRefs,
    allowedClaims:
      status === "success"
        ? ["The named client was resolved to a structured client record."]
        : ["Multiple possible client records matched the request."],
    disallowedClaims: [
      "Do not claim a specific client was selected when the result is ambiguous.",
    ],
  });
}

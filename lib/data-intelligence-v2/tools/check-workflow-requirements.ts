import type { ClientDataGateway } from "@/lib/data-intelligence-v2/data-gateway";
import type { DataIntelligenceV2AuthContext } from "@/lib/data-intelligence-v2/types";
import type { CheckWorkflowRequirementsToolArgs } from "@/lib/data-intelligence-v2/tools/definitions";
import {
  createFact,
  createToolResult,
} from "@/lib/data-intelligence-v2/tools/result-helpers";

export async function runCheckWorkflowRequirementsTool(args: {
  toolArgs: CheckWorkflowRequirementsToolArgs;
  authContext: DataIntelligenceV2AuthContext;
  dataGateway: ClientDataGateway;
}) {
  const result = await args.dataGateway.checkWorkflowRequirements({
    ownerEmail: args.authContext.ownerEmail,
    clientId: args.toolArgs.clientId,
    workflowType: args.toolArgs.workflowType,
  });

  const facts = result.requirements.map((requirement) =>
    createFact({
      factId: `workflow:${result.workflowType}:${requirement.requirementId}`,
      fieldKey: "workflow.requirementStatus",
      label: requirement.label,
      value: requirement.status,
      sourceRefs: requirement.sourceRefs,
      confidence: requirement.status === "unknown" ? "medium" : "high",
    }),
  );

  return createToolResult({
    toolName: "check_workflow_requirements",
    status: result.requirements.length > 0 ? "success" : "not_found",
    summary: `Checked ${result.workflowType} workflow requirements.`,
    facts,
    missing: result.missing,
    sourceRefs: result.sourceRefs,
    allowedClaims: result.requirements.map(
      (requirement) => `${requirement.label}: ${requirement.summary}`,
    ),
    disallowedClaims: [
      "Do not imply the workflow is complete if required items are missing, stale, or unknown.",
    ],
  });
}

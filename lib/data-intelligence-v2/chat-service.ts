import {
  createSafeErrorAssistantResponse,
  type V2AssistantResponse,
} from "@/lib/data-intelligence-v2/assistant-response";
import {
  runV2ToolLoop,
  type RunV2ToolLoopArgs,
} from "@/lib/data-intelligence-v2/tool-loop";
import {
  getDefaultDataGateway,
  getDefaultRevealTokenService,
  getDefaultV2AuditSink,
  getDefaultV2ModelAdapter,
} from "@/lib/data-intelligence-v2/service-factory";
import type { V2AuditSink } from "@/lib/data-intelligence-v2/audit";
import type {
  SafeConversationState,
  V2ToolResult,
} from "@/lib/data-intelligence-v2/types";

export type RunV2ChatTurnArgs = RunV2ToolLoopArgs;
export type { V2AuditSink };

export type V2ChatTurnResult = {
  status: "success" | "error";
  response: V2AssistantResponse;
  nextConversationState: SafeConversationState;
  toolResults: V2ToolResult[];
};

export async function runV2ChatTurn(
  args: RunV2ChatTurnArgs,
): Promise<V2ChatTurnResult> {
  try {
    const result = await runV2ToolLoop({
      ...args,
      modelAdapter: args.modelAdapter ?? getDefaultV2ModelAdapter(),
      dataGateway: args.dataGateway ?? getDefaultDataGateway(),
      revealTokenService:
        args.revealTokenService ?? getDefaultRevealTokenService(),
      auditSink: args.auditSink ?? getDefaultV2AuditSink(),
    });
    return {
      status: result.response.responseType === "error" ? "error" : "success",
      response: result.response,
      nextConversationState: result.nextConversationState,
      toolResults: result.toolResults,
    };
  } catch {
    return {
      status: "error",
      response: createSafeErrorAssistantResponse(
        "I could not safely complete that request.",
      ),
      nextConversationState: {},
      toolResults: [],
    };
  }
}

import {
  createSafeErrorAssistantResponse,
  type V2AssistantResponse,
} from "@/lib/data-intelligence-v2/assistant-response";
import type { V2ToolDefinition } from "@/lib/data-intelligence-v2/tools/definitions";
import type {
  SafeConversationState,
  V2ToolName,
  V2ToolResult,
} from "@/lib/data-intelligence-v2/types";

export type V2ModelRole = "system" | "user" | "assistant" | "tool";

export type V2ModelInputMessage = {
  role: V2ModelRole;
  content: string;
};

export type V2ModelToolCall = {
  callId: string;
  toolName: V2ToolName;
  args: Record<string, unknown>;
};

export type V2ModelToolResultMessage = {
  callId: string;
  toolName: V2ToolName;
  result: V2ToolResult;
};

export type V2ModelAdapterRequest = {
  systemPrompt: string;
  messages: V2ModelInputMessage[];
  safeConversationState: SafeConversationState;
  toolDefinitions: V2ToolDefinition[];
  previousToolResults: V2ModelToolResultMessage[];
  iteration: number;
  providerState?: unknown;
};

export type V2ModelAdapterResponse =
  | {
      type: "tool_calls";
      toolCalls: V2ModelToolCall[];
      providerState?: unknown;
    }
  | {
      type: "final_response";
      response: V2AssistantResponse;
      providerState?: unknown;
    };

export interface V2ModelAdapter {
  run(request: V2ModelAdapterRequest): Promise<V2ModelAdapterResponse>;
}

export class UnavailableV2ModelAdapter implements V2ModelAdapter {
  async run(): Promise<V2ModelAdapterResponse> {
    return {
      type: "final_response",
      response: createSafeErrorAssistantResponse(
        "The V2 model adapter is not configured yet.",
      ),
    };
  }
}

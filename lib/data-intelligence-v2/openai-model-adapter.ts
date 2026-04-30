import {
  createSafeErrorAssistantResponse,
  sanitizeV2AssistantResponseForUser,
  validateV2AssistantResponse,
} from "@/lib/data-intelligence-v2/assistant-response";
import type { DataIntelligenceV2Config } from "@/lib/data-intelligence-v2/config";
import { DEFAULT_OPENAI_BASE_URL, DEFAULT_OPENAI_TIMEOUT_MS } from "@/lib/data-intelligence-v2/config";
import {
  getOpenAIV2AssistantResponseTextFormat,
} from "@/lib/data-intelligence-v2/openai-response-schema";
import { getOpenAIV2ToolDefinitions } from "@/lib/data-intelligence-v2/openai-tool-schema";
import {
  assertNoUnsafeModelContent,
} from "@/lib/data-intelligence-v2/safe-memory";
import {
  UnavailableV2ModelAdapter,
  type V2ModelAdapter,
  type V2ModelAdapterRequest,
  type V2ModelAdapterResponse,
  type V2ModelInputMessage,
  type V2ModelToolCall,
  type V2ModelToolResultMessage,
} from "@/lib/data-intelligence-v2/model-adapter";
import { isV2ToolName } from "@/lib/data-intelligence-v2/tools/registry";

export type OpenAIResponsesCreateClient = (request: {
  url: string;
  headers: Record<string, string>;
  body: unknown;
  signal?: AbortSignal;
}) => Promise<unknown>;

export type OpenAIResponsesV2ModelAdapterOptions = {
  apiKey: string;
  model: string;
  baseUrl?: string;
  timeoutMs?: number;
  maxOutputTokens?: number;
  createClient?: OpenAIResponsesCreateClient;
};

type OpenAIProviderState = {
  responseOutputItems: unknown[];
};

export class OpenAIResponsesV2ModelAdapter implements V2ModelAdapter {
  private readonly apiKey: string;
  private readonly model: string;
  private readonly baseUrl: string;
  private readonly timeoutMs: number;
  private readonly maxOutputTokens?: number;
  private readonly createClient: OpenAIResponsesCreateClient;

  constructor(options: OpenAIResponsesV2ModelAdapterOptions) {
    if (!options.apiKey?.trim()) {
      throw new Error("OpenAI API key is required.");
    }
    if (!options.model?.trim()) {
      throw new Error("OpenAI model is required.");
    }

    this.apiKey = options.apiKey;
    this.model = options.model;
    this.baseUrl = (options.baseUrl ?? DEFAULT_OPENAI_BASE_URL).replace(/\/+$/, "");
    this.timeoutMs = options.timeoutMs ?? DEFAULT_OPENAI_TIMEOUT_MS;
    this.maxOutputTokens = options.maxOutputTokens;
    this.createClient = options.createClient ?? defaultOpenAIResponsesCreateClient;
  }

  async run(
    request: V2ModelAdapterRequest,
  ): Promise<V2ModelAdapterResponse> {
    try {
      const requestBody = buildOpenAIResponsesRequestBody({
        request,
        model: this.model,
        maxOutputTokens: this.maxOutputTokens,
      });
      assertNoUnsafeModelContent(request.systemPrompt);
      assertNoUnsafeModelContent(request.messages);
      assertNoUnsafeModelContent(request.safeConversationState);
      assertNoUnsafeModelContent(request.previousToolResults);
      assertNoUnsafeModelContent(requestBody);

      const response = await this.callResponsesApi(requestBody);
      return parseOpenAIResponse(response);
    } catch {
      return safeAdapterError("I could not safely process that request.");
    }
  }

  private async callResponsesApi(body: unknown) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      return await Promise.race([
        this.createClient({
          url: `${this.baseUrl}/responses`,
          headers: {
            Authorization: `Bearer ${this.apiKey}`,
            "Content-Type": "application/json",
          },
          body,
          signal: controller.signal,
        }),
        new Promise<never>((_, reject) => {
          setTimeout(() => reject(new Error("OpenAI Responses request timed out.")), this.timeoutMs);
        }),
      ]);
    } finally {
      clearTimeout(timeout);
    }
  }
}

export function createOpenAIResponsesV2ModelAdapterFromConfig(
  config: DataIntelligenceV2Config,
): V2ModelAdapter {
  if (!config.openAiEnabled || !config.openAiApiKey || !config.openAiModel) {
    return new UnavailableV2ModelAdapter();
  }

  return new OpenAIResponsesV2ModelAdapter({
    apiKey: config.openAiApiKey,
    model: config.openAiModel,
    baseUrl: config.openAiBaseUrl,
    timeoutMs: config.openAiTimeoutMs,
    maxOutputTokens: config.openAiMaxOutputTokens,
  });
}

function buildOpenAIResponsesRequestBody(args: {
  request: V2ModelAdapterRequest;
  model: string;
  maxOutputTokens?: number;
}) {
  const input = [
    ...messagesToResponsesInput(args.request.messages),
    stateToResponsesInput(args.request.safeConversationState),
    ...providerStateItems(args.request.providerState),
    ...toolResultsToResponsesInput(args.request.previousToolResults),
  ];

  return {
    model: args.model,
    store: false,
    instructions: args.request.systemPrompt,
    input,
    tools: getOpenAIV2ToolDefinitions(),
    tool_choice: "auto",
    parallel_tool_calls: false,
    text: {
      format: getOpenAIV2AssistantResponseTextFormat(),
    },
    ...(args.maxOutputTokens
      ? { max_output_tokens: args.maxOutputTokens }
      : {}),
  };
}

function messagesToResponsesInput(messages: V2ModelInputMessage[]) {
  return messages.map((message) => ({
    role: message.role === "assistant" ? "assistant" : "user",
    content: message.content,
  }));
}

function stateToResponsesInput(safeConversationState: unknown) {
  return {
    role: "user",
    content: `Safe conversation state:\n${JSON.stringify(safeConversationState)}`,
  };
}

function toolResultsToResponsesInput(
  previousToolResults: V2ModelToolResultMessage[],
) {
  return previousToolResults.map((toolResult) => ({
    type: "function_call_output",
    call_id: toolResult.callId,
    output: JSON.stringify({
      toolName: toolResult.toolName,
      result: toolResult.result,
    }),
  }));
}

function providerStateItems(providerState: unknown): unknown[] {
  if (!isRecord(providerState) || !Array.isArray(providerState.responseOutputItems)) {
    return [];
  }

  return providerState.responseOutputItems.filter(shouldPreserveOutputItem);
}

function parseOpenAIResponse(response: unknown): V2ModelAdapterResponse {
  if (!isRecord(response) || isRecord(response.error)) {
    return safeAdapterError("The model response could not be used safely.");
  }

  const output = Array.isArray(response.output) ? response.output : [];
  const providerState: OpenAIProviderState = {
    responseOutputItems: output.filter(shouldPreserveOutputItem),
  };
  const functionCalls = output.filter(isFunctionCallItem);

  if (functionCalls.length > 0) {
    const toolCalls: V2ModelToolCall[] = [];
    for (const item of functionCalls) {
      if (!isV2ToolName(item.name)) {
        return safeAdapterError("The model requested an unsupported tool.");
      }

      let parsedArgs: unknown;
      try {
        parsedArgs = item.arguments ? JSON.parse(item.arguments) : {};
      } catch {
        return safeAdapterError("The model provided invalid tool arguments.");
      }

      if (!isRecord(parsedArgs)) {
        return safeAdapterError("The model provided invalid tool arguments.");
      }

      toolCalls.push({
        callId: item.call_id,
        toolName: item.name,
        args: parsedArgs,
      });
    }

    return {
      type: "tool_calls",
      toolCalls,
      providerState,
    };
  }

  const finalText = extractFinalText(response, output);
  if (!finalText) {
    return safeAdapterError("The model did not return a usable response.");
  }

  try {
    const parsed = JSON.parse(finalText);
    const response = sanitizeV2AssistantResponseForUser(
      validateV2AssistantResponse(parsed),
    );
    return {
      type: "final_response",
      response,
      providerState,
    };
  } catch {
    return safeAdapterError("The model did not return valid structured JSON.");
  }
}

function extractFinalText(response: Record<string, unknown>, output: unknown[]) {
  if (typeof response.output_text === "string") {
    return response.output_text;
  }

  for (const item of output) {
    if (!isRecord(item)) {
      continue;
    }

    if (typeof item.content === "string") {
      return item.content;
    }

    if (Array.isArray(item.content)) {
      const text = item.content
        .map((contentItem) => {
          if (!isRecord(contentItem)) {
            return "";
          }
          return typeof contentItem.text === "string" ? contentItem.text : "";
        })
        .join("");
      if (text.trim()) {
        return text;
      }
    }
  }

  return undefined;
}

function shouldPreserveOutputItem(item: unknown) {
  return isRecord(item) && item.type === "function_call";
}

function isFunctionCallItem(
  item: unknown,
): item is { type: "function_call"; call_id: string; name: string; arguments: string } {
  return (
    isRecord(item) &&
    item.type === "function_call" &&
    typeof item.call_id === "string" &&
    typeof item.name === "string" &&
    typeof item.arguments === "string"
  );
}

function safeAdapterError(message: string): V2ModelAdapterResponse {
  return {
    type: "final_response",
    response: createSafeErrorAssistantResponse(message),
  };
}

async function defaultOpenAIResponsesCreateClient(args: {
  url: string;
  headers: Record<string, string>;
  body: unknown;
  signal?: AbortSignal;
}) {
  const response = await fetch(args.url, {
    method: "POST",
    headers: args.headers,
    body: JSON.stringify(args.body),
    signal: args.signal,
  });

  if (!response.ok) {
    throw new Error("OpenAI Responses request failed.");
  }

  return response.json();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

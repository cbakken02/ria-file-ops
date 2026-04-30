import type { V2ToolName } from "@/lib/data-intelligence-v2/types";
import {
  V2_TOOL_DEFINITIONS,
  type V2ToolDefinition,
} from "@/lib/data-intelligence-v2/tools/definitions";

export const V2_TOOL_REGISTRY: Record<V2ToolName, V2ToolDefinition> =
  Object.fromEntries(
    V2_TOOL_DEFINITIONS.map((definition) => [definition.name, definition]),
  ) as Record<V2ToolName, V2ToolDefinition>;

export function getV2ToolDefinition(
  toolName: V2ToolName,
): V2ToolDefinition | undefined {
  return V2_TOOL_REGISTRY[toolName];
}

export function listV2ToolDefinitions(): V2ToolDefinition[] {
  return [...V2_TOOL_DEFINITIONS];
}

export function isV2ToolName(value: unknown): value is V2ToolName {
  return (
    typeof value === "string" &&
    Object.prototype.hasOwnProperty.call(V2_TOOL_REGISTRY, value)
  );
}

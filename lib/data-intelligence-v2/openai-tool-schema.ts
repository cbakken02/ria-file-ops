import {
  V2_TOOL_DEFINITIONS,
  type V2ToolDefinition,
} from "@/lib/data-intelligence-v2/tools/definitions";

type JsonObject = Record<string, unknown>;

export function getOpenAIV2ToolDefinitions() {
  return V2_TOOL_DEFINITIONS.map(convertV2ToolDefinitionToOpenAITool);
}

export function convertV2ToolDefinitionToOpenAITool(
  definition: V2ToolDefinition,
) {
  const properties = makeOptionalPropertiesNullable(
    definition.parameters.properties,
    definition.parameters.required,
  );

  return {
    type: "function",
    name: definition.name,
    description: definition.description,
    strict: true,
    parameters: {
      type: "object",
      properties,
      required: Object.keys(properties),
      additionalProperties: false,
    },
  };
}

function makeOptionalPropertiesNullable(
  properties: Record<string, unknown>,
  originalRequired: string[],
) {
  const required = new Set(originalRequired);
  const converted: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(properties)) {
    if (required.has(key)) {
      converted[key] = value;
    } else {
      converted[key] = nullableSchema(value);
    }
  }

  return converted;
}

function nullableSchema(schema: unknown): unknown {
  if (!isObject(schema)) {
    return schema;
  }

  const type = schema.type;
  if (Array.isArray(type)) {
    return {
      ...schema,
      type: type.includes("null") ? type : [...type, "null"],
    };
  }

  if (typeof type === "string") {
    return {
      ...schema,
      type: [type, "null"],
    };
  }

  return schema;
}

function isObject(value: unknown): value is JsonObject {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

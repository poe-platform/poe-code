import { isBase64 } from "./base64.js";
import { isValidMetadataKey } from "./metadata.js";
import { isValidUri } from "./uri.js";
import { compileJsonSchema, type CompiledJsonSchema } from "toolcraft-schema";
import { inputRequestSchema } from "./input-request-schema.js";
import { isJsonValue } from "toolcraft-schema";

const validators = new Map<string, CompiledJsonSchema>();
const protocolSchema = structuredClone(inputRequestSchema);
const protocolDefinitions = protocolSchema.$defs as Record<string, Record<string, unknown>>;
for (const definition of ["MetaObject", "ResultMetaObject"] as const) {
  Object.assign(protocolDefinitions[definition], { propertyNames: { format: "mcp-metadata-key" } });
}
for (const definition of ["ClientCapabilities", "ServerCapabilities"] as const) {
  const properties = protocolDefinitions[definition]!.properties as Record<string, Record<string, unknown>>;
  Object.assign(properties.extensions!, { propertyNames: { format: "mcp-extension-key" } });
}


type ProtocolDefinition = "InputRequest" | "InputResponses" | "ClientCapabilities" | "ElicitResult" | "CreateMessageResult" | "ListRootsResult"
  | "DiscoverResult" | "ListToolsResult" | "CallToolResult" | "ListPromptsResult" | "GetPromptResult"
  | "ListResourcesResult" | "ListResourceTemplatesResult" | "ReadResourceResult" | "CompleteResult" | "Result";

const resultDefinitions: Record<string, ProtocolDefinition> = {
  "server/discover": "DiscoverResult",
  "tools/list": "ListToolsResult",
  "tools/call": "CallToolResult",
  "prompts/list": "ListPromptsResult",
  "prompts/get": "GetPromptResult",
  "resources/list": "ListResourcesResult",
  "resources/templates/list": "ListResourceTemplatesResult",
  "resources/read": "ReadResourceResult",
  "completion/complete": "CompleteResult",
  "ping": "Result",
  "logging/setLevel": "Result"
};

export function validateServerResult(method: string, value: unknown): boolean {
  const definition = Object.hasOwn(resultDefinitions, method) ? resultDefinitions[method] : undefined;
  return definition === undefined || validateProtocolValue(definition, value);
}

export function validateProtocolValue(
  definition: ProtocolDefinition,
  value: unknown
): boolean {
  if (!isJsonValue(value)) return false;
  if (definition === "ListRootsResult" && typeof value === "object" && value !== null &&
      Array.isArray((value as { roots?: unknown }).roots) &&
      !(value as { roots: Array<{ uri?: unknown }> }).roots.every((root) =>
        typeof root?.uri === "string" && root.uri.startsWith("file://") && isValidUri(root.uri))) return false;

  let validator = validators.get(definition);
  if (validator === undefined) {
    validator = compileJsonSchema({ ...protocolSchema, $ref: `#/$defs/${definition}` }, {
      formats: {
        "mcp-metadata-key": isValidMetadataKey,
        "mcp-extension-key": (key) => key.includes("/") && isValidMetadataKey(key),
        uri: isValidUri, byte: isBase64
      }
    });
    validators.set(definition, validator);
  }
  return validator.validate(value).ok;
}

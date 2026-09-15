import { JSON_RPC_ERROR_CODES, type HandleResult, type JSONRPCError } from "./types.js";
import { isJsonValue } from "./json-value.js";
import { validateProtocolValue } from "./protocol-validation.js";
import { inspectSamplingMessages, type SamplingMessage } from "./sampling-messages.js";

export const MODERN_PROTOCOL_VERSION = "2026-07-28";

const removedMethods = new Set([
  "initialize",
  "notifications/initialized",
  "ping",
  "logging/setLevel",
  "resources/subscribe",
  "resources/unsubscribe",
  "notifications/roots/list_changed"
]);
const cacheableMethods = new Set([
  "server/discover",
  "tools/list",
  "prompts/list",
  "resources/list",
  "resources/templates/list",
  "resources/read"
]);
const inputRequiredMethods = new Set(["tools/call", "prompts/get", "resources/read"]);
const inputRequestCapabilities: Record<string, string> = {
  "roots/list": "roots",
  "sampling/createMessage": "sampling",
  "elicitation/create": "elicitation"
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function selectRequestProtocol(
  method: string,
  params: Record<string, unknown> | undefined,
  legacyVersions: ReadonlySet<string>
): { modern: boolean; error?: JSONRPCError } {
  const metadata = params?._meta;
  const invalid = {
    modern: false,
    error: {
      code: JSON_RPC_ERROR_CODES.INVALID_PARAMS,
      message: "Request metadata must include protocolVersion and clientCapabilities"
    }
  };
  if (!Object.prototype.hasOwnProperty.call(params ?? {}, "_meta"))
    return method === "server/discover" ? invalid : { modern: false };
  if (!isRecord(metadata)) return invalid;
  const versionKey = "io.modelcontextprotocol/protocolVersion";
  const capabilitiesKey = "io.modelcontextprotocol/clientCapabilities";
  if (!(versionKey in metadata) && !(capabilitiesKey in metadata) && method !== "server/discover") {
    return { modern: false };
  }
  const version = metadata[versionKey];
  if (
    !Object.prototype.hasOwnProperty.call(metadata, versionKey) ||
    typeof version !== "string" ||
    !Object.prototype.hasOwnProperty.call(metadata, capabilitiesKey) ||
    !isRecord(metadata[capabilitiesKey])
  )
    return invalid;
  if (version !== MODERN_PROTOCOL_VERSION && !legacyVersions.has(version)) {
    return {
      modern: false,
      error: {
        code: JSON_RPC_ERROR_CODES.UNSUPPORTED_PROTOCOL_VERSION,
        message: "Unsupported protocol version",
        data: { requested: version, supported: [...legacyVersions].reverse() }
      }
    };
  }
  const modern = version === MODERN_PROTOCOL_VERSION;
  if (modern && !validateProtocolValue("ClientCapabilities", metadata[capabilitiesKey])) {
    return { modern, error: {
      code: JSON_RPC_ERROR_CODES.INVALID_PARAMS, message: "Invalid MCP clientCapabilities"
    } };
  }
  if (
    modern &&
    ((params?.requestState !== undefined && typeof params.requestState !== "string") ||
      (params?.inputResponses !== undefined && !validateProtocolValue("InputResponses", params.inputResponses)))
  ) {
    return {
      modern,
      error: { code: JSON_RPC_ERROR_CODES.INVALID_PARAMS, message: "Invalid MCP retry parameters" }
    };
  }
  if (modern && removedMethods.has(method)) {
    return {
      modern,
      error: { code: JSON_RPC_ERROR_CODES.METHOD_NOT_FOUND, message: "Method not found" }
    };
  }
  return { modern };
}

export function validateInputRequiredResult(
  method: string,
  value: Record<string, unknown>,
  clientCapabilities: Record<string, unknown>
): HandleResult | undefined {
  const requests = value.inputRequests;
  const requiredCapabilities: Record<string, Record<string, unknown>> = {};
  const invalidRequests =
    requests !== undefined &&
    (!isRecord(requests) || !isJsonValue(requests) ||
      Object.values(requests).some((request) => {
        if (!isRecord(request) || typeof request.method !== "string") return true;
        if (!validateProtocolValue("InputRequest", request)) return true;
        const sampling = request.method === "sampling/createMessage"
          ? inspectSamplingMessages((request.params as { messages: SamplingMessage[] }).messages)
          : undefined;
        if (sampling?.valid === false) return true;
        if (request.method === "elicitation/create" &&
            (request.params as Record<string, unknown>).mode === "url") {
          try { new URL((request.params as Record<string, unknown>).url as string); }
          catch { return true; }
        }
        const capability = Object.prototype.hasOwnProperty.call(
          inputRequestCapabilities,
          request.method
        )
          ? inputRequestCapabilities[request.method]
          : undefined;
        if (capability === undefined || (request.params !== undefined && !isRecord(request.params)))
          return true;
        const supported = Object.prototype.hasOwnProperty.call(clientCapabilities, capability)
          ? clientCapabilities[capability] : undefined;
        if (!isRecord(supported)) requiredCapabilities[capability] = {};
        else if (capability === "elicitation") {
          const mode = (request.params as Record<string, unknown>).mode ?? "form";
          const implicitForm = mode === "form" && Object.keys(supported).length === 0;
          if (!implicitForm && (typeof mode !== "string" ||
              !Object.prototype.hasOwnProperty.call(supported, mode) || !isRecord(supported[mode]))) {
            const required = requiredCapabilities.elicitation ??= {};
            required[String(mode)] = {};
          }
        } else if (capability === "sampling") {
          const params = request.params as Record<string, unknown>;
          if ((params.tools !== undefined || params.toolChoice !== undefined || sampling?.usesTools === true) &&
              (!Object.prototype.hasOwnProperty.call(supported, "tools") || !isRecord(supported.tools))) {
            const required = requiredCapabilities.sampling ??= {};
            required.tools = {};
          }
        }
        return false;
      }));
  if (
    !inputRequiredMethods.has(method) ||
    (requests === undefined && value.requestState === undefined) ||
    (value.requestState !== undefined && typeof value.requestState !== "string") ||
    invalidRequests
  ) {
    return {
      error: {
        code: JSON_RPC_ERROR_CODES.INTERNAL_ERROR,
        message: "Invalid MCP input_required result"
      }
    };
  }
  if (Object.keys(requiredCapabilities).length > 0) {
    return { error: {
      code: -32021,
      message: "Missing required client capability",
      data: { requiredCapabilities }
    } };
  }
}

export function decorateModernResult(
  method: string,
  handled: HandleResult,
  serverInfo: { name: string; version: string },
  clientCapabilities: Record<string, unknown> = {}
): HandleResult {
  if (handled.error !== undefined) {
    return handled.error.code === JSON_RPC_ERROR_CODES.RESOURCE_NOT_FOUND
      ? { error: { ...handled.error, code: JSON_RPC_ERROR_CODES.INVALID_PARAMS } }
      : handled;
  }
  if (handled.result === undefined && method.startsWith("notifications/")) return handled;
  const value = handled.result;
  if (!isRecord(value))
    return {
      error: {
        code: JSON_RPC_ERROR_CODES.INTERNAL_ERROR,
        message: "MCP result must be an object"
      }
    };
  if (
    value.resultType !== undefined &&
    value.resultType !== "complete" &&
    value.resultType !== "input_required"
  ) {
    return {
      error: { code: JSON_RPC_ERROR_CODES.INTERNAL_ERROR, message: "Unrecognized MCP resultType" }
    };
  }
  if (value.resultType === "input_required") {
    const invalid = validateInputRequiredResult(method, value, clientCapabilities);
    if (invalid !== undefined) return invalid;
  }
  const result = {
    ...value,
    resultType: value.resultType ?? "complete",
    _meta: {
      ...(isRecord(value._meta) ? value._meta : {}),
      "io.modelcontextprotocol/serverInfo": { ...serverInfo }
    }
  };
  if (cacheableMethods.has(method) && result.resultType === "complete") {
    if (
      value.ttlMs !== undefined &&
      (!Number.isSafeInteger(value.ttlMs) || (value.ttlMs as number) < 0)
    ) {
      return {
        error: {
          code: JSON_RPC_ERROR_CODES.INTERNAL_ERROR,
          message: "MCP cache ttlMs must be a nonnegative safe integer"
        }
      };
    }
    if (
      value.cacheScope !== undefined &&
      value.cacheScope !== "public" &&
      value.cacheScope !== "private"
    ) {
      return {
        error: {
          code: JSON_RPC_ERROR_CODES.INTERNAL_ERROR,
          message: "MCP cacheScope must be public or private"
        }
      };
    }
    return {
      result: { ...result, ttlMs: value.ttlMs ?? 0, cacheScope: value.cacheScope ?? "private" }
    };
  }
  return { result };
}

export { validateProtocolValue } from "./protocol-validation.js";

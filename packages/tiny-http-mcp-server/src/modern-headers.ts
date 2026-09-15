import type { IncomingHttpHeaders } from "node:http";
import {
  JSON_RPC_ERROR_CODES,
  type JSONRPCError,
  type JSONRPCNotification,
  type JSONRPCRequest
} from "tiny-stdio-mcp-server";

import { decodeHeaderValue } from "tiny-stdio-mcp-server/headers";

export function validateModernHeaders(
  headers: IncomingHttpHeaders,
  request: JSONRPCRequest | JSONRPCNotification
): JSONRPCError | undefined {
  const metadata = request.params?._meta;
  const version =
    typeof metadata === "object" && metadata !== null
      ? (metadata as Record<string, unknown>)["io.modelcontextprotocol/protocolVersion"]
      : undefined;
  if (typeof version !== "string")
    return {
      code: JSON_RPC_ERROR_CODES.INVALID_PARAMS,
      message: "Missing protocol version request metadata"
    };
  const expected: Record<string, unknown> = { "mcp-protocol-version": version };
  // Notifications require the protocol version header but no method/name mirrors.
  if ("id" in request) {
    expected["mcp-method"] = request.method;
    if (request.method === "tools/call" || request.method === "prompts/get")
      expected["mcp-name"] = request.params?.name;
    else if (request.method === "resources/read") expected["mcp-name"] = request.params?.uri;
  }
  for (const [field, value] of Object.entries(expected)) {
    const header = headers[field];
    const actual =
      field === "mcp-name"
        ? decodeHeaderValue(header)
        : typeof header === "string"
          ? header
          : undefined;
    if (typeof value !== "string" || actual === undefined || actual !== value)
      return {
        code: -32020,
        message: `Header mismatch: ${field} must match the request body`
      };
  }
}

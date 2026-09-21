import { createRequire } from "node:module";
export { JsonRpcMessageLayer } from "./layer.js";
export { McpClient } from "./client.js";
const native = createRequire(import.meta.url)("./tiny-mcp-client-rust.node");
export const ERROR_PARSE = -32700;
export const ERROR_INVALID_REQUEST = -32600;
export const ERROR_METHOD_NOT_FOUND = -32601;
export const ERROR_INVALID_PARAMS = -32602;
export const ERROR_INTERNAL = -32603;
export class McpError extends Error {
  constructor(code, message, data) {
    super(message);
    this.name = "McpError";
    this.code = code;
    this.data = data;
  }
}
export function parseJsonRpcMessage(line) {
  const parsed = native.parseJsonRpcMessage(line);
  if (parsed.type === "invalid")
    parsed.error = new McpError(parsed.error.code, parsed.error.message);
  return parsed;
}
export { createInMemoryTransportPair, StdioTransport } from "./transports.js";
export { createSdkTestPair, createTestPair } from "./sdk.js";
export { parseBearerWwwAuthenticateHeader, OAuthMetadataDiscovery, discoverOAuthMetadata,
  resolveAuthorizationServerMetadataUrl, resolveProtectedResourceMetadataUrl } from "./oauth-discovery.js";
export { fetchMcpResponse } from "./oauth/http.js";
export { HttpTransport, HttpTransportError } from "./http-transport.js";

export const MCP_PROTOCOL_VERSIONS = Object.freeze(["2025-03-26", "2025-06-18", "2025-11-25", "2026-07-28"]);

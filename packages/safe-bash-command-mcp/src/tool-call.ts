import type { CallToolParams, CallToolResult } from "tiny-mcp-client";
import { isJsonValue } from "toolcraft-schema";
import { commandLimit } from "./commands.js";
import { remoteLimits, withRemoteMcpClient } from "./remote.js";
import { preflightRemoteMcpServers, snapshotRemoteMcpServer, type RemoteMcpServer, type SchemaFetchOptions } from "./schema.js";
import { snapshotRemoteMcpSchemaOptions } from "./schema-options.js";

export interface RemoteMcpToolCallOptions extends SchemaFetchOptions {
  readonly maxInputBytes?: number;
}
export type RemoteMcpToolCallParams = CallToolParams;
export type RemoteMcpToolCallResult = CallToolResult;

/** Call a known tool without schema discovery, owning the connection through cleanup. */
export async function callRemoteMcpTool(
  server: RemoteMcpServer,
  params: RemoteMcpToolCallParams,
  options: RemoteMcpToolCallOptions = {}
): Promise<RemoteMcpToolCallResult> {
  const maxInputBytes = commandLimit(options.maxInputBytes ?? Infinity, "maxInputBytes");
  options = snapshotRemoteMcpSchemaOptions(options);
  options.signal?.throwIfAborted();
  const limits = remoteLimits(options);
  if (!isJsonValue(params, { maxNodes: Infinity, maxDepth: Infinity }) || params === null ||
      Array.isArray(params) || typeof params !== "object" || typeof params.name !== "string" || params.name.length === 0 ||
      (params.arguments !== undefined && (params.arguments === null || Array.isArray(params.arguments) || typeof params.arguments !== "object")))
    throw new Error("Invalid remote MCP tool call");
  const request = structuredClone(params);
  if (new TextEncoder().encode(JSON.stringify(request)).byteLength > maxInputBytes)
    throw new Error("MCP tool input byte limit exceeded");
  preflightRemoteMcpServers([server], options);
  const owned = snapshotRemoteMcpServer(server);
  const signal = limits.requestTimeoutMs === Infinity ? options.signal
    : options.signal === undefined ? AbortSignal.timeout(limits.requestTimeoutMs) : AbortSignal.any([options.signal, AbortSignal.timeout(limits.requestTimeoutMs)]);
  return withRemoteMcpClient(owned, { ...options, signal }, async client => {
    const result = await client.callTool(request, { signal });
    signal?.throwIfAborted();
    return structuredClone(result);
  });
}

import { snapshotRemoteMcpSchemaOptions } from "./schema-options.js";
import type { McpClient } from "tiny-mcp-client";
import { isJsonValue } from "toolcraft-schema";
import { commandLimit } from "./commands.js";
import { remoteLimits, withRemoteMcpClient } from "./remote.js";
import { preflightRemoteMcpServers, snapshotRemoteMcpServer, type RemoteMcpServer, type SchemaFetchOptions } from "./schema.js";

export type RemoteMcpResourceRequest =
  | { readonly operation: "list" | "templates"; readonly cursor?: string }
  | { readonly operation: "read"; readonly uri: string };
export interface RemoteMcpResourceOptions extends SchemaFetchOptions {
  readonly maxInputBytes?: number;
}
export type RemoteMcpResourceResult = Awaited<ReturnType<McpClient["listResources"]>>
  | Awaited<ReturnType<McpClient["listResourceTemplates"]>> | Awaited<ReturnType<McpClient["readResource"]>>;

export function snapshotRemoteMcpResourceRequest(request: RemoteMcpResourceRequest, maxInputBytes: number): RemoteMcpResourceRequest {
  if (!isJsonValue(request) || request === null || Array.isArray(request) || typeof request !== "object")
    throw new Error("Invalid remote MCP resource request");
  const operation = request.operation;
  if (operation !== "list" && operation !== "templates" && operation !== "read") throw new Error("Unknown remote MCP resource operation");
  const allowed = operation === "read" ? ["operation", "uri"] : ["operation", "cursor"];
  if (Object.keys(request).some(key => !allowed.includes(key))) throw new Error("Unexpected remote MCP resource request field");
  const snapshot = structuredClone(request);
  if (Buffer.byteLength(JSON.stringify(snapshot), "utf8") > maxInputBytes) throw new Error("MCP resource input byte limit exceeded");
  if (snapshot.operation === "read") {
    if (typeof snapshot.uri !== "string" || snapshot.uri.length === 0 || [...snapshot.uri].some(char => char.trim() === "" || char.codePointAt(0)! < 32 || (char.codePointAt(0)! >= 127 && char.codePointAt(0)! <= 159)))
      throw new Error("MCP resource URI must be an absolute URI without whitespace or controls");
    try { new URL(snapshot.uri); }
    catch { throw new Error("MCP resource URI must be absolute"); }
  } else if (snapshot.cursor !== undefined && typeof snapshot.cursor !== "string") throw new Error("MCP resource cursor must be a string");
  return snapshot;
}

/** Access a remote resource directly, preserving one page/result without tool discovery. */
export async function accessRemoteMcpResources(
  server: RemoteMcpServer,
  request: RemoteMcpResourceRequest,
  options: RemoteMcpResourceOptions = {}
): Promise<RemoteMcpResourceResult> {
  options.signal?.throwIfAborted();
  const limits = remoteLimits(options);
  const snapshot = snapshotRemoteMcpResourceRequest(request, commandLimit(options.maxInputBytes ?? 1024 * 1024, "maxInputBytes"));
  preflightRemoteMcpServers([server], options);
  const { tools: ignoredTools, ...connection } = server;
  const owned = snapshotRemoteMcpServer(connection);
  const deadline = AbortSignal.timeout(limits.requestTimeoutMs);
  const signal = options.signal === undefined ? deadline : AbortSignal.any([options.signal, deadline]);
  return withRemoteMcpClient(owned, { ...snapshotRemoteMcpSchemaOptions(options), signal }, async client => {
    const result = snapshot.operation === "read" ? await client.readResource({ uri: snapshot.uri }, { signal })
      : snapshot.operation === "templates" ? await client.listResourceTemplates(snapshot.cursor === undefined ? {} : { cursor: snapshot.cursor }, { signal })
        : await client.listResources(snapshot.cursor === undefined ? {} : { cursor: snapshot.cursor }, { signal });
    return structuredClone(result);
  });
}

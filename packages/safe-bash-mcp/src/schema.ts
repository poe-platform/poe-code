import {
  HttpTransport,
  HttpTransportError,
  McpClient,
  type HttpTransportOptions,
  type Implementation,
  type ServerCapabilities,
  type Tool
} from "tiny-mcp-client";

/** A caller-owned remote registry entry. An empty tools array disables discovery. */
export interface RemoteMcpServer {
  readonly name: string;
  readonly url: string;
  readonly transport?: "http" | "sse";
  readonly tools?: readonly Tool[];
  readonly headers?: HttpTransportOptions["headers"];
  readonly oauth?: HttpTransportOptions["oauth"];
  readonly protocolVersion?: "2025-03-26" | "2026-07-28";
}

export interface RemoteMcpSchema {
  readonly name: string;
  readonly url: string;
  readonly source: "provided" | "discovered";
  readonly tools: Tool[];
  readonly serverInfo?: Implementation;
  readonly capabilities?: ServerCapabilities;
  readonly instructions?: string;
}

export interface SchemaFetchOptions {
  readonly signal?: AbortSignal;
  readonly fetch?: HttpTransportOptions["fetch"];
  readonly oauthDiscoveryCache?: HttpTransportOptions["oauthDiscoveryCache"];
  readonly onWarning?: HttpTransportOptions["onWarning"];
  readonly maxPages?: number;
  readonly maxTools?: number;
  readonly maxResponseBytes?: number;
  readonly requestTimeoutMs?: number;
}

function positiveLimit(value: number, name: string): number {
  if (!Number.isSafeInteger(value) || value < 1)
    throw new Error(`${name} must be a positive safe integer`);
  return value;
}

function limitsFor(options: SchemaFetchOptions) {
  return {
    maxPages: positiveLimit(options.maxPages ?? 100, "maxPages"),
    maxTools: positiveLimit(options.maxTools ?? 10_000, "maxTools"),
    maxResponseBytes: positiveLimit(options.maxResponseBytes ?? 16 * 1024 * 1024, "maxResponseBytes"),
    requestTimeoutMs: positiveLimit(options.requestTimeoutMs ?? 30_000, "requestTimeoutMs")
  };
}

function object(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function appendTools(target: Tool[], incoming: readonly Tool[], names: Set<string>, maxTools: number): void {
  if (!Array.isArray(incoming)) throw new Error("Tool schemas must be an array");
  if (target.length + incoming.length > maxTools) throw new Error("MCP schema tool limit exceeded");
  for (const tool of incoming) {
    const candidate: unknown = tool;
    if (!object(candidate) || typeof candidate.name !== "string" || candidate.name.length === 0 || !object(candidate.inputSchema))
      throw new Error("Invalid MCP tool schema: expected name and inputSchema");
    if (tool.outputSchema !== undefined && !object(tool.outputSchema))
      throw new Error(`Invalid outputSchema for tool '${tool.name}'`);
    if (names.has(tool.name)) throw new Error(`Duplicate tool '${tool.name}'`);
    names.add(tool.name);
    target.push(structuredClone(tool));
  }
}

function validateServer(server: RemoteMcpServer, maxTools: number): void {
  if (typeof server.name !== "string" || server.name.trim().length === 0)
    throw new Error("Remote MCP server name is required");
  if (typeof server.url !== "string") throw new Error("Remote MCP server URL is required");
  const url = new URL(server.url);
  if (url.protocol !== "https:" && url.protocol !== "http:")
    throw new Error("Only remote HTTP and SSE MCP servers are supported");
  if (url.username || url.password) throw new Error("MCP URL credentials must be supplied using headers or OAuth");
  if (url.hash) throw new Error("MCP URLs cannot contain fragments");
  if (server.transport !== undefined && server.transport !== "http" && server.transport !== "sse")
    throw new Error("Unsupported remote MCP transport; use http or sse");
  if (server.tools !== undefined) appendTools([], server.tools, new Set(), maxTools);
}

/** Discover every tool page, or return an isolated copy of authoritative supplied schemas. */
export async function fetchRemoteMcpSchema(
  server: RemoteMcpServer,
  options: SchemaFetchOptions = {}
): Promise<RemoteMcpSchema> {
  options.signal?.throwIfAborted();
  const limits = limitsFor(options);
  validateServer(server, limits.maxTools);
  if (server.tools !== undefined) {
    return { name: server.name, url: server.url, source: "provided", tools: structuredClone([...server.tools]) };
  }
  return discoverRemoteSchema(server, options, limits, server.transport === "sse" ? "sse" : "streamable-http");
}

async function discoverRemoteSchema(
  server: RemoteMcpServer,
  options: SchemaFetchOptions,
  limits: ReturnType<typeof limitsFor>,
  mode: "sse" | "streamable-http"
): Promise<RemoteMcpSchema> {
  const client = new McpClient({
    clientInfo: { name: "safe-bash-mcp", version: "0.0.1" },
    protocolVersion: server.protocolVersion,
    requestTimeoutMs: limits.requestTimeoutMs
  });
  const transport = new HttpTransport({
    url: server.url,
    mode,
    headers: server.headers,
    oauth: server.oauth,
    fetch: options.fetch,
    oauthDiscoveryCache: options.oauthDiscoveryCache,
    onWarning: options.onWarning,
    maxResponseBytes: limits.maxResponseBytes
  });
  try {
    try {
      await client.connect(transport, { signal: options.signal });
    } catch (primaryError) {
      options.signal?.throwIfAborted();
      if (server.transport !== undefined || mode !== "streamable-http" ||
          !(primaryError instanceof HttpTransportError) || primaryError.method !== "POST" ||
          (primaryError.status !== 404 && primaryError.status !== 405)) throw primaryError;
      await client.close();
      transport.dispose();
      await transport.closed;
      options.signal?.throwIfAborted();
      try {
        return await discoverRemoteSchema(server, options, limits, "sse");
      } catch (fallbackError) {
        options.signal?.throwIfAborted();
        throw new AggregateError([primaryError, fallbackError], "Remote MCP HTTP and legacy SSE discovery failed", { cause: primaryError });
      }
    }
    const tools: Tool[] = [];
    const names = new Set<string>();
    const cursors = new Set<string>();
    let cursor: string | undefined;
    for (let page = 0; page < limits.maxPages; page++) {
      options.signal?.throwIfAborted();
      const result = await client.listTools(cursor === undefined ? {} : { cursor }, { signal: options.signal });
      appendTools(tools, result.tools, names, limits.maxTools);
      if (result.nextCursor === undefined) {
        return {
          name: server.name,
          url: server.url,
          source: "discovered",
          tools,
          ...(client.serverInfo === null ? {} : { serverInfo: client.serverInfo }),
          ...(client.serverCapabilities === null ? {} : { capabilities: client.serverCapabilities }),
          ...(client.instructions === undefined ? {} : { instructions: client.instructions })
        };
      }
      if (typeof result.nextCursor !== "string") throw new Error("Invalid MCP pagination cursor");
      if (cursors.has(result.nextCursor)) throw new Error("MCP schema pagination cursor cycle detected");
      cursors.add(result.nextCursor);
      cursor = result.nextCursor;
    }
    throw new Error("MCP schema page limit exceeded");
  } finally {
    await client.close();
    transport.dispose();
    await transport.closed;
  }
}

/** Validate the complete registry before connecting, then preserve caller order. */
export async function resolveRemoteMcpSchemas(
  servers: readonly RemoteMcpServer[],
  options: SchemaFetchOptions = {}
): Promise<RemoteMcpSchema[]> {
  options.signal?.throwIfAborted();
  const limits = limitsFor(options);
  const names = new Set<string>();
  for (const server of servers) {
    validateServer(server, limits.maxTools);
    if (names.has(server.name)) throw new Error(`Duplicate server '${server.name}'`);
    names.add(server.name);
  }
  const schemas: RemoteMcpSchema[] = [];
  for (const server of servers) schemas.push(await fetchRemoteMcpSchema(server, options));
  return schemas;
}

import { snapshotOAuthBrowserOptions, snapshotOAuthPersistenceOptions } from "./oauth-policy.js";
import {
  MCP_PROTOCOL_VERSIONS,
  snapshotHttpTransportHeaders,
  type McpProtocolVersion,
  type HttpTransportOptions,
  type ElicitationParams,
  type ElicitationResult,
  type McpRequestContext,
  type Implementation,
  type ServerCapabilities,
  type Tool
} from "tiny-mcp-client";
import { remoteLimits, withRemoteMcpClient } from "./remote.js";

/** A caller-owned remote registry entry. An empty tools array disables discovery. */
export interface RemoteMcpServer {
  readonly name: string;
  readonly url: string;
  readonly transport?: "http" | "sse";
  readonly tools?: readonly Tool[];
  readonly instructions?: string;
  readonly headers?: HttpTransportOptions["headers"];
  readonly oauth?: HttpTransportOptions["oauth"];
  readonly protocolVersion?: McpProtocolVersion;
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
  /** Bounds each complete JSON response body or individual SSE event. */
  readonly maxResponseBytes?: number;
  readonly requestTimeoutMs?: number;
  /** Handle server input explicitly. Without a hook, input is declined. */
  readonly onElicitationRequest?: RemoteMcpElicitationHandler;
}

export interface RemoteMcpElicitationContext extends McpRequestContext {
  readonly server: { readonly name: string; readonly url: string };
}
export type RemoteMcpElicitationHandler = (params: ElicitationParams, context: RemoteMcpElicitationContext) => ElicitationResult | Promise<ElicitationResult>;

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
  if (url.href.includes("#")) throw new Error("MCP URLs cannot contain fragments");
  if (server.transport !== undefined && server.transport !== "http" && server.transport !== "sse")
    throw new Error("Unsupported remote MCP transport; use http or sse");
  if (server.protocolVersion !== undefined && !MCP_PROTOCOL_VERSIONS.includes(server.protocolVersion))
    throw new Error(`Unsupported protocolVersion; use ${MCP_PROTOCOL_VERSIONS.join(", ")}`);
  if (server.instructions !== undefined && typeof server.instructions !== "string")
    throw new Error("MCP instructions must be a string");
  if (server.tools !== undefined) appendTools([], server.tools, new Set(), maxTools);
}

export function snapshotRemoteMcpServer(server: RemoteMcpServer): RemoteMcpServer {
  return {
    ...server, headers: snapshotHttpTransportHeaders(server.headers),
    ...(server.oauth === undefined ? {} : { oauth: snapshotOAuthOptions(server.oauth) }),
    ...(server.tools === undefined ? {} : { tools: structuredClone([...server.tools]) })
  };
}

function snapshotOAuthOptions(oauth: NonNullable<RemoteMcpServer["oauth"]>): NonNullable<RemoteMcpServer["oauth"]> {
  if ("provider" in oauth) return { provider: oauth.provider };
  const initialGrant = oauth.initialGrant;
  const timing = initialGrant === undefined ? undefined : Object.fromEntries(
    (["expiresAt", "expiresIn", "issuedAt"] as const).filter(field => Object.hasOwn(initialGrant.tokens, field))
      .map(field => [field, initialGrant.tokens[field]])
  );
  return {
    ...oauth,
    client: { ...oauth.client,
      ...(oauth.client.metadata === undefined ? {} : { metadata: { ...oauth.client.metadata } }),
      ...(oauth.client.registration === undefined ? {} : { registration: structuredClone(oauth.client.registration) }) },
    browser: snapshotOAuthBrowserOptions(oauth.browser),
    ...(initialGrant === undefined ? {} : { initialGrant: { ...initialGrant, tokens: { ...initialGrant.tokens, ...timing } } }),
    ...(oauth.authStore === undefined ? {} : { authStore: snapshotOAuthPersistenceOptions(oauth.authStore) })
  };
}

/** Discover every tool page, or return an isolated copy of authoritative supplied schemas. */
export async function fetchRemoteMcpSchema(
  server: RemoteMcpServer,
  options: SchemaFetchOptions = {}
): Promise<RemoteMcpSchema> {
  options = { ...options };
  options.signal?.throwIfAborted();
  const limits = remoteLimits(options);
  validateServer(server, limits.maxTools);
  server = snapshotRemoteMcpServer(server);
  const instructions = server.instructions;
  if (server.tools !== undefined) {
    return { name: server.name, url: server.url, source: "provided", tools: structuredClone([...server.tools]),
      ...(instructions === undefined ? {} : { instructions }) };
  }
  return withRemoteMcpClient(server, options, async client => {
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
          ...(instructions === undefined && client.instructions === undefined ? {} : { instructions: instructions ?? client.instructions })
        };
      }
      if (typeof result.nextCursor !== "string") throw new Error("Invalid MCP pagination cursor");
      if (cursors.has(result.nextCursor)) throw new Error("MCP schema pagination cursor cycle detected");
      cursors.add(result.nextCursor);
      cursor = result.nextCursor;
    }
    throw new Error("MCP schema page limit exceeded");
  });
}

/** Preflight every remote registry entry before any connection or generation. */
export function preflightRemoteMcpServers(servers: readonly RemoteMcpServer[], options: SchemaFetchOptions = {}): void {
  options.signal?.throwIfAborted();
  const limits = remoteLimits(options);
  const names = new Set<string>();
  for (const server of servers) {
    validateServer(server, limits.maxTools);
    if (names.has(server.name)) throw new Error(`Duplicate server '${server.name}'`);
    names.add(server.name);
  }
}

/** Validate the complete registry before connecting, then preserve caller order. */
export async function resolveRemoteMcpSchemas(
  servers: readonly RemoteMcpServer[],
  options: SchemaFetchOptions = {}
): Promise<RemoteMcpSchema[]> {
  options = { ...options };
  preflightRemoteMcpServers(servers, options);
  const snapshots = servers.map(snapshotRemoteMcpServer);
  const schemas: RemoteMcpSchema[] = [];
  for (const server of snapshots) schemas.push(await fetchRemoteMcpSchema(server, options));
  return schemas;
}

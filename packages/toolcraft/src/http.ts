import "./node-require-shim.js";
import {
  createHttpServer,
  type HttpListenOptions,
  type HttpServer,
  type HttpServerHandle,
  type HttpToolContext,
  type HttpTransportOptions
} from "tiny-http-mcp-server/server";
import type { Group } from "./index.js";
import {
  createMCPServerForTransport,
  type RunMCPOptions
} from "./mcp.js";
import { enableSourceMaps } from "./stack-trim.js";

export type ToolcraftHTTPContext = HttpToolContext;
export type ToolcraftHTTPServer = HttpServer;
export type ToolcraftHTTPServerHandle = HttpServerHandle;

type HTTPTransportControls = Omit<
  HttpTransportOptions,
  "name" | "version" | "validateToolArguments"
>;
type HTTPListenControls = Omit<HttpListenOptions, "port" | "hostname" | "path">;

export interface RunHTTPMCPOptions<TServices extends object = Record<string, unknown>>
  extends RunMCPOptions<TServices>,
    HTTPTransportControls,
    HTTPListenControls {
  hostname?: string;
  port?: number;
  path?: string;
  requestServices?(
    context: ToolcraftHTTPContext
  ): Partial<TServices> | Promise<Partial<TServices>>;
}

function createTransportOptions<TServices extends object>(
  options: RunHTTPMCPOptions<TServices>,
  serverOptions: { name: string; version: string; validateToolArguments: false }
): HttpTransportOptions {
  return {
    ...serverOptions,
    toolCallTimeoutMs: options.toolCallTimeoutMs,
    sessionIdGenerator: options.sessionIdGenerator,
    enableJsonResponse: options.enableJsonResponse,
    allowedOrigins: options.allowedOrigins,
    allowedHosts: options.allowedHosts,
    maxRequestBytes: options.maxRequestBytes,
    maxBatchSize: options.maxBatchSize,
    maxSessions: options.maxSessions,
    sessionTtlMs: options.sessionTtlMs,
    maxStreamsPerSession: options.maxStreamsPerSession,
    maxStreamBufferBytes: options.maxStreamBufferBytes,
    maxSseEventHistory: options.maxSseEventHistory,
    sseKeepAliveMs: options.sseKeepAliveMs,
    maxConcurrentToolCalls: options.maxConcurrentToolCalls,
    sessionStore: options.sessionStore,
    requestIdGenerator: options.requestIdGenerator,
    observability: options.observability,
    trustedProxy: options.trustedProxy,
    oauth: options.oauth
  };
}

function createListenOptions<TServices extends object>(
  options: RunHTTPMCPOptions<TServices>
): HttpListenOptions {
  return {
    hostname: options.hostname,
    port: options.port,
    path: options.path,
    signal: options.signal,
    requestTimeoutMs: options.requestTimeoutMs,
    headersTimeoutMs: options.headersTimeoutMs,
    keepAliveTimeoutMs: options.keepAliveTimeoutMs
  };
}

export async function createHTTPMCPServer<
  TServices extends object = Record<string, unknown>
>(
  roots: Group<TServices> | Group<TServices>[],
  options: RunHTTPMCPOptions<TServices>
): Promise<ToolcraftHTTPServer> {
  let server: ToolcraftHTTPServer | undefined;
  await createMCPServerForTransport(roots, options, {
    createServer(serverOptions) {
      server = createHttpServer(createTransportOptions(options, serverOptions));
      return server;
    },
    getRequestContext() {
      return server?.getRequestContext();
    },
    requestServices: options.requestServices as
      | ((context: unknown) => Partial<TServices> | Promise<Partial<TServices>>)
      | undefined
  });
  if (server === undefined) {
    throw new Error("Toolcraft HTTP MCP server was not created.");
  }
  return server;
}

export async function runHTTPMCP<TServices extends object = Record<string, unknown>>(
  roots: Group<TServices> | Group<TServices>[],
  options: RunHTTPMCPOptions<TServices>
): Promise<ToolcraftHTTPServerHandle> {
  enableSourceMaps();
  const server = await createHTTPMCPServer(roots, options);
  return server.listenHttp(createListenOptions(options));
}

export type {
  HttpListenOptions,
  HttpObservabilityEvent,
  HttpObservabilityOptions,
  RequestAuthInfo,
  Session,
  SessionStore,
  StreamableHttpTransportOptions,
  TinyHttpMcpServerOAuthOptions,
  TokenVerifier,
  VerifiedAccessToken
} from "tiny-http-mcp-server/server";
export {
  createJwksTokenVerifier,
  TokenVerificationError
} from "tiny-http-mcp-server/server";

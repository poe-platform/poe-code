import "./node-require-shim.js";
import {
  createHttpServer,
  type HttpListenOptions,
  type HttpServer,
  type HttpServerHandle,
  type HttpToolContext,
  type HttpTransportOptions,
  type TinyHttpMcpServerOAuthOptions
} from "tiny-http-mcp-server/server";
import type { Group } from "./index.js";
import type { OAuthAuthorizationServer, VerifiedAuthorizationServerToken } from "mcp-oauth-server";
import { createMCPServerForTransport, type RunMCPOptions } from "./mcp.js";
import { enableSourceMaps } from "./stack-trim.js";
import {
  isHostedOAuthConfiguration,
  prepareHostedOAuthRuntime,
  type HostedOAuthConfiguration
} from "./http-hosted-oauth.js";

export type ToolcraftHTTPContext = HttpToolContext;
export type ToolcraftHTTPServer = HttpServer;
export type ToolcraftHTTPServerHandle = HttpServerHandle;

type HTTPTransportControls = Omit<
  HttpTransportOptions,
  "name" | "version" | "validateToolArguments" | "oauth" | "requestHandler"
>;
type HTTPListenControls = Omit<HttpListenOptions, "port" | "hostname" | "path">;

export interface RunHTTPMCPOptions<TServices extends object = Record<string, unknown>>
  extends RunMCPOptions<TServices>, HTTPTransportControls, HTTPListenControls {
  hostname?: string;
  port?: number;
  path?: string;
  requestServices?(context: ToolcraftHTTPContext): Partial<TServices> | Promise<Partial<TServices>>;
  oauth?: TinyHttpMcpServerOAuthOptions | HostedOAuthConfiguration<unknown, TServices>;
}

export interface HTTPMCPAuthorizationOptions {
  authorizationServer: Pick<OAuthAuthorizationServer, "issuer" | "verifyAccessToken">;
  resource: string;
  requiredScopes?: readonly string[];
  scopesSupported?: readonly string[];
}

function toVerifiedAccessToken(
  token: string,
  issuer: string,
  verified: VerifiedAuthorizationServerToken
): import("tiny-http-mcp-server/server").VerifiedAccessToken {
  return {
    token,
    issuer,
    audience: [verified.resource],
    scopes: [...verified.scopes],
    expiresAt: verified.expiresAt,
    claims: {
      sub: verified.subject,
      client_id: verified.clientId,
      aud: verified.resource,
      jti: verified.tokenId
    },
    subject: verified.subject,
    clientId: verified.clientId
  };
}

export function createHTTPMCPAuthorization(
  options: HTTPMCPAuthorizationOptions
): import("tiny-http-mcp-server/server").TinyHttpMcpServerOAuthOptions {
  const issuer = options.authorizationServer.issuer;
  const resource = new URL(options.resource).href;
  return {
    resource,
    authorizationServers: [issuer],
    requiredScopes: options.requiredScopes,
    scopesSupported: options.scopesSupported ?? options.requiredScopes,
    verifier: {
      async verify(input) {
        if (input.authorizationServers.length !== 1 || input.authorizationServers[0] !== issuer) {
          throw new Error("authorization server issuer does not match");
        }
        if (new URL(input.resource).href !== resource) {
          throw new Error("protected resource does not match");
        }
        const verified = await options.authorizationServer.verifyAccessToken(input.token, resource);
        return toVerifiedAccessToken(input.token, issuer, verified);
      }
    }
  };
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
    oauth: options.oauth as TinyHttpMcpServerOAuthOptions | undefined,
    requestHandler: (
      options as RunHTTPMCPOptions<TServices> & Pick<HttpTransportOptions, "requestHandler">
    ).requestHandler
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

export async function createHTTPMCPServer<TServices extends object = Record<string, unknown>>(
  roots: Group<TServices> | Group<TServices>[],
  options: RunHTTPMCPOptions<TServices>
): Promise<ToolcraftHTTPServer> {
  let resolvedOptions = options;
  let hostedMcpPath: string | undefined;
  if (isHostedOAuthConfiguration(options.oauth)) {
    const runtime = await prepareHostedOAuthRuntime(
      options.oauth as HostedOAuthConfiguration<unknown, TServices>
    );
    const applicationServices = options.requestServices;
    hostedMcpPath = runtime.mcpPath;
    resolvedOptions = {
      ...options,
      oauth: runtime.oauth,
      sessionIdGenerator: undefined,
      enableJsonResponse: true,
      requestServices: async (context) => {
        const subject = context.auth?.subject;
        if (subject === undefined)
          throw new Error("Hosted OAuth request is missing a verified subject.");
        return {
          ...(applicationServices === undefined ? {} : await applicationServices(context)),
          ...(await runtime.requestServices(subject))
        } as Partial<TServices>;
      },
      requestHandler: runtime.requestHandler
    } as RunHTTPMCPOptions<TServices>;
  }
  let server: ToolcraftHTTPServer | undefined;
  await createMCPServerForTransport(roots, resolvedOptions, {
    createServer(serverOptions) {
      server = createHttpServer(createTransportOptions(resolvedOptions, serverOptions));
      return server;
    },
    getRequestContext() {
      return server?.getRequestContext();
    },
    requestServices: resolvedOptions.requestServices as
      | ((context: unknown) => Partial<TServices> | Promise<Partial<TServices>>)
      | undefined
  });
  if (server === undefined) {
    throw new Error("Toolcraft HTTP MCP server was not created.");
  }
  if (hostedMcpPath !== undefined) {
    const listenHttp = server.listenHttp.bind(server);
    server.listenHttp = (listenOptions = {}) =>
      listenHttp({
        path: hostedMcpPath,
        ...listenOptions
      });
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
export { createJwksTokenVerifier, TokenVerificationError } from "tiny-http-mcp-server/server";
export {
  createAuthorizationInteractionSecurity,
  createInMemoryAuthorizationServerStore,
  createOAuthAuthorizationServer,
  verifyAuthorizationInteractionCsrf
} from "mcp-oauth-server";
export type {
  AuthorizationInteraction,
  AuthorizationInteractionSecurity,
  AuthorizationServerStore,
  OAuthAuthorizationServer,
  OAuthAuthorizationServerOptions,
  VerifiedAuthorizationServerToken
} from "mcp-oauth-server";

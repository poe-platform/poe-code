import http, {
  type IncomingMessage,
  type ServerResponse,
  type Server as NodeHttpServer
} from "node:http";
import { AsyncLocalStorage } from "node:async_hooks";
import type { AddressInfo } from "node:net";
import {
  createServer,
  type Server,
  type ServerOptions,
  type ToolDefinition,
  type CallToolResult,
  type ToolReturn,
  type TypedSchema
} from "tiny-stdio-mcp-server";
import {
  PROTECTED_RESOURCE_METADATA_CACHE_CONTROL,
  PROTECTED_RESOURCE_METADATA_PATH,
  authorizeBearerRequest,
  type AuthenticatedIncomingMessage,
  type TokenVerifier,
  type VerifiedAccessToken,
  type RequestAuthInfo
} from "./auth.js";
import {
  StreamableHttpTransport,
  type HttpObservabilityEvent,
  type StreamableHttpTransportOptions
} from "./http-transport.js";

export interface ProtectedResourceMetadataOptions {
  resource: string | URL;
  authorizationServers: readonly (string | URL)[];
  bearerMethodsSupported?: readonly string[];
  scopesSupported?: readonly string[];
}

export interface TinyHttpMcpServerOAuthOptions extends ProtectedResourceMetadataOptions {
  requiredScopes?: readonly string[];
  verifier: TokenVerifier;
}

export type HttpTransportOptions = ServerOptions &
  StreamableHttpTransportOptions & {
    oauth?: TinyHttpMcpServerOAuthOptions;
  };

export interface HttpListenOptions {
  port?: number;
  hostname?: string;
  path?: string;
  signal?: AbortSignal;
  requestTimeoutMs?: number;
  headersTimeoutMs?: number;
  keepAliveTimeoutMs?: number;
}

export interface HttpServerHandle {
  url: string;
  port: number;
  close(): Promise<void>;
  closeAllConnections(): void;
}

export interface HttpServer extends Omit<Server, "tool" | "registerTool"> {
  tool<TIn, TOut = never>(
    name: string,
    description: string,
    inputSchema: TypedSchema<TIn>,
    handler: HttpToolHandler<TIn, TOut>,
    outputSchema?: TypedSchema<TOut>
  ): HttpServer;
  registerTool<TIn, TOut = never>(
    definition: Omit<ToolDefinition<TIn, TOut>, "handler">,
    handler: HttpToolHandler<TIn, TOut>
  ): HttpServer;
  listenHttp(options?: HttpListenOptions): Promise<HttpServerHandle>;
  handleRequest(req: IncomingMessage, res: ServerResponse): Promise<void>;
  getRequestContext(): HttpToolContext | undefined;
}

export interface HttpToolContext {
  request: AuthenticatedIncomingMessage;
  sessionId?: string;
  auth?: RequestAuthInfo;
}

type MountedIncomingMessage = IncomingMessage & {
  baseUrl?: unknown;
};

export type HttpToolHandler<T = Record<string, unknown>, TOut = ToolReturn> = (
  args: T,
  context: HttpToolContext
) => Promise<TOut | CallToolResult> | TOut | CallToolResult;

function normalizePath(path: string): string {
  if (path.length === 0 || path === "/") {
    return "/mcp";
  }

  if (path.includes("?") || path.includes("#")) {
    throw new Error("path must not include a query or fragment");
  }

  const normalizedPath = path.startsWith("/") ? path : `/${path}`;
  return normalizedPath.length > 1 && normalizedPath.endsWith("/")
    ? normalizedPath.slice(0, -1)
    : normalizedPath;
}

function getProtectedResourceMetadataPaths(path: string): string[] {
  if (path === "/") {
    return [PROTECTED_RESOURCE_METADATA_PATH];
  }

  return [`${PROTECTED_RESOURCE_METADATA_PATH}${path}`];
}

function formatHostnameForUrl(hostname: string): string {
  if (hostname.includes(":") && !hostname.startsWith("[")) {
    return `[${hostname}]`;
  }

  return hostname;
}

function buildUrl(hostname: string, port: number, path: string): string {
  const url = new URL("http://127.0.0.1");
  url.hostname = formatHostnameForUrl(hostname);
  url.port = String(port);
  url.pathname = path;
  url.search = "";
  url.hash = "";
  return url.toString();
}

function listen(server: NodeHttpServer, port: number, hostname: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const onError = (error: Error) => {
      server.off("listening", onListening);
      reject(error);
    };

    const onListening = () => {
      server.off("error", onError);
      resolve();
    };

    server.once("error", onError);
    server.once("listening", onListening);
    server.listen(port, hostname);
  });
}

function closeServer(server: NodeHttpServer): Promise<void> {
  if (!server.listening) {
    return Promise.resolve();
  }

  return new Promise((resolve, reject) => {
    server.close((error) => {
      if (error !== undefined) {
        reject(error);
        return;
      }

      resolve();
    });

    server.closeIdleConnections?.();
  });
}

function toUrlString(value: string | URL): string {
  return value instanceof URL ? value.toString() : value;
}

export function createProtectedResourceMetadataDocument(
  options: ProtectedResourceMetadataOptions
): Record<string, unknown> {
  return {
    resource: toUrlString(options.resource),
    authorization_servers: options.authorizationServers.map(toUrlString),
    ...(options.bearerMethodsSupported !== undefined
      ? {
          bearer_methods_supported: [...options.bearerMethodsSupported]
        }
      : {}),
    ...(options.scopesSupported !== undefined
      ? {
          scopes_supported: [...options.scopesSupported]
        }
      : {})
  };
}

export function createHttpServer(options: HttpTransportOptions): HttpServer {
  const requestContextStorage = new AsyncLocalStorage<HttpToolContext>();
  const supportsSessions =
    !hasOwnProperty(options, "sessionIdGenerator") || options.sessionIdGenerator !== undefined;
  const server = createServer({
    ...options,
    supportNotifications: supportsSessions,
    supportResourceSubscriptions: supportsSessions
  });
  const transport = new StreamableHttpTransport(server, options, async (req, callback) =>
    requestContextStorage.run(
      {
        request: req as AuthenticatedIncomingMessage,
        sessionId: Array.isArray(req.headers["mcp-session-id"])
          ? req.headers["mcp-session-id"][0]
          : req.headers["mcp-session-id"],
        auth: (req as AuthenticatedIncomingMessage).auth
      },
      callback
    )
  );
  const protectedResourceMetadataBody =
    options.oauth === undefined
      ? undefined
      : JSON.stringify(createProtectedResourceMetadataDocument(options.oauth));
  const httpServer = server as HttpServer;
  const registerTool = server.tool.bind(server);
  const registerRichTool = server.registerTool.bind(server);
  const defaultContext = {
    request: { headers: {}, socket: {} } as AuthenticatedIncomingMessage
  } satisfies HttpToolContext;

  const authorizeHttpRequest = async (
    req: IncomingMessage,
    res: ServerResponse,
    protectedResourcePath: string
  ): Promise<boolean> => {
    if (options.oauth === undefined || req.method === "OPTIONS") {
      return true;
    }

    const authenticatedRequest = req as AuthenticatedIncomingMessage;
    if (authenticatedRequest.auth !== undefined) {
      return true;
    }

    const authorization = await authorizeBearerRequest(authenticatedRequest, {
      ...options.oauth,
      protectedResourcePath,
      trustedProxy: options.trustedProxy
    });
    if (!authorization.ok) {
      options.observability?.onEvent?.({
        type: "auth.failure",
        statusCode: authorization.statusCode,
        ...(authorization.statusCode === 503 ? {} : { challenge: authorization.challenge }),
        sessionId: Array.isArray(req.headers["mcp-session-id"])
          ? req.headers["mcp-session-id"][0]
          : req.headers["mcp-session-id"]
      });
      res.writeHead(authorization.statusCode, {
        ...(authorization.statusCode === 503
          ? {}
          : { "WWW-Authenticate": authorization.challenge }),
        "X-Content-Type-Options": "nosniff",
        "Referrer-Policy": "no-referrer"
      });
      res.end();
      return false;
    }

    return true;
  };

  httpServer.tool = <TIn, TOut = never>(
    name: string,
    description: string,
    inputSchema: TypedSchema<TIn>,
    handler: HttpToolHandler<TIn, TOut>,
    outputSchema?: TypedSchema<TOut>
  ): HttpServer => {
    registerTool(
      name,
      description,
      inputSchema,
      (args) => handler(args, requestContextStorage.getStore() ?? defaultContext),
      outputSchema
    );

    return httpServer;
  };

  httpServer.registerTool = <TIn, TOut = never>(
    definition: Omit<ToolDefinition<TIn, TOut>, "handler">,
    handler: HttpToolHandler<TIn, TOut>
  ): HttpServer => {
    registerRichTool(definition, (args) =>
      handler(args, requestContextStorage.getStore() ?? defaultContext)
    );

    return httpServer;
  };

  httpServer.listenHttp = async (
    listenOptions: HttpListenOptions = {}
  ): Promise<HttpServerHandle> => {
    const {
      port = 0,
      hostname = "127.0.0.1",
      path: requestedPath = "/mcp",
      signal,
      requestTimeoutMs,
      headersTimeoutMs,
      keepAliveTimeoutMs
    } = listenOptions;
    const path = normalizePath(requestedPath);

    const nodeServer = http.createServer(async (req, res) => {
      const requestUrl = new URL(req.url ?? "/", "http://127.0.0.1");

      try {
        if (
          protectedResourceMetadataBody !== undefined &&
          req.method === "GET" &&
          getProtectedResourceMetadataPaths(path).includes(requestUrl.pathname)
        ) {
          res.writeHead(200, {
            "Cache-Control": PROTECTED_RESOURCE_METADATA_CACHE_CONTROL,
            "Content-Type": "application/json; charset=utf-8",
            "X-Content-Type-Options": "nosniff",
            "Referrer-Policy": "no-referrer"
          });
          res.end(protectedResourceMetadataBody);
          return;
        }

        if (requestUrl.pathname !== path) {
          res.writeHead(404, {
            "X-Content-Type-Options": "nosniff",
            "Referrer-Policy": "no-referrer"
          });
          res.end();
          return;
        }

        if (!(await authorizeHttpRequest(req, res, path))) {
          return;
        }

        await transport.handleRequest(req, res);
      } catch {
        if (!res.headersSent) {
          res.writeHead(500, {
            "X-Content-Type-Options": "nosniff",
            "Referrer-Policy": "no-referrer"
          });
        }
        if (!res.writableEnded) {
          res.end();
        }
      }
    });
    if (requestTimeoutMs !== undefined) {
      nodeServer.requestTimeout = requestTimeoutMs;
    }
    if (headersTimeoutMs !== undefined) {
      nodeServer.headersTimeout = headersTimeoutMs;
    }
    if (keepAliveTimeoutMs !== undefined) {
      nodeServer.keepAliveTimeout = keepAliveTimeoutMs;
    }

    await listen(nodeServer, port, hostname);

    const address = nodeServer.address();
    if (address === null || typeof address === "string") {
      throw new Error("Expected Node HTTP server to bind to a TCP port");
    }

    const resolvedPort = (address as AddressInfo).port;
    let closePromise: Promise<void> | undefined;
    let removeAbortListener = () => undefined;

    const close = async (): Promise<void> => {
      if (closePromise !== undefined) {
        return closePromise;
      }

      closePromise = (async () => {
        removeAbortListener();
        await transport.close();
        await closeServer(nodeServer);
      })().catch((error) => {
        closePromise = undefined;
        throw error;
      });

      return closePromise;
    };

    if (signal !== undefined) {
      const onAbort = () => {
        void close();
      };

      if (signal.aborted) {
        onAbort();
      } else {
        signal.addEventListener("abort", onAbort, { once: true });
        removeAbortListener = () => {
          signal.removeEventListener("abort", onAbort);
        };
      }
    }

    return {
      url: buildUrl(hostname, resolvedPort, path),
      port: resolvedPort,
      close,
      closeAllConnections: () => {
        nodeServer.closeAllConnections();
      }
    };
  };

  httpServer.handleRequest = async (req, res) => {
    const { baseUrl } = req as MountedIncomingMessage;
    const protectedResourcePath =
      typeof baseUrl === "string" && baseUrl.length > 0 ? baseUrl : "/mcp";

    if (!(await authorizeHttpRequest(req, res, protectedResourcePath))) {
      return;
    }

    await transport.handleRequest(req, res);
  };

  httpServer.getRequestContext = () => requestContextStorage.getStore();

  return httpServer;
}

function hasOwnProperty(value: object, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(value, key);
}

export type { RequestAuthInfo, TokenVerifier, VerifiedAccessToken };
export type { HttpObservabilityEvent };

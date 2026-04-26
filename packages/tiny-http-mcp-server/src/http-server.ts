import http, {
  type IncomingMessage,
  type ServerResponse,
  type Server as NodeHttpServer,
} from "node:http";
import type { AddressInfo } from "node:net";
import {
  createServer,
  type Server,
  type ServerOptions,
  type ToolHandler,
  type TypedSchema,
} from "tiny-stdio-mcp-server";
import {
  StreamableHttpTransport,
  type StreamableHttpTransportOptions,
} from "./http-transport.js";

export const PROTECTED_RESOURCE_METADATA_PATH =
  "/.well-known/oauth-protected-resource";

export interface ProtectedResourceMetadataOptions {
  resource: string | URL;
  authorizationServers: readonly (string | URL)[];
  bearerMethodsSupported?: readonly string[];
  scopesSupported?: readonly string[];
}

export interface VerifyTokenInput {
  token: string;
  resource: string;
  authorizationServers: readonly string[];
}

export type VerifyTokenHook = (
  input: VerifyTokenInput
) => unknown | Promise<unknown>;

export interface TinyHttpMcpServerOAuthOptions
  extends ProtectedResourceMetadataOptions {
  verifyToken?: VerifyTokenHook;
}

export type HttpTransportOptions = StreamableHttpTransportOptions & {
  oauth?: TinyHttpMcpServerOAuthOptions;
};

export interface HttpListenOptions {
  port?: number;
  hostname?: string;
  path?: string;
  signal?: AbortSignal;
}

export interface HttpServerHandle {
  url: string;
  port: number;
  close(): Promise<void>;
}

export interface HttpServer extends Omit<Server, "tool"> {
  tool<T>(
    name: string,
    description: string,
    inputSchema: TypedSchema<T>,
    handler: ToolHandler<T>
  ): HttpServer;
  listenHttp(options?: HttpListenOptions): Promise<HttpServerHandle>;
  handleRequest(req: IncomingMessage, res: ServerResponse): Promise<void>;
}

function normalizePath(path: string): string {
  if (path.length === 0) {
    return "/mcp";
  }

  return path.startsWith("/") ? path : `/${path}`;
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

function readSingleHeaderValue(
  value: string | string[] | undefined
): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function readForwardedHeaderValue(
  value: string | string[] | undefined
): string | undefined {
  const headerValue = readSingleHeaderValue(value);
  if (headerValue === undefined || headerValue.length === 0) {
    return undefined;
  }

  return headerValue.split(",")[0]?.trim() || undefined;
}

function getRequestProtocol(
  req: Pick<IncomingMessage, "headers" | "socket">
): string {
  const forwardedProto = readForwardedHeaderValue(req.headers["x-forwarded-proto"]);
  if (forwardedProto !== undefined) {
    return forwardedProto;
  }

  return "encrypted" in req.socket && req.socket.encrypted ? "https" : "http";
}

function getRequestHost(req: Pick<IncomingMessage, "headers">): string {
  const forwardedHost = readForwardedHeaderValue(req.headers["x-forwarded-host"]);
  if (forwardedHost !== undefined) {
    return forwardedHost;
  }

  return readSingleHeaderValue(req.headers.host) ?? "127.0.0.1";
}

export function createProtectedResourceMetadataDocument(
  options: ProtectedResourceMetadataOptions
): Record<string, unknown> {
  return {
    resource: toUrlString(options.resource),
    authorization_servers: options.authorizationServers.map(toUrlString),
    ...(options.bearerMethodsSupported !== undefined
      ? {
          bearer_methods_supported: [...options.bearerMethodsSupported],
        }
      : {}),
    ...(options.scopesSupported !== undefined
      ? {
          scopes_supported: [...options.scopesSupported],
        }
      : {}),
  };
}

export function isBearerRequestAuthenticated(
  req: Pick<IncomingMessage, "headers">
): boolean {
  const authorization = readSingleHeaderValue(req.headers.authorization);
  if (authorization === undefined) {
    return false;
  }

  const [scheme, token] = authorization.split(" ");
  return scheme.toLowerCase() === "bearer" && token !== undefined && token.length > 0;
}

export function getProtectedResourceMetadataUrl(
  req: Pick<IncomingMessage, "headers" | "socket">
): string {
  return new URL(
    PROTECTED_RESOURCE_METADATA_PATH,
    `${getRequestProtocol(req)}://${getRequestHost(req)}`
  ).toString();
}

export function createUnauthorizedBearerChallenge(
  req: Pick<IncomingMessage, "headers" | "socket">
): string {
  return `Bearer realm="mcp", resource_metadata="${getProtectedResourceMetadataUrl(req)}"`;
}

export function createHttpServer(
  options: ServerOptions & HttpTransportOptions
): HttpServer {
  const server = createServer(options);
  const transport = new StreamableHttpTransport(server, options);
  const protectedResourceMetadataBody =
    options.oauth === undefined
      ? undefined
      : JSON.stringify(createProtectedResourceMetadataDocument(options.oauth));
  const httpServer = server as HttpServer;

  httpServer.listenHttp = async (
    listenOptions: HttpListenOptions = {}
  ): Promise<HttpServerHandle> => {
    const {
      port = 0,
      hostname = "127.0.0.1",
      path: requestedPath = "/mcp",
      signal,
    } = listenOptions;
    const path = normalizePath(requestedPath);

    const nodeServer = http.createServer(async (req, res) => {
      const requestUrl = new URL(req.url ?? "/", "http://127.0.0.1");

      if (
        protectedResourceMetadataBody !== undefined &&
        req.method === "GET" &&
        requestUrl.pathname === PROTECTED_RESOURCE_METADATA_PATH
      ) {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(protectedResourceMetadataBody);
        return;
      }

      if (requestUrl.pathname !== path) {
        res.writeHead(404);
        res.end();
        return;
      }

      if (options.oauth !== undefined && !isBearerRequestAuthenticated(req)) {
        res.writeHead(401, {
          "WWW-Authenticate": createUnauthorizedBearerChallenge(req),
        });
        res.end();
        return;
      }

      await transport.handleRequest(req, res);
    });

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
      })();

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
    };
  };

  httpServer.handleRequest = transport.handleRequest.bind(transport);

  return httpServer;
}

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

export type HttpTransportOptions = StreamableHttpTransportOptions;

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

function buildUrl(hostname: string, port: number, path: string): string {
  const url = new URL("http://127.0.0.1");
  url.hostname = hostname;
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

export function createHttpServer(
  options: ServerOptions & HttpTransportOptions
): HttpServer {
  const server = createServer(options);
  const transport = new StreamableHttpTransport(server, options);
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

      if (requestUrl.pathname !== path) {
        res.writeHead(404);
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

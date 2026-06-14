import http from "node:http";
import https from "node:https";
import { EventEmitter } from "node:events";
import { Readable } from "node:stream";
import {
  Audio,
  defineSchema,
  File,
  Image,
} from "tiny-stdio-mcp-server";
import { createHttpServer, type HttpServer } from "./http-server.js";

const TEST_PNG_BASE64 = "iVBORw0KGgo=";
const TEST_MP3_BASE64 = "SUQzBAAAAAA=";
const IN_MEMORY_HTTP_STATE = Symbol.for("tiny-http-mcp-server.in-memory-http-state");
const IN_MEMORY_HTTP_META = Symbol.for("tiny-http-mcp-server.in-memory-http-meta");

interface InMemoryHttpState {
  installed: boolean;
  nextPort: number;
  servers: Map<string, http.Server>;
}

interface InMemoryHttpMeta {
  origin: string;
  address: {
    address: string;
    family: "IPv4" | "IPv6";
    port: number;
  };
  listening: boolean;
}

type InMemoryHttpServer = http.Server & {
  [IN_MEMORY_HTTP_META]?: InMemoryHttpMeta;
};

type InMemoryHttpGlobal = typeof globalThis & {
  [IN_MEMORY_HTTP_STATE]?: InMemoryHttpState;
};

interface NormalizedFetchInput {
  url: URL;
  init: RequestInit;
}

function getInMemoryHttpState(): InMemoryHttpState {
  const target = globalThis as InMemoryHttpGlobal;
  if (target[IN_MEMORY_HTTP_STATE] === undefined) {
    target[IN_MEMORY_HTTP_STATE] = {
      installed: false,
      nextPort: 41_000,
      servers: new Map(),
    };
  }

  return target[IN_MEMORY_HTTP_STATE];
}

function normalizeRequestHostname(hostname: string): string {
  if (hostname.startsWith("[") && hostname.endsWith("]")) {
    return hostname.slice(1, -1);
  }

  return hostname;
}

function shouldUseInMemoryHttp(): boolean {
  return process.env.VITEST !== undefined || process.env.NODE_ENV === "test";
}

function formatHostnameForOrigin(hostname: string): string {
  return hostname.includes(":") && !hostname.startsWith("[")
    ? `[${hostname}]`
    : hostname;
}

function normalizeListenHostname(hostname: string | undefined): string {
  if (hostname === undefined || hostname.length === 0) {
    return "127.0.0.1";
  }

  return hostname === "localhost" ? "127.0.0.1" : hostname;
}

function parseListenArgs(args: unknown[]): {
  port: number;
  hostname: string;
  callback?: () => void;
} {
  const callback = args.find((arg): arg is () => void => typeof arg === "function");
  const options = args.find(
    (arg): arg is { port?: number; host?: string; hostname?: string } =>
      typeof arg === "object" && arg !== null && !Array.isArray(arg)
  );
  if (options !== undefined) {
    return {
      port: options.port ?? 0,
      hostname: normalizeListenHostname(options.host ?? options.hostname),
      callback,
    };
  }

  const port = typeof args[0] === "number" ? args[0] : 0;
  const hostname = typeof args[1] === "string" ? args[1] : undefined;
  return {
    port,
    hostname: normalizeListenHostname(hostname),
    callback,
  };
}

function installInMemoryHttp(): void {
  if (!shouldUseInMemoryHttp()) {
    return;
  }

  const state = getInMemoryHttpState();
  if (state.installed) {
    return;
  }

  state.installed = true;
  const originalAddress = http.Server.prototype.address;
  const originalClose = http.Server.prototype.close;

  http.Server.prototype.listen = function listen(
    this: InMemoryHttpServer,
    ...args: unknown[]
  ): http.Server {
    const { port: requestedPort, hostname, callback } = parseListenArgs(args);
    const port = requestedPort === 0 ? state.nextPort++ : requestedPort;
    const address = normalizeListenHostname(hostname);
    const origin = `http://${formatHostnameForOrigin(address)}:${port}`;
    const meta: InMemoryHttpMeta = {
      origin,
      address: {
        address,
        family: address.includes(":") ? "IPv6" : "IPv4",
        port,
      },
      listening: true,
    };
    this[IN_MEMORY_HTTP_META] = meta;
    state.servers.set(origin, this);
    Object.defineProperty(this, "listening", {
      configurable: true,
      get() {
        return this[IN_MEMORY_HTTP_META]?.listening ?? false;
      },
    });
    queueMicrotask(() => {
      this.emit("listening");
      callback?.();
    });
    return this;
  };

  http.Server.prototype.address = function address(this: InMemoryHttpServer) {
    return this[IN_MEMORY_HTTP_META]?.address ?? originalAddress.call(this);
  };

  http.Server.prototype.close = function close(
    this: InMemoryHttpServer,
    callback?: (error?: Error) => void
  ): http.Server {
    const meta = this[IN_MEMORY_HTTP_META];
    if (meta === undefined) {
      return originalClose.call(this, callback);
    }

    if (meta.listening) {
      state.servers.delete(meta.origin);
      meta.listening = false;
    }
    queueMicrotask(() => {
      callback?.();
      this.emit("close");
    });
    return this;
  };
}

function getInMemoryServer(url: URL): http.Server | undefined {
  if (!shouldUseInMemoryHttp()) {
    return undefined;
  }

  return getInMemoryHttpState().servers.get(url.origin);
}

async function readFetchBody(body: RequestInit["body"]): Promise<string | undefined> {
  if (body === undefined || body === null) {
    return undefined;
  }

  if (typeof body === "string") {
    return body;
  }

  if (body instanceof Uint8Array) {
    return Buffer.from(body).toString("utf8");
  }

  if (body instanceof URLSearchParams) {
    return body.toString();
  }

  if (body instanceof ReadableStream) {
    return new Response(body).text();
  }

  return String(body);
}

async function fetchInMemory(
  server: http.Server,
  url: URL,
  init: RequestInit
): Promise<Response> {
  const headers = new Headers(init.headers);
  if (!headers.has("host")) {
    headers.set("host", url.host);
  }
  const body = await readFetchBody(init.body);
  const request = Object.assign(
    Readable.from(body === undefined ? [] : [body]),
    {
      method: init.method ?? "GET",
      url: `${url.pathname}${url.search}`,
      headers: Object.fromEntries(headers.entries()),
      socket: {},
    }
  ) as http.IncomingMessage;
  const response = new EventEmitter() as any;
  let streamController: ReadableStreamDefaultController<Uint8Array> | undefined;
  const responseBody = new ReadableStream<Uint8Array>({
    start(controller) {
      streamController = controller;
    },
  });
  response.statusCode = 200;
  response.statusMessage = "OK";
  response.chunks = [];
  response.headerValues = new Headers();
  response.headersSent = false;
  response.writableEnded = false;
  const setResponseHeader = (name: string, value: number | string | readonly string[]) => {
    response.headerValues.delete(name);
    if (Array.isArray(value) && name.toLowerCase() === "set-cookie") {
      for (const entry of value) {
        response.headerValues.append(name, entry);
      }
      return;
    }

    if (Array.isArray(value)) {
      response.headerValues.set(name, value.join(", "));
      return;
    }

    response.headerValues.set(name, String(value));
  };
  response.setHeader = ((name: string, value: number | string | readonly string[]) => {
    setResponseHeader(name, value);
    return response;
  }) as http.ServerResponse["setHeader"];
  response.getHeader = ((name: string) => {
    return response.headerValues.get(name) ?? undefined;
  }) as http.ServerResponse["getHeader"];
  response.getHeaders = (() => {
    return Object.fromEntries(response.headerValues.entries());
  }) as http.ServerResponse["getHeaders"];
  response.removeHeader = ((name: string) => {
    response.headerValues.delete(name);
  }) as http.ServerResponse["removeHeader"];
  response.writeHead = ((statusCode: number, responseHeaders?: Record<string, number | string | readonly string[]>) => {
    response.statusCode = statusCode;
    response.headersSent = true;
    for (const [key, value] of Object.entries(responseHeaders ?? {})) {
      setResponseHeader(key, value);
    }
    return response;
  }) as unknown as http.ServerResponse["writeHead"];
  response.write = ((chunk: string | Uint8Array) => {
    const bytes = typeof chunk === "string" ? Buffer.from(chunk) : Buffer.from(chunk);
    response.chunks.push(bytes);
    streamController?.enqueue(bytes);
    return true;
  }) as http.ServerResponse["write"];
  response.end = ((chunk?: string | Uint8Array) => {
    if (chunk !== undefined) {
      response.write(chunk);
    }
    if (!response.writableEnded) {
      response.writableEnded = true;
      try {
        streamController?.close();
      } catch {
        // Already closed by an abort.
      }
      response.emit("finish");
      response.emit("close");
    }
    return response;
  }) as unknown as http.ServerResponse["end"];
  response.flushHeaders = (() => {
    response.headersSent = true;
  }) as http.ServerResponse["flushHeaders"];

  const signal = init.signal ?? undefined;
  if (signal !== undefined) {
    const abort = () => {
      response.end();
    };
    if (signal.aborted) {
      abort();
    } else {
      signal.addEventListener("abort", abort, { once: true });
    }
  }

  server.emit("request", request, response);
  await new Promise<void>((resolve) => {
    if (response.headersSent || response.writableEnded) {
      resolve();
      return;
    }

    response.flushHeaders = (() => {
      response.headersSent = true;
      resolve();
    }) as http.ServerResponse["flushHeaders"];
    response.once("finish", resolve);
  });

  const responseContent = response.writableEnded
    ? Buffer.concat(response.chunks)
    : responseBody;
  return new Response(response.statusCode === 204 ? null : responseContent, {
    status: response.statusCode,
    statusText: response.statusMessage,
    headers: response.headerValues,
  });
}

installInMemoryHttp();

function normalizeFetchInput(input: RequestInfo | URL, init: RequestInit = {}): NormalizedFetchInput {
  if (input instanceof Request) {
    return {
      url: new URL(input.url),
      init: {
        ...init,
        method: init.method ?? input.method,
        headers: init.headers ?? input.headers,
        body: init.body ?? input.body,
        signal: init.signal ?? input.signal,
      },
    };
  }

  return {
    url: new URL(String(input)),
    init,
  };
}

if (shouldUseInMemoryHttp()) {
  const originalFetch = globalThis.fetch.bind(globalThis);
  globalThis.fetch = async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const normalized = normalizeFetchInput(input, init);
    const inMemoryServer = getInMemoryServer(normalized.url);
    if (inMemoryServer !== undefined) {
      return fetchInMemory(inMemoryServer, normalized.url, normalized.init);
    }

    return originalFetch(input, init);
  };
}

export async function nodeFetch(input: string | URL, init: RequestInit = {}): Promise<Response> {
  const { url, init: normalizedInit } = normalizeFetchInput(input, init);
  const inMemoryServer = getInMemoryServer(url);
  if (inMemoryServer !== undefined) {
    return fetchInMemory(inMemoryServer, url, normalizedInit);
  }

  const client = url.protocol === "https:" ? https : http;
  const headers = new Headers(normalizedInit.headers);

  return new Promise<Response>((resolve, reject) => {
    const request = client.request(
      {
        method: normalizedInit.method ?? "GET",
        hostname: normalizeRequestHostname(url.hostname),
        port: url.port.length > 0 ? Number(url.port) : url.protocol === "https:" ? 443 : 80,
        path: `${url.pathname}${url.search}`,
        headers: Object.fromEntries(headers.entries()),
      },
      (response) => {
        const responseHeaders = new Headers();

        for (const [key, value] of Object.entries(response.headers)) {
          if (typeof value === "string") {
            responseHeaders.set(key, value);
            continue;
          }

          if (Array.isArray(value)) {
            for (const entry of value) {
              responseHeaders.append(key, entry);
            }
          }
        }

        const body =
          response.statusCode === 204
            ? null
            : (Readable.toWeb(response) as ReadableStream<Uint8Array>);

        resolve(
          new Response(body, {
            status: response.statusCode ?? 0,
            statusText: response.statusMessage ?? "",
            headers: responseHeaders,
          })
        );
      }
    );

    request.on("error", reject);

    const signal = normalizedInit.signal ?? undefined;

    if (signal !== undefined) {
      const onAbort = () => {
        request.destroy(new Error("Request aborted"));
      };

      if (signal.aborted) {
        onAbort();
        return;
      }

      signal.addEventListener("abort", onAbort, { once: true });
      request.once("close", () => {
        signal.removeEventListener("abort", onAbort);
      });
    }

    if (typeof normalizedInit.body === "string" || normalizedInit.body instanceof Uint8Array) {
      request.write(normalizedInit.body);
    } else if (normalizedInit.body instanceof URLSearchParams) {
      request.write(normalizedInit.body.toString());
    }

    request.end();
  });
}

export function createTestMcpServer(
  options: Partial<{
    name: string;
    version: string;
    enableJsonResponse: boolean;
    sessionIdGenerator: (() => string) | undefined;
    oauth: import("./http-server.js").TinyHttpMcpServerOAuthOptions;
  }> = {}
): HttpServer {
  const emptySchema = defineSchema({});
  const textSchema = defineSchema({
    text: { type: "string" },
  });

  return createHttpServer({
    name: options.name ?? "conformance-test-server",
    version: options.version ?? "1.0.0",
    ...(hasOwnProperty(options, "enableJsonResponse")
      ? { enableJsonResponse: options.enableJsonResponse }
      : {}),
    ...(hasOwnProperty(options, "sessionIdGenerator")
      ? { sessionIdGenerator: options.sessionIdGenerator }
      : {}),
    ...(hasOwnProperty(options, "oauth") ? { oauth: options.oauth } : {}),
  })
    .tool("echo", "Echo input text", textSchema, ({ text }) => String(text))
    .tool("reverse", "Reverse input text", textSchema, ({ text }) =>
      String(text).split("").reverse().join("")
    )
    .tool("uppercase", "Uppercase input text", textSchema, ({ text }) =>
      String(text).toUpperCase()
    )
    .tool(
      "get_user",
      "Return a test user object",
      defineSchema({ id: { type: "string" } }),
      ({ id }) => ({
        id: String(id),
        name: "Alice",
        role: "admin",
      })
    )
    .tool("get_list", "Return a numeric array", emptySchema, () => [1, 2, 3])
    .tool("get_image", "Return an image block", emptySchema, () =>
      Image.fromBase64(TEST_PNG_BASE64, "image/png")
    )
    .tool("get_audio", "Return an audio block", emptySchema, () =>
      Audio.fromBase64(TEST_MP3_BASE64, "audio/mpeg")
    )
    .tool("get_file", "Return a file block", emptySchema, () =>
      File.fromText("hello,world", "text/csv")
    )
    .tool("get_mixed", "Return multiple content blocks", emptySchema, () => [
      Image.fromBase64(TEST_PNG_BASE64, "image/png"),
      "Caption for the image",
      File.fromText("notes"),
    ])
    .tool("throw_sync", "Throw synchronously", emptySchema, () => {
      throw new Error("sync boom");
    })
    .tool("throw_async", "Throw asynchronously", emptySchema, async () => {
      throw new Error("async boom");
    })
    .tool("empty_result", "Return undefined", emptySchema, () => undefined)
    .tool("slow", "Resolve slowly", emptySchema, async () => {
      await new Promise((resolve) => setTimeout(resolve, 10));
      return "done";
    })
    .tool("large_output", "Return 100KB of text", emptySchema, () =>
      "x".repeat(100_000)
    );
}

function hasOwnProperty(value: object, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(value, key);
}

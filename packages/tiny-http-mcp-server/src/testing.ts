import http from "node:http";
import https from "node:https";
import { Readable } from "node:stream";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import {
  Audio,
  defineSchema,
  File,
  Image,
} from "tiny-stdio-mcp-server";
import { createHttpServer, type HttpServer, type HttpServerHandle } from "./http-server.js";
import {
  TokenVerificationError,
  type TokenVerifier,
  type VerifiedAccessToken,
} from "./auth.js";

const TEST_PNG_BASE64 = "iVBORw0KGgo=";
const TEST_MP3_BASE64 = "SUQzBAAAAAA=";

function normalizeRequestHostname(hostname: string): string {
  if (hostname.startsWith("[") && hostname.endsWith("]")) {
    return hostname.slice(1, -1);
  }

  return hostname;
}

export async function nodeFetch(input: string | URL, init: RequestInit = {}): Promise<Response> {
  const url = new URL(String(input));
  const client = url.protocol === "https:" ? https : http;
  const headers = new Headers(init.headers);

  return new Promise<Response>((resolve, reject) => {
    const request = client.request(
      {
        method: init.method ?? "GET",
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
            responseHeaders.set(key, value.join(", "));
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

    const signal = init.signal ?? undefined;

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

    if (typeof init.body === "string" || init.body instanceof Uint8Array) {
      request.write(init.body);
    }

    request.end();
  });
}

export interface HttpTestPair {
  client: Client;
  transport: StreamableHTTPClientTransport;
  handle: HttpServerHandle;
  url: string;
  cleanup(): Promise<void>;
}

export interface TinyHttpRequestLogEntry {
  method: string;
  sessionId: string | null;
  jsonRpcMethod?: string;
  responseContentType?: string | null;
}

export interface TinyHttpTestPair {
  client: {
    listTools(): Promise<{ tools: Array<{ name: string }> }>;
    callTool(params: {
      name: string;
      arguments?: Record<string, unknown>;
    }): Promise<{ content: unknown[]; isError?: boolean }>;
    close(): Promise<void>;
  };
  transport: unknown;
  handle: HttpServerHandle;
  url: string;
  requests: TinyHttpRequestLogEntry[];
  cleanup(): Promise<void>;
}

export interface InMemoryAccessTokenInput {
  token?: string;
  issuer: string;
  audience: readonly string[];
  scopes: readonly string[];
  expiresAt: number;
  claims?: Record<string, unknown>;
  subject?: string;
  clientId?: string;
}

export interface InMemoryTokenVerifier {
  verifier: TokenVerifier;
  issueToken(input: InMemoryAccessTokenInput): string;
}

function cloneVerifiedAccessToken(
  token: VerifiedAccessToken
): VerifiedAccessToken {
  return {
    ...token,
    audience: [...token.audience],
    scopes: [...token.scopes],
    claims: { ...token.claims },
  };
}

export function createInMemoryTokenVerifier(
  options: Partial<{
    now: () => number;
  }> = {}
): InMemoryTokenVerifier {
  const tokens = new Map<string, VerifiedAccessToken>();
  const now = options.now ?? (() => Math.floor(Date.now() / 1_000));
  let nextTokenId = 1;

  return {
    verifier: {
      async verify(input) {
        const token = tokens.get(input.token);
        if (token === undefined) {
          throw new TokenVerificationError({
            error: "invalid_token",
            errorDescription: "unknown token",
          });
        }

        if (!input.authorizationServers.includes(token.issuer)) {
          throw new TokenVerificationError({
            error: "invalid_token",
            errorDescription: "issuer mismatch",
          });
        }

        if (!token.audience.includes(input.resource)) {
          throw new TokenVerificationError({
            error: "invalid_token",
            errorDescription: "audience mismatch",
          });
        }

        if (token.expiresAt <= now()) {
          throw new TokenVerificationError({
            error: "invalid_token",
            errorDescription: "token expired",
          });
        }

        if (
          input.requiredScopes.length > 0 &&
          !token.scopes.some((scope) => input.requiredScopes.includes(scope))
        ) {
          throw new TokenVerificationError({
            error: "insufficient_scope",
            errorDescription: "insufficient scope",
            scope: input.requiredScopes,
          });
        }

        return cloneVerifiedAccessToken(token);
      },
    },
    issueToken(input) {
      const token = input.token ?? `test-token-${nextTokenId++}`;
      const audience = [...input.audience];
      const scopes = [...input.scopes];
      const claims = {
        iss: input.issuer,
        aud: audience.length === 1 ? audience[0] : audience,
        exp: input.expiresAt,
        scope: scopes.join(" "),
        ...(input.subject === undefined
          ? {}
          : {
              sub: input.subject,
            }),
        ...(input.clientId === undefined
          ? {}
          : {
              client_id: input.clientId,
            }),
        ...(input.claims ?? {}),
      };

      tokens.set(token, {
        token,
        issuer: input.issuer,
        audience,
        scopes,
        expiresAt: input.expiresAt,
        claims,
        ...(input.subject === undefined
          ? {}
          : {
              subject: input.subject,
            }),
        ...(input.clientId === undefined
          ? {}
          : {
              clientId: input.clientId,
            }),
      });

      return token;
    },
  };
}

export function createTestMcpServer(
  options: Partial<{
    name: string;
    version: string;
    enableJsonResponse: boolean;
    sessionIdGenerator: (() => string) | undefined;
  }> = {}
): HttpServer {
  const emptySchema = defineSchema({});
  const textSchema = defineSchema({
    text: { type: "string" },
  });

  return createHttpServer({
    name: options.name ?? "conformance-test-server",
    version: options.version ?? "1.0.0",
    ...("enableJsonResponse" in options ? { enableJsonResponse: options.enableJsonResponse } : {}),
    ...("sessionIdGenerator" in options ? { sessionIdGenerator: options.sessionIdGenerator } : {}),
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

export async function createHttpTestPair(server: HttpServer): Promise<HttpTestPair> {
  const handle = await server.listenHttp({ port: 0 });
  const client = new Client({ name: "sdk-test-client", version: "1.0.0" });
  const transport = new StreamableHTTPClientTransport(new URL(handle.url), {
    fetch: nodeFetch,
  });

  await client.connect(transport);

  return {
    client,
    transport,
    handle,
    url: handle.url,
    cleanup: async () => {
      await client.close();
      await handle.close();
    },
  };
}

export async function createHttpTestPairWithTinyClient(
  server: HttpServer
): Promise<TinyHttpTestPair | null> {
  let tinyMcpClient: typeof import("tiny-mcp-client");

  try {
    tinyMcpClient = await import("tiny-mcp-client");
  } catch {
    return null;
  }

  const handle = await server.listenHttp({ port: 0 });
  const requests: TinyHttpRequestLogEntry[] = [];
  const client = new tinyMcpClient.McpClient({
    clientInfo: { name: "tiny-http-test-client", version: "1.0.0" },
  });
  const transport = new tinyMcpClient.HttpTransport({
    url: handle.url,
    fetch: async (input, init = {}) => {
      const headers = new Headers(init.headers);
      const method = init.method ?? "GET";
      let jsonRpcMethod: string | undefined;

      if (typeof init.body === "string" && init.body.length > 0) {
        try {
          const parsed = JSON.parse(init.body) as { method?: unknown };
          if (typeof parsed.method === "string") {
            jsonRpcMethod = parsed.method;
          }
        } catch {
          jsonRpcMethod = undefined;
        }
      }

      const response = await nodeFetch(String(input), init);

      requests.push({
        method,
        sessionId: headers.get("mcp-session-id"),
        jsonRpcMethod,
        responseContentType: response.headers.get("content-type"),
      });

      return response;
    },
  });

  await client.connect(transport);

  return {
    client,
    transport,
    handle,
    url: handle.url,
    requests,
    cleanup: async () => {
      await client.close();
      await handle.close();
    },
  };
}

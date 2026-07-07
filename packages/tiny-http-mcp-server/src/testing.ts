import type { Client } from "@modelcontextprotocol/sdk/client/index.js";
import type { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { HttpServer, HttpServerHandle } from "./http-server.js";
import { TokenVerificationError, type TokenVerifier, type VerifiedAccessToken } from "./auth.js";
import { installInMemoryHttp, nodeFetch } from "./test-support.js";

export { createTestMcpServer, installInMemoryHttp, nodeFetch } from "./test-support.js";

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

function cloneVerifiedAccessToken(token: VerifiedAccessToken): VerifiedAccessToken {
  return {
    ...token,
    audience: [...token.audience],
    scopes: [...token.scopes],
    claims: structuredClone(token.claims)
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
            errorDescription: "unknown token"
          });
        }

        if (!input.authorizationServers.includes(token.issuer)) {
          throw new TokenVerificationError({
            error: "invalid_token",
            errorDescription: "issuer mismatch"
          });
        }

        if (!token.audience.includes(input.resource)) {
          throw new TokenVerificationError({
            error: "invalid_token",
            errorDescription: "audience mismatch"
          });
        }

        if (token.expiresAt <= now()) {
          throw new TokenVerificationError({
            error: "invalid_token",
            errorDescription: "token expired"
          });
        }

        if (
          input.requiredScopes.length > 0 &&
          !token.scopes.some((scope) => input.requiredScopes.includes(scope))
        ) {
          throw new TokenVerificationError({
            error: "insufficient_scope",
            errorDescription: "insufficient scope",
            scope: input.requiredScopes
          });
        }

        return cloneVerifiedAccessToken(token);
      }
    },
    issueToken(input) {
      const token = input.token ?? `test-token-${nextTokenId++}`;
      if (tokens.has(token)) {
        throw new Error(`Token has already been issued: ${token}`);
      }

      const audience = [...input.audience];
      const scopes = [...input.scopes];
      const claims = {
        ...(input.claims ?? {}),
        iss: input.issuer,
        aud: audience.length === 1 ? audience[0] : audience,
        exp: input.expiresAt,
        scope: scopes.join(" "),
        ...(input.subject === undefined
          ? {}
          : {
              sub: input.subject
            }),
        ...(input.clientId === undefined
          ? {}
          : {
              client_id: input.clientId
            })
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
              subject: input.subject
            }),
        ...(input.clientId === undefined
          ? {}
          : {
              clientId: input.clientId
            })
      });

      return token;
    }
  };
}

export async function createHttpTestPair(server: HttpServer): Promise<HttpTestPair> {
  let sdkClient: typeof import("@modelcontextprotocol/sdk/client/index.js");
  let sdkTransport: typeof import("@modelcontextprotocol/sdk/client/streamableHttp.js");

  try {
    sdkClient = await import("@modelcontextprotocol/sdk/client/index.js");
    sdkTransport = await import("@modelcontextprotocol/sdk/client/streamableHttp.js");
  } catch (error) {
    throw new Error(
      "createHttpTestPair requires @modelcontextprotocol/sdk; install it as a devDependency or use createHttpTestPairWithTinyClient",
      { cause: error }
    );
  }

  installInMemoryHttp();
  const handle = await server.listenHttp({ port: 0 });
  const client = new sdkClient.Client({ name: "sdk-test-client", version: "1.0.0" });
  const transport = new sdkTransport.StreamableHTTPClientTransport(new URL(handle.url), {
    fetch: nodeFetch
  });

  try {
    await client.connect(transport);
  } catch (error) {
    await handle.close();
    throw error;
  }

  return {
    client,
    transport,
    handle,
    url: handle.url,
    cleanup: async () => {
      const results = await Promise.allSettled([client.close(), handle.close()]);
      const rejected = results.find(
        (result): result is PromiseRejectedResult => result.status === "rejected"
      );
      if (rejected !== undefined) {
        throw rejected.reason;
      }
    }
  };
}

export async function createHttpTestPairWithTinyClient(
  server: HttpServer
): Promise<TinyHttpTestPair> {
  let tinyMcpClient: typeof import("tiny-mcp-client");

  try {
    tinyMcpClient = await import("tiny-mcp-client");
  } catch (error) {
    throw new Error(
      "createHttpTestPairWithTinyClient requires tiny-mcp-client; install tiny-mcp-client as a devDependency",
      { cause: error }
    );
  }

  installInMemoryHttp();
  const handle = await server.listenHttp({ port: 0 });
  const requests: TinyHttpRequestLogEntry[] = [];
  const client = new tinyMcpClient.McpClient({
    clientInfo: { name: "tiny-http-test-client", version: "1.0.0" }
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
        responseContentType: response.headers.get("content-type")
      });

      return response;
    }
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
    }
  };
}

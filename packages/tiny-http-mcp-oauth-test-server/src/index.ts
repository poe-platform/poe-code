import http from "node:http";
import type { AddressInfo } from "node:net";
import { createJwksTokenVerifier } from "mcp-oauth";
import { createTestMcpServer, nodeFetch, TokenVerificationError } from "tiny-http-mcp-server";
import {
  createOAuthTestServer,
  type OAuthTestStaticClient,
  type OAuthTestServer,
} from "tiny-oauth-test-server";
import { hasOwnErrorCode } from "./error-codes.js";

export interface McpOAuthTestServerOptions {
  mcpPath?: string;
  issuer?: string;
  resource?: string;
  ttlSeconds?: number;
  autoApprove?: boolean;
  scopes?: string[];
  staticClients?: OAuthTestStaticClient[];
}

export interface McpOAuthTestServerListenOptions {
  port?: number;
  hostname?: string;
}

export interface McpOAuthTestServerHandle {
  url: string;
  mcpUrl: string;
  prmUrl: string;
  resource: string;
  oauth: OAuthTestServer;
  close(): Promise<void>;
}

export interface McpOAuthTestServer {
  listen(
    options?: McpOAuthTestServerListenOptions
  ): Promise<McpOAuthTestServerHandle>;
}

const PROTECTED_RESOURCE_METADATA_PATH = "/.well-known/oauth-protected-resource";

function getProtectedResourceMetadataUrl(mcpUrl: string): string {
  const url = new URL(mcpUrl);
  const protectedResourcePath =
    url.pathname === "/" ? "" : url.pathname.length > 1 && url.pathname.endsWith("/")
      ? url.pathname.slice(0, -1)
      : url.pathname;

  return new URL(`${PROTECTED_RESOURCE_METADATA_PATH}${protectedResourcePath}`, url).toString();
}

function normalizePath(path: string | undefined): string {
  if (path === undefined || path.length === 0) {
    return "/mcp";
  }

  if (path.includes("?") || path.includes("#")) {
    throw new Error("mcpPath must not include a query or fragment");
  }

  const normalizedPath = path.startsWith("/") ? path : `/${path}`;
  return normalizedPath.length > 1 && normalizedPath.endsWith("/")
    ? normalizedPath.slice(0, -1)
    : normalizedPath;
}

function parseHttpUrl(value: string, label: string): URL {
  let url: URL;

  try {
    url = new URL(value);
  } catch {
    throw new Error(`${label} must be an absolute URL`);
  }

  if (url.protocol !== "http:") {
    throw new Error(`${label} must use http: because the embedded servers do not terminate TLS`);
  }

  if (url.pathname === "/" || url.pathname.length === 0) {
    throw new Error(
      `${label} must include a non-root path such as /oauth so OAuth metadata discovery stays unambiguous`
    );
  }

  if (url.search.length > 0 || url.hash.length > 0) {
    throw new Error(`${label} must not include a query or fragment`);
  }

  return url;
}

function parseResourceUrl(value: string): string {
  let url: URL;

  try {
    url = new URL(value);
  } catch {
    throw new Error("resource must be an absolute URL");
  }

  if (url.hash.length > 0) {
    throw new Error("resource must not include a fragment");
  }

  return url.toString();
}

function normalizeHostForListen(hostname: string): string {
  if (hostname.startsWith("[") && hostname.endsWith("]")) {
    return hostname.slice(1, -1);
  }

  return hostname;
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

function isRevokedToken(oauth: OAuthTestServer, token: string): boolean {
  const candidate = oauth as OAuthTestServer & {
    isTokenRevoked?: (input: string) => boolean;
  };

  return candidate.isTokenRevoked?.(token) ?? false;
}

function normalizeScopes(scopes: string[] | undefined): string[] {
  const normalizedScopes = scopes === undefined ? ["mcp.read"] : [...scopes];
  if (normalizedScopes.some((scope) => scope.trim().length === 0)) {
    throw new Error("scopes must contain non-empty values");
  }

  return normalizedScopes;
}

function normalizeTtlSeconds(ttlSeconds: number | undefined): number {
  const normalizedTtlSeconds = ttlSeconds ?? 60;
  if (!Number.isInteger(normalizedTtlSeconds) || normalizedTtlSeconds <= 0) {
    throw new TypeError(
      `ttlSeconds must be a positive integer, received ${normalizedTtlSeconds}`
    );
  }

  return normalizedTtlSeconds;
}

function closeServer(server: http.Server): Promise<void> {
  return new Promise((resolve, reject) => {
    server.close((error) => {
      if (error !== undefined) {
        reject(error);
        return;
      }

      resolve();
    });

    server.closeIdleConnections?.();
    server.closeAllConnections?.();
  });
}

async function reservePort(hostname: string): Promise<number> {
  const server = http.createServer();

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, hostname, () => resolve());
  });

  const address = server.address();
  if (address === null || typeof address === "string") {
    await closeServer(server);
    throw new Error("Expected temporary port reservation to bind to a TCP port");
  }

  const port = (address as AddressInfo).port;
  await closeServer(server);
  return port;
}

export function createMcpOAuthTestServer(
  options: McpOAuthTestServerOptions = {}
): McpOAuthTestServer {
  const mcpPath = normalizePath(options.mcpPath);
  const scopes = normalizeScopes(options.scopes);
  const ttlSeconds = normalizeTtlSeconds(options.ttlSeconds);
  const configuredIssuer =
    options.issuer === undefined ? undefined : parseHttpUrl(options.issuer, "issuer");
  const configuredResource =
    options.resource === undefined ? undefined : parseResourceUrl(options.resource);
  let currentHandle: McpOAuthTestServerHandle | null = null;
  let listenPending = false;

  return {
    async listen(
      listenOptions: McpOAuthTestServerListenOptions = {}
    ): Promise<McpOAuthTestServerHandle> {
      if (currentHandle !== null || listenPending) {
        throw new Error("MCP OAuth test server is already listening");
      }

      listenPending = true;

      const hostname = listenOptions.hostname ?? "127.0.0.1";
      const requestedPort = listenOptions.port ?? 0;
      let lastError: unknown;

      for (let attempt = 0; attempt < 10; attempt += 1) {
        try {
          const handle = await listenOnce(hostname, requestedPort);
          listenPending = false;
          return handle;
        } catch (error) {
          lastError = error;
          if (requestedPort !== 0 || !isAddressInUseError(error)) {
            listenPending = false;
            throw error;
          }
        }
      }

      listenPending = false;
      throw lastError;
    },
  };

  async function listenOnce(
    hostname: string,
    requestedPort: number
  ): Promise<McpOAuthTestServerHandle> {
      const oauthHostname =
        configuredIssuer === undefined
          ? hostname
          : normalizeHostForListen(configuredIssuer.hostname);
      const oauthPort =
        configuredIssuer === undefined
          ? await reservePort(oauthHostname)
          : Number(configuredIssuer.port.length > 0 ? configuredIssuer.port : "80");
      const issuer =
        configuredIssuer?.toString() ?? buildUrl(oauthHostname, oauthPort, "/oauth");
      let fixedPort = requestedPort;

      if (
        fixedPort !== 0 &&
        fixedPort === oauthPort &&
        normalizeHostForListen(hostname) === oauthHostname
      ) {
        throw new Error(
          "issuer must not use the same hostname and port as the MCP listener because this fixture runs them on separate HTTP listeners"
        );
      }

      if (fixedPort === 0 && configuredResource === undefined) {
        do {
          fixedPort = await reservePort(hostname);
        } while (
          fixedPort === oauthPort &&
          normalizeHostForListen(hostname) === oauthHostname
        );
      }

      const oauth = createOAuthTestServer({
        issuer,
          defaultTokenTtlSeconds: ttlSeconds,
        staticClients: options.staticClients,
        defaultAuthorization: {
          autoApprove: options.autoApprove ?? false,
          scopes,
        },
      });
      let oauthHandle: Awaited<ReturnType<OAuthTestServer["listen"]>> | undefined;
      let mcpHandle:
        | Awaited<ReturnType<ReturnType<typeof createTestMcpServer>["listenHttp"]>>
        | undefined;

      try {
        oauthHandle = await oauth.listen({
          port: oauthPort,
          hostname: oauthHostname,
        });
        const resource = configuredResource ?? buildUrl(hostname, fixedPort, mcpPath);
        const jwksVerifier = createJwksTokenVerifier({
          jwksUrl: `${oauth.issuer}/.well-known/jwks.json`,
          fetch: (input, init) =>
            nodeFetch(input instanceof Request ? input.url : input, init),
        });
        const verifier = {
          async verify(input: Parameters<typeof jwksVerifier.verify>[0]) {
            if (isRevokedToken(oauth, input.token)) {
              throw new TokenVerificationError({
                error: "invalid_token",
                errorDescription: "token revoked",
              });
            }

            return jwksVerifier.verify(input);
          },
        };

        mcpHandle = await createTestMcpServer({
          enableJsonResponse: true,
          oauth: {
            resource,
            authorizationServers: [oauth.issuer],
            bearerMethodsSupported: ["header"],
            scopesSupported: scopes,
            requiredScopes: scopes,
            verifier,
          },
        }).listenHttp({
          port: fixedPort,
          hostname,
          path: mcpPath,
        });

        const prmUrl = getProtectedResourceMetadataUrl(mcpHandle.url);

        const handle: McpOAuthTestServerHandle = {
          url: mcpHandle.url,
          mcpUrl: mcpHandle.url,
          prmUrl,
          resource,
          oauth,
          close: async () => {
            if (currentHandle !== handle) {
              return;
            }

            const results = await Promise.allSettled([
              mcpHandle?.close(),
              oauthHandle?.close(),
            ]);
            const rejected = results.find(
              (result): result is PromiseRejectedResult => result.status === "rejected"
            );

            if (rejected !== undefined) {
              throw rejected.reason;
            }

            currentHandle = null;
          },
        };

        currentHandle = handle;
        return handle;
      } catch (error) {
        const closeOperations = oauthHandle === undefined ? [] : [oauthHandle.close()];

        if (mcpHandle !== undefined) {
          closeOperations.unshift(mcpHandle.close());
        }

        const closeResults = await Promise.allSettled(closeOperations);
        const failedClose = closeResults.find(
          (result): result is PromiseRejectedResult => result.status === "rejected"
        );
        if (failedClose !== undefined) {
          throw failedClose.reason;
        }

        throw error;
      }
  }
}

function isAddressInUseError(error: unknown): boolean {
  return hasOwnErrorCode(error, "EADDRINUSE");
}

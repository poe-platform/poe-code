import http from "node:http";
import type { AddressInfo } from "node:net";
import { createJwksTokenVerifier } from "../../mcp-oauth/dist/index.js";
import { createTestMcpServer, nodeFetch, TokenVerificationError } from "tiny-http-mcp-server";
import {
  createOAuthTestServer,
  type OAuthTestStaticClient,
  type OAuthTestServer,
} from "tiny-oauth-test-server";

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

  return url;
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
  return scopes === undefined ? ["mcp.read"] : [...scopes];
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
  const configuredIssuer =
    options.issuer === undefined ? undefined : parseHttpUrl(options.issuer, "issuer");
  let currentHandle: McpOAuthTestServerHandle | null = null;

  return {
    async listen(
      listenOptions: McpOAuthTestServerListenOptions = {}
    ): Promise<McpOAuthTestServerHandle> {
      if (currentHandle !== null) {
        throw new Error("MCP OAuth test server is already listening");
      }

      const hostname = listenOptions.hostname ?? "127.0.0.1";
      const requestedPort = listenOptions.port ?? 0;
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

      if (fixedPort === 0 && options.resource === undefined) {
        do {
          fixedPort = await reservePort(hostname);
        } while (
          fixedPort === oauthPort &&
          normalizeHostForListen(hostname) === oauthHostname
        );
      }

      const oauth = createOAuthTestServer({
        issuer,
        defaultTokenTtlSeconds: options.ttlSeconds ?? 60,
        staticClients: options.staticClients,
        defaultAuthorization: {
          autoApprove: options.autoApprove ?? false,
          scopes,
        },
      });
      const oauthHandle = await oauth.listen({
        port: oauthPort,
        hostname: oauthHostname,
      });
      let mcpHandle:
        | Awaited<ReturnType<ReturnType<typeof createTestMcpServer>["listenHttp"]>>
        | undefined;

      try {
        const resource = options.resource ?? buildUrl(hostname, fixedPort, mcpPath);
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

        currentHandle = {
          url: mcpHandle.url,
          mcpUrl: mcpHandle.url,
          prmUrl,
          resource,
          oauth,
          close: async () => {
            if (currentHandle === null) {
              return;
            }

            currentHandle = null;

            const results = await Promise.allSettled([
              mcpHandle?.close(),
              oauthHandle.close(),
            ]);
            const rejected = results.find(
              (result): result is PromiseRejectedResult => result.status === "rejected"
            );

            if (rejected !== undefined) {
              throw rejected.reason;
            }
          },
        };

        return currentHandle;
      } catch (error) {
        const closeOperations = [oauthHandle.close()];

        if (mcpHandle !== undefined) {
          closeOperations.unshift(mcpHandle.close());
        }

        await Promise.allSettled(closeOperations);
        throw error;
      }
    },
  };
}

import http from "node:http";
import crypto from "node:crypto";

export interface OAuthClientConfig {
  clientId: string;
  authorizationEndpoint: string;
  tokenEndpoint: string;
  openBrowser?: (url: string) => Promise<void>;
  readLine?: () => Promise<string>;
  createServer?: () => http.Server;
  fetch?: typeof globalThis.fetch;
}

export interface OAuthResult {
  apiKey: string;
  expiresIn: number | null;
}

export interface OAuthAuthorization {
  authorizationUrl: string;
  waitForResult: () => Promise<OAuthResult>;
}

export interface OAuthClient {
  authorize(): Promise<OAuthAuthorization>;
}

export function createOAuthClient(config: OAuthClientConfig): OAuthClient {
  const fetchFn = config.fetch ?? globalThis.fetch;

  return {
    authorize: () => startAuthorization(config, fetchFn)
  };
}

function generateCodeVerifier(): string {
  return crypto.randomBytes(32).toString("base64url");
}

function generateCodeChallenge(verifier: string): string {
  return crypto.createHash("sha256").update(verifier).digest("base64url");
}

async function startAuthorization(
  config: OAuthClientConfig,
  fetchFn: typeof globalThis.fetch
): Promise<OAuthAuthorization> {
  const codeVerifier = generateCodeVerifier();
  const codeChallenge = generateCodeChallenge(codeVerifier);

  const server = config.createServer
    ? config.createServer()
    : http.createServer();

  const port = await startServer(server);
  const redirectUri = `http://127.0.0.1:${port}/callback`;

  const authorizationUrl = buildAuthorizationUrl({
    endpoint: config.authorizationEndpoint,
    clientId: config.clientId,
    redirectUri,
    codeChallenge
  });

  const waitForResult = async (): Promise<OAuthResult> => {
    try {
      const code = await waitForAuthorizationCode(server, config, authorizationUrl);

      return await exchangeCodeForApiKey({
        tokenEndpoint: config.tokenEndpoint,
        code,
        codeVerifier,
        clientId: config.clientId,
        redirectUri,
        fetchFn
      });
    } finally {
      server.closeAllConnections?.();
      server.close();
    }
  };

  return { authorizationUrl, waitForResult };
}

function startServer(server: http.Server): Promise<number> {
  return new Promise<number>((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const address = server.address() as { port: number };
      resolve(address.port);
    });
  });
}

function buildAuthorizationUrl(params: {
  endpoint: string;
  clientId: string;
  redirectUri: string;
  codeChallenge: string;
}): string {
  const url = new URL(params.endpoint);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("client_id", params.clientId);
  url.searchParams.set("scope", "apikey:create");
  url.searchParams.set("code_challenge", params.codeChallenge);
  url.searchParams.set("code_challenge_method", "S256");
  url.searchParams.set("redirect_uri", params.redirectUri);
  return url.toString();
}

function waitForAuthorizationCode(
  server: http.Server,
  config: OAuthClientConfig,
  authorizationUrl: string
): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    let settled = false;
    const settle = (fn: () => void) => {
      if (!settled) {
        settled = true;
        fn();
      }
    };

    // Source 1: localhost callback server
    server.on("request", (req: http.IncomingMessage, res: http.ServerResponse) => {
      const url = new URL(req.url!, `http://127.0.0.1`);
      if (url.pathname !== "/callback") {
        res.writeHead(404);
        res.end("Not found");
        return;
      }

      const error = url.searchParams.get("error");
      if (error) {
        const description = url.searchParams.get("error_description") ?? error;
        res.writeHead(400);
        res.end(`Authorization failed: ${description}`);
        settle(() => reject(new Error(`OAuth authorization failed: ${error} — ${description}`)));
        return;
      }

      const code = url.searchParams.get("code");
      if (!code) {
        res.writeHead(400);
        res.end("Missing authorization code");
        settle(() => reject(new Error("OAuth callback missing authorization code")));
        return;
      }

      res.writeHead(200, { "Content-Type": "text/html" });
      res.end(buildSuccessPage());
      settle(() => resolve(code));
    });

    // Source 2: user pastes the redirect URL in the terminal
    if (config.readLine) {
      config.readLine().then((input) => {
        const code = extractCodeFromInput(input);
        if (code) {
          settle(() => resolve(code));
        }
      }).catch(() => {
        // readLine closed/cancelled — ignore, callback server may still resolve
      });
    }

    // Open browser after registering both handlers
    if (config.openBrowser) {
      config.openBrowser(authorizationUrl).catch((err) =>
        settle(() => reject(err))
      );
    }
  });
}

function extractCodeFromInput(input: string): string | null {
  const trimmed = input.replace(/[\r\n]/g, "").trim();
  if (trimmed.length === 0) {
    return null;
  }
  try {
    const url = new URL(trimmed);
    return url.searchParams.get("code");
  } catch {
    return trimmed;
  }
}

async function exchangeCodeForApiKey(params: {
  tokenEndpoint: string;
  code: string;
  codeVerifier: string;
  clientId: string;
  redirectUri: string;
  fetchFn: typeof globalThis.fetch;
}): Promise<OAuthResult> {
  const body = new URLSearchParams({
    grant_type: "authorization_code",
    code: params.code,
    code_verifier: params.codeVerifier,
    client_id: params.clientId,
    redirect_uri: params.redirectUri
  });

  const response = await params.fetchFn(params.tokenEndpoint, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString()
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Token exchange failed (${response.status}): ${text}`);
  }

  const data = (await response.json()) as Record<string, unknown>;

  if (typeof data.api_key !== "string" || data.api_key.length === 0) {
    throw new Error("Token response missing api_key field");
  }

  return {
    apiKey: data.api_key,
    expiresIn:
      typeof data.api_key_expires_in === "number"
        ? data.api_key_expires_in
        : null
  };
}

function buildSuccessPage(): string {
  return [
    "<!DOCTYPE html>",
    "<html><head><meta charset=utf-8><title>Connected to Poe</title></head>",
    "<body style=\"font-family:system-ui,sans-serif;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0\">",
    "<div style=\"text-align:center\">",
    "<h1>Connected to Poe</h1>",
    "<p style=\"color:#666\">You can close this tab and return to your terminal.</p>",
    "</div></body></html>"
  ].join("");
}

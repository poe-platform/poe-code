import http from "node:http";

export interface OAuthLandingPage {
  title: string;
  body: string;
}

export interface LoopbackAuthorizationOptions {
  openBrowser?: (url: string) => Promise<void>;
  readLine?: () => Promise<string>;
  createServer?: () => http.Server;
  landingPage?: OAuthLandingPage;
  callbackPath?: string;
}

export interface LoopbackAuthorizationSession {
  redirectUri: string;
  waitForCode(authorizationUrl: string): Promise<string>;
  close(): void;
}

export async function createLoopbackAuthorizationSession(
  options: LoopbackAuthorizationOptions = {}
): Promise<LoopbackAuthorizationSession> {
  const callbackPath = options.callbackPath ?? "/callback";
  const server = options.createServer ? options.createServer() : http.createServer();
  const port = await startServer(server);
  const redirectUri = `http://127.0.0.1:${port}${callbackPath}`;

  return {
    redirectUri,
    async waitForCode(authorizationUrl: string): Promise<string> {
      return waitForAuthorizationCode(server, authorizationUrl, options, callbackPath);
    },
    close(): void {
      server.closeAllConnections?.();
      server.close();
    },
  };
}

async function startServer(server: http.Server): Promise<number> {
  return new Promise<number>((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const address = server.address() as { port: number };
      resolve(address.port);
    });
  });
}

function waitForAuthorizationCode(
  server: http.Server,
  authorizationUrl: string,
  options: LoopbackAuthorizationOptions,
  callbackPath: string
): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    let settled = false;
    const settle = (fn: () => void) => {
      if (!settled) {
        settled = true;
        fn();
      }
    };

    server.on("request", (req: http.IncomingMessage, res: http.ServerResponse) => {
      const url = new URL(req.url ?? "/", "http://127.0.0.1");

      if (url.pathname !== callbackPath) {
        res.writeHead(404);
        res.end("Not found");
        return;
      }

      const error = url.searchParams.get("error");
      if (error !== null) {
        const description = url.searchParams.get("error_description") ?? error;
        res.writeHead(400);
        res.end(`Authorization failed: ${description}`);
        settle(() => reject(new Error(`OAuth authorization failed: ${error} — ${description}`)));
        return;
      }

      const code = url.searchParams.get("code");
      if (code === null || code.length === 0) {
        res.writeHead(400);
        res.end("Missing authorization code");
        settle(() => reject(new Error("OAuth callback missing authorization code")));
        return;
      }

      res.writeHead(200, { "Content-Type": "text/html" });
      res.end(buildSuccessPage(options.landingPage));
      settle(() => resolve(code));
    });

    if (options.readLine !== undefined) {
      options.readLine().then((input) => {
        const code = extractCodeFromInput(input);
        if (code !== null) {
          settle(() => resolve(code));
        }
      }).catch(() => undefined);
    }

    if (options.openBrowser !== undefined) {
      options.openBrowser(authorizationUrl).catch((error) => {
        settle(() => reject(error));
      });
    }
  });
}

export function extractCodeFromInput(input: string): string | null {
  const trimmed = input.replaceAll("\r", "").replaceAll("\n", "").trim();
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

function escapeHtml(text: string): string {
  return text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll("\"", "&quot;");
}

export function buildSuccessPage(landingPage?: OAuthLandingPage): string {
  const title = landingPage?.title ?? "Connected";
  const body = landingPage?.body ?? "You can close this tab and return to your terminal.";

  return [
    "<!DOCTYPE html>",
    `<html><head><meta charset=utf-8><title>${escapeHtml(title)}</title></head>`,
    "<body style=\"font-family:system-ui,sans-serif;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0\">",
    "<div style=\"text-align:center\">",
    `<h1>${escapeHtml(title)}</h1>`,
    `<p style="color:#666">${escapeHtml(body)}</p>`,
    "</div></body></html>",
  ].join("");
}

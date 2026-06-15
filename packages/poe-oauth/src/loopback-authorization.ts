import http from "node:http";
import { parseAuthorizationState } from "./authorization-state.js";

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
    }
  };
}

async function startServer(server: http.Server): Promise<number> {
  return new Promise<number>((resolve, reject) => {
    const handleError = (error: Error) => {
      reject(error);
    };
    server.once("error", handleError);
    server.listen(0, "127.0.0.1", () => {
      server.off("error", handleError);
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
  const expectedAuthorization = readExpectedAuthorizationCallback(authorizationUrl);

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
        try {
          validateAuthorizationCallbackBinding(
            {
              state: url.searchParams.get("state"),
              iss: url.searchParams.get("iss")
            },
            expectedAuthorization
          );
        } catch (validationError) {
          res.writeHead(400);
          res.end(
            validationError instanceof Error ? validationError.message : "Invalid OAuth callback"
          );
          return;
        }

        const description = url.searchParams.get("error_description") ?? error;
        res.writeHead(400);
        res.end(`Authorization failed: ${description}`);
        settle(() => reject(new Error(`OAuth authorization failed: ${error} — ${description}`)));
        return;
      }

      try {
        const code = validateAuthorizationCallbackParameters(
          {
            code: url.searchParams.get("code"),
            state: url.searchParams.get("state"),
            iss: url.searchParams.get("iss")
          },
          expectedAuthorization
        );

        res.writeHead(200, { "Content-Type": "text/html" });
        res.end(buildSuccessPage(options.landingPage));
        settle(() => resolve(code));
      } catch (error) {
        res.writeHead(400);
        res.end(error instanceof Error ? error.message : "Invalid OAuth callback");
        settle(() => reject(error instanceof Error ? error : new Error(String(error))));
      }
    });

    if (options.readLine !== undefined) {
      options
        .readLine()
        .then((input) => {
          const callbackParameters = extractCallbackParametersFromInput(input);
          if (callbackParameters === null) {
            settle(() => reject(new Error("OAuth callback missing authorization code")));
            return;
          }

          try {
            const code = validateAuthorizationCallbackParameters(
              callbackParameters,
              expectedAuthorization
            );
            settle(() => resolve(code));
          } catch (error) {
            settle(() => reject(error instanceof Error ? error : new Error(String(error))));
          }
        })
        .catch((error) => {
          settle(() => reject(error instanceof Error ? error : new Error(String(error))));
        });
    }

    if (options.openBrowser !== undefined) {
      options.openBrowser(authorizationUrl).catch((error) => {
        settle(() => reject(error));
      });
    }
  });
}

export function extractCodeFromInput(input: string): string | null {
  return extractCallbackParametersFromInput(input)?.code ?? null;
}

function extractCallbackParametersFromInput(
  input: string
): { code: string | null; state: string | null; iss: string | null } | null {
  const trimmed = input.replaceAll("\r", "").replaceAll("\n", "").trim();
  if (trimmed.length === 0) {
    return null;
  }

  try {
    const url = new URL(trimmed);
    return {
      code: url.searchParams.get("code"),
      state: url.searchParams.get("state"),
      iss: url.searchParams.get("iss")
    };
  } catch {
    return {
      code: trimmed,
      state: null,
      iss: null
    };
  }
}

function readExpectedAuthorizationCallback(authorizationUrl: string): {
  state: string | null;
  issuer: string | null;
  requireIssuer: boolean;
} {
  const url = new URL(authorizationUrl);
  const state = url.searchParams.get("state");
  const parsedState = parseAuthorizationState(state);

  return {
    state,
    issuer: parsedState?.issuer ?? null,
    requireIssuer: parsedState?.requireIssuer ?? false
  };
}

function validateAuthorizationCallbackParameters(
  callback: {
    code: string | null;
    state: string | null;
    iss: string | null;
  },
  expected: {
    state: string | null;
    issuer: string | null;
    requireIssuer: boolean;
  }
): string {
  if (callback.code === null || callback.code.length === 0) {
    throw new Error("OAuth callback missing authorization code");
  }

  validateAuthorizationCallbackBinding(callback, expected);

  return callback.code;
}

function validateAuthorizationCallbackBinding(
  callback: {
    state: string | null;
    iss: string | null;
  },
  expected: {
    state: string | null;
    issuer: string | null;
    requireIssuer: boolean;
  }
): void {
  if (expected.state !== null) {
    if (callback.state === null || callback.state.length === 0) {
      throw new Error("OAuth callback missing state");
    }

    if (callback.state !== expected.state) {
      throw new Error("OAuth callback state mismatch");
    }
  }

  if (expected.requireIssuer) {
    if (callback.iss === null || callback.iss.length === 0) {
      throw new Error("OAuth callback missing issuer");
    }
  }

  if (
    callback.iss !== null &&
    callback.iss.length > 0 &&
    expected.issuer !== null &&
    callback.iss !== expected.issuer
  ) {
    throw new Error("OAuth callback issuer mismatch");
  }
}

function escapeHtml(text: string): string {
  return text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

export function buildSuccessPage(landingPage?: OAuthLandingPage): string {
  const title = landingPage?.title ?? "Connected";
  const body = landingPage?.body ?? "You can close this tab and return to your terminal.";

  return [
    "<!DOCTYPE html>",
    `<html><head><meta charset=utf-8><title>${escapeHtml(title)}</title></head>`,
    '<body style="font-family:system-ui,sans-serif;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0">',
    '<div style="text-align:center">',
    `<h1>${escapeHtml(title)}</h1>`,
    `<p style="color:#666">${escapeHtml(body)}</p>`,
    "</div></body></html>"
  ].join("");
}

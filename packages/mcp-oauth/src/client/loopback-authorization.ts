import http from "node:http";
import { parseAuthorizationState } from "./authorization-state.js";
const authorizationErrorBrand = Symbol.for("poe-platform.mcp-oauth.OAuthAuthorizationError");
const oauthCallbackParameters = ["code", "state", "iss", "error", "error_description", "error_uri"];

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
  /** Exact registered HTTP loopback redirect, including its fixed port and query. */
  redirectUri?: string;
  signal?: AbortSignal;
  /** Bounds listener setup and authorization; defaults to two minutes. */
  timeoutMs?: number;
}

export interface LoopbackAuthorizationSession {
  redirectUri: string;
  waitForCode(authorizationUrl: string): Promise<string>;
  close(): void;
}

/** Authorization callback denial, retaining the provider diagnostic for host observers. */
export class OAuthAuthorizationError extends Error {
  /** Recognize errors from separately bundled copies of this package. */
  static is(value: unknown): value is OAuthAuthorizationError {
    return value instanceof Error && Object.getOwnPropertyDescriptor(value, authorizationErrorBrand)?.value === true;
  }
  constructor(readonly error: string, readonly errorDescription: string) {
    super(`OAuth authorization failed: ${error} — ${errorDescription}`);
    this.name = "OAuthAuthorizationError";
    Object.defineProperty(this, authorizationErrorBrand, { value: true });
  }
}

export async function createLoopbackAuthorizationSession(
  options: LoopbackAuthorizationOptions = {}
): Promise<LoopbackAuthorizationSession> {
  const selected = { ...options };
  options = { ...selected, createServer: selected.createServer?.bind(options),
    openBrowser: selected.openBrowser?.bind(options), readLine: selected.readLine?.bind(options),
    landingPage: selected.landingPage === undefined ? undefined : { ...selected.landingPage } };
  options.signal?.throwIfAborted();
  const timeoutMs = options.timeoutMs ?? 120_000;
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 2_147_483_647)
    throw new Error("OAuth authorization timeoutMs must be a positive supported timer interval");
  const target = loopbackTarget(options);
  const server = options.createServer ? options.createServer() : http.createServer();
  const controller = new AbortController();
  let closed = false;
  let used = false;
  const callerAbort = (): void => controller.abort(options.signal?.reason);
  const teardown = (): void => {
    if (closed) return;
    closed = true;
    clearTimeout(timer);
    options.signal?.removeEventListener("abort", callerAbort);
    server.closeAllConnections?.();
    server.close();
  };
  const timer = setTimeout(() => controller.abort(new Error("OAuth authorization timed out")), timeoutMs);
  timer.unref?.();
  controller.signal.addEventListener("abort", teardown, { once: true });
  options.signal?.addEventListener("abort", callerAbort, { once: true });
  if (options.signal?.aborted) callerAbort();
  let port: number;
  try { port = await startServer(server, target.port, target.host, controller.signal); }
  catch (error) { controller.abort(error); throw error; }
  const redirectUri = options.redirectUri ?? `http://127.0.0.1:${port}${target.callbackPath}`;

  return {
    redirectUri,
    async waitForCode(authorizationUrl: string): Promise<string> {
      controller.signal.throwIfAborted();
      if (used) throw new Error("OAuth authorization session has already been used");
      used = true;
      try {
        return await waitForAuthorizationCode(server, authorizationUrl, options, target.callbackPath, controller.signal);
      } finally { clearTimeout(timer); }
    },
    close(): void {
      controller.abort(new Error("OAuth authorization session closed"));
    }
  };
}

export function loopbackTarget(options: LoopbackAuthorizationOptions): { port: number; host: string; callbackPath: string } {
  if (options.redirectUri !== undefined) {
    let url: URL;
    try { url = new URL(options.redirectUri); }
    catch (cause) { throw new Error("Invalid OAuth loopback redirect URI", { cause }); }
    if (url.protocol !== "http:" || !["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)
      || url.username || url.password || url.hash || url.port === "0"
      || oauthCallbackParameters.some(name => url.searchParams.has(name))
      || [...options.redirectUri].some(char => char.codePointAt(0)! <= 32)
      || (options.callbackPath !== undefined && options.callbackPath !== url.pathname))
      throw new Error("Invalid OAuth loopback redirect URI");
    return { port: url.port ? Number(url.port) : 80, host: url.hostname === "[::1]" ? "::1" : url.hostname, callbackPath: url.pathname };
  }
  const callbackPath = options.callbackPath ?? "/callback";
  const parsed = new URL(callbackPath, "http://127.0.0.1");
  if (!callbackPath.startsWith("/") || parsed.origin !== "http://127.0.0.1" || parsed.pathname !== callbackPath || parsed.search || parsed.hash)
    throw new Error("Invalid OAuth loopback callback path");
  return { port: 0, host: "127.0.0.1", callbackPath };
}

async function startServer(server: http.Server, port: number, host: string, signal: AbortSignal): Promise<number> {
  signal.throwIfAborted();
  return new Promise<number>((resolve, reject) => {
    const cleanup = (): void => { server.off("error", handleError); signal.removeEventListener("abort", aborted); };
    const handleError = (error: Error): void => { cleanup(); reject(error); };
    const aborted = (): void => { cleanup(); reject(signal.reason); };
    server.once("error", handleError);
    signal.addEventListener("abort", aborted, { once: true });
    try {
      server.listen(port, host, () => {
        cleanup();
        if (signal.aborted) { server.close(); reject(signal.reason); return; }
        const address = server.address();
        if (address === null || typeof address === "string") { reject(new Error("OAuth listener has no TCP address")); return; }
        resolve(address.port);
      });
    } catch (error) { cleanup(); reject(error); }
  });
}

function waitForAuthorizationCode(
  server: http.Server,
  authorizationUrl: string,
  options: LoopbackAuthorizationOptions,
  callbackPath: string,
  signal: AbortSignal
): Promise<string> {
  signal.throwIfAborted();
  const expectedAuthorization = readExpectedAuthorizationCallback(authorizationUrl);

  return new Promise<string>((resolve, reject) => {
    let settled = false;
    const settle = (fn: () => void): void => {
      if (settled) return;
      settled = true;
      server.off("request", request);
      signal.removeEventListener("abort", aborted);
      fn();
    };
    const aborted = (): void => settle(() => reject(signal.reason));
    const request = (req: http.IncomingMessage, res: http.ServerResponse): void => {
      let url: URL;
      try { url = new URL(req.url ?? "/", "http://127.0.0.1"); }
      catch { res.writeHead(400); res.end("Invalid callback URL"); return; }
      if (url.pathname !== callbackPath) {
        res.writeHead(404); res.end("Not found"); return;
      }
      try {
        const callbackParameters = readAuthorizationCallbackParameters(url);
        validateAuthorizationCallbackBinding(callbackParameters, expectedAuthorization);
        if (callbackParameters.error !== null)
          throw new OAuthAuthorizationError(callbackParameters.error, callbackParameters.errorDescription ?? callbackParameters.error);
        const code = validateAuthorizationCallbackParameters(callbackParameters, expectedAuthorization);
        res.writeHead(200, { "Content-Type": "text/html" }); res.end(buildSuccessPage(options.landingPage));
        settle(() => resolve(code));
      } catch (error) {
        res.writeHead(400, { "Content-Type": "text/plain; charset=utf-8", "X-Content-Type-Options": "nosniff" });
        res.end(error instanceof Error ? error.message : "Invalid OAuth callback");
        settle(() => reject(error));
      }
    };
    server.on("request", request);
    signal.addEventListener("abort", aborted, { once: true });
    if (options.readLine !== undefined) {
      void Promise.resolve().then(() => settled ? undefined : options.readLine!()).then(input => {
        if (settled) return;
        const callbackParameters = extractCallbackParametersFromInput(input!);
        if (callbackParameters === null) throw new Error("OAuth callback missing authorization code");
        validateAuthorizationCallbackBinding(callbackParameters, expectedAuthorization);
        if (callbackParameters.error !== null)
          throw new OAuthAuthorizationError(callbackParameters.error, callbackParameters.errorDescription ?? callbackParameters.error);
        const code = validateAuthorizationCallbackParameters(callbackParameters, expectedAuthorization);
        settle(() => resolve(code));
      }).catch(error => settle(() => reject(error)));
    }
    if (options.openBrowser !== undefined) {
      void Promise.resolve().then(() => settled ? undefined : options.openBrowser!(authorizationUrl))
        .catch(error => settle(() => reject(error)));
    }
  });
}

export function extractCodeFromInput(input: string): string | null {
  try { return extractCallbackParametersFromInput(input)?.code ?? null; }
  catch { return null; }
}

function extractCallbackParametersFromInput(input: string): AuthorizationCallbackParameters | null {
  const trimmed = input.replaceAll("\r", "").replaceAll("\n", "").trim();
  if (trimmed.length === 0) {
    return null;
  }

  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return {
      code: trimmed,
      error: null,
      errorDescription: null,
      state: null,
      iss: null
    };
  }
  return readAuthorizationCallbackParameters(url);
}

function readAuthorizationCallbackParameters(url: URL): AuthorizationCallbackParameters {
  for (const parameter of oauthCallbackParameters) {
    if (url.searchParams.getAll(parameter).length > 1)
      throw new Error(`OAuth callback parameter '${parameter}' must occur only once`);
  }
  return { code: url.searchParams.get("code"), error: url.searchParams.get("error"),
    errorDescription: url.searchParams.get("error_description"), state: url.searchParams.get("state"), iss: url.searchParams.get("iss") };
}

interface AuthorizationCallbackParameters {
  code: string | null;
  error: string | null;
  errorDescription: string | null;
  state: string | null;
  iss: string | null;
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
  callback: AuthorizationCallbackParameters,
  expected: {
    state: string | null;
    issuer: string | null;
    requireIssuer: boolean;
  }
): string {
  validateAuthorizationCallbackBinding(callback, expected);

  if (callback.code === null || callback.code.length === 0) {
    throw new Error("OAuth callback missing authorization code");
  }

  return callback.code;
}

function validateAuthorizationCallbackBinding(
  callback: AuthorizationCallbackParameters,
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

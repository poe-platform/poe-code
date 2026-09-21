import http from "node:http";
import { createRequire } from "node:module";
const native = createRequire(import.meta.url)("./mcp-oauth-rust.node");
const callbackFields = native.authorizationCallbackParameters();
const authorizationErrorBrand = Symbol.for("poe-platform.mcp-oauth.OAuthAuthorizationError");
export class OAuthAuthorizationError extends Error {
  static is(value) {
    return (
      value instanceof Error &&
      Object.getOwnPropertyDescriptor(value, authorizationErrorBrand)?.value === true
    );
  }
  constructor(error, errorDescription) {
    super(`OAuth authorization failed: ${error} — ${errorDescription}`);
    this.name = "OAuthAuthorizationError";
    this.error = error;
    this.errorDescription = errorDescription;
    Object.defineProperty(this, authorizationErrorBrand, { value: true });
  }
}
export function buildSuccessPage(page) {
  return native.renderSuccessPage(page?.title, page?.body);
}
function callbackParameters(url) {
  native.validateCallbackMultiplicity(
    callbackFields.map((name) => url.searchParams.getAll(name).length)
  );
  return {
    code: url.searchParams.get("code"),
    error: url.searchParams.get("error"),
    errorDescription: url.searchParams.get("error_description"),
    state: url.searchParams.get("state"),
    iss: url.searchParams.get("iss")
  };
}
function manualParameters(input) {
  const text = native.normalizeCallbackInput(input);
  if (text.length === 0) return null;
  let url;
  try {
    url = new URL(text);
  } catch {
    return { code: text, error: null, errorDescription: null, state: null, iss: null };
  }
  return callbackParameters(url);
}
export function extractCodeFromInput(input) {
  try {
    return manualParameters(input)?.code ?? null;
  } catch {
    return null;
  }
}
export function loopbackTarget(options) {
  if (options.redirectUri !== undefined) {
    let url;
    try {
      url = new URL(options.redirectUri);
    } catch (cause) {
      throw Error("Invalid OAuth loopback redirect URI", { cause });
    }
    const descriptor = {
      protocol: url.protocol,
      hostname: url.hostname,
      port: url.port,
      credentials: !!(url.username || url.password),
      fragment: url.href.includes("#"),
      forbiddenQuery: callbackFields.some((name) => url.searchParams.has(name)),
      controls: [...options.redirectUri].some((char) => char.codePointAt(0) <= 32),
      pathMatches: options.callbackPath === undefined || options.callbackPath === url.pathname
    };
    if (!native.loopbackTargetAllowed(JSON.stringify(descriptor), true))
      throw Error("Invalid OAuth loopback redirect URI");
    return {
      port: url.port ? Number(url.port) : 80,
      host: url.hostname === "[::1]" ? "::1" : url.hostname,
      callbackPath: url.pathname
    };
  }
  const callbackPath = options.callbackPath ?? "/callback",
    url = new URL(callbackPath, "http://127.0.0.1");
  if (
    !native.loopbackTargetAllowed(
      JSON.stringify({
        startsSlash: callbackPath.startsWith("/"),
        origin: url.origin,
        pathMatches: url.pathname === callbackPath,
        query: !!url.search,
        fragment: !!url.hash
      }),
      false
    )
  )
    throw Error("Invalid OAuth loopback callback path");
  return { port: 0, host: "127.0.0.1", callbackPath };
}
export async function createLoopbackAuthorizationSession(options = {}) {
  const selected = { ...options };
  options = {
    ...selected,
    createServer: selected.createServer?.bind(options),
    openBrowser: selected.openBrowser?.bind(options),
    readLine: selected.readLine?.bind(options),
    landingPage: selected.landingPage === undefined ? undefined : { ...selected.landingPage }
  };
  options.signal?.throwIfAborted();
  const timeout = options.timeoutMs ?? 120_000;
  if (!native.authorizationTimerValid(typeof timeout === "number" ? timeout : NaN))
    throw Error("OAuth authorization timeoutMs must be a positive supported timer interval");
  const target = loopbackTarget(options),
    server = options.createServer ? options.createServer() : http.createServer(),
    controller = new AbortController(),
    state = new native.NativeLoopbackLifecycle();
  const callerAbort = () => controller.abort(options.signal?.reason);
  const teardown = () => {
    if (!state.close()) return;
    clearTimeout(timer);
    options.signal?.removeEventListener("abort", callerAbort);
    server.closeAllConnections?.();
    server.close();
  };
  const timer = setTimeout(() => controller.abort(Error("OAuth authorization timed out")), timeout);
  timer.unref?.();
  controller.signal.addEventListener("abort", teardown, { once: true });
  options.signal?.addEventListener("abort", callerAbort, { once: true });
  if (options.signal?.aborted) callerAbort();
  let port;
  try {
    controller.signal.throwIfAborted();
    port = await new Promise((resolve, reject) => {
      const cleanup = () => {
        server.off("error", onError);
        controller.signal.removeEventListener("abort", onAbort);
      };
      const onError = (error) => {
          cleanup();
          reject(error);
        },
        onAbort = () => {
          cleanup();
          reject(controller.signal.reason);
        };
      server.once("error", onError);
      controller.signal.addEventListener("abort", onAbort, { once: true });
      try {
        server.listen(target.port, target.host, () => {
          cleanup();
          if (controller.signal.aborted) {
            server.close();
            reject(controller.signal.reason);
            return;
          }
          const address = server.address();
          if (address === null || typeof address === "string") {
            reject(Error("OAuth listener has no TCP address"));
            return;
          }
          resolve(address.port);
        });
      } catch (error) {
        cleanup();
        reject(error);
      }
    });
  } catch (error) {
    controller.abort(error);
    throw error;
  }
  return {
    redirectUri: options.redirectUri ?? `http://127.0.0.1:${port}${target.callbackPath}`,
    async waitForCode(authorizationUrl) {
      controller.signal.throwIfAborted();
      if (!state.begin()) throw Error("OAuth authorization session has already been used");
      try {
        const binding = new native.NativeCallbackBinding(
          new URL(authorizationUrl).searchParams.get("state")
        );
        return await new Promise((resolve, reject) => {
          let settled = false;
          const settle = (success, value) => {
            if (settled) return;
            settled = true;
            server.off("request", onRequest);
            controller.signal.removeEventListener("abort", onAbort);
            if (success) resolve(value);
            else reject(value);
          };
          const onAbort = () => settle(false, controller.signal.reason);
          const resultFor = (parameters) => {
            const result = binding.resolve(JSON.stringify(parameters));
            if (Object.hasOwn(result, "authorizationError"))
              throw new OAuthAuthorizationError(
                result.authorizationError,
                result.authorizationErrorDescription
              );
            if (Object.hasOwn(result, "error")) throw Error(result.error);
            return result.code;
          };
          const onRequest = (request, response) => {
            let url;
            try {
              url = new URL(request.url ?? "/", "http://127.0.0.1");
            } catch {
              response.writeHead(400);
              response.end("Invalid callback URL");
              return;
            }
            if (url.pathname !== target.callbackPath) {
              response.writeHead(404);
              response.end("Not found");
              return;
            }
            try {
              const code = resultFor(callbackParameters(url));
              response.writeHead(200, { "Content-Type": "text/html" });
              response.end(buildSuccessPage(options.landingPage));
              settle(true, code);
            } catch (error) {
              response.writeHead(400, {
                "Content-Type": "text/plain; charset=utf-8",
                "X-Content-Type-Options": "nosniff"
              });
              response.end(error instanceof Error ? error.message : "Invalid OAuth callback");
              settle(false, error);
            }
          };
          server.on("request", onRequest);
          controller.signal.addEventListener("abort", onAbort, { once: true });
          if (options.readLine !== undefined)
            void Promise.resolve()
              .then(() => (settled ? undefined : options.readLine()))
              .then((input) => {
                if (settled) return;
                const parameters = manualParameters(input);
                if (parameters === null) throw Error("OAuth callback missing authorization code");
                settle(true, resultFor(parameters));
              })
              .catch((error) => settle(false, error));
          if (options.openBrowser !== undefined)
            void Promise.resolve()
              .then(() => (settled ? undefined : options.openBrowser(authorizationUrl)))
              .catch((error) => settle(false, error));
        });
      } finally {
        clearTimeout(timer);
      }
    },
    close() {
      controller.abort(Error("OAuth authorization session closed"));
    }
  };
}

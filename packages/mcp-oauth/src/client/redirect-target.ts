import type { LoopbackAuthorizationOptions } from "./loopback-authorization.js";

export const oauthCallbackParameters = ["code", "state", "iss", "error", "error_description", "error_uri"];

export function loopbackTarget(options: LoopbackAuthorizationOptions): { port: number; host: string; callbackPath: string } {
  if (options.redirectUri !== undefined) {
    let url: URL;
    try { url = new URL(options.redirectUri); }
    catch (cause) { throw new Error("Invalid OAuth loopback redirect URI", { cause }); }
    if (url.protocol !== "http:" || !["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)
      || url.username || url.password || url.href.includes("#") || url.port === "0"
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

/** Hosted redirects are explicit HTTPS URLs; local redirects retain loopback policy. */
export function validateAuthorizationRedirect(options: LoopbackAuthorizationOptions): void {
  if (options.waitForCallback === undefined) { loopbackTarget(options); return; }
  if (typeof options.waitForCallback !== "function" || options.redirectUri === undefined)
    throw new Error("Hosted OAuth callbacks require redirectUri and waitForCallback");
  validateHostedOAuthRedirect(options.redirectUri, options.callbackPath);
}

export function validateHostedOAuthRedirect(redirectUri: string, callbackPath?: string): void {
  const url = new URL(redirectUri);
  if (url.protocol !== "https:" || url.username || url.password || url.href.includes("#") || url.port === "0"
    || oauthCallbackParameters.some(name => url.searchParams.has(name))
    || [...redirectUri].some(char => char.codePointAt(0)! <= 32)
    || (callbackPath !== undefined && callbackPath !== url.pathname))
    throw new Error("Invalid hosted OAuth redirect URI");
}


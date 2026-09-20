import { randomBytes } from "node:crypto";
import { createRequire } from "node:module";
const native = createRequire(import.meta.url)("./mcp-oauth-rust.node");
export const generateCodeChallenge = native.generateCodeChallenge;
export function generateCodeVerifier() { return native.encodeCodeVerifier(randomBytes(32)); }
export { fetchMcpResponse, readBoundedResponseText } from "./http.js";
export { OAuthError, isRetryableOAuthError } from "./tokens.js";
export { buildSuccessPage, extractCodeFromInput, createLoopbackAuthorizationSession } from "./loopback.js";
export { createAuthStoreSessionStore } from "./session-store.js";
export { canonicalizeResourceIndicator } from "./resource.js";

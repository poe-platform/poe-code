import { randomBytes } from "node:crypto";
import { createRequire } from "node:module";
const native = createRequire(import.meta.url)("./mcp-oauth-rust.node");
export const parseAuthorizationState = native.parseAuthorizationState;
export function createAuthorizationState(input) {
  return native.createAuthorizationState(input.issuer, input.requireIssuer, randomBytes(16));
}

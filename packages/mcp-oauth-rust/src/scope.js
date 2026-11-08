import { createRequire } from "node:module";
const native = createRequire(import.meta.url)("./mcp-oauth-rust.node");
export function normalizeOAuthScope(value) {
  try {
    return native.normalizeOauthScope(value) ?? undefined;
  } catch (error) {
    throw new Error(error.message);
  }
}

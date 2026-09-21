import { createRequire } from "node:module";
const native = createRequire(import.meta.url)("./mcp-oauth-rust.node");
export function copyBoundedOAuthJson(value, message) {
  try {
    return native.copyCredentialJson(value);
  } catch {
    throw new Error(message);
  }
}

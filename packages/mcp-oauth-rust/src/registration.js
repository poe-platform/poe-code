import { createRequire } from "node:module";
const native = createRequire(import.meta.url)("./mcp-oauth-rust.node");
export function parseOAuthClientRegistration(value) {
  let result;
  try {
    result = native.parseClientRegistration(value);
  } catch {
    throw new Error("Invalid OAuth client registration metadata");
  }
  if (Object.hasOwn(result, "error")) throw new Error(result.error);
  return result.value;
}

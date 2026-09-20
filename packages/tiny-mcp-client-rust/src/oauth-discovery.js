import { createRequire } from "node:module";
const native = createRequire(import.meta.url)("./tiny-mcp-client-rust.node");

export function parseBearerWwwAuthenticateHeader(headerValue) {
  if (headerValue === null) return null;
  const entries = native.parseBearerChallenge(headerValue);
  if (entries === null) return null;
  const params = Object.create(null);
  for (const [name, value] of entries) params[name.toLowerCase()] = value;
  return { scheme: "Bearer", params, raw: headerValue };
}

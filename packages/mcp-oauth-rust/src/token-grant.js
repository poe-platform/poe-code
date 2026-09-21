import { createRequire } from "node:module";
const native = createRequire(import.meta.url)("./mcp-oauth-rust.node");
export function parseOAuthTokenGrant(value, options = {}) {
  options = {
    ...options,
    expiresAt: options.expiresAt,
    issuedAt: options.issuedAt,
    now: options.now?.bind(options)
  };
  const invalid = () => new Error("Invalid OAuth token grant");
  let grant;
  try {
    grant = new native.NativeTokenGrant(value);
  } catch {
    throw invalid();
  }
  try {
    new Headers({ Authorization: `Bearer ${grant.access}` });
  } catch {
    throw invalid();
  }
  let lifetime;
  try {
    lifetime = grant.prepare(options.expiresAt, options.issuedAt);
  } catch {
    throw invalid();
  }
  const anchor =
    typeof lifetime === "number" ? (options.issuedAt ?? (options.now ?? Date.now)()) : undefined;
  try {
    return grant.complete(anchor);
  } catch {
    throw invalid();
  }
}

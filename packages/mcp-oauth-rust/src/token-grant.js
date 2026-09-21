import { createRequire } from "node:module";
const native = createRequire(import.meta.url)("./mcp-oauth-rust.node");
export function parseOAuthTokenGrant(value, options = {}) {
  const invalid = () => new Error("Invalid OAuth token grant");
  let grant;
  try { grant = new native.NativeTokenGrant(value); }
  catch { throw invalid(); }
  try { new Headers({ Authorization: `Bearer ${grant.access}` }); }
  catch { throw invalid(); }
  const lifetime = grant.lifetime();
  if (options.expiresAt !== undefined && options.expiresAt !== null)
    native.validateGrantTimestamp(options.expiresAt);
  if (options.issuedAt !== undefined) native.validateGrantTimestamp(options.issuedAt);
  const absolute = grant.absoluteExpiry();
  const relative = typeof lifetime === "number" ? (options.issuedAt ?? (options.now ?? Date.now)()) + lifetime * 1000 : undefined;
  grant.validateRelative(relative);
  const expiresAt = options.expiresAt ?? absolute ?? relative ?? null;
  return { ...grant.fields(), expiresAt };
}

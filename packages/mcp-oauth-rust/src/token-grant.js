import { createRequire } from "node:module";
const native = createRequire(import.meta.url)("./mcp-oauth-rust.node");
export function parseOAuthTokenGrant(value, options = {}) {
  options = { ...options };
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
  const lifetime = grant.lifetime();
  for (const timestamp of [
    ...(options.expiresAt == null ? [] : [options.expiresAt]),
    ...(options.issuedAt === undefined ? [] : [options.issuedAt])
  ]) {
    try {
      native.validateGrantTimestamp(timestamp);
    } catch {
      throw invalid();
    }
  }
  let absolute;
  try {
    absolute = grant.absoluteExpiry();
  } catch {
    throw invalid();
  }
  const anchor =
    typeof lifetime === "number" ? (options.issuedAt ?? (options.now ?? Date.now)()) : undefined;
  let relative;
  try {
    if (typeof lifetime === "number") {
      native.validateGrantTimestamp(anchor);
      relative = anchor + lifetime * 1000;
    }
    grant.validateRelative(relative);
  } catch {
    throw invalid();
  }
  const expiresAt = options.expiresAt ?? absolute ?? relative ?? null;
  try {
    return { ...grant.fields(), expiresAt };
  } catch {
    throw invalid();
  }
}

import { randomBytes, timingSafeEqual } from "node:crypto";
import { serialize, deserialize } from "node:v8";
import { createRequire } from "node:module";
const native = createRequire(import.meta.url)("./mcp-oauth-server-rust.node");
function decode(record) {
  if (record == null) return undefined;
  return Object.assign(deserialize(record.payload), record.patches);
}
function metadata(record, identity) {
  const fields = { ...identity };
  for (const key of ["grantId", "familyId", "status", "expiresAt"]) {
    if (record[key] !== undefined) fields[key] = typeof record[key] === "number" && !Number.isFinite(record[key]) ? String(record[key]) : record[key];
  }
  if (record.revokedAt !== undefined) fields.revokedAt = record.revokedAt;
  return JSON.stringify(fields);
}
export function createInMemoryAuthorizationServerStore() {
  const state = new native.NativeAuthorizationStore();
  const store = {};
  for (const [suffix, table, key, read, take] of [
    ["Client", "client", "id", "getClient", false],
    ["AuthorizationTransaction", "transaction", "id", "takeAuthorizationTransaction", true],
    ["AuthorizationCode", "code", "tokenHash", "takeAuthorizationCode", true],
    ["Grant", "grant", "id", "getGrant", false],
    ["AccessToken", "access", "tokenHash", "getAccessToken", false],
    ["RefreshToken", "refresh", "tokenHash", undefined, false]
  ]) {
    store[`put${suffix}`] = async record => {
      const identity = { [key]: record[key] };
      const clone = structuredClone(record);
      state.put(table, serialize(clone), metadata(clone, identity));
    };
    if (read !== undefined) store[read] = async id => decode(state.get(table, id, take));
  }
  store.rotateRefreshToken = async (key, replacement, now, expires) => {
    const result = state.rotate(key, replacement, now, expires);
    const status = result.status;
    if (status === "rotated") return { status, previous: decode(result.previous) };
    if (status === "replay") {
      const grant = decode(result.grant);
      return grant === undefined ? { status } : { status, grant };
    }
    return { status };
  };
  store.revokeToken = async (key, now) => decode(state.revokeToken(key, now));
  store.revokeGrant = async (key, now) => { state.revokeGrant(key, now); };
  return store;
}
export function createAuthorizationInteractionSecurity(options = {}) {
  const randomToken = options.randomToken ?? (() => randomBytes(32).toString("base64url"));
  const cookieName = options.cookieName ?? "__Host-mcp_oauth_csrf";
  const maxAge = options.maxAgeSeconds ?? 600;
  try { native.validateCsrfCookie(cookieName, typeof maxAge === "number" ? maxAge : NaN); }
  catch (error) { throw new Error(error.message); }
  const csrfToken = randomToken();
  return { csrfToken, state: randomToken(), nonce: randomToken(), setCookie: native.csrfCookie(cookieName, maxAge, csrfToken) };
}
export function verifyAuthorizationInteractionCsrf(input) {
  const value = native.csrfCookieValue(input.cookieHeader, input.cookieName ?? "__Host-mcp_oauth_csrf");
  if (value == null) return false;
  const cookie = Buffer.from(value), submitted = Buffer.from(input.submittedToken);
  return cookie.length === submitted.length && timingSafeEqual(cookie, submitted);
}

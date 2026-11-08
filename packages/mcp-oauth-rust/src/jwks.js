import { webcrypto } from "node:crypto";
import { createRequire } from "node:module";
import { fetchMcpResponse, readBoundedResponseText } from "./http.js";
import { canonicalizeResourceIndicator } from "./resource.js";
const { NativeJwksCache, NativeJwksDocument, NativeJwksToken, validateJwksConfiguration } = createRequire(import.meta.url)("./mcp-oauth-rust.node");
const defaults = ["ES256", "ES384", "ES512", "RS256", "RS384", "RS512", "PS256", "PS384", "PS512", "EdDSA"];
class NoMatchingKey extends Error {}
function failure(description, code = "invalid_token", scope) {
  const error = Object.assign(new Error(description), { error: code, errorDescription: description });
  if (scope !== undefined) error.scope = [...scope];
  return error;
}
function unavailable() {
  return failure("token verification temporarily unavailable", "temporarily_unavailable");
}
export function createJwksTokenVerifier(options) {
  let url;
  try { url = new URL(String(options.jwksUrl)); }
  catch { throw new Error("jwksUrl must be an absolute URL"); }
  const skew = options.clockSkewSeconds ?? 30;
  const ttl = options.jwksCacheTtlMs ?? 300000;
  const timeout = options.jwksFetchTimeoutMs ?? 5000;
  const cooldown = options.jwksRefreshCooldownMs ?? 30000;
  const allowed = options.allowedAlgorithms ?? defaults;
  const requireType = options.requireAccessTokenType ?? false;
  const fetchImpl = options.fetch ?? globalThis.fetch;
  const timing = Object.fromEntries(Object.entries({ skew, ttl, timeout, cooldown }).map(([key, value]) => [key, typeof value === "number" ? value : NaN]));
  try { validateJwksConfiguration(url.protocol, url.hostname, url.username !== "" || url.password !== "", options.allowInsecureJwks === true, timing); }
  catch (error) { throw new Error(error.message); }
  if (typeof fetchImpl !== "function") throw new Error("fetch is not available; pass options.fetch explicitly");
  const cache = new NativeJwksCache(ttl, cooldown);
  let pending, pendingForced;
  function get(force = false) {
    const now = Date.now();
    if (!force && cache.valid(now)) return Promise.resolve(cache.snapshot());
    if (pending !== undefined) return pending;
    pending = (async () => {
      try {
        const signal = AbortSignal.timeout(timeout);
        const response = await fetchMcpResponse(fetchImpl, url, { headers: { Accept: "application/json" }, signal });
        if (!response.ok) { await response.body?.cancel().catch(() => undefined); throw unavailable(); }
        const text = await readBoundedResponseText(response, 1024 * 1024, undefined, signal);
        const document = new NativeJwksDocument(text);
        cache.store(document, Date.now());
        return document;
      } catch { throw unavailable(); }
    })().finally(() => { pending = undefined; });
    return pending;
  }
  function refresh() {
    if (pendingForced !== undefined) return pendingForced;
    if (!cache.force(Date.now())) throw new NoMatchingKey();
    pendingForced = get(true).finally(() => { pendingForced = undefined; });
    return pendingForced;
  }
  async function verifySignature(token, document) {
    const plans = document.select(token);
    if (plans.length === 0) throw new NoMatchingKey();
    let malformed = false;
    for (const plan of plans) {
      if (Object.hasOwn(plan, "malformed")) { malformed = true; continue; }
      if (Object.hasOwn(plan, "symmetric")) throw failure("token verification failed");
      let key;
      try { key = await webcrypto.subtle.importKey("jwk", plan.key, plan.import, plan.extractable, plan.usages); }
      catch { malformed = true; continue; }
      const [signature, data] = token.signatureData();
      if (key.type !== "public" || !key.usages.includes("verify") || (Object.hasOwn(key.algorithm, "modulusLength") && key.algorithm.modulusLength < 2048)) throw failure("token verification failed");
      let verified;
      try { verified = await webcrypto.subtle.verify(plan.verify, key, signature, data); }
      catch { verified = false; }
      if (verified) return;
    }
    if (malformed) throw unavailable();
    throw failure("token signature invalid");
  }
  return {
    async verify(input) {
      try {
        const expected = canonicalizeResourceIndicator(input.resource);
        const token = new NativeJwksToken(input.token, JSON.stringify(allowed));
        let document = await get();
        try { await verifySignature(token, document); }
        catch (error) { if (!(error instanceof NoMatchingKey)) throw error; document = await refresh(); await verifySignature(token, document); }
        token.validateClaims(JSON.stringify(input.authorizationServers), new Date().getTime() / 1000, skew, Boolean(requireType));
        let audience;
        for (const candidate of token.audiences) {
          try { const normalized = canonicalizeResourceIndicator(candidate); if (normalized === expected) { audience = normalized; break; } }
          catch { /* Invalid audience indicators cannot match. */ }
        }
        if (audience === undefined) throw failure("audience mismatch");
        try { return token.complete(audience, JSON.stringify(input.requiredScopes)); }
        catch (error) { if (error.message === "insufficient scope") throw failure("insufficient scope", "insufficient_scope", input.requiredScopes); throw error; }
      } catch (error) {
        if (error instanceof NoMatchingKey) throw failure("token signature invalid");
        if (error instanceof Error && ["invalid_token", "insufficient_scope", "temporarily_unavailable"].includes(error.error)) throw error;
        const messages = ["token verification failed", "unsupported critical token claims", "unsupported token algorithm", "invalid access token type", "issuer mismatch", "token missing expiry", "token not active yet", "token expired"];
        throw failure(messages.includes(error?.message) ? error.message : "token verification failed");
      }
    }
  };
}

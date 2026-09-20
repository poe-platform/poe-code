import { randomBytes, sign, timingSafeEqual, webcrypto } from "node:crypto";
import { createRequire } from "node:module";
const native = createRequire(import.meta.url)("./mcp-oauth-server-rust.node");
class OAuthProtocolError extends Error {
  constructor(code, message, status) { super(message); this.error = code; this.status = status; }
}
function fromError(shape) {
  if (Object.hasOwn(shape, "code") && !shape.code.startsWith("ERR_")) return new OAuthProtocolError(shape.code, shape.message, shape.status);
  const error = shape.name === "TypeError" ? new TypeError(shape.message) : new Error(shape.message);
  for (const key of ["name", "code", "claim", "reason", "payload"]) if (Object.hasOwn(shape, key)) error[key] = shape[key];
  if (Object.hasOwn(shape, "claim")) error.cause = { claim: shape.claim, reason: shape.reason, payload: shape.payload };
  return error;
}
function unwrap(result) {
  if (Object.hasOwn(result, "error")) throw fromError(result.error);
  return result.value;
}
function nativeJwtError(error) {
  let shape;
  try { shape = JSON.parse(error.message); } catch { throw error; }
  throw fromError(shape);
}
function normalizedUrl(value, label, issuer = false) {
  let info = {};
  try {
    const url = new URL(value);
    info = Object.fromEntries(["href", "hash", "protocol", "hostname", "username", "password", "pathname", "search"].map(key => [key, url[key]]));
  } catch { /* Rust supplies the protocol diagnostic for malformed URLs. */ }
  return unwrap(native.authorizationUrl(JSON.stringify(info), label, issuer));
}
function params(source) {
  const values = Object.create(null);
  for (const [key, value] of source instanceof URL ? source.searchParams : source) if (!Object.hasOwn(values, key)) values[key] = value;
  return values;
}
function response(body, status = 200) {
  return Response.json(body, { status, headers: { "cache-control": "no-store", pragma: "no-cache" } });
}
function redirect(transaction, issuer, key, value) {
  const url = new URL(transaction.redirectUri);
  url.searchParams.set(key, value);
  if (transaction.state !== undefined) url.searchParams.set("state", transaction.state);
  url.searchParams.set("iss", issuer);
  return url;
}
export function createOAuthAuthorizationServer(options) {
  const issuer = normalizedUrl(options.issuer, "issuer", true);
  const resources = options.resources.map(value => normalizedUrl(value, "resource"));
  const settings = { issuer, resources };
  for (const key of ["scopesSupported", "defaultScopes", "accessTokenTtlSeconds", "authorizationCodeTtlSeconds", "authorizationTransactionTtlSeconds", "refreshTokenTtlSeconds", "maxRequestBodyBytes"]) settings[key] = options[key];
  let policy;
  try { policy = new native.NativeAuthorizationPolicy(settings); }
  catch (error) { throw new Error(error.message); }
  const call = (command, input = {}) => unwrap(policy.call(command, input));
  const now = options.now ?? Date.now;
  const random = options.randomToken ?? (() => randomBytes(32).toString("base64url"));
  const hash = native.authorizationTokenHash;
  const publicJwk = { ...options.signingKey.publicJwk, kid: options.signingKey.keyId, alg: options.signingKey.algorithm, use: "sig" };
  const publishedJwks = [publicJwk, ...(options.additionalPublicJwks ?? [])];
  const verificationKey = Promise.resolve().then(async () => {
    const plan = native.authorizationKeyPlan(publicJwk, publicJwk.alg);
    return { key: await webcrypto.subtle.importKey("jwk", plan.key, plan.import, plan.extractable, plan.usages), algorithm: plan.verify };
  });
  // Keep a failed eager import observable by verifyAccessToken without an unhandled rejection.
  void verificationKey.catch(() => undefined);
  function requireResource(value) {
    const present = call("resource_presence", { value });
    return call("resource", { value: normalizedUrl(present, "resource") });
  }
  async function readBody(request, kind) {
    call("content_type", { kind, value: request.headers.get("content-type") });
    const budget = new native.NativeAuthorizationBodyBudget(policy.bodyLimit);
    const length = request.headers.get("content-length");
    if (length !== null && budget.declared(Number(length))) {
      void request.body?.cancel().catch(() => undefined);
      throw new OAuthProtocolError("invalid_request", "Request body is too large.", 413);
    }
    if (request.body === null) return "";
    const reader = request.body.getReader();
    const abort = () => { void reader.cancel().catch(() => undefined); };
    request.signal.addEventListener("abort", abort, { once: true });
    if (request.signal.aborted) abort();
    const decoder = new TextDecoder("utf-8", { fatal: true });
    let text = "";
    try {
      while (true) {
        const chunk = await reader.read(); request.signal.throwIfAborted();
        if (chunk.done) return text + decoder.decode();
        if (!budget.admit(chunk.value.byteLength)) throw new OAuthProtocolError("invalid_request", "Request body is too large.", 413);
        text += decoder.decode(chunk.value, { stream: true });
      }
    } catch (error) {
      void reader.cancel().catch(() => undefined);
      if (error instanceof TypeError) throw new OAuthProtocolError("invalid_request", "Request body must use valid UTF-8.", 400);
      throw error;
    } finally { request.signal.removeEventListener("abort", abort); reader.releaseLock(); }
  }
  async function register(request) {
    const initial = call("registration_input", { body: await readBody(request, "json") });
    const plan = call("registration_metadata", { payload: initial.payload, redirectUris: initial.redirectUris.map(value => normalizedUrl(value, "redirect_uri")) });
    const client = call("client_record", { id: random(), redirectUris: plan.redirectUris, now: now() });
    await options.store.putClient(client);
    return response(call("registration_response", { client, grantTypes: plan.grantTypes }), 201);
  }
  async function authorize(request) {
    const parameters = params(new URL(request.url));
    const client = await options.store.getClient(call("authorize_start", parameters));
    const redirectUri = normalizedUrl(call("authorize_client", { params: parameters, client }), "redirect_uri");
    const scopes = call("authorize_scopes", { params: parameters, client, redirectUri });
    const id = random(), resource = requireResource(parameters.resource ?? null);
    const transaction = call("transaction_record", { params: parameters, id, redirectUri, resource, scopes, createdAt: now(), expiresAtNow: now() });
    await options.store.putAuthorizationTransaction(transaction);
    return options.interaction.start({ request, transaction });
  }
  async function completeAuthorization(input) {
    call("subject", input);
    const transaction = await options.store.takeAuthorizationTransaction(input.transactionId), currentTime = now();
    const scopes = call("complete", { transaction, input, now: currentTime }), grantId = random();
    await options.store.putGrant(call("grant_record", { id: grantId, transaction, subject: input.subject, scopes, now: currentTime }));
    const code = random();
    await options.store.putAuthorizationCode(call("code_record", { hash: hash(code), grantId, transaction, subject: input.subject, scopes, now: currentTime }));
    return { redirectUrl: redirect(transaction, issuer, "code", code), grantId };
  }
  async function denyAuthorization(transactionId, error = "access_denied") {
    const transaction = await options.store.takeAuthorizationTransaction(transactionId);
    call("deny", { transaction });
    return redirect(transaction, issuer, "error", error);
  }
  async function issueToken(grant, includeRefreshToken) {
    const currentTime = now(), tokenId = random();
    const plan = call("token_plan", { grant, now: currentTime, tokenId, algorithm: options.signingKey.algorithm, keyId: options.signingKey.keyId });
    const key = options.signingKey.privateKey;
    const algorithm = call("signing_key", { algorithm: options.signingKey.algorithm, type: key.type, kind: key.asymmetricKeyType, curve: key.asymmetricKeyDetails?.namedCurve, modulusLength: key.asymmetricKeyDetails?.modulusLength });
    const data = `${Buffer.from(JSON.stringify(plan.header)).toString("base64url")}.${Buffer.from(JSON.stringify(plan.payload)).toString("base64url")}`;
    const signature = await new Promise((resolve, reject) => sign(algorithm, Buffer.from(data), { key, dsaEncoding: "ieee-p1363" }, (error, bytes) => error ? reject(error) : resolve(bytes)));
    const token = `${data}.${signature.toString("base64url")}`;
    await options.store.putAccessToken(call("access_record", { hash: hash(token), tokenId, grant, expiresAt: plan.expiresAt }));
    const body = call("token_response", { token, grant });
    if (includeRefreshToken) {
      const refreshToken = random();
      await options.store.putRefreshToken(call("refresh_record", { hash: hash(refreshToken), familyId: random(), grant, now: currentTime }));
      body.refresh_token = refreshToken;
    }
    return body;
  }
  async function exchangeCode(body) {
    const codeValue = call("code_presence", { body });
    const code = await options.store.takeAuthorizationCode(hash(codeValue)), currentTime = now();
    call("code_expiry", { code, now: currentTime }); call("code_initial_binding", { body, code });
    const pkce = call("code_resource_binding", { code, body, resource: requireResource(body.resource ?? null) });
    call("code_pkce", { matches: timingSafeEqual(Buffer.from(pkce.actual, "base64url"), Buffer.from(pkce.expected, "base64url")) });
    const grant = await options.store.getGrant(code.grantId);
    return response(await issueToken(grant, call("grant_valid", { grant })));
  }
  async function refresh(body) {
    const refreshToken = call("refresh_presence", { body }), replacement = random(), currentTime = now();
    const replacementHash = hash(replacement), resource = requireResource(body.resource ?? null);
    const existing = await options.store.rotateRefreshToken(hash(refreshToken), replacementHash, currentTime, call("refresh_expiry", { now: currentTime }));
    const action = call("refresh_status", existing);
    if (action !== "use") {
      if (action === "replay" && existing.grant !== undefined) await options.onGrantRevoked?.(existing.grant);
      call("refresh_error");
    }
    if (!call("refresh_binding", { previous: existing.previous, body, resource })) {
      const grant = await options.store.getGrant(existing.previous.grantId);
      await options.store.revokeGrant(existing.previous.grantId, currentTime);
      if (grant !== undefined) await options.onGrantRevoked?.(grant);
      call("refresh_binding_error");
    }
    const grant = await options.store.getGrant(existing.previous.grantId);
    call("grant_valid", { grant });
    const result = await issueToken(grant, false); result.refresh_token = replacement;
    return response(result);
  }
  async function token(request) {
    const body = params(new URLSearchParams(await readBody(request, "form")));
    return { code: exchangeCode, refresh }[call("grant_type", { body })](body);
  }
  async function revoke(request) {
    const body = params(new URLSearchParams(await readBody(request, "form")));
    if (Object.hasOwn(body, "token")) { const grant = await options.store.revokeToken(hash(body.token), now()); if (grant !== undefined) await options.onGrantRevoked?.(grant); }
    return new Response(null, { status: 200, headers: { "cache-control": "no-store" } });
  }
  const handlers = { metadata: () => response(call("metadata")), jwks: () => response({ keys: publishedJwks }), register, authorize, token, revoke, notFound: () => response({ error: "not_found" }, 404) };
  async function handle(request) {
    try { return await handlers[call("route", { method: request.method, path: new URL(request.url).pathname })](request); }
    catch (error) { if (error instanceof OAuthProtocolError) return response({ error: error.error, error_description: error.message }, error.status); throw error; }
  }
  async function verifyAccessToken(token, resource) {
    const normalized = normalizedUrl(resource, "resource"); call("access_resource", { resource: normalized });
    const storedToken = await options.store.getAccessToken(hash(token)), currentTime = now();
    call("access_expiry", { storedToken, now: currentTime });
    const verification = await verificationKey;
    let jwt, signature, data;
    try { jwt = new native.NativeAuthorizationJwt(token, options.signingKey.algorithm); }
    catch (error) { nativeJwtError(error); }
    if (verification.key.type !== "public" || !verification.key.usages.includes("verify")) throw new TypeError("CryptoKey instances for asymmetric algorithm verifying must be of type \"public\"");
    try { [signature, data] = jwt.signatureData(); } catch (error) { nativeJwtError(error); }
    const key = verification.key;
    call("verification_key", { algorithm: options.signingKey.algorithm, name: key.algorithm.name, curve: key.algorithm.namedCurve, hash: key.algorithm.hash?.name, modulusLength: key.algorithm.modulusLength, usages: key.usages });
    let valid;
    try { valid = await webcrypto.subtle.verify(verification.algorithm, verification.key, signature, data); } catch { valid = false; }
    if (!valid) throw fromError({ name: "JWSSignatureVerificationFailed", code: "ERR_JWS_SIGNATURE_VERIFICATION_FAILED", message: "signature verification failed" });
    const payload = unwrap(jwt.claims(issuer, normalized, new Date().getTime() / 1000));
    return call("verify_binding", { payload, storedToken, resource: normalized });
  }
  return { issuer, handle, completeAuthorization, denyAuthorization, verifyAccessToken, async revokeGrant(grantId) {
    const grant = await options.store.getGrant(grantId); await options.store.revokeGrant(grantId, now());
    if (call("notify_grant", { grant })) await options.onGrantRevoked?.(grant);
  } };
}

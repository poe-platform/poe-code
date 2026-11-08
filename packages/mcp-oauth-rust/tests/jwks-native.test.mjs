import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { generateKeyPairSync, sign } from "node:crypto";
import { generateKeyPair, exportJWK, SignJWT } from "jose";
import * as rust from "../dist/index.js";
import { createJwksTokenVerifier as referenceVerifier } from "../../mcp-oauth/dist/index.js";
const native = createRequire(import.meta.url)("../dist/mcp-oauth-rust.node");
const issuer = "https://auth.example";
const resource = "https://resource.example/mcp";
const input = token => ({ token, resource, authorizationServers: [issuer], requiredScopes: ["read"] });
const error = (description, code = "invalid_token") => e => e instanceof Error && e.error === code && e.errorDescription === description;
test("JWKS public factory and native policy classes exist", () => {
  assert.equal(typeof rust.createJwksTokenVerifier, "function");
  assert.equal(typeof native.NativeJwksToken, "function");
  assert.equal(typeof native.NativeJwksCache, "function");
});
for (const alg of ["ES256", "ES384", "ES512", "RS256", "RS384", "RS512", "PS256", "PS384", "PS512", "EdDSA"]) {
  test(`official JOSE ${alg} signatures execute native policy`, async () => {
    const pair = await generateKeyPair(alg);
    const key = await exportJWK(pair.publicKey);
    const token = await new SignJWT({ scope: "read", client_id: "client" }).setProtectedHeader({ alg, typ: "AT+JWT" }).setIssuer(issuer).setAudience("https://RESOURCE.example:443/mcp#fragment").setExpirationTime("2m").sign(pair.privateKey);
    let count = 0;
    const verifier = rust.createJwksTokenVerifier({ jwksUrl: `${issuer}/keys`, requireAccessTokenType: true, fetch: async (_, init) => {
      assert.equal(init.redirect, "error"); assert.equal(init.headers.Accept, "application/json"); count++;
      return Response.json({ keys: [key] });
    } });
    const result = await verifier.verify(input(token));
    assert.equal(result.token, token); assert.deepEqual(result.audience, [resource]);
    assert.deepEqual(result.scopes, ["read"]); assert.equal(result.clientId, "client");
    assert.equal(Object.hasOwn(result, "subject"), false);
    await verifier.verify(input(token)); assert.equal(count, 1);
  });
}
test("candidate import failures, signature failures and claims obey distinct retry rules", async () => {
  const pair = await generateKeyPair("ES256");
  const wrong = await generateKeyPair("ES256");
  const key = await exportJWK(pair.publicKey);
  const wrongKey = await exportJWK(wrong.publicKey);
  const token = await new SignJWT({ scope: "read" }).setProtectedHeader({ alg: "ES256" }).setIssuer(issuer).setAudience(resource).setExpirationTime("2m").sign(pair.privateKey);
  const make = keys => rust.createJwksTokenVerifier({ jwksUrl: `${issuer}/keys`, fetch: async () => Response.json({ keys }) });
  await make([{ kty: "EC", crv: "P-256", x: "invalid", y: "invalid" }, wrongKey, key]).verify(input(token));
  await assert.rejects(make([wrongKey]).verify(input(token)), error("token signature invalid"));
  await assert.rejects(make([{ kty: "EC" }, wrongKey]).verify(input(token)), error("token verification temporarily unavailable", "temporarily_unavailable"));
  await assert.rejects(make([key]).verify({ ...input(token), authorizationServers: ["wrong"] }), error("issuer mismatch"));
});
test("signed hostile claims, compact headers and scope precedence match the reference", async () => {
  const { privateKey, publicKey } = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
  const jwk = publicKey.export({ format: "jwk" });
  const fetch = async () => Response.json({ keys: [jwk] });
  const now = Math.floor(Date.now() / 1000);
  const values = [undefined, null, false, "", "other", 0, now - 90, now + 90, [], ["read"], { value: 1 }];
  const base = { iss: issuer, exp: now + 120, aud: resource, scope: "read" };
  const cases = [];
  for (const field of ["iss", "exp", "iat", "nbf", "aud", "scope", "scopes", "sub", "client_id"]) {
    for (const value of values) cases.push({ header: { alg: "ES256", typ: "at+jwt" }, payload: { ...base, [field]: value } });
  }
  for (const value of values) {
    for (const field of ["crit", "typ", "kid", "b64"]) cases.push({ header: { alg: "ES256", typ: "at+jwt", [field]: value }, payload: base });
  }
  cases.push(...["", "a  read\tb", "\uFEFFread\u00A0", " read ", "read read"].map(scope => ({ header: { alg: "ES256", typ: "application/AT+JWT" }, payload: { ...base, scope, scopes: ["read"] } })));
  for (const requireAccessTokenType of [false, true]) {
    const options = { jwksUrl: `${issuer}/keys`, fetch, requireAccessTokenType };
    const own = rust.createJwksTokenVerifier(options);
    const oracle = referenceVerifier(options);
    for (const item of cases) {
      const data = `${Buffer.from(JSON.stringify(item.header)).toString("base64url")}.${Buffer.from(JSON.stringify(item.payload)).toString("base64url")}`;
      const signature = sign("sha256", Buffer.from(data), { key: privateKey, dsaEncoding: "ieee-p1363" });
      const token = `${data}.${signature.toString("base64url")}`;
      const observe = verifier => verifier.verify(input(token)).then(result => ({ result }), e => ({ error: e.error, description: e.errorDescription, scope: e.scope }));
      assert.deepEqual(await observe(own), await observe(oracle), JSON.stringify({ requireAccessTokenType, ...item }));
    }
  }
});
test("native config rejects hostile values with the same diagnostic and priority", () => {
  for (const field of ["clockSkewSeconds", "jwksCacheTtlMs", "jwksFetchTimeoutMs", "jwksRefreshCooldownMs"]) {
    for (const value of ["30", false, [], {}, -1, NaN, Infinity, 0.5]) {
      const options = { jwksUrl: `${issuer}/keys`, [field]: value };
      const observe = factory => { try { factory(options); return "accepted"; } catch (e) { return e.message; } };
      assert.equal(observe(rust.createJwksTokenVerifier), observe(referenceVerifier), `${field}: ${String(value)}`);
    }
  }
});
test("failed forced refresh coalesces, consumes cooldown, releases pending state and permits a later attempt", async () => {
  const pair = await generateKeyPair("ES256");
  const key = { ...await exportJWK(pair.publicKey), kid: "old" };
  const issue = kid => new SignJWT({ scope: "read" }).setProtectedHeader({ alg: "ES256", kid }).setIssuer(issuer).setAudience(resource).setExpirationTime("2m").sign(pair.privateKey);
  const old = await issue("old"), next = await issue("next");
  const originalNow = Date.now;
  let now = originalNow(), calls = 0;
  const entered = Promise.withResolvers(), unblock = Promise.withResolvers();
  const verifier = rust.createJwksTokenVerifier({ jwksUrl: `${issuer}/keys`, jwksRefreshCooldownMs: 30, fetch: async () => {
    calls++;
    if (calls === 2) { entered.resolve(); await unblock.promise; throw new Error("private network details"); }
    return Response.json({ keys: calls === 1 ? [key] : [{ ...key, kid: "next" }] });
  } });
  Date.now = () => now;
  try {
    await verifier.verify(input(old));
    const a = verifier.verify(input(next)), b = verifier.verify(input(next));
    const observed = Promise.allSettled([a, b]);
    await entered.promise; unblock.resolve();
    for (const result of await observed) { assert.equal(result.status, "rejected"); assert.ok(error("token verification temporarily unavailable", "temporarily_unavailable")(result.reason)); }
    assert.equal(calls, 2);
    await assert.rejects(verifier.verify(input(next)), error("token signature invalid")); assert.equal(calls, 2);
    now += 30;
    await verifier.verify(input(next)); assert.equal(calls, 3);
  } finally { Date.now = originalNow; }
});
test("expiry loads coalesce and failed documents preserve cached key snapshots", async () => {
  const pair = await generateKeyPair("ES256");
  const key = await exportJWK(pair.publicKey);
  const token = await new SignJWT({ scope: "read" }).setProtectedHeader({ alg: "ES256" }).setIssuer(issuer).setAudience(resource).setExpirationTime("2m").sign(pair.privateKey);
  const originalNow = Date.now;
  let now = originalNow(), calls = 0;
  const entered = Promise.withResolvers(), unblock = Promise.withResolvers();
  const verifier = rust.createJwksTokenVerifier({ jwksUrl: `${issuer}/keys`, jwksCacheTtlMs: 10, fetch: async () => {
    calls++; if (calls === 2) { entered.resolve(); await unblock.promise; return Response.json({ keys: [null] }); }
    return Response.json({ keys: [key] });
  } });
  Date.now = () => now;
  try {
    await verifier.verify(input(token)); now += 10;
    const observed = Promise.allSettled([verifier.verify(input(token)), verifier.verify(input(token))]);
    await entered.promise; unblock.resolve();
    for (const result of await observed) assert.equal(result.status, "rejected");
    assert.equal(calls, 2);
    await verifier.verify(input(token)); assert.equal(calls, 3);
  } finally { Date.now = originalNow; }
});
test("native documents keep independent snapshots when their cache is replaced", () => {
  const cache = new native.NativeJwksCache(100, 10);
  const document = new native.NativeJwksDocument(JSON.stringify({ keys: [{ kty: "EC", crv: "P-256", x: "old", y: "old" }] }));
  cache.store(document, 1);
  const snapshot = cache.snapshot();
  cache.store(new native.NativeJwksDocument(JSON.stringify({ keys: [{ kty: "EC", crv: "P-256", x: "new", y: "new" }] })), 2);
  const token = new native.NativeJwksToken(`${Buffer.from('{"alg":"ES256"}').toString("base64url")}.e30.AA`, '["ES256"]');
  assert.equal(snapshot.select(token)[0].key.x, "old");
  assert.equal(cache.snapshot().select(token)[0].key.x, "new");
});

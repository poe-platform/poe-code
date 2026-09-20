import { test } from "node:test";
import assert from "node:assert/strict";
import * as rust from "../dist/index.js";
import { createInMemoryAuthorizationServerStore as reference, createAuthorizationInteractionSecurity as referenceSecurity, verifyAuthorizationInteractionCsrf as referenceCsrf } from "../../mcp-oauth-server/dist/index.js";
const grant = id => ({ id, clientId: "client", subject: "subject", resource: "https://resource.example", scopes: ["read"], createdAt: 0 });
const refresh = (tokenHash, grantId = "g", familyId = "f") => ({ tokenHash, familyId, grantId, clientId: "client", subject: "subject", resource: "https://resource.example", scopes: ["read"], createdAt: 0, expiresAt: 100, status: "active" });
test("public store, cookie helpers and native state exist", () => {
  assert.equal(typeof rust.createInMemoryAuthorizationServerStore, "function");
  assert.equal(typeof rust.createAuthorizationInteractionSecurity, "function");
  assert.equal(typeof rust.verifyAuthorizationInteractionCsrf, "function");
});
test("record admission and reads isolate mutations and preserve own undefined and structured clone values", async () => {
  const store = rust.createInMemoryAuthorizationServerStore();
  const client = { id: "client\ud800", redirectUris: ["https://example.test"], createdAt: 1, extra: undefined, bytes: new Uint8Array([1, 2]), date: new Date(10), big: 12n };
  client.self = client;
  await store.putClient(client); client.redirectUris.push("changed"); client.bytes[0] = 99;
  const result = await store.getClient(client.id);
  assert.deepEqual(result.redirectUris, ["https://example.test"]); assert.equal(result.bytes[0], 1);
  assert.equal(Object.hasOwn(result, "extra"), true); assert.equal(result.self, result);
  assert.equal(result.date.getTime(), 10); assert.equal(result.big, 12n);
  result.redirectUris.push("changed"); result.bytes[0] = 88;
  assert.equal((await store.getClient(client.id)).bytes[0], 1);
  await assert.rejects(store.putClient({ ...client, callback() {} }), { name: "DataCloneError" });
});
test("refresh rotation and replay/revocation match original store effects", async () => {
  const own = rust.createInMemoryAuthorizationServerStore(), oracle = reference();
  for (const store of [own, oracle]) {
    await store.putGrant(grant("g")); await store.putGrant(grant("other"));
    await store.putRefreshToken(refresh("r")); await store.putRefreshToken(refresh("different", "other", "other"));
    await store.putAccessToken({ tokenHash: "a", tokenId: "jti", grantId: "g", subject: "subject", clientId: "client", resource: "https://resource.example", expiresAt: 100 });
  }
  for (const args of [["r", "r2", 10, 200], ["r2", "r3", 20, 300], ["r", "r4", 30, 400], ["r3", "r5", 40, 500], ["different", "different2", 50, 500], ["missing", "no", 50, 500]]) {
    assert.deepEqual(await own.rotateRefreshToken(...args), await oracle.rotateRefreshToken(...args));
  }
  for (const id of ["g", "other"]) assert.deepEqual(await own.getGrant(id), await oracle.getGrant(id));
  assert.deepEqual(await own.revokeToken("a", 60), await oracle.revokeToken("a", 60));
  assert.deepEqual(await own.getAccessToken("a"), await oracle.getAccessToken("a"));
  await own.revokeGrant("other", 70); await oracle.revokeGrant("other", 70);
  assert.deepEqual(await own.getGrant("other"), await oracle.getGrant("other"));
});
test("transactions/codes are consumed once even under concurrent callers", async () => {
  const store = rust.createInMemoryAuthorizationServerStore();
  const transaction = { id: "t", clientId: "client", redirectUri: "https://example.test", codeChallenge: "challenge", resource: "https://resource.example", scopes: ["read"], state: undefined, createdAt: 0, expiresAt: 100 };
  await store.putAuthorizationTransaction(transaction);
  const transactions = await Promise.all(Array.from({ length: 32 }, () => store.takeAuthorizationTransaction("t")));
  assert.equal(transactions.filter(v => v !== undefined).length, 1); assert.deepEqual(transactions[0], transaction);
  const code = { tokenHash: "c", grantId: "g", clientId: "client", subject: "subject", redirectUri: "https://example.test", codeChallenge: "challenge", resource: "https://resource.example", scopes: ["read"], expiresAt: 100 };
  await store.putAuthorizationCode(code);
  const codes = await Promise.all(Array.from({ length: 32 }, () => store.takeAuthorizationCode("c")));
  assert.equal(codes.filter(v => v !== undefined).length, 1); assert.deepEqual(codes[0], code);
});
test("CSRF generation preserves call order, validation priority and default cookies", () => {
  const observe = (factory, options) => { let calls = 0; try { return { value: factory({ ...options, randomToken: () => `value${calls++}` }), calls }; } catch (e) { return { error: e.message, calls }; } };
  for (const cookieName of [undefined, "__Host-csrf", "csrf", "__Host-a;b", "__Host-a=b"]) {
    for (const maxAgeSeconds of [undefined, 1, 600, 0, -1, 0.5, NaN, Infinity, "600"]) {
      assert.deepEqual(observe(rust.createAuthorizationInteractionSecurity, { cookieName, maxAgeSeconds }), observe(referenceSecurity, { cookieName, maxAgeSeconds }));
    }
  }
  const defaultValue = rust.createAuthorizationInteractionSecurity();
  for (const key of ["csrfToken", "state", "nonce"]) assert.equal(Buffer.from(defaultValue[key], "base64url").length, 32);
  assert.equal(new Set([defaultValue.csrfToken, defaultValue.state, defaultValue.nonce]).size, 3);
});
test("CSRF cookie selection and timing-safe UTF-8 comparison match reference", () => {
  for (const cookieHeader of [null, "", "other=x; __Host-mcp_oauth_csrf=secret", "__Host-mcp_oauth_csrf=secret; __Host-mcp_oauth_csrf=second", "prefix__Host-mcp_oauth_csrf=secret", "\uFEFF__Host-mcp_oauth_csrf=\ud800", "__Host-mcp_oauth_csrf="]) {
    for (const submittedToken of ["", "secret", "second", "\ud800", "\ufffd"]) {
      assert.equal(rust.verifyAuthorizationInteractionCsrf({ cookieHeader, submittedToken }), referenceCsrf({ cookieHeader, submittedToken }));
    }
  }
});
test("store expiry, same-hash replacement and own undefined revocation fields match reference", async () => {
  for (const expiresAt of [-Infinity, Infinity, NaN, -0, 10, 11]) {
    for (const now of [NaN, 10]) {
      const own = rust.createInMemoryAuthorizationServerStore(), oracle = reference();
      for (const store of [own, oracle]) {
        await store.putGrant({ ...grant("g"), revokedAt: undefined });
        await store.putRefreshToken({ ...refresh("r"), expiresAt });
      }
      assert.deepEqual(await own.rotateRefreshToken("r", "r", now, 20), await oracle.rotateRefreshToken("r", "r", now, 20), `${expiresAt} / ${now}`);
      assert.deepEqual(await own.revokeToken("r", 30), await oracle.revokeToken("r", 30));
      assert.deepEqual(await own.getGrant("g"), await oracle.getGrant("g"));
    }
  }
});
test("seeded store sequences preserve replacement, family isolation and revocation effects", async () => {
  const own = rust.createInMemoryAuthorizationServerStore(), oracle = reference();
  let seed = 0x3a14fd;
  const next = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed; };
  for (const store of [own, oracle]) {
    for (let i = 0; i < 12; i++) {
      await store.putGrant(grant(`g${i}`));
      await store.putRefreshToken(refresh(`r${i}`, `g${i}`, `f${i % 4}`));
      await store.putAccessToken({ tokenHash: `a${i}`, tokenId: `j${i}`, grantId: `g${i}`, subject: "subject", clientId: "client", resource: "https://resource.example", expiresAt: 100 });
    }
  }
  for (let i = 0; i < 512; i++) {
    const id = next() % 16;
    switch (next() % 5) {
      case 0: {
        const replacement = `r${next() % 16}`;
        assert.deepEqual(await own.rotateRefreshToken(`r${id}`, replacement, i / 10, 1000), await oracle.rotateRefreshToken(`r${id}`, replacement, i / 10, 1000));
        break;
      }
      case 1: assert.deepEqual(await own.revokeToken(`r${id}`, i / 10), await oracle.revokeToken(`r${id}`, i / 10)); break;
      case 2: assert.deepEqual(await own.revokeToken(`a${id}`, i / 10), await oracle.revokeToken(`a${id}`, i / 10)); break;
      case 3: await own.revokeGrant(`g${id}`, i / 10); await oracle.revokeGrant(`g${id}`, i / 10); break;
      case 4: await own.putRefreshToken(refresh(`r${id}`, `g${id}`, `f${id % 4}`)); await oracle.putRefreshToken(refresh(`r${id}`, `g${id}`, `f${id % 4}`)); break;
    }
    for (const method of ["getGrant", "getAccessToken"]) {
      const key = method === "getGrant" ? `g${id}` : `a${id}`;
      assert.deepEqual(await own[method](key), await oracle[method](key));
    }
  }
});

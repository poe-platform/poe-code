import { test } from "node:test";
import assert from "node:assert/strict";
import * as own from "../dist/index.js";
process.env.TSX_DISABLE_CACHE = "1";
const { tsImport } = await import("tsx/esm/api");
const original = await tsImport("../../mcp-oauth/src/client/token-grant.ts", import.meta.url);
test("raw grants preserve staged option effects, clock errors and absolute precedence", () => {
  for (const api of [original, own]) {
    const raw = { access_token: " a ", token_type: "bEaReR", expires_in: 1, expires_at: 2, expiresAt: 3, scope: "write read" };
    const events = [], options = {
      get expiresAt() { events.push("expiry"); return 4; },
      get issuedAt() { events.push("issued"); return 5; },
      now() { throw Error("must not call"); }
    };
    assert.deepEqual(api.parseOAuthTokenGrant(raw, options), { accessToken: "a", tokenType: "Bearer", expiresAt: 4, scope: "read write" });
    assert.deepEqual(events, ["expiry", "expiry", "expiry", "issued", "issued", "issued", "expiry"]);
    const reason = {};
    assert.throws(() => api.parseOAuthTokenGrant(raw, { now() { throw reason; } }), error => error === reason);
    let calls = 0;
    assert.throws(() => api.parseOAuthTokenGrant({ ...raw, expires_at: Number.MAX_SAFE_INTEGER }, { now() { calls++; return 0; } }), error => error.message === "Invalid OAuth token grant");
    assert.equal(calls, 0);
    assert.throws(() => api.parseOAuthTokenGrant(raw, { expiresAt: 0, now: () => Infinity }), error => error.message === "Invalid OAuth token grant");
    assert.throws(() => api.parseOAuthTokenGrant(raw, { now: () => "5" }), error => error.message === "Invalid OAuth token grant");
    assert.throws(() => api.parseOAuthTokenGrant({ ...raw, access_token: "a\nsecret" }, { get expiresAt() { throw reason; } }), error => error.message === "Invalid OAuth token grant");
    const final = {}, dynamic = { calls: 0, get expiresAt() { return ++this.calls < 4 ? 4 : final; } };
    assert.equal(api.parseOAuthTokenGrant(raw, dynamic).expiresAt, final);
  }
});

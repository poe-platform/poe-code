import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { test } from "node:test";
const native = createRequire(import.meta.url)("../dist/mcp-oauth-rust.node");
process.env.TSX_DISABLE_CACHE = "1";
const { tsImport } = await import("tsx/esm/api");
const reference = await tsImport("../../mcp-oauth/src/client/authorization-state.ts", import.meta.url);
const encode = value => Buffer.from(JSON.stringify(value)).toString("base64url");
test("authorization-state creation preserves issuer and flags with fresh operating-system nonces", async () => {
  const { createAuthorizationState, parseAuthorizationState } = await import("../dist/state.js");
  const states = new Set();
  for (const issuer of ["https://auth.example", "issuer\ud800", "\ufeffissuer", "🦊"]) for (const requireIssuer of [true, false]) {
    const state = createAuthorizationState({ issuer, requireIssuer }); states.add(state);
    assert.deepEqual(parseAuthorizationState(state), { issuer, requireIssuer });
    assert.deepEqual(parseAuthorizationState(reference.createAuthorizationState({ issuer, requireIssuer })), { issuer, requireIssuer });
    const payload = JSON.parse(Buffer.from(state, "base64url").toString());
    assert.equal(Buffer.from(payload.n, "base64url").length, 16);
    assert.equal(payload.v, 1);
  }
  assert.equal(states.size, 8);
});
test("authorization-state parsing matches field validation and Node's lenient base64url decoder", () => {
  for (const value of [null, "", "not json", ...[{}, [], null, { v:1,n:"n",i:"issuer",r:true }, { v:2,n:"n",i:"issuer",r:true }, { v:1,n:"",i:"issuer",r:true }, { v:1,n:"n",i:"",r:true }, { v:1,n:"n",i:"issuer",r:1 }, { v:1,n:"n",i:"issuer",r:false, extra: "ignored" }, { v:1,n:"n",i:"issuer\ud800",r:true }].map(encode)]) assert.deepEqual(native.parseAuthorizationState(value), reference.parseAuthorizationState(value));
  const valid = encode({ v:1,n:"n",i:"issuer",r:true });
  for (const decorated of [valid + "===junk", valid.replaceAll("-", "+").replaceAll("_", "/"), " \n" + valid + "\n", valid.split("").join("!"), valid.split("").join("☀"), valid.split("").map(char => String.fromCharCode(char.charCodeAt(0) + 256)).join("")]) assert.deepEqual(native.parseAuthorizationState(decorated), reference.parseAuthorizationState(decorated));
  assert.throws(() => native.createAuthorizationState("issuer", true, Buffer.alloc(15)));
});
test("seeded malformed base64 and UTF8 states match the TypeScript decoder", () => {
  let seed = 0x4193ea92;
  const random = () => { seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5; return seed >>> 0; };
  for (let sample=0; sample<1024; sample++) {
    const raw = Array.from({ length: random()%257 }, () => String.fromCharCode(random()&65535)).join("");
    assert.deepEqual(native.parseAuthorizationState(raw), reference.parseAuthorizationState(raw));
    const bytes = Buffer.from(Array.from({ length: random()%257 }, () => random()&255));
    assert.deepEqual(native.parseAuthorizationState(bytes.toString("base64url")), reference.parseAuthorizationState(bytes.toString("base64url")));
  }
});

test("lenient base64 bytes match Node for seeded arbitrary UTF16 and truncated groups", () => {
  let seed = 0x191fe581;
  const random = () => { seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5; return seed >>> 0; };
  const fixtures = ["", "A", "AA", "AAA", "AAAA", "a===b", "+/--__", "\u0141AAA", "\ud83dAAA", "A☀AAA"];
  for (let sample=0; sample<1024; sample++) fixtures.push(Array.from({ length: random()%257 }, () => String.fromCharCode(random()&65535)).join(""));
  for (const text of fixtures) assert.deepEqual(native.decodeAuthorizationBytes(text), Buffer.from(text, "base64url"));
});

test("decoded authorization fields cannot be supplied through Object.prototype", () => {
  const fields = { v:1, n:"inherited-nonce", i:"inherited-issuer", r:true };
  const previous = new Map(Object.keys(fields).map(key => [key, Object.getOwnPropertyDescriptor(Object.prototype, key)]));
  try {
    for (const [key, value] of Object.entries(fields)) Object.defineProperty(Object.prototype, key, { configurable:true, writable:true, value });
    assert.equal(native.parseAuthorizationState(encode({})), null);
    assert.equal(reference.parseAuthorizationState(encode({})), null);
  } finally {
    for (const [key, descriptor] of previous) {
      if (descriptor === undefined) delete Object.prototype[key];
      else Object.defineProperty(Object.prototype, key, descriptor);
    }
  }
});

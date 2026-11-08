import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { test } from "node:test";
import * as own from "../dist/index.js";
import { generateCodeChallenge as reference } from "mcp-oauth";
const native = createRequire(import.meta.url)("../dist/mcp-oauth-rust.node");
test("native PKCE matches RFC7636 and the TypeScript implementation's UTF16-to-UTF8 rules", () => {
  const vector = "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk";
  assert.equal(own.generateCodeChallenge(vector), "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM");
  for (const text of ["", "abc", "\ufeffverifier", "🦊", "\ud800", "\udc00", "a\ud800b\udc00", "x".repeat(55), "x".repeat(56), "x".repeat(63), "x".repeat(64), "x".repeat(65), "x".repeat(10000)]) assert.equal(own.generateCodeChallenge(text), reference(text));
});
test("verifier encoding uses exactly 32 entropy bytes and generates distinct URL-safe 43-character values", () => {
  const seen = new Set();
  for (let i = 0; i < 64; i++) {
    const verifier = own.generateCodeVerifier();
    assert.equal(verifier.length, 43);
    assert.equal([...verifier].every(char => "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_".includes(char)), true);
    seen.add(verifier);
    const entropy = Buffer.alloc(32, i);
    assert.equal(native.encodeCodeVerifier(entropy), entropy.toString("base64url"));
  }
  assert.equal(seen.size, 64);
  assert.throws(() => native.encodeCodeVerifier(Buffer.alloc(31)), { message: "PKCE verifier requires 32 bytes of operating-system entropy" });
});
test("SHA256 matches Node across every padding boundary and seeded binary and UTF16 inputs", () => {
  let seed = 0x9246ee1a;
  const random = () => { seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5; return seed >>> 0; };
  for (let sample = 0; sample < 1024; sample++) {
    const bytes = Buffer.from(Array.from({ length: sample < 256 ? sample : random() % 8193 }, () => random() & 255));
    assert.equal(native.hashBytes(bytes).toString("hex"), createHash("sha256").update(bytes).digest("hex"));
    const text = Array.from({ length: random() % 257 }, () => String.fromCharCode(random() & 65535)).join("");
    assert.equal(own.generateCodeChallenge(text), reference(text));
  }
});

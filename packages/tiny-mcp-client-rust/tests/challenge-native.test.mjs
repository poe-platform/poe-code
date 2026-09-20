import assert from "node:assert/strict";
import { test } from "node:test";
import { parseBearerWwwAuthenticateHeader as actual } from "../dist/index.js";
process.env.TSX_DISABLE_CACHE = "1";
const { tsImport } = await import("tsx/esm/api");
const { parseBearerWwwAuthenticateHeader: reference } = await tsImport("../../tiny-mcp-client/src/oauth-discovery.ts", import.meta.url);

test("Bearer challenges preserve schemes, duplicate names, prototype keys and Unicode", () => {
  const schemes = ["Basic", "Digest", "Bearer", "bEaReR", "bearer", "Negotiate", "", "\ud800"];
  const values = ["", "abc==", "realm=foo", 'realm="a,b"', 'scope="read\\\"write"', 'realm="unfinished', "a=", "a=,", "a=\"\\", '__proto__="owned", constructor=x', "ΣΣ=x, İ=y, X\ud800=z", "realm=one, REALM=two", 'resource_metadata="https://a.test/meta"', "a=one,b=two,Basic abc==", "\t,\tBearer"];
  const separators = [",", ", ", "\t,\t", " ", "\n"];
  assert.equal(actual(null), null);
  for (const scheme of schemes) for (const value of values) {
    const header = `${scheme} ${value}`;
    assert.deepEqual(actual(header), reference(header), JSON.stringify(header));
    for (const separator of separators) {
      const mixed = `Basic abc==${separator}${header}${separator}Bearer error="invalid_token"`;
      assert.deepEqual(actual(mixed), reference(mixed), JSON.stringify(mixed));
    }
  }
  const challenge = actual('Bearer __proto__="owned", constructor=x');
  assert.equal(Object.getPrototypeOf(challenge.params), null);
  assert.equal(challenge.params.__proto__, "owned");
});

test("deterministic malformed challenge corpus matches the TypeScript oracle", () => {
  const alphabet = ["B", "e", "a", "r", " ", "\t", "\n", ",", "=", '"', "\\", "x", "0", "/", "\ud800", "Σ"];
  let seed = 971;
  for (let index = 0; index < 4096; index++) {
    let header = index % 2 ? "Bearer " : "Basic abc==, Bearer ";
    for (let length = index % 61; length > 0; length--) {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      header += alphabet[seed % alphabet.length];
    }
    assert.deepEqual(actual(header), reference(header), JSON.stringify(header));
  }
});

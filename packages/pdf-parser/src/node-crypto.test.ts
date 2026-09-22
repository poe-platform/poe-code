import { test } from "node:test";
import assert from "node:assert/strict";
import { createNodePdfCrypto } from "./node-crypto.js";
const hex = (s: string) => Uint8Array.from(Buffer.from(s, "hex"));

test("Node platform MD5/SHA and raw AES CBC/ECB specification vectors", async () => {
  const crypto = createNodePdfCrypto();
  const abc = new TextEncoder().encode("abc");
  assert.deepEqual(await crypto.digest("MD5", abc), hex("900150983cd24fb0d6963f7d28e17f72"));
  assert.deepEqual(await crypto.digest("SHA-256", abc), hex("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"));
  const key = hex("2b7e151628aed2a6abf7158809cf4f3c");
  const iv = hex("000102030405060708090a0b0c0d0e0f");
  const plain = hex("6bc1bee22e409f96e93d7e117393172a");
  for (const [mode, expected] of [
    ["CBC", "7649abac8119b246cee98e9b12e9197d"],
    ["ECB", "3ad77bb40d7a3660a89ecaf32466ef97"]
  ] as const) {
    const vectorIv = mode === "CBC" ? iv : new Uint8Array();
    const encrypted = await crypto.aes("encrypt", mode, key, vectorIv, plain);
    assert.deepEqual(encrypted, hex(expected));
    assert.deepEqual(await crypto.aes("decrypt", mode, key, vectorIv, encrypted), plain);
  }
});

test("Node primitives reject invalid shapes and quotas and preserve cancellation", () => {
  const crypto = createNodePdfCrypto({ inputBytes: 16 });
  assert.throws(() => crypto.digest("MD5", new Uint8Array(17)), /limit/);
  const key = new Uint8Array(16);
  const iv = new Uint8Array(16);
  assert.throws(() => crypto.aes("decrypt", "CBC", key, iv, new Uint8Array(15)), /block/);
  assert.throws(() => crypto.aes("decrypt", "CBC", new Uint8Array(5), iv, key), /key/);
  assert.throws(() => crypto.aes("decrypt", "CBC", key, new Uint8Array(), key), /IV/);
  assert.throws(() => crypto.aes("decrypt", "ECB", key, iv, key), /IV/);
  const controller = new AbortController();
  const reason = { stop: true };
  controller.abort(reason);
  assert.throws(() => crypto.digest("MD5", key, controller.signal), e => e === reason);
  assert.throws(() => crypto.aes("decrypt", "CBC", key, iv, key, controller.signal), e => e === reason);
});

import { test } from "node:test";
import assert from "node:assert/strict";
import { runInNewContext } from "node:vm";
import { createPdfCrypto } from "./crypto.js";

const platform = {
  digest() { throw new Error("unexpected digest"); },
  aes() { throw new Error("unexpected AES"); }
};
const bytes = (hex: string) => Uint8Array.from(Buffer.from(hex, "hex"));

test("RC4 RFC 6229 independent offsets for 40/128/256-bit keys", async () => {
  const crypto = createPdfCrypto(platform);
  // RFC 6229 section 2, key 1; no PDF fixture producer supplies these answers.
  for (const [key, first, at256] of [
    ["0102030405", "b2396305f03dc027ccc3524a0a1118a8", "1cfcf62b03eddb641d77dfcf7f8d8c93"],
    ["0102030405060708090a0b0c0d0e0f10", "9ac7cc9a609d1ef7b2932899cde41b97", "d39d566bc6bce3010768151549f3873f"],
    ["0102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f20", "eaa6bd25880bf93d3f5d1e4ca2611d91", "02e1e7056b0f623900496422943e97b6"]
  ]) {
    const result = await crypto.rc4(bytes(key!), new Uint8Array(272));
    assert.deepEqual(result.subarray(0, 16), bytes(first!));
    assert.deepEqual(result.subarray(256), bytes(at256!));
  }
});

test("RC4 owns output, preserves inputs, restarts state, and is symmetric", async () => {
  const crypto = createPdfCrypto(platform);
  const key = bytes("4b6579");
  const input = new TextEncoder().encode("Plaintext");
  const result = await crypto.rc4(key, input);
  assert.deepEqual(result, bytes("bbf316e8d940af0ad3"));
  assert.deepEqual(await crypto.rc4(key, result), input);
  assert.deepEqual(await crypto.rc4(key, input), result);
  assert.notEqual(result.buffer, input.buffer);
  assert.deepEqual(key, bytes("4b6579"));
  assert.deepEqual(input, new TextEncoder().encode("Plaintext"));
  assert.deepEqual(await crypto.rc4(key, new Uint8Array()), new Uint8Array());
});

test("RC4 rejects invalid byte authority, keys and budgets before processing", () => {
  const crypto = createPdfCrypto(platform, { inputBytes: 3 });
  for (const key of [new Uint8Array(), new Uint8Array(257)])
    assert.throws(() => crypto.rc4(key, new Uint8Array()), /key/);
  assert.throws(() => crypto.rc4(bytes("01"), new Uint8Array(4)), /limit/);
  const spoof = new Uint16Array(2);
  Object.defineProperty(spoof, Symbol.toStringTag, { value: "Uint8Array" });
  assert.throws(() => crypto.rc4(bytes("01"), spoof as unknown as Uint8Array), /bytes/);
  const hidden = new Uint8Array(4);
  Object.defineProperty(hidden, "length", { value: 0 });
  assert.throws(() => crypto.rc4(bytes("01"), hidden), /limit/);
  const foreign = runInNewContext("new Uint8Array([1, 2, 3])") as Uint8Array;
  assert.equal(crypto.rc4(bytes("01"), foreign).length, 3);
  for (const inputBytes of [-1, 0.5, Infinity, Number.MAX_SAFE_INTEGER])
    assert.throws(() => createPdfCrypto(platform, { inputBytes }), /limit/);
});

test("RC4 cancellation preserves exact reasons; platform methods are captured", () => {
  const controller = new AbortController();
  const reason = { cancelled: true };
  controller.abort(reason);
  const crypto = createPdfCrypto(platform);
  assert.throws(() => crypto.rc4(bytes("01"), new Uint8Array(), controller.signal), e => e === reason);
  const provider = {
    marker: bytes("01"),
    digest() { return this.marker; },
    aes() { return this.marker; }
  };
  const captured = createPdfCrypto(provider);
  provider.digest = () => { throw new Error("replaced"); };
  assert.equal(captured.digest("MD5", new Uint8Array()), provider.marker);
  assert.ok(Object.isFrozen(captured));
});

test("RC4 checks cancellation during bounded work and does not mutate caller bytes", () => {
  const controller = new AbortController();
  const reason = { cancelled: "during PRGA" };
  let checks = 0;
  const nativeCheck = controller.signal.throwIfAborted.bind(controller.signal);
  controller.signal.throwIfAborted = () => {
    if (++checks === 3) controller.abort(reason);
    nativeCheck();
  };
  const input = new Uint8Array(8192).fill(255);
  const key = bytes("0102030405");
  assert.throws(() => createPdfCrypto(platform).rc4(key, input, controller.signal), e => e === reason);
  assert.equal(checks, 3);
  assert.ok(input.every(b => b === 255));
  assert.deepEqual(key, bytes("0102030405"));
});

test("RC4 uses intrinsic storage rather than caller iterator or length properties", () => {
  const key = bytes("4b6579");
  const input = new TextEncoder().encode("Plaintext");
  Object.defineProperty(key, "length", { value: 1000000 });
  Object.defineProperty(input, "length", { value: 0 });
  Object.defineProperty(input, Symbol.iterator, { value() { throw new Error("ambient iterator"); } });
  assert.deepEqual(createPdfCrypto(platform).rc4(key, input), bytes("bbf316e8d940af0ad3"));
});

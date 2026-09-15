import assert from "node:assert/strict";
import test from "node:test";
import { createHash } from "node:crypto";
import { zipCrypto } from "../../src/commands/archive/zip/crypto.js";
import { collectBytes, toByteSource } from "../../src/contracts/index.js";

// Independently generated with native Zip -0 -P; Python zipfile verified both
// member payloads and the decrypted 12-byte encryption headers.
const cases = [
  { password: "test", ciphertext: "fjJ/9M4s6Prvwq8v4hP2O+O08UmGLiA4j0752H0zUHIP22wOiG4yRXK3+Q==", plaintext: "oZkL4jDiZjj1aCCFAP+ADQpBWmlwQ3J5cHRvIGJpbmFyeSBmaXh0dXJlCg==" },
  { password: "tiger", ciphertext: "ARbIdiYAws2+muQUdIJzAa6RXZncW7Jx/LMW23YYIO9jW+7r53GqHrZQ0g==", plaintext: "3LQVQJSSPdwNFiCFAP+ADQpBWmlwQ3J5cHRvIGJpbmFyeSBmaXh0dXJlCg==" },
  { password: "é🐯", ciphertext: "CPz+VKZpRMy8BiMDL1fM+eYxIbvi7EctYqOABbW/2FOTry/HBkE/tfUkGA==", plaintext: "1c7dhMXU1fi83iCFAP+ADQpBWmlwQ3J5cHRvIGJpbmFyeSBmaXh0dXJlCg==" },
];

for (const chunkSize of [65535, 65536, 65537, 150012]) {
  test(`ZipCrypto matches native 150000-byte ciphertext across ${chunkSize}-byte chunks`, async () => {
    // Native STORE encryption, independently extracted and hashed with Python.
    const bytes = Buffer.concat([Buffer.from("mxQF01U5hdCPgGmF", "base64"), Uint8Array.from({ length: 150000 }, (_, index) => index % 256)]);
    const source = (async function* () {
      for (let offset = 0; offset < bytes.length; offset += chunkSize) yield bytes.subarray(offset, offset + chunkSize);
    })();
    const signal = new AbortController().signal;
    const digest = createHash("sha256");
    for await (const chunk of zipCrypto(source, new TextEncoder().encode("tiger"), false, signal)) digest.update(chunk);
    assert.equal(digest.digest("hex"), "9dd249b65bf7c2e1c859a22fd885dfa4a86b2b725bbfe1b36306f6d44a5dadb5");
  });
}

for (const entry of cases) {
  for (const decode of [false, true]) {
    for (const chunkSize of [1, 7, 65536]) {
      test(`ZipCrypto native vector ${entry.password}, decode=${decode}, chunks=${chunkSize}`, async () => {
        const source = Buffer.from(decode ? entry.ciphertext : entry.plaintext, "base64");
        const chunks = (async function* () {
          for (let offset = 0; offset < source.length; offset += chunkSize) yield source.subarray(offset, offset + chunkSize);
        })();
        const signal = new AbortController().signal;
        const output = await collectBytes(zipCrypto(chunks, new TextEncoder().encode(entry.password), decode, signal), { maxBytes: 1000, signal });
        assert.deepEqual(Buffer.from(output), Buffer.from(decode ? entry.plaintext : entry.ciphertext, "base64"));
      });
    }
  }
}

test("ZipCrypto interleaved streams have independent key state", async () => {
  const signal = new AbortController().signal;
  const streams = cases.map(entry => zipCrypto((async function* () {
    for (const byte of Buffer.from(entry.ciphertext, "base64")) yield Uint8Array.of(byte);
  })(), new TextEncoder().encode(entry.password), true, signal)[Symbol.asyncIterator]());
  const output: number[][] = cases.map(() => []);
  for (;;) {
    const steps = await Promise.all(streams.map(stream => stream.next()));
    if (steps.every(step => step.done)) break;
    steps.forEach((step, index) => { if (!step.done) output[index]!.push(...step.value); });
  }
  cases.forEach((entry, index) => assert.deepEqual(Buffer.from(output[index]!), Buffer.from(entry.plaintext, "base64")));
});

test("ZipCrypto output owns its bytes and is bounded to 64 KiB", async () => {
  const bytes = new Uint8Array(150000).fill(42);
  const original = new Uint8Array(bytes);
  const signal = new AbortController().signal;
  const stream = zipCrypto(toByteSource(bytes), Uint8Array.of(1, 2), false, signal)[Symbol.asyncIterator]();
  const first = await stream.next();
  assert.equal(first.done, false);
  assert.ok(first.value!.length <= 65536);
  const saved = new Uint8Array(first.value!);
  for (;;) { const next = await stream.next(); if (next.done) break; assert.ok(next.value.length <= 65536); }
  assert.deepEqual(first.value, saved);
  assert.deepEqual(bytes, original);
});

test("ZipCrypto cancellation after output retires the input without another pull", async () => {
  const controller = new AbortController();
  const reason = { stop: "cipher" };
  let pulls = 0, closed = false;
  const source = (async function* () {
    try { pulls++; yield new Uint8Array(70000); pulls++; yield Uint8Array.of(1); }
    finally { closed = true; }
  })();
  const stream = zipCrypto(source, Uint8Array.of(1), false, controller.signal)[Symbol.asyncIterator]();
  await stream.next();
  controller.abort(reason);
  await assert.rejects(stream.next(), error => error === reason);
  assert.equal(pulls, 1);
  assert.equal(closed, true);
});

test("ZipCrypto rejects a pre-aborted signal before touching input", async () => {
  const controller = new AbortController();
  controller.abort(false);
  let pulls = 0;
  const source = (async function* () { pulls++; yield Uint8Array.of(1); })();
  await assert.rejects(collectBytes(zipCrypto(source, new Uint8Array(), true, controller.signal), { maxBytes: 10, signal: controller.signal }), error => error === false);
  assert.equal(pulls, 0);
});

test("ZipCrypto consumer retirement closes input without pulling ahead", async () => {
  let pulls = 0, closed = false;
  const source = (async function* () {
    try { pulls++; yield Uint8Array.of(1, 2); pulls++; yield Uint8Array.of(3); }
    finally { closed = true; }
  })();
  const stream = zipCrypto(source, new Uint8Array(), false, new AbortController().signal);
  await stream.next();
  await stream.return(undefined);
  assert.equal(pulls, 1);
  assert.equal(closed, true);
});

test("ZipCrypto preserves source failures after a published chunk", async () => {
  const reason = { source: "failure" };
  let closed = false;
  const source = (async function* () {
    try { yield Uint8Array.of(1); throw reason; }
    finally { closed = true; }
  })();
  const signal = new AbortController().signal;
  await assert.rejects(collectBytes(zipCrypto(source, new Uint8Array(), true, signal), { maxBytes: 10, signal }), error => error === reason);
  assert.equal(closed, true);
});

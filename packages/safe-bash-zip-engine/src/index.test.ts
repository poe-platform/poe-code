import assert from "node:assert/strict";
import test from "node:test";
import { crc32 } from "./zip-format.js";
test("ZIP CRC agrees with the standard check vector", () => {
 assert.equal(crc32(new TextEncoder().encode("123456789")), 0xcbf43926);
});

import { collectBytes } from "safe-bash-contracts";
import { settings } from "safe-bash-io-engine/commands/archive/internal";
import { makeZipEntry, readZipArchive, decodeZipEntry, writeZipArchive } from "./zip-format.js";

test("ZIP directory and member reads use bounded ranges without collecting the archive", async () => {
  const signal = new AbortController().signal;
  const limits = settings({ limits: { chunkSize: 4096 } });
  const payload = new Uint8Array(1024 * 1024).fill(73);
  const entry = await makeZipEntry("a", payload, { modified: new Date(2026, 0, 1), mode: 0o100644, directory: false, symlink: false }, limits, signal, 0);
  const bytes = await writeZipArchive({ entries: [entry], comment: new Uint8Array() }, limits, signal);
  let read = 0, largest = 0;
  const archive = await readZipArchive({ size: bytes.length, async read(offset: number, length: number) {
    largest = Math.max(largest, length); read += length;
    return bytes.slice(offset, offset + length);
  } }, limits, signal);
  assert.ok(read < 100000, `directory fetched ${read} payload bytes`);
  assert.equal(archive.entries[0]!.data.length, 0);
  const decoded = await collectBytes(decodeZipEntry(archive.entries[0]!, limits, signal), { signal });
  assert.deepEqual(decoded, payload);
  assert.ok(largest <= 65536);
});

import { encryptAesPayload, encryptAesStream, decryptAesPayload } from "./zip/aes.js";

for (const strength of [128, 192, 256] as const) test(`AES-${strength} emits incrementally with reused input chunks`, async () => {
  const signal = new AbortController().signal;
  const encryption = { aes: { strength, version: 2 as const }, password: new TextEncoder().encode("secret"), entropy: async (size: number) => new Uint8Array(size).fill(17) };
  const bytes = new Uint8Array(70003).map((_, index) => index % 251);
  const expected = await encryptAesPayload((async function* () { yield bytes; })(), encryption, bytes.length, signal);
  let pulls = 0;
  const reused = new Uint8Array(997);
  const source = (async function* () {
    for (let start = 0; start < bytes.length; start += reused.length) {
      const size = Math.min(reused.length, bytes.length - start);
      reused.set(bytes.subarray(start, start + size)); pulls++;
      yield reused.subarray(0, size);
    }
  })();
  const iterator = encryptAesStream(source, encryption, bytes.length, signal)[Symbol.asyncIterator]();
  const header = await iterator.next();
  assert.equal(pulls, 0);
  assert.ok(!header.done);
  const wire = await collectBytes((async function* () { yield header.value!; yield* { [Symbol.asyncIterator]: () => iterator }; })(), { signal });
  assert.deepEqual(wire, expected);
  assert.deepEqual(await decryptAesPayload(wire, encryption.password, encryption.aes, bytes.length, signal), bytes);
});

import { zipFromCrlf, zipToCrlf, zipLineEndingStream } from "./zip/line-endings.js";

for (const from of [false, true]) for (const store of [false, true]) test(`streamed line ending conversion preserves bytes from=${from} store=${store}`, async () => {
  const signal = new AbortController().signal;
  const bytes = new TextEncoder().encode("one\r\ntwo\nthree\r\nfour\x1a".repeat(8000));
  const expected = from ? await zipFromCrlf(bytes, store, signal) : await zipToCrlf(bytes, store, bytes.length * 2, signal);
  const source = (async function* () {
    const reusable = new Uint8Array(997);
    for (let offset = 0; offset < bytes.length; offset += reusable.length) {
      const size = Math.min(reusable.length, bytes.length - offset);
      reusable.set(bytes.subarray(offset, offset + size));
      yield reusable.subarray(0, size);
    }
  })();
  const actual = await collectBytes(zipLineEndingStream(source, from, store, bytes.length * 2, signal), { signal });
  assert.deepEqual(actual, expected);
});

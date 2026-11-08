import assert from "node:assert/strict";
import test from "node:test";
import { collectBytes } from "safe-bash-contracts";
import { settings } from "safe-bash-io-engine/commands/archive/internal";
import { makeZipEntry, streamZipArchive, writeZipArchive, type ZipEntry, type ZipReadSource } from "./zip-format.js";

for (const profile of ["plain", "zip64", "aes", "traditional"] as const) test(`indexed ZIP writer spools directory metadata and matches buffered bytes (${profile})`, async () => {
  const signal = new AbortController().signal;
  const limits = settings({});
  const entries: ZipEntry[] = [];
  for (let i = 0; i < 70; i++) entries.push(await makeZipEntry(`entry-${i}`, new Uint8Array([i]), { modified: new Date(2026, 0, 1), mode: 0o100644, directory: false, symlink: false }, limits, signal, 0));
  if (profile === "aes" || profile === "traditional") for (const entry of entries) entry.encryption = {password: new TextEncoder().encode("secret"), entropy: async size => new Uint8Array(size).fill(7), ...(profile === "aes" ? {aes: {version: 2, strength: 256}} : {})};
  const expected = await writeZipArchive({entries, comment: new Uint8Array()}, limits, signal, false, profile === "zip64");
  let opened = 0, closed = 0, appended = 0;
  // Explicit memory storage test double: verifies the codec protocol, not Worker RAM qualification.
  const factory = async () => {
    opened++;
    const chunks: Uint8Array[] = [];
    return {
      async append(bytes: Uint8Array) { appended += bytes.length; chunks.push(new Uint8Array(bytes)); },
      async finish(): Promise<ZipReadSource> {
        const bytes = await collectBytes((async function*() { yield* chunks; })(), {signal});
        return {size: bytes.length, async read(offset, length) { return bytes.slice(offset, offset + Math.min(17, length)); }};
      },
      async close() { closed++; }
    };
  };
  const indexed = { length: entries.length, async get(i: number) { return entries[i]!; }, async *[Symbol.asyncIterator]() { yield* entries; } };
  const actual = await collectBytes(streamZipArchive({entries:indexed, comment:new Uint8Array()}, limits, signal, false, profile === "zip64", true, factory), {signal});
  assert.deepEqual(actual, expected);
  assert.ok(appended > expected.length);
  assert.equal(opened, 2);
  assert.equal(closed, opened);
});

for (const outcome of ["complete", "cancel", "source-error"] as const) test(`indexed writer live sources ${outcome} preserves metadata ownership`, async () => {
  const controller = new AbortController();
  const signal = controller.signal;
  const limits = settings({});
  let opened = 0, closed = 0, pulls = 0, completed = 0;
  const factory = async () => {
    opened++;
    const chunks: Uint8Array[] = [];
    return {
      async append(bytes: Uint8Array) { assert.ok(bytes.length <= 65536); chunks.push(new Uint8Array(bytes)); },
      async finish(): Promise<ZipReadSource> {
        const bytes = await collectBytes((async function* () { yield* chunks; })(), {});
        return {size: bytes.length, async read(offset, length) { assert.ok(length <= 65536); return bytes.slice(offset, offset + length); }};
      },
      async close() { closed++; }
    };
  };
  const entry = await makeZipEntry("live", new Uint8Array(), { modified: new Date(2026, 0, 1), mode: 0o100644, directory: false, symlink: false }, limits, signal, 0);
  const failure = new Error("source stopped");
  const entries = {
    length: 2,
    async get(index: number) {
      return {...entry, name: `live-${index}`, source: (async function* () {
        const reused = new Uint8Array(511);
        for (let i = 0; i < 3; i++) {
          pulls++;
          if (outcome === "source-error" && i === 1) throw failure;
          reused.fill(i + index);
          yield reused;
        }
      })()};
    },
    async *[Symbol.asyncIterator]() { for (let index = 0; index < this.length; index++) yield await this.get(index); }
  };
  const source = streamZipArchive({entries, comment:new Uint8Array(), onEntry(_index, current) { assert.equal(current.size, 1533); assert.equal(current.compressedSize, 1533); completed++; }}, limits, signal, false, false, true, factory);
  const output = (async () => {
    for await (const chunk of source) {
      assert.ok(chunk.length > 0);
      if (outcome === "cancel") controller.abort(failure);
      await Promise.resolve();
    }
  })();
  if (outcome === "complete") { await output; assert.equal(pulls, 6); assert.equal(completed, 2); }
  else await assert.rejects(output, error => error === failure);
  assert.equal(closed, opened);
  assert.equal(opened, 2);
});

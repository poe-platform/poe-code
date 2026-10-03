import assert from "node:assert/strict";
import test from "node:test";
import { settings } from "safe-bash-io-engine/commands/archive/internal";
import { collectBytes } from "safe-bash-contracts";
import { makeZipEntry, writeZipArchive, decodeZipEntry, type ZipMetadataSpool } from "./zip-format.js";
import { repairZip, adjustZipRanges } from "./zip/repair.js";
import { readZipSfx } from "./zip/sfx.js";

function backing() {
  const active = new Set<ZipMetadataSpool>();
  return { active, async create(): Promise<ZipMetadataSpool> {
    let data = new Uint8Array();
    const spool: ZipMetadataSpool = {
      async append(bytes) { const next = new Uint8Array(data.length + bytes.length); next.set(data); next.set(bytes, data.length); data = next; },
      async finish() { return { size: data.length, async read(offset, length) { assert.ok(active.has(spool)); return data.slice(offset, offset + length); } }; },
      async close() { active.delete(spool); data = new Uint8Array(); },
    };
    active.add(spool); return spool;
  } };
}
const signal = new AbortController().signal, limits = settings({ limits: { chunkSize: 512 } });
async function fixture() {
  const entries = [];
  for (let index = 0; index < 70; index++) entries.push(await makeZipEntry(`file-${index}`, Uint8Array.of(index), { modified: new Date(2026, 0, 1), mode: 0o100644, directory: false, symlink: false }, limits, signal, 0));
  return writeZipArchive({ entries, comment: new Uint8Array() }, limits, signal);
}
for (const mode of ["F", "FF"] as const) test(`indexed ${mode} recovers metadata and original payload coordinates`, async () => {
  const original = await fixture();
  const central = new DataView(original.buffer, original.byteOffset, original.length).getUint32(original.length - 6, true);
  const bytes = original.slice(0, mode === "F" ? original.length - 22 : central);
  const storage = backing();
  const recovered = await repairZip({ size: bytes.length, read: async (offset, length) => bytes.slice(offset, offset + length) }, mode, limits, signal, undefined, storage.create);
  try {
    assert.equal(Array.isArray(recovered.archive.entries), false);
    assert.equal(recovered.archive.entries.length, 70);
    const entry = await recovered.archive.entries.get(69);
    assert.deepEqual(await collectBytes(decodeZipEntry(entry, limits, signal), { signal }), Uint8Array.of(69));
  } finally { await recovered.archive.close(); }
  assert.equal(storage.active.size, 0);
});

test("indexed SFX verification and adjustment retain bounded patch storage", async () => {
  const original = await fixture(), prefix = new TextEncoder().encode("inert SFX prefix");
  const bytes = new Uint8Array(prefix.length + original.length); bytes.set(prefix); bytes.set(original, prefix.length);
  const source = { size: bytes.length, read: async (offset: number, length: number) => bytes.slice(offset, offset + length) };
  const storage = backing();
  const archive = await readZipSfx(source, limits, signal, undefined, storage.create);
  try {
    assert.equal(Array.isArray(archive.entries), false);
    const adjusted = await adjustZipRanges(source, archive, limits, signal, undefined, storage.create);
    try {
      const check = await readZipSfx(adjusted, limits, signal, undefined, storage.create);
      try { assert.equal((await check.entries.get(69)).name, "file-69"); }
      finally { await check.close(); }
    } finally { await adjusted.close(); }
  } finally { await archive.close(); }
  assert.equal(storage.active.size, 0);
});

for (const operation of ["repair", "sfx"] as const) test(`indexed ${operation} preserves scratch acquisition failure`, async () => {
  const bytes = await fixture();
  const source = { size: bytes.length, read: async (offset: number, length: number) => bytes.slice(offset, offset + length) };
  const create = async (): Promise<ZipMetadataSpool> => { throw false; };
  await assert.rejects(operation === "repair" ? repairZip(source, "F", limits, signal, undefined, create) : readZipSfx(source, limits, signal, undefined, create), reason => reason === false);
});

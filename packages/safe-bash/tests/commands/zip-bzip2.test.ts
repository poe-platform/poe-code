import assert from "node:assert/strict";
import test from "node:test";
import { compressed, execute, fixture } from "./zip-standard-flags.helpers.js";
import { decodeZipEntry, readZipArchive, writeZipArchive } from "../../src/commands/archive/zip-format.js";
import { settings } from "../../src/commands/archive/internal.js";

// Independent Python zipfile.ZIP_BZIP2 archive with binary payload.
const oracle = Buffer.from("UEsDBC4AAAAMAJuCL129GAnfQgAAABMAAAAEAAAAZGF0YUJaaDkxQVkmU1le/zvlAAAD34DAEEAAEAAAIEAQEiJQEAAAoAAiEPSGmZQpgAC1zZmen2KRCyF8XckU4UJBe/zvlFBLAQIuAy4AAAAMAJuCL129GAnfQgAAABMAAAAEAAAAAAAAAAAAAACAAQAAAABkYXRhUEsFBgAAAAABAAEAMgAAAGQAAAAAAA==", "base64");
const payload = Buffer.concat([Buffer.from("ZIP bzip2 member"), Buffer.from([0, 255, 10])]);

for (const flags of [["-Zbzip2"], ["--compression-method=bzip2"], ["-Zb"], ["-Zbzip2", "-1"], ["-Zbzip2", "-9"], ["-Zbzip2", "-fz"], ["-Zbzip2", "-fd", "-T"]]) {
  test(`zip BZIP2 roundtrip and header version ${flags}`, async () => {
    const fs = await fixture();
    const result = await execute("zip", fs, ["-q", ...flags, "out.zip", "folder/data"]);
    assert.equal(result.exitCode, 0, result.stderr);
    const bytes = await fs.readFile("/work/out.zip");
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    assert.equal(view.getUint16(4, true), 46, "BZIP2 requires extraction version 4.6 even with ZIP64");
    const entry = (await readZipArchive(bytes, settings({}), new AbortController().signal)).entries[0]!;
    assert.equal(entry.method, 12);
    const extracted = await execute("unzip", fs, ["-p", "out.zip", "folder/data"]);
    assert.equal(extracted.exitCode, 0, extracted.stderr);
    assert.deepEqual(extracted.stdout, compressed);
  });
}

test("unzip accepts independent Python BZIP2 archive", async () => {
  const fs = await fixture(oracle);
  const result = await execute("unzip", fs, ["-p", "sample.zip", "data"]);
  assert.equal(result.exitCode, 0, result.stderr);
  assert.deepEqual(result.stdout, payload);
});

for (const trailing of [Uint8Array.of(0), Uint8Array.of(1, 2)]) {
  test(`BZIP2 entry refuses trailing compressed bytes ${trailing}`, async () => {
    const signal = new AbortController().signal;
    const entry = (await readZipArchive(oracle, settings({}), signal)).entries[0]!;
    entry.data = Uint8Array.of(...entry.data, ...trailing);
    await assert.rejects(async () => { for await (const chunk of decodeZipEntry(entry, settings({}), signal)) assert.ok(chunk); }, /trailing compressed data/u);
  });
}

test("BZIP2 archive copies compressed members without recompressing", async () => {
  const signal = new AbortController().signal;
  const archive = await readZipArchive(oracle, settings({}), signal);
  const copy = await readZipArchive(await writeZipArchive(archive, settings({}), signal), settings({}), signal);
  assert.deepEqual(copy.entries[0]!.data, archive.entries[0]!.data);
});

for (const version of [10, 20, 45, 47]) {
  test(`BZIP2 archive rejects unsupported extraction version ${version}`, async () => {
    const bytes = new Uint8Array(oracle);
    const view = new DataView(bytes.buffer);
    view.setUint16(4, version, true);
    view.setUint16(oracle.indexOf(Buffer.from([0x50, 0x4b, 1, 2])) + 6, version, true);
    await assert.rejects(readZipArchive(bytes, settings({}), new AbortController().signal), /extraction version/u);
  });
}

for (const flags of [2, 4, 6]) {
  test(`BZIP2 archive rejects DEFLATE-only flags ${flags}`, async () => {
    const bytes = new Uint8Array(oracle);
    const view = new DataView(bytes.buffer);
    view.setUint16(6, flags, true);
    view.setUint16(oracle.indexOf(Buffer.from([0x50, 0x4b, 1, 2])) + 8, flags, true);
    await assert.rejects(readZipArchive(bytes, settings({}), new AbortController().signal), /general purpose flags/u);
  });
}

for (const damage of ["truncate", "crc", "concatenate"] as const) {
  test(`BZIP2 compressed member rejects ${damage}`, async () => {
    const signal = new AbortController().signal;
    const entry = (await readZipArchive(oracle, settings({}), signal)).entries[0]!;
    if (damage === "truncate") entry.data = entry.data.subarray(0, entry.data.length - 1);
    else if (damage === "crc") { entry.data = new Uint8Array(entry.data); entry.data[10] = entry.data[10]! ^ 1; }
    else entry.data = Uint8Array.of(...entry.data, ...entry.data);
    await assert.rejects(async () => { for await (const chunk of decodeZipEntry(entry, settings({}), signal)) assert.ok(chunk); });
  });
}

for (const body of [new Uint8Array(), Uint8Array.of(1, 2, 3)]) {
  test(`BZIP2 retains STORE fallback for ${body.length}-byte file`, async () => {
    const fs = await fixture();
    await fs.writeFile("/work/small", body);
    const result = await execute("zip", fs, ["-qZbzip2", "out.zip", "small"]);
    assert.equal(result.exitCode, 0, result.stderr);
    const entry = (await readZipArchive(await fs.readFile("/work/out.zip"), settings({}), new AbortController().signal)).entries[0]!;
    assert.equal(entry.method, 0);
    assert.deepEqual(entry.data, body);
  });
}

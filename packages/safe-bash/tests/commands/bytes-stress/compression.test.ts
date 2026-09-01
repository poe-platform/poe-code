import assert from "node:assert/strict";
import test from "node:test";
import { gunzipSync, gzipSync } from "node:zlib";
import { FsError, readBytes } from "../../../src/contracts/index.js";
import { bytes, chunks, memory, run, wrap } from "./helpers.js";

function crc32(input: Uint8Array): number {
  let value = 0xffffffff;
  for (const byte of input) {
    value ^= byte;
    for (let bit = 0; bit < 8; bit++) value = (value >>> 1) ^ (value & 1 ? 0xedb88320 : 0);
  }
  return (value ^ 0xffffffff) >>> 0;
}

export function storedMember(data: Uint8Array, extra = false): Buffer {
  let header = Buffer.from([0x1f, 0x8b, 8, extra ? 30 : 0, 0, 0, 0, 0, 0, 255]);
  if (extra) {
    header = Buffer.concat([header, Buffer.from([3, 0, 9, 8, 7]), Buffer.from("../not-an-output-name\0a comment\0")]);
    const checksum = Buffer.alloc(2); checksum.writeUInt16LE(crc32(header) & 0xffff);
    header = Buffer.concat([header, checksum]);
  }
  const blocks: Buffer[] = [];
  for (let offset = 0; offset < data.length || offset === 0; offset += 65535) {
    const size = Math.min(65535, data.length - offset);
    const prefix = Buffer.alloc(5); prefix[0] = offset + size === data.length ? 1 : 0;
    prefix.writeUInt16LE(size, 1); prefix.writeUInt16LE((~size) & 0xffff, 3);
    blocks.push(prefix, Buffer.from(data.subarray(offset, offset + size)));
  }
  const footer = Buffer.alloc(8); footer.writeUInt32LE(crc32(data), 0); footer.writeUInt32LE(data.length >>> 0, 4);
  return Buffer.concat([header, ...blocks, footer]);
}

for (const length of [0, 1, 17, 65535, 65536, 131073]) test(`gzip stored-DEFLATE independent member length ${length}`, async () => {
  const input = bytes(length); const archive = storedMember(input, true);
  for (const width of [1, 7, 65537]) {
    const actual = await run("gunzip", ["-c"], chunks(archive, length > 4096 && width === 1 ? 127 : width));
    assert.equal(actual.exitCode, 0, actual.stderr.toString());
    assert.deepEqual(actual.stdout, input);
  }
});

test("concatenated empty, text and binary gzip members decode in order", async () => {
  const inputs = [Buffer.from("first\n"), Buffer.alloc(0), bytes(65537), Buffer.from("last\0bytes")];
  const members = inputs.map((input, index) => storedMember(input, index % 2 === 0));
  const archive = Buffer.concat(members);
  const protectedOffsets = new Set<number>();
  let memberStart = 0;
  for (const [index, member] of members.entries()) {
    const length = inputs[index]!.length;
    const blockCount = Math.max(1, Math.ceil(length / 65535));
    const headerEnd = memberStart + member.length - length - 5 * blockCount - 8;
    const ranges: [number, number][] = [[memberStart, headerEnd], [memberStart + member.length - 8, memberStart + member.length]];
    for (let block = 0; block < blockCount; block++) {
      const blockStart = headerEnd + block * (65535 + 5);
      ranges.push([blockStart, blockStart + 5]);
    }
    for (const [start, end] of ranges) {
      for (let offset = Math.floor(start / 3) * 3; offset < end; offset += 3) protectedOffsets.add(offset);
    }
    memberStart += member.length;
  }
  const assertProtectedFragments = (fragments: readonly Uint8Array[]): void => {
    assert.deepEqual(Buffer.concat(fragments), archive);
    const byOffset = new Map<number, Uint8Array>();
    let offset = 0;
    for (const fragment of fragments) { byOffset.set(offset, fragment); offset += fragment.length; }
    for (const protectedOffset of protectedOffsets) {
      const fragment = byOffset.get(protectedOffset);
      const expected = archive.subarray(protectedOffset, protectedOffset + 3);
      assert.equal(fragment?.length, expected.length, `three-byte header/trailer/member/block fragment at ${protectedOffset}`);
      assert.deepEqual(fragment, expected);
    }
  };
  async function* fragmented(source: Uint8Array) {
    const middleEnd = Math.floor((source.length - 192) / 3) * 3;
    yield* chunks(source.subarray(0, 192), 3);
    yield* chunks(source.subarray(192, middleEnd), 384);
    yield* chunks(source.subarray(middleEnd), 3);
  }
  const fragments: Uint8Array[] = [];
  for await (const fragment of fragmented(archive)) fragments.push(fragment);
  assertProtectedFragments(fragments);
  assert.throws(() => assertProtectedFragments([archive]), { code: "ERR_ASSERTION" });
  assert.equal(fragments.length, 300, "coalesce only interior payload, not protected boundary fragments");
  for (const name of ["gzip", "gunzip", "zcat"]) {
    const actual = await run(name, name === "gzip" ? ["-dc"] : ["-c"], fragmented(archive));
    assert.equal(actual.exitCode, 0);
    assert.deepEqual(actual.stdout, Buffer.concat(inputs));
  }
  const corrupted = Buffer.from(archive);
  const thirdTrailer = members[0]!.length + members[1]!.length + members[2]!.length - 8;
  corrupted[thirdTrailer] = corrupted[thirdTrailer]! ^ 1;
  for (const name of ["gzip", "gunzip", "zcat"]) {
    const rejected = await run(name, name === "gzip" ? ["-dc"] : ["-c"], fragmented(corrupted));
    assert.equal(rejected.exitCode, 1);
    assert.match(rejected.stderr.toString(), /incorrect data check \(CRC\)/u);
  }
  assert.deepEqual(archive, Buffer.concat(members));
});

test("truncation at every structural boundary is detected", async () => {
  const archive = storedMember(Buffer.from("payload"), true);
  for (const length of [0, 1, 2, 3, 9, 10, 11, 14, 20, archive.length - 9, archive.length - 8, archive.length - 4, archive.length - 1]) {
    const truncated = archive.subarray(0, length);
    const actual = await run("gzip", ["-t"], chunks(truncated, 1));
    assert.notEqual(actual.exitCode, 0, `virtual truncated length ${length}`);
    assert.equal(actual.stdout.length, 0); assert(actual.stderr.length > 0);
  }
});

test("CRC, ISIZE, method, reserved flags and header CRC are independently checked", async () => {
  const original = storedMember(Buffer.from("payload"), true);
  const variants = [
    ["CRC", original.length - 8, 1], ["ISIZE", original.length - 4, 1], ["method", 2, 1],
    ["reserved flags", 3, 32], ["header CRC", original.length - 8 - 7 - 5 - 1, 1],
  ] as const;
  for (const [name, offset, mask] of variants) {
    const corrupted = Buffer.from(original); corrupted[offset] = corrupted[offset]! ^ mask;
    const actual = await run("gunzip", ["-t"], chunks(corrupted, 2));
    assert.notEqual(actual.exitCode, 0, name); assert.equal(actual.stdout.length, 0);
  }
});

test("failed later member preserves original files and forced destination contents", async () => {
  const first = storedMember(Buffer.from("first")); const second = storedMember(Buffer.from("second"));
  second[second.length - 8] = second[second.length - 8]! ^ 1;
  const archive = Buffer.concat([first, second]);
  for (const args of [[], ["-f"], ["-fk"]]) {
    const data = { files: { "input.gz": archive, ...(args.includes("-f") || args.includes("-fk") ? { input: "PROTECTED" } : {}) } };
    const result = await run("gunzip", [...args, "input.gz"], "", data);
    assert.notEqual(result.exitCode, 0);
    assert.deepEqual(Buffer.from(await result.fs.readFile("/work/input.gz")), archive);
    if (data.files.input) assert.equal(Buffer.from(await result.fs.readFile("/work/input")).toString(), "PROTECTED");
    else await assert.rejects(result.fs.lstat("/work/input"), { code: "ENOENT" });
    assert.deepEqual((await result.fs.readdir("/work")).map(entry => entry.name).sort(), Object.keys(data.files).sort());
  }
});

test("filename header never chooses a virtual output path", async () => {
  const archive = storedMember(Buffer.from("safe body"), true);
  const actual = await run("gunzip", ["archive.gz"], "", { files: { "archive.gz": archive } });
  assert.equal(actual.exitCode, 0, actual.stderr.toString());
  assert.equal(Buffer.from(await actual.fs.readFile("/work/archive")).toString(), "safe body");
  assert.deepEqual((await actual.fs.readdir("/work")).map(entry => entry.name), ["archive"]);
  await assert.rejects(actual.fs.lstat("/not-an-output-name"), { code: "ENOENT" });
});

for (const level of [1, 6, 9]) test(`gzip level ${level} streaming output retains gzip headers and roundtrips`, async () => {
  const input = bytes(2 * 1024 * 1024 + 17);
  const actual = await run("gzip", [`-${level}cn`], chunks(input, 8191));
  assert.deepEqual(gunzipSync(actual.stdout), input);
  assert.equal(actual.exitCode, 0); assert.equal(actual.stdout[9], 255); assert.equal(actual.stdout.readUInt32LE(4), 0);
});

test("gzip stdout over several input files is a concatenated native-readable stream", async () => {
  const fixture = { files: { first: bytes(4097), empty: "", second: bytes(65537) } };
  const actual = await run("gzip", ["-cn", "first", "empty", "second"], "", fixture);
  assert.equal(actual.exitCode, 0); assert.deepEqual(gunzipSync(actual.stdout), Buffer.concat([fixture.files.first, fixture.files.second]));
  for (const [name, value] of Object.entries(fixture.files)) assert.deepEqual(Buffer.from(await actual.fs.readFile(`/work/${name}`)), Buffer.from(value));
});

test("publication follows keep/force suffix flags without appending old destination bytes", async () => {
  for (const args of [["-kn"], ["-fkn"], ["-fn"]]) {
    const fixture = { files: { input: "payload", ...(args[0]!.includes("f") ? { "input.gz": "old destination" } : {}) } };
    const actual = await run("gzip", [...args, "input"], "", fixture); assert.equal(actual.exitCode, 0, actual.stderr.toString());
  }
});

test("source append during streaming is detected before file publication", async () => {
  const fs = await memory({ files: { input: "original" } });
  const wrapped = wrap(fs, { readStream: (_path, options) => (async function* () {
    yield Buffer.from("original");
    await fs.appendFile("/work/input", Buffer.from("changed"), options);
  })() });
  const result = await run("gzip", ["input"], "", {}, { fs: wrapped });
  assert.notEqual(result.exitCode, 0); assert.match(result.stderr.toString(), /changed/u);
  assert.equal(Buffer.from(await fs.readFile("/work/input")).toString(), "originalchanged");
  await assert.rejects(fs.lstat("/work/input.gz"), { code: "ENOENT" });
  assert.deepEqual((await fs.readdir("/work")).map(entry => entry.name), ["input"]);
});

test("real 256 MiB staging output cap protects existing files without retaining expanded data", { timeout: 15000 }, async () => {
  const member = gzipSync(Buffer.alloc(1024 * 1024, 65));
  const archive = Buffer.concat(Array.from({ length: 257 }, () => member));
  const fs = await memory({ files: { "input.gz": archive, input: "PROTECTED" } });
  let consumed = 0;
  let writeFlag: string | undefined;
  const wrapped = wrap(fs, { async writeStream(_path, source, options) {
    writeFlag = options?.flag;
    for await (const chunk of readBytes(source, options?.signal)) consumed += chunk.length;
  } });
  const result = await run("gunzip", ["-f", "input.gz"], "", {}, { fs: wrapped });
  assert.equal(result.exitCode, 1); assert.match(result.stderr.toString(), /staged output exceeds 268435456 bytes/u);
  assert.equal(consumed, 256 * 1024 * 1024); assert.equal(writeFlag, "w");
  assert.equal(Buffer.from(await fs.readFile("/work/input")).toString(), "PROTECTED");
  assert.deepEqual(Buffer.from(await fs.readFile("/work/input.gz")), archive);
  assert.deepEqual((await fs.readdir("/work")).map(entry => entry.name).sort(), ["input", "input.gz"]);
});

test("publication failure keeps source and previous destination without staging remnants", async () => {
  const fs = await memory({ files: { input: "new body", "input.gz": "old body" } });
  const wrapped = wrap(fs, { async rename() { throw new FsError("EACCES", { message: "independent publication failure" }); } });
  const result = await run("gzip", ["-f", "input"], "", {}, { fs: wrapped });
  assert.equal(result.exitCode, 1); assert.match(result.stderr.toString(), /publication failure/u);
  assert.equal(Buffer.from(await fs.readFile("/work/input")).toString(), "new body");
  assert.equal(Buffer.from(await fs.readFile("/work/input.gz")).toString(), "old body");
  assert.deepEqual((await fs.readdir("/work")).map(entry => entry.name).sort(), ["input", "input.gz"]);
});

test("junk or an incomplete next gzip member fails both reference and virtual validation", async () => {
  const valid = storedMember(Buffer.from("payload"));
  for (const suffix of [Buffer.from("junk"), Buffer.from([0x1f, 0x8b])]) {
    const input = Buffer.concat([valid, suffix]);
    const actual = await run("gunzip", ["-t"], chunks(input, 7));
    assert.notEqual(actual.exitCode, 0, actual.stderr.toString());
    assert.equal(actual.stdout.length, 0);
  }
});

test("force stdout passes through non-gzip bytes without changing file inputs", async () => {
  for (const input of [Buffer.from([0x1f, 0, 255, 10]), bytes(65537)]) {
    const actual = await run("gunzip", ["-fc"], chunks(input, 1));
    assert.equal(actual.exitCode, 0, actual.stderr.toString());
    assert.deepEqual(actual.stdout, input);
  }
});

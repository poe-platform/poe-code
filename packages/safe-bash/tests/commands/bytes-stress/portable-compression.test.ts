import assert from "node:assert/strict";
import { test } from "node:test";
import { chunks, run } from "./helpers.js";

// Native bzip2/xz/zstd -c captures; unit tests use only in-memory byte fixtures.
const binary = Buffer.from([0, 255, 128, 10, 65, 0, 66, 195, 169]);
const formats = [
  { name: "bzip2", decode: "bunzip2", cat: "bzcat", suffix: ".bz2", magic: "425a68", binary: "425a683931415926535988128c4d000000c454c01030004000002008000000a000310c0821a327a9923606f8bb9229c2848440946268", empty: "425a683917724538509000000000" },
  { name: "xz", decode: "unxz", cat: "xzcat", suffix: ".xz", magic: "fd377a585a00", binary: "fd377a585a000004e6d6b44604c00d092101160000000000000000005f4f33e401000800ff800a410042c3a9000000001f87aae3dd5c9af10001290964921c1d1fb6f37d010000000004595a", empty: "fd377a585a000004e6d6b446000000001cdf44211fb6f37d010000000004595a" },
  { name: "zstd", decode: "unzstd", cat: "zstdcat", suffix: ".zst", magic: "28b52ffd", binary: "28b52ffd045849000000ff800a410042c3a9ee3aec1c", empty: "28b52ffd240001000099e9d851" },
] as const;

for (const name of ["bzip2", "bunzip2", "bzcat", "xz", "unxz", "xzcat", "zstd", "unzstd", "zstdcat"]) {
  test(`${name} is available in the byte command family`, async () => {
    const result = await run(name, ["--help"]);
    assert.equal(result.exitCode, 0);
  });
}

for (const format of formats) {
  test(`${format.name} crosses codec windows with incompressible bytes`, async () => {
    const data = Buffer.alloc(96 * 1024 + 17);
    let state = 0x12345678;
    for (let i = 0; i < data.length; i++) {
      state ^= state << 13;
      state ^= state >>> 17;
      state ^= state << 5;
      data[i] = state & 255;
    }
    const encoded = await run(format.name, ["-c"], chunks(data, 4093));
    assert.equal(encoded.exitCode, 0);
    assert.ok(encoded.stdout.length > 64 * 1024);
    const decoded = await run(format.cat, [], chunks(encoded.stdout, 4091));
    assert.equal(decoded.exitCode, 0);
    assert.deepEqual(decoded.stdout, data);
  });

  test(`${format.name} concatenates multiple file operands on stdout`, async () => {
    const encoded = await run(format.name, ["-c", "a", "b"], "", { files: { a: binary, b: Buffer.from("second") } });
    assert.equal(encoded.exitCode, 0);
    const decoded = await run(format.cat, [], encoded.stdout);
    assert.equal(decoded.exitCode, 0);
    assert.deepEqual(decoded.stdout, Buffer.concat([binary, Buffer.from("second")]));
  });

  test(`${format.decode} rejects a corrupt native checksum`, async () => {
    const corrupt = Buffer.from(format.binary, "hex");
    // bzip2 block CRC, XZ footer CRC, and Zstandard content checksum respectively.
    const offset = format.name === "bzip2" ? 10 : format.name === "xz" ? corrupt.length - 12 : corrupt.length - 1;
    corrupt[offset] = corrupt[offset]! ^ 1;
    const result = await run(format.decode, ["-c"], corrupt);
    assert.notEqual(result.exitCode, 0);
    assert.ok(result.stderr.length > 0);
  });

  for (const command of [format.name, format.decode, format.cat]) {
    test(`${command} decodes native binary members split at every byte`, async () => {
      const result = await run(command, command === format.name ? ["-dc"] : ["-c"], chunks(Buffer.from(format.binary, "hex"), 1));
      assert.equal(result.exitCode, 0);
      assert.equal(result.stderr.length, 0);
      assert.deepEqual(result.stdout, binary);
    });
  }

  test(`${format.cat} accepts empty and concatenated native members`, async () => {
    const empty = await run(format.cat, [], Buffer.from(format.empty, "hex"));
    assert.equal(empty.exitCode, 0);
    assert.equal(empty.stdout.length, 0);
    assert.equal(empty.stderr.length, 0);
    const members = Buffer.from(format.binary + format.empty + format.binary, "hex");
    const result = await run(format.cat, [], chunks(members, 3));
    assert.equal(result.exitCode, 0);
    assert.equal(result.stderr.length, 0);
    assert.deepEqual(result.stdout, Buffer.concat([binary, binary]));
  });

  for (const data of [Buffer.alloc(0), binary]) {
    test(`${format.name} emits a valid ${data.length}-byte round trip from chunked stdin`, async () => {
      const encoded = await run(format.name, ["-c"], chunks(data, 2));
      assert.equal(encoded.exitCode, 0);
      assert.equal(encoded.stderr.length, 0);
      assert.ok(encoded.stdout.toString("hex").startsWith(format.magic));
      const decoded = await run(format.decode, ["-c"], encoded.stdout);
      assert.equal(decoded.exitCode, 0);
      assert.deepEqual(decoded.stdout, data);
    });
  }

  test(`${format.name} -c and -k preserve the original file`, async () => {
    const stdout = await run(format.name, ["-c", "data"], "", { files: { data: binary } });
    assert.equal(stdout.exitCode, 0);
    assert.deepEqual(await stdout.fs.readFile("/work/data"), new Uint8Array(binary));
    await assert.rejects(stdout.fs.stat(`/work/data${format.suffix}`), { code: "ENOENT" });
    const kept = await run(format.name, ["-k", "data"], "", { files: { data: binary } });
    assert.equal(kept.exitCode, 0);
    assert.equal(kept.stdout.length, 0);
    assert.deepEqual(await kept.fs.readFile("/work/data"), new Uint8Array(binary));
    const decoded = await run(format.cat, [], await kept.fs.readFile(`/work/data${format.suffix}`));
    assert.equal(decoded.exitCode, 0);
    assert.deepEqual(decoded.stdout, binary);
  });

  test(`${format.name} default file compression uses its suffix and native retention policy`, async () => {
    const encoded = await run(format.name, ["data"], "", { files: { data: binary } });
    assert.equal(encoded.exitCode, 0);
    assert.equal(encoded.stdout.length, 0);
    if (format.name === "zstd") assert.deepEqual(await encoded.fs.readFile("/work/data"), new Uint8Array(binary));
    else await assert.rejects(encoded.fs.stat("/work/data"), { code: "ENOENT" });
    const compressed = await encoded.fs.readFile(`/work/data${format.suffix}`);
    const decoded = await run(format.name, ["-d", `data${format.suffix}`], "", { files: { [`data${format.suffix}`]: compressed } });
    assert.equal(decoded.exitCode, 0);
    assert.equal(decoded.stdout.length, 0);
    assert.deepEqual(await decoded.fs.readFile("/work/data"), new Uint8Array(binary));
    if (format.name === "zstd") assert.deepEqual(await decoded.fs.readFile(`/work/data${format.suffix}`), compressed);
    else await assert.rejects(decoded.fs.stat(`/work/data${format.suffix}`), { code: "ENOENT" });
  });

  test(`${format.decode} rejects truncated input without publishing or removing files`, async () => {
    const truncated = Buffer.from(format.binary, "hex").subarray(0, -4);
    const name = `data${format.suffix}`;
    const result = await run(format.decode, [name], "", { files: { [name]: truncated } });
    assert.notEqual(result.exitCode, 0);
    assert.ok(result.stderr.length > 0);
    assert.deepEqual(await result.fs.readFile(`/work/${name}`), new Uint8Array(truncated));
    await assert.rejects(result.fs.stat("/work/data"), { code: "ENOENT" });
  });
}

import { strict as assert } from "node:assert";
import { test } from "node:test";
import { gunzipSync, gzipSync } from "node:zlib";
import { toByteSource } from "../../../../src/contracts/index.js";
import { createMemoryFileSystem } from "../../../../src/fs/memory/index.js";
import { binary, chunks, emptyMember, helloMember, run } from "./helpers.js";

test("registers gzip, gunzip and zcat with binary round trips", async () => {
  const encoded = await run("gzip", [], chunks(binary));
  assert.equal(encoded.exitCode, 0, encoded.stderr);
  assert.deepEqual(gunzipSync(encoded.stdout), Buffer.from(binary));
  for (const command of ["gunzip", "zcat"]) {
    const result = await run(command, [], chunks(encoded.stdout));
    assert.equal(result.exitCode, 0, result.stderr);
    assert.deepEqual(result.stdout, Buffer.from(binary));
  }
});

for (const [name, bytes] of [["empty", new Uint8Array()], ["sliced", binary.subarray(17, 231)], ["huge", new Uint8Array(5 * 1024 * 1024).fill(241)]] as const) {
  test(`compresses ${name} input with empty chunk boundaries`, async () => {
    const result = await run("gzip", ["-c"], chunks(new Uint8Array(), bytes, new Uint8Array()));
    assert.equal(result.exitCode, 0, result.stderr);
    assert.deepEqual(gunzipSync(result.stdout), Buffer.from(bytes));
  });
}

test("static empty and hello fixtures decode without any reference executable", async () => {
  assert.equal((await run("gunzip", [], chunks(emptyMember))).stdout.length, 0);
  const result = await run("zcat", [], chunks(helloMember));
  assert.equal(result.exitCode, 0, result.stderr);
  assert.equal(result.stdout.toString(), "hello\n");
});

for (const [name, hex] of [
  ["empty filename", "1f8b080800000000000300"],
  ["empty comment", "1f8b081000000000000300"],
  ["both empty", "1f8b08180000000000030000"],
  ["filename with CRC", "1f8b080a0000000000036e616d6500435c"],
  ["comment with CRC", "1f8b08120000000000036e6f7465008d28"],
  ["both with CRC", "1f8b081a0000000000036e616d65006e6f746500c78b"],
  ["empty filename and comment with CRC", "1f8b081a000000000003006e6f746500f4f1"],
  ["filename and empty comment with CRC", "1f8b081a0000000000036e616d6500002196"],
  ["both empty with CRC", "1f8b081a00000000000300007b30"],
] as const) {
  test(`Group E gzip optional header: ${name}`, async () => {
    const bytes = Buffer.concat([Buffer.from(hex, "hex"), helloMember.subarray(10), helloMember]);
    for (const source of [chunks(bytes), chunks(...Array.from(bytes, byte => Uint8Array.of(byte)))]) {
      const result = await run("gunzip", [], source);
      assert.equal(result.exitCode, 0, result.stderr);
      assert.equal(result.stdout.toString(), "hello\nhello\n");
      assert.equal(result.stderr, "");
    }
    if (bytes[3]! & 2) {
      const corrupt = Buffer.from(bytes);
      corrupt[hex.length / 2 - 1]! ^= 1;
      const result = await run("gunzip", [], chunks(corrupt));
      assert.equal(result.exitCode, 1);
      assert.equal(result.stdout.length, 0);
      assert.match(result.stderr, /header crc mismatch/u);
    }
  });
}

for (const [name, hex] of [
  ["empty filename without terminator", "1f8b0808000000000003"],
  ["filename without terminator", "1f8b08080000000000036e616d65"],
  ["empty comment without terminator", "1f8b0810000000000003"],
  ["comment without terminator", "1f8b08100000000000036e6f7465"],
  ["second field without terminator", "1f8b081a0000000000036e616d65006e6f7465"],
] as const) {
  test(`Group E gzip rejects ${name}`, async () => {
    const bytes = Buffer.from(hex, "hex");
    for (const source of [chunks(bytes), chunks(...Array.from(bytes, byte => Uint8Array.of(byte)))]) {
      const result = await run("gunzip", [], source);
      assert.equal(result.exitCode, 1);
      assert.equal(result.stdout.length, 0);
      assert.match(result.stderr, /unexpected end of file/u);
    }
  });
}

test("decodes concatenated members at every single-byte boundary", async () => {
  const members = Buffer.concat([emptyMember, helloMember, gzipSync(binary)]);
  const result = await run("gunzip", [], chunks(...Array.from(members, (byte) => Uint8Array.of(byte))));
  assert.equal(result.exitCode, 0, result.stderr);
  assert.deepEqual(result.stdout, Buffer.concat([Buffer.from("hello\n"), binary]));
});

for (const [name, bytes] of [
  ["empty compressed input", Buffer.alloc(0)],
  ["one-byte header", helloMember.subarray(0, 1)],
  ["truncated header", helloMember.subarray(0, 9)],
  ["truncated payload", helloMember.subarray(0, 12)],
  ["truncated trailer", helloMember.subarray(0, -1)],
  ["bad CRC", Buffer.from(helloMember).fill(0, helloMember.length - 8, helloMember.length - 4)],
  ["bad length", Buffer.from(helloMember).fill(0, helloMember.length - 4)],
  ["truncated second member", Buffer.concat([helloMember, helloMember.subarray(0, 9)])],
  ["non-gzip bytes", Buffer.from("plain input")],
] as const) {
  test(`rejects ${name}`, async () => {
    const result = await run("gunzip", ["-t"], chunks(bytes));
    assert.equal(result.exitCode, 1);
    assert.equal(result.stdout.length, 0);
    assert.notEqual(result.stderr, "");
  });
}

for (const flag of ["-0", "-x", "--unknown", "--stdout=yes", "--suffix", "-N", "-r"]) {
  test(`rejects unsupported option ${flag} before mutation`, async () => {
    const fs = createMemoryFileSystem();
    await fs.writeFile("/input", binary);
    const result = await run("gzip", ["input", flag], undefined, { fs });
    assert.equal(result.exitCode, 2);
    assert.deepEqual((await fs.readdir("/")).map((entry) => entry.name), ["input"]);
  });
}

for (const flag of ["-1", "-2", "-3", "-4", "-5", "-6", "-7", "-8", "-9", "--fast", "--best"]) {
  test(`accepts compression level ${flag}`, async () => {
    const result = await run("gzip", [flag], chunks(binary));
    assert.equal(result.exitCode, 0, result.stderr);
    assert.deepEqual(gunzipSync(result.stdout), Buffer.from(binary));
  });
}

test("last level flag wins and headers have zero timestamp and no filename", async () => {
  const result = await run("gzip", ["-191", "-n"], chunks(binary));
  const reference = await run("gzip", ["--fast", "--no-name"], chunks(binary));
  assert.deepEqual(result.stdout, reference.stdout);
  assert.equal(result.stdout[3], 0);
  assert.deepEqual(result.stdout.subarray(4, 8), Buffer.alloc(4));
  assert.equal(result.stdout[9], 255);
});

test("file defaults replace input only after success; keep preserves originals", async () => {
  const fs = createMemoryFileSystem();
  await fs.writeFile("/input", binary);
  assert.equal((await run("gzip", ["input"], undefined, { fs })).exitCode, 0);
  await assert.rejects(fs.stat("/input"), { code: "ENOENT" });
  assert.equal((await run("gunzip", ["--keep", "input.gz"], undefined, { fs })).exitCode, 0);
  assert.deepEqual(await fs.readFile("/input"), binary);
  assert.equal((await fs.readdir("/")).length, 2);
});

test("multiple file stdout produces separate members and preserves inputs", async () => {
  const fs = createMemoryFileSystem();
  await fs.writeFile("/first", binary);
  await fs.writeFile("/second", Buffer.from("last"));
  const result = await run("gzip", ["--to-stdout", "first", "-", "second"], toByteSource("middle"), { fs });
  assert.equal(result.exitCode, 0, result.stderr);
  assert.deepEqual(gunzipSync(result.stdout), Buffer.concat([binary, Buffer.from("middlelast")]));
  assert.equal((await fs.readdir("/")).length, 2);
});

for (const [source, destination] of [["file.gz", "file"], ["file.z", "file"], ["file-gz", "file"], ["file_z", "file"], ["file.GZ", "file"], ["archive.tgz", "archive.tar"], ["archive.taz", "archive.tar"]]) {
  test(`suffix ${source} becomes ${destination}`, async () => {
    const fs = createMemoryFileSystem();
    await fs.writeFile(`/${source}`, helloMember);
    const result = await run("gunzip", [source!], undefined, { fs });
    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal(Buffer.from(await fs.readFile(`/${destination}`)).toString(), "hello\n");
  });
}

test("unknown suffix errors for file output but works with stdout/test", async () => {
  const fs = createMemoryFileSystem();
  await fs.writeFile("/input", helloMember);
  assert.equal((await run("gunzip", ["input"], undefined, { fs })).exitCode, 1);
  assert.equal((await run("gzip", ["--decompress", "--stdout", "input"], undefined, { fs })).stdout.toString(), "hello\n");
  assert.equal((await run("gzip", ["--test", "input"], undefined, { fs })).exitCode, 0);
});

test("option terminator permits dash-leading files", async () => {
  const fs = createMemoryFileSystem();
  await fs.writeFile("/-input", binary);
  assert.equal((await run("gzip", ["-k", "--", "-input"], undefined, { fs })).exitCode, 0);
  assert.deepEqual(gunzipSync(await fs.readFile("/-input.gz")), Buffer.from(binary));
});

test("force stdout passes non-gzip data through and forced test follows GNU", async () => {
  assert.equal((await run("zcat", ["-f"], toByteSource("plain"))).stdout.toString(), "plain");
  const result = await run("gunzip", ["-ft"], toByteSource("plain"));
  assert.equal(result.exitCode, 0);
  assert.equal(result.stdout.length, 0);
});

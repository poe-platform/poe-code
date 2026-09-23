import { strict as assert } from "node:assert";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { gunzipSync, gzipSync } from "node:zlib";
import { build } from "esbuild";
import { CommandRegistry, toByteSource } from "../../../../src/contracts/index.js";
import { Shell } from "../../../../src/shell/shell.js";
import { createCompressionCommands } from "../../../../src/commands/bytes/compression/index.js";
import { createMemoryFileSystem } from "../../../../src/fs/memory/index.js";
import { codec } from "../../../../src/commands/bytes/compression/codec.js";
import { compressed } from "../../../../src/commands/archive/stream.js";
import { DEFAULT_ARCHIVE_LIMITS } from "../../../../src/commands/archive/internal.js";
import { binary, chunks, emptyMember, helloMember, run } from "./helpers.js";

test("gzip custom suffix replaces input and decodes through Shell", async () => {
  for (const option of ["--suffix=.gz2", "--suffix .gz2", "-S .gz2", "-S.gz2", "-kS.gz2"]) {
    const fs = createMemoryFileSystem();
    await fs.writeFile("/input", Buffer.from("abc\n"));
    const shell = new Shell({ fs, cwd: "/", commands: new CommandRegistry(createCompressionCommands()) });
    try {
      const result = await shell.exec(`gzip ${option} input; gzip -dc input.gz2`);
      assert.equal(result.exitCode, 0, result.stderr);
      assert.equal(result.stdout, "abc\n");
      assert.equal(result.stderr, "");
      assert.deepEqual(gunzipSync(await fs.readFile("/input.gz2")), Buffer.from("abc\n"));
      if (option.startsWith("-k")) await fs.rm("/input");
      else await assert.rejects(fs.stat("/input"), { code: "ENOENT" });
      const decoded = await shell.exec("gunzip --suffix=.gz2 input.gz2");
      assert.equal(decoded.exitCode, 0, decoded.stderr);
      assert.deepEqual(Buffer.from(await fs.readFile("/input")), Buffer.from("abc\n"));
      await assert.rejects(fs.stat("/input.gz2"), { code: "ENOENT" });
    } finally { await shell.dispose(); }
  }
});

test("gzip quiet and recursive aliases round trip through Shell pipelines", async () => {
  const fs = createMemoryFileSystem();
  const input = new TextEncoder().encode("abc\n");
  await fs.writeFile("/input", input);
  const shell = new Shell({ fs, cwd: "/", commands: new CommandRegistry(createCompressionCommands()) });
  try {
    for (const flag of ["--quiet", "-q", "--recursive", "-r"]) {
      const result = await shell.exec(`gzip ${flag} -c input | gzip -dc`);
      assert.equal(result.exitCode, 0, result.stderr);
      assert.deepEqual(result.stdoutBytes, input);
      assert.equal(result.stderr, "");
      assert.deepEqual(await fs.readFile("/input"), input);
    }
  } finally { await shell.dispose(); }
});

test("gzip quiet suppresses warnings but preserves errors even when repeated", async () => {
  for (const command of ["gzip", "gunzip", "zcat"]) {
    for (const flag of ["-q", "--quiet", "-qq"]) {
      const warning = await run(command, [flag, "-dc"], chunks(Buffer.concat([helloMember, Buffer.from("garbage")])));
      assert.equal(warning.exitCode, 2);
      assert.equal(warning.stderr, "");
      assert.deepEqual(warning.stdout, gunzipSync(helloMember));
      const error = await run(command, [flag, "-dc"], chunks(Buffer.from("plain")));
      assert.equal(error.exitCode, 1);
      assert.notEqual(error.stderr, "");
      const missing = await run(command, [flag, "-dc", "missing"]);
      assert.equal(missing.exitCode, 1);
      assert.notEqual(missing.stderr, "");
    }
  }
});

test("gzip recursion compresses and decompresses nested files without following symlinks", async () => {
  for (const flag of ["-r", "--recursive"]) {
    const fs = createMemoryFileSystem();
    await fs.mkdir("/tree/nested", { recursive: true });
    await fs.writeFile("/tree/first", Buffer.from("first\n"));
    await fs.writeFile("/tree/nested/second", Buffer.from("second\n"));
    await fs.writeFile("/outside", Buffer.from("outside\n"));
    await fs.symlink("/outside", "/tree/link");
    await fs.symlink("/tree", "/tree/nested/cycle");
    const shell = new Shell({ fs, cwd: "/", commands: new CommandRegistry(createCompressionCommands()) });
    try {
      const compressed = await shell.exec(`gzip ${flag} tree`);
      assert.equal(compressed.exitCode, 0, compressed.stderr);
      for (const [path, text] of [["/tree/first", "first\n"], ["/tree/nested/second", "second\n"]] as const) {
        assert.deepEqual(gunzipSync(await fs.readFile(path + ".gz")), Buffer.from(text));
        await assert.rejects(fs.lstat(path), { code: "ENOENT" });
      }
      const decompressed = await shell.exec(`gunzip ${flag} tree`);
      assert.equal(decompressed.exitCode, 0, decompressed.stderr);
      assert.deepEqual(Buffer.from(await fs.readFile("/tree/first")), Buffer.from("first\n"));
      assert.deepEqual(Buffer.from(await fs.readFile("/tree/nested/second")), Buffer.from("second\n"));
      assert.deepEqual(Buffer.from(await fs.readFile("/outside")), Buffer.from("outside\n"));
      assert.equal((await fs.lstat("/tree/link")).type, "symlink");
      assert.equal((await fs.lstat("/tree/nested/cycle")).type, "symlink");
    } finally { await shell.dispose(); }
  }
});

test("zstd quiet options preserve exact bytes through a Shell pipeline", async () => {
  const fs = createMemoryFileSystem();
  const input = new TextEncoder().encode("abc\n");
  await fs.writeFile("/input", input);
  const shell = new Shell({ fs, cwd: "/", commands: new CommandRegistry(createCompressionCommands()) });
  try {
    for (const options of ["-q -c", "--quiet -c", "-qc", "-qqc"]) {
      const result = await shell.exec(`zstd ${options} input | zstd -dc`);
      assert.equal(result.exitCode, 0, result.stderr);
      assert.deepEqual(result.stdoutBytes, input);
      assert.equal(result.stderr, "");
      assert.deepEqual(await fs.readFile("/input"), input);
      assert.deepEqual((await fs.readdir("/")).map(entry => entry.name), ["input"]);
    }
  } finally { await shell.dispose(); }
});

test("zstd aliases accept quiet options and repeated quiet suppresses processing errors", async () => {
  const encoded = await run("zstd", ["-c"], chunks(binary));
  for (const command of ["zstd", "unzstd", "zstdcat"]) {
    for (const quiet of [["-q"], ["--quiet"], ["-qq"], ["--quiet", "--quiet"]]) {
      const decoded = await run(command, [...quiet, "-dc"], chunks(encoded.stdout));
      assert.equal(decoded.exitCode, 0, decoded.stderr);
      assert.deepEqual(decoded.stdout, Buffer.from(binary));
      assert.equal(decoded.stderr, "");
      const invalid = await run(command, [...quiet, "-dc"], chunks(Buffer.from("plain")));
      assert.equal(invalid.exitCode, 1);
      assert.equal(invalid.stdout.length, 0);
      assert.equal(invalid.stderr.length === 0, quiet[0] === "-qq" || quiet.length === 2);
    }
    const missing = await run(command, ["-qq", "-dc", "missing"]);
    assert.equal(missing.exitCode, 1);
    assert.equal(missing.stderr, "");
  }
});

test("compression and archive browser graphs need no Node codecs or streams", async () => {
  const platform = fileURLToPath(new URL("../../../../browser/platform.mjs", import.meta.url));
  const result = await build({
    entryPoints: ["bytes/compression/stream.ts", "archive/stream.ts"].map(path => fileURLToPath(new URL(`../../../../src/commands/${path}`, import.meta.url))),
    outdir: "/virtual-codec-graph", bundle: true, platform: "browser", format: "esm", target: "es2022",
    conditions: ["workerd", "worker", "browser"], write: false, metafile: true, logLevel: "silent",
    external: ["poe-code/safe-fs/core"], inject: [platform],
    alias: { "@poe-code/safe-fs": "poe-code/safe-fs", "node:stream/web": platform, "node:path": platform },
  });
  const imports = Object.values(result.metafile!.outputs).flatMap(output => output.imports);
  assert.deepEqual([...new Set(imports.filter(entry => entry.external).map(entry => entry.path))], ["poe-code/safe-fs/core"]);
});

test("raw codec restores exact footer and next-member remainder across bounded slabs", async () => {
  for (const payload of [Buffer.alloc(0), Buffer.from("hello\n"), Buffer.alloc(32768, 97), Buffer.from(binary)]) {
    const member = gzipSync(payload);
    const raw = member.subarray(10, -8);
    const suffix = Buffer.concat([member.subarray(-8), helloMember, Buffer.from("sentinel")]);
    const input = Buffer.concat([raw, suffix]);
    for (const inputSize of [1, 7, 65536]) {
      for (const chunkSize of [1, 17, 65536]) {
        let offset = 0;
        let restored: Uint8Array = new Uint8Array();
        let produced = 0;
        for await (const bytes of codec({
          async chunk() {
            if (offset === input.length) return undefined;
            const next = input.subarray(offset, offset + inputSize);
            offset += next.length;
            return next;
          },
          restore(bytes) { restored = bytes; },
        }, { mode: "inflate-raw", chunkSize }, new AbortController().signal)) {
          assert.ok(bytes.length <= chunkSize);
          assert.deepEqual(Buffer.from(bytes), payload.subarray(produced, produced + bytes.length));
          produced += bytes.length;
        }
        assert.equal(produced, payload.length);
        assert.equal(offset - restored.length, raw.length);
        assert.deepEqual(Buffer.concat([restored, input.subarray(offset)]), suffix);
      }
    }
  }
});

test("gzip levels preserve native headers and deflate options", async () => {
  for (let level = 1; level <= 9; level++) {
    const result = await run("gzip", [`-${level}`], chunks(binary));
    const expected = gzipSync(binary, { level });
    expected[9] = 255;
    assert.equal(result.exitCode, 0, result.stderr);
    assert.deepEqual(result.stdout, expected);
  }
});

test("codec rejects invalid slab sizes before acquiring input", async () => {
  for (const chunkSize of [0, -1, 1.5, NaN, Infinity]) {
    await assert.rejects(async () => {
      for await (const bytes of codec({
        async chunk() { assert.fail("invalid codec options must not acquire input"); },
        restore() { assert.fail("invalid codec options must not restore input"); },
      }, { mode: "gzip", chunkSize }, new AbortController().signal)) assert.fail(`unexpected output: ${bytes.length}`);
    }, { name: "RangeError" });
  }
});

test("archive gzip retains native concatenation and trailing policy separately from CLI warnings", async () => {
  for (const suffix of [Buffer.alloc(0), helloMember, Buffer.from([0]), Buffer.from([0, 0, 71]), Buffer.from([71]), Buffer.from([71, 72]), helloMember.subarray(0, 4)]) {
    const input = Buffer.concat([helloMember, suffix]);
    let expected: Buffer | undefined;
    let expectedError: unknown;
    try { expected = gunzipSync(input); } catch (error) { expectedError = error; }
    for (const source of [chunks(input), chunks(...Array.from(input, byte => Uint8Array.of(byte)))]) {
      const output: Uint8Array[] = [];
      const collect = async () => {
        for await (const bytes of compressed(source, true, new AbortController().signal, DEFAULT_ARCHIVE_LIMITS)) output.push(bytes);
      };
      if (expectedError instanceof Error) await assert.rejects(collect, { message: expectedError.message });
      else { await collect(); assert.deepEqual(Buffer.concat(output), expected); }
    }
  }
});

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

for (const flag of ["-0", "-x", "--unknown", "--stdout=yes", "--suffix", "-S", "--suffix=", "-N"]) {
  test(`rejects invalid option ${flag} before mutation`, async () => {
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

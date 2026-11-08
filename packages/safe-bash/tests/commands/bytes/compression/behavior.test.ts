import { strict as assert } from "node:assert";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { gunzipSync, gzipSync } from "node:zlib";
import { build } from "esbuild";
import { CommandRegistry } from "../../../../src/contracts/index.js";
import { Shell } from "../../../../src/shell/shell.js";
import { createCompressionCommands } from "../../../../src/commands/bytes/compression/index.js";
import { createMemoryFileSystem } from "../../../../src/fs/memory/index.js";
import { codec } from "../../../../src/commands/bytes/compression/codec.js";
import { compressed } from "../../../../src/commands/archive/stream.js";
import { DEFAULT_ARCHIVE_LIMITS } from "../../../../src/commands/archive/internal.js";
import { binary, chunks, helloMember, run } from "./helpers.js";

test("zstd writes and verifies native-default content checksums through Shell", async () => {
  const fs = createMemoryFileSystem();
  const shell = new Shell({ fs, cwd: "/", commands: new CommandRegistry(createCompressionCommands()) });
  try {
    for (const input of [Buffer.from("x"), Buffer.concat([binary, binary, binary])]) {
      await fs.writeFile("/input", input);
      for (const level of ["", "-1"]) {
        const encoded = await shell.exec(`zstd ${level} -c input > output`);
        assert.equal(encoded.exitCode, 0, encoded.stderr);
        const frame = Buffer.from(await fs.readFile("/output"));
        assert.equal(frame.readUInt32LE(0), 0xfd2fb528);
        assert.equal(frame[4]! & 4, 4, "frame must contain a content checksum");
        if (input.length === 1) {
          // Native zstd 1.5.7's low 32 bits of XXH64 for the byte 'x'.
          assert.equal(frame.subarray(-4).toString("hex"), "23110483");
        }
        const decoded = await shell.exec("zstd -dc output");
        assert.equal(decoded.exitCode, 0, decoded.stderr);
        assert.deepEqual(Buffer.from(decoded.stdoutBytes), input);
        frame[frame.length - 1] = frame[frame.length - 1]! ^ 1;
        await fs.writeFile("/output", frame);
        assert.notEqual((await shell.exec("zstd -dc output")).exitCode, 0);
      }
    }
  } finally { await shell.dispose(); }
});

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
      const invalid = await run(command, [...quiet, "-dc"], chunks(Buffer.from("28b52ffd", "hex")));
      assert.equal(invalid.exitCode, 1);
      assert.equal(invalid.stdout.length, 0);
      assert.equal(invalid.stderr.length === 0, quiet[0] === "-qq" || quiet.length === 2);
    }
    const missing = await run(command, ["-qq", "-dc", "missing"]);
    assert.equal(missing.exitCode, 1);
    assert.equal(missing.stderr, "");
  }
});

test("zstdcat implicitly passes plaintext through Shell while other aliases reject it", async () => {
  const fs = createMemoryFileSystem();
  const input = new TextEncoder().encode("x\n");
  await fs.writeFile("/input", input);
  const shell = new Shell({ fs, cwd: "/", commands: new CommandRegistry(createCompressionCommands()) });
  try {
    for (const command of ["zstdcat input", "zstdcat -dc input", "zstdcat < input"]) {
      const result = await shell.exec(command);
      assert.equal(result.exitCode, 0, result.stderr);
      assert.deepEqual(result.stdoutBytes, input);
      assert.equal(result.stderr, "");
    }
    for (const command of ["zstd", "unzstd"]) {
      const result = await shell.exec(`${command} -dc input`);
      assert.equal(result.exitCode, 1);
      assert.equal(result.stdout, "");
    }
    assert.deepEqual(await fs.readFile("/input"), input);
  } finally { await shell.dispose(); }
});

test("zstdcat passthrough preserves split binary bytes and rejects recognized damaged frames", async () => {
  for (const input of [Buffer.from("x\n"), Buffer.from(binary), Buffer.from("28b5", "hex")]) {
    const result = await run("zstdcat", [], chunks(...Array.from(input, byte => Uint8Array.of(byte))));
    assert.equal(result.exitCode, 0, result.stderr);
    assert.deepEqual(result.stdout, input);
  }
  for (const input of [Buffer.alloc(0), Buffer.from("28b52ffd", "hex"), Buffer.from("502a4d18", "hex"), helloMember.subarray(0, 4), Buffer.from("fd377a58", "hex"), Buffer.from("5d000080", "hex"), Buffer.from("04224d18", "hex")]) {
    const result = await run("zstdcat", [], chunks(...Array.from(input, byte => Uint8Array.of(byte))));
    assert.equal(result.exitCode, 1);
    assert.equal(result.stdout.length, 0);
  }
});

test("compression and archive browser graphs need no Node codecs or streams", async () => {
  const platform = fileURLToPath(new URL("../../../../browser/platform.mjs", import.meta.url));
  const result = await build({
    entryPoints: ["bytes/compression/stream.ts", "archive/stream.ts"].map(path => fileURLToPath(new URL(`../../../../src/commands/${path}`, import.meta.url))),
    outdir: "/virtual-codec-graph", bundle: true, platform: "browser", format: "esm", target: "es2022",
    conditions: ["workerd", "worker", "browser"], write: false, metafile: true, logLevel: "silent",
    external: ["poe-code/safe-fs/core"], inject: [platform],
    alias: { "@poe-code/safe-fs": "poe-code/safe-fs", "@poe-code/safe-fs/runtime-core": "poe-code/safe-fs/core", "node:stream/web": platform, "node:path": platform },
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

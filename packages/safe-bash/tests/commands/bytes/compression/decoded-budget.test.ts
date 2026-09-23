import assert from "node:assert/strict";
import { test } from "node:test";
import { gzipSync } from "node:zlib";
import { Shell } from "../../../../src/shell/shell.js";
import { createMemoryFileSystem } from "../../../../src/fs/memory/index.js";
import { createCompressionCommands } from "../../../../src/commands/bytes/compression/index.js";
import { byteCommands } from "../../../../src/commands/bytes/index.js";
import { profiles } from "../../../../src/commands/bytes/compression/options.js";
import { DecodedBudget, stagingLimit } from "../../../../src/commands/bytes/compression/stream.js";

test("omitted compression budgets impose no decoded or staged output quota", () => {
  const budget = new DecodedBudget();
  budget.admit(256 * 1024 * 1024);
  budget.admit(1);
  assert.equal(budget.exceeded, false);
  assert.equal(stagingLimit, Infinity);
  assert.doesNotThrow(() => createCompressionCommands());
});

test("every decompressor validation alias shares the host decoded-byte ceiling", async () => {
  for (const profile of profiles) {
    const fs = createMemoryFileSystem();
    await fs.writeFile("/input", new Uint8Array(128 * 1024));
    const producer = new Shell({ fs }).use(byteCommands());
    const compressed = await producer.exec(`${profile.names[0]} -c /input`);
    assert.equal(compressed.exitCode, 0, compressed.stderr);
    await producer.dispose();
    const shell = new Shell({ fs, limits: { maxOutputBytes: 64 } }).use(byteCommands({ compression: { maxDecodedBytes: 1024 } }));
    try {
      for (const name of profile.names) {
        const result = await shell.exec(`${name} -t`, { stdin: compressed.stdoutBytes });
        assert.equal(result.exitCode, 1, name);
        assert.ok(result.stderr.includes("decoded byte limit exceeded"), result.stderr);
        assert.equal(result.stdoutBytes.length, 0);
      }
    } finally { await shell.dispose(); }
  }
});

test("decoded budget covers stdout, passthrough, file staging and cumulative operands", async () => {
  const fs = createMemoryFileSystem();
  const input = gzipSync(new Uint8Array(800));
  await fs.writeFile("/a.gz", input);
  await fs.writeFile("/b.gz", input);
  const shell = new Shell({ fs, cwd: "/" }).use(byteCommands({ compression: { maxDecodedBytes: 1024 } }));
  try {
    assert.equal((await shell.exec("gunzip -t a.gz")).exitCode, 0);
    const cumulative = await shell.exec("gunzip -t a.gz b.gz");
    assert.equal(cumulative.exitCode, 1);
    assert.ok(cumulative.stderr.includes("decoded byte limit exceeded"));
    for (const command of ["gunzip -c", "gunzip -tf", "zcat", "gzip -dc"]) {
      const result = await shell.exec(command, { stdin: gzipSync(new Uint8Array(2048)) });
      assert.equal(result.exitCode, 1, command);
      assert.equal(result.stdoutBytes.length, 0);
    }
    const passthrough = await shell.exec("gunzip -cf", { stdin: new Uint8Array(2048).fill(65) });
    assert.equal(passthrough.exitCode, 1);
    assert.ok(passthrough.stdoutBytes.length <= 1024);
    await fs.writeFile("/large.gz", gzipSync(new Uint8Array(2048)));
    assert.equal((await shell.exec("gunzip large.gz")).exitCode, 1);
    await assert.rejects(fs.stat("/large"), { code: "ENOENT" });
    assert.deepEqual(Buffer.from(await fs.readFile("/large.gz")), gzipSync(new Uint8Array(2048)));
    assert.equal((await shell.exec("gunzip -t a.gz")).exitCode, 0);
  } finally { await shell.dispose(); }
});


test("decoded host budgets reject unbounded values and accept exact/zero boundaries", async () => {
  for (const maxDecodedBytes of [Infinity, NaN, -1, 1.5]) {
    assert.throws(() => createCompressionCommands({ maxDecodedBytes }), RangeError);
  }
  for (const maxDecodedBytes of [0, 1024]) {
    const shell = new Shell({ fs: createMemoryFileSystem() }).use(byteCommands({ compression: { maxDecodedBytes } }));
    try {
      assert.equal((await shell.exec("gunzip -t", { stdin: gzipSync(new Uint8Array(maxDecodedBytes)) })).exitCode, 0);
      assert.equal((await shell.exec("gunzip -t", { stdin: gzipSync(new Uint8Array(maxDecodedBytes + 1)) })).exitCode, 1);
    } finally { await shell.dispose(); }
  }
});

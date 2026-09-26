import assert from "node:assert/strict";
import test from "node:test";
import { MemoryFileSystem } from "../../src/fs/memory/index.js";
import { Shell } from "../../src/shell/index.js";
import { textProgramCommands } from "../../src/commands/text-programs/index.js";
import { searchCommands } from "../../src/commands/search/index.js";
import { Capture } from "../../src/shell/runtime.js";
import { jqCommand } from "../../src/commands/structured/jq.js";
import { tryReadMemoryFileViewSync } from "@poe-code/safe-fs/core";

for (const scenario of ["late multiple matches", "checkpoint", "late long line"]) {
  test(`sed emits each line once after ${scenario}`, async () => {
    const fs = new MemoryFileSystem();
    const shell = new Shell({ fs }).use(textProgramCommands());
    try {
      const input = Array.from({ length: scenario === "checkpoint" ? 10000 : 1000 }, (_, i) =>
        `foo line-${i} baz ${i === 960 && scenario === "late multiple matches" ? "baz " : ""}${"x".repeat(i === 960 && scenario === "late long line" ? 5000 : 60)}\n`).join("");
      await fs.writeFile("/data", new TextEncoder().encode(input));
      const expected = input.replaceAll("foo", "BAR").replaceAll("baz", "qux");
      // Warm the parsed program and memory line cache, then exercise the synchronous path.
      for (let i = 0; i < 2; i++) {
        const result = await shell.exec('sed "s/^foo/BAR/; s/baz/qux/g" /data', { limits: { maxFileSystemOperations: 1 } });
        assert.equal(result.exitCode, 0);
        assert.equal(result.stderr, "");
        assert.ok(result.stdout === expected, `expected ${expected.length} bytes, received ${result.stdout.length}`);
      }
    } finally { await shell.dispose(); }
  });
}

for (const mode of ["--files", "-c", "-l", "--files-without-match"]) {
  test(`rg ${mode} emits each filename once beyond its output buffer`, async () => {
    const fs = new MemoryFileSystem();
    const shell = new Shell({ fs }).use(searchCommands());
    try {
      await fs.mkdir("/dir");
      const names = Array.from({ length: 1100 }, (_, i) => `/dir/file_${String(i).padStart(4, "0")}_${"a".repeat(50)}.txt`);
      for (const name of names) await fs.writeFile(name, new TextEncoder().encode("needle\n"));
      const command = mode === "--files" ? "rg --files /dir" : `rg ${mode} ${mode === "--files-without-match" ? "missing" : "needle"} /dir`;
      const result = await shell.exec(command);
      assert.equal(result.exitCode, 0);
      assert.equal(result.stderr, "");
      const actual = result.stdout.trimEnd().split("\n").sort().join("\n");
      const expected = names.map(name => mode === "-c" ? `${name}:1` : name).sort().join("\n");
      assert.ok(actual === expected, `expected ${expected.length} bytes, received ${actual.length}`);
    } finally { await shell.dispose(); }
  });
}

test("jq emits no output when its file operation exceeds the shell budget", async t => {
  const fs = new MemoryFileSystem();
  await fs.writeFile("/data", new TextEncoder().encode('{"a":1}\n'));
  const warm = new Shell({ fs });
  warm.commands.register(jqCommand());
  await warm.exec("jq -c . /data");
  await warm.dispose();
  const shell = new Shell({ fs, limits: { maxFileSystemOperations: 0 } });
  shell.commands.register(jqCommand());
  let outputBytes = 0;
  const writeRange = Capture.prototype.writeRangeSync;
  t.mock.method(Capture.prototype, "writeRangeSync", function (this: Capture, bytes: Uint8Array, len: number) {
    outputBytes += len;
    return writeRange.call(this, bytes, len);
  });
  try {
    await assert.rejects(shell.exec("jq -c . /data"), { name: "ShellLimitError", limit: "maxFileSystemOperations" });
    assert.equal(outputBytes, 0);
  } finally { await shell.dispose(); }
});

test("rg completes an asynchronous final flush without replaying output", async t => {
  const fs = new MemoryFileSystem();
  await fs.mkdir("/dir");
  await fs.writeFile("/dir/one", new TextEncoder().encode("needle\n"));
  const shell = new Shell({ fs }).use(searchCommands());
  const other = new Shell({ fs }).use(searchCommands());
  let admit!: () => void;
  let release!: () => void;
  const admitted = new Promise<void>(resolve => { admit = resolve; });
  const released = new Promise<void>(resolve => { release = resolve; });
  const write = Capture.prototype.write;
  let writes = 0;
  // Decline the synchronous write so the completed fast attempt must await
  // the sink, rather than start the command again.
  t.mock.method(Capture.prototype, "writeRangeSync", () => false);
  t.mock.method(Capture.prototype, "write", async function (this: Capture, bytes: Uint8Array) {
    if (++writes === 1) {
      admit();
      await released;
    }
    await write.call(this, bytes);
  });
  const execution = shell.exec("rg --files /dir");
  try {
    await admitted;
    const overlapping = await other.exec("rg -c needle /dir");
    assert.equal(overlapping.exitCode, 0, overlapping.stderr);
    assert.equal(overlapping.stdout, "/dir/one:1\n");
    release();
    const result = await execution;
    assert.equal(result.exitCode, 0);
    assert.equal(result.stderr, "");
    assert.equal(result.stdout, "/dir/one\n");
    assert.equal(writes, 2);
  } finally {
    release();
    await execution;
    await shell.dispose();
    await other.dispose();
  }
});

async function completedRgRequest(mode: string, failOutput: boolean): Promise<WeakRef<object>[]> {
  const fs = new MemoryFileSystem();
  await fs.mkdir("/dir");
  await fs.writeFile("/dir/secret", new TextEncoder().encode("synthetic-tenant-secret\n"));
  const view = tryReadMemoryFileViewSync(fs, "/dir/secret")!;
  const controller = new AbortController();
  const shell = new Shell({ fs }).use(searchCommands(failOutput ? { maxOutputBytes: 1 } : {}));
  try {
    const result = await shell.exec(`rg ${mode} /dir`, { signal: controller.signal });
    if (failOutput) assert.notEqual(result.exitCode, 0);
    else assert.equal(result.exitCode, 0, result.stderr);
  } finally { await shell.dispose(); }
  return [new WeakRef(fs), new WeakRef(controller.signal), new WeakRef(view)];
}

for (const asynchronous of [false, true]) {
  test(`rg does not replay accepted directory output after sink failure, async=${asynchronous}`, async t => {
    const fs = new MemoryFileSystem();
    await fs.mkdir("/dir");
    await fs.writeFile("/dir/one", new TextEncoder().encode("needle\n"));
    const shell = new Shell({ fs }).use(searchCommands());
    const failure = new Error("sink failed after accepting directory output");
    const write = Capture.prototype.write;
    const writeRange = Capture.prototype.writeRangeSync;
    let writes = 0;
    const outputCaptures = new Set<Capture>();
    t.mock.method(Capture.prototype, "writeRangeSync", function (this: Capture, bytes: Uint8Array, len: number) {
      if (outputCaptures.size === 0) outputCaptures.add(this);
      if (!outputCaptures.has(this)) return writeRange.call(this, bytes, len);
      if (asynchronous) return false;
      writes++;
      writeRange.call(this, bytes, len);
      throw failure;
    });
    if (asynchronous) t.mock.method(Capture.prototype, "write", async function (this: Capture, bytes: Uint8Array) {
      if (!outputCaptures.has(this)) return write.call(this, bytes);
      writes++;
      await write.call(this, bytes);
      throw failure;
    });
    try {
      const result = await shell.exec("rg --files /dir");
      assert.notEqual(result.exitCode, 0);
      assert.equal(result.stdout, "/dir/one\n");
      assert.equal(writes, 1);
      t.mock.restoreAll();
      const recovered = await shell.exec("rg --files /dir");
      assert.equal(recovered.exitCode, 0, recovered.stderr);
      assert.equal(recovered.stdout, "/dir/one\n");
    } finally { await shell.dispose(); }
  });
}

for (const mode of ["--files", "-l synthetic-tenant-secret"]) {
  for (const failOutput of [false, true]) {
    test(`rg releases completed directory request resources: ${mode}, output failure=${failOutput}`, { skip: !globalThis.gc }, async () => {
      const refs = await completedRgRequest(mode, failOutput);
      for (let attempt = 0; attempt < 2; attempt++) {
        await new Promise<void>(resolve => setImmediate(resolve));
        globalThis.gc!();
      }
      assert.deepEqual(refs.map(ref => ref.deref() === undefined), [true, true, true]);
    });
  }
}

test("jq propagates a sink failure without replaying already published output", async t => {
  const fs = new MemoryFileSystem();
  await fs.writeFile("/data", new TextEncoder().encode('{"a":1}\n'));
  const shell = new Shell({ fs });
  shell.commands.register(jqCommand());
  try {
    await shell.exec("jq -c . /data");
    const failure = new Error("sink failed after accepting output");
    const writeRange = Capture.prototype.writeRangeSync;
    let writes = 0;
    t.mock.method(Capture.prototype, "writeRangeSync", function (this: Capture, bytes: Uint8Array, len: number) {
      writes++;
      writeRange.call(this, bytes, len);
      throw failure;
    });
    const result = await shell.exec("jq -c . /data");
    assert.notEqual(result.exitCode, 0);
    assert.equal(result.stdout, '{"a":1}\n');
    assert.equal(writes, 1);
  } finally { await shell.dispose(); }
});

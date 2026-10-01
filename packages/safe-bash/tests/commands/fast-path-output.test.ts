import { createStandardCommands, standardCommands } from "../../src/commands/index.js";
import { streamFormatCommands } from "../../src/commands/stream-format/index.js";
import { createEncodingCommands } from "../../src/commands/bytes/encoding/index.js";
import assert from "node:assert/strict";
import test from "node:test";
import { MemoryFileSystem } from "../../src/fs/memory/index.js";
import { Shell } from "../../src/shell/index.js";
import { textProgramCommands } from "../../src/commands/text-programs/index.js";
import { searchCommands } from "../../src/commands/search/index.js";
import { Capture } from "../../src/shell/runtime.js";
import { jqCommand } from "../../src/commands/structured/jq.js";
import { tryReadMemoryFileViewSync } from "@poe-code/safe-fs/core";
import { Limits as SearchLimits } from "../../src/commands/search/shared.js";
import { rgCommand } from "../../src/commands/search/rg.js";

test("synchronous command warmup preserves output at the exact byte limit", async t => {
  t.mock.method(performance, "now", () => 0);
  const fs = new MemoryFileSystem();
  const expected = '{"a":1}\n';
  await fs.writeFile("/data", new TextEncoder().encode(expected));
  const shell = new Shell({ fs, limits: { maxOutputBytes: expected.length } });
  shell.commands.register(jqCommand());
  t.after(() => shell.dispose());
  const result = await shell.exec("jq -c . /data");
  assert.equal(result.exitCode, 0, result.stderr);
  assert.equal(result.stdout, expected);
});

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

test("rg fallback publishes each byte once through an ordinary capture sink", async () => {
  const fs = new MemoryFileSystem();
  await fs.mkdir("/dir");
  const names = Array.from({ length: 1100 }, (_, i) => `/dir/file_${String(i).padStart(4, "0")}_${"a".repeat(50)}.txt`);
  for (const name of names) await fs.writeFile(name, new Uint8Array());
  class ObservedCapture extends Capture {
    publishedBytes = 0;
    override writeSync(chunk: Uint8Array): boolean {
      this.publishedBytes += chunk.byteLength;
      return super.writeSync(chunk);
    }
    override writeRangeSync(chunk: Uint8Array, length: number): boolean {
      this.publishedBytes += length;
      return super.writeRangeSync(chunk, length);
    }
  }
  const stdout = new ObservedCapture();
  stdout.enableScratchBuffer();
  const result = await rgCommand().execute({
    command: "rg", args: ["--files", "/dir"], fs, cwd: "/", env: {},
    signal: new AbortController().signal, stdin: { async *[Symbol.asyncIterator]() {} },
    stdout, stderr: new Capture(),
    ...{ _fastMemoryBackingFs: fs, _hasInfiniteFsOpsLimit: true },
  });
  const expected = names.join("\n") + "\n";
  assert.equal(result.exitCode, 0);
  assert.equal(new TextDecoder().decode(stdout.bytes()), expected);
  assert.equal(stdout.publishedBytes, Buffer.byteLength(expected));
});

test("warmed rg fallback charges its output once against the shell limit", async () => {
  const fs = new MemoryFileSystem();
  await fs.mkdir("/dir");
  const names = Array.from({ length: 1100 }, (_, i) => `/dir/file_${String(i).padStart(4, "0")}_${"a".repeat(50)}.txt`);
  for (const name of names) await fs.writeFile(name, new Uint8Array());
  const shell = new Shell({ fs, limits: { maxOutputBytes: 100000 } }).use(searchCommands());
  try {
    await shell.exec("");
    const result = await shell.exec("rg --files /dir");
    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal(result.stdout, names.join("\n") + "\n");
  } finally { await shell.dispose(); }
});

test("rg pending flush owns its private buffer until the sink completes", async () => {
  const fs = new MemoryFileSystem();
  for (const directory of ["/hold", "/first", "/other"]) await fs.mkdir(directory);
  for (const file of ["/hold/wait", "/first/alpha", "/other/omega"]) await fs.writeFile(file, new Uint8Array());
  class SuspendedCapture extends Capture {
    admit!: () => void;
    release!: () => void;
    admitted = new Promise<void>(resolve => { this.admit = resolve; });
    released = new Promise<void>(resolve => { this.release = resolve; });
    override writeRangeSync(): boolean { return false; }
    override async write(chunk: Uint8Array): Promise<void> {
      this.admit();
      await this.released;
      await super.write(chunk);
    }
  }
  const holder = new SuspendedCapture();
  const first = new SuspendedCapture();
  const other = new Capture();
  first.enableScratchBuffer();
  other.enableScratchBuffer();
  const execute = (path: string, stdout: Capture) => rgCommand().execute({
    command: "rg", args: ["--files", path], fs, cwd: "/", env: {},
    signal: new AbortController().signal, stdin: { async *[Symbol.asyncIterator]() {} },
    stdout, stderr: new Capture(),
    ...{ _fastMemoryBackingFs: fs, _hasInfiniteFsOpsLimit: true },
  });
  const pending = [execute("/hold/wait", holder)];
  try {
    await holder.admitted;
    pending.push(execute("/first", first));
    await first.admitted;
    const result = await execute("/other", other);
    assert.equal(result.exitCode, 0);
    assert.equal(new TextDecoder().decode(other.bytes()), "/other/omega\n");
    first.release();
    await pending[1];
    assert.equal(new TextDecoder().decode(first.bytes()), "/first/alpha\n");
  } finally {
    first.release();
    holder.release();
    await Promise.all(pending);
  }
});

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
    const writeSync = Capture.prototype.writeSync;
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
    if (!asynchronous) t.mock.method(Capture.prototype, "writeSync", function (this: Capture, bytes: Uint8Array) {
      if (outputCaptures.size === 0) outputCaptures.add(this);
      if (!outputCaptures.has(this)) return writeSync.call(this, bytes);
      writes++;
      writeSync.call(this, bytes);
      throw failure;
    });
    if (asynchronous) t.mock.method(Capture.prototype, "write", async function (this: Capture, bytes: Uint8Array) {
      if (outputCaptures.size === 0) outputCaptures.add(this);
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
    const writeSync = Capture.prototype.writeSync;
    let writes = 0;
    const outputCaptures = new Set<Capture>();
    t.mock.method(Capture.prototype, "writeRangeSync", function (this: Capture, bytes: Uint8Array, len: number) {
      if (outputCaptures.size === 0) outputCaptures.add(this);
      if (!outputCaptures.has(this)) return writeRange.call(this, bytes, len);
      writes++;
      writeRange.call(this, bytes, len);
      throw failure;
    });
    t.mock.method(Capture.prototype, "writeSync", function (this: Capture, bytes: Uint8Array) {
      if (outputCaptures.size === 0) outputCaptures.add(this);
      if (!outputCaptures.has(this)) return writeSync.call(this, bytes);
      writes++;
      writeSync.call(this, bytes);
      throw failure;
    });
    const result = await shell.exec("jq -c . /data");
    assert.notEqual(result.exitCode, 0);
    assert.equal(result.stdout, '{"a":1}\n');
    assert.equal(writes, 1);
  } finally { await shell.dispose(); }
});

test("cold awk 10000-line workload transitions across checkpointSync without duplicate records or unhandled rejections", async () => {
  const unhandled: unknown[] = [];
  const onUnhandled = (reason: unknown) => { unhandled.push(reason); };
  process.on("unhandledRejection", onUnhandled);
  const fs = new MemoryFileSystem();
  const shell = new Shell({ fs }).use(textProgramCommands());
  try {
    const lines = Array.from({ length: 10000 }, (_, i) => `item_${i}\t${(i % 97) * 13}\t${i % 23}\tstatus_${i % 5}`).join("\n") + "\n";
    await fs.writeFile("/lines.txt", new TextEncoder().encode(lines));
    const result = await shell.exec('awk -F"\t" "{sum += \\$3} END {print sum, NR}" /lines.txt');
    assert.equal(result.exitCode, 0);
    assert.equal(result.stderr, "");
    assert.equal(result.stdout, "109955 10000\n");
    await new Promise<void>(resolve => setImmediate(resolve));
    assert.deepEqual(unhandled, []);
  } finally {
    process.off("unhandledRejection", onUnhandled);
    await shell.dispose();
  }
});

for (const sample of [
  { command: "cut -d: -f3,1,3,5", input: "a:b:c", expected: "a:c" },
  { command: "cut -d: -f5,6", input: "a:b:c", expected: "" },
  { command: "tr a-z A-Z", input: "héllo ß", expected: "HéLLO ß", stdin: true },
  { command: "tr A-Z a-z", input: "HÉLLO İ", expected: "hÉllo İ", stdin: true },
  ...["\v", "\f", "\r", "\u00a0"].map(separator => ({ command: "awk '{print $1}'", input: `a${separator}b`, expected: `a${separator}b` })),
  { command: "awk -F ' ' '{print $1}'", input: " \ta\vb\t ", expected: "a\vb" },
  { command: "awk -F: '{print $NF}'", input: "", expected: "" },
  { command: "wc -w", input: "a\u00a0b", expected: "1", stdin: true },
  { command: "wc -w", input: "a\tb\vc\fd\re", expected: "5", stdin: true },
  { command: "nl", input: "a\n\\:\nb", expected: "     1\ta\n\n       b", stdin: true },
  { command: "nl", input: "a\n\\:\\:\nb", expected: "     1\ta\n\n     1\tb", stdin: true },
  { command: "nl", input: "a\n\\:\\:\\:\nb", expected: "     1\ta\n\n       b", stdin: true },
  { command: "base64 -d", input: "YQBi", expected: "ab", stdin: true },
  { command: "base64 --decode", input: "YWI=", expected: "ab", stdin: true },
]) {
  for (const source of ["here-string", "file"]) {
    test(`single substitution ${sample.command} with ${JSON.stringify(sample.input)} from ${source}`, async t => {
      const fs = new MemoryFileSystem();
      const shell = new Shell({ fs, env: { LC_ALL: "C" } }).use(standardCommands()).use(textProgramCommands()).use(streamFormatCommands());
      for (const command of createEncodingCommands()) shell.commands.register(command);
      t.after(() => shell.dispose());
      await fs.writeFile("/input", new TextEncoder().encode(sample.input + "\n"));
      const quoted = "'" + sample.input.replaceAll("'", "'\\''") + "'";
      const invocation = source === "here-string" ? `${sample.command} <<< ${quoted}` : `${sample.command} ${sample.stdin ? "< " : ""}/input`;
      for (let warm = 0; warm < 2; warm++) {
        const result = await shell.exec(`x=$(${invocation}); printf '%s' "$x"`);
        assert.equal(result.exitCode, 0, result.stderr);
        assert.equal(result.stdout, sample.expected);
      }
    });
  }
}

for (const input of ["!", "A", "====", "YWI=!"]) {
  test(`invalid base64 substitution reports command failure for ${input}`, async t => {
    const shell = new Shell({ fs: new MemoryFileSystem() }).use(standardCommands());
    for (const command of createEncodingCommands()) shell.commands.register(command);
    t.after(() => shell.dispose());
    const result = await shell.exec(`x=$(base64 -d <<< '${input}')`);
    assert.equal(result.exitCode, 1);
    assert.match(result.stderr, /base64:/);
    assert.doesNotMatch(result.stderr, /internal error/);
  });
}


const wordCountEnvironments: Readonly<Record<string, string>>[] = [
  { LC_ALL: "C" }, { LC_ALL: "C.UTF-8" }, { LC_ALL: "C.UTF-8", POSIXLY_CORRECT: "1" },
];
for (const env of wordCountEnvironments) {
  test(`word-count substitution preserves locale ${JSON.stringify(env)}`, async t => {
    const shell = new Shell({ fs: new MemoryFileSystem(), env }).use(standardCommands());
    t.after(() => shell.dispose());
    const ordinary = await shell.exec("printf 'a b\\n' | wc -w");
    const substituted = await shell.exec("x=$(wc -w <<< 'a b'); printf '%s\\n' \"$x\"");
    assert.equal(substituted.exitCode, ordinary.exitCode);
    assert.equal(substituted.stdout, ordinary.stdout);
    assert.equal(substituted.stderr, ordinary.stderr);
  });
}


for (const synchronous of [false, true]) {
  for (const scenario of [
    { name: "sort", args: [], line: (i: number) => `${String(1200 - i).padStart(4, "0")}:${"x".repeat(70)}\n`, transform: (lines: string[]) => lines.sort().join("") },
    { name: "uniq", args: [], line: (i: number) => `${i}:${"x".repeat(70)}\n`, transform: (lines: string[]) => lines.join("") },
    { name: "cut", args: ["-d:", "-f2"], line: (i: number) => `${i}:${"x".repeat(70)}\n`, transform: (lines: string[]) => lines.map(line => line.slice(line.indexOf(":") + 1)).join("") },
    { name: "grep", args: ["-F", "x"], line: (i: number) => `${i}:${"x".repeat(70)}\n`, transform: (lines: string[]) => lines.join("") },
  ]) {
    test(`${scenario.name} preserves retained output across slab flushes, synchronous=${synchronous}`, async () => {
      const chunks: Uint8Array[] = [];
      const lines = Array.from({ length: 1200 }, (_, i) => scenario.line(i));
      const fs = new MemoryFileSystem();
      await fs.writeFile("/input", new TextEncoder().encode(lines.join("")));
      const definition = createStandardCommands().find(command => command.name === scenario.name)!;
      const stdout = {
        async write(bytes: Uint8Array) { chunks.push(bytes); },
        ...(synchronous ? { writeSync(bytes: Uint8Array) { chunks.push(bytes); return true; } } : {}),
      };
      const result = await definition.execute({
        command: scenario.name, args: [...scenario.args, "/input"], cwd: "/", env: { LC_ALL: "C" }, fs,
        signal: new AbortController().signal, stdin: { async *[Symbol.asyncIterator]() {} },
        stdout, stderr: new Capture(),
      });
      assert.equal(result.exitCode, 0);
      assert.ok(chunks.length > 1, "exercise more than one staging-buffer publication");
      assert.ok(Buffer.concat(chunks).toString() === scenario.transform(lines), "retained chunks preserve every output byte");
    });
  }
  test(`find preserves retained output across invocations, synchronous=${synchronous}`, async () => {
    const chunks: Uint8Array[] = [];
    const fs = new MemoryFileSystem();
    await fs.mkdir("/alpha");
    await fs.mkdir("/omega");
    await fs.writeFile("/alpha/first", new Uint8Array());
    await fs.writeFile("/omega/other", new Uint8Array());
    const definition = createStandardCommands().find(command => command.name === "find")!;
    const stdout = {
      async write(bytes: Uint8Array) { chunks.push(bytes); },
      ...(synchronous ? { writeSync(bytes: Uint8Array) { chunks.push(bytes); return true; } } : {}),
    };
    for (const directory of ["/alpha", "/omega"]) {
      const result = await definition.execute({
        command: "find", args: [directory], cwd: "/", env: {}, fs,
        signal: new AbortController().signal, stdin: { async *[Symbol.asyncIterator]() {} },
        stdout, stderr: new Capture(),
      });
      assert.equal(result.exitCode, 0);
    }
    assert.equal(Buffer.concat(chunks).toString(), "/alpha\n/alpha/first\n/omega\n/omega/other\n");
  });
}

for (const synchronous of [false, true]) {
  for (const privateBuffer of [false, true]) {
    test(`search staging retains owned output, synchronous=${synchronous}, privateBuffer=${privateBuffer}`, async () => {
      const chunks: Uint8Array[] = [];
      const context = {
        command: "rg", args: [], cwd: "/", env: {}, fs: new MemoryFileSystem(),
        signal: new AbortController().signal, stdin: { async *[Symbol.asyncIterator]() {} },
        stdout: { async write(bytes: Uint8Array) { chunks.push(bytes); },
          ...(synchronous ? { writeSync(bytes: Uint8Array) { chunks.push(bytes); return true; } } : {}) },
        stderr: new Capture(),
      };
      const holder = new SearchLimits(context, {});
      const output = new SearchLimits(context, {});
      try {
        if (privateBuffer) await holder.outputSyncOrAsync("held");
        for (const value of ["alpha", "omega"]) {
          await output.outputSyncOrAsync(value);
          await output.flushSyncOrAsync();
        }
        assert.equal(Buffer.concat(chunks).toString(), "alphaomega");
      } finally { await holder.flush(); await output.flush(); }
    });
  }
}

test("grep owns retained long-line output before borrowed input advances", async () => {
  const chunks: Uint8Array[] = [];
  const expected = "x".repeat(65537) + "\n";
  const borrowed = Buffer.from(expected);
  const definition = createStandardCommands().find(command => command.name === "grep")!;
  const result = await definition.execute({
    command: "grep", args: ["x"], cwd: "/", env: { LC_ALL: "C" }, fs: new MemoryFileSystem(),
    signal: new AbortController().signal,
    stdin: { async *[Symbol.asyncIterator]() { yield borrowed; borrowed.fill(0); } },
    stdout: { async write(bytes: Uint8Array) { chunks.push(bytes); } }, stderr: new Capture(),
  });
  assert.equal(result.exitCode, 0);
  assert.ok(Buffer.concat(chunks).toString() === expected, "retained output survives producer reuse");
});

test("grep charges one file operation when the memory view declines", async t => {
  const fs = new MemoryFileSystem();
  await fs.writeFile("/input", new TextEncoder().encode("needle\n"));
  const permission = Reflect.get(fs, "permission") as (...args: unknown[]) => unknown;
  Reflect.set(fs, "permission", function (this: MemoryFileSystem, ...args: unknown[]) { return permission.apply(this, args); });
  assert.equal(tryReadMemoryFileViewSync(fs, "/input"), undefined);
  const shell = new Shell({ fs }).use(standardCommands());
  t.after(() => shell.dispose());
  const result = await shell.exec("grep needle /input", { limits: { maxFileSystemOperations: 1 } });
  assert.equal(result.exitCode, 0, result.stderr);
  assert.equal(result.stdout, "needle\n");
});

test("grep owns retained long-line memory output across file replacement", async () => {
  const chunks: Uint8Array[] = [];
  const expected = "x".repeat(65537) + "\n";
  const fs = new MemoryFileSystem();
  await fs.writeFile("/input", new TextEncoder().encode(expected));
  const definition = createStandardCommands().find(command => command.name === "grep")!;
  const result = await definition.execute({
    command: "grep", args: ["x", "/input"], cwd: "/", env: { LC_ALL: "C" }, fs,
    signal: new AbortController().signal, stdin: { async *[Symbol.asyncIterator]() {} },
    stdout: { async write(bytes: Uint8Array) { chunks.push(bytes); } }, stderr: new Capture(),
  });
  assert.equal(result.exitCode, 0);
  await fs.writeFile("/input", new TextEncoder().encode("y".repeat(65537) + "\n"));
  assert.ok(Buffer.concat(chunks).toString() === expected, "retained output survives replacement of the source file");
});

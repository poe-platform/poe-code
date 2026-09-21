import assert from "node:assert/strict";
import test from "node:test";
import { basicCommands } from "../../src/commands/basic.js";
import { Shell } from "../../src/shell/index.js";
import { MemoryFileSystem } from "../../src/fs/memory/index.js";
import { ssconvertCommands } from "../../src/commands/ssconvert/index.js";
import type { Codec } from "poe-code/ssconvert";

const codec: Codec = { id: "original", description: "Original resource fixture", extensions: ["fixture"],
  probeContent: () => true,
  async read(bytes) { assert.deepEqual([...bytes], [1, 2]); return { sheets: [{ id: "s", name: "S", cells: [] }] }; },
  async write() { return new Uint8Array([3, 4]); } };
test("ssconvert bounds empty provider chunks before import and namespace acquisition", async () => {
  const fs = new MemoryFileSystem();
  let retired = false, imports = 0;
  fs.readStream = () => (async function* () {
    try {
      for (let index = 0; index < 5; index++) yield new Uint8Array();
      yield new Uint8Array([1, 2]);
    } finally { await Promise.resolve(); retired = true; }
  })();
  const shell = new Shell({ fs }).use(ssconvertCommands({ codecs: [{ ...codec,
    async read() { imports++; return { sheets: [] }; } }],
    limits: { inputBytes: 100, outputBytes: 100, cells: 10, sheets: 2, operations: 10, workbookWork: 4 },
    environment: { env: {}, locale: "C", timezone: "UTC" } }));
  try {
    const result = await shell.exec("ssconvert /input.fixture /output.fixture");
    assert.equal(result.exitCode, 1);
    assert.equal(result.stderr, "ssconvert input chunks limit exceeded\n");
    assert.equal(result.stdout, ""); assert.equal(retired, true); assert.equal(imports, 0);
    assert.deepEqual(await fs.readdir("/"), []);
  } finally { await shell.dispose(); }
});
test("ssconvert consumes supplied byte streams and preserves reused chunks and parent state", async () => {
  const fs = new MemoryFileSystem();
  await fs.writeFile("/input.fixture", new Uint8Array([1, 2]));
  const events: string[] = [];
  fs.readStream = (_path, options) => (async function* () {
    assert.ok(options?.signal); events.push("stream-read");
    const chunk = new Uint8Array([1]); yield chunk; chunk[0] = 2; yield chunk; chunk[0] = 9;
  })();
  fs.readFile = async () => { throw new Error("buffered reads forbidden by this host"); };
  const writeFile = fs.writeFile.bind(fs);
  fs.writeStream = async (path, source, options) => {
    assert.ok(options?.signal); events.push("stream-write");
    const bytes: number[] = []; for await (const chunk of source) bytes.push(...chunk);
    assert.deepEqual(bytes, [3, 4]);
    await writeFile(path, new Uint8Array(bytes), options);
  };
  fs.writeFile = async (path, bytes, options) => {
    assert.equal(options?.flag, "wx"); assert.equal(bytes.length, 0);
    await writeFile(path, bytes, options);
  };
  const shell = new Shell({ fs, env: { KEEP: "parent" } }).use(ssconvertCommands({ codecs: [codec],
    limits: { inputBytes: 100, outputBytes: 100, cells: 10, sheets: 2, operations: 10 },
    environment: { env: {}, locale: "C", timezone: "UTC" } }));
  for (const command of basicCommands()) shell.register(command);
  try {
    const result = await shell.exec("ssconvert /input.fixture /output.fixture");
    assert.equal(result.exitCode, 0, result.stderr);
    assert.deepEqual(events, ["stream-read", "stream-write"]);
    assert.equal((await shell.exec("echo $KEEP")).stdout, "parent\n");
  } finally { await shell.dispose(); }
});

test("ssconvert input refusal closes streaming producers before import or publication", async () => {
  const fs = new MemoryFileSystem();
  let returned = 0, imports = 0, writes = 0;
  fs.readStream = (_path, options) => {
    assert.ok(options?.signal);
    return { [Symbol.asyncIterator]() { return {
      async next() { return { done: false, value: new Uint8Array([1, 2]) }; },
      async return() { returned++; return { done: true, value: undefined }; }
    }; } };
  };
  fs.writeStream = async () => { writes++; };
  const shell = new Shell({ fs }).use(ssconvertCommands({ codecs: [{ ...codec,
    async read() { imports++; return { sheets: [] }; } }],
    limits: { inputBytes: 1, outputBytes: 100, cells: 10, sheets: 2, operations: 10 },
    environment: { env: {}, locale: "C", timezone: "UTC" } }));
  try {
    const result = await shell.exec("ssconvert /input.fixture /output.fixture");
    assert.equal(result.exitCode, 1);
    assert.equal(result.stderr, "ssconvert input bytes limit exceeded\n");
    assert.equal(returned, 1); assert.equal(imports, 0); assert.equal(writes, 0);
    assert.deepEqual(await fs.readdir("/"), []);
  } finally { await shell.dispose(); }
});

test("ssconvert root abort drains cooperative provider read cleanup", async () => {
  const fs = new MemoryFileSystem();
  const abort = new AbortController();
  let start!: () => void;
  const started = new Promise<void>(resolve => { start = resolve; });
  let release!: (result: IteratorResult<Uint8Array>) => void;
  const events: string[] = [];
  fs.readStream = (_path, options) => {
    assert.ok(options?.signal);
    return { [Symbol.asyncIterator]() { return {
      next() { start(); return new Promise<IteratorResult<Uint8Array>>(resolve => { release = resolve; }); },
      async return() { events.push("return"); release({ done: true, value: undefined });
        await Promise.resolve(); events.push("settled"); return { done: true, value: undefined }; }
    }; } };
  };
  const shell = new Shell({ fs }).use(ssconvertCommands({ codecs: [codec],
    limits: { inputBytes: 100, outputBytes: 100, cells: 10, sheets: 2, operations: 10 },
    environment: { env: {}, locale: "C", timezone: "UTC" } }));
  try {
    const running = shell.exec("ssconvert /input.fixture /output.fixture", { signal: abort.signal });
    await started;
    const reason = new Error("original host cancellation");
    abort.abort(reason);
    await assert.rejects(running, error => error === reason);
    assert.deepEqual(events, ["return", "settled"]);
    assert.deepEqual(await fs.readdir("/"), []);
  } finally { await shell.dispose(); }
});

test("ssconvert refuses argument copies before materializing owned argv bytes", async () => {
  const { createCommandArguments } = await import("../../src/contracts/command.js");
  const { createSsconvertCommand } = await import("../../src/commands/ssconvert/index.js");
  let copying = false;
  const args = createCommandArguments(["--help"], { assertOpen() {}, reserve() {
    if (copying) throw new Error("argv bytes allocated before admission");
    return { commit() {}, release() {} };
  } });
  copying = true;
  const errors: string[] = [];
  const result = await createSsconvertCommand({ codecs: [codec],
    limits: { argumentBytes: 5, inputBytes: 100, outputBytes: 100, cells: 10, sheets: 2, operations: 10 },
    environment: { env: {}, locale: "C", timezone: "UTC" } }).execute({ command: "ssconvert", args: args.args,
      argumentValues: args, fs: new MemoryFileSystem(), cwd: "/", env: {}, signal: new AbortController().signal,
      stdin: (async function* () {})(), stdout: { async write() { throw new Error("terminal output forbidden"); } },
      stderr: { async write(bytes) { errors.push(new TextDecoder().decode(bytes)); } } });
  assert.equal(result.exitCode, 1);
  assert.deepEqual(errors, ["ssconvert argument bytes limit exceeded\n"]);
});

test("ssconvert streaming read failures retain native I/O diagnostics", async () => {
  const shell = new Shell({ fs: new MemoryFileSystem() }).use(ssconvertCommands({ codecs: [codec],
    limits: { inputBytes: 100, outputBytes: 100, cells: 10, sheets: 2, operations: 10 },
    environment: { env: {}, locale: "C", timezone: "UTC" } }));
  try {
    const result = await shell.exec("ssconvert /missing.fixture /output.fixture");
    assert.equal(result.exitCode, 1);
    assert.equal(result.stderr, "E /missing.fixture: No such file or directory\n");
  } finally { await shell.dispose(); }
});

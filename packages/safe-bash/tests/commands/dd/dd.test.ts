import assert from "node:assert/strict";
import test from "node:test";
import { createMemoryFileSystem, createMountFileSystem, FsError } from "poe-code/safe-fs";
import { createDdCommand, createDdCommands, ddCommands } from "../../../src/commands/dd/index.js";
import { createDeviceFileSystem } from "../../../src/fs/devices/index.js";
import { Shell, ShellLimitError } from "../../../src/shell/index.js";
import { streamCommands } from "../../../src/commands/streams.js";
import { bytes, run } from "./helpers.js";

test("dd remains opt-in and executes through a real Shell", async () => {
  assert.equal(createDdCommand().name, "dd");
  assert.deepEqual(createDdCommands().map(command => command.name), ["dd"]);
  const fs = createMemoryFileSystem();
  await fs.writeFile("/input", bytes("abcdef"));
  const shell = new Shell({ fs }).use(ddCommands());
  try {
    const result = await shell.exec("dd if=/input of=/output bs=2 count=2 status=none");
    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal(result.stdout, "");
    assert.equal(result.stderr, "");
    assert.deepEqual(await fs.readFile("/output"), bytes("abcd"));
  } finally { await shell.dispose(); }
});

test("default records, independent block sizes, bs precedence and byte count", async () => {
  for (const [args, output, report] of [
    [["ibs=3", "obs=4"], "abcdefgh", "2+1 records in\n2+0 records out\n"],
    [["bs=2", "ibs=3", "obs=4", "count=3"], "abcdef", "3+0 records in\n3+0 records out\n"],
    [["ibs=4", "obs=3", "count=5B"], "abcde", "1+1 records in\n1+1 records out\n"],
    [["bs=2", "count=0"], "", "0+0 records in\n0+0 records out\n"],
  ] as const) {
    const result = await run([...args, "status=noxfer"], bytes("abcdefgh"));
    assert.equal(result.exitCode, 0, result.stderr);
    assert.deepEqual(result.stdout, bytes(output));
    assert.equal(result.stderr, report);
  }
});

test("short reads are records unless fullblock is requested", async () => {
  async function* fragments() { yield bytes("ab"); yield bytes("cd"); yield bytes("ef"); }
  const short = await run(["bs=4", "count=1", "status=noxfer"], undefined, { stdin: fragments() });
  assert.deepEqual(short.stdout, bytes("ab"));
  assert.equal(short.stderr, "0+1 records in\n0+1 records out\n");
  const full = await run(["bs=4", "count=1", "iflag=fullblock", "status=noxfer"], undefined, { stdin: fragments() });
  assert.deepEqual(full.stdout, bytes("abcd"));
  assert.equal(full.stderr, "1+0 records in\n1+0 records out\n");
});

test("retained producer fragments are copied before producer advancement or closure", async () => {
  let closed = false;
  async function* source() {
    const storage = Buffer.from("abcdef");
    try { yield storage; storage.fill(120); yield storage.subarray(0, 2); }
    finally { storage.fill(0); closed = true; }
  }
  const result = await run(["ibs=4", "obs=3", "iflag=fullblock", "status=none"], undefined, { stdin: source() });
  assert.deepEqual(result.stdout, bytes("abcdefxx"));
  assert.equal(closed, true);
});

test("sync, swab and record conversions preserve cross-block state", async () => {
  for (const [args, input, output] of [
    [["bs=4", "conv=sync"], "abcde", "abcd" + "e\0\0\0"],
    [["ibs=3", "obs=2", "conv=swab"], "abcdefg", "badcfeg"],
    [["ibs=2", "obs=3", "cbs=4", "conv=block"], "a\nabcdef\nxy", "a   abcdxy  "],
    [["ibs=2", "obs=3", "cbs=4", "conv=unblock"], "a   bc  d", "a\nbc\nd\n"],
    [["ibs=3", "cbs=4", "conv=sync,block"], "a\n", "a       "],
  ] as const) {
    const result = await run([...args, "status=none"], bytes(input));
    assert.equal(result.exitCode, 0, result.stderr);
    assert.deepEqual(result.stdout, bytes(output));
  }
});

test("input skip aliases, byte flags and too-short input warnings", async () => {
  for (const args of [["ibs=2", "skip=2"], ["ibs=2", "iseek=4B"], ["ibs=2", "skip=4", "iflag=skip_bytes"]]) {
    assert.deepEqual((await run([...args, "status=none"], bytes("abcdef"))).stdout, bytes("ef"));
  }
  const missing = await run(["skip=1", "status=noxfer"], bytes("abc"));
  assert.equal(missing.exitCode, 0);
  assert.equal(missing.stderr, "dd: 'standard input': cannot skip to specified offset\n0+0 records in\n0+0 records out\n");
});

test("count=0 still opens and truncates output, without acquiring stdin", async () => {
  const fs = createMemoryFileSystem();
  await fs.writeFile("/target", bytes("old"));
  const result = await run(["of=/target", "count=0", "status=none"], undefined, {
    fs, stdin: { [Symbol.asyncIterator]() { throw new Error("unexpected input acquisition"); } },
  });
  assert.equal(result.exitCode, 0, result.stderr);
  assert.deepEqual(await fs.readFile("/target"), new Uint8Array());
  assert.equal((await run(["if=/absent", "count=0", "status=none"], undefined, { fs })).exitCode, 1);
});

test("virtual script copies binary files, appends, exclusively creates and discards to devices", async () => {
  const fs = createMountFileSystem({ root: createMemoryFileSystem(), mounts: { "/dev": createDeviceFileSystem() } });
  const input = new Uint8Array([0, 255, 65, 10, 0, 128]);
  await fs.writeFile("/input", input);
  await fs.writeFile("/copy.sh", bytes("dd if=/input of=/output bs=2 count=2 conv=excl status=none\ndd if=/input skip=4B of=/output oflag=append conv=notrunc status=none\ndd if=/output of=/dev/null status=none\n"));
  const shell = new Shell({ fs }).use(ddCommands());
  try {
    const result = await shell.exec("sh /copy.sh");
    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal(result.stdout, "");
    assert.equal(result.stderr, "");
    assert.deepEqual(await fs.readFile("/output"), input);
    const duplicate = await shell.exec("dd of=/output count=0 conv=excl status=none");
    assert.equal(duplicate.exitCode, 1);
    assert.equal(duplicate.stderr, "dd: failed to open '/output': File exists\n");
    assert.deepEqual(await fs.readFile("/output"), input);
  } finally { await shell.dispose(); }
});

test("empty, missing, directory and symlink-relative input paths retain namespace semantics", async () => {
  const fs = createMemoryFileSystem();
  await fs.mkdir("/actual/nested", { recursive: true });
  await fs.symlink("/actual/nested", "/alias");
  await fs.writeFile("/actual/value", bytes("correct"));
  await fs.writeFile("/value", bytes("wrong"));
  assert.deepEqual((await run(["if=alias/../value", "status=none"], undefined, { fs })).stdout, bytes("correct"));
  for (const [operand, expected] of [
    ["if=", "failed to open '': No such file or directory"],
    ["of=", "failed to open '': No such file or directory"],
    ["if=/missing", "failed to open '/missing': No such file or directory"],
    ["if=/", "error reading '/': Is a directory"],
    ["of=/", "failed to open '/': Is a directory"],
  ]) {
    const result = await run([operand!, "status=none"], undefined, { fs });
    assert.equal(result.exitCode, 1);
    assert.equal(result.stderr, `dd: ${expected}\n`);
  }
});

test("device streams honor count and default safety budgets", async () => {
  const fs = createMountFileSystem({ root: createMemoryFileSystem(), mounts: { "/dev": createDeviceFileSystem() } });
  const zero = await run(["if=/dev/zero", "bs=7", "count=3", "status=none"], undefined, { fs });
  assert.equal(zero.exitCode, 0, zero.stderr);
  assert.deepEqual(zero.stdout, new Uint8Array(21));
  const random = await run(["if=/dev/urandom", "of=/random", "bs=256", "count=2", "status=none"], undefined, { fs });
  assert.equal(random.exitCode, 0, random.stderr);
  assert.equal((await fs.readFile("/random")).length, 512);
  const bounded = await run(["if=/dev/zero", "bs=8", "status=none"], undefined, { fs }, { maxTransferBytes: 16 });
  assert.equal(bounded.exitCode, 1);
  assert.ok(bounded.stderr.includes("limit"));
  assert.ok(bounded.stdout.length <= 16);
});

test("pre-aborted calls preserve the reason before file changes", async () => {
  const reason = new FsError("ENOENT");
  await assert.rejects(run(["of=/out"], undefined, { signal: AbortSignal.abort(reason) }), error => error === reason);
});

test("provider-only flags are not silently ignored by ordinary VFS adapters", async () => {
  for (const operand of ["iflag=direct", "oflag=sync", "conv=fsync", "conv=fdatasync", "iflag=nocache"]) {
    const result = await run([operand, "status=none"], bytes("a"));
    assert.equal(result.exitCode, 1);
    assert.ok(result.stderr.includes("not supported"), result.stderr);
    assert.equal(result.stdout.length, 0);
  }
});

test("argument limits measure UTF-8 bytes, not UTF-16 string length", async () => {
  const result = await run(["if=ééé"], undefined, {}, { maxArgumentBytes: 7 });
  assert.equal(result.stderr, "dd: argument limit exceeded\n");
});

test("same input/output follows open-then-truncate order", async () => {
  const fs = createMemoryFileSystem();
  await fs.writeFile("/same", bytes("original"));
  const result = await run(["if=/same", "of=/same", "status=noxfer"], undefined, { fs });
  assert.equal(result.exitCode, 0, result.stderr);
  assert.deepEqual(await fs.readFile("/same"), new Uint8Array());
  assert.equal(result.stderr, "0+0 records in\n0+0 records out\n");
});

test("cancellation interrupts stalled reads and preserves falsey reasons while closing", async () => {
  const controller = new AbortController();
  let ready!: () => void;
  const started = new Promise<void>(resolve => { ready = resolve; });
  let returned = 0;
  const execution = run(["status=none"], undefined, {
    signal: controller.signal,
    stdin: { [Symbol.asyncIterator]() { return {
      next() { ready(); return new Promise<IteratorResult<Uint8Array>>(() => {}); },
      async return() { returned++; return { done: true as const, value: undefined }; },
    }; } },
  });
  await started;
  controller.abort(false);
  await assert.rejects(execution, reason => reason === false);
  assert.equal(returned, 1);
});

test("endless device cancellation closes both stream directions", async () => {
  const fs = createMountFileSystem({ root: createMemoryFileSystem(), mounts: { "/dev": createDeviceFileSystem() } });
  const controller = new AbortController();
  const reason = new Error("cancel device transfer");
  const timer = setTimeout(() => controller.abort(reason), 5);
  try {
    await assert.rejects(run(["if=/dev/zero", "of=/dev/null", "bs=8", "status=none"], undefined, { fs, signal: controller.signal }), error => error === reason);
  } finally { clearTimeout(timer); }
});

test("oversized input fragments reject before retention and close their producer", async () => {
  let closed = false;
  async function* source() {
    try { yield bytes("abc"); }
    finally { closed = true; }
  }
  const result = await run(["status=none"], undefined, { stdin: source() }, { maxBufferBytes: 2 });
  assert.equal(result.exitCode, 1);
  assert.equal(result.stderr, "dd: input buffer limit exceeded\n");
  assert.equal(closed, true);
});

test("file output participates in the shell's shared byte budget, including exclusive creation", async () => {
  for (const conversion of ["", "conv=excl"]) {
    const fs = createMemoryFileSystem();
    await fs.writeFile("/input", bytes("abcdefghijklmnop"));
    const shell = new Shell({ fs }).use(ddCommands());
    try {
      await assert.rejects(shell.exec(`dd if=/input of=/out bs=8 status=none ${conversion}`, { limits: { maxOutputBytes: 8 } }), error => error instanceof ShellLimitError && error.limit === "maxOutputBytes");
      assert.ok((await fs.readFile("/out")).length <= 8);
    } finally { await shell.dispose(); }
  }
});

test("downstream closure cancels named-file reads, without waiting for a stalled next block", async () => {
  const fs = createMemoryFileSystem();
  Object.defineProperty(fs, "capabilities", { value: Object.freeze({ ...fs.capabilities, open: false }) });
  await fs.writeFile("/input", bytes("A"));
  let returned = 0;
  fs.readStream = () => ({ [Symbol.asyncIterator]() {
    let first = true;
    return {
      async next() {
        if (first) { first = false; return { done: false as const, value: bytes("ABCD") }; }
        return new Promise<IteratorResult<Uint8Array>>(() => {});
      },
      async return() { returned++; return { done: true as const, value: undefined }; },
    };
  } });
  const shell = new Shell({ fs, limits: { maxWallClockMs: 100 } }).use(ddCommands());
  for (const command of streamCommands()) shell.register(command);
  try {
    const result = await shell.exec("dd if=/input bs=4 status=none | head -c 1");
    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal(result.stdout, "A");
    assert.equal(result.stderr, "");
    assert.equal(returned, 1);
  } finally { await shell.dispose(); }
});

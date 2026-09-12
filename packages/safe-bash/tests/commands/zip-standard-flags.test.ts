import assert from "node:assert/strict";
import test from "node:test";
import { setImmediate } from "node:timers/promises";
import { Shell, ShellLimitError } from "../../src/shell/index.js";
import { archiveCommands } from "../../src/commands/archive/index.js";
import { standardCommands } from "../../src/commands/index.js";
import { bindFileOutputBudget } from "../../src/contracts/filesystem-output.js";
import type { FileSystem, InvocationCleanup } from "../../src/contracts/index.js";
import { archiveBytes, binary, compressed, execute, fixture, members, readOnlyArchive } from "./zip-standard-flags.helpers.js";

for (const flags of [["-q"], ["-qq"], ["-qr"], ["-rq"], ["-r", "-q"]]) {
  test(`zip ${flags.join(" ")} suppresses create/update progress without a text budget charge`, async () => {
    const fs = await fixture();
    for (let update = 0; update < 2; update++) {
      const result = await execute("zip", fs, [...flags, "output", "binary", "folder/data"], { limits: { maxTextBytes: 1 } });
      assert.deepEqual(result, { exitCode: 0, stdout: Buffer.alloc(0), stderr: "" });
      const output = await execute("unzip", fs, ["-p", "output.zip"]);
      assert.equal(output.exitCode, 0, output.stderr);
      assert.deepEqual(output.stdout, Buffer.concat([binary, compressed]));
    }
  });
}

test("zip -q retains fatal diagnostics and native statuses, suppressing advisory missing-source warnings", async () => {
  const fs = await fixture();
  assert.deepEqual(await execute("zip", fs, ["-q", "output", "missing"]), {
    exitCode: 12, stdout: Buffer.from("\nzip error: Nothing to do! (output.zip)\n"), stderr: "",
  });
  assert.deepEqual(await execute("zip", fs, ["-q", "output", "missing", "binary"]), { exitCode: 0, stdout: Buffer.alloc(0), stderr: "" });
  const invalid = await execute("zip", fs, ["-q", "-!", "output", "binary"]);
  assert.equal(invalid.exitCode, 16);
  assert.match(invalid.stdout.toString(), /zip error: Invalid command arguments/u);
  const limited = await execute("zip", fs, ["-q", "output", "binary"], { limits: { maxEntryBytes: 1 } });
  assert.equal(limited.exitCode, 2);
  assert.notEqual(limited.stderr, "");
});

for (const flags of [["-p"], ["-pp"], ["-lp"], ["-pl"], ["-l", "-p"], ["-p", "-l"], ["-op"], ["-po"]]) {
  test(`unzip ${flags.join(" ")} streams raw members in archive order without any extraction access`, async () => {
    const observed = readOnlyArchive(await fixture());
    let stdinRead = false;
    const result = await execute("unzip", observed.fs, [...flags, "sample.zip"], { limits: { maxTextBytes: 16 } }, {
      stdin: { [Symbol.asyncIterator]() { stdinRead = true; throw new Error("must not read stdin"); } },
      registerCleanup() {},
    });
    assert.deepEqual(result, { exitCode: 0, stdout: Buffer.concat(members.map(member => member.body)), stderr: "" });
    assert.equal(stdinRead, false);
    assert.ok(observed.calls.length > 0);
    assert.ok(observed.calls.every(call => call.path === "/work/sample.zip"), JSON.stringify(observed.calls));
  });
}

test("unzip -p ignores -d with a diagnostic even when combined with -l and -o", async () => {
  const observed = readOnlyArchive(await fixture());
  assert.deepEqual(await execute("unzip", observed.fs, ["-plod/absent/path", "sample.zip", "binary"]), {
    exitCode: 0, stdout: binary, stderr: "caution:  not extracting; -d ignored\n",
  });
  assert.ok(observed.calls.every(call => call.path === "/work/sample.zip"));
});

for (const selection of [
  { args: ["folder/*", "binary"], body: Buffer.concat([binary, compressed]), status: 0, error: "" },
  { args: ["binary", "binary"], body: binary, status: 11, error: "caution: filename not matched:  binary\n" },
  { args: ["b?n[aeiou]ry"], body: binary, status: 0, error: "" },
  { args: ["empty"], body: Buffer.alloc(0), status: 0, error: "" },
  { args: ["folder/"], body: Buffer.alloc(0), status: 0, error: "" },
  { args: ["missing"], body: Buffer.alloc(0), status: 11, error: "caution: filename not matched:  missing\n" },
  { args: ["binary", "missing"], body: binary, status: 11, error: "caution: filename not matched:  missing\n" },
]) {
  test(`unzip -p selection ${selection.args.join(" ")}`, async () => {
    const observed = readOnlyArchive(await fixture());
    assert.deepEqual(await execute("unzip", observed.fs, ["-p", "sample", ...selection.args]), {
      exitCode: selection.status, stdout: selection.body, stderr: selection.error,
    });
  });
}

test("unzip -p reports missing and empty archives without stdout", async () => {
  const missing = await execute("unzip", await fixture(), ["-p", "missing.zip"]);
  assert.equal(missing.exitCode, 9);
  assert.equal(missing.stdout.length, 0);
  assert.equal(missing.stderr, "");
  const empty = await execute("unzip", await fixture(await archiveBytes([])), ["-p", "sample.zip"]);
  assert.deepEqual(empty, { exitCode: 1, stdout: Buffer.alloc(0), stderr: "warning [sample.zip]:  zipfile is empty\n" });
});

test("unzip -p streams symlink targets as bytes without extraction-target restrictions", async () => {
  const input = [{ name: "link", body: Buffer.from("/outside"), symlink: true }, { name: "binary-link", body: binary, symlink: true }];
  const observed = readOnlyArchive(await fixture(await archiveBytes(input)));
  const result = await execute("unzip", observed.fs, ["-p", "sample.zip"]);
  assert.deepEqual(result, { exitCode: 0, stdout: Buffer.concat(input.map(member => member.body)), stderr: "" });
});

test("unzip -p reports CRC failure after delivered bytes and never stages files", async () => {
  const bytes = await archiveBytes([members[1]!], entries => { entries[0] = { ...entries[0]!, crc32: 0 }; });
  const observed = readOnlyArchive(await fixture(bytes));
  const result = await execute("unzip", observed.fs, ["-p", "sample.zip"]);
  assert.equal(result.exitCode, 2);
  assert.deepEqual(result.stdout, binary);
  assert.match(result.stderr, /CRC32 mismatch/u);
});

for (const limits of [{ maxEntryBytes: 1 }, { maxTotalBytes: binary.length }, { maxArchiveBytes: 1 }, { maxMembers: 1 }, { maxPatternSteps: 1 }]) {
  test(`unzip -p retains archive limits ${JSON.stringify(limits)}`, async () => {
    const observed = readOnlyArchive(await fixture());
    const result = await execute("unzip", observed.fs, ["-p", "sample.zip"], { limits });
    assert.equal(result.exitCode, 2);
    assert.notEqual(result.stderr, "");
  });
}

test("unzip -p uses stdout accounting, never filesystem output accounting", async () => {
  const registerCleanup = () => {};
  bindFileOutputBudget({ registerCleanup }, () => { throw new Error("filesystem output charged"); });
  const result = await execute("unzip", readOnlyArchive(await fixture()).fs, ["-p", "sample.zip", "binary"], {}, { registerCleanup });
  assert.deepEqual(result, { exitCode: 0, stdout: binary, stderr: "" });
});

test("unzip -p respects Shell stdout limits and binary pipelines", async () => {
  const fs = await fixture();
  const shell = new Shell({ fs, cwd: "/work", limits: { maxOutputBytes: binary.length * 3 } }).use(archiveCommands()).use(standardCommands());
  try {
    const exact = await shell.exec("unzip -p sample.zip binary | cat > copied");
    assert.equal(exact.exitCode, 0, exact.stderr);
    assert.deepEqual(Buffer.from(await fs.readFile("/work/copied")), binary);
    await assert.rejects(shell.exec("unzip -p sample.zip folder/data"), ShellLimitError);
  } finally { await shell.dispose(); }
});

for (const reason of [false, 0, "", null]) {
  test(`unzip -p preserves cancellation ${JSON.stringify(reason)} at stdout`, async () => {
    const controller = new AbortController();
    let writes = 0;
    await assert.rejects(execute("unzip", readOnlyArchive(await fixture()).fs, ["-p", "sample.zip", "folder/data"], { limits: { chunkSize: 512 } }, {
      signal: controller.signal,
      stdout: { async write() { writes++; controller.abort(reason); } },
    }), error => Object.is(error, reason));
    assert.equal(writes, 1);
  });
}

for (const corruption of ["invalid deflate", "truncated deflate", "trailing deflate", "length", "entry limit", "aggregate limit"] as const) {
  test(`unzip -p enforces ${corruption} on actual decompression without publication`, async () => {
    const first = { name: "first", body: Buffer.alloc(512, 65) };
    const second = { name: "second", body: Buffer.alloc(512, 66) };
    const bytes = await archiveBytes(corruption === "aggregate limit" ? [first, second] : [second], entries => {
      const index = entries.length - 1;
      const entry = entries[index]!;
      assert.equal(entry.method, 8);
      if (corruption === "invalid deflate") entries[index] = { ...entry, data: Uint8Array.of(7) };
      else if (corruption === "truncated deflate") entries[index] = { ...entry, data: entry.data.subarray(0, entry.data.length - 1) };
      else if (corruption === "trailing deflate") entries[index] = { ...entry, data: Buffer.concat([entry.data, Uint8Array.of(0)]) };
      else entries[index] = { ...entry, size: 1 };
    });
    const result = await execute("unzip", readOnlyArchive(await fixture(bytes)).fs, ["-p", "sample.zip"], {
      limits: { chunkSize: 512, ...(corruption === "entry limit" ? { maxEntryBytes: 256 } : {}), ...(corruption === "aggregate limit" ? { maxTotalBytes: 700 } : {}) },
    });
    assert.equal(result.exitCode, 2);
    assert.notEqual(result.stderr, "");
    if (corruption === "aggregate limit") {
      assert.deepEqual(result.stdout, first.body);
      assert.match(result.stderr, /actual decompressed byte limit exceeded/u);
    }
    if (corruption === "entry limit") assert.equal(result.stdout.length, 0);
    if (corruption === "length") assert.match(result.stderr, /uncompressed size mismatch/u);
    if (corruption === "trailing deflate") assert.match(result.stderr, /trailing compressed data/u);
  });
}

test("unzip -p does not decode unselected CRC-corrupt members", async () => {
  const bytes = await archiveBytes([members[1]!, members[2]!], entries => { entries[1] = { ...entries[1]!, crc32: 0 }; });
  const result = await execute("unzip", readOnlyArchive(await fixture(bytes)).fs, ["-p", "sample.zip", "binary"]);
  assert.deepEqual(result, { exitCode: 0, stdout: binary, stderr: "" });
});

test("unzip -p still bounds comments even though they are not printed", async () => {
  const result = await execute("unzip", readOnlyArchive(await fixture()).fs, ["-p", "sample.zip"], { limits: { maxTextBytes: 1 } });
  assert.equal(result.exitCode, 2);
  assert.equal(result.stdout.length, 0);
  assert.match(result.stderr, /comment limit/u);
});

for (const streaming of [false, true]) {
  test(`unzip -p drains cancelled ${streaming ? "stream" : "buffered"} reads without extracting`, async () => {
    const fs = await fixture();
    const bytes = await fs.readFile("/work/sample.zip");
    let release!: () => void;
    let entered!: () => void;
    const held = new Promise<void>(resolve => { release = resolve; });
    const started = new Promise<void>(resolve => { entered = resolve; });
    let closed = false;
    const readOnly = readOnlyArchive(fs).fs;
    const overrides: Partial<FileSystem> = {
      capabilities: { streamingRead: streaming },
      async readFile() { entered(); await held; return bytes; },
      readStream() { return { async *[Symbol.asyncIterator]() { try { entered(); await held; yield bytes; } finally { closed = true; } } }; },
    };
    const delayed = new Proxy(readOnly, { get(target, property) {
      if (property === "capabilitiesFor") return undefined;
      return Object.hasOwn(overrides, property) ? Reflect.get(overrides, property) : Reflect.get(target, property);
    } });
    const controller = new AbortController();
    let settled = false;
    const pending = execute("unzip", delayed, ["-p", "sample.zip"], {}, { signal: controller.signal }).then(
      value => { settled = true; return value; }, error => { settled = true; return error; },
    );
    try {
      await started;
      controller.abort(false);
      await setImmediate();
      assert.equal(settled, false);
    } finally { release(); }
    assert.equal(await pending, false);
    if (streaming) assert.equal(closed, true);
  });
}

test("unzip -p awaits stdout backpressure and stops on a sink failure", async () => {
  let release!: () => void;
  let entered!: () => void;
  const held = new Promise<void>(resolve => { release = resolve; });
  const started = new Promise<void>(resolve => { entered = resolve; });
  let writes = 0;
  let settled = false;
  const failure = new Error("sink refused");
  const errors: unknown[] = [];
  const pending = execute("unzip", readOnlyArchive(await fixture()).fs, ["-p", "sample.zip", "folder/data"], { limits: { chunkSize: 512 } }, {
    stdout: { async write() { writes++; entered(); await held; throw failure; } },
    onInternalError(error) { errors.push(error); },
  }).then(result => { settled = true; return result; });
  try {
    await started;
    await setImmediate();
    assert.equal(writes, 1);
    assert.equal(settled, false);
  } finally { release(); }
  const result = await pending;
  assert.equal(result.exitCode, 2);
  assert.equal(writes, 1);
  assert.deepEqual(errors, [failure]);
});

test("unzip -p drains an enrolled stdout write before cancellation settles", async () => {
  let release!: () => void;
  let entered!: () => void;
  const held = new Promise<void>(resolve => { release = resolve; });
  const started = new Promise<void>(resolve => { entered = resolve; });
  const controller = new AbortController();
  const consumer = new AbortController();
  const cleanups: InvocationCleanup[] = [];
  let writes = 0;
  const write = async () => { writes++; entered(); await held; };
  let settled = false;
  const pending = execute("unzip", readOnlyArchive(await fixture()).fs, ["-p", "sample.zip", "folder/data"], { limits: { chunkSize: 512 } }, {
    signal: controller.signal,
    registerCleanup(cleanup) { cleanups.push(cleanup); },
    stdout: { write, ownedOutput: { consumerClosed: consumer.signal, write } },
  }).then(value => { settled = true; return value; }, error => { settled = true; return error; });
  try {
    await started;
    controller.abort(false);
    await setImmediate();
    assert.equal(settled, false, "owned output still writing");
  } finally { release(); }
  assert.equal(await pending, false);
  await Promise.all(cleanups.map(cleanup => cleanup()));
  assert.equal(writes, 1);
});

test("zip -q still charges file output and preserves an existing archive when the budget rejects publication", async () => {
  const fs = await fixture();
  const before = await fs.readFile("/work/sample.zip");
  const shell = new Shell({ fs, cwd: "/work", limits: { maxOutputBytes: 1 } }).use(archiveCommands());
  try {
    await assert.rejects(shell.exec("zip -q sample.zip binary"), ShellLimitError);
    assert.deepEqual(await fs.readFile("/work/sample.zip"), before);
    assert.deepEqual((await fs.readdir("/work")).map(entry => entry.name), ["binary", "folder", "sample.zip"]);
  } finally { await shell.dispose(); }
});

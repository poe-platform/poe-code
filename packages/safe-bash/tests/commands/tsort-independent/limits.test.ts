import assert from "node:assert/strict";
import test from "node:test";
import { setImmediate } from "node:timers/promises";
import { Shell } from "../../../src/shell/shell.js";
import { MemoryFileSystem } from "../../../src/fs/memory/index.js";
import { createCommandArguments, FsError, toByteSource, type ByteSource, type FileSystem } from "../../../src/contracts/index.js";
import { shellValueFromBytes } from "../../../src/contracts/value.js";
import { createTsortCommand, tsortCommands } from "../../../src/commands/tsort/index.js";
import { nativeCases } from "./native-cases.js";

for (const limit of ["maxInputBytes", "maxBufferedBytes"] as const) {
  test(`tsort ${limit} rejects an oversized input chunk before making an owned copy`, async context => {
    const chunk = new Uint8Array(512).fill(65);
    const from = Uint8Array.from;
    let copies = 0, pulls = 0, returns = 0;
    context.mock.method(Uint8Array, "from", function (source: Iterable<number> | ArrayLike<number>, map?: (value: number, index: number) => number, receiver?: unknown) {
      if (source === chunk) copies++;
      return Reflect.apply(from, Uint8Array, [source, map, receiver]) as Uint8Array;
    });
    const source: ByteSource = { [Symbol.asyncIterator]() { return {
      async next() { pulls++; return { done: false, value: chunk }; },
      async return() { returns++; return { done: true, value: undefined }; },
    }; } };
    const shell = new Shell({ fs: new MemoryFileSystem() }).use(tsortCommands({ limits: { [limit]: 256 } }));
    try {
      const result = await shell.exec("tsort", { stdin: source });
      assert.equal(result.exitCode, 1);
      assert.ok(result.stderr.includes("bytes limit exceeded"), result.stderr);
      assert.equal(result.stdoutBytes.length, 0);
      assert.deepEqual({ copies, pulls, returns }, { copies: 0, pulls: 1, returns: 1 });
    } finally { await shell.dispose(); }
  });
}

test("tsort NUL-collapsed identities consume one node but preserve physical token parity", async () => {
  const shell = new Shell({ fs: new MemoryFileSystem() }).use(tsortCommands({ limits: { maxNodes: 1, maxEdges: 1, maxTokens: 4 } }));
  try {
    const result = await shell.exec("tsort", { stdin: Buffer.from("a\0one a\0two a\0three a\0four") });
    assert.deepEqual({ status: result.exitCode, stdout: result.stdout, stderr: result.stderr }, { status: 0, stdout: "a\n", stderr: "" });
  } finally { await shell.dispose(); }
});

for (const raw of [false, true]) {
  test(`tsort actual invoke accounts UTF-8 argument bytes before filesystem admission, raw=${raw}`, async () => {
    const fs = new MemoryFileSystem();
    let calls = 0;
    fs.stat = async () => { calls++; assert.fail("over-budget argv must not admit a stat"); };
    const shell = new Shell({ fs }).use(tsortCommands({ limits: { maxArgumentBytes: 1 } }));
    shell.commands.register({ name: "forward", execute(context) {
      if (!raw) return context.invoke!("tsort", ["é"]);
      const values = createCommandArguments([shellValueFromBytes(Uint8Array.of(195, 169))]);
      return context.invoke!("tsort", values.args, { argumentValues: values });
    } });
    try {
      const result = await shell.exec("forward");
      assert.equal(result.exitCode, 1);
      assert.ok(result.stderr.includes("argument bytes limit exceeded"), result.stderr);
      assert.equal(calls, 0);
    } finally { await shell.dispose(); }
  });
}

test("tsort nonstreaming stat preflight refuses oversized files without reading", async () => {
  const fs: MemoryFileSystem & Pick<FileSystem, "capabilitiesFor"> = new MemoryFileSystem();
  await fs.writeFile("/input", new Uint8Array(301).fill(65));
  fs.capabilitiesFor = async () => ({ ...fs.capabilities, streamingRead: false });
  let reads = 0;
  fs.readFile = async () => { reads++; assert.fail("stat must reject before reading"); };
  fs.readStream = () => { assert.fail("streaming profile is unavailable"); };
  const shell = new Shell({ fs }).use(tsortCommands({ limits: { maxInputBytes: 300, maxBufferedBytes: 1024 } }));
  try {
    const result = await shell.exec("tsort input");
    assert.equal(result.exitCode, 1);
    assert.ok(result.stderr.includes("buffered input bytes limit exceeded"), result.stderr);
    assert.equal(reads, 0);
  } finally { await shell.dispose(); }
});

test("tsort nonstreaming read uses the smaller input/memory bound", async () => {
  const fs: MemoryFileSystem & Pick<FileSystem, "capabilitiesFor"> = new MemoryFileSystem();
  await fs.writeFile("/input", Buffer.from("b a"));
  fs.capabilitiesFor = async () => ({ ...fs.capabilities, streamingRead: false });
  const original = fs.readFile.bind(fs);
  const maximums: (number | undefined)[] = [];
  fs.readFile = async (path, options) => { maximums.push(options?.maxBytes); return original(path, options); };
  const shell = new Shell({ fs }).use(tsortCommands({ limits: { maxInputBytes: 300, maxBufferedBytes: 1024 } }));
  try {
    const result = await shell.exec("tsort input");
    assert.deepEqual({ status: result.exitCode, stdout: result.stdout, stderr: result.stderr }, { status: 0, stdout: "b\na\n", stderr: "" });
    assert.deepEqual(maximums, [300]);
    assert.equal(Buffer.from(await original("/input")).toString(), "b a");
  } finally { await shell.dispose(); }
});

for (const input of ["a b ", "a ", "a b b a "]) {
  test(`tsort explicit read-error policy precedes ordering and odd/cycle output: ${JSON.stringify(input)}`, async () => {
    let pulls = 0, returns = 0, settled = false;
    let release!: () => void, entered!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    const returning = new Promise<void>(resolve => { entered = resolve; });
    const source: ByteSource = { [Symbol.asyncIterator]() { return {
      async next() {
        if (++pulls === 1) return { done: false, value: Buffer.from(input) };
        throw new FsError("EIO");
      },
      async return() { returns++; entered(); await gate; return { done: true, value: undefined }; },
    }; } };
    const shell = new Shell({ fs: new MemoryFileSystem(), env: { LC_ALL: "C" } }).use(tsortCommands());
    const execution = shell.exec("tsort", { stdin: source });
    void execution.then(() => { settled = true; }, () => { settled = true; });
    try {
      await Promise.race([returning, execution.then(() => assert.fail("input cleanup must run"))]);
      for (let turn = 0; turn < 12; turn++) await setImmediate();
      assert.equal(settled, false);
      release();
      const result = await execution;
      assert.deepEqual({ status: result.exitCode, stdout: result.stdout, stderr: result.stderr }, {
        status: 1, stdout: "", stderr: "tsort: -: Input/output error\n",
      });
      assert.deepEqual({ pulls, returns }, { pulls: 2, returns: 1 });
    } finally { release(); await execution.catch(() => {}); await shell.dispose(); }
  });
}

test("tsort stdout byte cap keeps a complete empty node and refuses a multibyte next node", async () => {
  const shell = new Shell({ fs: new MemoryFileSystem() }).use(tsortCommands({ limits: { maxOutputBytes: 2 } }));
  try {
    const result = await shell.exec("tsort", { stdin: Uint8Array.of(0, 120, 32, 0, 121, 32, 195, 169, 32, 195, 169) });
    assert.equal(result.exitCode, 1);
    assert.equal(Buffer.from(result.stdoutBytes).toString("hex"), "0a");
    assert.ok(result.stderr.includes("output bytes limit exceeded"), result.stderr);
  } finally { await shell.dispose(); }
});

for (const includeHeader of [false, true]) {
  test(`tsort diagnostic cap stops before the next complete diagnostic, header=${includeHeader}`, async () => {
    const fixture = nativeCases.find(candidate => candidate.name === "bidirectional-triangle")!;
    const diagnostic = Buffer.from(fixture.stderrHex, "hex");
    const header = diagnostic.subarray(0, diagnostic.indexOf(10) + 1);
    const stdout: number[] = [], stderr: number[] = [];
    await assert.rejects(async () => createTsortCommand({ limits: { maxDiagnosticBytes: includeHeader ? header.length : header.length - 1 } }).execute({
      command: "tsort", args: [], cwd: "/", env: { LC_ALL: "C" }, fs: new MemoryFileSystem(),
      signal: new AbortController().signal, stdin: toByteSource(Buffer.from(fixture.inputHex, "hex")),
      stdout: { async write(chunk) { stdout.push(...chunk); } }, stderr: { async write(chunk) { stderr.push(...chunk); } },
    }), error => error instanceof AggregateError && error.errors.every(failure => failure instanceof Error && failure.message.includes("diagnostic bytes limit exceeded")));
    assert.deepEqual(stdout, []);
    assert.deepEqual(Buffer.from(stderr), includeHeader ? header : Buffer.alloc(0));
  });
}

test("tsort work budget covers lexical ordering after the entire input is consumed", async () => {
  let finalized = false;
  const input = Array.from({ length: 32 }, (_value, index) => `${index + 100} ${index + 100}`).join(" ");
  const source: ByteSource = { async *[Symbol.asyncIterator]() { try { yield Buffer.from(input); } finally { finalized = true; } } };
  const shell = new Shell({ fs: new MemoryFileSystem() }).use(tsortCommands({ limits: { maxWork: 1000 } }));
  try {
    const result = await shell.exec("tsort", { stdin: source });
    assert.equal(finalized, true);
    assert.equal(result.exitCode, 1);
    assert.equal(result.stdout, "");
    assert.ok(result.stderr.includes("work limit exceeded"), result.stderr);
  } finally { await shell.dispose(); }
});

test("tsort repeated cycle-breaking scans share the work budget", async () => {
  const shell = new Shell({ fs: new MemoryFileSystem() }).use(tsortCommands({ limits: { maxWork: 900 } }));
  try {
    const result = await shell.exec("tsort", { stdin: "a b b a ".repeat(30) });
    assert.equal(result.exitCode, 1);
    assert.ok(result.stderr.includes("work limit exceeded"), result.stderr);
    assert.ok(result.stderr.split("input contains a loop:").length > 2, result.stderr);
    assert.equal(result.stdout, "");
  } finally { await shell.dispose(); }
});

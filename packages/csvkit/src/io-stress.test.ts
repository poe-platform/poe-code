import { test } from "vitest";
import assert from "node:assert/strict";
import { execute, defaultLimits } from "./engine.js";
import { OwnedArguments } from "./argv.js";
import { utf8Codec } from "./codecs/utf8.js";
import type { CsvkitContext } from "./contracts.js";
import { LazyInput } from "./io/index.js";
import { Runtime } from "./runtime.js";
import { csvcut } from "./commands/csvcut.js";
import ioReference from "../../../docs/csvkit/io-reference.json" with { type: "json" };

function fixture(argv: readonly string[], overrides: Partial<CsvkitContext> = {}) {
  const cleanups: (() => Promise<void>)[] = [];
  let stdout = ""; let stderr = "";
  const context: CsvkitContext = {
    argv: new OwnedArguments(argv.map(value => new TextEncoder().encode(value)), defaultLimits), cwd: "/work",
    fs: { readFile: async () => { assert.fail("unexpected file read"); }, writeFile: async () => { assert.fail("unexpected file write"); } },
    stdin: (async function* () {})(), stdinIsDefault: true,
    stdout: { write: async bytes => { stdout += new TextDecoder().decode(bytes); } },
    stderr: { write: async bytes => { stderr += new TextDecoder().decode(bytes); } },
    terminal: { stdinIsTTY: false, stdoutIsTTY: false, stderrIsTTY: false, columns: 80, lines: 24 },
    env: {}, codecs: [utf8Codec], compression: [], databases: [],
    locale: { profile: "C", timezone: "UTC", formatNumber: () => { assert.fail("unexpected formatting"); } },
    clock: { now: () => 0 }, limits: defaultLimits, signal: new AbortController().signal,
    registerCleanup: cleanup => { cleanups.push(cleanup); }, ...overrides
  };
  return { context, cleanups, result: () => ({ stdout, stderr }) };
}

test("IO stress: positional file opening stays lazy through help and parser errors", async () => {
  for (const argv of [["missing.csv", "--help"], ["missing.csv", "--unknown"]]) {
    let reads = 0;
    const f = fixture(argv, { fs: {
      readFile: async () => { reads++; throw new Error("missing"); },
      readStream: () => { reads++; assert.fail("lazy input must not acquire"); },
      writeFile: async () => { assert.fail("unexpected write"); }
    } });
    assert.equal(await execute("csvcut", f.context), argv[1] === "--help" ? 0 : 2);
    await Promise.all(f.cleanups.map(cleanup => cleanup()));
    assert.equal(reads, 0);
  }
});

test("IO stress: producer finalization cannot overwrite retained Buffer views", async () => {
  const backing = Buffer.from("__a,b\nx,y\n__");
  const source = (async function* () {
    try { yield backing.subarray(2, 6); yield backing.subarray(6, 10); }
    finally { backing.fill(33); }
  })();
  const f = fixture([], { stdin: source });
  assert.equal(await execute("csvcut", f.context), 0);
  assert.deepEqual(f.result(), { stdout: "a,b\nx,y\n", stderr: "" });
  assert.equal(backing.toString(), "!".repeat(backing.length));
});

test("IO stress: stdin provenance does not manufacture terminal waiting messages", async () => {
  for (const stdinIsDefault of [true, false]) {
    const f = fixture([], { stdinIsDefault, stdin: (async function* () { yield new TextEncoder().encode("a\nx\n"); })() });
    assert.equal(await execute("csvcut", f.context), 0);
    assert.deepEqual(f.result(), { stdout: "a\nx\n", stderr: "" });
  }
});

test("IO stress: cancellation during backpressure preserves only admitted stdout", async () => {
  const controller = new AbortController();
  let ready!: () => void; let release!: () => void;
  const admitted = new Promise<void>(resolve => { ready = resolve; });
  const blocked = new Promise<void>(resolve => { release = resolve; });
  let output = ""; let writes = 0; let returned = 0;
  const f = fixture([], {
    signal: controller.signal,
    stdin: (async function* () { try { yield new TextEncoder().encode("a\nx\ny\n"); } finally { returned++; } })(),
    stdout: { write: async bytes => { writes++; output += new TextDecoder().decode(bytes); ready(); await blocked; } }
  });
  const execution = execute("csvcut", f.context);
  const rejection = assert.rejects(execution, reason => reason === false);
  await admitted;
  controller.abort(false);
  await Promise.all(f.cleanups.map(cleanup => cleanup()));
  assert.equal(writes, 1);
  release();
  await rejection;
  assert.equal(output, "a\n");
  assert.equal(returned, 1);
  assert.deepEqual(f.result(), { stdout: "", stderr: "" });
});

test("IO stress: each named csvstack source reopens through the injected filesystem", async () => {
  const reads: string[] = [];
  const f = fixture(["./a.csv", "./a.csv"], { fs: {
    readFile: async path => { reads.push(path); return new TextEncoder().encode("a\nx\n"); },
    writeFile: async () => { assert.fail("unexpected write"); }
  } });
  assert.equal(await execute("csvstack", f.context), 0);
  assert.deepEqual(reads, ["/work/a.csv", "/work/a.csv", "/work/a.csv", "/work/a.csv"]);
  assert.deepEqual(f.result(), { stdout: "a\nx\nx\n", stderr: "" });
});

test("IO stress: named-file physical CSV lines strip NUL and translate embedded CR/LF", async () => {
  const f = fixture(["data.csv"], { fs: {
    readFile: async () => new TextEncoder().encode('a,b\r\n"x\0\ry\r\nz",q\r'),
    writeFile: async () => { assert.fail("unexpected write"); }
  } });
  assert.equal(await execute("csvcut", f.context), 0);
  assert.deepEqual(f.result(), { stdout: 'a,b\n"x\ny\nz",q\n', stderr: "" });
});

test("IO stress: borrowed stdin retains NUL while named-file iteration strips it", async () => {
  const f = fixture(["-"], { stdin: (async function* () { yield new TextEncoder().encode("a,b\nx\0,y\n"); })() });
  assert.equal(await execute("csvcut", f.context), 0);
  assert.deepEqual(f.result(), { stdout: "a,b\nx\0,y\n", stderr: "" });
});

test("IO stress: named stream acquisition follows cleanup enrollment and shares delayed return", async () => {
  let nextStarted!: () => void; let finishNext!: () => void; let finishReturn!: () => void;
  const started = new Promise<void>(resolve => { nextStarted = resolve; });
  const pendingNext = new Promise<void>(resolve => { finishNext = resolve; });
  const pendingReturn = new Promise<void>(resolve => { finishReturn = resolve; });
  let returns = 0;
  const controller = new AbortController();
  const f = fixture(["data.csv"], { signal: controller.signal, fs: {
    readFile: async () => { assert.fail("stream-capable FS must not bulk-read"); },
    readStream: (path, options) => {
      assert.equal(path, "/work/data.csv");
      assert.equal(options.signal, controller.signal);
      assert.ok(f.cleanups.length, "cleanup enrollment precedes acquisition");
      return { [Symbol.asyncIterator]: () => ({
        next: async () => { nextStarted(); await pendingNext; return { done: true, value: undefined }; },
        return: async () => { returns++; finishNext(); await pendingReturn; return { done: true, value: undefined }; }
      }) };
    },
    writeFile: async () => { assert.fail("unexpected write"); }
  } });
  let settled = false;
  const execution = execute("csvcut", f.context);
  const rejection = assert.rejects(execution, reason => reason === false).then(() => { settled = true; });
  await started;
  controller.abort(false);
  const closing = Promise.all(f.cleanups.map(cleanup => cleanup()));
  await Promise.resolve(); await Promise.resolve();
  assert.equal(settled, false);
  finishReturn();
  await closing; await rejection;
  await Promise.all(f.cleanups.map(cleanup => cleanup()));
  assert.equal(returns, 1);
  assert.deepEqual(f.result(), { stdout: "", stderr: "" });
});

test("IO stress: split CRLF and UTF-8 fragments retain the shared line/read cursor", async () => {
  const encoded = new TextEncoder().encode("a\0\r\né\rZ\n");
  let opened = 0;
  const file = new LazyInput("data.csv", () => {
    opened++;
    return (async function* () { for (const byte of encoded) yield Uint8Array.of(byte); })();
  }, utf8Codec, "utf-8", new AbortController().signal, () => {}, () => {});
  assert.equal(opened, 0);
  assert.equal(await file.nextLine(), "a\n");
  assert.equal(await file.read(), "é\nZ\n");
  assert.equal(await file.nextLine(), null);
  assert.equal(opened, 1);
  await file.close();
  await file.close();
});

test("IO stress: early named CSV reader return closes its producer before invocation end", async () => {
  let returned = 0;
  const f = fixture([], { fs: {
    readFile: async () => { assert.fail("unexpected bulk read"); },
    readStream: () => (async function* () {
      try { yield new TextEncoder().encode("a,b\n"); yield new TextEncoder().encode("x,y\n"); }
      finally { returned++; }
    })(),
    writeFile: async () => { assert.fail("unexpected write"); }
  } });
  const runtime = new Runtime(f.context, csvcut, {});
  const records = runtime.records("data.csv");
  assert.deepEqual((await records.next()).value?.cells, ["a", "b"]);
  await records.return(undefined);
  const beforeInvocationClose = returned;
  await runtime.close();
  assert.equal(beforeInvocationClose, 1);
  assert.equal(returned, 1);
});

test("IO stress: closed text input rejects read and iteration even after EOF", async () => {
  const file = new LazyInput("data.csv", () => (async function* () { yield new TextEncoder().encode("a\n"); })(),
    utf8Codec, "utf-8", new AbortController().signal, () => {}, () => {});
  assert.equal(await file.read(), "a\n");
  await file.close();
  await assert.rejects(file.read(), /I\/O operation on closed file/);
  await assert.rejects(file.nextLine(), /I\/O operation on closed file/);
});

test("IO stress: borrowed stdin physical iteration splits LF and preserves bare CR", async () => {
  const file = new LazyInput("<stdin>", () => (async function* () {
    yield new TextEncoder().encode("a\0\r\nb\0\rc\0\n");
  })(), utf8Codec, "utf-8", new AbortController().signal, () => {}, () => {}, true);
  assert.equal(file.readStarted, false);
  assert.equal(await file.nextLine(), "a\0\r\n");
  assert.equal(file.readStarted, true);
  assert.equal(await file.nextLine(), "b\0\rc\0\n");
  assert.equal(await file.nextLine(), null);
  await file.close();
});

test("IO stress: reaching empty stdin EOF permits reference stream reconfiguration", async () => {
  const file = new LazyInput("<stdin>", () => (async function* () {})(),
    utf8Codec, "utf-8", new AbortController().signal, () => {}, () => {}, true);
  assert.equal(await file.read(), "");
  assert.equal(file.readStarted, false);
  await file.close();
});

test("IO stress: reading nonempty stdin through EOF permits reference stream reconfiguration", async () => {
  const file = new LazyInput("<stdin>", () => (async function* () { yield new TextEncoder().encode("a\nb\n"); })(),
    utf8Codec, "utf-8", new AbortController().signal, () => {}, () => {}, true);
  assert.equal(await file.read(), "a\nb\n");
  assert.equal(file.readStarted, false);
  await file.close();
});

test("IO stress: a late input failure retains the completed CSV header and data rows", async () => {
  const failure = new Error("late stream failure");
  let returned = 0;
  const f = fixture([], { stdin: (async function* () {
    try { yield new TextEncoder().encode("a,b\n"); yield new TextEncoder().encode("x,y\n"); throw failure; }
    finally { returned++; }
  })() });
  await assert.rejects(execute("csvcut", f.context), reason => reason === failure);
  assert.deepEqual(f.result(), { stdout: "a,b\nx,y\n", stderr: "" });
  assert.equal(returned, 1);
});

test("IO stress: named CSV parse failure survives a failing producer return", async () => {
  let returns = 0;
  const cleanupFailure = new Error("producer close failed");
  const f = fixture(["-z", "1", "data.csv"], { fs: {
    readFile: async () => { assert.fail("unexpected bulk read"); },
    readStream: () => ({ [Symbol.asyncIterator]: () => ({
      next: async () => ({ done: false as const, value: new TextEncoder().encode("long\n") }),
      return: async () => { returns++; throw cleanupFailure; }
    }) }),
    writeFile: async () => { assert.fail("unexpected write"); }
  } });
  assert.equal(await execute("csvcut", f.context), 1);
  assert.deepEqual(f.result(), { stdout: "", stderr: "FieldSizeLimitError: CSV contains a field longer than the maximum length of 1 characters on line 1. Try raising the maximum with the field_size_limit parameter, or try setting quoting=csv.QUOTE_NONE.\n" });
  await Promise.all(f.cleanups.map(cleanup => cleanup()));
  assert.equal(returns, 1);
});

test("IO stress: early named reader closure still reports producer close failure after success", async () => {
  const cleanupFailure = new Error("producer close failed");
  const f = fixture([], { fs: {
    readFile: async () => { assert.fail("unexpected bulk read"); },
    readStream: () => ({ [Symbol.asyncIterator]: () => ({
      next: async () => ({ done: false as const, value: new TextEncoder().encode("a\n") }),
      return: async () => { throw cleanupFailure; }
    }) }),
    writeFile: async () => { assert.fail("unexpected write"); }
  } });
  const runtime = new Runtime(f.context, csvcut, {});
  const reader = runtime.records("data.csv");
  assert.deepEqual((await reader.next()).value?.cells, ["a"]);
  await assert.rejects(reader.return(undefined), reason => reason === cleanupFailure);
  await assert.rejects(runtime.close());
});

for (const [index, item] of ioReference.cases.entries()) {
  test(`IO stress frozen native differential ${index}: ${item.command}`, async () => {
    const files = item.files as Record<string, string>;
    const f = fixture(item.argv, {
      stdin: (async function* () { yield new TextEncoder().encode(item.stdin); })(),
      fs: {
        readFile: async path => {
          const name = path.slice("/work/".length);
          assert.ok(Object.hasOwn(files, name), `unexpected VFS path ${path}`);
          return new TextEncoder().encode(files[name]);
        },
        writeFile: async () => { assert.fail("unexpected write"); }
      }
    });
    assert.deepEqual({ status: await execute(item.command, f.context), ...f.result() },
      { status: item.status, stdout: item.stdout, stderr: item.stderr });
    await Promise.all(f.cleanups.map(cleanup => cleanup()));
  });
}

import assert from "node:assert/strict";
import test from "node:test";
import { FsError, type ByteSource, type FileSystem } from "../../../src/contracts/index.js";
import { createMemoryFileSystem } from "../../../src/fs/memory/index.js";
import { createTableTextCommands } from "../../../src/commands/table-text/index.js";
import { fixture, runTable } from "./helpers.js";

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>(done => { resolve = done; });
  return { promise, resolve };
}

function proxyFs(base: FileSystem, methods: Partial<FileSystem>): FileSystem {
  return new Proxy(base, { get(target, key) {
    const value = key in methods ? Reflect.get(methods, key) : Reflect.get(target, key);
    return typeof value === "function" ? value.bind(key in methods ? methods : target) : value;
  } });
}

for (const command of ["paste", "comm", "join"] as const) {
  test(`${command}: invalid bytes survive one-byte chunks`, async () => {
    const input = command === "join" ? Buffer.from([97, 32, 255, 128, 10]) : Buffer.from([97, 255, 128, 10]);
    const specimen = { ...fixture(command, command === "paste" ? ["-"] : ["-", "right"], { right: "a other\n" }), stdinHex: input.toString("hex") };
    const result = await runTable(specimen, {}, {}, 1);
    assert.equal(result.exitCode, 0, result.stderr);
    assert.ok(result.stdoutHex.includes("ff80"));
  });

  test(`${command}: caller cancellation is exact, including errno-shaped reasons`, async () => {
    const controller = new AbortController(), reason = new FsError("ENOENT", { message: "caller stopped" });
    controller.abort(reason);
    await assert.rejects(runTable(fixture(command, ["-", "right"], { right: "a x\n" }), {}, { signal: controller.signal }), error => error === reason);
  });

  test(`${command}: pending reads cancel and close with no unhandled rejection`, async () => {
    const started = deferred(), controller = new AbortController(), reason = new Error("cancel pending input");
    let returned = false;
    const stdin: ByteSource = { [Symbol.asyncIterator]() { return {
      async next() { started.resolve(); await new Promise(() => {}); return { done: true, value: undefined } as const; },
      async return() { returned = true; throw new Error("cleanup rejection must be observed"); },
    }; } };
    const running = runTable(fixture(command, command === "paste" ? ["-"] : ["-", "right"], { right: "a x\n" }), {}, { stdin, signal: controller.signal });
    const rejected = assert.rejects(running, error => error === reason);
    await started.promise; controller.abort(reason); await rejected;
    await new Promise<void>(resolve => setImmediate(resolve));
    assert.equal(returned, true);
  });

  test(`${command}: producer exceptions retain failure and cleanup`, async () => {
    let returned = false;
    const failure = new Error("injected producer failure");
    const reported: unknown[] = [];
    const stdin = (async function* () { try { throw failure; yield new Uint8Array(); } finally { returned = true; } })();
    const result = await runTable(fixture(command, command === "paste" ? ["-"] : ["-", "right"], { right: "a x\n" }), {}, { stdin, onInternalError(error) { reported.push(error); } });
    assert.equal(result.exitCode, 1); assert.equal(result.stderr, `${command}: internal error\n`); assert.equal(returned, true);
    assert.equal(reported.length, 1);
    assert.equal(reported[0], failure);
  });

  test(`${command}: UTF-8 locale accepts byte ordering`, async () => {
    const result = await runTable(fixture(command, ["left", "right"], { left: "a x\n", right: "a y\n" }), {}, { env: { LC_ALL: "en_US.UTF-8" } });
    assert.equal(result.exitCode, 0, result.stderr);
  });
}

for (const [label, limits, specimen] of [
  ["input", { maxInputBytes: 3 }, fixture("paste", [], {}, "abcd\n")],
  ["chunk", { maxChunkBytes: 3 }, fixture("paste", [], {}, "abcd\n")],
  ["record", { maxRecordBytes: 3 }, fixture("paste", [], {}, "abcd\n")],
  ["output", { maxOutputBytes: 3 }, fixture("paste", [], {}, "abcd\n")],
  ["file", { maxFiles: 1 }, fixture("paste", ["left", "right"], { left: "a\n", right: "b\n" })],
  ["field", { maxFields: 2 }, fixture("join", ["left", "right"], { left: "a b c\n", right: "a x\n" })],
  ["argument", { maxArgumentBytes: 2 }, fixture("paste", ["--serial"])],
  ["join group byte", { maxGroupBytes: 4 }, fixture("join", ["left", "right"], { left: "a one\na two\n", right: "a x\n" })],
  ["join group record", { maxGroupRecords: 2 }, fixture("join", ["left", "right"], { left: "a one\na two\n", right: "a x\n" })],
] as const) {
  test(`bounded ${label} quota fails explicitly`, async () => {
    const result = await runTable(specimen, { limits });
    assert.equal(result.exitCode, 1); assert.match(result.stderr, new RegExp(`${label} limit`));
  });
}

test("invalid limits fail at plugin construction", () => {
  for (const value of [0, -1, NaN, 1.5, Number.MAX_SAFE_INTEGER + 1]) assert.throws(() => createTableTextCommands({ limits: { maxSteps: value } }), RangeError);
});

test("paste shares one stdin cursor and owns returned chunk bytes", async () => {
  const bytes = Buffer.from("a\nb\n");
  const stdin = (async function* () { yield bytes; bytes.fill(120); yield Buffer.from("c\nd\n"); })();
  const result = await runTable(fixture("paste", ["-", "-"]), {}, { stdin });
  assert.equal(result.stdoutHex, Buffer.from("a\tb\nc\td\n").toString("hex"));
});

for (const command of ["paste", "comm", "join"] as const) {
  test(`${command}: records retain Buffer fragments after producer reuse`, async () => {
    const fragment = Buffer.from("a ");
    const stdin = (async function* () {
      yield fragment;
      fragment.fill(120);
      yield Buffer.from("value\n");
    })();
    const right = command === "join" ? "a other\n" : "a value\n";
    const expected = command === "paste" ? "a value\n" : command === "comm" ? "\t\ta value\n" : "a value other\n";
    const result = await runTable(fixture(command, command === "paste" ? ["-"] : ["-", "right"], { right }), {}, { stdin });
    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal(result.stdoutHex, Buffer.from(expected).toString("hex"));
    assert.equal(fragment.toString(), "xx");
  });
}

test("empty chunk producers cannot starve cancellation or step limits", async () => {
  const controller = new AbortController(), reason = new Error("stop empty chunks");
  let closed = false;
  const stdin = (async function* () { try { while (true) yield new Uint8Array(); } finally { closed = true; } })();
  const running = runTable(fixture("paste", []), {}, { stdin, signal: controller.signal });
  const rejected = assert.rejects(running, error => error === reason);
  const timer = setTimeout(() => controller.abort(reason), 10);
  try { await rejected; } finally { clearTimeout(timer); }
  assert.equal(closed, true);
  const result = await runTable(fixture("paste", []), { limits: { maxSteps: 10 } }, { stdin: (async function* () { while (true) yield new Uint8Array(); })() });
  assert.match(result.stderr, /step limit/u);
});

test("paste awaits writes before reading another record", async () => {
  const blocked = deferred(), release = deferred();
  let reads = 0;
  const stdin = (async function* () { for (let index = 0; index < 3; index++) { reads++; yield Buffer.from(`${index}\n`); } })();
  const writes: Uint8Array[] = [];
  const running = runTable(fixture("paste", []), {}, { stdin, stdout: { async write(bytes) { writes.push(bytes.slice()); if (writes.length === 1) { blocked.resolve(); await release.promise; } } } });
  await blocked.promise; assert.equal(reads, 1); release.resolve(); await running;
  assert.equal(Buffer.concat(writes).toString(), "0\n1\n2\n");
});

test("blocked output cancellation propagates and releases its VFS input signal", async () => {
  const base = createMemoryFileSystem(), blocked = deferred(), controller = new AbortController(), reason = new Error("stop output");
  let sourceSignal: AbortSignal | undefined, closed = false;
  const fs = proxyFs(base, { readStream(_path, options) {
    sourceSignal = options?.signal;
    return (async function* () { try { yield Buffer.from("a\nb\n"); await new Promise(() => {}); } finally { closed = true; } })();
  } });
  const running = runTable(fixture("paste", ["file"], { file: "a\nb\n" }), {}, { fs, signal: controller.signal, stdout: { async write() { blocked.resolve(); await new Promise(() => {}); } } });
  const rejected = assert.rejects(running, error => error === reason);
  await blocked.promise; controller.abort(reason); await rejected;
  assert.equal(sourceSignal?.aborted, true);
  await new Promise<void>(resolve => setImmediate(resolve)); assert.equal(closed, true);
});

test("downstream EPIPE cancels owned VFS transfer without aborting caller", async () => {
  const base = createMemoryFileSystem(), controller = new AbortController();
  let sourceSignal: AbortSignal | undefined, closed = false;
  const fs = proxyFs(base, { readStream(_path, options) {
    sourceSignal = options?.signal;
    return (async function* () { try { yield Buffer.from("first\nsecond\n"); } finally { closed = true; } })();
  } });
  const result = await runTable(fixture("paste", ["file"], { file: "first\nsecond\n" }), {}, { fs, signal: controller.signal, stdout: { async write() { throw new FsError("EPIPE"); } } });
  assert.equal(result.exitCode, 1); assert.match(result.stderr, /EPIPE/u); assert.equal(controller.signal.aborted, false); assert.equal(sourceSignal?.aborted, true); assert.equal(closed, true);
});

test("bounded readFile fallback passes a limit and signal", async () => {
  const base = createMemoryFileSystem();
  const fs = proxyFs(base, { readFile: async (path, options) => {
    assert.equal(options?.maxBytes, 32); assert.ok(options.signal); return base.readFile(path, options);
  } });
  const fallback = new Proxy(fs, { get(target, key) { return key === "readStream" ? undefined : Reflect.get(target, key); } });
  const result = await runTable(fixture("paste", ["file"], { file: "value\n" }), { limits: { maxChunkBytes: 32 } }, { fs: fallback });
  assert.equal(result.stdoutHex, Buffer.from("value\n").toString("hex"));
});

test("join Cartesian expansion is bounded by output quota", async () => {
  const result = await runTable(fixture("join", ["left", "right"], { left: "a one\na two\na three\n", right: "a x\na y\na z\n" }), { limits: { maxOutputBytes: 20 } });
  assert.equal(result.exitCode, 1); assert.match(result.stderr, /output limit/u); assert.ok(result.stdoutHex.length <= 40);
});

test("suppressed comm output still enforces bounded work", async () => {
  const result = await runTable(fixture("comm", ["-123", "left", "right"], { left: "a\n".repeat(40), right: "a\n".repeat(40) }), { limits: { maxSteps: 20 } });
  assert.equal(result.exitCode, 1); assert.match(result.stderr, /step limit/u); assert.equal(result.stdoutHex, "");
});


test("join rejects tiny duplicate records before consuming an unbounded group", async () => {
  let reads = 0, closed = false;
  const stdin = (async function* () {
    try { for (; reads < 10000; reads++) yield Buffer.from("a\n"); }
    finally { closed = true; }
  })();
  const result = await runTable(fixture("join", ["-", "right"], { right: "a\n" }), {}, { stdin });
  assert.equal(result.exitCode, 1);
  assert.match(result.stderr, /join group record limit/u);
  assert.ok(reads < 10000);
  assert.equal(closed, true);
  assert.equal(result.stdoutHex, "");
});

test("join defaults bound retained duplicate bytes", async () => {
  const result = await runTable(fixture("join", ["left", "right"], {
    left: (`a ${"x".repeat(1024 * 1024)}\n`).repeat(9), right: "a y\n",
  }));
  assert.equal(result.exitCode, 1);
  assert.match(result.stderr, /join group byte limit/u);
  assert.equal(result.stdoutHex, "");
});

for (const args of [[], ["-o", "0,1.2,2.2"], ["-o", "auto"], ["-e", "missing", "-o", "1.3,2.3"], ["-i"]]) {
  test(`join admits the complete matched output before writes: ${args.join(" ")}`, async () => {
    const specimen = fixture("join", [...args, "left", "right"], {
      left: "a one\na two\n", right: "a x\na yyyy\n",
    });
    const complete = await runTable(specimen);
    assert.equal(complete.exitCode, 0, complete.stderr);
    const size = complete.stdoutHex.length / 2;
    const rejected = await runTable(specimen, { limits: { maxOutputBytes: size - 1 } });
    assert.equal(rejected.exitCode, 1);
    assert.match(rejected.stderr, /output limit/u);
    assert.equal(rejected.stdoutHex, "");
    const admitted = await runTable(specimen, { limits: { maxOutputBytes: size } });
    assert.equal(admitted.exitCode, 0, admitted.stderr);
    assert.equal(admitted.stdoutHex, complete.stdoutHex);
  });
}


test("join projection handles varying fields, folded keys and already emitted output", async () => {
  const specimen = fixture("join", ["--header", "-i", "left", "right"], {
    left: "key left\na one two\nA three\nb four\n",
    right: "key right\nA x y\na z\nb five\n",
  });
  const complete = await runTable(specimen);
  assert.equal(complete.exitCode, 0, complete.stderr);
  const expected = "key left right\na one two x y\na one two z\nA three x y\nA three z\nb four five\n";
  assert.equal(complete.stdoutHex, Buffer.from(expected).toString("hex"));
  const admitted = await runTable(specimen, { limits: { maxOutputBytes: Buffer.byteLength(expected) } });
  assert.equal(admitted.exitCode, 0, admitted.stderr);
  assert.equal(admitted.stdoutHex, complete.stdoutHex);
  const rejected = await runTable(specimen, { limits: { maxOutputBytes: Buffer.byteLength(expected) - 1 } });
  assert.equal(rejected.exitCode, 1);
  assert.match(rejected.stderr, /output limit/u);
  assert.equal(rejected.stdoutHex, Buffer.from(expected.slice(0, expected.lastIndexOf("b four"))).toString("hex"));
});

for (const [list, expected] of [["│", "a│b│c│d\n"], ["😀│", "a😀b│c😀d\n"], ["│\\t\\0\\\\", "a│b\tcd\\e│f\n"], ["\\😀", "a😀b😀c😀d\n"]] as const) {
  test(`paste preserves Unicode delimiter list ${list}`, async () => {
    const input = list.includes("0") ? "a\nb\nc\nd\ne\nf\n" : "a\nb\nc\nd\n";
    const result = await runTable(fixture("paste", ["-s", "-d", list, "-"], {}, input));
    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal(result.stdoutHex, Buffer.from(expected).toString("hex"));
  });
}
for (const args of [["-s", "-"], ["-sz", "-"], ["-s", "empty", "full", "empty"]]) {
  test(`paste skips empty serial input ${args.join(" ")}`, async () => {
    const result = await runTable(fixture("paste", args, { empty: "", full: "x\n" }));
    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal(result.stdoutHex, args.includes("full") ? "780a" : "");
  });
}
for (const command of ["join", "comm"] as const) {
  for (const variable of ["LANG", "LC_ALL", "LC_COLLATE", "LC_CTYPE"]) {
    for (const locale of ["C.UTF-8", "en_US.UTF-8"]) {
      test(`${command} accepts ${variable}=${locale}`, async () => {
        const result = await runTable(fixture(command, ["left", "right"], { left: "a\n", right: "a\n" }), {}, { env: { [variable]: locale } });
        assert.equal(result.exitCode, 0, result.stderr);
        assert.equal(result.stdoutHex, Buffer.from(command === "join" ? "a\n" : "\t\ta\n").toString("hex"));
      });
    }
  }
}

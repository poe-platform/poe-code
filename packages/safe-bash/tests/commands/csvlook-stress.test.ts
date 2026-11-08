import test from "node:test";
import assert from "node:assert/strict";
import { Shell } from "../../src/shell/index.js";
import { MemoryFileSystem } from "../../src/fs/memory/index.js";
import { csvkitCommands, createCsvkitCommands, type CsvkitCommandsOptions } from "../../src/commands/csvkit/index.js";
import { utf8Codec } from "poe-code/csvkit";
import reference from "../../../../docs/csvkit/csvlook-reference.json" with { type: "json" };
import rowLimitReference from "../../../../docs/csvkit/csvlook-rowlimit-reference.json" with { type: "json" };

const options: CsvkitCommandsOptions = {
  codecs: [utf8Codec],
  locale: { profile: "C", timezone: "UTC", formatNumber: () => { throw new Error("unqualified locale"); } },
  clock: { now: () => 0 },
  terminal: { stdinIsTTY: false, stdoutIsTTY: false, stderrIsTTY: false, columns: 80, lines: 24 },
  columnWarnings: { utilsPath: reference.warningUtilsPath }
};

for (const [index, capture] of [...reference.cases, ...rowLimitReference.cases].entries()) {
  test(`csvlook stress: frozen executable capture ${index} ${capture.argv.join(" ")}`, async () => {
    const shell = new Shell({ fs: new MemoryFileSystem() }).use(csvkitCommands(options));
    try {
      const command = "csvlook " + capture.argv.map(argument => "'" + argument.replaceAll("'", "'\\''") + "'").join(" ");
      const result = await shell.exec(command, { stdin: capture.stdin });
      assert.deepEqual({ stdout: result.stdout, stderr: result.stderr, status: result.exitCode },
        { stdout: capture.stdout, stderr: capture.stderr, status: capture.status });
    } finally { await shell.dispose(); }
  });
}

test("csvlook stress: mutable fragmented multiline producer is owned and finalized once", async () => {
  const capture = reference.cases[50]!;
  const shell = new Shell({ fs: new MemoryFileSystem() }).use(csvkitCommands(options));
  let closed = 0;
  const stdin = { async *[Symbol.asyncIterator]() {
    const bytes = new Uint8Array(1);
    try {
      for (const byte of new TextEncoder().encode(capture.stdin)) {
        bytes[0] = byte;
        yield bytes;
        bytes[0] = 120;
      }
    } finally { closed++; }
  } };
  try {
    const result = await shell.exec("csvlook -y0 -l", { stdin });
    assert.deepEqual({ stdout: result.stdout, stderr: result.stderr, status: result.exitCode },
      { stdout: capture.stdout, stderr: capture.stderr, status: capture.status });
    assert.equal(closed, 1);
  } finally { await shell.dispose(); }
});

test("csvlook stress: named VFS input, CSV pipeline and redirected Markdown preserve source", async () => {
  const fs = new MemoryFileSystem();
  const capture = reference.cases[50]!;
  await fs.mkdir("/work");
  await fs.writeFile("/work/source.csv", new TextEncoder().encode(capture.stdin));
  const shell = new Shell({ fs, cwd: "/work" }).use(csvkitCommands(options));
  try {
    for (const command of ["csvlook -y0 -l source.csv > table.md", "csvcut source.csv | csvlook -y0 -l > table.md"]) {
      const result = await shell.exec(command);
      assert.deepEqual({ stdout: result.stdout, stderr: result.stderr, status: result.exitCode }, { stdout: "", stderr: "", status: 0 });
      assert.equal(new TextDecoder().decode(await fs.readFile("/work/table.md")), capture.stdout);
      assert.equal(new TextDecoder().decode(await fs.readFile("/work/source.csv")), capture.stdin);
    }
  } finally { await shell.dispose(); }
});

test("csvlook stress: rendering awaits stdout backpressure before the next row", async () => {
  const shell = new Shell({ fs: new MemoryFileSystem() }).use(csvkitCommands(options));
  const capture = reference.cases[16]!;
  let entered!: () => void;
  const started = new Promise<void>(resolve => { entered = resolve; });
  let release!: () => void;
  const blocked = new Promise<void>(resolve => { release = resolve; });
  const writes: Uint8Array[] = [];
  try {
    const execution = shell.exec("csvlook -y0", { stdin: capture.stdin,
      stdout: { async write(bytes) { writes.push(Uint8Array.from(bytes)); if (writes.length === 1) { entered(); await blocked; } } }
    });
    await started;
    assert.equal(writes.length, 1);
    release();
    const result = await execution;
    assert.equal(result.exitCode, 0);
    assert.equal(result.stderr, "");
    assert.equal(new TextDecoder().decode(Uint8Array.from(writes.flatMap(bytes => Array.from(bytes)))), capture.stdout);
  } finally { release(); await shell.dispose(); }
});

test("csvlook stress: cancellation while rendering preserves the caller reason and closes input", async () => {
  const shell = new Shell({ fs: new MemoryFileSystem() }).use(csvkitCommands(options));
  const controller = new AbortController();
  let entered!: () => void;
  const started = new Promise<void>(resolve => { entered = resolve; });
  let release!: () => void;
  const blocked = new Promise<void>(resolve => { release = resolve; });
  let closed = 0;
  let writes = 0;
  try {
    const execution = shell.exec("csvlook -y0", {
      signal: controller.signal,
      stdin: { async *[Symbol.asyncIterator]() { try { yield new TextEncoder().encode("a\nx\ny\n"); } finally { closed++; } } },
      stdout: { async write() { writes++; entered(); await blocked; } }
    });
    await started;
    controller.abort(false);
    await assert.rejects(execution, reason => reason === false);
    assert.equal(writes, 1);
    assert.equal(closed, 1);
  } finally { release(); await shell.dispose(); }
});

test("csvlook stress: consumer closure drains cooperative pending input with idempotent registered cleanup", async () => {
  const definition = createCsvkitCommands(options).find(command => command.name === "csvlook")!;
  const consumer = new AbortController();
  const caller = new AbortController();
  const reason = { consumerClosed: true };
  let admitted!: () => void;
  const reading = new Promise<void>(resolve => { admitted = resolve; });
  let release!: () => void;
  const pending = new Promise<IteratorResult<Uint8Array>>(resolve => { release = () => resolve({ done: true, value: undefined }); });
  let reads = 0;
  let returned = 0;
  const cleanups: (() => void | Promise<void>)[] = [];
  const write = async () => { assert.fail("loading must complete before table output"); };
  const execution = Promise.resolve(definition.execute({
    command: "csvlook", args: ["-y0"], cwd: "/", env: {},
    fs: new MemoryFileSystem(), signal: caller.signal,
    stdin: { [Symbol.asyncIterator]: () => ({
      async next() {
        assert.ok(cleanups.length > 0, "cleanup must be registered before input acquisition");
        if (reads++ === 0) return { done: false, value: new TextEncoder().encode("a\nx\n") };
        admitted(); return pending;
      },
      async return() { returned++; release(); return { done: true as const, value: undefined }; }
    }) },
    stdout: { write, ownedOutput: { consumerClosed: consumer.signal, write } },
    stderr: { async write() { assert.fail("consumer closure must not emit diagnostics"); } },
    registerCleanup: cleanup => { cleanups.push(cleanup); }
  }));
  const rejected = assert.rejects(execution, caught => caught === reason);
  try {
    await reading;
    consumer.abort(reason);
    await rejected;
    assert.equal(returned, 1);
    assert.equal(caller.signal.aborted, false);
    await Promise.all(cleanups.flatMap(cleanup => [cleanup(), cleanup()]));
    assert.equal(returned, 1);
  } finally { release(); await rejected; await Promise.all(cleanups.map(cleanup => cleanup())); }
});

test("csvlook stress: headerless zero rows do not read stdin when sniffing and skip-lines are disabled", async () => {
  const shell = new Shell({ fs: new MemoryFileSystem() }).use(csvkitCommands(options));
  try {
    const result = await shell.exec("csvlook -y0 -H --max-rows 0 -z1", {
      stdin: { async *[Symbol.asyncIterator]() { assert.fail("zero headerless rows must not read stdin"); yield new Uint8Array(); } }
    });
    assert.deepEqual({ stdout: result.stdout, stderr: result.stderr, status: result.exitCode },
      { stdout: "||\n|  |\n", stderr: "", status: 0 });
  } finally { await shell.dispose(); }
});

test("csvlook stress: headerless zero rows still consume skip-lines before avoiding CSV field validation", async () => {
  const shell = new Shell({ fs: new MemoryFileSystem() }).use(csvkitCommands(options));
  let acquired = 0;
  let returned = 0;
  try {
    const result = await shell.exec("csvlook -y0 -H --max-rows 0 -K1 -z1", {
      stdin: { async *[Symbol.asyncIterator]() {
        acquired++;
        try { yield new TextEncoder().encode("skip\naa,bb\n"); }
        finally { returned++; }
      } }
    });
    assert.deepEqual({ stdout: result.stdout, stderr: result.stderr, status: result.exitCode },
      { stdout: "||\n|  |\n", stderr: "", status: 0 });
    assert.equal(acquired, 1, "CPython reference consumes readline for skip-lines even with row_limit=0");
    assert.equal(returned, 1);
  } finally { await shell.dispose(); }
});

test("csvlook stress: headerless zero rows preserve missing named-file open errors", async () => {
  const shell = new Shell({ fs: new MemoryFileSystem() }).use(csvkitCommands(options));
  try {
    const result = await shell.exec("csvlook -y0 -H --max-rows 0 /out/csvlook-uncreated-input.csv");
    assert.deepEqual({ stdout: result.stdout, stderr: result.stderr, status: result.exitCode },
      { stdout: "", stderr: "FileNotFoundError: [Errno 2] No such file or directory: '/out/csvlook-uncreated-input.csv'\n", status: 1 });
  } finally { await shell.dispose(); }
});

test("csvlook stress: headerless zero rows open valid named input without reading its contents", async () => {
  const fs = new MemoryFileSystem();
  await fs.writeFile("/source.csv", new TextEncoder().encode("aa,bb\n"));
  fs.readFile = async () => { assert.fail("zero headerless rows must not buffer a named file"); };
  fs.readStream = () => { assert.fail("zero headerless rows must not read a named file stream"); };
  const shell = new Shell({ fs }).use(csvkitCommands(options));
  try {
    const result = await shell.exec("csvlook -y0 -H --max-rows 0 -z1 /source.csv");
    assert.deepEqual({ stdout: result.stdout, stderr: result.stderr, status: result.exitCode },
      { stdout: "||\n|  |\n", stderr: "", status: 0 });
  } finally { await shell.dispose(); }
});

test("csvlook stress: cancellation drains an admitted delayed file open and closes it once", async () => {
  const fs = new MemoryFileSystem();
  await fs.writeFile("/source.csv", new TextEncoder().encode("aa,bb\n"));
  const originalOpen = fs.open.bind(fs);
  const caller = new AbortController();
  const cleanups: (() => void | Promise<void>)[] = [];
  let admitted!: () => void;
  const opening = new Promise<void>(resolve => { admitted = resolve; });
  let release!: () => void;
  const pending = new Promise<void>(resolve => { release = resolve; });
  let closed = 0;
  fs.open = async (path, settings) => {
    assert.ok(cleanups.length > 0, "file-open cleanup must be enrolled before admission");
    admitted();
    await pending;
    // A trusted host may complete admitted work after cancellation. Returning
    // this resource must still enroll its close before invocation settlement.
    const descriptor = await originalOpen(path, { access: settings.access, creation: "never" });
    const close = descriptor.close.bind(descriptor);
    descriptor.close = async () => { closed++; await close(); };
    return descriptor;
  };
  const definition = createCsvkitCommands(options).find(command => command.name === "csvlook")!;
  const execution = Promise.resolve(definition.execute({
    command: "csvlook", args: ["-y0", "-H", "--max-rows", "0", "/source.csv"], cwd: "/", env: {},
    fs, signal: caller.signal,
    stdin: { async *[Symbol.asyncIterator]() { assert.fail("named zero-row open must not read stdin"); yield new Uint8Array(); } },
    stdout: { async write() { assert.fail("canceled open must not print a table"); } },
    stderr: { async write() { assert.fail("canceled open must not emit diagnostics"); } },
    registerCleanup: cleanup => { cleanups.push(cleanup); }
  }));
  const rejected = assert.rejects(execution, caught => caught === false);
  try {
    await opening;
    caller.abort(false);
    let drained = false;
    const draining = Promise.all(cleanups.map(cleanup => cleanup())).then(() => { drained = true; });
    await Promise.resolve();
    assert.equal(drained, false, "cleanup must await admitted open completion");
    release();
    await draining;
    await rejected;
    assert.equal(closed, 1);
    await Promise.all(cleanups.flatMap(cleanup => [cleanup(), cleanup()]));
    assert.equal(closed, 1);
  } finally { release(); await rejected; await Promise.all(cleanups.map(cleanup => cleanup())); }
});

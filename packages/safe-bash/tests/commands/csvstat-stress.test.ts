import test from "node:test";
import assert from "node:assert/strict";
import { utf8Codec } from "@poe-code/csvkit";
import { Shell } from "../../src/shell/index.js";
import { MemoryFileSystem } from "../../src/fs/memory/index.js";
import { createCsvkitCommands, csvkitCommands, type CsvkitCommandsOptions } from "../../src/commands/csvkit/index.js";

const options: CsvkitCommandsOptions = {
  codecs: [utf8Codec],
  locale: { profile: "C", timezone: "UTC", formatNumber: (value, locale, format) => {
    assert.equal(locale, "C");
    assert.ok(format === "%.3f" || format === "%.0f");
    return Number(value).toFixed(format === "%.0f" ? 0 : 3);
  } },
  clock: { now: () => 0 },
  terminal: { stdinIsTTY: false, stdoutIsTTY: false, stderrIsTTY: false, columns: 80, lines: 24 }
};

// Independently measured released csvkit 2.2.0 / frozen CPython 3.14.2 oracle.
const cases = [
  ["--count", "", "-1\n"],
  ["--count", "a\n\n2\n3,extra\n", "3\n"],
  ["--count --csv --json -c 999", "a\n2\n", "1\n"],
  ["--names --mean --sum --csv --count --zero -c 999", "a,b\n2,3\n", "  0: a\n  1: b\n"],
  ["--freq --freq-count 0", "x\nb\na\nb\na\n\nc\n", '{ "b": 2, "a": 2, "None": 1, "c": 1 }\n'],
  ["--freq --freq-count -1", "x\na\nb\n", "{  }\n"],
  ["--sum -G --decimal-format %.0f", "x\n20\n30\n", "5\n"],
  ["--min", "x\na\nb\n", "None\n"],
  ["--stdev", "x\n2\n", "None\n"],
  ["--unique", "x\n\nnull\n2\n", "2\n"],
  ["--type --zero", "a,b\n2,text\n", "  1. a: Number\n  2. b: Text\n"],
  ["--json", "a\n", '[{"column_id": 1, "column_name": "a", "type": "Boolean", "nulls": false, "nonnulls": 0, "unique": 0, "freq": []}]'],
  ["--csv", "a\n", "column_id,column_name,type,nulls,nonnulls,unique,min,max,sum,mean,median,stdev,len,maxprecision,freq\n1,a,Boolean,False,0,0,,,,,,,,,\n"],
  ["--freq", "x\n1.0\n1.00\n2.00\n", '{ "1.0": 2, "2.00": 1 }\n'],
  ["--sum", "x\ntrue\nfalse\n", "None\n"],
  ["--len", "x\n😀\na😀b\n", "3\n"],
  ["--min", "x\n2020-01-01\n2021-01-01\n", "2020-01-01\n"],
  ["--sum", "x\n1:00\n2:00\n", "0:03:00\n"],
  ["--unique", "x\n2020-01-01T00:00:00\n2020-01-01T00:00:00Z\n", "2\n"],
  ["--freq", "x\n2020-01-01T00:00:00\n2020-01-01T00:00:00Z\n", '{ "2020-01-01 00:00:00": 1, "2020-01-01 00:00:00+00:00": 1 }\n']
] as const;

for (const [args, stdin, stdout] of cases) {
  test(`csvstat stress oracle: ${args} (${JSON.stringify(stdin)})`, async () => {
    const shell = new Shell({ fs: new MemoryFileSystem() }).use(csvkitCommands(options));
    try {
      const result = await shell.exec(`csvstat -y 0 ${args}`, { stdin });
      assert.deepEqual({ stdout: result.stdout, stderr: result.stderr, status: result.exitCode }, { stdout, stderr: "", status: 0 });
    } finally { await shell.dispose(); }
  });
}

test("csvstat stress owns reusable producer chunks and returns input exactly once", async () => {
  let returned = 0;
  const stdin = { async *[Symbol.asyncIterator]() {
    const storage = new Uint8Array(32);
    try {
      for (const fragment of ["x\n", "20\n", "30\n"]) {
        const bytes = new TextEncoder().encode(fragment);
        storage.set(bytes);
        yield storage.subarray(0, bytes.length);
        storage.fill(120);
      }
    } finally { returned++; storage.fill(121); }
  } };
  const shell = new Shell({ fs: new MemoryFileSystem() }).use(csvkitCommands(options));
  try {
    const result = await shell.exec("csvstat -y 0 --sum", { stdin });
    assert.deepEqual({ stdout: result.stdout, stderr: result.stderr, status: result.exitCode }, { stdout: "50\n", stderr: "", status: 0 });
    assert.equal(returned, 1);
  } finally { await shell.dispose(); }
});

for (const operation of ["count", "sum"] as const) {
  test(`csvstat stress ${operation} cancellation closes cooperative pending named input`, async () => {
  const fs = new MemoryFileSystem();
  const controller = new AbortController();
  let started!: () => void;
  const admitted = new Promise<void>(resolve => { started = resolve; });
  let release!: () => void;
  const pending = new Promise<IteratorResult<Uint8Array>>(resolve => {
    release = () => { resolve({ done: true, value: undefined }); };
  });
  let returned = 0;
  Object.assign(fs, { readStream(path: string) {
    assert.equal(path, "/pending.csv");
    return { [Symbol.asyncIterator]: () => ({
      next: () => { started(); return pending; },
      return: async () => { returned++; release(); return { done: true, value: undefined }; }
    }) };
  } });
  const shell = new Shell({ fs }).use(csvkitCommands(options));
  const execution = shell.exec(`csvstat -y 0 --${operation} pending.csv`, { signal: controller.signal });
  const rejection = assert.rejects(execution, reason => reason === false);
  try {
    await admitted;
    controller.abort(false);
    await rejection;
    assert.equal(returned, 1);
  } finally { release(); await rejection; await shell.dispose(); }
  });
}

test("csvstat stress registered count awaits sink backpressure and idempotent cleanup", async () => {
  const definition = createCsvkitCommands(options).find(command => command.name === "csvstat")!;
  const cleanups: (() => void | Promise<void>)[] = [];
  let returned = 0;
  let writes = 0;
  let read = false;
  let admitted!: () => void;
  const writing = new Promise<void>(resolve => { admitted = resolve; });
  let release!: () => void;
  const pendingWrite = new Promise<void>(resolve => { release = resolve; });
  let settled = false;
  const execution = Promise.resolve(definition.execute({
    command: "csvstat", args: ["--count", "-y0"], cwd: "/", env: {},
    fs: new MemoryFileSystem(), signal: new AbortController().signal,
    stdin: { [Symbol.asyncIterator]: () => ({
      async next() {
        assert.ok(cleanups.length > 0, "cleanup must precede acquisition");
        if (read) return { done: true as const, value: undefined };
        read = true;
        return { done: false as const, value: new TextEncoder().encode("a\nx\ny\n") };
      },
      async return() { returned++; return { done: true as const, value: undefined }; }
    }) },
    stdout: { async write(bytes) {
      writes++;
      assert.equal(new TextDecoder().decode(bytes), "2\n");
      admitted();
      await pendingWrite;
    } },
    stderr: { async write() { assert.fail("unexpected stderr"); } },
    registerCleanup: cleanup => { cleanups.push(cleanup); }
  })).then(result => { settled = true; return result; });
  try {
    await writing;
    await new Promise<void>(resolve => { setImmediate(resolve); });
    assert.equal(settled, false);
    assert.equal(writes, 1);
    release();
    assert.deepEqual(await execution, { exitCode: 0 });
    await Promise.all(cleanups.flatMap(cleanup => [cleanup(), cleanup()]));
    assert.equal(returned, 1);
  } finally { release(); await execution; await Promise.all(cleanups.map(cleanup => cleanup())); }
});

test("csvstat stress formatter failure remains observable instead of omitted statistic", async () => {
  const failure = new Error("injected formatter failed");
  const definition = createCsvkitCommands({ ...options,
    locale: { ...options.locale, formatNumber: () => { throw failure; } }
  }).find(command => command.name === "csvstat")!;
  const cleanups: (() => void | Promise<void>)[] = [];
  try {
    await assert.rejects(Promise.resolve(definition.execute({
      command: "csvstat", args: ["-y0", "--sum"], cwd: "/", env: {},
      fs: new MemoryFileSystem(), signal: new AbortController().signal,
      stdin: { async *[Symbol.asyncIterator]() { yield new TextEncoder().encode("x\n2\n3\n"); } },
      stdout: { async write() { assert.fail("failed formatter must not output a statistic"); } },
      stderr: { async write() { assert.fail("host failure must propagate"); } },
      registerCleanup: cleanup => { cleanups.push(cleanup); }
    })), reason => reason === failure);
  } finally { await Promise.all(cleanups.map(cleanup => cleanup())); }
});

test("csvstat stress formatter cancellation keeps original falsy abort reason", async () => {
  const controller = new AbortController();
  const shell = new Shell({ fs: new MemoryFileSystem() }).use(csvkitCommands({ ...options,
    locale: { ...options.locale, formatNumber: () => { controller.abort(false); return "5.000"; } }
  }));
  try {
    await assert.rejects(shell.exec("csvstat -y0 --sum", { stdin: "x\n2\n3\n", signal: controller.signal }), reason => reason === false);
  } finally { await shell.dispose(); }
});

test("csvstat stress named typed report pipeline redirects exact bytes without changing source", async () => {
  const fs = new MemoryFileSystem();
  const source = new TextEncoder().encode("n,label\r\n20,a\r\n30,b\r\n");
  await fs.writeFile("/input.csv", source);
  const shell = new Shell({ fs }).use(csvkitCommands(options));
  try {
    const result = await shell.exec("csvstat -y0 --csv -c n /input.csv | csvcut -c column_name,type,sum > /summary.csv");
    assert.deepEqual({ stdout: result.stdout, stderr: result.stderr, status: result.exitCode }, { stdout: "", stderr: "", status: 0 });
    assert.deepEqual(await fs.readFile("/summary.csv"), new TextEncoder().encode("column_name,type,sum\nn,Number,50\n"));
    assert.deepEqual(await fs.readFile("/input.csv"), source);
  } finally { await shell.dispose(); }
});

test("csvstat stress typed Decimal admission budget closes input and emits no statistic", async () => {
  let returned = 0;
  const stdin = { async *[Symbol.asyncIterator]() {
    try { yield new TextEncoder().encode("n\n20\n30\n"); }
    finally { returned++; }
  } };
  const shell = new Shell({ fs: new MemoryFileSystem() }).use(csvkitCommands({ ...options,
    limits: { maxDecimalDigits: 1 }
  }));
  try {
    const result = await shell.exec("csvstat -y0 --sum", { stdin });
    assert.deepEqual({ stdout: result.stdout, stderr: result.stderr, status: result.exitCode }, {
      stdout: "", stderr: "csvkit: unsupported or unqualified: Decimal admission budget exceeded\n", status: 78
    });
    assert.equal(returned, 1);
  } finally { await shell.dispose(); }
});

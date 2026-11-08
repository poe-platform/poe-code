import test from "node:test";
import assert from "node:assert/strict";
import { utf8Codec } from "poe-code/csvkit";
import { Shell } from "../../src/shell/index.js";
import { MemoryFileSystem } from "../../src/fs/memory/index.js";
import { csvkitCommands, type CsvkitCommandsOptions } from "../../src/commands/csvkit/index.js";

const options: CsvkitCommandsOptions = {
  codecs: [utf8Codec],
  locale: { profile: "C", timezone: "UTC", formatNumber: () => { throw new Error("unexpected locale call"); } },
  clock: { now: () => 0 },
  terminal: { stdinIsTTY: false, stdoutIsTTY: false, stderrIsTTY: false, columns: 80, lines: 24 },
  columnWarnings: { suppressWarnings: true }
};
const encode = (text: string): Uint8Array => new TextEncoder().encode(text);

test("csvjoin user regression: equal-valued empty columns follow Agate value-based selected-column omission", async () => {
  const fs = new MemoryFileSystem();
  await fs.writeFile("/a", encode("v,k\n"));
  await fs.writeFile("/b", encode("w,j\n"));
  const shell = new Shell({ fs }).use(csvkitCommands(options));
  try {
    const result = await shell.exec("csvjoin -I -y0 -c 2,2 a b");
    assert.deepEqual([result.exitCode, result.stdout, result.stderr], [0, "v,k,j\n", ""]);
  } finally { await shell.dispose(); }
});

test("csvjoin user regression: a repeated stdin input reports the original closed-file error", async () => {
  const fs = new MemoryFileSystem();
  const shell = new Shell({ fs }).use(csvkitCommands(options));
  let opened = 0;
  let closed = 0;
  try {
    const result = await shell.exec("csvjoin -I -y0 - -", {
      stdin: { async *[Symbol.asyncIterator]() { opened++; try { yield encode("k,v\nx,A\n"); } finally { closed++; } } }
    });
    assert.deepEqual([result.exitCode, result.stdout, result.stderr], [1, "", "ValueError: I/O operation on closed file.\n"]);
    assert.equal(opened, 1);
    assert.equal(closed, 1);
  } finally { await shell.dispose(); }
});

test("csvjoin user: quoted filenames and option terminator survive literal command dispatch and redirection", async () => {
  const fs = new MemoryFileSystem();
  const files = { "/left space.csv": "k,a\nx,A\n", "/--right": "k,b\nx,B\n" };
  for (const [path, data] of Object.entries(files)) await fs.writeFile(path, encode(data));
  const shell = new Shell({ fs }).use(csvkitCommands(options));
  try {
    const result = await shell.exec("csvjoin -Iy0 -ck -- 'left space.csv' --right > 'joined table.csv'");
    assert.deepEqual([result.exitCode, result.stdout, result.stderr], [0, "", ""]);
    assert.equal(new TextDecoder().decode(await fs.readFile("/joined table.csv")), "k,a,b\nx,A,B\n");
    for (const [path, data] of Object.entries(files)) assert.deepEqual(await fs.readFile(path), encode(data));
  } finally { await shell.dispose(); }
});

test("csvjoin user: stdin may be joined to an explicitly named file", async () => {
  const fs = new MemoryFileSystem();
  await fs.writeFile("/b", encode("other,b\nx,B\n"));
  const shell = new Shell({ fs }).use(csvkitCommands(options));
  let closed = 0;
  try {
    const result = await shell.exec("csvjoin -I -y0 -c k,other - b", {
      stdin: { async *[Symbol.asyncIterator]() { try { yield encode("k,a\nx,A\n"); } finally { closed++; } } }
    });
    assert.deepEqual([result.exitCode, result.stdout, result.stderr], [0, "k,a,b\nx,A,B\n", ""]);
    assert.equal(closed, 1);
  } finally { await shell.dispose(); }
});

test("csvjoin user: version and argument rejection do not acquire input streams", async () => {
  const fs = new MemoryFileSystem();
  Object.assign(fs, { readStream() { assert.fail("early argv result must not open files"); } });
  const shell = new Shell({ fs }).use(csvkitCommands(options));
  const stdin = { async *[Symbol.asyncIterator]() { assert.fail("early argv result must not open stdin"); yield encode(""); } };
  try {
    const version = await shell.exec("csvjoin -V absent.csv", { stdin });
    assert.deepEqual([version.exitCode, version.stdout, version.stderr], [0, "csvjoin 2.2.0\n", ""]);
    const rejected = await shell.exec("csvjoin --left absent.csv", { stdin });
    assert.deepEqual([rejected.exitCode, rejected.stdout, rejected.stderr], [2, "", "usage: csvjoin [-h] [-d DELIMITER] [-t] [-q QUOTECHAR] [-u {0,1,2,3,4,5}] [-b]\n               [-p ESCAPECHAR] [-z FIELD_SIZE_LIMIT] [-e ENCODING] [-L LOCALE]\n               [-S] [--blanks] [--null-value NULL_VALUES [NULL_VALUES ...]]\n               [--date-format DATE_FORMAT] [--datetime-format DATETIME_FORMAT]\n               [--no-leading-zeroes] [-H] [-K SKIP_LINES] [-v] [-l]\n               [--add-bom] [--zero] [-V] [-c COLUMNS] [--outer] [--left]\n               [--right] [-y SNIFF_LIMIT] [-I]\n               [FILE ...]\ncsvjoin: error: You must provide join column names when performing an outer join.\n"]);
  } finally { await shell.dispose(); }
});

test("csvjoin user: input materialization budget accumulates across named files before output", async () => {
  const fs = new MemoryFileSystem();
  await fs.writeFile("/a", encode("k,a\nx,A\n"));
  await fs.writeFile("/b", encode("k,b\nx,B\n"));
  const shell = new Shell({ fs }).use(csvkitCommands({ ...options, limits: { maxInputBytes: 10 } }));
  try {
    const result = await shell.exec("csvjoin -I -y0 -c k a b");
    assert.deepEqual([result.exitCode, result.stdout, result.stderr], [78, "", "csvkit: unsupported or unqualified: input byte budget exceeded\n"]);
    assert.deepEqual(await fs.readFile("/a"), encode("k,a\nx,A\n"));
    assert.deepEqual(await fs.readFile("/b"), encode("k,b\nx,B\n"));
  } finally { await shell.dispose(); }
});

test("csvjoin user: each awaited output write applies backpressure before the next row", async () => {
  const fs = new MemoryFileSystem();
  await fs.writeFile("/a", encode("n\n2\n3\n"));
  const shell = new Shell({ fs }).use(csvkitCommands(options));
  let enter!: () => void;
  const entered = new Promise<void>(resolve => { enter = resolve; });
  let release!: () => void;
  const waiting = new Promise<void>(resolve => { release = resolve; });
  const writes: string[] = [];
  const execution = shell.exec("csvjoin -y0 a", { stdout: { async write(bytes) {
    writes.push(new TextDecoder().decode(bytes));
    if (writes.length === 1) { enter(); await waiting; }
  } } });
  try {
    await Promise.race([entered, execution.then(() => { assert.fail("execution settled before its blocked write"); })]);
    assert.deepEqual(writes, ["n\n"]);
    release();
    const result = await execution;
    assert.deepEqual([result.exitCode, result.stdout, result.stderr], [0, "n\n2\n3\n", ""]);
    assert.deepEqual(writes, ["n\n", "2\n", "3\n"]);
  } finally { release(); await execution; await shell.dispose(); }
});

test("csvjoin user: cancellation between output rows preserves falsey reason and closes input once", async () => {
  const fs = new MemoryFileSystem();
  const shell = new Shell({ fs }).use(csvkitCommands(options));
  const controller = new AbortController();
  let closed = 0;
  const writes: string[] = [];
  try {
    await assert.rejects(shell.exec("csvjoin -y0", {
      signal: controller.signal,
      stdin: { async *[Symbol.asyncIterator]() { try { yield encode("n\n2\n3\n"); } finally { closed++; } } },
      stdout: { async write(bytes) { writes.push(new TextDecoder().decode(bytes)); controller.abort(0); } }
    }), reason => reason === 0);
    assert.equal(closed, 1);
    assert.deepEqual(writes, ["n\n"]);
  } finally { await shell.dispose(); }
});

test("csvjoin user: dispose drains the registered cooperative named source before settling", async () => {
  const fs = new MemoryFileSystem();
  let enter!: () => void;
  const entered = new Promise<void>(resolve => { enter = resolve; });
  let release!: () => void;
  const pending = new Promise<IteratorResult<Uint8Array>>(resolve => { release = () => { resolve({ done: true, value: undefined }); }; });
  let returned = 0;
  Object.assign(fs, { readStream(path: string) {
    assert.equal(path, "/pending");
    return { [Symbol.asyncIterator]: () => ({
      next: () => { enter(); return pending; },
      async return() { returned++; release(); return { done: true as const, value: undefined }; }
    }) };
  } });
  const shell = new Shell({ fs }).use(csvkitCommands(options));
  const execution = shell.exec("csvjoin -I -y0 pending");
  const rejection = assert.rejects(execution);
  try {
    await entered;
    await shell.dispose();
    assert.equal(returned, 1);
    await rejection;
  } finally { release(); await rejection; await shell.dispose(); }
});

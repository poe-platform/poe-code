import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { CommandRegistry, FsError, type ByteSource, type FileSystem } from "../../../src/contracts/index.js";
import { createMemoryFileSystem } from "../../../src/fs/memory/index.js";
import { columnCommands, createColumnCommand, createColumnCommands } from "../../../src/commands/column/index.js";
import { run, shell } from "./helpers.js";

const paddingProfile = JSON.parse(readFileSync(new URL("./padding-evolution/profile-deltas.json", import.meta.url), "utf8")) as { behavior: { stdout: string } };

test("table whitespace, ragged rows, blanks and unterminated final record", async () => {
  const result = await run(["-t"], " a\tb \n\nlong z\nsingle\n\t \nlast q");
  assert.equal(result.stdout, paddingProfile.behavior.stdout);
  assert.equal(result.stderr, "");
  assert.equal(result.exitCode, 0);
});

test("explicit separator is a character set, preserving all empty fields", async () => {
  const result = await run(["-ts:,", "-o", "|"], "a:b,c\n1::3\n:tail:\n");
  assert.equal(result.stdout, "a|b   |c\n1|    |3\n |tail|\n");
  assert.equal(result.exitCode, 0);
});

test("long options, attached arguments and empty output separator", async () => {
  const result = await run(["--table", "--input-separator=:;", "--output-separator=", "--output-width=2"], "a:1\nlong;2\n");
  assert.equal(result.stdout, "a   1\nlong2\n");
  assert.equal(result.exitCode, 0);
});

for (const [args, expected] of [
  [["-c16"], "a\td\nb\te\nc\n"],
  [["-xc16"], "a\tb\nc\td\ne\n"],
  [["--fillrows", "--output-width", "8"], "a\nb\nc\nd\ne\n"],
] as const) test(`fill direction ${args.join(" ")}`, async () => {
  const result = await run(args, "a\nb\nc\nd\ne\n");
  assert.equal(result.stdout, expected);
  assert.equal(result.exitCode, 0);
});

test("fill does not truncate; eight-column boundaries and blanks", async () => {
  assert.equal((await run(["-c1"], "abcdefghij\na\n")).stdout, "abcdefghij\na\n");
  assert.equal((await run(["-c32"], "12345678\na\n \n\t\n")).stdout, "12345678\ta\n");
});

test("deterministic UTF-8 widths independent of locale/COLUMNS", async () => {
  const result = await run(["-t"], "名 x\ne\u0301 y\n🙂 z\n", {}, { env: { LC_ALL: "not-a-locale", COLUMNS: "1" } });
  assert.equal(result.stdout, "名  x\ne\u0301   y\n🙂  z\n");
  assert.equal(result.exitCode, 0);
  assert.equal((await run([], "a\nb\n", {}, { env: { COLUMNS: "1" } })).stdout, "a\tb\n");
});

test("retained tabs expand at cell-local eight-column stops", async () => {
  assert.equal((await run(["-t", "-s:"], "a\tq:z\nxx:y\n")).stdout, "a       q  z\nxx         y\n");
  assert.equal((await run(["-c16"], "a\tq\nb\n")).stdout, "a       q\nb\n");
});

test("UTF-8 delimiter scalars and combining/wide range boundaries", async () => {
  const result = await run(["-t", "-s界", "-o·"], "a界甲\nlong界乙\n");
  assert.equal(result.stdout, "a   ·甲\nlong·乙\n");
  assert.equal((await run(["-t"], "\u0301 x\na y\n")).stdout, "\u0301   x\na  y\n");
});

test("multiple files share widths, keep record boundaries, continue open failures", async () => {
  const fs = createMemoryFileSystem();
  await fs.writeFile("/first", Buffer.from("a b"));
  await fs.writeFile("/last", Buffer.from("long c\n"));
  await fs.mkdir("/directory");
  const result = await run(["-t", "/first", "/missing", "/directory", "/last"], "", {}, { fs });
  assert.equal(result.stdout, "a     b\nlong  c\n");
  assert.equal(result.exitCode, 1);
  assert.match(result.stderr, /missing/);
  assert.match(result.stderr, /directory/);
});

test("repeated dash shares one stdin cursor and omitted stdin is empty", async () => {
  let acquisitions = 0;
  const stdin: ByteSource = { [Symbol.asyncIterator]() { acquisitions++; return (async function* () { yield Buffer.from("a b\n"); })(); } };
  const result = await run(["-t", "-", "-"], "", {}, { stdin });
  assert.equal(acquisitions, 1);
  assert.equal(result.stdout, "a  b\n");
  assert.equal((await run()).stdout, "");
});

test("VFS fallback readFile obeys signal/maxBytes and byte/chunk bounds", async () => {
  const base = createMemoryFileSystem();
  await base.writeFile("/data", Buffer.from("a b\n"));
  let calls = 0;
  const fs: FileSystem = new Proxy(base, { get(target, key) {
    if (key === "readStream") return undefined;
    if (key === "readFile") return async (path: string, options: { signal?: AbortSignal; maxBytes?: number }) => {
      calls++; assert.ok(options.signal); assert.equal(options.maxBytes, 7); return target.readFile(path, options);
    };
    const value: unknown = Reflect.get(target, key, target);
    return typeof value === "function" ? value.bind(target) : value;
  } });
  const result = await run(["-t", "/data"], "", { limits: { maxChunkBytes: 7 } }, { fs });
  assert.equal(result.stdout, "a  b\n");
  assert.equal(calls, 1);
});

test("literal dash-prefixed VFS file after --", async () => {
  const fs = createMemoryFileSystem();
  await fs.writeFile("/-input", Buffer.from("a b\n"));
  assert.equal((await run(["-t", "--", "-input"], "", {}, { fs })).stdout, "a  b\n");
});

test("plugin preflight, replacement and factory contracts", () => {
  const commands = new CommandRegistry([createColumnCommand()]);
  const host = { commands, use() {}, registerFileSystem() {} };
  const old = commands.get("column");
  assert.throws(() => columnCommands().setup(host), /already registered/);
  assert.equal(commands.get("column"), old);
  columnCommands({ replace: true }).setup(host);
  assert.notEqual(commands.get("column"), old);
  assert.deepEqual(createColumnCommands().map(command => command.name), ["column"]);
});

test("actual complex shell pipeline, redirects, variables and substitutions", async () => {
  const instance = shell();
  try {
    const result = await instance.exec("printf 'beta:2\\nalpha:1\\n' > /rows; sep='|'; cat /rows | sort | column -t -s: -o \"$sep\" > /table; printf '[%s]\\n' \"$(cat /table | head -n 1)\"; cat /table | cut -d '|' -f 2");
    assert.equal(result.exitCode, 0);
    assert.equal(result.stderr, "");
    assert.equal(result.stdout, "[alpha|1]\n1\n2\n");
    assert.equal((await instance.exec("cat /table")).stdout, "alpha|1\nbeta |2\n");
  } finally { await instance.dispose(); }
});

test("actual shell pipeline preserves downstream stdin and exit state", async () => {
  const instance = shell();
  try {
    const result = await instance.exec("printf 'a b\\nlong z\\n' | column -t | cat; column --json; printf 'status=%s\\n' \"$?\"");
    assert.equal(result.stdout, "a     b\nlong  z\nstatus=1\n");
    assert.match(result.stderr, /unsupported option/);
  } finally { await instance.dispose(); }
});

test("read errors are fatal before table publication", async () => {
  const stdin: ByteSource = (async function* () { yield Buffer.from("a b\n"); throw new FsError("EIO", { path: "/source" }); })();
  const result = await run(["-t"], "", {}, { stdin });
  assert.equal(result.exitCode, 1);
  assert.equal(result.stdout, "");
  assert.match(result.stderr, /source/);
});

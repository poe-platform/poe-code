import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { CommandRegistry, FsError, type ByteSource, type FileSystem } from "../../../src/contracts/index.js";
import { createMemoryFileSystem } from "../../../src/fs/memory/index.js";
import { columnCommands, createColumnCommand, createColumnCommands } from "../../../src/commands/column/index.js";
import { run, shell } from "./helpers.js";

const paddingProfile = JSON.parse(readFileSync(new URL("./padding-evolution/profile-deltas.json", import.meta.url), "utf8")) as { behavior: { stdout: string } };

test("JSON table output matches the reported bytes through a VFS file", async () => {
  const fs = createMemoryFileSystem();
  await fs.writeFile("/input", Buffer.from("a 1\n"));
  const result = await run(["-J", "-t", "-N", "letter,number", "input"], "", {}, { fs });
  assert.equal(result.exitCode, 0);
  assert.equal(result.stderr, "");
  assert.equal(result.stdout, '{\n   "table": [\n      {\n         "letter": "a",\n         "number": "1"\n      }\n   ]\n}\n');
});

test("JSON long options, escaping, ragged rows and custom table name", async () => {
  const result = await run(["--json", "--table-columns=NAME,N", "--table-name=demo", "-s:"], 'a"b:1\nsingle\n');
  assert.equal(result.exitCode, 0);
  assert.equal(result.stderr, "");
  assert.equal(result.stdout, '{\n   "demo": [\n      {\n         "name": "a\\"b",\n         "n": "1"\n      },\n      {\n         "name": "single",\n         "n": null\n      }\n   ]\n}\n');
});

test("JSON preserves tabs, null empty fields and ASCII name folding", async () => {
  const result = await run(["-JNÄ,EMPTY", "-nDEMO", "-s:"], "a\tb:\n");
  assert.equal(result.exitCode, 0);
  assert.deepEqual(JSON.parse(result.stdout), { demo: [{ "Ä": "a\tb", empty: null }] });
  assert.equal((await run(["-JNname"])).stdout, '{\n   "table": [\n\n   ]\n}\n');
});

test("JSON rejects unnamed data columns before publication", async () => {
  const result = await run(["-JNname"], "a b\n");
  assert.equal(result.exitCode, 1);
  assert.equal(result.stdout, "");
  assert.match(result.stderr, /name of the column 2 is required/);
});

test("JSON uses the shell pipeline and file redirection", async () => {
  const instance = shell();
  try {
    const result = await instance.exec("printf 'a 1\\n' | column -JNletter,number > /result; cat /result");
    assert.equal(result.exitCode, 0);
    assert.equal(result.stderr, "");
    assert.deepEqual(JSON.parse(result.stdout), { table: [{ letter: "a", number: "1" }] });
  } finally { await instance.dispose(); }
});

test("named text tables align headings and rows", async () => {
  const result = await run(["-tNNAME,N"], "a 1\n");
  assert.equal(result.exitCode, 0);
  assert.equal(result.stdout, "NAME  N\na     1\n");
});

test("JSON enforces output, field and work bounds", async () => {
  const bounded = await run(["-JNname"], "a\n", { limits: { maxOutputBytes: 16 } });
  assert.equal(bounded.exitCode, 1);
  assert.ok(bounded.stdoutBytes.length <= 16);
  assert.match(bounded.stderr, /output.*limit/);
  const fields = await run(["-JNone,two"], "a b\n", { limits: { maxFields: 1 } });
  assert.equal(fields.exitCode, 1);
  assert.equal(fields.stdout, "");
  const work = await run(["-JNname"], "a\n", { limits: { maxSteps: 1 } });
  assert.equal(work.exitCode, 1);
  assert.equal(work.stdout, "");
  assert.match(work.stderr, /work limit/);
});

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
    assert.match(result.stderr, /JSON output requires --table-columns/);
  } finally { await instance.dispose(); }
});

test("read errors are fatal before table publication", async () => {
  const stdin: ByteSource = (async function* () { yield Buffer.from("a b\n"); throw new FsError("EIO", { path: "/source" }); })();
  const result = await run(["-t"], "", {}, { stdin });
  assert.equal(result.exitCode, 1);
  assert.equal(result.stdout, "");
  assert.match(result.stderr, /source/);
});

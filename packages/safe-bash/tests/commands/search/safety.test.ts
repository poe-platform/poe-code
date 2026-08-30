import assert from "node:assert/strict";
import test from "node:test";
import { CommandRegistry, toByteSource, type ByteSource, type CommandContext } from "../../../src/contracts/index.js";
import { createSearchCommands, searchCommands, type SearchOptions } from "../../../src/commands/search/index.js";
import { makeFileSystem, native, virtual } from "./helpers.js";

test("plugin installs rg and rejects collisions without replacement", () => {
  assert.deepEqual(createSearchCommands().map(command => command.name), ["rg"]);
  const commands = new CommandRegistry(createSearchCommands());
  const host = { commands } as Parameters<ReturnType<typeof searchCommands>["setup"]>[0];
  assert.throws(() => searchCommands().setup(host), /already registered/u);
  searchCommands({ replace: true }).setup(host);
  assert.equal(commands.list().length, 1);
});

test("invalid options and regexes fail before stdin consumption or stdout", async () => {
  for (const args of [["--bad", "x"], ["-g", "[", "x"], ["[", "-"], ["(?=x)", "-"], ["(x)\\1", "-"], ["x\ny", "-"], ["-A-1", "x"], ["-nA1m1", "x"], ["--max-depth=129", "x"], ["-U", "x"], ["--color=always", "x"], ["--json=bad", "x"]]) {
    let consumed = false;
    const source = (async function* () { consumed = true; yield Buffer.from("x"); })();
    const result = await virtual({ args }, {}, { stdin: source });
    assert.equal(result.code, 2, args.join(" "));
    assert.equal(result.stdout.length, 0);
    assert(result.stderr.length > 0);
    assert.equal(consumed, false);
  }
});

test("native invalid syntax also returns two without output", async () => {
  for (const args of [["[", "-"], ["x\ny", "-"], ["-nA1m1", "x", "-"]]) {
    const expected = await native({ args, stdin: "x\n" });
    assert.equal(expected.code, 2); assert.equal(expected.stdout.length, 0); assert(expected.stderr.length > 0);
  }
});

test("no-match status is distinct from an error and quiet success wins prior errors", async () => {
  const files = { yes: "needle\n", no: "nothing\n" };
  for (const [args, code, output, errors] of [
    [["needle", "no"], 1, "", false],
    [["needle", "missing", "yes"], 2, "yes:needle\n", true],
    [["-q", "needle", "missing", "yes"], 0, "", true],
    [["--no-messages", "needle", "missing"], 2, "", false],
    [["--files", "empty"], 1, "", false],
  ] as const) {
    const result = await virtual({ args, files, directories: ["empty"] });
    assert.equal(result.code, code); assert.equal(result.stdout.toString(), output); assert.equal(result.stderr.length > 0, errors);
  }
});

test("metadata selects supplied empty stdin while default input and overrides remain explicit", async () => {
  const fixture = { args: ["needle"], files: { source: "needle\n" } };
  assert.equal((await virtual(fixture)).stdout.toString(), "source:needle\n");
  assert.equal((await virtual({ ...fixture, stdin: "" })).code, 1);
  assert.equal((await virtual(fixture, { defaultInput: "stdin" })).code, 1);
  assert.equal((await virtual({ ...fixture, stdin: "needle\n" }, { defaultInput: "cwd" })).stdout.toString(), "source:needle\n");
  assert.equal((await virtual({ ...fixture, args: ["needle", "-"] })).code, 1);
});

test("nested explicit roots respect virtual ancestor ignore files", async () => {
  const fixture = { args: ["--files", "sub"], files: { ".ignore": "*.log\n", "sub/a.log": "", "sub/b.ts": "" } };
  assert.equal((await virtual(fixture)).stdout.toString(), "sub/b.ts\n");
  assert.equal((await virtual({ ...fixture, args: ["--files", "--no-ignore-parent", "sub"] })).stdout.toString(), "sub/a.log\nsub/b.ts\n");
});

test("symlink loops and broken followed links are errors rather than infinite recursion", async () => {
  const fixture = { args: ["--files", "-L", "."], files: { "sub/leaf": "" }, links: { "sub/loop": "../sub", broken: "missing" } };
  const result = await virtual(fixture);
  assert.equal(result.code, 2);
  assert.match(result.stderr.toString(), /ENOENT/u);
  assert.match(result.stderr.toString(), /loop/u);
});

test("input, line, filesystem-entry and output quotas fail predictably", async () => {
  const cases: [SearchOptions, string[], string][] = [
    [{ maxLineBytes: 3 }, ["x", "-"], "xxxx\n"],
    [{ maxFileBytes: 3 }, ["x", "-"], "x\nx\n"],
    [{ maxOutputBytes: 3 }, ["x", "-"], "xxxx\n"],
    [{ maxFiles: 1 }, ["--files", "."], ""],
  ];
  for (const [options, args, stdin] of cases) {
    const result = await virtual({ args, stdin, files: { first: "", second: "" } }, options);
    assert.equal(result.code, 2); assert.match(result.stderr.toString(), /limit/u);
    if (options.maxOutputBytes) assert(result.stdout.length <= options.maxOutputBytes);
  }
  const invalid = await virtual({ args: ["x", "-"] }, { maxLineBytes: 0 });
  assert.equal(invalid.code, 2);
});

test("one-byte chunks retain UTF8 matches and offsets", async () => {
  const source = (async function* () { for (const byte of Buffer.from("é😀cat\ncat")) yield Uint8Array.of(byte); })();
  const result = await virtual({ args: ["-bon", "cat", "-"] }, {}, { stdin: source });
  assert.equal(result.stdout.toString(), "1:6:cat\n2:10:cat\n");
});

for (const blocked of ["stdin", "stdout", "stderr"] as const) test(`rg cancels uncooperative ${blocked}`, { timeout: 2000 }, async () => {
  const controller = new AbortController();
  const reason = new Error("cancel search");
  const never = () => new Promise<void>(() => {});
  const input: ByteSource = { [Symbol.asyncIterator]() { return { next: () => new Promise<IteratorResult<Uint8Array>>(() => {}) }; } };
  const timer = setTimeout(() => controller.abort(reason), 10);
  const overrides: Partial<CommandContext> = {
    signal: controller.signal,
    ...(blocked === "stdin" ? { stdin: input } : {}),
    ...(blocked === "stdout" ? { stdout: { write: never } } : {}),
    ...(blocked === "stderr" ? { stderr: { write: never } } : {}),
  };
  try { await assert.rejects(virtual({ args: blocked === "stderr" ? ["--bad"] : ["x", "-"], stdin: "x\n" }, {}, overrides), error => error === reason); }
  finally { clearTimeout(timer); }
});

test("long ordinary record streams yield so timer cancellation can run", { timeout: 2000 }, async () => {
  const controller = new AbortController();
  const reason = new Error("cancel streaming search");
  const source = (async function* () { while (true) yield Buffer.from("ordinary line\n"); })();
  const timer = setTimeout(() => controller.abort(reason), 10);
  try { await assert.rejects(virtual({ args: ["never-matches", "-"] }, {}, { stdin: source, signal: controller.signal }), error => error === reason); }
  finally { clearTimeout(timer); }
});

test("quiet matching closes streaming input without draining it", async () => {
  let closed = false;
  let chunks = 0;
  const source = (async function* () { try { chunks++; yield Buffer.from("needle\n"); chunks++; yield Buffer.from("later\n"); } finally { closed = true; } })();
  const result = await virtual({ args: ["-q", "needle", "-"] }, {}, { stdin: source });
  assert.equal(result.code, 0); assert.equal(chunks, 1); assert.equal(closed, true);
});

test("explicit paths do not consume unrelated stdin", async () => {
  const fs = await makeFileSystem({ args: [], files: { source: "needle\n" } });
  let consumed = false;
  const source = (async function* () { consumed = true; yield Buffer.from("bad"); })();
  const result = await virtual({ args: ["needle", "source"] }, {}, { fs, stdin: source });
  assert.equal(result.code, 0); assert.equal(consumed, false);
  assert.equal((await virtual({ args: ["needle", "-"], stdin: "" }, {}, { stdin: toByteSource("") })).code, 1);
});

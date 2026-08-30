import assert from "node:assert/strict";
import { getEventListeners } from "node:events";
import { setTimeout as delay } from "node:timers/promises";
import test from "node:test";
import { Worker } from "node:worker_threads";
import { createSearchCommands, createStandardCommands, standardCommands, searchCommands, MemoryFileSystem, Shell, toByteSource, type ByteSource, type CommandContext, type CommandDefinition, type RegexExecutionOptions } from "../../../src/index.js";

function command(name: "grep" | "rg", regex: RegexExecutionOptions = {}): CommandDefinition {
  return (name === "grep" ? createStandardCommands({ regex }) : createSearchCommands({ regex })).find(definition => definition.name === name)!;
}
async function run(definition: CommandDefinition, args: readonly string[], stdin: string | Uint8Array | ByteSource, overrides: Partial<CommandContext> = {}) {
  const stdout: Uint8Array[] = [];
  const stderr: Uint8Array[] = [];
  const context: CommandContext = {
    command: definition.name, args, fs: new MemoryFileSystem(), cwd: "/", env: {},
    signal: new AbortController().signal, stdinIsDefault: false,
    stdin: typeof stdin === "string" || stdin instanceof Uint8Array ? toByteSource(stdin) : stdin,
    stdout: { async write(bytes) { stdout.push(bytes.slice()); } },
    stderr: { async write(bytes) { stderr.push(bytes.slice()); } }, ...overrides,
  };
  const result = await definition.execute(context);
  return { code: result.exitCode, stdout: Buffer.concat(stdout), stderr: Buffer.concat(stderr) };
}

const cases: readonly { name: string; tool: "grep" | "rg"; args: string[]; input: string | Uint8Array; stdout: string | Uint8Array; code?: number }[] = [
  { name: "grep ordered alternatives", tool: "grep", args: ["-Eo", "a|ab"], input: "ab\n", stdout: "a\n" },
  { name: "grep numeric backreference capture", tool: "grep", args: ["-Eo", "(ab)\\1"], input: "abab ab\n", stdout: "abab\n" },
  { name: "grep pattern ordering longest same-start", tool: "grep", args: ["-o", "-e", "a", "-e", "ab"], input: "abab\n", stdout: "ab\nab\n" },
  { name: "grep byte dot", tool: "grep", args: ["-Eo", "."], input: Buffer.from([0xff, 10]), stdout: Buffer.from([0xff, 10]) },
  { name: "grep word filter before early return", tool: "grep", args: ["-wo", "cat"], input: "cat1 cat!\n", stdout: "cat\n" },
  { name: "grep empty match selection no output", tool: "grep", args: ["-o", ""], input: "x\n", stdout: "" },
  { name: "grep NUL byte records", tool: "grep", args: ["-zn", "cat"], input: "no\0cat\0", stdout: "2:cat\0" },
  { name: "rg Unicode folding", tool: "rg", args: ["-io", "k", "-"], input: "KKk\n", stdout: "K\nK\nk\n" },
  { name: "rg Unicode words", tool: "rg", args: ["-wo", "cat", "-"], input: "écat cat!\n", stdout: "cat\n" },
  { name: "rg Unicode capture", tool: "rg", args: ["-o", "(?<letter>é)", "-"], input: "éé\n", stdout: "é\né\n" },
  { name: "rg current named backreference", tool: "rg", args: ["-o", "(?<letter>a)\\k<letter>", "-"], input: "aa\n", stdout: "aa\n" },
  { name: "rg fragments do not invent starts", tool: "rg", args: ["-ao", "^a", "-"], input: Buffer.from([0xff, 97, 10]), stdout: "", code: 1 },
  { name: "rg fragments do not invent ends", tool: "rg", args: ["-ao", "a$", "-"], input: Buffer.from([97, 0xff, 10]), stdout: "", code: 1 },
  { name: "rg fragments preserve byte offsets", tool: "rg", args: ["-abo", "a", "-"], input: Buffer.from([0xff, 97, 10]), stdout: "1:a\n" },
  { name: "rg JS digit selection", tool: "rg", args: ["-o", "\\d", "-"], input: "١1\n", stdout: "1\n" },
  { name: "rg empty byte count", tool: "rg", args: ["--count-matches", "", "-"], input: "é\n", stdout: "3\n" },
  { name: "rg empty unterminated byte count", tool: "rg", args: ["--count-matches", "", "-"], input: "é", stdout: "2\n" },
  { name: "rg previous-end zero-width suppression", tool: "rg", args: ["--count-matches", "a*", "-"], input: "ab\n", stdout: "2\n" },
  { name: "rg CRLF whole record", tool: "rg", args: ["--crlf", "-x", "cat", "-"], input: "cat\r\nno\r\n", stdout: "cat\r\n" },
];
for (const fixture of cases) test(fixture.name, { timeout: 5000 }, async () => {
  const result = await run(command(fixture.tool), fixture.args, fixture.input);
  assert.equal(result.code, fixture.code ?? 0);
  assert.deepEqual(result.stdout, Buffer.from(fixture.stdout));
  assert.equal(result.stderr.length, 0);
});

for (const tool of ["grep", "rg"] as const) {
  test(`${tool} validation and fragment matching never construct host RegExp`, { timeout: 5000 }, async () => {
    const definition = command(tool);
    const NativeRegExp = globalThis.RegExp;
    const attempts: unknown[][] = [];
    globalThis.RegExp = new Proxy(NativeRegExp, {
      construct(_target, args): RegExp { attempts.push(args); throw new Error("host regex forbidden"); },
      apply(_target, _receiver, args): RegExp { attempts.push(args); throw new Error("host regex forbidden"); },
    });
    try {
      const result = await run(definition, tool === "grep" ? ["-Eo", "a"] : ["-ao", "a", "-"], Buffer.from([255, 97, 255, 10]));
      assert.equal(result.code, 0);
      assert.equal(result.stdout.toString(), "a\n");
      const invalid = await run(definition, ["[", "-"], "x\n");
      assert.equal(invalid.code, 2);
      assert.equal(attempts.length, 0);
    } finally { globalThis.RegExp = NativeRegExp; }
  });
  test(`${tool} preabort avoids source and worker dispatch`, { timeout: 5000 }, async () => {
    const controller = new AbortController();
    const reason = new Error("preaborted command");
    controller.abort(reason);
    let reads = 0;
    const source = (async function* () { reads++; yield Buffer.from("a\n"); })();
    await assert.rejects(run(command(tool), ["a", "-"], source, { signal: controller.signal }), error => error === reason);
    assert.equal(reads, 0);
    assert.equal(getEventListeners(controller.signal, "abort").length, 0);
  });
  test(`${tool} batches available rows without reading a feedback-dependent chunk`, { timeout: 5000 }, async () => {
    const definition = command(tool);
    let reads = 0;
    let closed = 0;
    let writes = 0;
    const original = Worker.prototype.postMessage;
    const rowCounts: number[] = [];
    Worker.prototype.postMessage = function(message: { rows?: unknown[] }, transfer) {
      if (message.rows) rowCounts.push(message.rows.length);
      original.call(this, message, transfer);
    };
    const source = (async function* () {
      try {
        reads++; yield Buffer.from("a\na\na\n");
        assert(writes > 0, "source was read speculatively");
        reads++; yield Buffer.from("a\n");
      } finally { closed++; }
    })();
    try {
      const result = await run(definition, ["a", "-"], source, { stdout: { async write() { writes++; await delay(1); } } });
      assert.equal(result.code, 0);
      assert.equal(reads, 2);
      assert.equal(closed, 1);
      assert(rowCounts.includes(3));
      assert(rowCounts.includes(1));
    } finally { Worker.prototype.postMessage = original; }
  });
  test(`${tool} releases request capacity before paused sink`, { timeout: 5000 }, async () => {
    const definition = command(tool, { maxWorkers: 1, maxQueuedRequests: 0 });
    let resume!: () => void;
    let entered!: () => void;
    const paused = new Promise<void>(resolve => { resume = resolve; });
    const started = new Promise<void>(resolve => { entered = resolve; });
    let once = false;
    const initial = run(definition, ["a", "-"], "a\n", { stdout: { async write() { if (!once) { once = true; entered(); await paused; } } } });
    await started;
    try { assert.equal((await run(definition, ["a", "-"], "a\n")).code, 0); }
    finally { resume(); }
    assert.equal((await initial).code, 0);
  });
  test(`${tool} releases request capacity before an actual paused VFS read`, { timeout: 5000 }, async () => {
    const definition = command(tool, { maxWorkers: 1, maxQueuedRequests: 0 });
    const fs = new MemoryFileSystem();
    await fs.writeFile("/file", Buffer.from("a\n"));
    let entered!: () => void;
    let resume!: () => void;
    const reading = new Promise<void>(resolve => { entered = resolve; });
    const paused = new Promise<void>(resolve => { resume = resolve; });
    fs.readStream = async function* () { entered(); await paused; yield Buffer.from("a\n"); };
    const initial = run(definition, ["a", "/file"], "", { fs });
    await reading;
    try { assert.equal((await run(definition, ["a", "-"], "a\n")).code, 0); }
    finally { resume(); }
    assert.equal((await initial).code, 0);
  });
  for (const blocked of ["stdin", "stdout"] as const) test(`${tool} cancels after entering uncooperative ${blocked}, not merely startup`, { timeout: 5000 }, async () => {
    const controller = new AbortController();
    const reason = new Error(`cancel entered ${blocked}`);
    let entered!: () => void;
    let rejectLate!: (error: unknown) => void;
    const waiting = new Promise<void>(resolve => { entered = resolve; });
    const pending = new Promise<never>((_resolve, reject) => { rejectLate = reject; });
    const stdin: ByteSource = { [Symbol.asyncIterator]() { return { next() { entered(); return pending; } }; } };
    const result = run(command(tool), ["a", "-"], blocked === "stdin" ? stdin : "a\n", {
      signal: controller.signal,
      ...(blocked === "stdout" ? { stdout: { async write() { entered(); await pending; } } } : {}),
    });
    const rejected = assert.rejects(result, error => error === reason);
    await waiting;
    controller.abort(reason);
    await rejected;
    rejectLate(new Error("late host work rejection"));
    await delay(1);
    assert.equal(getEventListeners(controller.signal, "abort").length, 0);
  });
  test(`${tool} quiet closes source without reading another chunk`, { timeout: 5000 }, async () => {
    let reads = 0;
    let closed = false;
    const source = (async function* () { try { reads++; yield Buffer.from("a\na\n"); reads++; throw new Error("must not read"); } finally { closed = true; } })();
    assert.equal((await run(command(tool), ["-q", "a", "-"], source)).code, 0);
    assert.equal(reads, 1);
    assert.equal(closed, true);
  });
  for (const flag of ["-q", "-m1"]) test(`${tool} ${flag} does not match later available records speculatively`, { timeout: 5000 }, async () => {
    const original = Worker.prototype.postMessage;
    const rowCounts: number[] = [];
    Worker.prototype.postMessage = function(message: { rows?: unknown[] }, transfer) {
      if (message.rows?.length) rowCounts.push(message.rows.length);
      original.call(this, message, transfer);
    };
    try {
      const result = await run(command(tool), [flag, "a", "-"], "a\nlater\nlater\n");
      assert.equal(result.code, 0);
      assert.deepEqual(rowCounts, [1]);
    } finally { Worker.prototype.postMessage = original; }
  });
}

test("actual Shell pipeline composes public grep/rg options", { timeout: 5000 }, async () => {
  const shell = new Shell({ fs: new MemoryFileSystem() }).use(standardCommands({ regex: { maxWorkers: 1 } })).use(searchCommands({ regex: { maxWorkers: 1 } }));
  const result = await shell.exec("printf 'cat\\nno\\n' | grep -E 'c.t' | rg 'cat' -");
  assert.equal(result.exitCode, 0);
  assert.equal(result.stdout, "cat\n");
  assert.equal(result.stderr, "");
});

test("available batching preserves output preceding the existing rg match limit", { timeout: 5000 }, async () => {
  const result = await run(command("rg"), ["-o", "a", "-"], `a\n${"a".repeat(100001)}\n`);
  assert.equal(result.code, 2);
  assert.equal(result.stdout.toString(), "a\n");
  assert.equal(result.stderr.toString(), "rg: matches per line limit exceeded\n");
});

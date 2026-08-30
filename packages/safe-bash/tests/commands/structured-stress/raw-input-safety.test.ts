import assert from "node:assert/strict";
import { setImmediate, setTimeout as delay } from "node:timers/promises";
import { test } from "node:test";
import { FsError, toByteSource, type ByteSource, type CommandContext, type FileSystem } from "../../../src/contracts/index.js";
import { standardCommands } from "../../../src/commands/index.js";
import { structuredCommands, type JqLimits } from "../../../src/commands/structured/index.js";
import { MemoryFileSystem } from "../../../src/fs/memory/index.js";
import { Shell } from "../../../src/shell/index.js";
import { execute } from "./harness.js";

function filesystem(overrides: { [Key in keyof FileSystem]?: FileSystem[Key] | undefined }): FileSystem {
  return new Proxy(new MemoryFileSystem(), { get(target, property) {
    if (Object.hasOwn(overrides, property)) return Reflect.get(overrides, property);
    const member: unknown = Reflect.get(target, property);
    return typeof member === "function" ? member.bind(target) : member;
  } });
}

test("raw record output precedes EOF and honors sink backpressure", { timeout: 3000 }, async () => {
  const controller = new AbortController();
  const reason = new Error("stop after first record");
  let reads = 0;
  let cleanups = 0;
  let entered!: () => void;
  let release!: () => void;
  const ready = new Promise<void>(resolve => { entered = resolve; });
  const blocked = new Promise<void>(resolve => { release = resolve; });
  const stdin: ByteSource = { [Symbol.asyncIterator]() { return {
    async next() { reads++; return { done: false, value: Buffer.from("first\nsecond\n") }; },
    async return() { cleanups++; return { done: true, value: undefined }; },
  }; } };
  const running = execute(["-Rr", "."], stdin, {}, { signal: controller.signal, stdout: { async write(bytes) {
    assert.equal(Buffer.from(bytes).toString(), "first\n"); entered(); await blocked;
  } } });
  const rejected = assert.rejects(running, error => error === reason);
  await ready;
  await setImmediate();
  assert.equal(reads, 1);
  controller.abort(reason);
  await rejected;
  release();
  await setImmediate();
  assert.equal(cleanups, 1);
});

for (const operation of ["read", "write", "file-stream", "file-fallback", "cleanup"] as const) {
  test(`raw cancellation observes late ${operation} rejection`, { timeout: 3000 }, async () => {
    const controller = new AbortController();
    const reason = new Error(`${operation} cancelled`);
    let entered!: () => void;
    let rejectLate!: (error: Error) => void;
    const ready = new Promise<void>(resolve => { entered = resolve; });
    const pending = () => { entered(); return new Promise<never>((_, reject) => { rejectLate = reject; }); };
    const stdin: ByteSource = { [Symbol.asyncIterator]() { return {
      next: operation === "cleanup" ? async () => ({ done: false, value: Buffer.from("record\n") }) : pending,
      return: operation === "cleanup" ? pending : async () => ({ done: true, value: undefined }),
    }; } };
    const overrides: Partial<CommandContext> = { signal: controller.signal };
    if (operation === "write") Object.assign(overrides, { stdout: { write: pending } });
    if (operation === "file-stream") Object.assign(overrides, { fs: filesystem({ readStream: (_path, options) => {
      assert.equal(options?.signal, controller.signal); return stdin;
    } }) });
    if (operation === "file-fallback") Object.assign(overrides, { fs: filesystem({ readStream: undefined, readFile: (_path, options) => {
      assert.equal(options?.signal, controller.signal); assert.equal(options?.maxBytes, 64 * 1024 * 1024); return pending();
    } }) });
    const running = execute(["-Rr", ".", ...(operation.startsWith("file") ? ["input"] : [])], operation === "write" ? "record\n" : stdin,
      operation === "cleanup" ? { limits: { maxOutputBytes: 1 } } : {}, overrides);
    const rejected = assert.rejects(running, error => error === reason);
    await ready;
    controller.abort(reason);
    await rejected;
    rejectLate(new Error("late host failure"));
    await delay(0);
  });
}

test("raw null-input and invalid preflight do not acquire sources", async () => {
  const forbidden = () => { throw new Error("source must not be acquired"); };
  const stdin: ByteSource = { [Symbol.asyncIterator]: forbidden };
  const fs = filesystem({ readStream: forbidden, readFile: forbidden });
  for (const flags of ["-Rn", "-Rns", "-Rnsj", "-Rnse"]) {
    const result = await execute([flags, ".", "missing", "-"], stdin, {}, { fs });
    assert.equal(result.stdout, flags.includes("j") ? "null" : "null\n");
    assert.equal(result.status, flags.includes("e") ? 1 : 0);
  }
  for (const argv of [["-R", "1,("], ["-Rns", "unknown_function"], ["-RZ", "."], ["--raw-input=lines", "."]]) {
    const result = await execute([...argv, "missing"], stdin, {}, { fs });
    assert.equal(result.stdout, "");
    assert.equal(result.status, argv[0] === "-R" || argv[0] === "-Rns" ? 3 : 2);
  }
});

const boundaries: { name: keyof JqLimits; input: string; argv: string[]; limit: number; stdout: string }[] = [
  { name: "maxInputBytes", input: "123456789", argv: ["-R", "."], limit: 8, stdout: "" },
  { name: "maxValueBytes", input: "😀", argv: ["-Rr", "."], limit: 5, stdout: "" },
  { name: "maxValueBytes", input: "\u0000", argv: ["-Rr", "."], limit: 7, stdout: "" },
  { name: "maxValueBytes", input: "a\nb\n", argv: ["-Rs", "."], limit: 7, stdout: "" },
  { name: "maxOutputBytes", input: "😀", argv: ["-Rr", "."], limit: 4, stdout: "" },
  { name: "maxResults", input: "a\nb\nc\n", argv: ["-Rr", "."], limit: 2, stdout: "a\nb\n" },
  { name: "maxSteps", input: "x".repeat(16384), argv: ["-R", "."], limit: 8, stdout: "" },
  { name: "maxCollectionSize", input: "x", argv: ["-R", ".", "-"], limit: 2, stdout: "" },
  { name: "maxDepth", input: "x", argv: ["-R", "[[.]]"], limit: 1, stdout: "" },
  { name: "maxAstDepth", input: "x", argv: ["-R", "[[.]]"], limit: 1, stdout: "" },
  { name: "maxSourceBytes", input: "x", argv: ["-R", ".,."], limit: 2, stdout: "" },
];
for (const [index, fixture] of boundaries.entries()) test(`raw budget ${index}: ${fixture.name}`, async () => {
  const result = await execute(fixture.argv, fixture.input, { limits: { [fixture.name]: fixture.limit } });
  assert.equal(result.status, 5, result.stderr);
  assert.equal(result.stdout, fixture.stdout);
  assert.match(result.stderr, new RegExp(fixture.name));
});

test("raw exact budgets distinguish values, records, slurp and join-output", async () => {
  for (const [argv, input, limits, stdout] of [
    [["-Rj", "."], "😀", { maxValueBytes: 6, maxOutputBytes: 4 }, "😀"],
    [["-Rr", "."], "😀", { maxValueBytes: 6, maxOutputBytes: 5 }, "😀\n"],
    [["-Rr", "."], "\u0000", { maxValueBytes: 8, maxOutputBytes: 2 }, "\u0000\n"],
    [["-Rr", "."], "a\nb\n", { maxValueBytes: 3 }, "a\nb\n"],
    [["-Rsj", "."], "a\nb\n", { maxValueBytes: 8 }, "a\nb\n"],
    [["-Rs", "."], "", { maxValueBytes: 2 }, '""\n'],
    [["-Rj", "."], "\n\n", { maxOutputBytes: 1, maxResults: 2 }, ""],
    [["-Rsc", "."], "a\nb\nc\n", { maxCollectionSize: 2 }, '"a\\nb\\nc\\n"\n'],
  ] as const) {
    const result = await execute(argv, input, { limits });
    assert.deepEqual(result, { status: 0, stdout, stderr: "" });
  }
  const limited = await execute(["-Rj", "."], "\n\n", { limits: { maxOutputBytes: 1, maxResults: 1 } });
  assert.equal(limited.status, 5);
  assert.match(limited.stderr, /maxResults/u);
});

test("raw fallback files share input and value budgets and consume stdin only once", async () => {
  const requests: number[] = [];
  const fs = filesystem({ readStream: undefined, async readFile(path, options) {
    requests.push(options?.maxBytes ?? -1);
    return Buffer.from(path.endsWith("one") ? "ab" : "cd");
  } });
  const result = await execute(["-Rr", ".", "one", "-", "two", "-"], toByteSource("\n"), { limits: { maxInputBytes: 16 } }, { fs });
  assert.deepEqual(result, { status: 0, stdout: "ab\ncd\n", stderr: "" });
  assert.deepEqual(requests, [16, 13]);
  const combined = await execute(["-R", ".", "one", "two"], "", { limits: { maxValueBytes: 5 } }, { fs });
  assert.equal(combined.status, 5);
  assert.match(combined.stderr, /maxValueBytes/u);
});

test("raw input limits charge whole chunks and slurp emits no partial result", async () => {
  for (const flags of ["-Rr", "-Rsr"]) {
    async function* source() { yield Buffer.from("ok\n"); yield Buffer.from("12345678"); }
    const result = await execute([flags, "."], source(), { limits: { maxInputBytes: 8 } });
    assert.equal(result.status, 5);
    assert.equal(result.stdout, flags === "-Rr" ? "ok\n" : "");
    assert.match(result.stderr, /maxInputBytes/u);
  }
});

test("raw decoder and slurp cooperatively cancel without EOF", { timeout: 3000 }, async () => {
  for (const flags of ["-R", "-Rs"]) {
    const controller = new AbortController();
    const reason = new Error("raw CPU cancel");
    const running = execute([flags, "empty"], "x".repeat(3 * 1024 * 1024), {}, { signal: controller.signal });
    const rejected = assert.rejects(running, error => error === reason);
    await setImmediate();
    controller.abort(reason);
    await rejected;
  }
});

test("raw downstream EPIPE propagates and closes the iterator", async () => {
  let closed = false;
  async function* source() { try { yield Buffer.from("first\nsecond\n"); } finally { closed = true; } }
  const reason = new FsError("EPIPE", { message: "closed" });
  await assert.rejects(execute(["-R", "."], source(), {}, { stdout: { async write() { throw reason; } } }), error => error === reason);
  assert.equal(closed, true);
});

test("raw MemoryFS pipelines preserve CR, partial records, slurp and join-output", { timeout: 3000 }, async () => {
  const fs = new MemoryFileSystem();
  await fs.writeFile("/part", Buffer.from("first\npartial"));
  const shell = new Shell({ fs, limits: { pipeHighWaterMark: 1 } }).use(standardCommands()).use(structuredCommands());
  for (const [script, stdout] of [
    ["printf 'a\\r\\nb\\nlast' | jq -Rc '.' | jq -sc '.'", '["a\\r","b","last"]\n'],
    ["printf 'a\\nb' | jq -Rsj '.' | cat", "a\nb"],
    ["printf 'stdin\\n' | jq -Rr '.' /part - -", "first\npartialstdin\n"],
    ["printf 'a\\nb\\nc\\n' | jq -Rr '.' | head -n 1", "a\n"],
  ]) {
    const result = await shell.exec(script!, { signal: AbortSignal.timeout(2000) });
    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal(result.stdout, stdout);
  }
});

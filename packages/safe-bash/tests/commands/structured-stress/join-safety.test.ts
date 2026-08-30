import assert from "node:assert/strict";
import { setImmediate, setTimeout as delay } from "node:timers/promises";
import { test } from "node:test";
import { type ByteSource } from "../../../src/contracts/index.js";
import { standardCommands } from "../../../src/commands/index.js";
import { structuredCommands, type JqLimits } from "../../../src/commands/structured/index.js";
import { MemoryFileSystem } from "../../../src/fs/memory/index.js";
import { Shell } from "../../../src/shell/index.js";
import { execute } from "./harness.js";

test("join compact-value and raw-output byte boundaries are exact", async () => {
  for (const [flags, valueLimit, outputLimit, stdout] of [
    ["-c", 13, 14, '"1😀2😀3"\n'],
    ["-r", 13, 12, "1😀2😀3\n"],
    ["-j", 13, 11, "1😀2😀3"],
  ] as const) {
    const result = await execute([flags, 'join("😀")'], "[1,2,3]", { limits: { maxValueBytes: valueLimit, maxOutputBytes: outputLimit } });
    assert.deepEqual(result, { status: 0, stdout, stderr: "" });
    for (const limits of [{ maxValueBytes: valueLimit - 1 }, { maxOutputBytes: outputLimit - 1 }]) {
      const short = await execute([flags, 'join("😀")'], "[1,2,3]", { limits });
      assert.equal(short.status, 5, short.stderr);
      assert.equal(short.stdout, "");
      assert.match(short.stderr, new RegExp(Object.keys(limits)[0]!));
    }
  }
});

test("join control characters count escaped value bytes even with raw output", async () => {
  const exact = await execute(["-r", 'join("\\u0000")'], "[1,2,3]", { limits: { maxValueBytes: 17, maxOutputBytes: 6 } });
  assert.deepEqual(exact, { status: 0, stdout: "1\u00002\u00003\n", stderr: "" });
  const short = await execute(["-r", 'join("\\u0000")'], "[1,2,3]", { limits: { maxValueBytes: 16 } });
  assert.equal(short.status, 5);
  assert.match(short.stderr, /maxValueBytes/u);
});

const boundaries: { name: keyof JqLimits; limit: number; argv: string[]; input: string; stdout: string }[] = [
  { name: "maxInputBytes", limit: 12, argv: ['join("")'], input: '[1,2,3,4,5,6]', stdout: "" },
  { name: "maxValueBytes", limit: 12, argv: ['(join("😀"))?|empty'], input: '[1,2,3]', stdout: "" },
  { name: "maxValueBytes", limit: 8, argv: ['([]|join("xxxxxxxx"))?'], input: 'null', stdout: "" },
  { name: "maxSteps", limit: 40, argv: ['join(range(1000000))|empty'], input: '[]', stdout: "" },
  { name: "maxResults", limit: 2, argv: ['-c', 'join(range(1000000))'], input: '[]', stdout: '""\n""\n' },
  { name: "maxCollectionSize", limit: 2, argv: ['join("")'], input: '[1,2,3]', stdout: "" },
  { name: "maxDepth", limit: 1, argv: ['join("")'], input: '[[1]]', stdout: "" },
  { name: "maxAstDepth", limit: 1, argv: ['join("")'], input: '[]', stdout: "" },
  { name: "maxSourceBytes", limit: 7, argv: ['join("")'], input: '[]', stdout: "" },
];
for (const [index, fixture] of boundaries.entries()) test(`join budget ${index}: ${fixture.name}`, async () => {
  const result = await execute(fixture.argv, fixture.input, { limits: { [fixture.name]: fixture.limit } });
  assert.equal(result.status, 5, result.stderr);
  assert.equal(result.stdout, fixture.stdout);
  assert.match(result.stderr, new RegExp(fixture.name));
});

test("join output-limit failures preserve earlier generator results", async () => {
  const result = await execute(["-r", 'join(("-","😀"))'], '["a","b"]', { limits: { maxOutputBytes: 10 } });
  assert.equal(result.status, 5);
  assert.equal(result.stdout, "a-b\n");
  assert.match(result.stderr, /maxOutputBytes/u);
});

test("join separator generators remain lazy and uncached", async () => {
  for (const [input, filter, stdout] of [
    ['[]', 'first(join(range(1000000000)))', '""\n'],
    ['["a","b"]', 'first(join(("-",1/0)))', '"a-b"\n'],
    ['null', '[join(empty)]', '[]\n'],
    ['["a","b"]', 'limit(2;join(("-",":",1/0)))', '"a-b"\n"a:b"\n'],
  ]) {
    const result = await execute(["-c", filter!], input!, { limits: { maxSteps: 128, maxCollectionSize: 8 } });
    assert.deepEqual(result, { status: 0, stdout, stderr: "" });
  }
  const noExtraSlots = await execute(['join("")'], '[1,2]', { limits: { maxCollectionSize: 2 } });
  assert.deepEqual(noExtraSlots, { status: 0, stdout: '"12"\n', stderr: "" });
});

test("join and split wrong arities still preflight dead branches", async () => {
  let acquired = 0;
  const stdin: ByteSource = { [Symbol.asyncIterator]() { acquired++; throw new Error("unexpected input"); } };
  for (const filter of ['join', 'join("-";":")', 'if false then join("-";":") else . end', 'if false then split(",";"g") else join(",") end']) {
    const result = await execute(["-R", filter, "/missing"], stdin);
    assert.equal(result.status, 3, result.stderr);
    assert.equal(result.stdout, "");
  }
  assert.equal(acquired, 0);
});

test("join emits before input EOF and waits for stdout before later separator errors", { timeout: 3000 }, async () => {
  const controller = new AbortController();
  const reason = new Error("cancel blocked join output");
  let reads = 0;
  let cleanups = 0;
  let entered!: () => void;
  let rejectLate!: (error: Error) => void;
  const ready = new Promise<void>(resolve => { entered = resolve; });
  const stdin: ByteSource = { [Symbol.asyncIterator]() { return {
    async next() { reads++; return { done: false, value: Buffer.from('["a","b"]') }; },
    async return() { cleanups++; return { done: true, value: undefined }; },
  }; } };
  const running = execute(["-r", 'join(("-",1/0))'], stdin, {}, { signal: controller.signal, stdout: { write(bytes) {
    assert.equal(Buffer.from(bytes).toString(), "a-b\n"); entered(); return new Promise<never>((_, reject) => { rejectLate = reject; });
  } } });
  const rejected = assert.rejects(running, error => error === reason);
  await ready;
  await setImmediate();
  assert.equal(reads, 1);
  controller.abort(reason);
  await rejected;
  rejectLate(new Error("late join sink rejection"));
  await delay(0);
  assert.equal(cleanups, 1);
});

for (const filter of ['"ready",join("")', '"ready",(join(range(1000000000))|empty)']) {
  test(`join CPU cancellation: ${filter}`, { timeout: 3000 }, async () => {
    const controller = new AbortController();
    const reason = new Error("cancel join work");
    let ready!: () => void;
    const started = new Promise<void>(resolve => { ready = resolve; });
    const input = filter.includes("range") ? "[]" : JSON.stringify(Array.from({ length: 20000 }, () => "x"));
    const running = execute(["-r", filter], input, { limits: { maxSteps: 1000000 } }, { signal: controller.signal, stdout: { async write(bytes) {
      assert.equal(Buffer.from(bytes).toString(), "ready\n"); ready();
    } } });
    const rejected = assert.rejects(running, error => error === reason);
    await started;
    await setImmediate();
    controller.abort(reason);
    await rejected;
  });
}

test("join object values and Unicode cannot modify host prototypes", async () => {
  const input = '{"__proto__":"😀","constructor":"é","prototype":"雪","2":true,"1":null}';
  const result = await execute(["-r", 'join("|")'], input);
  assert.deepEqual(result, { status: 0, stdout: "😀|é|雪|true|\n", stderr: "" });
  assert.equal(Object.hasOwn(Object.prototype, "polluted"), false);
  assert.equal(Object.prototype.constructor, Object);
});

test("join actual MemoryFS pipelines support agent formatting and raw-input composition", { timeout: 3000 }, async () => {
  const fs = new MemoryFileSystem();
  await fs.writeFile("/jobs", Buffer.from('{"jobs":[{"name":"build","ok":true},{"name":"test","ok":true},{"name":"skip","ok":false}]}'));
  const shell = new Shell({ fs, limits: { pipeHighWaterMark: 1 } }).use(standardCommands()).use(structuredCommands());
  for (const [script, stdout] of [
    ["jq -r '.jobs|map(select(.ok)|.name)|join(\", \")' /jobs | cat", "build, test\n"],
    ["printf 'alpha\\nbeta\\n' | jq -R '.' | jq -sr 'join(\"|\")'", "alpha|beta\n"],
    ["printf 'alpha\\nbeta' | jq -Rsj '[.]|join(\"|\")'", "alpha\nbeta"],
    ["jq -nr '[]|join(range(1000000000))' | head -n 1", "\n"],
  ]) {
    const result = await shell.exec(script!, { signal: AbortSignal.timeout(2000) });
    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal(result.stdout, stdout);
  }
});

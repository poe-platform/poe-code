import assert from "node:assert/strict";
import test from "node:test";
import { createBoundedRegexProvider } from "../../../src/commands/regex-execution/bounded-provider.js";
import { defaults, exprMatchCeilings, type Descriptor, type Reply } from "../../../src/commands/regex-execution/protocol.js";
import type { RegexWorker, RegexWorkerRequest } from "../../../src/commands/regex-execution/provider.js";
import { RegexExecutor } from "../../../src/commands/regex-execution/portable.js";

const grep = (patterns: string[], overrides: object = {}): Descriptor => ({
  kind: "grep", patterns, fixed: false, extended: true, insensitive: false, whole: false, word: false, ...overrides,
});
const row = (text: string, all = false) => ({ bytes: new TextEncoder().encode(text), all, terminated: true });
const request = (descriptor: Descriptor, texts: string[] = ["abc"]): RegexWorkerRequest => ({ id: 1, descriptor, rows: texts.map(text => row(text)) });

async function exchange(worker: RegexWorker, input: RegexWorkerRequest): Promise<Reply> {
  return new Promise((resolve, reject) => {
    const listener = (value: unknown) => {
      if (value && typeof value === "object" && "id" in value) {
        worker.off("message", listener);
        resolve(value as Reply);
      }
    };
    worker.on("message", listener);
    try { worker.postMessage(input); } catch (error) { worker.off("message", listener); reject(error); }
  });
}

async function run(input: RegexWorkerRequest, options = {}): Promise<Reply> {
  const worker = createBoundedRegexProvider(options).createWorker(defaults);
  try { return await exchange(worker, input); } finally { await worker.terminate(); }
}

function spans(reply: Reply): number[][] {
  assert.ok("results" in reply, "error" in reply ? reply.error : "missing results");
  return reply.results.map(result => [...result]);
}

test("production provider supports bounded ASCII ERE selection", async () => {
  assert.deepEqual(spans(await run(request(grep(["a|ab"]), ["zab", "nothing"]))), [[1, 3], []]);
  assert.deepEqual(spans(await run(request(grep(["^ab$"]), ["ab", "abc"]))), [[0, 2], []]);
  assert.deepEqual(spans(await run(request(grep(["[[:digit:]]+"]), ["x123y"]))), [[1, 4]]);
});

test("fixed literals, BRE subset, pattern lists, whole and empty patterns retain exact spans", async () => {
  assert.deepEqual(spans(await run(request(grep(["a+b"], { fixed: true }), ["a+b"]))), [[0, 3]]);
  assert.deepEqual(spans(await run(request(grep(["ab*"], { extended: false }), ["zabb"]))), [[1, 4]]);
  assert.deepEqual(spans(await run(request(grep(["absent", "b+"]), ["abb"]))), [[1, 3]]);
  assert.deepEqual(spans(await run(request(grep(["a+"], { whole: true }), ["aa", "ba"]))), [[0, 2], []]);
  assert.deepEqual(spans(await run(request(grep([""]), [""]))), [[0, 0]]);
  assert.deepEqual(spans(await run(request(grep([]), ["abc"]))), [[]]);
  const rg: Descriptor = { kind: "rg", patterns: ["a+b"], fixed: true, case: "sensitive", whole: false, word: false, nullData: false };
  assert.deepEqual(spans(await run(request(rg, ["xa+by"]))), [[1, 4]]);
  assert.deepEqual(spans(await run(request({ ...rg, patterns: ["b", "a"] }, ["ab"]))), [[0, 1]]);
  assert.deepEqual(spans(await run(request({ ...rg, patterns: ["a", "ab"] }, ["ab"]))), [[0, 1]]);
});

test("unsupported dialects and flags are rejected even without subject rows", async () => {
  const unsupported: Descriptor[] = [
    grep(["x"], { insensitive: true }), grep(["x"], { word: true }),
    grep(["a\\+"], { extended: false }), grep(["é"]),
    ...["a^", "$a", "a^b", "a$b", "*a", "^*a", "^^*"].map(pattern => grep([pattern], { extended: false })),
    { kind: "rg", patterns: ["a|ab"], fixed: false, case: "sensitive", whole: false, word: false, nullData: false },
    { kind: "rg", patterns: ["a"], fixed: true, case: "smart", whole: false, word: false, nullData: false },
    { kind: "glob", patterns: [], globOptions: [] },
  ];
  for (const descriptor of unsupported) {
    const reply = await run(request(descriptor, []));
    assert.ok("error" in reply);
    assert.match(reply.error, /unsupported/i);
  }
  const syntax = await run(request(grep(["["]), []));
  assert.ok("error" in syntax);
  assert.match(syntax.error, /invalid ERE/);
  const all = await run({ ...request(grep(["x"])), rows: [row("x", true)] });
  assert.ok("error" in all);
  assert.match(all.error, /all-match/);
});

test("BRE boundary-anchor admission retains character-class literals and named classes", async () => {
  for (const [pattern, subject] of [["[$^]", "$"], ["[^a]", "b"], ["[[:digit:]]$", "1"], ["[]^]", "^"]]) {
    assert.deepEqual(spans(await run(request(grep([pattern!], { extended: false }), [subject!]))), [[0, 1]]);
  }
});

test("raw non-ASCII, invalid UTF-8 and NUL are refused without decoding or replacement", async () => {
  for (const bytes of [Uint8Array.of(0xff), Uint8Array.of(0xc0, 0x80), Uint8Array.of(0), new TextEncoder().encode("é")]) {
    const input = { ...request(grep(["."])), rows: [{ bytes, all: false, terminated: true }] };
    const reply = await run(input);
    assert.ok("error" in reply);
    assert.match(reply.error, /non-NUL ASCII/);
    assert.deepEqual(input.rows[0]!.bytes, bytes);
  }
});

test("request shape admission rejects malformed descriptors, holes, and accessors without calling them", async () => {
  let accessed = 0;
  const descriptor = grep(["x"]);
  Object.defineProperty(descriptor, "fixed", { get() { accessed++; return false; }, enumerable: true });
  const malformed = [
    descriptor, { ...grep(["x"]), whole: undefined }, { ...grep(["x"]), extra: true },
    { ...grep(["x"]), patterns: new Array<string>(1) },
    { ...grep(["x"]), kind: "expr-match" },
  ];
  for (const value of malformed) {
    const reply = await run(request(value as Descriptor, []));
    assert.ok("error" in reply);
    assert.match(reply.error, /protocol|unsupported/i);
  }
  assert.equal(accessed, 0);
});

test("malformed row arrays and row accessors fail without invoking user getters", async () => {
  let accessed = 0;
  const getterRow = { all: false, terminated: true, get bytes() { accessed++; return new Uint8Array(); } };
  for (const rows of [new Array(1), [getterRow], [{ ...row("a"), terminated: 1 }], [{ ...row("a"), extra: true }]]) {
    const reply = await run({ ...request(grep(["a"])), rows } as RegexWorkerRequest);
    assert.ok("error" in reply);
    assert.match(reply.error, /protocol/);
  }
  assert.equal(accessed, 0);
});

test("admission ignores inherited iteration and unrelated prototype accessors", async () => {
  let accessed = 0;
  const patterns = ["abc"];
  Object.setPrototypeOf(patterns, { get [Symbol.iterator]() { accessed++; throw new Error("pattern iterator accessed"); } });
  const bytes = new TextEncoder().encode("abc");
  Object.defineProperty(bytes, "length", { get() { accessed++; throw new Error("byte length accessed"); } });
  Object.defineProperty(bytes, Symbol.iterator, { get() { accessed++; throw new Error("byte iterator accessed"); } });
  const rg: Descriptor = { kind: "rg", patterns, fixed: true, case: "sensitive", whole: false, word: false, nullData: false };
  Object.setPrototypeOf(rg, { get insensitive() { accessed++; throw new Error("unrelated flag accessed"); } });
  const rows = [{ bytes, all: false, terminated: true }];
  Object.setPrototypeOf(rows, { get [Symbol.iterator]() { accessed++; throw new Error("row iterator accessed"); } });
  assert.deepEqual(spans(await run({ id: 1, descriptor: rg, rows })), [[0, 3]]);
  assert.equal(accessed, 0);
});

test("input, pattern, result, work, and allocation admission fail closed", async () => {
  for (const [input, options, expected] of [
    [request(grep(["aa"])), { maxPatternBytes: 1 }, /pattern/],
    [request(grep(["a", "b"])), { maxPatterns: 1 }, /pattern/],
    [request(grep(["a"]), ["a", "b"]), { maxRows: 1 }, /row/],
    [request(grep(["a"]), ["aa"]), { maxInputBytes: 1 }, /input/],
    [request(grep(["a"])), { maxResultBytes: 8 }, /result/],
    [request(grep(["(a+)+$"]), ["a".repeat(32) + "!"]), { maxWork: 512 }, /work/],
    [request(grep(["a"])), { maxAllocationUnits: 1 }, /allocation/],
  ] as const) {
    const reply = await run(input, options);
    assert.ok("error" in reply);
    assert.match(reply.error, expected);
  }
});

test("admitted rows are copied before asynchronous execution and requests reply exactly once", async () => {
  const worker = createBoundedRegexProvider().createWorker(defaults);
  const replies: unknown[] = [];
  worker.on("message", value => { if (value && typeof value === "object" && "id" in value) replies.push(value); });
  try {
    const patterns = ["abc"];
    const input = request(grep(patterns));
    const pending = exchange(worker, input);
    input.rows[0]!.bytes.fill(120);
    patterns[0] = "x";
    assert.deepEqual(spans(await pending), [[0, 3]]);
    assert.equal(replies.length, 1);
    assert.deepEqual(spans(await exchange(worker, request(grep(["x"]), ["x"]))), [[0, 1]]);
    assert.equal(replies.length, 2);
  } finally { await worker.terminate(); }
});

test("cooperative retirement is shared, awaited, closes admission, and releases endpoint capacity", async () => {
  const provider = createBoundedRegexProvider({ maxWorkers: 1, maxWork: 1_000_000 });
  const worker = provider.createWorker(defaults);
  assert.throws(() => provider.createWorker(defaults), /worker.*limit/);
  let replies = 0;
  worker.on("message", value => { if (value && typeof value === "object" && "id" in value) replies++; });
  worker.postMessage(request(grep(["(a+)+$"]), ["a".repeat(64) + "!"]));
  assert.throws(() => worker.postMessage(request(grep(["a"]))), /busy/);
  await new Promise<void>(resolve => setTimeout(resolve, 0));
  const first = worker.terminate();
  assert.equal(first, worker.terminate());
  assert.throws(() => provider.createWorker(defaults), /worker.*limit/);
  await first;
  assert.equal(replies, 0);
  assert.throws(() => worker.postMessage(request(grep(["a"]))), /closed/);
  const replacement = provider.createWorker(defaults);
  assert.deepEqual(spans(await exchange(replacement, request(grep(["a"]), ["a"]))), [[0, 1]]);
  await replacement.terminate();
});

test("executor abort awaits provider retirement and preserves caller cancellation identity", async () => {
  const provider = createBoundedRegexProvider({ maxWorkers: 1 });
  const executor = new RegexExecutor(provider, { maxWorkers: 1 });
  const controller = new AbortController();
  const session = executor.open(controller.signal);
  const reason = new Error("caller cancellation");
  const pending = session.run(grep(["(a+)+$"]), [row("a".repeat(64) + "!")]);
  const rejected = assert.rejects(pending, error => error === reason);
  await new Promise<void>(resolve => setTimeout(resolve, 0));
  controller.abort(reason);
  await rejected;
  await session.close();
  const recovered = executor.open(new AbortController().signal);
  try {
    assert.deepEqual(await recovered.run(grep(["abc"]), [row("abc")]), [[{ start: 0, end: 3 }]]);
  } finally { await recovered.close(); await executor.dispose(); }
  const worker = provider.createWorker(defaults);
  await worker.terminate();
});

test("unsupported expr requests use the protocol's explicit unsupported reply", async () => {
  const executor = new RegexExecutor(createBoundedRegexProvider());
  const session = executor.open(new AbortController().signal);
  try {
    await assert.rejects(session.matchExpr({ kind: "expr-match", pattern: Uint8Array.of(97), profile: "byte", limits: exprMatchCeilings }, Uint8Array.of(97)), { category: "unsupported" });
  } finally { await session.close(); await executor.dispose(); }
});

test("budget options are finite positive bounded integers and unknown options are rejected", () => {
  for (const options of [{ maxInputBytes: Infinity }, { maxWorkers: 0 }, { maxRows: 1.5 }, { maxWork: Number.MAX_SAFE_INTEGER }, { typo: 1 }]) {
    assert.throws(() => createBoundedRegexProvider(options), /option|limit/);
  }
});

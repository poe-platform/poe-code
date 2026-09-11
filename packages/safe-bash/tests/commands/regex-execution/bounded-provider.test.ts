import assert from "node:assert/strict";
import test from "node:test";
import { createBoundedRegexProvider } from "../../../src/commands/regex-execution/bounded-provider.js";
import { defaults, exprMatchCeilings, type Descriptor, type Reply } from "../../../src/commands/regex-execution/protocol.js";
import type { RegexWorker, RegexWorkerRequest } from "../../../src/commands/regex-execution/provider.js";
import { EreLedger } from "../../../src/commands/regex-execution/ere/limits.js";
import { compileEre } from "../../../src/commands/regex-execution/ere/syntax.js";
import { createEreSpanMatcher, matchEre, prepareUtf8EreSubject } from "../../../src/commands/regex-execution/ere/matcher.js";
import { RegexExecutor } from "../../../src/commands/regex-execution/portable.js";

const grep = (patterns: string[], overrides: object = {}): Descriptor => ({
  kind: "grep", patterns, fixed: false, extended: true, insensitive: false, whole: false, word: false, ...overrides,
});
const row = (text: string, all = false) => ({ bytes: new TextEncoder().encode(text), all, terminated: true });
const request = (descriptor: Descriptor, texts: string[] = ["abc"]): RegexWorkerRequest => ({ id: 1, descriptor, rows: texts.map(text => row(text)) });
const literal = (kind: "grep" | "rg", patterns: string[], whole = false): Descriptor => kind === "grep"
  ? grep(patterns.map(pattern => Buffer.from(pattern).toString("latin1")), { fixed: true, whole })
  : { kind, patterns, fixed: true, case: "sensitive", whole, word: false, nullData: false };

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
    grep(["x"], { word: true }),
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
  const all = await run({ ...request(literal("rg", ["x"])), rows: [row("x", true)] });
  assert.ok("error" in all);
  assert.match(all.error, /all-match/);
});

test("BRE boundary-anchor admission retains character-class literals and named classes", async () => {
  for (const [pattern, subject] of [["[$^]", "$"], ["[^a]", "b"], ["[[:digit:]]$", "1"], ["[]^]", "^"]]) {
    assert.deepEqual(spans(await run(request(grep([pattern!], { extended: false }), [subject!]))), [[0, 1]]);
  }
});

test("invalid UTF-8 and NUL are refused without decoding or replacement", async () => {
  for (const bytes of [Uint8Array.of(0xff), Uint8Array.of(0xc0, 0x80), Uint8Array.of(0)]) {
    const input = { ...request(grep(["."])), rows: [{ bytes, all: false, terminated: true }] };
    const reply = await run(input);
    assert.ok("error" in reply);
    assert.match(reply.error, /non-NUL UTF-8/);
    assert.deepEqual(input.rows[0]!.bytes, bytes);
  }
});

test("UTF-8 literals preserve byte offsets without normalization or regex interpretation", async () => {
  for (const kind of ["grep", "rg"] as const) {
    assert.deepEqual(spans(await run(request(literal(kind, ["é🦊"]), ["aé🦊b", "ae\u0301🦊b"]))), [[1, 7], []]);
    assert.deepEqual(spans(await run(request(literal(kind, ["[é]+"]), ["x[é]+y"]))), [[1, 6]]);
    assert.deepEqual(spans(await run(request(literal(kind, ["中"], true), ["中", "中x"]))), [[0, 3], []]);
    assert.deepEqual(spans(await run(request(literal(kind, [""]), ["🦊"]))), [[0, 0]]);
    assert.deepEqual(spans(await run(request(literal(kind, [""], true), ["", "é"]))), [[0, 0], []]);
    assert.deepEqual(spans(await run(request(literal(kind, []), ["é"]))), [[]]);
    assert.deepEqual(spans(await run(request(literal(kind, ["\ufeffé"]), ["\ufeffé"]))), [[0, 5]]);
  }
  assert.deepEqual(spans(await run(request(literal("grep", ["🦊", "é"]), ["é🦊"]))), [[2, 6]]);
  assert.deepEqual(spans(await run(request(literal("rg", ["🦊", "é"]), ["é🦊"]))), [[0, 2]]);
  assert.deepEqual(spans(await run(request(literal("rg", ["é", "é🦊"]), ["é🦊"]))), [[0, 2]]);
  const boundaries = "\u007f\u0080\u07ff\u0800\ud7ff\ue000\uffff\u{10000}\u{10ffff}";
  for (const kind of ["grep", "rg"] as const) {
    assert.deepEqual(spans(await run(request(literal(kind, [boundaries]), [`é${boundaries}x`]))), [[2, 27]]);
  }
});

test("literal UTF-8 validation rejects malformed bytes, NUL and ambiguous protocol strings", async () => {
  const invalid = [
    [0], [0xff], [0x80], [0xc0, 0x80], [0xc2], [0xc2, 0x20],
    [0xe0, 0x80, 0x80], [0xed, 0xa0, 0x80], [0xe2, 0x82],
    [0xf0, 0x80, 0x80, 0x80], [0xf4, 0x90, 0x80, 0x80], [0xf5, 0x80, 0x80, 0x80], [0xf0, 0x90, 0x80],
  ];
  for (const bytes of invalid) {
    const pattern = String.fromCharCode(...bytes);
    const reply = await run(request(grep([pattern], { fixed: true }), []));
    assert.ok("error" in reply);
    assert.match(reply.error, /UTF-8|NUL/);
    for (const kind of ["grep", "rg"] as const) {
      const input = { ...request(literal(kind, [])), rows: [{ bytes: Uint8Array.from(bytes), all: false, terminated: true }] };
      const reply = await run(input);
      assert.ok("error" in reply);
      assert.match(reply.error, /UTF-8|NUL/);
      assert.deepEqual([...input.rows[0]!.bytes], bytes);
    }
  }
  for (const descriptor of [grep(["中"], { fixed: true }), ...["\ud800", "\udfff", "x\ud800y", "\0"].map(pattern => literal("rg", [pattern]))]) {
    const reply = await run(request(descriptor, []));
    assert.ok("error" in reply);
    assert.match(reply.error, /UTF-8|NUL|byte.string/);
  }
  const multiline = literal("rg", ["é\nx"]);
  const reply = await run(request(multiline, []));
  assert.ok("error" in reply);
  assert.match(reply.error, /multiline/);
  assert.deepEqual(spans(await run(request({ ...multiline, nullData: true } as Descriptor, ["é\nx"]))), [[0, 4]]);
});

test("literal resource admission counts UTF-8 bytes and shared preprocessing work", async () => {
  for (const kind of ["grep", "rg"] as const) {
    assert.deepEqual(spans(await run(request(literal(kind, ["é"]), ["é"]), { maxPatternBytes: 2, maxInputBytes: 2 })), [[0, 2]]);
    for (const [input, options, expected] of [
      [request(literal(kind, ["é"]), []), { maxPatternBytes: 1 }, /pattern/],
      [request(literal(kind, ["é", "é"]), []), { maxPatternBytes: 3 }, /pattern/],
      [request(literal(kind, ["é"]), ["é"]), { maxInputBytes: 1 }, /input/],
      [request(literal(kind, ["é"]), ["é"]), { maxResultBytes: 15 }, /result/],
      [request(literal(kind, ["é".repeat(64)]), []), { maxWork: 32 }, /work/],
      [request(literal(kind, ["é".repeat(64)]), []), { maxAllocationUnits: 32 }, /allocation/],
      [request(literal(kind, ["é".repeat(64)]), []), { maxStates: 32 }, /states/],
    ] as const) {
      const reply = await run(input, options);
      assert.ok("error" in reply);
      assert.match(reply.error, expected);
    }
  }
});

test("literal prefix-heavy searches stay linear and share their request budget", async () => {
  const pattern = "é".repeat(128) + "x";
  const subject = "é".repeat(2048) + "x";
  for (const kind of ["grep", "rg"] as const) {
    assert.deepEqual(spans(await run(request(literal(kind, [pattern]), [subject]), { maxWork: 15_000 })), [[3840, 4097]]);
    const reply = await run(request(literal(kind, [pattern]), [subject, subject]), { maxWork: 15_000 });
    assert.ok("error" in reply);
    assert.match(reply.error, /work/);
  }
});

test("UTF-8 request snapshots preserve literal bytes and allow reuse after a limit error", async () => {
  const worker = createBoundedRegexProvider({ maxWork: 100 }).createWorker(defaults);
  try {
    const patterns = ["é"];
    const input = request(literal("rg", patterns), ["xé"]);
    const pending = exchange(worker, input);
    input.rows[0]!.bytes.fill(0xff);
    patterns[0] = "y";
    assert.deepEqual(spans(await pending), [[1, 3]]);
    const reply = await exchange(worker, request(literal("rg", ["é"]), ["é".repeat(100)]));
    assert.ok("error" in reply);
    assert.match(reply.error, /work/);
    assert.deepEqual(spans(await exchange(worker, request(literal("rg", ["é"]), ["é"]))), [[0, 2]]);
  } finally { await worker.terminate(); }
});

test("UTF-8 literal retirement stops pending preprocessing and releases capacity", async () => {
  const provider = createBoundedRegexProvider({ maxWorkers: 1 });
  const worker = provider.createWorker(defaults);
  let replies = 0;
  worker.on("message", value => { if (value && typeof value === "object" && "id" in value) replies++; });
  worker.postMessage(request(literal("rg", ["é".repeat(3000)]), ["é".repeat(4000)]));
  await new Promise<void>(resolve => setTimeout(resolve, 0));
  const retirement = worker.terminate();
  assert.equal(worker.terminate(), retirement);
  assert.throws(() => provider.createWorker(defaults), /worker.*limit/);
  await retirement;
  assert.equal(replies, 0);
  const replacement = provider.createWorker(defaults);
  try { assert.deepEqual(spans(await exchange(replacement, request(literal("rg", ["é"]), ["é"]))), [[0, 2]]); }
  finally { await replacement.terminate(); }
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

test("unsupported expr syntax uses the protocol's explicit unsupported reply", async () => {
  const executor = new RegexExecutor(createBoundedRegexProvider());
  const session = executor.open(new AbortController().signal);
  try {
    await assert.rejects(session.matchExpr({ kind: "expr-match", pattern: Uint8Array.of(92, 119), profile: "byte", limits: exprMatchCeilings }, Uint8Array.of(97)), { category: "unsupported" });
  } finally { await session.close(); await executor.dispose(); }
});

test("budget options are finite positive bounded integers and unknown options are rejected", () => {
  for (const options of [{ maxInputBytes: Infinity }, { maxWorkers: 0 }, { maxRows: 1.5 }, { maxWork: Number.MAX_SAFE_INTEGER }, { typo: 1 }]) {
    assert.throws(() => createBoundedRegexProvider(options), /option|limit/);
  }
});

test("grep enumeration retains nonoverlapping leftmost-longest byte spans", async () => {
  for (const [descriptor, text, expected] of [
    [grep(["giraffe"], { extended: false }), "giraffe giraffe", [0, 7, 8, 15]],
    [grep(["a", "ab"]), "zababa", [1, 3, 3, 5, 5, 6]],
    [grep(["a|ab"]), "ab ab", [0, 2, 3, 5]],
    [grep(["ab", "b..b"]), "abxxbxxb", [0, 2, 4, 8]],
    [grep(["^|a"]), "aaa", [0, 1, 1, 2, 2, 3]],
    [literal("grep", ["é", "é🦊"]), "é🦊é", [0, 6, 6, 8]],
    [grep(["^a|b$"]), "aab", [0, 1, 2, 3]],
    [grep(["a"], { whole: true }), "aa", []],
    [grep(["a*"]), "ba", [0, 0, 1, 2, 2, 2]],
    [literal("grep", [""]), "é", [0, 0, 2, 2]],
  ] as const) {
    assert.deepEqual(spans(await run({ id: 1, descriptor, rows: [row(text, true)] })), [expected]);
  }
});

test("grep enumeration enforces independent retained match and result bounds", async () => {
  const input = { id: 1, descriptor: grep(["a"]), rows: [row("aa", true), row("a", true)] };
  assert.deepEqual(spans(await run(input, { maxMatchesPerLine: 2, maxTotalMatches: 3, maxResultBytes: 48 })), [[0, 1, 1, 2], [0, 1]]);
  for (const limits of [{ maxMatchesPerLine: 1 }, { maxTotalMatches: 2 }, { maxResultBytes: 47 }]) {
    const reply = await run(input, limits);
    assert.ok("error" in reply);
    assert.match(reply.error, /limit/);
  }
});


test("prepared ERE cursor authenticates programs and validates its subject only once", async () => {
  const ledger = new EreLedger({ maxExpansionBytes: 65536, maxExpansionFields: 8192 });
  const program = await compileEre([{ text: "a", literal: false }], ledger);
  const scan = await createEreSpanMatcher(program, "a".repeat(4096), ledger);
  const before = ledger.usage.work;
  assert.deepEqual(await scan(2048), { start: 2048, end: 2049 });
  assert.ok(ledger.usage.work - before < 64, "cursor must not rescan the whole subject");
  assert.equal(ledger.usage.captureBytes, 0, "span-only matching does not materialize capture strings");
  for (const cursor of [-1, 4097, NaN, 0.5]) await assert.rejects(scan(cursor), RangeError);
  await assert.rejects(createEreSpanMatcher({ ...program }, "a", ledger));
  await assert.rejects(createEreSpanMatcher(program, "é", ledger));
  const normal = await matchEre(program, "a", ledger);
  assert.equal(normal.matched, true);
  assert.deepEqual(normal.values, ["a"]);
});

test("enumeration is work-bounded and recovers after a refused hostile request", async () => {
  const worker = createBoundedRegexProvider({ maxWork: 2048 }).createWorker(defaults);
  try {
    const reply = await exchange(worker, { id: 1, descriptor: grep(["(a+)+b"]), rows: [row("a".repeat(64), true)] });
    assert.ok("error" in reply);
    assert.match(reply.error, /work|allocation|states/);
    assert.deepEqual(spans(await exchange(worker, { id: 2, descriptor: grep(["a"]), rows: [row("aa", true)] })), [[0, 1, 1, 2]]);
  } finally { await worker.terminate(); }
});

test("enumeration cancellation retains falsey identity and permits a subsequent session", async () => {
  const executor = new RegexExecutor(createBoundedRegexProvider({ maxWorkers: 1, maxMatchesPerLine: 4096, maxTotalMatches: 4096, maxResultBytes: 65536 }));
  const controller = new AbortController();
  const session = executor.open(controller.signal);
  const pending = session.run(grep(["a"]), [row("a".repeat(4096), true)]);
  const rejected = assert.rejects(pending, reason => reason === false);
  await new Promise<void>(resolve => setTimeout(resolve, 0));
  controller.abort(false);
  await rejected;
  await session.close();
  const recovered = executor.open(new AbortController().signal);
  try { assert.deepEqual(await recovered.run(grep(["a"]), [row("aa", true)]), [[{ start: 0, end: 1 }, { start: 1, end: 2 }]]); }
  finally { await recovered.close(); await executor.dispose(); }
});

test("enumeration caches absent and future candidates within a shared work budget", async () => {
  for (const [descriptor, count] of [[literal("grep", ["a", "z"]), 512], [grep(["a", "$"], { extended: true }), 514]] as const) {
    const reply = await run({ id: 1, descriptor, rows: [row("a".repeat(256), true)] }, {
      maxMatchesPerLine: 257, maxTotalMatches: 257, maxResultBytes: 4112, maxWork: 12000,
    });
    const found = spans(reply)[0]!;
    assert.equal(found.length, count);
    assert.deepEqual(found.slice(0, 4), [0, 1, 1, 2]);
  }
});

test("empty and mixed selection rows consume the same aggregate match allowance", async () => {
  const empty = await run({ id: 1, descriptor: grep([""]), rows: [row("abc", true)] }, { maxMatchesPerLine: 3 });
  assert.ok("error" in empty);
  assert.match(empty.error, /matches per line/);
  const mixed = { id: 1, descriptor: grep(["a"]), rows: [row("a"), row("aa", true)] };
  assert.deepEqual(spans(await run(mixed, { maxTotalMatches: 3 })), [[0, 1], [0, 1, 1, 2]]);
  const over = await run(mixed, { maxTotalMatches: 2 });
  assert.ok("error" in over);
  assert.match(over.error, /total match/);
});

test("ordinary ASCII grep patterns search UTF-8 HTML with original byte spans", async () => {
  const text = '<div class="section-title">⚽ Alternate Plan: Football Fans</div>';
  for (const extended of [false, true]) {
    for (const pattern of ["section-title", "Alternate Plan"]) {
      const start = Buffer.byteLength(text.slice(0, text.indexOf(pattern)));
      assert.deepEqual(spans(await run(request(grep([pattern], { extended }), [text]))), [[start, start + pattern.length]]);
    }
  }
  assert.deepEqual(spans(await run(request(grep(["absent"]), ["café ⚽"]))), [[]]);
});

test("UTF-8 regex enumeration consumes scalars and retains original byte offsets", async () => {
  for (const [pattern, expected] of [
    [".", [0, 2, 2, 6, 6, 7]],
    ["[^a]+", [0, 6]],
    ["[[:alpha:]]+", [6, 7]],
    ["^..a$", [0, 7]],
    ["", [0, 0, 2, 2, 6, 6, 7, 7]],
  ] as const) assert.deepEqual(spans(await run({ id: 1, descriptor: grep([pattern]), rows: [row("é🦊a", true)] })), [expected]);
});


test("prepared UTF-8 subject owns its input and rejects interior-byte cursors and foreign programs", async () => {
  const ledger = new EreLedger({ maxExpansionBytes: 65536, maxExpansionFields: 8192 });
  const program = await compileEre([{ text: ".", literal: false }], ledger);
  const bytes = new TextEncoder().encode("é🦊a");
  const preparing = prepareUtf8EreSubject(bytes, ledger);
  bytes.fill(120);
  const prepared = await preparing;
  const scan = prepared(program);
  assert.deepEqual(await scan(0), { start: 0, end: 2 });
  assert.deepEqual(await scan(2), { start: 2, end: 6 });
  assert.deepEqual(await scan(6), { start: 6, end: 7 });
  for (const cursor of [1, 3, 4, 5, -1, 8, NaN]) await assert.rejects(scan(cursor), RangeError);
  assert.throws(() => prepared({ ...program }), TypeError);
  const other = new EreLedger({ maxExpansionBytes: 65536, maxExpansionFields: 8192 });
  const foreign = await compileEre([{ text: ".", literal: false }], other);
  assert.throws(() => prepared(foreign), TypeError);
});

test("UTF-8 preparation and enumeration remain allocation/work bounded and cancellable", async () => {
  for (const options of [{ maxAllocationUnits: 512 }, { maxWork: 512 }]) {
    const reply = await run({ id: 1, descriptor: grep(["."]), rows: [row("🦊".repeat(256), true)] }, options);
    assert.ok("error" in reply);
    assert.match(reply.error, /allocation|work/);
  }
  const controller = new AbortController();
  const ledger = new EreLedger({ maxExpansionBytes: 65536, maxExpansionFields: 8192 });
  const pending = prepareUtf8EreSubject(new TextEncoder().encode("🦊".repeat(4096)), ledger, controller.signal);
  const rejected = assert.rejects(pending, reason => reason === false);
  controller.abort(false);
  await rejected;
});

test("ASCII-insensitive grep retains original spans for fixed BRE and ERE", async () => {
  for (const options of [{ fixed: true }, { extended: false }, { extended: true }]) {
    const descriptor = grep(["giraffe"], { ...options, insensitive: true });
    assert.deepEqual(spans(await run(request(descriptor, ["é GiRaFfE", "other"]))), [[3, 10], []]);
    assert.deepEqual(spans(await run({ id: 1, descriptor, rows: [row("GIRAFFE giraffe", true)] })), [[0, 7, 8, 15]]);
  }
});

test("ASCII-insensitive regex closes case sets before complement", async () => {
  for (const [pattern, text, expected] of [
    ["[^a]+", "aAébB", [2, 6]],
    ["[a-c]+", "xAbCy", [1, 4]],
    ["[[:upper:]]+", "éaZ", [2, 4]],
    ["[[:lower:]]+", "éZa", [2, 4]],
    ["^ab+$", "ABb", [0, 3]],
  ] as const) assert.deepEqual(spans(await run(request(grep([pattern], { insensitive: true }), [text]))), [expected]);
  const fixed = literal("grep", ["Éa"]);
  assert.deepEqual(spans(await run(request({ ...fixed, insensitive: true } as Descriptor, ["éA", "ÉA"]))), [[], [0, 3]]);
});

test("ordinary ERE stays case-sensitive and opted-in capture values retain original case", async () => {
  const ledger = new EreLedger({ maxExpansionBytes: 65536, maxExpansionFields: 8192 });
  const sensitive = await compileEre("(a+)", ledger);
  assert.equal((await matchEre(sensitive, "AA", ledger)).matched, false);
  const insensitive = await compileEre("(a+)", ledger, undefined, true);
  assert.deepEqual((await matchEre(insensitive, "AaA", ledger)).values, ["AaA", "AaA"]);
});

test("ASCII-insensitive matching preserves shared work and allocation bounds", async () => {
  for (const options of [{ maxWork: 512 }, { maxAllocationUnits: 512 }]) {
    const reply = await run({ id: 1, descriptor: grep(["a"], { insensitive: true }), rows: [row("A".repeat(1024), true)] }, options);
    assert.ok("error" in reply);
    assert.match(reply.error, /work|allocation/);
  }
  const reply = await run({ id: 1, descriptor: grep(["(a+)+b"], { insensitive: true }), rows: [row("A".repeat(64), true)] }, { maxStates: 32 });
  assert.ok("error" in reply);
  assert.match(reply.error, /states/);
});

test("ASCII-insensitive enumeration preserves live abort identity and worker reuse", async () => {
  const executor = new RegexExecutor(createBoundedRegexProvider({ maxWorkers: 1, maxMatchesPerLine: 4096, maxTotalMatches: 4096, maxResultBytes: 65536 }));
  const controller = new AbortController();
  const session = executor.open(controller.signal);
  const descriptor = grep(["a"], { insensitive: true });
  const pending = session.run(descriptor, [row("A".repeat(4096), true)]);
  const rejected = assert.rejects(pending, reason => reason === false);
  await new Promise<void>(resolve => setTimeout(resolve, 0));
  controller.abort(false);
  await rejected;
  await session.close();
  const recovered = executor.open(new AbortController().signal);
  try { assert.deepEqual(await recovered.run(descriptor, [row("aA", true)]), [[{ start: 0, end: 1 }, { start: 1, end: 2 }]]); }
  finally { await recovered.close(); await executor.dispose(); }
});

test("BRE escaped metacharacters and ordinary operators retain literal byte spans", async () => {
  for (const [pattern, subject, expected] of [
    ["upload\\.wikimedia\\.org", "é upload.wikimedia.org", [3, 23]],
    ["a+b?(x){2}|y", "a+b?(x){2}|y", [0, 12]],
    ["[+()?{}|]", "x+y", [1, 2]],
    ["\\[x\\]\\*\\^\\$\\\\", "[x]*^$\\", [0, 7]],
  ] as const) {
    const descriptor = grep([pattern], { extended: false });
    assert.deepEqual(spans(await run(request(descriptor, [subject]))), [expected]);
    assert.deepEqual(spans(await run({ id: 1, descriptor, rows: [row(subject, true)] })), [expected]);
  }
});

test("BRE bracket boundaries and escaped atoms do not leak ERE operator semantics", async () => {
  for (const [pattern, subject, expected] of [
    ["[[:alpha:]+]", "+", [0, 1]],
    ["]+", "]+", [0, 2]],
    ["[]+]", "]", [0, 1]],
    ["[^]+]", "a", [0, 1]],
    ["\\^*", "^^", [0, 2]],
    ["[\\]", "\\", [0, 1]],
    ["\\[a+\\]", "[a+]", [0, 4]],
  ] as const) assert.deepEqual(spans(await run(request(grep([pattern], { extended: false }), [subject]))), [expected]);
  assert.deepEqual(spans(await run(request(grep(["a+"], { extended: true }), ["aa"]))), [[0, 2]]);
  assert.deepEqual(spans(await run(request(grep(["a+"], { extended: false }), ["aa"]))), [[]]);
  assert.deepEqual(spans(await run(request(grep(["a+b"], { extended: false, insensitive: true, whole: true }), ["A+B"]))), [[0, 3]]);
  for (const pattern of ["a\\+", "a\\?", "\\(a\\)", "a\\{2\\}", "a\\|b", "\\1", "\\w", "a\\"]) {
    const result = await run(request(grep([pattern], { extended: false }), []));
    assert.ok("error" in result);
    assert.match(result.error, /unsupported/);
  }
});

test("BRE translation charges original source, work, and retained fragments", async () => {
  for (const [pattern, options, expected] of [
    ["\\.", { maxPatternBytes: 1 }, /pattern/],
    ["a+".repeat(1024), { maxWork: 128 }, /work/],
    ["a+".repeat(1024), { maxAllocationUnits: 128 }, /allocation/],
  ] as const) {
    const result = await run(request(grep([pattern], { extended: false }), []), options);
    assert.ok("error" in result);
    assert.match(result.error, expected);
  }
});

test("BRE translation preserves live cancellation and a subsequent worker session", async () => {
  const executor = new RegexExecutor(createBoundedRegexProvider({ maxWorkers: 1 }));
  const controller = new AbortController();
  const session = executor.open(controller.signal);
  const pending = session.run(grep(["a+".repeat(4096)], { extended: false }), [row("x")]);
  const rejected = assert.rejects(pending, reason => reason === false);
  await new Promise<void>(resolve => setTimeout(resolve, 0));
  controller.abort(false);
  await rejected;
  await session.close();
  const recovered = executor.open(new AbortController().signal);
  try { assert.deepEqual(await recovered.run(grep(["a+b"], { extended: false }), [row("a+b", true)]), [[{ start: 0, end: 3 }]]); }
  finally { await recovered.close(); await executor.dispose(); }
});

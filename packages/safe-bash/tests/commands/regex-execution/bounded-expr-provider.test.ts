import assert from "node:assert/strict";
import test from "node:test";
import { Shell } from "../../../src/shell/index.js";
import { createMemoryFileSystem } from "../../../src/fs/memory/index.js";
import { agentCommands } from "../../../src/index.js";
import { createBoundedRegexProvider, type BoundedRegexProviderOptions } from "../../../src/commands/regex-execution/bounded-provider.js";
import { RegexExecutor } from "../../../src/commands/regex-execution/portable.js";
import { defaults, exprMatchCeilings, type ExprMatchDescriptor, type ExprMatchReply } from "../../../src/commands/regex-execution/protocol.js";
import type { RegexWorker, RegexWorkerRequest } from "../../../src/commands/regex-execution/provider.js";

const bytes = (text: string) => new TextEncoder().encode(text);
const descriptor = (pattern: string, limits = exprMatchCeilings, profile: ExprMatchDescriptor["profile"] = "byte"): ExprMatchDescriptor => ({ kind: "expr-match", pattern: bytes(pattern), profile, limits });

async function exchange(worker: RegexWorker, request: RegexWorkerRequest): Promise<ExprMatchReply> {
  return new Promise((resolve, reject) => {
    const message = (reply: unknown) => {
      if (reply && typeof reply === "object" && "id" in reply) {
        worker.off("message", message);
        resolve(reply as ExprMatchReply);
      }
    };
    worker.on("message", message);
    try { worker.postMessage(request); }
    catch (error) { worker.off("message", message); reject(error); }
  });
}

test("bounded expr supports portable command length, captures and anchored nonmatches", async () => {
  const shell = new Shell({ fs: createMemoryFileSystem() }).use(agentCommands({ regexExecutor: createBoundedRegexProvider() }));
  try {
    for (const [source, stdout, exitCode] of [
      ["expr 2 + 3", "5\n", 0],
      ["expr abc : 'a.*'", "3\n", 0],
      ["expr abc : 'a\\(.\\)c'", "b\n", 0],
      ["expr ba : a", "0\n", 1],
      ["expr abc : '\\(\\)'", "\n", 1],
      ["LC_ALL=C.UTF-8 expr abc : 'a.*'", "3\n", 0],
    ] as const) {
      const result = await shell.exec(source);
      assert.equal(result.exitCode, exitCode, result.stderr);
      assert.equal(result.stdout, stdout, source);
      assert.equal(result.stderr, "", source);
    }
  } finally { await shell.dispose(); }
});

test("bounded expr preserves BRE longest-match, first capture, byte offsets and request reuse", async () => {
  const executor = new RegexExecutor(createBoundedRegexProvider());
  const session = executor.open(new AbortController().signal);
  try {
    for (const profile of ["byte", "utf8-scalar"] as const) {
      for (const [pattern, subject, overall, capture, hasCapture] of [
        ["a\\|ab", "ab", { start: 0, end: 2 }, null, false],
        ["\\(ab\\)\\1", "abab", { start: 0, end: 4 }, { start: 0, end: 2 }, true],
        ["\\(a*\\)a*", "aaa", { start: 0, end: 3 }, { start: 0, end: 3 }, true],
        ["\\(a\\)\\?b", "b", { start: 0, end: 1 }, null, true],
        ["\\(a\\)", "b", null, null, true],
        ["", "abc", { start: 0, end: 0 }, null, false],
        ["[[:digit:]]\\{1,3\\}", "1234", { start: 0, end: 3 }, null, false],
      ] as const) {
        const result = await session.matchExpr(descriptor(pattern, exprMatchCeilings, profile), bytes(subject));
        assert.deepEqual({ ...result, steps: 0 }, { offsetUnit: "byte", matched: overall !== null, hasCapture, overall, capture, steps: 0 });
        assert.ok(result.steps > 0 && result.steps <= exprMatchCeilings.maxSteps);
      }
    }
  } finally { await session.close(); await executor.dispose(); }
});

test("bounded expr keeps syntax, unsupported and limit failures distinct", async () => {
  const executor = new RegexExecutor(createBoundedRegexProvider());
  const session = executor.open(new AbortController().signal);
  try {
    for (const [pattern, subject, category] of [
      ["[", "", "syntax"], ["\\1", "a", "syntax"],
      ["\\w", "a", "unsupported"], ["\\(a*\\)*\\1", "a", "unsupported"],
      ["é", "a", "unsupported"], [".", "é", "unsupported"],
      ["\0", "a", "unsupported"], [".", "\0", "unsupported"],
    ] as const) await assert.rejects(session.matchExpr(descriptor(pattern), bytes(subject)), { category });
    for (const [limits, pattern, subject, message] of [
      [{ maxSteps: 512 }, "\\(a\\|aa\\)*b", "a".repeat(16), "work"],
      [{ maxAllocatedUnits: 80 }, "a*", "aaaa", "allocation"],
      [{ maxNodes: 3 }, "a*", "aaa", "nodes"],
      [{ maxStates: 2 }, "a*", "aaa", "states"],
      [{ maxDepth: 1 }, "\\(\\(a\\)\\)", "a", "depth"],
    ] as const) await assert.rejects(session.matchExpr(descriptor(pattern, { ...exprMatchCeilings, ...limits }), bytes(subject)), error =>
      error instanceof Error && "category" in error && error.category === "limit" && error.message.includes(message));
    assert.equal((await session.matchExpr(descriptor("a"), bytes("a"))).overall?.end, 1);
  } finally { await session.close(); await executor.dispose(); }
});

test("bounded expr provider limits lower descriptor allowances without mutating them", async () => {
  for (const [options, pattern, subject, diagnostic] of [
    [{ maxPatternBytes: 1 }, "a*", "a", "pattern"],
    [{ maxInputBytes: 1 }, "a", "aa", "input"],
    [{ maxResultBytes: 16 }, "\\(a\\)", "a", "result"],
    [{ maxWork: 512 }, "\\(a\\|aa\\)*b", "a".repeat(16), "work"],
    [{ maxAllocationUnits: 80 }, "a*", "aaaa", "allocation"],
    [{ maxStates: 2 }, "a*", "aaaa", "states"],
  ] satisfies [BoundedRegexProviderOptions, string, string, string][]) {
    const executor = new RegexExecutor(createBoundedRegexProvider(options));
    const session = executor.open(new AbortController().signal);
    const request = descriptor(pattern, Object.freeze({ ...exprMatchCeilings }));
    try {
      await assert.rejects(session.matchExpr(request, bytes(subject)), error =>
        error instanceof Error && "category" in error && error.category === "limit" && error.message.includes(diagnostic));
      assert.deepEqual(request.limits, exprMatchCeilings);
    } finally { await session.close(); await executor.dispose(); }
  }
});

test("bounded expr snapshots direct requests and rejects data accessors without invoking them", async () => {
  const worker = createBoundedRegexProvider().createWorker(defaults);
  try {
    const selected = descriptor("\\(a*\\)", { ...exprMatchCeilings });
    const subject = bytes("aaa!");
    const request = { id: 1, descriptor: selected, rows: [{ bytes: subject, all: false, terminated: false }] };
    const waiting = exchange(worker, request);
    selected.pattern.fill(120);
    subject.fill(120);
    Object.assign(selected.limits, { maxSteps: 1 });
    const reply = await waiting;
    assert.ok("result" in reply, JSON.stringify(reply));
    assert.deepEqual(reply.result.capture, { start: 0, end: 3 });
    let accessed = false;
    const malformed = descriptor("a");
    Object.defineProperty(malformed, "pattern", { get() { accessed = true; throw new Error("accessor invoked"); } });
    const rejected = await exchange(worker, { ...request, id: 2, descriptor: malformed });
    assert.ok("error" in rejected);
    assert.equal(accessed, false);
  } finally { await worker.terminate(); }
});

test("bounded expr cancellation and active deadlines await retirement and return provider capacity", async context => {
  context.mock.timers.enable({ apis: ["setTimeout"] });
  const provider = createBoundedRegexProvider({ maxWorkers: 1 });
  const executor = new RegexExecutor(provider, { maxWorkers: 1, requestTimeoutMs: 1000 });
  for (const reason of [false, null, 0]) {
    const controller = new AbortController();
    const session = executor.open(controller.signal);
    try {
      const pending = session.matchExpr(descriptor("\\(a\\|aa\\)*b"), bytes("a".repeat(128)));
      const rejected = assert.rejects(pending, error => error === reason);
      await new Promise<void>(resolve => setImmediate(resolve));
      controller.abort(reason);
      await rejected;
    } finally { await session.close(); }
  }
  const session = executor.open(new AbortController().signal);
  try {
    const pending = session.matchExpr(descriptor("\\(a\\|aa\\)*b"), bytes("a".repeat(128)));
    const rejected = assert.rejects(pending, { code: "REQUEST_TIMEOUT" });
    await new Promise<void>(resolve => setImmediate(resolve));
    context.mock.timers.tick(1000);
    await rejected;
    assert.equal((await session.matchExpr(descriptor("a"), bytes("a"))).overall?.end, 1);
  } finally { await session.close(); await executor.dispose(); }
  const replacement = provider.createWorker(defaults);
  await replacement.terminate();
});

test("bounded expr yields with portable timers and never calls native RegExp", async context => {
  const immediate = Object.getOwnPropertyDescriptor(globalThis, "setImmediate")!;
  Object.defineProperty(globalThis, "setImmediate", { ...immediate, value: undefined });
  context.after(() => { Object.defineProperty(globalThis, "setImmediate", immediate); });
  context.mock.method(globalThis, "RegExp", () => { throw new Error("native RegExp fallback invoked"); });
  const executor = new RegexExecutor(createBoundedRegexProvider({ maxWork: 512 }));
  const session = executor.open(new AbortController().signal);
  try {
    assert.equal((await session.matchExpr(descriptor("a.*"), bytes("abc"))).overall?.end, 3);
    await assert.rejects(session.matchExpr(descriptor("\\(a\\|aa\\)*b"), bytes("a".repeat(16))), error =>
      error instanceof Error && "category" in error && error.category === "limit" && error.message.includes("work"));
    assert.equal((await session.matchExpr(descriptor("a"), bytes("a"))).overall?.end, 1);
  } finally { await session.close(); await executor.dispose(); }
});

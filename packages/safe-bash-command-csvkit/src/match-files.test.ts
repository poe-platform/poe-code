import assert from "node:assert/strict";
import { test } from "vitest";
import { parseArguments } from "./cli/parser.js";

const args = ["-f", "matches"].map(value => new TextEncoder().encode(value));
const limits = { maxArguments: 10, maxArgumentBytes: 100 };

test("FileType opens without reading content and transfers a disposable handle", async () => {
  let reads = 0;
  let closes = 0;
  const handle = {
    async *lines() { reads++; yield "match\n"; },
    async close() { closes++; }
  };
  const result = await parseArguments("csvgrep", args, { limits, async openMatchFile() { return handle; } });
  if (result.kind !== "parsed") assert.fail("expected parsed namespace");
  assert.equal(reads, 0);
  assert.equal(result.options.matchfile, handle);
  await result.dispose();
  await result.dispose();
  assert.equal(closes, 1);
});

test("help exit closes eagerly opened files without reading", async () => {
  let closes = 0;
  const handle = { lines(): AsyncIterable<string> { throw new Error("must not read"); }, async close() { closes++; } };
  const result = await parseArguments("csvgrep", [...args, new TextEncoder().encode("--help")], {
    limits, async openMatchFile() { return handle; }
  });
  if (result.kind !== "exit") assert.fail("expected help exit");
  assert.equal(result.status, 0);
  assert.equal(closes, 1);
});

test("registered cleanup precedes acquisition and drains an admitted open", async () => {
  let cleanup: (() => Promise<void>) | undefined;
  let resolveOpen: ((handle: { lines(): AsyncIterable<string>; close(): Promise<void> }) => void) | undefined;
  let closes = 0;
  let opened = false;
  const handle = { async *lines() { yield "match"; }, async close() { closes++; } };
  const result = parseArguments("csvgrep", args, {
    limits,
    registerCleanup(fn) { cleanup = fn; },
    openMatchFile() {
      assert.ok(cleanup, "cleanup must precede acquisition");
      opened = true;
      return new Promise(resolve => { resolveOpen = resolve; });
    }
  });
  const outcome = result.then(value => ({ value }), error => ({ error }));
  for (let turn = 0; turn < 20 && !opened; turn++) await Promise.resolve();
  assert.ok(opened, "open must be admitted");
  const closing = cleanup!();
  resolveOpen!(handle);
  await closing;
  const settled = await outcome;
  assert.ok("error" in settled);
  assert.match(String(settled.error), /match-file scope closed/);
  assert.equal(closes, 1);
});

test("cleanup before acquisition blocks factories and parsed ownership transfer", async () => {
  let opens = 0;
  const context = {
    limits,
    registerCleanup(cleanup: () => Promise<void>) { void cleanup(); },
    async openMatchFile() { opens++; throw new Error("must not open"); }
  };
  await assert.rejects(parseArguments("csvgrep", args, context), /match-file scope closed/);
  assert.equal(opens, 0);
  await assert.rejects(parseArguments("csvgrep", [], context), /match-file scope closed/);
});

test("scope disposal closes every admitted handle even when opens or closes fail", async () => {
  const { MatchFileScope } = await import("./match-files.js");
  const scope = new MatchFileScope();
  const failure = new Error("close failed");
  let closes = 0;
  const opened = scope.acquire(async () => ({
    async *lines() { yield "match"; },
    async close() { closes++; throw failure; }
  }));
  const other = scope.acquire(async () => ({
    async *lines() { yield "other"; },
    async close() { closes++; }
  }));
  const rejected = scope.acquire(async () => { throw new Error("open failed"); });
  const openingResults = Promise.allSettled([opened, other, rejected]);
  const disposal = scope.dispose();
  assert.equal(scope.dispose(), disposal);
  await assert.rejects(disposal, error => error instanceof AggregateError && error.errors.length === 1 && error.errors[0] === failure);
  await openingResults;
  assert.equal(closes, 2);
  assert.throws(() => scope.acquire(async () => { throw new Error("must not dispatch"); }), /scope closed/);
});

test("parser errors close all overwritten match-file handles", async () => {
  let closes = 0;
  const repeated = ["-f", "first", "-f", "second", "-K", "invalid"].map(value => new TextEncoder().encode(value));
  const result = await parseArguments("csvgrep", repeated, {
    limits, async openMatchFile() { return { lines(): AsyncIterable<string> { throw new Error("must not read"); }, async close() { closes++; } }; }
  });
  if (result.kind !== "exit") assert.fail("expected parser error");
  assert.equal(result.status, 2);
  assert.equal(closes, 2);
});

test("caller cancellation wins after close failure is observed", async () => {
  const controller = new AbortController();
  const cancellation = new Error("caller cancelled");
  let closes = 0;
  await assert.rejects(parseArguments("csvgrep", args, {
    limits, signal: controller.signal,
    async openMatchFile() {
      controller.abort(cancellation);
      return { async *lines() { yield "unused"; }, async close() { closes++; throw new Error("close failed"); } };
    }
  }), error => error === cancellation);
  assert.equal(closes, 1);
});

test("escaping acquisition failure wins over cleanup failure", async () => {
  let cleanup: (() => Promise<void>) | undefined;
  let opens = 0;
  let closes = 0;
  const failure = new Error("escaping open failure");
  const repeated = ["-f", "first", "-f", "second"].map(value => new TextEncoder().encode(value));
  await assert.rejects(parseArguments("csvgrep", repeated, {
    limits, registerCleanup(fn) { cleanup = fn; },
    async openMatchFile() {
      if (opens++) { void cleanup!().catch(() => {}); throw failure; }
      return { async *lines() { yield "unused"; }, async close() { closes++; throw new Error("close failed"); } };
    }
  }), error => error === failure);
  assert.equal(closes, 1);
});

test("cleanup-only failure escapes parser exit", async () => {
  const failure = new Error("close failed");
  await assert.rejects(parseArguments("csvgrep", [...args, new TextEncoder().encode("--help")], {
    limits, async openMatchFile() { return { async *lines() { yield "unused"; }, async close() { throw failure; } }; }
  }), error => error instanceof AggregateError && error.errors[0] === failure);
});

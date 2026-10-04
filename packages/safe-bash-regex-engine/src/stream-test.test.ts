import assert from "node:assert/strict";
import test from "node:test";
import { BytePattern, Pattern } from "./text/regex.js";

const budget = () => ({ maxBufferBytes: Infinity, step() {}, checkpoint() {} });

test("byte patterns explicitly decline streaming when Unicode decoding is required", async () => {
  const pattern = new BytePattern("^.$");
  assert.equal(await pattern.supportsStreamTest(budget()), false);
  const source = { async *[Symbol.asyncIterator]() { yield String.fromCharCode(195, 169); } };
  await assert.rejects(pattern.testStream(source, budget()), /non-streaming/);
  const bytes = { ...budget(), regexByteMode: true };
  assert.equal(await pattern.supportsStreamTest(bytes), true);
  assert.equal(await pattern.testStream(source, bytes), false);
});

test("stream existence matches buffered sed patterns across UTF-16 chunk boundaries", async () => {
  const patterns = ["", "^$", "a", "a$", "^a", "a.*b", "(a|b)*c", "(a?)*b", "\\bword\\b", "\\<word\\>", "\\B", "[[:space:]]+$", "(ab){1,3}", "😀+", ".", "^.*$", "\ud83d", "\ude00", "^\ud83d", "\ude00$"];
  const inputs = ["", "a", "ab", "aac", "bbbc", "word", " word!", "sword", "a\nb", " \t\r", "😀😀", "x😀y", "\ud800", "ababab"];
  for (const expression of patterns) for (const input of inputs) {
    const pattern = new Pattern(expression);
    assert.equal(await pattern.supportsStreamTest(budget()), true);
    for (const size of [1, 2, 5]) {
      const chunks = { async *[Symbol.asyncIterator]() { for (let at = 0; at < input.length; at += size) yield input.slice(at, at + size); } };
      assert.equal(await pattern.testStream(chunks, budget()), !!await pattern.find(input, budget()), JSON.stringify({ expression, input, size }));
    }
  }
});

test("stream testing declines captures requiring replay without consuming input", async () => {
  const pattern = new Pattern("(a)\\1");
  assert.equal(await pattern.supportsStreamTest(budget()), false);
  await assert.rejects(pattern.testStream({ async *[Symbol.asyncIterator]() { assert.fail("consumed unsupported source"); yield ""; } }, budget()), /stream/);
});

test("stream testing retires its source on match and checkpoint cancellation", async () => {
  for (const cancel of [false, true]) {
    let retired = false;
    const reason = new Error("cancelled");
    const chunks = { async *[Symbol.asyncIterator]() { try { yield "a".repeat(4096); assert.fail("read after match or cancellation"); } finally { retired = true; } } };
    const pattern = new Pattern(cancel ? "z$" : "a");
    let checkpoints = 0;
    const limits = { ...budget(), checkpoint() { if (++checkpoints > 3 && cancel) throw reason; } };
    if (cancel) await assert.rejects(pattern.testStream(chunks, limits), error => error === reason);
    else assert.equal(await pattern.testStream(chunks, limits), true);
    assert.equal(retired, true);
  }
});

test("stream matching admits bounded state and checks reused-pattern cancellation before consumption", async () => {
  for (const expression of ["literal", "[ab]+$"]) {
    const pattern = new Pattern(expression);
    await pattern.supportsStreamTest(budget());
    const source = { async *[Symbol.asyncIterator]() { assert.fail("source consumed before admission"); yield ""; } };
    await assert.rejects(pattern.testStream(source, { ...budget(), maxBufferBytes: 1 }), /buffer limit/);
    const reason = new Error("already cancelled");
    await assert.rejects(pattern.testStream(source, { ...budget(), checkpoint() { throw reason; } }), error => error === reason);
  }
});

test("stream matching observes cancellation when the source completes", async () => {
  for (const expression of ["^$", "[ab]*$"]) {
    let cancelled = false;
    const reason = new Error("source retired");
    const source = { async *[Symbol.asyncIterator]() { yield ""; cancelled = true; } };
    await assert.rejects(new Pattern(expression).testStream(source, { ...budget(), checkpoint() { if (cancelled) throw reason; } }), error => error === reason);
  }
});

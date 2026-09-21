import assert from "node:assert/strict";
import { test } from "node:test";
process.env.TSX_DISABLE_CACHE = "1";
const { tsImport } = await import("tsx/esm/api");
const original = await tsImport(
  "../../toolcraft-design/src/dashboard/output-preview.ts",
  import.meta.url
);
const strings = await tsImport(
  "../../toolcraft-design/src/dashboard/terminal-strings.ts",
  import.meta.url
);
const own = await import("../dist/index.js");
const samples = [
  "plain 🌍 text",
  "a\x1b]private\x07b",
  "a\x1bPprivate\x1b\\b",
  "a\u009dprivate\u009cb",
  "a\x1b[31mred\x1b[0m",
  "a\x1b[123\x18visible",
  "a\x1b]private\x1aunhidden",
  "a\x1b[123\x1b[1mend",
  "a\x1b[3🌍1mred",
  "a\x1b[" + "1".repeat(2048) + "mend",
  "a\x1b]unterminated",
  "a\x1b",
  "x\ud800\udfff\ud800",
  "\u0090hidden\x07stillhidden\u009cvisible"
];
test("portable terminal filter matches every split boundary and keeps separate stream state", () => {
  for (const input of samples)
    for (let split = 0; split <= input.length; split++) {
      const expected = strings.createTerminalStringFilter(),
        actual = own.createTerminalStringFilter();
      for (const chunk of [input.slice(0, split), input.slice(split), "\x1b\\final"])
        assert.equal(actual.push(chunk), expected.push(chunk));
    }
  const first = own.createTerminalStringFilter(),
    second = own.createTerminalStringFilter();
  assert.equal(first.push("\x1b]secret"), "");
  assert.equal(second.push("visible"), "visible");
  assert.equal(first.push("\x07visible"), "visible");
  const { push } = second;
  assert.equal(push("detached"), "detached");
});
test("preview tail preserves exact UTF-16, line preference, CSI boundaries and budget coercion", () => {
  for (const input of [
    ...samples,
    "prefix\nlatest\nlast",
    "a🌍b",
    "a\udfffz",
    "x".repeat(20000) + "\x1b[31mending"
  ])
    for (const budget of [
      -Infinity,
      -1,
      0,
      1,
      2,
      3,
      5,
      8,
      16,
      16384,
      20000,
      2.5,
      NaN,
      Infinity,
      undefined,
      null,
      "2.5"
    ])
      if (budget !== -Infinity || (!input.includes("\x1b") && !input.includes("\u009b")))
        assert.equal(own.retainOutputTail(input, budget), original.retainOutputTail(input, budget));
  for (const api of [own, original]) {
    let calls = 0;
    assert.equal(
      api.retainOutputTail("abcdef", {
        valueOf() {
          calls++;
          return 3;
        }
      }),
      "def"
    );
    assert.equal(calls, 1);
    assert.throws(() => api.retainOutputTail("abcdef", 2n), TypeError);
    const reason = new Error("budget");
    assert.throws(
      () =>
        api.retainOutputTail("abcdef", {
          valueOf() {
            throw reason;
          }
        }),
      (error) => error === reason
    );
  }
});
test("bounded preview matches original for oversized bursts, hidden controls and seeded tiny deltas", () => {
  assert.equal(own.dashboard.limitOutputPreview, own.limitOutputPreview);
  assert.equal(own.dashboard.createOutputPreviewBuffer, own.createOutputPreviewBuffer);
  assert.equal(own.MAX_OUTPUT_PREVIEW_CHARS, original.MAX_OUTPUT_PREVIEW_CHARS);
  assert.equal(own.OUTPUT_TRUNCATION_NOTICE, original.OUTPUT_TRUNCATION_NOTICE);
  for (const input of samples)
    assert.equal(own.limitOutputPreview(input), original.limitOutputPreview(input));
  for (const size of [16383, 16384, 16385, 32768])
    for (const ending of samples) {
      const input = "🌍x".repeat(size) + ending;
      assert.equal(own.limitOutputPreview(input), original.limitOutputPreview(input));
    }
  let seed = 20260921;
  const random = () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed;
  };
  const expected = original.createOutputPreviewBuffer(),
    actual = own.createOutputPreviewBuffer();
  for (let index = 0; index < 8192; index++) {
    const chunk =
      index % 101 === 0
        ? "burst\n" + "x".repeat(20000)
        : samples[random() % samples.length].slice(0, random() % 32);
    expected.push(chunk);
    actual.push(chunk);
    if (index % 13 === 0) assert.equal(actual.text(), expected.text());
  }
  assert.equal(actual.text(), expected.text());
  const { push, text } = actual;
  push("detached");
  assert.equal(text(), actual.text());
});

test("negative-infinite budgets terminate for control-bearing text without retaining content", () => {
  for (const input of samples) assert.equal(own.retainOutputTail(input, -Infinity), "");
});

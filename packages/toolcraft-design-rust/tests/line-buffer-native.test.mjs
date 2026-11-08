import assert from "node:assert/strict";
import { test } from "node:test";
process.env.TSX_DISABLE_CACHE = "1";
const { tsImport } = await import("tsx/esm/api");
const original = await tsImport(
  "../../toolcraft-design/src/dashboard/line-buffer.ts",
  import.meta.url
);
const own = await import("../dist/line-buffer.js");
const samples = [
  "first\r\nnext",
  "\n\n",
  "🌍\ud800\udfff",
  "\x1b]hidden\nsecret\x07visible",
  "\x1bPprivate\x1b\\visible",
  "\x1b[31mred\x1b[0m",
  "x".repeat(20000) + "\r\nlast",
  "\x1b[" + "1".repeat(2048) + "mend"
];
test("line buffers match split boundaries, budgets and detached methods", () => {
  for (const sample of samples)
    for (const split of [
      ...new Set([0, 1, 2, 3, 8, 32, 16384, sample.length - 1, sample.length])
    ].filter((i) => i >= 0 && i <= sample.length)) {
      const a = [],
        b = [],
        expected = original.createDashboardLineBuffer((x) => a.push(x)),
        actual = own.createDashboardLineBuffer((x) => b.push(x));
      for (const chunk of [sample.slice(0, split), sample.slice(split), "\x07\x1b\\final\r"]) {
        expected.push(chunk);
        actual.push(chunk);
        assert.equal(actual.preview(), expected.preview());
        assert.deepEqual(b, a);
      }
      expected.flush();
      const { flush } = actual;
      flush();
      assert.deepEqual(b, a);
      assert.equal(actual.preview(), expected.preview());
    }
});
function observed(api, mode) {
  const events = [];
  let b,
    once = false;
  const reason = new Error("emit");
  b = api.createDashboardLineBuffer((line) => {
    events.push([line, b.preview()]);
    if (!once) {
      once = true;
      if (mode === "throw") throw reason;
      if (mode === "push") b.push("nested\nnew");
      else if (mode === "flush") b.flush();
    }
  });
  b.push("before");
  try {
    b.push(" one\ntwo\nlast");
  } catch (e) {
    assert.equal(e, reason);
    events.push("thrown");
  }
  events.push(b.preview());
  b.flush();
  events.push(b.preview());
  return events;
}
test("callbacks retain preview state, reentrancy and thrown error identity", () => {
  for (const mode of ["throw", "push", "flush"])
    assert.deepEqual(observed(own, mode), observed(original, mode));
});
function stream(api, chunks) {
  const events = [];
  const ids = new Map();
  const b = api.createStreamingDashboardLineBuffer((line, id) => {
    if (!ids.has(id)) ids.set(id, ids.size);
    events.push([line, ids.get(id)]);
  });
  for (const chunk of chunks) b.push(chunk);
  b.flush();
  b.flush();
  b.push("after");
  b.flush();
  return events;
}
test("streaming IDs rotate only after completed lines and unchanged previews are suppressed", () => {
  for (const chunks of [
    samples,
    ["first", "\r", "\nsecond", "\n", "\n", "third"],
    ["visible", "\x1b]hidden", "secret", "\x07", " result", "\n"]
  ])
    assert.deepEqual(stream(own, chunks), stream(original, chunks));
});
test("seeded streams preserve omission state through throwing and nested oversized callbacks", () => {
  let seed = 20260921;
  const random = () => (seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0);
  const a = [],
    b = [],
    expected = original.createDashboardLineBuffer((line) => a.push(line)),
    actual = own.createDashboardLineBuffer((line) => b.push(line));
  for (let i = 0; i < 4096; i++) {
    const source = samples[random() % samples.length],
      start = random() % source.length,
      chunk = source.slice(start, start + (random() % 64));
    expected.push(chunk);
    actual.push(chunk);
    if (i % 19 === 0) {
      assert.deepEqual(b, a);
      assert.equal(actual.preview(), expected.preview());
    }
    if (i % 127 === 0) {
      expected.flush();
      actual.flush();
    }
  }
  expected.flush();
  actual.flush();
  assert.deepEqual(b, a);
  function nested(api, throwing) {
    let once = false;
    const events = [],
      reason = Object.freeze({ failure: true });
    const buffer = api.createDashboardLineBuffer((line) => {
      events.push(line);
      if (!once) {
        once = true;
        buffer.push("z".repeat(20000));
        if (throwing) throw reason;
      }
    });
    buffer.push("x".repeat(20000));
    try {
      buffer.push("\nsecond\nlast");
    } catch (error) {
      assert.equal(error, reason);
    }
    events.push(buffer.preview());
    buffer.flush();
    return events;
  }
  for (const throwing of [true, false])
    assert.deepEqual(nested(own, throwing), nested(original, throwing));
});

test("line buffer factories are interchangeable at both root and dashboard exports", async () => {
  const root = await import("../dist/index.js");
  assert.equal(root.createDashboardLineBuffer, root.dashboard.createDashboardLineBuffer);
  assert.equal(
    root.createStreamingDashboardLineBuffer,
    root.dashboard.createStreamingDashboardLineBuffer
  );
});

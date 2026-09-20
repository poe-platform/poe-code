import assert from "node:assert/strict";
import { test } from "node:test";
import { planPageSequence, requireRendererFeatures, type PageSequenceOptions } from "./index.js";

const options: PageSequenceOptions = {
  copies: 1, collate: true, pageOffset: 0,
  limits: { maxObjects: 8, maxPhysicalPages: 32, maxWork: 128 },
};

test("uncounted objects print all pages without advancing logical numbers or suppressing outline pages", () => {
  const result = planPageSequence([
    { physicalPages: 2, pagesCount: false },
    { physicalPages: 2, pagesCount: true },
  ], options);
  assert.equal(result.logicalTotal, 2);
  assert.equal(result.outlineTotal, 4);
  assert.deepEqual(result.pages.map(p => [p.logicalPage, p.outlinePage]), [[1, 1], [1, 2], [1, 3], [2, 4]]);
});

test("collated copies reset logical numbering and repeat the entire document", () => {
  const result = planPageSequence([{ physicalPages: 2, pagesCount: true }], { ...options, copies: 2, pageOffset: 7 });
  assert.deepEqual(result.pages.map(p => [p.pageIndex, p.copyIndex, p.logicalPage, p.outputPage]),
    [[0, 0, 8, 1], [1, 0, 9, 2], [0, 1, 8, 3], [1, 1, 9, 4]]);
});

test("uncollated copies repeat each physical page before advancing", () => {
  const result = planPageSequence([{ physicalPages: 2, pagesCount: true }], { ...options, copies: 2, collate: false });
  assert.deepEqual(result.pages.map(p => [p.pageIndex, p.copyIndex, p.logicalPage]), [[0, 0, 1], [0, 1, 1], [1, 0, 2], [1, 1, 2]]);
});

test("zero-page objects do not manufacture the native outline placeholder", () => {
  const result = planPageSequence([{ physicalPages: 0, pagesCount: false }], options);
  assert.deepEqual(result, { pages: [], logicalTotal: 0, outlineTotal: 0 });
});

test("admission bounds multiplied output and work before retaining page records", () => {
  assert.throws(() => planPageSequence([{ physicalPages: 17, pagesCount: false }], { ...options, copies: 2 }), { code: "LIMIT_EXCEEDED" });
  assert.throws(() => planPageSequence([{ physicalPages: Number.MAX_SAFE_INTEGER, pagesCount: true }], { ...options, copies: 2 }), { code: "LIMIT_EXCEEDED" });
  assert.throws(() => planPageSequence([{ physicalPages: 2, pagesCount: true }], { ...options, limits: { ...options.limits, maxWork: 1 } }), { code: "LIMIT_EXCEEDED" });
});

test("reject unchecked values, including limits, rather than coercing them", () => {
  for (const physicalPages of [-1, 0.5, Infinity, NaN]) {
    assert.throws(() => planPageSequence([{ physicalPages, pagesCount: true }], options), { code: "INVALID_VALUE" });
  }
  assert.throws(() => planPageSequence([], { ...options, copies: 0 }), { code: "INVALID_VALUE" });
  assert.throws(() => planPageSequence([], { ...options, pageOffset: Number.MAX_SAFE_INTEGER }), { code: "INVALID_VALUE" });
});

test("cancel before admission with exact falsey reason", () => {
  const controller = new AbortController();
  controller.abort(null);
  let caught: unknown = "not thrown";
  try { planPageSequence([], { ...options, signal: controller.signal }); } catch (error) { caught = error; }
  assert.equal(caught, null);
});

test("flex and grid gates are independent and never fall back to block layout", () => {
  const profile = { id: "static-first-party-test", features: ["block-inline", "flex"] as const };
  requireRendererFeatures(profile, ["flex"]);
  assert.throws(() => requireRendererFeatures(profile, ["grid"]), { code: "UNSUPPORTED_CAPABILITY" });
  assert.throws(() => requireRendererFeatures(profile, ["computed-css"]), { code: "UNSUPPORTED_CAPABILITY" });
});

test("work includes repeated traversal of zero-page objects in collated copies", () => {
  const objects = [
    { physicalPages: 0, pagesCount: true },
    { physicalPages: 1, pagesCount: true },
  ];
  assert.throws(() => planPageSequence(objects, {
    ...options, copies: 32,
    limits: { ...options.limits, maxWork: 64 },
  }), { code: "LIMIT_EXCEEDED" });
});

test("feature declarations cannot qualify unknown renderer capabilities", () => {
  assert.throws(() => requireRendererFeatures({ id: "static-test", features: ["unknown" as "flex"] }, ["unknown" as "flex"]), { code: "INVALID_VALUE" });
});

test("exhaustive small counts preserve output multiplicities and independent totals", () => {
  for (let first = 0; first <= 2; first++) for (let second = 0; second <= 2; second++) {
    for (const firstCounted of [false, true]) for (const secondCounted of [false, true]) {
      for (const collate of [false, true]) for (let copies = 1; copies <= 3; copies++) {
        const result = planPageSequence([
          { physicalPages: first, pagesCount: firstCounted },
          { physicalPages: second, pagesCount: secondCounted },
        ], { ...options, copies, collate, pageOffset: -2 });
        assert.equal(result.pages.length, (first + second) * copies);
        assert.equal(result.logicalTotal, (firstCounted ? first : 0) + (secondCounted ? second : 0));
        assert.equal(result.outlineTotal, first + second);
        assert.deepEqual(result.pages.map(p => p.outputPage), Array.from({ length: result.pages.length }, (_, i) => i + 1));
        for (let objectIndex = 0; objectIndex < 2; objectIndex++) {
          const count = objectIndex === 0 ? first : second;
          for (let pageIndex = 0; pageIndex < count; pageIndex++) {
            const records = result.pages.filter(p => p.objectIndex === objectIndex && p.pageIndex === pageIndex);
            assert.equal(records.length, copies);
            assert.equal(new Set(records.map(p => p.copyIndex)).size, copies);
            assert.equal(new Set(records.map(p => p.logicalPage)).size, 1);
            assert.equal(new Set(records.map(p => p.outlinePage)).size, 1);
          }
        }
      }
    }
  }
});

test("cancellation observed after layout admission preserves the original reason", () => {
  const controller = new AbortController();
  const reason = { marker: "cancel during admission" };
  const object = {
    get physicalPages() { controller.abort(reason); return 1; },
    pagesCount: true,
  };
  assert.throws(() => planPageSequence([object], { ...options, signal: controller.signal }), error => error === reason);
});

import { expect, it } from "vitest";
import { measurePackageResourceSerialization } from "./ancillary-resources.js";
import { DocumentBudget } from "./budget.js";

const cases = [
  ["null", null], ["true", true], ["false", false], ["zero", { value: 0 }],
  ["negative-fraction", { value: -2.25 }], ["empty-string", ""], ["ascii", "Coast"],
  ["quotes-backslash", '"\\"'], ["short-escapes", "\b\t\n\f\r"], ["long-escapes", "\u0000\u0001\u001f"],
  ["bmp", "海ë"], ["astral", "🌊"], ["lone-high", "\ud800"], ["lone-low", "\udfff"],
  ["ascii-511", "a".repeat(511)], ["ascii-512", "a".repeat(512)], ["ascii-513", "a".repeat(513)],
  ["pair-before-boundary", "a".repeat(510) + "🌊" + "海"],
  ["pair-across-boundary", "a".repeat(511) + "🌊" + "海"],
  ["escapes-across-boundary", "a".repeat(511) + '"\\\u0000海🌊'],
  ["repeated-pair-boundaries", ("a".repeat(511) + "🌊").repeat(4)],
  ["empty-array", []], ["nested-values", { values: [null, false, 0, "海🌊", { empty: "", absent: undefined }] }],
  ["escaped-keys", { '海"\\🌊': "\ud800\n", empty: {} }]
] as const;

for (const [name, value] of cases) for (const capacity of ["exact", "one-below"] as const)
it(`inventory JSON measurement matches independent UTF8 JSON bytes; case=${name}; capacity=${capacity}`, () => {
  const bytes = new TextEncoder().encode(JSON.stringify(value)).length;
  const budget = new DocumentBudget({ serializedOutput: capacity === "exact" ? bytes : bytes - 1 });
  if (capacity === "exact") expect(measurePackageResourceSerialization(value, budget)).toBe(bytes);
  else expect(() => measurePackageResourceSerialization(value, budget)).toThrowError(expect.objectContaining({ code: "limit-exceeded" }));
});

it("inventory JSON measurement retains cancellation admission", () => {
  const controller = new AbortController(), budget = new DocumentBudget({}, controller.signal);
  controller.abort();
  expect(() => measurePackageResourceSerialization({ name: "a".repeat(2048) }, budget)).toThrowError(expect.objectContaining({ code: "cancelled" }));
});

it("inventory JSON measurement retains the original complete string work reservation", () => {
  const budget = new DocumentBudget({ work: 514 });
  expect(measurePackageResourceSerialization("a".repeat(512), budget)).toBe(514);
  expect(budget.usage.work).toBe(514);
  const insufficient = new DocumentBudget({ work: 513 });
  expect(() => measurePackageResourceSerialization("a".repeat(512), insufficient)).toThrowError(expect.objectContaining({ code: "limit-exceeded" }));
});

import { expect, it } from "vitest";
import { intrinsicDataRoots } from "./intrinsic-data-roots.js";
import { measureSandboxData } from "./values.js";

it.each([false, true])("deduplicates projections against reachable owners in either order: %s", reverse => {
  const target = { extra: "x".repeat(350) };
  const root = {};
  intrinsicDataRoots.set(root, { target, values: ["extra", target.extra] });
  const roots = reverse ? [root, target] : [target, root];
  expect(measureSandboxData(roots)).toBe(measureSandboxData([target]));
});

it("keeps mutations charged when only the projection is rooted", () => {
  const root = {};
  intrinsicDataRoots.set(root, { target: {}, values: ["extra", "x".repeat(350)] });
  expect(measureSandboxData([root])).toBe(355);
});

it.each([false, true])("deduplicates owners reached through other projections: %s", reverse => {
  const target = { extra: "x".repeat(350) };
  const first = {};
  const second = {};
  intrinsicDataRoots.set(first, { target, values: ["extra", target.extra] });
  intrinsicDataRoots.set(second, { target: {}, values: ["link", target] });
  expect(measureSandboxData(reverse ? [second, first] : [first, second]))
    .toBe(4 + measureSandboxData([target]));
});

it("does not deduplicate equal primitive values belonging to different owners", () => {
  const roots = [{}, {}];
  for (const root of roots) intrinsicDataRoots.set(root, { target: {}, values: ["extra", "same"] });
  expect(measureSandboxData(roots)).toBe(18);
});

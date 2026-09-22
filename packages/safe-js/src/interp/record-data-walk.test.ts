import { expect, it } from "vitest";
import { MAX_DATA_DEPTH } from "../graph-depth.js";
import { createSandboxClosure, measureSandboxData } from "./values.js";

function chain(depth: number, childLast = true): object {
  let root = {};
  for (let index = 0; index < depth; index++)
    root = childLast ? { padding: "x", next: root } : { next: root, padding: "x" };
  return root;
}

it.each([true, false])(
  "measures ordered record children through the depth boundary (childLast=%s)",
  (childLast) => {
    expect(measureSandboxData([chain(MAX_DATA_DEPTH, childLast)])).toBe(1 + MAX_DATA_DEPTH * 15);
    expect(() => measureSandboxData([chain(MAX_DATA_DEPTH + 1, childLast)])).toThrow(
      expect.objectContaining({ code: "budgetExceeded", budget: "dataDepth" })
    );
  }
);

it("keeps captured last-child data when an earlier retained callback mutates its owner", () => {
  const last = { word: "original" };
  const root = {
    first: createSandboxClosure({
      call: () => undefined,
      retainedValues: () => {
        root.last = { word: "replacement" };
        last.word = "changed";
        return [];
      }
    }),
    last
  };
  // Parent descriptors were captured before the first callback. The existing
  // child remains charged, including its current descendants, in DFS order.
  expect(measureSandboxData([root])).toBe(26);
});

it("preserves descriptor trap order across record continuations and cycles", () => {
  const reads: string[] = [];
  const shared = { word: "abc" };
  const second = new Proxy(
    { shared },
    {
      getOwnPropertyDescriptor(owner, key) {
        if (typeof key === "string") reads.push("second:" + key);
        return Reflect.getOwnPropertyDescriptor(owner, key);
      }
    }
  );
  const first = new Proxy(
    { shared, next: second },
    {
      getOwnPropertyDescriptor(owner, key) {
        if (typeof key === "string") reads.push("first:" + key);
        return Reflect.getOwnPropertyDescriptor(owner, key);
      }
    }
  );
  Object.assign(shared, { cycle: first });
  expect(measureSandboxData([first])).toBe(36);
  expect(reads).toEqual(["first:shared", "first:next", "second:shared"]);
});

it("does not let later Array.push hooks erase deferred last-child data", () => {
  const root = {
    first: createSandboxClosure({ call: () => undefined, retainedValues: () => [] }),
    last: { text: "x".repeat(1000) }
  };
  const before = measureSandboxData([root]);
  const original = Array.prototype.push;
  let after = -1;
  try {
    Array.prototype.push = function (...items: unknown[]) {
      for (const item of items) {
        if (
          item !== null &&
          typeof item === "object" &&
          Object.hasOwn(item, "values") &&
          Object.hasOwn(item, "index") &&
          Object.hasOwn(item, "depth")
        ) {
          const frame = item as { values: unknown[]; index: number };
          frame.index = frame.values.length;
        }
      }
      return original.apply(this, items);
    };
    after = measureSandboxData([root]);
  } finally {
    Array.prototype.push = original;
  }
  expect(before).toBeGreaterThan(1000);
  expect(after).toBe(before);
});

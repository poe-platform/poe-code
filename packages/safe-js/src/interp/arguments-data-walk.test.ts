import { expect, it } from "vitest";
import { MAX_DATA_DEPTH } from "../graph-depth.js";
import { createSandboxArguments } from "./arguments.js";
import { Budget } from "./budget.js";
import { registerIndexedClosureCaptures } from "./indexed-closure-captures.js";
import {
  createSandboxClosure,
  measureSandboxData,
  reconcileCompiledValues,
  type SandboxObject
} from "./values.js";

function chain(depth: number): object {
  let root: SandboxObject = {};
  for (let index = 0; index < depth; index++) root = createSandboxArguments([root]);
  return root;
}

it("measures nested arguments through the permitted data depth without native recursion", () => {
  expect(measureSandboxData([chain(MAX_DATA_DEPTH)])).toBe(1 + 11 * MAX_DATA_DEPTH + 16);
  expect(() => measureSandboxData([chain(MAX_DATA_DEPTH + 1)])).toThrow(
    expect.objectContaining({ code: "budgetExceeded", budget: "dataDepth" })
  );
});

it("keeps argument siblings charged when an earlier callback mutates later descriptors", () => {
  const payload = { text: "old" };
  const args = createSandboxArguments([]);
  args.first = createSandboxClosure({
    call: () => undefined,
    retainedValues: () => {
      args.last = { text: "replacement" };
      payload.text = "x".repeat(1003);
      return [];
    }
  });
  args.last = payload;
  const before = measureSandboxData([createSandboxArguments([payload])]);
  expect(measureSandboxData([args])).toBeGreaterThan(before + 1000);
});

it.each([64, 65])(
  "keeps parent argument roots and indexed closure siblings after %s aliases",
  (count) => {
    const payload = { data: "x".repeat(1000) };
    const wide = createSandboxArguments(Array.from({ length: count }, () => payload));
    const following = createSandboxClosure({ call: () => undefined });
    registerIndexedClosureCaptures(following, (append) => {
      append("done");
      append("abc");
    });
    const parent = createSandboxArguments([wide, following, payload]);
    const expected = count === 64 ? 1236 : 1239;
    expect(measureSandboxData([parent])).toBe(expected);
    expect(measureSandboxData([parent])).toBe(expected);
    const budget = new Budget({ dataSize: expected - 1 });
    const release = budget.deferReconciliation();
    try {
      expect(() => reconcileCompiledValues(budget, [parent])).toThrowError(
        expect.objectContaining({ code: "budgetExceeded", budget: "dataSize" })
      );
    } finally {
      release();
    }
  }
);

it("isolates nested measurements during argument descriptor capture with a parent pending", () => {
  const payload = { data: "x".repeat(1000) };
  const inner = createSandboxArguments(["inside", payload]);
  let nested = -1;
  const child = new Proxy(createSandboxArguments([payload]), {
    getOwnPropertyDescriptor(target, key) {
      if (key === "0") nested = measureSandboxData([inner]);
      return Reflect.getOwnPropertyDescriptor(target, key);
    }
  });
  const parent = createSandboxArguments([child, "tail", payload]);
  expect(measureSandboxData([parent])).toBe(1052);
  expect(nested).toBe(1041);
});

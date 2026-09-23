import { expect, it, vi } from "vitest";
import { createRealm } from "../realm.js";
import * as argumentsApi from "./arguments.js";
import { Budget } from "./budget.js";
import { Scope } from "./scope.js";
import { MAX_DATA_DEPTH } from "../graph-depth.js";
import { intrinsicDataRoots } from "./intrinsic-data-roots.js";
import { internalSymbols } from "./internal-symbols.js";
import {
  createSandboxClosure,
  measureSandboxData,
  reconcileCompiledValues,
  type SandboxValue
} from "./values.js";

it("does not construct an unread arguments object retained by a classic closure", async () => {
  const realm = createRealm({ classicScripts: true });
  const create = vi.spyOn(argumentsApi, "createSandboxArguments");
  let calls: number;
  try {
    expect(
      await realm.evaluate(
        '"use strict";function hold(value){return ()=>value}var keep=hold("unread-arguments-marker");'
      )
    ).toMatchObject({ ok: true });
    calls = create.mock.calls.filter(([values]) => values[0] === "unread-arguments-marker").length;
  } finally {
    create.mockRestore();
    await realm.close();
  }
  expect(calls).toBe(0);
});

it("keeps exact charges and identity through aliases and materialization", () => {
  const payload = { text: "small" };
  const symbol = Symbol("payload");
  const values = ["abc", payload, payload, symbol, undefined];
  const scope = new Scope();
  scope.declareDeferredArguments("arguments", "let", values);
  scope.declareAlias("alias", "arguments");
  const roots = scope.retainedDataRoots();
  const expected = measureSandboxData([argumentsApi.createSandboxArguments(values)]);
  expect(measureSandboxData(roots)).toBe(expected);
  const first = scope.lookup("alias");
  const second = scope.lookup("arguments");
  expect(first).toEqual(second);
  expect(first.found && second.found && first.value === second.value).toBe(true);
  expect(
    measureSandboxData([
      ...roots,
      ...scope.retainedDataRoots(),
      first.found ? first.value : undefined
    ])
  ).toBe(expected);
  payload.text += "grown";
  expect(measureSandboxData(roots)).toBe(expected + 5);
});

it.each([false, true])("enforces pending and materialized argument quotas (held=%s)", (held) => {
  const payload = { text: "small" };
  const scope = new Scope();
  scope.declareDeferredArguments("arguments", "let", [payload, "abc"]);
  const roots = scope.retainedDataRoots();
  const before = measureSandboxData(roots);
  payload.text = "x".repeat(1005);
  const budget = new Budget({ dataSize: before + 500 });
  const release = held ? budget.deferReconciliation() : undefined;
  try {
    expect(() => reconcileCompiledValues(budget, roots)).toThrow(
      expect.objectContaining({ budget: "dataSize" })
    );
    scope.lookup("arguments");
    expect(() => reconcileCompiledValues(budget, roots)).toThrow(
      expect.objectContaining({ budget: "dataSize" })
    );
  } finally {
    release?.();
  }
});

it.each(["snapshot", "captureFrame", "retainedValues"] as const)(
  "materializes arguments for %s",
  (method) => {
    const scope = new Scope();
    scope.declareDeferredArguments("arguments", "let", ["abc"]);
    const before = scope.retainedDataRoots();
    const expected = measureSandboxData(before);
    expect(scope[method]()).toBeDefined();
    const value = scope.lookup("arguments");
    expect(value.found && argumentsApi.isSandboxArguments(value.value)).toBe(true);
    expect(measureSandboxData([...before, ...scope.retainedDataRoots()])).toBe(expected);
    if (method === "captureFrame") {
      const restored = new Scope();
      restored.hydrateFrame(scope.captureFrame());
      expect(restored.lookup("arguments")).toEqual(value);
    }
  }
);

it("captures original input slots once and preserves older roots after overwrite", () => {
  const input = ["old"];
  const scope = new Scope();
  scope.declareDeferredArguments("arguments", "let", input);
  const roots = scope.retainedDataRoots();
  const before = measureSandboxData(roots);
  input[0] = "x".repeat(1000);
  scope.assign("arguments", null);
  expect(measureSandboxData(scope.retainedDataRoots())).toBe(0);
  expect(measureSandboxData(roots)).toBe(before);
});

it("accounts for arguments materialized by a later retained callback", () => {
  const scope = new Scope();
  scope.declareDeferredArguments("arguments", "let", ["abc"]);
  const roots = scope.retainedDataRoots();
  const force = createSandboxClosure({
    call: () => undefined,
    retainedValues: () => {
      const value = scope.lookup("arguments");
      if (!value.found || !argumentsApi.isSandboxArguments(value.value))
        throw Error("Missing arguments");
      value.value.extra = "x".repeat(1000);
      return [];
    }
  });
  expect(() => reconcileCompiledValues(new Budget({ dataSize: 500 }), [...roots, force])).toThrow(
    expect.objectContaining({ budget: "dataSize" })
  );
  const actual = scope.lookup("arguments");
  expect(measureSandboxData([...roots, force])).toBe(
    measureSandboxData([actual.found ? actual.value : undefined, force])
  );
});

it("keeps materialized argument descriptors and callbacks fresh", () => {
  const scope = new Scope();
  scope.declareDeferredArguments("arguments", "let", ["abc"]);
  const roots = scope.retainedDataRoots();
  const value = scope.lookup("arguments");
  if (!value.found || !argumentsApi.isSandboxArguments(value.value))
    throw Error("Missing arguments");
  const before = measureSandboxData(roots);
  value.value[0] = "x".repeat(1003);
  expect(measureSandboxData(roots)).toBe(before + 1000);
  Object.defineProperty(value.value, "hidden", { value: "secret" });
  expect(measureSandboxData(roots)).toBe(before + 1013);
  delete value.value[0];
  expect(measureSandboxData(roots)).toBe(before + 8);
});

it("accounts for materialization during final primitive projections", () => {
  const scope = new Scope();
  scope.declareDeferredArguments("arguments", "let", ["abc"]);
  const projection = {};
  intrinsicDataRoots.set(projection, { target: {}, values: [7n] });
  const roots = [...scope.retainedDataRoots(), projection];
  const original = BigInt.prototype.toString;
  let rejected = false;
  BigInt.prototype.toString = function (radix) {
    const value = scope.lookup("arguments");
    if (value.found && argumentsApi.isSandboxArguments(value.value))
      value.value.extra = "x".repeat(1000);
    return original.call(this, radix);
  };
  try {
    try {
      reconcileCompiledValues(new Budget({ dataSize: 500 }), roots);
    } catch (error) {
      rejected = (error as { budget?: string }).budget === "dataSize";
    }
  } finally {
    BigInt.prototype.toString = original;
  }
  expect(rejected).toBe(true);
});

it("keeps deferred argument chains off the native call stack", () => {
  const chain = (length: number) => {
    let root: SandboxValue = {};
    for (let index = 0; index < length; index++) {
      const scope = new Scope();
      scope.declareDeferredArguments("arguments", "let", [root]);
      root = scope.retainedDataRoots()[0]!;
    }
    return root;
  };
  expect(measureSandboxData([chain(MAX_DATA_DEPTH)])).toBe(1 + 11 * MAX_DATA_DEPTH + 16);
  expect(() => measureSandboxData([chain(MAX_DATA_DEPTH + 1)])).toThrow(
    expect.objectContaining({ budget: "dataDepth" })
  );
});

it("keeps bigint arguments on the eager observation path", () => {
  const scope = new Scope();
  scope.declareDeferredArguments("arguments", "let", [255n]);
  expect(measureSandboxData(scope.retainedDataRoots())).toBe(
    measureSandboxData([argumentsApi.createSandboxArguments([255n])])
  );
});

it("isolates reentrant measurements and recovers after retained callback failure", () => {
  const scope = new Scope();
  const payload = { text: "old" };
  let fail = true;
  let nested = 0;
  const callback = createSandboxClosure({
    call: () => undefined,
    retainedValues: () => {
      nested = measureSandboxData([payload]);
      if (fail) throw Error("retained failure");
      return [payload];
    }
  });
  scope.declareDeferredArguments("arguments", "let", [callback, payload, "tail"]);
  const roots = scope.retainedDataRoots();
  expect(() => measureSandboxData(roots)).toThrow("retained failure");
  fail = false;
  const before = measureSandboxData(roots);
  expect(nested).toBe(measureSandboxData([payload]));
  payload.text = "x".repeat(1003);
  expect(measureSandboxData(roots)).toBe(before + 1000);
});

it("keeps private argument snapshots out of native iterator hooks", () => {
  const payload = { text: "x".repeat(1000) };
  const scope = new Scope();
  scope.declareDeferredArguments("arguments", "let", [payload, "tail"]);
  const before = measureSandboxData(scope.retainedDataRoots());
  const original = Array.prototype[Symbol.iterator];
  let exposed = false;
  let after: number;
  Array.prototype[Symbol.iterator] = function () {
    if (this[0] === payload && Object.isFrozen(this)) exposed = true;
    return original.call(this);
  };
  try {
    after = measureSandboxData(scope.retainedDataRoots());
    scope.lookup("arguments");
  } finally {
    Array.prototype[Symbol.iterator] = original;
  }
  expect(after).toBe(before);
  expect(exposed).toBe(false);
});

it("retries failed initialization and preserves an assignment made by a creation hook", () => {
  const scope = new Scope();
  scope.declareDeferredArguments("arguments", "let", ["abc"]);
  const roots = scope.retainedDataRoots();
  const before = measureSandboxData(roots);
  const original = argumentsApi.createSandboxArguments;
  const create = vi.spyOn(argumentsApi, "createSandboxArguments");
  create
    .mockImplementationOnce(() => {
      scope.lookup("arguments");
      throw Error("unreachable");
    })
    .mockImplementationOnce((values) => {
      scope.assign("arguments", 7);
      return original(values);
    });
  try {
    expect(() => scope.lookup("arguments")).toThrow(
      "Cannot reenter deferred arguments initialization."
    );
    expect(measureSandboxData(roots)).toBe(before);
    const value = scope.lookup("arguments");
    expect(value.found && argumentsApi.isSandboxArguments(value.value)).toBe(true);
    expect(scope.lookup("arguments")).toMatchObject({ value: 7 });
    expect(measureSandboxData(scope.retainedDataRoots())).toBe(0);
    expect(measureSandboxData(roots)).toBe(before);
  } finally {
    create.mockRestore();
  }
});

it.each(["classic", "module"] as const)(
  "supports late arrow/eval reads, defaults and descriptor identity in %s",
  async (kind) => {
    const realm = createRealm({ classicScripts: true });
    const body =
      'function hold(value){return ()=>[arguments===eval("arguments"),arguments[0],arguments.length]}function defaults(value=arguments[1]){return value}var read=hold("original",2);var result=[read(),defaults(undefined,7)];';
    try {
      const source =
        kind === "module" ? body + "export {result};" : '"use strict";' + body + "result;";
      expect(
        await realm.evaluate(
          source,
          kind === "module" ? { sourceType: "module", filename: "deferred-args" } : undefined
        )
      ).toMatchObject({
        ok: true,
        returnValue:
          kind === "module" ? { result: [[true, "original", 2], 7] } : [[true, "original", 2], 7]
      });
    } finally {
      await realm.close();
    }
  }
);

it.each(["iterator", "brand"] as const)(
  "keeps fresh %s symbol charges before and during materialization",
  (kind) => {
    const expectedArguments = argumentsApi.createSandboxArguments(["abc"]);
    const symbol =
      kind === "iterator"
        ? Symbol.iterator
        : Object.getOwnPropertySymbols(expectedArguments).find((key) => key !== Symbol.iterator)!;
    const originallyInternal = internalSymbols.has(symbol);
    const scope = new Scope();
    scope.declareDeferredArguments("arguments", "let", ["abc"]);
    const roots = scope.retainedDataRoots();
    try {
      for (const internal of [false, true, false]) {
        if (internal) internalSymbols.add(symbol);
        else internalSymbols.delete(symbol);
        expect(measureSandboxData(roots)).toBe(measureSandboxData([expectedArguments]));
      }
      if (!originallyInternal) internalSymbols.add(symbol);
      else internalSymbols.delete(symbol);
      const force = createSandboxClosure({
        call: () => undefined,
        retainedValues: () => {
          scope.lookup("arguments");
          return [];
        }
      });
      expect(measureSandboxData([...roots, force])).toBe(
        measureSandboxData([expectedArguments, force])
      );
    } finally {
      if (originallyInternal) internalSymbols.add(symbol);
      else internalSymbols.delete(symbol);
    }
  }
);

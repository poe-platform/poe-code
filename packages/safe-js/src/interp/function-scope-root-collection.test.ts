import { expect, it } from "vitest";
import { run } from "../run.js";
import { parseModule } from "../parse/parser.js";
import { createInterpretedClosure, type AsyncEvaluationContext } from "./async.js";
import { Budget } from "./budget.js";
import { captureScopeDataRoots, Scope } from "./scope.js";
import { appendScopeDataRoot } from "./scope-data-roots.js";
import { isSandboxClosure, measureSandboxData, reconcileCompiledValues } from "./values.js";

function fixture() {
  const ast = parseModule("() => null;");
  const statement = ast.body[0];
  if (
    statement?.type !== "ExpressionStatement" ||
    statement.expression.type !== "ArrowFunctionExpression"
  )
    throw new Error("Missing arrow");
  const node = statement.expression;
  const context: AsyncEvaluationContext = {
    scope: new Scope({ payload: "old" }),
    budget: new Budget(),
    callStack: [],
    activeLoopIterations: new Map(),
    restoredLoopIterations: new Map(),
    stats: { currentDataSize: 0, peakDataSize: 0, nodeVisits: 0 }
  };
  const make = () =>
    createInterpretedClosure(node, context, async () => ({
      kind: "normal",
      hasValue: false,
      value: undefined
    }));
  return { context, make };
}

it("does not send function scope root vectors through later array iterator hooks", async () => {
  const result = await run("const payload = 'x'.repeat(1000); return () => payload;");
  if (!result.ok || !isSandboxClosure(result.returnValue)) throw new Error("Missing closure");
  const closure = result.returnValue;
  const read = Scope.prototype.retainedDataRoots;
  const iterator = Array.prototype[Symbol.iterator];
  const vectors = new WeakSet<object>();
  Scope.prototype.retainedDataRoots = function () {
    const roots = read.call(this);
    vectors.add(roots);
    return roots;
  };
  const before = measureSandboxData([closure]);
  let after = -1;
  try {
    Array.prototype[Symbol.iterator] = function () {
      return iterator.call(vectors.has(this) ? [] : this);
    };
    after = measureSandboxData([closure]);
  } finally {
    Scope.prototype.retainedDataRoots = read;
    Array.prototype[Symbol.iterator] = iterator;
  }
  expect(before).toBeGreaterThan(1000);
  expect(after).toBe(before);
  const budget = new Budget({ dataSize: 500 });
  const release = budget.deferReconciliation();
  try {
    expect(() => reconcileCompiledValues(budget, [closure])).toThrow(
      expect.objectContaining({ budget: "dataSize" })
    );
  } finally {
    release();
  }
});

it("does not append child roots into a foreign parent's reused vector", () => {
  const parent = new Scope({ payload: "old" });
  const shared = parent.retainedDataRoots();
  parent.retainedDataRoots = () => shared;
  const child = parent.child({ local: "child" });
  expect(measureSandboxData(child.retainedDataRoots())).toBe(8);
  expect(measureSandboxData(shared)).toBe(3);
  expect(measureSandboxData(child.retainedDataRoots())).toBe(8);
  expect(measureSandboxData(shared)).toBe(3);
});

it("keeps parent metadata fresh and earlier collector snapshots independent", () => {
  const parent = new Scope({ payload: "old" });
  const child = parent.child();
  let meta = { text: "old" };
  Object.defineProperty(parent, "importMeta", { configurable: true, get: () => meta });
  const first = captureScopeDataRoots(child, (roots) => appendScopeDataRoot(roots, "extra"));
  const before = measureSandboxData(first);
  meta = { text: "x".repeat(1003) };
  const second = captureScopeDataRoots(child, (roots) => appendScopeDataRoot(roots, "extra"));
  expect(measureSandboxData(second)).toBe(before + 1000);
  expect(measureSandboxData(first)).toBe(before);
  second.push("caller mutation");
  expect(
    measureSandboxData(captureScopeDataRoots(child, (roots) => appendScopeDataRoot(roots, "extra")))
  ).toBe(before + 1000);
});

it("reads mutable context scope carriers again for each function capture", () => {
  const { context, make } = fixture();
  const closure = make();
  const before = measureSandboxData([closure]);
  context.scope = new Scope({ payload: "x".repeat(1003) });
  expect(measureSandboxData([closure])).toBe(before + 1000);
});

it("reads foreign scope collectors before function environment fields", () => {
  const { context, make } = fixture();
  const closure = make();
  const order: string[] = [];
  context.scope.retainedDataRoots = () => {
    order.push("collect");
    return [];
  };
  context.functionEnvironment = {
    get homeObject() {
      order.push("home");
      return undefined;
    },
    get newTarget() {
      order.push("target");
      return undefined;
    }
  };
  Object.defineProperty(context, "scope", {
    value: context.scope,
    configurable: true,
    writable: true
  });
  expect(measureSandboxData([closure])).toBe(1);
  expect(order).toEqual(["collect", "home", "target"]);
});

it("keeps earlier and later bindings charged across same-walk capture changes", () => {
  const { context, make } = fixture();
  context.scope = new Scope();
  context.scope.declare("payload", "let", "old");
  const first = make();
  const second = make();
  context.functionEnvironment = {
    get homeObject() {
      context.scope.assign("payload", "x".repeat(1000));
      return undefined;
    }
  };
  expect(measureSandboxData([first, second])).toBe(1005);
});

it("does not reveal function environment captures to inherited array index setters", () => {
  const { context, make } = fixture();
  context.scope = new Scope();
  const home = { text: "x".repeat(1000) };
  context.functionEnvironment = { homeObject: home };
  const closure = make();
  const before = measureSandboxData([closure]);
  const prior = Object.getOwnPropertyDescriptor(Array.prototype, "0");
  let exposed = 0;
  Object.defineProperty(Array.prototype, "0", {
    configurable: true,
    set(value: unknown) {
      if (value === home) exposed++;
      Object.defineProperty(this, "0", {
        value,
        writable: true,
        enumerable: true,
        configurable: true
      });
    }
  });
  let after = -1;
  try {
    after = measureSandboxData([closure]);
  } finally {
    if (prior === undefined) Reflect.deleteProperty(Array.prototype, "0");
    else Object.defineProperty(Array.prototype, "0", prior);
  }
  expect(after).toBe(before);
  expect(exposed).toBe(0);
});

it.each([0, 4])(
  "keeps collected roots intact across a later getter after index %s hooks",
  (index) => {
    const { context, make } = fixture();
    const closure = make();
    if (index === 4)
      for (let name = 0; name < 5; name++) context.scope.declarePrivateName(`name${name}`);
    const root = context.scope.retainedDataRoots()[index];
    const before = measureSandboxData([closure]);
    const exposed: unknown[][] = [];
    context.functionEnvironment = {
      get homeObject() {
        const leaked = exposed.at(-1);
        if (leaked !== undefined) leaked[index] = undefined;
        return undefined;
      }
    };
    const key = String(index);
    const prior = Object.getOwnPropertyDescriptor(Array.prototype, key);
    Object.defineProperty(Array.prototype, key, {
      configurable: true,
      set(value: unknown) {
        if (value === root) exposed.push(this);
        Object.defineProperty(this, key, {
          value,
          writable: true,
          enumerable: true,
          configurable: true
        });
      }
    });
    let after = -1;
    try {
      after = measureSandboxData([closure]);
    } finally {
      if (prior === undefined) Reflect.deleteProperty(Array.prototype, key);
      else Object.defineProperty(Array.prototype, key, prior);
    }
    expect(after).toBe(before);
  }
);

it("keeps foreign iterable captures and their iterator errors observable", () => {
  const { context, make } = fixture();
  const closure = make();
  const values = new Set(["x".repeat(1000)]);
  context.scope.retainedDataRoots = () =>
    values as unknown as ReturnType<Scope["retainedDataRoots"]>;
  expect(measureSandboxData([closure])).toBe(1001);
  const failure = new Error("iterator failed");
  values[Symbol.iterator] = () => {
    throw failure;
  };
  expect(() => measureSandboxData([closure])).toThrow(failure);
});

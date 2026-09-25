import { expect, it, vi } from "vitest";
import { Budget } from "../interp/budget.js";
import { CompileScope } from "../interp/regex/compile-guard.js";
import { Scope } from "../interp/scope.js";
import { createSandboxClosure, measureSandboxData, reconcileCompiledValues } from "../interp/values.js";
import { createModuleEnvironment } from "./registry.js";
import { SourceModuleGraph } from "./source-graph.js";

const entry = { id: "retention-entry", source: "export const value = 7" };

async function fixture() {
  const budget = new Budget({ dataSize: 10000 });
  const scope = new Scope();
  const lease = budget.acquireCompileOwner();
  const compilation = new CompileScope(lease.owner);
  const register = vi.spyOn(budget, "setRetainedValues");
  const graph = new SourceModuleGraph({
    resolver: () => undefined, scope, budget, compilation,
    modules: createModuleEnvironment(undefined, { budget, compileOwner: lease.owner })
  });
  const collect = register.mock.calls.find(([owner]) => owner === graph)![1]!;
  register.mockRestore();
  const close = () => { graph.close(); compilation.dispose(); lease.release(); };
  try { await graph.evaluateSource(entry); }
  catch (error) { close(); throw error; }
  return { budget, scope, graph, collect, close };
}

function isRecord(value: unknown): boolean {
  return typeof value === "object" && value !== null &&
    "id" in value && value.id === entry.id && "scope" in value;
}

it.each([false, true])("cannot omit source roots through a native flatMap hook (held=%s)", async held => {
  const test = await fixture();
  const original = Array.prototype.flatMap;
  test.scope.declare("payload", "const", "x".repeat(20000));
  const release = held ? test.budget.deferReconciliation() : undefined;
  let exposed = false, failure: unknown;
  const hook = vi.spyOn(Array.prototype, "flatMap").mockImplementation(function (this: unknown[], callback, thisArg) {
    if (isRecord(this[0])) { exposed = true; return []; }
    return Reflect.apply(original, this, [callback, thisArg]);
  });
  try { reconcileCompiledValues(test.budget, []); }
  catch (error) { failure = error; }
  finally { hook.mockRestore(); release?.(); test.close(); }
  expect(failure).toMatchObject({ code: "budgetExceeded", budget: "dataSize" });
  expect(exposed).toBe(false);
});

it("does not expose private module records through array species lookup", async () => {
  const test = await fixture();
  const original = Object.getOwnPropertyDescriptor(Array.prototype, "constructor")!;
  const NativeArray = Array;
  let exposed = false, roots: unknown[];
  Object.defineProperty(Array.prototype, "constructor", { configurable: true, get() {
    if (isRecord(this[0])) exposed = true;
    return NativeArray;
  } });
  try { roots = [...test.collect()!]; }
  finally { Object.defineProperty(Array.prototype, "constructor", original); test.close(); }
  expect(exposed).toBe(false);
  expect(roots).toContain(entry.source);
});

it("cannot replace the private record iterator through a native Map.values hook", async () => {
  const test = await fixture();
  const before = measureSandboxData(test.collect()!);
  const values = Map.prototype.values, get = Map.prototype.get;
  let exposed = false, after: number;
  const hook = vi.spyOn(Map.prototype, "values").mockImplementation(function (this: Map<unknown, unknown>) {
    if (isRecord(Reflect.apply(get, this, [entry.id]))) {
      exposed = true;
      return Reflect.apply(values, new Map(), []);
    }
    return Reflect.apply(values, this, []);
  });
  try { after = measureSandboxData(test.collect()!); }
  finally { hook.mockRestore(); test.close(); }
  expect(exposed).toBe(false);
  expect(after).toBe(before);
});

it("cannot replace private records through a native Map iterator next hook", async () => {
  const test = await fixture();
  const before = measureSandboxData(test.collect()!);
  const prototype = Object.getPrototypeOf(new Map().values());
  const next = prototype.next as (this: MapIterator<unknown>) => IteratorResult<unknown>;
  let exposed = false, after: number;
  const hook = vi.spyOn(prototype, "next").mockImplementation(function (this: MapIterator<unknown>) {
    const result = Reflect.apply(next, this, []);
    if (isRecord(result.value)) { exposed = true; return { done: true, value: undefined }; }
    return result;
  });
  try { after = measureSandboxData(test.collect()!); }
  finally { hook.mockRestore(); test.close(); }
  expect(exposed).toBe(false);
  expect(after).toBe(before);
});

it("keeps foreign scope iterables fresh and ordered in the complete snapshot", async () => {
  const test = await fixture();
  const second = { id: "second", source: "export const value = 8" };
  try {
    await test.graph.evaluateSource(second);
    let reads = 0;
    test.scope.retainedDataRoots = (() => ({
      *[Symbol.iterator]() { yield `scope-${++reads}`; }
    })) as unknown as Scope["retainedDataRoots"];
    expect([...test.collect()!]).toEqual([
      entry.id, entry.source, "scope-1", expect.anything(), second.id, second.source, "scope-2", expect.anything()
    ]);
    expect([...test.collect()!]).toEqual([
      entry.id, entry.source, "scope-3", expect.anything(), second.id, second.source, "scope-4", expect.anything()
    ]);
  } finally { test.close(); }
});

it("captures every module's roots before measurement callbacks change later roots", async () => {
  const test = await fixture();
  try {
    await test.graph.evaluateSource({ id: "second", source: "export const value = 8" });
    let later = "initial", reads = 0;
    const trigger = createSandboxClosure({ call: () => undefined, retainedValues: () => {
      later = "x".repeat(100);
      return [];
    } });
    test.scope.retainedDataRoots = () => (++reads % 2 === 1 ? [trigger] : [later]);
    const before = measureSandboxData(test.collect()!);
    expect(measureSandboxData(test.collect()!)).toBe(before + 93);
  } finally { test.close(); }
});

it("honors a replacement scope reader's custom array iterator", async () => {
  const test = await fixture();
  const captured = ["unobserved index"];
  captured[Symbol.iterator] = function* (): Generator<string, undefined, unknown> {
    yield "custom iteration";
    return undefined;
  };
  const reader = vi.spyOn(Scope.prototype, "retainedDataRoots").mockReturnValue(captured);
  let roots: unknown[];
  try { roots = [...test.collect()!]; }
  finally { reader.mockRestore(); test.close(); }
  expect(roots).toEqual([entry.id, entry.source, "custom iteration"]);
});

it("defers records added by a scope reader until the next collection", async () => {
  const test = await fixture();
  const late = { id: "late-entry", source: "export const late = true" };
  let adding = false, added: Promise<unknown> | undefined;
  try {
    test.scope.retainedDataRoots = () => {
      if (!adding) {
        adding = true;
        added = test.graph.evaluateSource(late);
      }
      return [];
    };
    expect([...test.collect()!]).not.toContain(late.id);
    await added;
    expect([...test.collect()!]).toContain(late.id);
  } finally { await added; test.close(); }
});

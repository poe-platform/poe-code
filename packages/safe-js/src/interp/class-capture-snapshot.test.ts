import { expect, it } from "vitest";
import { parse } from "../parse.js";
import type { AsyncEvaluationContext } from "./async.js";
import { Budget } from "./budget.js";
import { classOrigins, createClassConstructor, type Field } from "./classes.js";
import { Scope } from "./scope.js";
import { createSandboxClosure, measureSandboxData, reconcileCompiledValues } from "./values.js";

function fixture() {
  const node = parse("class Retained { payload; }");
  if (node?.type !== "ClassDeclaration") throw new Error("Expected class");
  const element = node.body.body[0];
  if (element?.type !== "PropertyDefinition") throw new Error("Expected field");
  const fields: Field[] = [{ element, key: "x".repeat(1000) }];
  const scope = new Scope();
  const context: AsyncEvaluationContext = {
    scope,
    budget: new Budget(),
    activeLoopIterations: new Map(),
    restoredLoopIterations: new Map(),
    callStack: [],
    stats: { currentDataSize: 0, peakDataSize: 0, nodeVisits: 0 }
  };
  const constructor = createClassConstructor(
    node,
    context,
    async () => ({
      kind: "normal",
      hasValue: false,
      value: undefined
    }),
    fields
  );
  const origin = classOrigins.get(constructor)!;
  const payload = { text: "x".repeat(1000) };
  origin.privateMethods.set({ description: "private" }, { kind: "field", value: payload });
  return { constructor, scope, fields, origin, payload };
}

it.each(["flatMap", "push"] as const)(
  "keeps class captures private from native %s hooks",
  (hook) => {
    const { constructor, payload } = fixture();
    const before = measureSandboxData([constructor]);
    const flatMap = Array.prototype.flatMap;
    const push = Array.prototype.push;
    let intercepted = 0;
    let after = -1;
    try {
      if (hook === "flatMap") {
        Array.prototype.flatMap = function () {
          intercepted++;
          return [];
        };
      } else {
        Array.prototype.push = function (...values: unknown[]) {
          if (values.includes(payload)) {
            intercepted++;
            this.length = 0;
            return 0;
          }
          return push.apply(this, values);
        };
      }
      after = measureSandboxData([constructor]);
    } finally {
      Array.prototype.flatMap = flatMap;
      Array.prototype.push = push;
    }
    expect(after).toBe(before);
    expect(intercepted).toBe(0);
  }
);

it.each([
  { held: false, hook: "flatMap" },
  { held: true, hook: "flatMap" },
  { held: false, hook: "push" },
  { held: true, hook: "push" }
] as const)(
  "enforces class quotas under native hooks (held=$held, hook=$hook)",
  ({ held, hook }) => {
    const { constructor, payload } = fixture();
    const before = measureSandboxData([constructor]);
    const budget = new Budget({ dataSize: before - 500 });
    const resume = held ? budget.deferReconciliation() : undefined;
    const flatMap = Array.prototype.flatMap;
    const push = Array.prototype.push;
    let error: unknown;
    try {
      if (hook === "flatMap")
        Array.prototype.flatMap = function () {
          return [];
        };
      else
        Array.prototype.push = function (...values: unknown[]) {
          if (values.includes(payload)) {
            this.length = 0;
            return 0;
          }
          return push.apply(this, values);
        };
      try {
        reconcileCompiledValues(budget, [constructor]);
      } catch (failure) {
        error = failure;
      }
    } finally {
      Array.prototype.flatMap = flatMap;
      Array.prototype.push = push;
      resume?.();
    }
    expect(error).toMatchObject({ code: "budgetExceeded", budget: "dataSize" });
  }
);

it("keeps class fields, private methods and mutable scope roots fresh", () => {
  const { constructor, scope, fields, origin, payload } = fixture();
  const before = measureSandboxData([constructor]);
  payload.text += "grown";
  fields[0]!.key = String(fields[0]!.key) + "longer";
  scope.declare("retained", "let", "new scope data");
  expect(measureSandboxData([constructor]) - before).toBe(25);
  origin.privateMethods.clear();
  expect(measureSandboxData([constructor])).toBe(1 + 1006 + 14);
});

it("captures class fields and methods before retained callbacks mutate later roots", () => {
  const { constructor, scope, fields, origin } = fixture();
  let mutate = false;
  const callback = createSandboxClosure({
    call: () => undefined,
    retainedValues: () => {
      if (mutate) {
        mutate = false;
        fields[0]!.key = "short";
        origin.privateMethods.clear();
      }
      return [];
    }
  });
  scope.declare("callback", "const", callback);
  const before = measureSandboxData([constructor]);
  mutate = true;
  expect(measureSandboxData([constructor])).toBe(before);
  expect(measureSandboxData([constructor])).toBe(7);
});

it.each([false, true])("keeps private accessor captures live under quotas (held=%s)", (held) => {
  const { constructor, origin, fields } = fixture();
  origin.privateMethods.clear();
  const payload = { text: "small" };
  const getter = createSandboxClosure({ call: () => undefined, retainedValues: () => [payload] });
  origin.privateMethods.set(
    { description: "accessor" },
    { kind: "accessor", get: getter, set: undefined }
  );
  fields.push({
    element: fields[0]!.element,
    key: Symbol("field"),
    privateName: { description: "private field" }
  });
  const before = measureSandboxData([constructor]);
  payload.text = "x".repeat(1005);
  expect(measureSandboxData([constructor, getter, payload]) - before).toBe(1000);
  const budget = new Budget({ dataSize: before + 500 });
  const resume = held ? budget.deferReconciliation() : undefined;
  try {
    expect(() => reconcileCompiledValues(budget, [constructor])).toThrowError(
      expect.objectContaining({ code: "budgetExceeded", budget: "dataSize" })
    );
  } finally {
    resume?.();
  }
});

it("isolates reentrant class measurements and recovers after a retained callback fails", () => {
  const { constructor, scope } = fixture();
  const failure = new Error("capture failed");
  let fail = true;
  let nested = -1;
  const callback = createSandboxClosure({
    call: () => undefined,
    retainedValues: () => {
      nested = measureSandboxData([constructor], { ignoreClosureCaptures: true });
      if (fail) throw failure;
      return [];
    }
  });
  scope.declare("callback", "const", callback);
  expect(() => measureSandboxData([constructor])).toThrow(failure);
  fail = false;
  const before = measureSandboxData([constructor]);
  expect(nested).toBe(1);
  expect(measureSandboxData([constructor])).toBe(before);
});

it("keeps the field capture length fixed while native field getters append metadata", () => {
  const { constructor, fields } = fixture();
  let append = false;
  Object.defineProperty(fields[0], "key", {
    get: () => {
      if (append) {
        append = false;
        fields.push({ element: fields[0]!.element, key: "y".repeat(1000) });
      }
      return "x".repeat(1000);
    }
  });
  const before = measureSandboxData([constructor]);
  append = true;
  expect(measureSandboxData([constructor])).toBe(before);
  expect(measureSandboxData([constructor]) - before).toBe(1000);
});

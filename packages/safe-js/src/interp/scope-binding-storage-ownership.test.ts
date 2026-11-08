import { expect, it } from "vitest";
import { Budget } from "./budget.js";
import { Scope } from "./scope.js";
import { measureSandboxData, reconcileCompiledValues } from "./values.js";

type ExposedBinding = { kind: string; value: unknown };
function binding(value: unknown): value is ExposedBinding {
  return (
    typeof value === "object" &&
    value !== null &&
    Object.hasOwn(value, "kind") &&
    Object.hasOwn(value, "value") &&
    (value as ExposedBinding).value === "old"
  );
}
function verify(scope: Scope, exposed: ExposedBinding[]) {
  for (const cell of exposed) cell.value = "x".repeat(1003);
  const lookup = scope.lookup("text");
  if (!lookup.found || typeof lookup.value !== "string") throw Error("Missing text binding");
  // A leaked cell changes physical retention while the old accounting group stays cached.
  expect(measureSandboxData(scope.retainedDataRoots())).toBe(lookup.value.length);
  expect(exposed).toHaveLength(0);
  scope.assign("text", "x".repeat(1003));
  const budget = new Budget({ dataSize: 500 });
  const release = budget.deferReconciliation();
  try {
    expect(() => reconcileCompiledValues(budget, scope.retainedDataRoots())).toThrow(
      expect.objectContaining({ budget: "dataSize" })
    );
  } finally {
    release();
  }
}

it("does not expose binding records through later native Map.get hooks", () => {
  const scope = new Scope();
  scope.declare("text", "let", "old");
  scope.retainedDataRoots();
  const original = Map.prototype.get;
  const exposed: ExposedBinding[] = [];
  Map.prototype.get = function (key: unknown) {
    const value = original.call(this, key);
    if (binding(value)) exposed.push(value);
    return value;
  };
  try {
    scope.lookup("text");
  } finally {
    Map.prototype.get = original;
  }
  verify(scope, exposed);
});

it("does not expose binding records through later native Map.set hooks", () => {
  const scope = new Scope();
  const original = Map.prototype.set;
  const exposed: ExposedBinding[] = [];
  Map.prototype.set = function (key: unknown, value: unknown) {
    if (binding(value)) exposed.push(value);
    return original.call(this, key, value);
  };
  try {
    scope.declare("text", "let", "old");
  } finally {
    Map.prototype.set = original;
  }
  scope.retainedDataRoots();
  verify(scope, exposed);
});

it.each(["values", "entries"] as const)(
  "does not expose bindings through native %s iterator hooks",
  (kind) => {
    const scope = new Scope();
    scope.declare("text", "let", "old");
    const prototype = Object.getPrototypeOf(new Map()[kind]());
    const original = prototype.next;
    const exposed: ExposedBinding[] = [];
    prototype.next = function () {
      const result = original.call(this);
      const candidate =
        kind === "entries" && Array.isArray(result.value) ? result.value[1] : result.value;
      if (binding(candidate)) exposed.push(candidate);
      return result;
    };
    try {
      if (kind === "values") scope.retainedDataRoots();
      else {
        scope.retainedDataRoots();
        scope.captureFrame();
      }
    } finally {
      prototype.next = original;
    }
    verify(scope, exposed);
  }
);

it("does not expose binding entry tuples to native array iterator hooks", () => {
  const scope = new Scope();
  scope.declare("text", "let", "old");
  scope.retainedDataRoots();
  const original = Array.prototype[Symbol.iterator];
  const exposed: ExposedBinding[] = [];
  Array.prototype[Symbol.iterator] = function () {
    if (this.length === 2 && this[0] === "text" && binding(this[1])) exposed.push(this[1]);
    return original.call(this);
  };
  try {
    scope.captureFrame();
  } finally {
    Array.prototype[Symbol.iterator] = original;
  }
  verify(scope, exposed);
});

it("does not expose replacement cells through later native Set.add hooks", () => {
  const scope = new Scope({}, undefined, undefined, { chargeData: false });
  scope.declare("text", "var", "old");
  const original = Set.prototype.add;
  const exposed: ExposedBinding[] = [];
  Set.prototype.add = function (value: unknown) {
    if (binding(value)) exposed.push(value);
    return original.call(this, value);
  };
  try {
    scope.assign("text", "old");
  } finally {
    Set.prototype.add = original;
  }
  scope.retainedDataRoots();
  verify(scope, exposed);
});

it("does not expose binding keys from the snapshot identity map", () => {
  const scope = new Scope();
  scope.declare("text", "let", "old");
  scope.retainedDataRoots();
  const original = Map.prototype.get;
  const exposed: ExposedBinding[] = [];
  Map.prototype.get = function (key: unknown) {
    if (binding(key)) exposed.push(key);
    return original.call(this, key);
  };
  try {
    scope.captureFrame();
  } finally {
    Map.prototype.get = original;
  }
  verify(scope, exposed);
});

it("does not expose hydrated cells through native Array.map callbacks", () => {
  const source = new Scope();
  source.declare("text", "let", "old");
  const frame = source.captureFrame();
  const scope = new Scope();
  const original = Array.prototype.map;
  const exposed: ExposedBinding[] = [];
  Array.prototype.map = function <U>(
    callback: (value: unknown, index: number, array: unknown[]) => U,
    receiver?: unknown
  ): U[] {
    const result = original.call(this, callback, receiver) as U[];
    for (let index = 0; index < result.length; index++) {
      const candidate = result[index];
      if (binding(candidate)) exposed.push(candidate);
    }
    return result;
  };
  try {
    scope.hydrateFrame(frame);
  } finally {
    Array.prototype.map = original;
  }
  scope.retainedDataRoots();
  verify(scope, exposed);
});

it("does not expose cells through inherited accounting setters", () => {
  const scope = new Scope();
  scope.declare("text", "let", "old");
  const exposed: ExposedBinding[] = [];
  Object.defineProperty(Object.prototype, "accounting", {
    configurable: true,
    set(value) {
      if (binding(this)) exposed.push(this);
      Object.defineProperty(this, "accounting", { value, writable: true, configurable: true });
    }
  });
  try {
    scope.retainedDataRoots();
  } finally {
    Reflect.deleteProperty(Object.prototype, "accounting");
  }
  verify(scope, exposed);
});

it("keeps foreign private-name iterator observations live", () => {
  const scope = new Scope();
  const names = new Map([["field", { description: "field" }]]);
  scope.privateNames = names;
  let calls = 0;
  const original = Map.prototype.values;
  Map.prototype.values = function () {
    if (this === names) calls++;
    return original.call(this);
  };
  try {
    scope.retainedDataRoots();
    scope.retainedDataRoots();
  } finally {
    Map.prototype.values = original;
  }
  expect(calls).toBe(2);
});

it("does not expose deleted cells to later native Array.includes hooks", () => {
  const scope = new Scope({}, undefined, undefined, { functionBoundary: true });
  scope.declareVar("discard", { functionValue: "old", deletable: true });
  scope.declare("text", "let", "old");
  scope.retainedDataRoots();
  const original = Array.prototype.includes;
  const exposed: ExposedBinding[] = [];
  Array.prototype.includes = function (value, fromIndex) {
    if (binding(value)) exposed.push(value);
    return original.call(this, value, fromIndex);
  };
  let deleted = false;
  try {
    deleted = scope.deleteBinding("discard");
  } finally {
    Array.prototype.includes = original;
  }
  expect(deleted).toBe(true);
  verify(scope, exposed);
});

it("does not expose replacement cells through native Set iterator hooks", () => {
  const scope = new Scope({}, undefined, undefined, { chargeData: false });
  scope.declare("text", "var", "old");
  scope.assign("text", "old");
  const prototype = Object.getPrototypeOf(new Set().values());
  const original = prototype.next;
  const exposed: ExposedBinding[] = [];
  prototype.next = function () {
    const result = original.call(this);
    if (binding(result.value)) exposed.push(result.value);
    return result;
  };
  try {
    scope.retainedDataRoots();
  } finally {
    prototype.next = original;
  }
  verify(scope, exposed);
});

it("gives new bindings no inherited cell metadata hooks", () => {
  const scope = new Scope();
  const exposed: ExposedBinding[] = [];
  Object.defineProperty(Object.prototype, "importTarget", {
    configurable: true,
    get() {
      if (binding(this)) exposed.push(this);
      return undefined;
    }
  });
  try {
    scope.declare("text", "let", "old");
    scope.retainedDataRoots();
    scope.lookup("text");
    scope.captureFrame();
  } finally {
    Reflect.deleteProperty(Object.prototype, "importTarget");
  }
  verify(scope, exposed);
});

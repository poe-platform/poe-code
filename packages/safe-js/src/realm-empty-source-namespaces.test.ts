import { expect, it, vi } from "vitest";
import { createRealm } from "./core.js";
import { Scope } from "./interp/scope.js";

it("avoids enumerating immutable empty classic source namespaces during accounting", async () => {
  const original = Scope.prototype.retainedDataRoots;
  const captured = new Set<Scope>();
  Scope.prototype.retainedDataRoots = function () {
    captured.add(this);
    return original.call(this);
  };
  const realm = createRealm({ classicScripts: true, sourceResolver: () => undefined });
  try {
    expect(await realm.evaluate("var saved=()=>42")).toMatchObject({ ok: true });
    Scope.prototype.retainedDataRoots = original;
    const scope = [...captured].find((value) => value.moduleEnvironment !== undefined)!;
    expect(scope).toBeDefined();
    const environment = scope.moduleEnvironment!;
    const enumerate = vi.spyOn(Object, "values");
    let checks: number;
    try {
      scope.retainedDataRoots();
      scope.retainedDataRoots();
      checks = enumerate.mock.calls.filter(([value]) => value === environment.namespaces).length;
    } finally {
      enumerate.mockRestore();
    }
    expect(checks).toBe(0);
    expect(Object.isFrozen(environment)).toBe(true);
    expect(Object.isFrozen(environment.namespaces)).toBe(true);
    expect(Object.isFrozen(environment.available)).toBe(true);
  } finally {
    Scope.prototype.retainedDataRoots = original;
    await realm.close();
  }
});

it("still charges late namespace growth and replacement on mutable foreign environments", () => {
  const scope = new Scope();
  scope.moduleEnvironment = { available: [], namespaces: {} };
  const before = scope.retainedDataRoots();
  scope.moduleEnvironment.namespaces.late = { text: "x".repeat(1000) };
  expect(scope.retainedDataRoots()).toContain(scope.moduleEnvironment.namespaces.late);
  expect(before).not.toContain(scope.moduleEnvironment.namespaces.late);
  scope.moduleEnvironment.namespaces = { other: { text: "y".repeat(2000) } };
  expect(scope.retainedDataRoots()).toContain(scope.moduleEnvironment.namespaces.other);
});

it("keeps namespace getters and their same-walk mutations observable", () => {
  const scope = new Scope();
  const first = { text: "first" };
  const second = { text: "second" };
  const namespaces = {};
  let calls = 0;
  Object.defineProperty(namespaces, "entry", {
    enumerable: true,
    get() {
      calls++;
      return calls === 1 ? first : second;
    }
  });
  scope.moduleEnvironment = { available: [], namespaces };
  expect(scope.retainedDataRoots()).toContain(first);
  expect(scope.retainedDataRoots()).toContain(second);
  expect(calls).toBe(2);
});

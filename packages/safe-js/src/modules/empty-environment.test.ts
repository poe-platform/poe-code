import { expect, it, vi } from "vitest";
import { Budget } from "../interp/budget.js";
import { Scope } from "../interp/scope.js";
import { hasImmutableEmptyModuleEnvironment } from "./empty-environment.js";
import {
  attachSourceLoader,
  createImmutableEmptyModuleEnvironment,
  createModuleEnvironment
} from "./registry.js";

it("freezes certified tables even when a later host freeze hook returns without freezing", () => {
  const hook = vi
    .spyOn(Object, "freeze")
    .mockImplementation(<Value>(value: Value) => value as Readonly<Value>);
  let environment;
  try {
    environment = createImmutableEmptyModuleEnvironment({ budget: new Budget() });
  } finally {
    hook.mockRestore();
  }
  expect(Object.isFrozen(environment)).toBe(true);
  expect(Object.isFrozen(environment.namespaces)).toBe(true);
  expect(Object.isFrozen(environment.available)).toBe(true);
  expect(Reflect.set(environment.namespaces, "late", { text: "hidden" })).toBe(false);
});

it("does not let a later WeakSet hook certify mutable foreign namespaces", () => {
  const scope = new Scope();
  const retained = { text: "x".repeat(1000) };
  scope.moduleEnvironment = { available: [], namespaces: { retained } };
  const hook = vi.spyOn(WeakSet.prototype, "has").mockReturnValue(true);
  let roots;
  try {
    roots = scope.retainedDataRoots();
  } finally {
    hook.mockRestore();
  }
  expect(roots).toContain(retained);
});

it("rejects wrapped namespaces instead of certifying a populated environment", () => {
  expect(() =>
    createImmutableEmptyModuleEnvironment({
      budget: new Budget(),
      wrappedModules: new Map([["cap", { text: "retained" }]])
    })
  ).toThrow("wrapped modules");
});

it("revokes certification on reattachment and preserves it only for opted-in source loaders", () => {
  const environment = createImmutableEmptyModuleEnvironment({ budget: new Budget() });
  expect(hasImmutableEmptyModuleEnvironment(environment)).toBe(true);
  attachSourceLoader(environment, async () => ({}), { preserveImmutableNamespaces: true });
  expect(hasImmutableEmptyModuleEnvironment(environment)).toBe(true);
  attachSourceLoader(environment, async () => ({}));
  expect(hasImmutableEmptyModuleEnvironment(environment)).toBe(false);
  const restored = createImmutableEmptyModuleEnvironment({ budget: new Budget() });
  createModuleEnvironment(undefined, { budget: new Budget() }, restored);
  expect(hasImmutableEmptyModuleEnvironment(restored)).toBe(false);
});

it("does not certify arbitrary frozen foreign tables when their source loader is preserved", () => {
  const environment = Object.freeze({ available: [], namespaces: Object.freeze({}) });
  attachSourceLoader(environment, async () => ({}), { preserveImmutableNamespaces: true });
  expect(hasImmutableEmptyModuleEnvironment(environment)).toBe(false);
});

it("keeps replacement module-environment getters observable on every scope read", () => {
  const scope = new Scope();
  const retained = { text: "foreign" };
  const environment = { available: [], namespaces: { retained } };
  const read = vi.fn(() => environment);
  Object.defineProperty(scope, "moduleEnvironment", { get: read });
  expect(scope.retainedDataRoots()).toContain(retained);
  expect(read).toHaveBeenCalledTimes(2);
});

it("does not certify namespaces whose proxy hides entries until the table is frozen", () => {
  const budget = new Budget();
  const target = { hidden: { text: "x".repeat(1000) } };
  const namespaces = new Proxy(target, {
    ownKeys(value) {
      return Object.isExtensible(value) ? [] : Reflect.ownKeys(value);
    }
  });
  const hook = vi.spyOn(Object, "create").mockReturnValue(namespaces);
  let failure: unknown;
  try {
    try {
      createImmutableEmptyModuleEnvironment({ budget });
    } catch (error) {
      failure = error;
    }
  } finally {
    hook.mockRestore();
  }
  expect(failure).toBeInstanceOf(TypeError);
  expect((failure as Error).message).toContain("wrapped modules");
});

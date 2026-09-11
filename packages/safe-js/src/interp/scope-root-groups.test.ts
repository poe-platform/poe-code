import { expect, it } from "vitest";
import { Scope } from "./scope.js";
import { measureSandboxData } from "./values.js";

it("reuses one accounting group for unchanged bindings and numeric loop updates", () => {
  const scope = new Scope({ first: "abc", second: "def" });
  scope.declare("index", "let", 0);
  const roots = scope.retainedDataRoots();
  expect(roots).toHaveLength(1);
  scope.assign("index", 1);
  scope.declareAlias("alias", "first");
  expect(scope.retainedDataRoots()[0]).toBe(roots[0]);
  expect(scope.child().retainedDataRoots()[0]).toBe(roots[0]);
  expect(measureSandboxData([...roots, ...scope.child().retainedDataRoots()])).toBe(6);
});

it("replaces the group when a charged binding is declared", () => {
  const scope = new Scope({ first: "abc" });
  const before = scope.retainedDataRoots();
  scope.declare("second", "const", "def");
  const after = scope.retainedDataRoots();
  expect(after).toHaveLength(1);
  expect(after[0]).not.toBe(before[0]);
  expect(measureSandboxData(before)).toBe(3);
  expect(measureSandboxData([...before, ...after])).toBe(6);
});

it("invalidates the resolved owner without double charging unchanged bindings", () => {
  const scope = new Scope({ unchanged: "abc" });
  scope.declare("changing", "let", "def");
  scope.declareAlias("alias", "changing");
  const before = scope.retainedDataRoots();
  scope.child().assign("alias", "longer");
  const after = scope.retainedDataRoots();
  expect(after).toHaveLength(1);
  expect(after[0]).not.toBe(before[0]);
  expect(measureSandboxData(before)).toBe(6);
  expect(measureSandboxData(after)).toBe(9);
  expect(measureSandboxData([...before, ...after])).toBe(12);
});

it("observes hydration after an empty scope has been measured", () => {
  const scope = new Scope();
  expect(measureSandboxData(scope.retainedDataRoots())).toBe(0);
  scope.hydrateFrame(new Scope({ first: "abc", second: "def" }).captureFrame());
  expect(scope.retainedDataRoots()).toHaveLength(1);
  expect(measureSandboxData(scope.retainedDataRoots())).toBe(6);
});

it("observes newly charged replacements even when assignment keeps the same value", () => {
  const scope = new Scope({}, undefined, undefined, { chargeData: false });
  scope.declare("value", "var", "abc");
  expect(measureSandboxData(scope.retainedDataRoots())).toBe(0);
  scope.assign("value", "abc");
  expect(measureSandboxData(scope.retainedDataRoots())).toBe(3);
});

it("invalidates the resolved copy destination and releases charged-to-zero groups", () => {
  const scope = new Scope();
  scope.declare("value", "let", "abc");
  const before = scope.retainedDataRoots();
  const source = new Scope();
  source.declare("value", "let", "longer");
  scope.child().copyInitializedBindingsFrom(source, ["value"]);
  expect(scope.retainedDataRoots()[0]).not.toBe(before[0]);
  expect(measureSandboxData(scope.retainedDataRoots())).toBe(6);
  scope.assign("value", 0);
  expect(measureSandboxData(scope.retainedDataRoots())).toBe(0);
  scope.assign("value", "abc");
  expect(scope.retainedDataRoots()[0]).not.toBe(before[0]);
});

import { expect, it } from "vitest";
import { Scope } from "./scope.js";
import { measureSandboxData } from "./values.js";

it("drops deleted binding values from accounting roots", () => {
  const scope = new Scope();
  scope.declareVar("x", {deletable: true});
  scope.assignOwnBinding("x", "x".repeat(200));
  const before = measureSandboxData(scope.retainedDataRoots());
  expect(scope.deleteBinding("x")).toBe(true);
  expect(measureSandboxData(scope.retainedDataRoots())).toBeLessThan(before);
  expect(scope.lookup("x")).toEqual({found: false});
});

it("preserves a remaining alias when deleting one name", () => {
  const scope = new Scope();
  scope.declareVar("x", {deletable: true});
  scope.assignOwnBinding("x", {value: 3});
  scope.declareAlias("alias", "x");
  const before = measureSandboxData(scope.retainedDataRoots());
  expect(scope.deleteBinding("x")).toBe(true);
  expect(scope.lookup("alias")).toMatchObject({found: true, value: {value: 3}});
  expect(measureSandboxData(scope.retainedDataRoots())).toBe(before);
});

it("does not replace an outer binding through a missing strict reference", () => {
  const parent = new Scope();
  parent.declareVar("x");
  parent.assignOwnBinding("x", 9);
  const child = parent.child({}, {functionBoundary: true});
  expect(() => child.assignOwnBinding("x", 3, true)).toThrow(ReferenceError);
  expect(parent.lookup("x")).toMatchObject({value: 9});
  child.assignOwnBinding("x", 3, false);
  expect(child.lookup("x")).toMatchObject({value: 3});
  expect(parent.lookup("x")).toMatchObject({value: 9});
  expect(child.deleteBinding("x")).toBe(true);
});

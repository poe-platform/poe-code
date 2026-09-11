import { expect, it } from "vitest";
import { Budget, createRealm } from "../core.js";
import { Scope } from "./scope.js";
import { measureSandboxData } from "./values.js";
import { MAX_DATA_DEPTH } from "../graph-depth.js";
import type { SandboxObject } from "./values.js";

it.each(["assignment", "copy"])("invalidates obsolete snapshots immediately on %s", mode => {
  const value = {text: "old guest data"};
  const scope = new Scope();
  scope.declare("value", "let", value);
  const original = scope.retainedDataRoots()[0];
  if (mode === "assignment") {
    scope.assign("value", 0);
    scope.assign("value", value);
  } else {
    scope.copyInitializedBindingsFrom(new Scope({value: 0}), ["value"]);
    scope.copyInitializedBindingsFrom(new Scope({value}), ["value"]);
  }
  // No intermediate measurement: a dead value must not wait for another scan.
  expect(scope.retainedDataRoots()[0]).not.toBe(original);
  expect(measureSandboxData(scope.retainedDataRoots())).toBe(measureSandboxData([value]));
});

it("keeps iteration cells separate and observes copied and hydrated bindings", () => {
  const scope = new Scope();
  scope.declare("text", "let", "abc");
  const iteration = scope.iterationChild(["text"]);
  expect(measureSandboxData([...scope.retainedDataRoots(), ...iteration.retainedDataRoots()])).toBe(6);
  iteration.assign("text", "longer");
  scope.copyInitializedBindingsFrom(iteration, ["text"]);
  expect(measureSandboxData(scope.retainedDataRoots())).toBe(6);
  const restored = new Scope();
  restored.hydrateFrame(scope.captureFrame());
  expect(measureSandboxData(restored.retainedDataRoots())).toBe(6);
});

it("observes scope metadata installed after the first accounting snapshot", () => {
  const scope = new Scope({text: "abc"});
  scope.retainedDataRoots();
  scope.declarePrivateName("private");
  scope.resourceState = {resources: []};
  scope.moduleEnvironment = {available: ["module"], namespaces: {module: {text: "module text"}}};
  expect(measureSandboxData(scope.retainedDataRoots())).toBe(measureSandboxData(scope.retainedValues()));
  scope.moduleEnvironment.namespaces.other = {text: "another module"};
  scope.declarePrivateName("another private");
  expect(measureSandboxData(scope.retainedDataRoots())).toBe(measureSandboxData(scope.retainedValues()));
});

it("does not add artificial graph depth or weaken the data-depth limit", () => {
  let value: SandboxObject = {};
  for (let index = 0; index < MAX_DATA_DEPTH; index++) value = {next: value};
  const scope = new Scope({value});
  expect(measureSandboxData(scope.retainedDataRoots())).toBe(measureSandboxData([value]));
  const tooDeep = new Scope({value: {next: value}});
  expect(() => measureSandboxData(tooDeep.retainedDataRoots())).toThrow();
  expect(() => measureSandboxData([{next: value}])).toThrow();
});

it("deduplicates aliases but not independent equal primitive bindings", () => {
  const scope = new Scope({first: "abc", second: "abc"});
  scope.declareAlias("alias", "first");
  expect(measureSandboxData([...scope.retainedDataRoots(), ...scope.child().retainedDataRoots()])).toBe(6);
  expect(scope.retainedValues()).toEqual(["abc", "abc", "abc"]);
});

it("keeps earlier binding snapshots while observing subsequent assignments", () => {
  const scope = new Scope();
  scope.declare("text", "let", "abc");
  const before = scope.retainedDataRoots();
  scope.assign("text", "longer");
  expect(measureSandboxData(before)).toBe(3);
  expect(measureSandboxData(scope.retainedDataRoots())).toBe(6);
  expect(measureSandboxData([...before, ...scope.retainedDataRoots()])).toBe(9);
});

it("remeasures objects without charging internal binding bookkeeping", () => {
  const value = {text: "abc"};
  const scope = new Scope({value});
  const roots = scope.retainedDataRoots();
  expect(measureSandboxData(roots)).toBe(measureSandboxData([value]));
  value.text = "longer";
  expect(measureSandboxData(roots)).toBe(measureSandboxData([value]));
});

it.each([0, 1, 2, 3])("charges a shared binding once across %i capturing closures", async count => {
  const source = `const text=${JSON.stringify("x".repeat(700))};`
    + Array.from({length:count}, (_, index) => `function f${index}(){return text}`).join("")
    + "return 7";
  const budget = new Budget({dataSize:1600});
  const realm = createRealm({budget});
  try {
    expect(await realm.evaluate(source)).toMatchObject({ok:true,returnValue:7});
    expect(budget.peakDataSize).toBe(700 + count);
  } finally { await realm.close(); }
});

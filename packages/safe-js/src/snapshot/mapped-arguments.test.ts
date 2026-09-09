import { expect, it } from "vitest";
import { createMappedSandboxArguments, mappedArgumentStates } from "../interp/arguments.js";
import { Scope } from "../interp/scope.js";
import { serialize, type RuntimeSnapshotValue } from "./serialize.js";
import { restore } from "./restore.js";

function capture(args: ReturnType<typeof createMappedSandboxArguments>) {
  return serialize({source: "return 0", currentAstNodeId: 1,
    scopeChain: [{id: "module", bindings: {args: args as RuntimeSnapshotValue}}],
    callStack: [], pendingPromises: [], moduleBindings: {}});
}

it("restores mapped arguments and the parameter cells they alias", () => {
  const scope = new Scope();
  scope.declare("a", "var", 1);
  const args = createMappedSandboxArguments([1], ["a"], scope, undefined);
  scope.declare("arguments", "var", args);
  scope.assign("a", 4);
  const source = "return 0";
  const saved = serialize({source, currentAstNodeId: 1,
    scopeChain: [{id: "module", bindings: {args: args as RuntimeSnapshotValue}}],
    callStack: [], pendingPromises: [], moduleBindings: {}});
  const restored = restore(JSON.parse(JSON.stringify(saved)), {source});
  const value = restored.currentScope.lookup("args").value as typeof args;
  const mapping = mappedArgumentStates.get(value)!;
  expect(value["0"]).toBe(4);
  expect(mapping.scope.lookup("arguments").value).toBe(value);
  mapping.scope.assign("a", 6);
  expect(value["0"]).toBe(6);
  value["0"] = 7;
  expect(mapping.scope.lookup("a").value).toBe(7);
});

it.each(["missing-binding", "duplicate-index", "duplicate-name", "non-index", "readonly-index", "wrong-scope", "scope-leak"])(
  "rejects forged mapped arguments state: %s", alteration => {
    const scope = new Scope();
    scope.declare("a", "var", 1);
    const args = createMappedSandboxArguments([1], ["a"], scope, undefined);
    const saved = JSON.parse(JSON.stringify(capture(args)));
    const node = (Object.values(saved.heap) as Array<{kind: string; scope: {kind: string; id: number}; parameters: string[][];
      state: {properties: {properties: Array<[string, {value: unknown; writable: boolean}]>}}}>).find(value => value.kind === "mapped-arguments")!;
    const index = node.state.properties.properties.find(([key]) => key === "0")![1];
    if (alteration === "missing-binding") node.parameters[0][1] = "missing";
    if (alteration === "duplicate-index") node.parameters.push(["0", "other"]);
    if (alteration === "duplicate-name") {
      node.state.properties.properties.push(["1", {...index}]);
      node.parameters.push(["1", "a"]);
    }
    if (alteration === "non-index") node.parameters[0][0] = "01";
    if (alteration === "readonly-index") index.writable = false;
    if (alteration === "wrong-scope") node.scope = {kind: "ref", id: 1};
    if (alteration === "scope-leak") index.value = node.scope;
    expect(() => restore(saved, {source: "return 0"})).toThrow();
  }
);

it("preserves symbol properties on mapped arguments", () => {
  const scope = new Scope();
  scope.declare("a", "var", 1);
  const args = createMappedSandboxArguments([1], ["a"], scope, undefined);
  const symbol = Symbol("retained");
  Object.defineProperty(args, symbol, {value: 9, configurable: true});
  const restored = restore(JSON.parse(JSON.stringify(capture(args))), {source: "return 0"});
  const value = restored.currentScope.lookup("args").value as typeof args;
  const key = Object.getOwnPropertySymbols(value).find(key => key.description === "retained");
  expect(key).toBeDefined();
  expect(Object.getOwnPropertyDescriptor(value, key!)?.value).toBe(9);
});

it.each(["freeze", "delete", "readonly"])("preserves disconnected parameter indices after %s", mode => {
  const scope = new Scope();
  scope.declare("a", "var", 1);
  const args = createMappedSandboxArguments([1], ["a"], scope, undefined);
  scope.assign("a", 4);
  if (mode === "freeze") Object.freeze(args);
  if (mode === "delete") delete args["0"];
  if (mode === "readonly") Object.defineProperty(args, "0", {writable: false});
  const restored = restore(JSON.parse(JSON.stringify(capture(args))), {source: "return 0"});
  const value = restored.currentScope.lookup("args").value as typeof args;
  mappedArgumentStates.get(value)!.scope.assign("a", 9);
  expect(value["0"]).toBe(mode === "delete" ? undefined : 4);
  expect(Object.isFrozen(value)).toBe(mode === "freeze");
  expect(Object.getOwnPropertyDescriptor(value, Symbol.iterator)).toEqual(Object.getOwnPropertyDescriptor(args, Symbol.iterator));
});

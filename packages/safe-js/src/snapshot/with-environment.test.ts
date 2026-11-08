import { assert, expect, it } from "vitest";
import { Scope } from "../interp/scope.js";
import { interpret } from "../interp/interpreter.js";
import { getClosureOrigin } from "../interp/closure-origin.js";
import { parseModule } from "../parse/parser.js";
import { serialize, type RuntimeSnapshotValue } from "./serialize.js";
import { restore } from "./restore.js";
import { isSandboxClosure } from "../interp/values.js";

async function capture() {
  const source = "return ()=>x";
  const parent = new Scope();
  parent.declare("x", "let", 1);
  const object = {x: 2, [Symbol.unscopables]: {x: true}};
  const result = await interpret(parseModule(source).body[0], {scope: parent.withObject(object)});
  assert(result.ok);
  const wire = serialize({source, currentAstNodeId: 1,
    scopeChain: [{id: "module", bindings: {reader: result.returnValue as RuntimeSnapshotValue}}],
    callStack: [], pendingPromises: [], moduleBindings: {}});
  return {source, wire};
}

it("restores with identity, unscopables behavior and object retention", async () => {
  const {source, wire} = await capture();
  const restored = restore(JSON.parse(JSON.stringify(wire)), {source});
  const binding = restored.currentScope.lookup("reader");
  assert(binding.found && isSandboxClosure(binding.value));
  const scope = getClosureOrigin(binding.value)!.scope;
  const reference = await scope.resolveBinding("x", {
    has: (object, key) => Reflect.has(object, key),
    get: async (object, key) => Reflect.get(object, key)
  });
  assert(reference.kind === "binding");
  expect(reference.scope.lookup("x")).toMatchObject({found: true, value: 1});
  expect(scope.retainedDataRoots()).toContainEqual({x: 2, [Symbol.unscopables]: {x: true}});
});

it.each(["primitive", "symbol", "scope", "global", "root", "function"])("rejects forged with environment: %s", async alteration => {
  const {source, wire} = await capture();
  const frame = Object.values(wire.heap).find(node => node.kind === "scope-frame" && "withObject" in node);
  assert(frame?.kind === "scope-frame");
  if (alteration === "primitive") Object.assign(frame, {withObject: 7});
  if (alteration === "symbol") {
    const symbol = Object.entries(wire.heap).find(([, node]) => node.kind === "symbol");
    assert(symbol);
    Object.assign(frame, {withObject: {kind: "ref", id: Number(symbol[0])}});
  }
  if (alteration === "scope") Object.assign(frame, {withObject: frame.parent});
  if (alteration === "global") Object.assign(frame, {objectEnvironment: frame.withObject});
  if (alteration === "root") frame.parent = {kind: "undefined"};
  if (alteration === "function") frame.functionBoundary = true;
  expect(() => restore(wire, {source})).toThrow();
});

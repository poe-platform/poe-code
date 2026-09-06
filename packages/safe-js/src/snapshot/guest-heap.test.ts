import { expect, it } from "vitest";
import { Budget } from "../interp/budget.js";
import { createBuiltinBindings } from "../interp/globals.js";
import { Scope } from "../interp/scope.js";
import { interpret } from "../interp/interpreter.js";
import { parseModule } from "../parse/parser.js";
import { captureGuestHeapNode } from "./guest-heap.js";

it("captures intrinsic descriptors rather than only their names", () => {
  const globals = createBuiltinBindings({ budget: new Budget() });
  const json = globals.JSON as Record<string, unknown>;
  const shared = { value: 3n };
  Object.defineProperty(json, "extra", { value: shared, configurable: true });
  const node = captureGuestHeapNode(json, value => value);
  expect(node).toMatchObject({ kind: "intrinsic", state: { properties: { properties: expect.arrayContaining([
    ["extra", { kind: "data", value: shared, enumerable: false, writable: false, configurable: true }]
  ]) } } });
});

it("captures lexical cells and parent references without flattening them", () => {
  const parent = new Scope();
  const child = parent.child();
  child.predeclare("pending", "let");
  child.declare("ready", "const", undefined);
  const node = captureGuestHeapNode(child, value => value === parent ? "parent-reference" : value);
  expect(node).toMatchObject({ kind: "scope-frame", parent: "parent-reference", cells: [
    { kind: "let", initialized: false }, { kind: "const", initialized: true, value: undefined }
  ] });
});

it("captures an interpreted function's scope, origin and full own descriptors", async () => {
  const result = await interpret(parseModule("{let count=3;return function value(){return count}}").body[0]);
  if (!result.ok) throw new Error(result.error.message);
  const node = captureGuestHeapNode(result.returnValue as object, value => value);
  expect(node).toMatchObject({ kind: "guest-function", astNodeId: expect.any(Number), scope: expect.any(Scope), state: { properties: { properties: expect.arrayContaining([
    ["name", { kind: "data", value: "value", configurable: true, enumerable: false, writable: false }]
  ]) } } });
});

it("does not assign guest heap records to arbitrary host objects", () => {
  expect(captureGuestHeapNode({ name: "Number" }, value => value)).toBeUndefined();
});

import { expect, it } from "vitest";
import { parseModule } from "../parse/parser.js";
import { serialize, type RuntimeSnapshotValue } from "./serialize.js";
import { restore } from "./restore.js";
import { Budget } from "../interp/budget.js";
import { getSandboxPrototype, setSandboxPrototype } from "../interp/object-model.js";

const source = "{}";
const ast = parseModule(source);
function snapshot(value: unknown) {
  return serialize({ source, currentAstNodeId: ast.body[0].nodeId!,
    scopeChain: [{ id: "external", bindings: { value: value as RuntimeSnapshotValue } }],
    callStack: [], pendingPromises: [], moduleBindings: {} });
}

it("preserves non-enumerable aliases, cycles, holes and descriptor flags", () => {
  const value = new Array(3);
  const child = { answer: 42 };
  Object.defineProperty(value, "1", { value: child, writable: true });
  Object.defineProperty(value, "hidden", { value: child });
  Object.defineProperty(value, "self", { value });
  Object.seal(value);
  const restored = restore(JSON.parse(JSON.stringify(snapshot(value))), { source }).currentScope.lookup("value");
  if (!restored.found) throw new Error("Missing restored array");
  const array = restored.value as unknown[];
  expect(Array.isArray(array)).toBe(true);
  expect(array).toHaveLength(3);
  expect(0 in array).toBe(false);
  expect(2 in array).toBe(false);
  expect(Object.isSealed(array)).toBe(true);
  expect(Object.getOwnPropertyDescriptor(array, "hidden")?.value).toBe(array[1]);
  expect(Object.getOwnPropertyDescriptor(array, "self")?.value).toBe(array);
  expect(Object.getOwnPropertyDescriptor(array, "1")).toMatchObject({ writable: true, enumerable: false, configurable: false });
});

it.each(["missing", "negative", "fractional", "overflow", "bounds", "configurable", "enumerable"])(
  "rejects malformed array length: %s", mutation => {
    const wire = snapshot(Object.freeze([1]));
    const array = Object.values(wire.heap!).find(node => node.kind === "guest-array")!;
    const properties = array.state.properties.properties;
    const length = properties.find(([key]) => key === "length")!;
    if (mutation === "missing") properties.splice(properties.indexOf(length), 1);
    else if (mutation === "configurable" || mutation === "enumerable") length[1][mutation] = true;
    else Object.assign(length[1], { value: { negative: -1, fractional: 0.5, overflow: 0x100000000, bounds: 0 }[mutation] });
    expect(() => restore(JSON.parse(JSON.stringify(wire)), { source })).toThrow();
  }
);

it("rejects sparse descriptor arrays above the caller's allocation limit", () => {
  const value = Object.freeze(new Array(128));
  const wire = snapshot(value);
  expect(() => restore(JSON.parse(JSON.stringify(wire)), { source, budget: new Budget({ arrayLength: 16 }) }))
    .toThrow("allocation limit");
});

it.each([false, true])("preserves a custom array prototype (frozen=%s)", frozen => {
  const value = [1];
  setSandboxPrototype(value, { inherited: 7 }, new Budget());
  if (frozen) Object.freeze(value);
  const restored = restore(JSON.parse(JSON.stringify(snapshot(value))), { source }).currentScope.lookup("value");
  if (!restored.found) throw new Error("Missing restored array");
  expect(getSandboxPrototype(restored.value as object)).toMatchObject({ inherited: 7 });
});

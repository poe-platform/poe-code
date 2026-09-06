import { expect, it } from "vitest";
import { Budget } from "../interp/budget.js";
import { MAX_DATA_DEPTH } from "../graph-depth.js";
import { createSandboxClosure } from "../interp/values.js";
import type { GuestHeapNode } from "./guest-heap.js";
import { allocateGuestScopes, hydrateGuestScopes } from "./scope-frames.js";

type Frame = Extract<GuestHeapNode<unknown>, { kind: "scope-frame" }>;
const frame = (parent?: number): Frame => ({ kind: "scope-frame", parent: parent === undefined ? { kind: "undefined" } : { kind: "ref", id: parent },
  importMeta: { kind: "undefined" }, functionBoundary: parent === undefined, chargeData: parent !== undefined, bindings: [], cells: [] });

it("allocates out-of-order parents before hydrating aliased cells and metadata", () => {
  const parent = frame();
  parent.importMeta = { kind: "ref", id: 3 };
  parent.restoredBindings = [["saved", { kind: "ref", id: 3 }]];
  const child = frame(1);
  child.bindings = [["value", 0], ["alias", 0], ["pending", 1]];
  child.cells = [{ kind: "let", initialized: true, value: { kind: "ref", id: 3 } }, { kind: "const", initialized: false }];
  const frames = new Map([[2, child], [1, parent]]);
  const budget = new Budget();
  const scopes = allocateGuestScopes(frames, budget);
  const shared = { value: 3 };
  hydrateGuestScopes(frames, scopes, value => (value as { kind: string }).kind === "undefined" ? undefined : shared, budget);
  expect(scopes.get(2)!.lookupImportMeta() === shared).toBe(true);
  expect(scopes.get(2)!.consumeRestoredBinding("saved")).toMatchObject({ found: true, value: shared });
  scopes.get(2)!.assign("alias", 4);
  expect(scopes.get(2)!.lookup("value")).toMatchObject({ found: true, value: 4 });
  expect(() => scopes.get(2)!.lookup("pending")).toThrow("before initialization");
});

it("makes scope identities available before decoding recursive closure captures", async () => {
  const root = frame();
  root.bindings = [["read", 0], ["count", 1]];
  root.cells = [{ kind: "const", initialized: true, value: { kind: "ref", id: 2 } }, { kind: "let", initialized: true, value: 3 }];
  const frames = new Map([[1, root]]);
  const budget = new Budget();
  const scopes = allocateGuestScopes(frames, budget);
  const closure = createSandboxClosure({ guest: true, call: () => {
    const binding = scopes.get(1)!.lookup("count");
    return binding.found ? binding.value : undefined;
  } });
  hydrateGuestScopes(frames, scopes, value => typeof value === "number" ? value : (value as { kind: string }).kind === "undefined" ? undefined : closure, budget);
  expect(scopes.get(1)!.lookup("read")).toMatchObject({ found: true, value: closure });
  expect(await closure.call([])).toBe(3);
});

it("rejects cyclic parent allocation", () => {
  expect(() => allocateGuestScopes(new Map([[1, frame(2)], [2, frame(1)]]), new Budget())).toThrow("Cyclic scope parent");
});

it("limits parent depth even when ancestors were allocated by earlier roots", () => {
  const frames = new Map<number, Frame>();
  for (let id = 1; id <= MAX_DATA_DEPTH + 2; id++) frames.set(id, frame(id === 1 ? undefined : id - 1));
  expect(() => allocateGuestScopes(frames, new Budget())).toThrow("dataDepth");
});

it("meters scope allocation work", () => {
  expect(() => allocateGuestScopes(new Map([[1, frame()], [2, frame(1)]]), new Budget({ maxSteps: 1 }))).toThrow("steps: 2 > 1");
});

it("rejects missing scope parents before decoding data", () => {
  expect(() => allocateGuestScopes(new Map([[1, frame(2)]]), new Budget())).toThrow("Missing scope frame");
});

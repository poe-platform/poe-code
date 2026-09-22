import { describe, expect, it } from "vitest";
import { Budget } from "../interp/budget.js";
import { Scope } from "../interp/scope.js";
import { measureSandboxData } from "../interp/values.js";
import { captureGuestHeapNode, type GuestHeapNode } from "./guest-heap.js";
import { validateGuestHeapNode } from "./guest-heap-validation.js";
import { allocateGuestScopes, hydrateGuestScopes } from "./scope-frames.js";

type Frame = Extract<GuestHeapNode<unknown>, { kind: "scope-frame" }>;

function fixture(globalVarNames?: string[]) {
  const root: Frame = {
    kind: "scope-frame",
    parent: { kind: "undefined" },
    importMeta: { kind: "undefined" },
    functionBoundary: true,
    chargeData: false,
    bindings: [],
    cells: [],
    objectEnvironment: { kind: "ref", id: 3 }
  };
  const global: Frame = {
    kind: "scope-frame",
    parent: { kind: "ref", id: 1 },
    importMeta: { kind: "undefined" },
    functionBoundary: false,
    chargeData: true,
    globalEnvironment: true,
    bindings: [],
    cells: [],
    ...(globalVarNames === undefined ? {} : { globalVarNames })
  };
  const heap = { "1": root, "2": global, "3": { kind: "intrinsic", id: '["globalThis"]' } };
  return {
    root,
    global,
    heap,
    frames: new Map([
      [2, global],
      [1, root]
    ])
  };
}

describe("global declaration history snapshot metadata", () => {
  it("roundtrips deduplicated history independently of global property descriptors", () => {
    const object = { remembered: 1, deletable: 2 };
    const root = new Scope();
    root.hydrateFrame({ ...root.captureFrame(), objectEnvironment: object });
    const global = root.child({}, { globalEnvironment: true });
    global.declareVar("remembered");
    global.declareVar("remembered");
    global.declareVar("deletable");
    Reflect.deleteProperty(object, "remembered");
    const encode = (value: unknown) =>
      value === root
        ? { kind: "ref", id: 1 }
        : value === object
          ? { kind: "ref", id: 3 }
          : { kind: "undefined" };
    const rootFrame = captureGuestHeapNode(root, encode) as Frame;
    const globalFrame = captureGuestHeapNode(global, encode) as Frame;
    expect(globalFrame.globalVarNames).toEqual(["remembered", "deletable"]);
    const frames = new Map([
      [2, globalFrame],
      [1, rootFrame]
    ]);
    const heap = {
      "1": rootFrame,
      "2": globalFrame,
      "3": { kind: "intrinsic", id: '["globalThis"]' }
    };
    expect(validateGuestHeapNode(globalFrame, heap)).toBe(true);
    const budget = new Budget();
    const scopes = allocateGuestScopes(frames, budget);
    hydrateGuestScopes(
      frames,
      scopes,
      (value) => ((value as { kind: string }).kind === "undefined" ? undefined : object),
      budget
    );
    const restored = scopes.get(2)!;
    expect(restored.captureFrame().globalVarNames).toEqual(["remembered", "deletable"]);
    expect(() =>
      restored.validateScriptDeclarations(new Set(["remembered"]), new Set(), new Set())
    ).toThrow(SyntaxError);
    expect(measureSandboxData(restored.retainedDataRoots())).toBeGreaterThanOrEqual(
      "remembered".length + "deletable".length
    );
    expect(restored.deleteGlobalBinding("deletable")).toBe(true);
    expect(() =>
      restored.validateScriptDeclarations(new Set(["deletable"]), new Set(), new Set())
    ).not.toThrow();
    expect(restored.captureFrame().globalVarNames).toEqual(["remembered"]);
    expect(globalFrame.globalVarNames).toEqual(["remembered", "deletable"]);
  });

  it("accepts and hydrates older frames without declaration metadata", () => {
    const { global, heap, frames } = fixture();
    expect(validateGuestHeapNode(global, heap)).toBe(true);
    const budget = new Budget();
    const scopes = allocateGuestScopes(frames, budget);
    hydrateGuestScopes(
      frames,
      scopes,
      (value) => ((value as { kind: string }).kind === "undefined" ? undefined : {}),
      budget
    );
    expect(scopes.get(2)!.captureFrame()).not.toHaveProperty("globalVarNames");
    expect(() =>
      scopes.get(2)!.validateScriptDeclarations(new Set(["available"]), new Set(), new Set())
    ).not.toThrow();
  });

  it("accepts an explicitly empty global declaration list", () => {
    const { global, heap } = fixture([]);
    expect(validateGuestHeapNode(global, heap)).toBe(true);
  });

  it.each([
    { names: null },
    { names: undefined },
    { names: "remembered" },
    { names: [1] },
    { names: [""] },
    { names: ["same", "same"] },
    { names: new Array(1) }
  ])("rejects malformed declaration names: %j", ({ names }) => {
    const { global, heap } = fixture();
    Object.assign(global, { globalVarNames: names });
    expect(() => validateGuestHeapNode(global, heap)).toThrow(TypeError);
  });

  it.each([
    { globalEnvironment: false },
    { functionBoundary: true },
    { parent: { kind: "undefined" } },
    { objectEnvironment: { kind: "ref", id: 3 } }
  ])("rejects declaration metadata outside a global lexical frame: %j", (flags) => {
    const { global, heap } = fixture(["remembered"]);
    Object.assign(global, flags);
    expect(() => validateGuestHeapNode(global, heap)).toThrow(TypeError);
  });

  it("rejects declaration history colliding with a lexical cell", () => {
    const { global, heap } = fixture(["remembered"]);
    global.bindings = [["remembered", 0]];
    global.cells = [{ kind: "let", initialized: true, value: 1 }];
    expect(() => validateGuestHeapNode(global, heap)).toThrow(TypeError);
  });

  it("applies the snapshot array bound to declaration names", () => {
    const { global, heap } = fixture(["first", "second"]);
    expect(() => validateGuestHeapNode(global, heap, 1)).toThrow(TypeError);
  });

  it.each([
    { limits: { stringLength: 3 }, message: "stringLength" },
    { limits: { arrayLength: 1 }, message: "arrayLength" },
    { limits: { dataSize: 8 }, message: "dataSize" },
    { limits: { maxSteps: 4 }, message: "steps" }
  ])("meters declaration metadata hydration against $message", ({ limits, message }) => {
    const { frames } = fixture(["remembered", "another"]);
    const scopes = allocateGuestScopes(frames, new Budget());
    expect(() =>
      hydrateGuestScopes(
        frames,
        scopes,
        (value) => ((value as { kind: string }).kind === "undefined" ? undefined : {}),
        new Budget(limits)
      )
    ).toThrow(message);
  });

  it.each([{ names: ["same", "same"] }, { names: [""] }, { names: [1] }])(
    "rejects malformed direct ScopeFrame history: %j",
    ({ names }) => {
      const root = new Scope();
      const global = root.child({}, { globalEnvironment: true });
      expect(() =>
        global.hydrateFrame({ ...global.captureFrame(), globalVarNames: names as string[] })
      ).toThrow(TypeError);
    }
  );

  it("rejects direct hydration that collides with a lexical binding", () => {
    const root = new Scope();
    const global = root.child({}, { globalEnvironment: true });
    expect(() =>
      global.hydrateFrame({
        ...global.captureFrame(),
        globalVarNames: ["remembered"],
        bindings: [["remembered", 0]],
        cells: [{ kind: "const", initialized: true, value: 1 }]
      })
    ).toThrow(TypeError);
  });

  it("rejects declaration metadata in a direct nonglobal ScopeFrame", () => {
    const scope = new Scope();
    expect(() => scope.hydrateFrame({ ...scope.captureFrame(), globalVarNames: [] })).toThrow(
      TypeError
    );
  });
});

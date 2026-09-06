import { describe, expect, it } from "vitest";
import { Scope } from "./scope.js";

describe("scope frame capture", () => {
  it("keeps lexical parents and shadowed bindings separate", () => {
    const parent = new Scope();
    parent.declare("value", "let", 1);
    const child = parent.child();
    child.declare("value", "const", 2);
    const frame = child.captureFrame();
    expect(frame.parent).toBe(parent);
    expect(frame.bindings).toEqual([["value", 0]]);
    expect(frame.cells).toEqual([{ kind: "const", initialized: true, value: 2 }]);
    expect(parent.captureFrame().cells).toEqual([{ kind: "let", initialized: true, value: 1 }]);
  });

  it("distinguishes uninitialized cells from initialized undefined", () => {
    const scope = new Scope();
    scope.predeclare("pending", "let");
    scope.declare("ready", "let", undefined);
    expect(scope.captureFrame().cells).toEqual([
      { kind: "let", initialized: false },
      { kind: "let", initialized: true, value: undefined }
    ]);
  });

  it("preserves shared binding cells and declaration order without exposing mutable cells", () => {
    const scope = new Scope();
    scope.declare("first", "let", 1);
    scope.declare("second", "const", 2);
    scope.declareAlias("alias", "first");
    const captured = scope.captureFrame();
    expect(captured.bindings).toEqual([["first", 0], ["second", 1], ["alias", 0]]);
    expect(captured.cells).toHaveLength(2);
    scope.assign("alias", 3);
    expect(captured.cells[0]).toEqual({ kind: "let", initialized: true, value: 1 });
    expect(scope.captureFrame().cells[0]).toEqual({ kind: "let", initialized: true, value: 3 });
  });

  it("preserves import metadata, function boundaries, charging and pending restored bindings", () => {
    const importMeta = { url: "safe:test" };
    const root = new Scope({}, undefined, importMeta, { functionBoundary: true, chargeData: false }, { pending: 3 });
    expect(root.captureFrame()).toMatchObject({ importMeta, functionBoundary: true, chargeData: false, restoredBindings: [["pending", 3]] });
    const child = root.child();
    expect(child.captureFrame()).toMatchObject({ parent: root, functionBoundary: false, chargeData: true });
    expect(child.captureFrame().restoredBindings).toBeUndefined();
  });
});

describe("scope frame hydration", () => {
  it("restores aliases, TDZ cells and parent assignment without flattening scopes", () => {
    const parent = new Scope();
    parent.declare("outer", "let", 1);
    const source = parent.child();
    source.declare("value", "let", 2);
    source.declareAlias("alias", "value");
    source.predeclare("pending", "const");
    const restoredParent = new Scope();
    restoredParent.hydrateFrame(parent.captureFrame());
    const restored = restoredParent.child();
    restored.hydrateFrame({ ...source.captureFrame(), parent: restoredParent });
    restored.assign("alias", 3);
    restored.assign("outer", 4);
    expect(restored.lookup("value")).toMatchObject({ found: true, value: 3 });
    expect(restoredParent.lookup("outer")).toMatchObject({ found: true, value: 4 });
    expect(parent.lookup("outer")).toMatchObject({ found: true, value: 1 });
    expect(() => restored.lookup("pending")).toThrow("before initialization");
    restored.declare("pending", "const", undefined);
    expect(restored.lookup("pending")).toMatchObject({ found: true, value: undefined });
  });

  it("hydrates metadata and shared pending restored bindings after child allocation", () => {
    const source = new Scope({}, undefined, { url: "safe:test" }, { functionBoundary: true, chargeData: false }, { saved: 3 });
    const root = new Scope({}, undefined, undefined, { functionBoundary: true, chargeData: false });
    const child = root.child();
    root.hydrateFrame(source.captureFrame());
    child.hydrateFrame({ ...source.child().captureFrame(), parent: root });
    expect(child.lookupImportMeta()).toEqual({ url: "safe:test" });
    expect(child.consumeRestoredBinding("saved")).toEqual({ found: true, value: 3 });
    expect(root.consumeRestoredBinding("saved")).toEqual({ found: false });
    expect(root.captureFrame().chargeData).toBe(false);
  });

  it("rejects invalid cell indexes without partially installing bindings", () => {
    const source = new Scope();
    source.declare("value", "let", 3);
    const frame = source.captureFrame();
    frame.bindings.push(["bad", 99]);
    const target = new Scope();
    expect(() => target.hydrateFrame(frame)).toThrow("Invalid scope binding cell");
    expect(target.lookup("value")).toEqual({ found: false });
  });

  it("does not overwrite existing bindings or hydrate a scope twice", () => {
    const target = new Scope({ existing: 3 });
    expect(() => target.hydrateFrame(new Scope().captureFrame())).toThrow("fresh scope");
    expect(target.lookup("existing")).toMatchObject({ found: true, value: 3 });
    const empty = new Scope();
    empty.hydrateFrame(new Scope().captureFrame());
    expect(() => empty.hydrateFrame(new Scope().captureFrame())).toThrow("fresh scope");
  });
});

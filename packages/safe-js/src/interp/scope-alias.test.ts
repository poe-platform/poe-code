import { describe, expect, it } from "vitest";
import { Scope } from "./scope.js";

describe("live scope aliases", () => {
  it("shares initialization and assignment with the original binding", () => {
    const scope = new Scope();
    scope.predeclare("Named", "let");
    scope.declareAlias("default", "Named");
    expect(() => scope.lookup("default")).toThrow(ReferenceError);
    scope.declare("Named", "let", 7);
    expect(scope.lookup("default")).toMatchObject({ value: 7 });
    scope.assign("Named", 8);
    expect(scope.lookup("default")).toMatchObject({ value: 8 });
    expect(scope.snapshot().bindings).toEqual({ Named: 8, default: 8 });
  });
  it("keeps aliases current when initialized bindings are copied", () => {
    const scope = new Scope();
    scope.declare("Named", "let", 7);
    scope.declareAlias("default", "Named");
    const source = new Scope();
    source.declare("Named", "let", 8);
    scope.copyInitializedBindingsFrom(source, ["Named"]);
    expect(scope.lookup("default")).toMatchObject({ value: 8 });
  });
  it("rejects missing targets and duplicate aliases", () => {
    const scope = new Scope();
    expect(() => scope.declareAlias("default", "missing")).toThrow(ReferenceError);
    scope.declare("Named", "let", 7);
    scope.declareAlias("default", "Named");
    expect(() => scope.declareAlias("default", "Named")).toThrow();
  });
  it("preserves immutable binding rules", () => {
    const scope = new Scope();
    scope.declare("Named", "const", 7);
    scope.declareAlias("default", "Named");
    expect(() => scope.assign("default", 8)).toThrow(TypeError);
    expect(scope.lookup("Named")).toMatchObject({ value: 7 });
  });
});

import { describe, expect, it } from "vitest";

import { Scope } from "./scope.js";

describe("Scope", () => {
  it("treats constructor bindings as const bindings", () => {
    const scope = new Scope({
      agentName: "planner"
    });

    expect(scope.lookup("agentName")).toEqual({
      found: true,
      kind: "const",
      value: "planner"
    });
    expect(() => scope.assign("agentName", "reviewer")).toThrowError(
      "Cannot assign to const binding 'agentName'."
    );
  });

  it("looks up bindings from the current scope and parent chain", () => {
    const parent = new Scope();
    parent.declare("agentName", "const", "planner");

    const child = parent.child();
    child.declare("taskName", "let", "ship");

    expect(child.lookup("agentName")).toEqual({
      found: true,
      kind: "const",
      value: "planner"
    });
    expect(child.lookup("taskName")).toEqual({
      found: true,
      kind: "let",
      value: "ship"
    });
    expect(child.lookup("missing")).toEqual({ found: false });
  });

  it("shadows parent bindings in child scopes", () => {
    const parent = new Scope();
    parent.declare("agentName", "const", "planner");

    const child = parent.child();
    child.declare("agentName", "let", "reviewer");

    expect(child.lookup("agentName")).toEqual({
      found: true,
      kind: "let",
      value: "reviewer"
    });
    expect(parent.lookup("agentName")).toEqual({
      found: true,
      kind: "const",
      value: "planner"
    });
  });

  it("assigns through the scope chain for let bindings", () => {
    const parent = new Scope();
    parent.declare("taskName", "let", "ship");

    const child = parent.child();
    child.assign("taskName", "review");

    expect(parent.lookup("taskName")).toEqual({
      found: true,
      kind: "let",
      value: "review"
    });
  });

  it("assigns the nearest matching let binding when names are shadowed", () => {
    const parent = new Scope();
    parent.declare("taskName", "let", "ship");

    const child = parent.child();
    child.declare("taskName", "let", "review");

    child.assign("taskName", "deploy");

    expect(child.lookup("taskName")).toEqual({
      found: true,
      kind: "let",
      value: "deploy"
    });
    expect(parent.lookup("taskName")).toEqual({
      found: true,
      kind: "let",
      value: "ship"
    });
  });

  it("resolves assignments across multiple ancestor scopes", () => {
    const root = new Scope();
    root.declare("taskName", "let", "ship");

    const child = root.child();
    const grandchild = child.child();

    grandchild.assign("taskName", "review");

    expect(root.lookup("taskName")).toEqual({
      found: true,
      kind: "let",
      value: "review"
    });
  });

  it("rejects assigning to const bindings", () => {
    const scope = new Scope();
    scope.declare("agentName", "const", "planner");

    expect(() => scope.assign("agentName", "reviewer")).toThrowError(
      "Cannot assign to const binding 'agentName'."
    );
  });

  it("rejects assigning when the nearest matching binding is const even if an ancestor is let", () => {
    const parent = new Scope();
    parent.declare("agentName", "let", "planner");

    const child = parent.child();
    child.declare("agentName", "const", "reviewer");

    expect(() => child.assign("agentName", "qa")).toThrowError("Cannot assign to const binding 'agentName'.");
    expect(parent.lookup("agentName")).toEqual({
      found: true,
      kind: "let",
      value: "planner"
    });
  });

  it("rejects assigning to undeclared bindings", () => {
    const scope = new Scope();

    expect(() => scope.assign("missing", 42)).toThrowError("Cannot assign to undeclared binding 'missing'.");
  });

  it("rejects redeclaring a binding in the same scope", () => {
    const scope = new Scope();
    scope.declare("agentName", "const", "planner");

    expect(() => scope.declare("agentName", "let", "reviewer")).toThrowError(
      "Cannot redeclare binding 'agentName' in the same scope."
    );
  });

  it("snapshots inherited and local bindings", () => {
    const parent = new Scope();
    parent.declare("agentName", "const", "planner");

    const child = parent.child();
    child.declare("taskName", "let", "ship");

    expect(child.snapshot()).toEqual({
      bindings: {
        agentName: "planner",
        taskName: "ship"
      }
    });
  });

  it("snapshots prefer shadowing child bindings over inherited bindings", () => {
    const parent = new Scope();
    parent.declare("agentName", "const", "planner");

    const child = parent.child({
      taskName: "ship"
    });
    child.declare("agentName", "let", "reviewer");

    expect(child.snapshot()).toEqual({
      bindings: {
        agentName: "reviewer",
        taskName: "ship"
      }
    });
  });
});

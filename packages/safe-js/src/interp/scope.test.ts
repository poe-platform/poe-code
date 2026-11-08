import { describe, expect, it } from "vitest";

import { parse, type ParseResult, type Statement } from "../parse.js";
import { interpret } from "./interpreter.js";
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

    expect(() => child.assign("agentName", "qa")).toThrowError(
      "Cannot assign to const binding 'agentName'."
    );
    expect(parent.lookup("agentName")).toEqual({
      found: true,
      kind: "let",
      value: "planner"
    });
  });

  it("rejects assigning to undeclared bindings", () => {
    const scope = new Scope();

    expect(() => scope.assign("missing", 42)).toThrowError(
      "Cannot assign to undeclared binding 'missing'."
    );
    expect(() => scope.assign("missing", 42)).toThrow(ReferenceError);
  });

  it("rejects redeclaring a binding in the same scope", () => {
    const scope = new Scope();
    scope.declare("agentName", "const", "planner");

    expect(() => scope.declare("agentName", "let", "reviewer")).toThrowError(
      "Cannot redeclare binding 'agentName' in the same scope."
    );
  });

  it("declares var bindings on the nearest function boundary", () => {
    const root = new Scope({}, undefined, undefined, { functionBoundary: true });
    const block = root.child();

    block.declareVar("count");

    expect(root.lookup("count")).toEqual({ found: true, kind: "var", value: undefined });
    expect(block.hasOwnBinding("count")).toBe(false);
  });

  it("allows var redeclaration but rejects lexical collisions", () => {
    const scope = new Scope({}, undefined, undefined, { functionBoundary: true });

    scope.declareVar("count");
    scope.declareVar("count");
    expect(() => scope.declare("count", "let", 1)).toThrowError(
      "Cannot redeclare binding 'count' in the same scope."
    );
  });

  it("does not copy var bindings into iteration children", () => {
    const scope = new Scope({}, undefined, undefined, { functionBoundary: true });
    const loopScope = scope.child();
    scope.declareVar("index");
    scope.assign("index", 1);

    const iteration = loopScope.iterationChild(["index"]);

    expect(iteration.hasOwnBinding("index")).toBe(false);
    iteration.assign("index", 2);
    expect(scope.lookup("index")).toEqual({ found: true, kind: "var", value: 2 });
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

  it("snapshots deep scope chains with child shadows and omitted uninitialized bindings", () => {
    let scope = new Scope();
    scope.declare("shared", "let", "parent");
    scope.predeclare("pending", "let");

    for (let index = 0; index < 50_000; index += 1) {
      scope = scope.child();
    }

    scope.declare("shared", "let", "child");

    expect(scope.snapshot()).toEqual({
      bindings: {
        shared: "child"
      }
    });
  });

  it("throws a strict ReferenceError when assigning to an undeclared identifier", async () => {
    await expect(interpret(parse("missing = 1"))).rejects.toMatchObject({
      message: "Cannot assign to undeclared binding 'missing'.",
      name: "ReferenceError"
    });
  });

  it("rejects redeclaring const in the same scope at parse time", () => {
    expect(() => parse("if (true) { const x = 1; const x = 2; }")).toThrowError(
      "Cannot redeclare binding 'x'"
    );
  });

  it("rejects redeclaring let in the same scope at parse time", () => {
    expect(() => parse("if (true) { let x = 1; let x = 2; }")).toThrowError(
      "Cannot redeclare binding 'x'"
    );
  });

  it("keeps child let shadows independent from outer let bindings", async () => {
    await expect(
      interpret(
        block(
          parse("let x = 'outer'"),
          parse("if (true) { let x = 'child'; x = 'changed'; }"),
          parse("return x")
        )
      )
    ).resolves.toMatchObject({
      ok: true,
      returnValue: "outer"
    });
  });

  it("throws a ReferenceError for let TDZ reads in the same scope", async () => {
    await expect(interpret(block(parse("x"), parse("let x = 1")))).rejects.toMatchObject({
      message: "Cannot access 'x' before initialization.",
      name: "ReferenceError"
    });
  });

  it("throws a ReferenceError for const TDZ reads in the same scope", async () => {
    await expect(interpret(block(parse("x"), parse("const x = 1")))).rejects.toMatchObject({
      message: "Cannot access 'x' before initialization.",
      name: "ReferenceError"
    });
  });

  it("captures for-loop let bindings by per-iteration reference", async () => {
    await expect(
      interpret(
        block(
          parse("const fns = []"),
          parse("for (let i = 0; i < 3; i = i + 1) { fns.push(() => i); }"),
          parse("return fns[0]() * 10 + fns[1]()")
        )
      )
    ).resolves.toMatchObject({
      ok: true,
      returnValue: 1
    });
  });

  it("resolves a 200-deep scope chain lookup in under 10ms", () => {
    let scope = new Scope();
    scope.declare("target", "let", 42);

    for (let index = 0; index < 200; index += 1) {
      scope = scope.child();
    }

    const start = performance.now();
    const result = scope.lookup("target");
    const elapsed = performance.now() - start;

    expect(result).toEqual({
      found: true,
      kind: "let",
      value: 42
    });
    expect(elapsed).toBeLessThan(10);
  });

  it("does not leak __proto__ bindings to Object.prototype", () => {
    const scope = new Scope();
    scope.declare("__proto__", "let", "local");

    expect(scope.lookup("__proto__")).toEqual({
      found: true,
      kind: "let",
      value: "local"
    });
    expect(Object.prototype).not.toHaveProperty("local");
    expect({}).not.toHaveProperty("local");
    expect(scope.snapshot().bindings.__proto__).toBe("local");
  });

  it("treats constructor as a normal binding name", () => {
    const scope = new Scope();
    scope.declare("constructor", "let", "local");
    scope.assign("constructor", "updated");

    expect(scope.lookup("constructor")).toEqual({
      found: true,
      kind: "let",
      value: "updated"
    });
    expect(scope.snapshot().bindings.constructor).toBe("updated");
  });

  it("scopes catch bindings to the catch block", async () => {
    await expect(
      interpret(block(parse("try { throw 'boom'; } catch (error) {}"), parse("return error")))
    ).resolves.toMatchObject({
      ok: false,
      error: {
        code: "UNBOUND_IDENTIFIER",
        message: "Identifier 'error' is not defined.",
        nodeType: "Identifier"
      }
    });
  });

  it("does not leak lexical bindings from try blocks", async () => {
    await expect(
      interpret(block(parse("try { let hidden = 1; } catch (error) {}"), parse("return hidden")))
    ).resolves.toMatchObject({
      ok: false,
      error: {
        code: "UNBOUND_IDENTIFIER",
        message: "Identifier 'hidden' is not defined.",
        nodeType: "Identifier"
      }
    });
  });
});

function block(...statements: Statement[]): ParseResult {
  return {
    type: "BlockStatement",
    body: statements,
    span: {
      start: statements[0]?.span.start ?? span(1, 1, 0).start,
      end: statements.at(-1)?.span.end ?? span(1, 1, 0).end
    }
  };
}

function span(line: number, column: number, offset: number) {
  return {
    start: {
      line,
      column,
      offset
    },
    end: {
      line,
      column,
      offset
    }
  };
}

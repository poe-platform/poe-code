import { describe, expect, it } from "vitest";
import { parseModule } from "../parse/parser.js";
import { interpret } from "./interpreter.js";
import { getClosureOrigin } from "./closure-origin.js";
import { createSandboxClosure } from "./values.js";

describe("interpreted closure origins", () => {
  it.each([
    "()=>value", "function(){return value}", "async ()=>value",
    "function*(){yield value}", "async function*(){yield value}"
  ])("captures AST and lexical frame for %s", async expression => {
    const result = await interpret(parseModule(`{let value=3;return ${expression};}`).body[0]);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.error.message);
    const origin = getClosureOrigin(result.returnValue as object);
    expect(origin).toBeDefined();
    expect(origin!.node.nodeId).toBeTypeOf("number");
    expect(origin!.scope.lookup("value")).toMatchObject({ found: true, kind: "let", value: 3 });
    expect(origin!.scope.captureFrame().bindings.some(([name]) => name === "value")).toBe(true);
  });

  it("preserves the home object of an interpreted method", async () => {
    const result = await interpret(parseModule("{const object={method(){return 3}};return [object,object.method]}").body[0]);
    if (!result.ok) throw new Error(result.error.message);
    const [object, method] = result.returnValue as object[];
    expect(getClosureOrigin(method)?.environment?.homeObject === object).toBe(true);
  });

  it("does not invent AST origins for host closures", () => {
    expect(getClosureOrigin(createSandboxClosure({ name: "example", call: () => 3 }))).toBeUndefined();
  });

  it("distinguishes shared captures from separate invocations of the same AST", async () => {
    const result = await interpret(parseModule("{function make(){let value=0;return [()=>value,()=>++value]}return [make(),make()]}").body[0]);
    if (!result.ok) throw new Error(result.error.message);
    const [first, second] = result.returnValue as object[][];
    const firstRead = getClosureOrigin(first[0])!;
    const firstWrite = getClosureOrigin(first[1])!;
    const secondRead = getClosureOrigin(second[0])!;
    expect(firstRead.scope === firstWrite.scope).toBe(true);
    expect(firstRead.scope === secondRead.scope).toBe(false);
    expect(firstRead.node.nodeId).toBe(secondRead.node.nodeId);
  });

  it("captures named-function self bindings without flattening their parent", async () => {
    const result = await interpret(parseModule("{let value=3;return function self(){return self}}").body[0]);
    if (!result.ok) throw new Error(result.error.message);
    const closure = result.returnValue as object;
    const scope = getClosureOrigin(closure)!.scope;
    expect(scope.lookup("self")).toMatchObject({ found: true, value: closure });
    expect(scope.captureFrame().bindings).toEqual([["self", 0]]);
    expect(scope.captureFrame().parent?.lookup("value")).toMatchObject({ found: true, value: 3 });
  });

  it("captures the lexical this binding of an arrow", async () => {
    const result = await interpret(parseModule("{const object={make(){return ()=>this}};return [object,object.make()]}").body[0]);
    if (!result.ok) throw new Error(result.error.message);
    const [object, arrow] = result.returnValue as object[];
    expect(getClosureOrigin(arrow)!.scope.lookup("this")).toMatchObject({ found: true, value: object });
  });
});

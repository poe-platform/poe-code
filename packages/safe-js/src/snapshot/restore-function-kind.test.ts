import { describe, expect, it } from "vitest";
import { Budget } from "../interp/budget.js";
import { interpret } from "../interp/interpreter.js";
import { isSandboxClosure, isSandboxPromise } from "../interp/values.js";
import { parse, parseModule, type ParseResult } from "../parse/parser.js";
import { restore } from "./restore.js";
import { serialize } from "./serialize.js";

function fixture(declaration: string, nodeType: ParseResult["type"], bindings = {}) {
  const source = `${declaration}\nawait task();`;
  const module = parseModule(source);
  function nodeId(node: unknown, type: ParseResult["type"]): number | undefined {
    if (node === null || typeof node !== "object") return undefined;
    if ("type" in node && node.type === type && "nodeId" in node) return node.nodeId as number;
    for (const child of Object.values(node)) {
      const found = nodeId(child, type);
      if (found !== undefined) return found;
    }
    return undefined;
  }
  const budget = new Budget({ maxSteps: 10_000, maxCallDepth: 50 });
  const snapshot = serialize({
    source,
    currentAstNodeId: nodeId(module, "AwaitExpression")!,
    scopeChain: [
      {
        id: "module",
        bindings: {
          ...bindings,
          target: { kind: "fn", astNodeId: nodeId(module, nodeType)!, capturedScopeId: "module" }
        }
      }
    ],
    callStack: [],
    pendingPromises: [],
    moduleBindings: {}
  });
  const state = restore(snapshot, { source, budget });
  const binding = state.currentScope.lookup("target");
  if (!binding.found || !isSandboxClosure(binding.value))
    throw new Error("Expected restored function");
  return { budget, state, target: binding.value };
}

describe("restored function execution kind", () => {
  it.each(["", "async "])("coerces restored computed parameter keys: %s", async (prefix) => {
    const { target } = fixture(
      `${prefix}function target({ [{ toString() { return "x"; } }]: value }) { return value; }`,
      "FunctionDeclaration"
    );
    const result = target.call([{ x: 7 }]);
    expect(await (isSandboxPromise(result) ? result.promise : result)).toBe(7);
  });
  it.each([
    ["function target(value) { return value + 1; }", "FunctionDeclaration"],
    ["const target = value => value + 1;", "ArrowFunctionExpression"],
    ["const target = function named(value) { return value + 1; };", "FunctionExpression"]
  ] as const)("keeps synchronous results synchronous: %s", async (source, kind) => {
    const { target, state, budget } = fixture(source, kind);
    expect(target.async).toBeUndefined();
    expect(
      await interpret(parse("return target(6) + 1;"), { scope: state.currentScope, budget })
    ).toMatchObject({ ok: true, returnValue: 8 });
  });

  it("preserves the identity of returned guest objects", async () => {
    const { target, state, budget } = fixture(
      "function target() { return marker; }",
      "FunctionDeclaration",
      { marker: { value: 7 } }
    );
    expect(target.async).toBeUndefined();
    expect(
      await interpret(parse("return target() === marker;"), { scope: state.currentScope, budget })
    ).toMatchObject({ ok: true, returnValue: true });
  });

  it("preserves thrown guest values and catch timing", async () => {
    const { target, state, budget } = fixture(
      "function target() { throw marker; }",
      "FunctionDeclaration",
      { marker: { value: 7 } }
    );
    expect(target.async).toBeUndefined();
    expect(
      await interpret(
        parse("try { target(); return false; } catch (error) { return error === marker; }"),
        { scope: state.currentScope, budget }
      )
    ).toMatchObject({ ok: true, returnValue: true });
  });

  it("supports named recursion with the active caller compilation owner", async () => {
    const { target, state, budget } = fixture(
      "const target = function factorial(value) { return value < 2 ? 1 : value * factorial(value - 1); };",
      "FunctionExpression"
    );
    expect(target.async).toBeUndefined();
    expect(
      await interpret(parse("return target(5);"), { scope: state.currentScope, budget })
    ).toMatchObject({ ok: true, returnValue: 120 });
  });

  it("preserves constructor calls inside a running interpreter", async () => {
    const { target, state, budget } = fixture(
      "function target(value) { this.value = value; }",
      "FunctionDeclaration"
    );
    expect(target.async).toBeUndefined();
    expect(
      await interpret(parse("return new target(7).value;"), { scope: state.currentScope, budget })
    ).toMatchObject({ ok: true, returnValue: 7 });
  });

  it("keeps genuine async functions promise-valued", async () => {
    const { target } = fixture(
      "async function target(value) { await 0; return value + 1; }",
      "FunctionDeclaration"
    );
    expect(target.async).toBe(true);
    const result = target.call([6]);
    expect(isSandboxPromise(result)).toBe(true);
    if (!isSandboxPromise(result)) throw new Error("Expected async function promise");
    expect(await result.promise).toBe(7);
  });

  it("runs an async function prefix before resuming its caller", async () => {
    const { state, budget } = fixture(
      'async function target() { events.push(1); events.push(2); events.push(3); events.push(4); await 0; events.push("after"); return 7; }',
      "FunctionDeclaration",
      { events: [] }
    );
    const caller = parseModule(
      'const promise = target(); events.push("caller"); const value = await promise; return [value, events];'
    );
    expect(
      await interpret(
        { type: "BlockStatement", body: caller.body, span: caller.span },
        { scope: state.currentScope, budget }
      )
    ).toMatchObject({ ok: true, returnValue: [7, [1, 2, 3, 4, "caller", "after"]] });
  });

  it.each([
    [
      "async function target() { return { then(resolve) { resolve(7); } }; }",
      "FunctionDeclaration"
    ],
    ["const target = async () => ({ then(resolve) { resolve(7); } });", "ArrowFunctionExpression"],
    [
      "const target = async function named() { return { then(resolve) { resolve(7); } }; };",
      "FunctionExpression"
    ]
  ] as const)(
    "adopts a thenable into the restored async promise itself: %s",
    async (source, kind) => {
      const { target } = fixture(source, kind);
      const result = target.call([]);
      expect(isSandboxPromise(result)).toBe(true);
      if (!isSandboxPromise(result)) throw new Error("Expected async function promise");
      await expect(result.promise).resolves.toBe(7);
    }
  );

  it.each(["return marker;", "throw marker;"])(
    "finishes the synchronous prefix when an async function completes without await: %s",
    async (completion) => {
      const { state, budget } = fixture(
        `async function target() { events.push(1); events.push(2); events.push(3); events.push(4); ${completion} }`,
        "FunctionDeclaration",
        { events: [], marker: { value: 7 } }
      );
      const caller = parseModule(
        'const promise = target(); events.push("caller"); let value; try { value = await promise; } catch (error) { value = error; } return [value === marker, events];'
      );
      expect(
        await interpret(
          { type: "BlockStatement", body: caller.body, span: caller.span },
          { scope: state.currentScope, budget }
        )
      ).toMatchObject({ ok: true, returnValue: [true, [1, 2, 3, 4, "caller"]] });
    }
  );

  it("adopts an async return thenable without adopting a synchronous return", async () => {
    const asyncFixture = fixture(
      "async function target() { return { then(resolve) { resolve(7); } }; }",
      "FunctionDeclaration"
    );
    expect(
      await interpret(parse("return await target();"), {
        scope: asyncFixture.state.currentScope,
        budget: asyncFixture.budget
      })
    ).toMatchObject({ ok: true, returnValue: 7 });
    const syncFixture = fixture(
      "function target() { return { value: 3, then(resolve) { resolve(7); } }; }",
      "FunctionDeclaration"
    );
    expect(
      await interpret(parse("return target().value;"), {
        scope: syncFixture.state.currentScope,
        budget: syncFixture.budget
      })
    ).toMatchObject({ ok: true, returnValue: 3 });
  });

  it("does not turn fatal recursion limits into catchable guest exceptions", async () => {
    const { target, state, budget } = fixture(
      "function target() { return target(); }",
      "FunctionDeclaration"
    );
    expect(target.async).toBeUndefined();
    await expect(
      interpret(parse('try { target(); } catch (error) { return "caught"; }'), {
        scope: state.currentScope,
        budget
      })
    ).rejects.toMatchObject({ code: "budgetExceeded", budget: "callDepth" });
    expect(budget.currentCallDepth).toBe(0);
  });
});

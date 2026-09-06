import { runInNewContext } from "node:vm";
import { expect, it } from "vitest";
import { interpret } from "../interp/interpreter.js";
import { isSandboxPromise } from "../interp/values.js";
import { parseModule } from "../parse/parser.js";
import { restore } from "./restore.js";
import { serialize, type RuntimeSnapshotValue } from "./serialize.js";

const bodies = [
  "const value={a:count++,b:yield 1};yield [count,value]",
  "const value={[count++]:yield 1};yield [count,value]",
  "const value={a:count++,[yield 1]:count++};yield [count,value]",
  "const value={...{a:count++},b:yield 1};yield [count,value]",
  "const value={get a(){return count},b:count++,c:yield 1};yield [count,value.a,value.b,value.c]",
  "const value={__proto__:{a:count++},b:yield 1};yield [count,value.a,value.b]",
  "const value={a:count++,b:yield 1,c:yield 2,d:count++};return [count,value]"
];

it.each(["const value={a:yield 1};return value", "const value={[yield 1]:2};return value"])(
  "rejects a forged computed-key phase: %s", async body => {
    const source = `{function* values(){${body}}const iterator=values();iterator.next();return iterator}`;
    const ast = parseModule(source);
    const original = await interpret(ast.body[0]);
    if (!original.ok) throw new Error(original.error.message);
    const snapshot = serialize({ source, currentAstNodeId: ast.body[0].nodeId!,
      scopeChain: [{ id: "external", bindings: { iterator: original.returnValue as RuntimeSnapshotValue } }],
      callStack: [], pendingPromises: [], moduleBindings: {} });
    const generator = Object.values(snapshot.heap!).find(node => node.kind === "guest-generator")!;
    const expression = Object.values(generator.expressionStates!).find(state => state.kind === "object")!;
    if (Object.hasOwn(expression, "key")) delete expression.key;
    else expression.key = "forged";
    expect(() => restore(JSON.parse(JSON.stringify(snapshot)), { source })).toThrow("Invalid generator AST identity");
  }
);

it.each(bodies.flatMap(body => [false, true].map(async => ({ body, async }))))(
  "preserves partial object literals: $body (async=$async)", async ({ body, async }) => {
    const definition = `${async ? "async " : ""}function* values(){${body}}`;
    const source = `{let count=0;${definition}const iterator=values();await iterator.next();return iterator}`;
    const ast = parseModule(source);
    const original = await interpret(ast.body[0]);
    if (!original.ok) throw new Error(original.error.message);
    let iterator = original.returnValue as RuntimeSnapshotValue;
    const native = await runInNewContext(`(async()=>{let count=0;${definition}const iterator=values();await iterator.next();return iterator})()`);
    for (const sent of [4, 5, 6, 7]) {
      const snapshot = serialize({ source, currentAstNodeId: ast.body[0].nodeId!,
        scopeChain: [{ id: "external", bindings: { iterator } }],
        callStack: [], pendingPromises: [], moduleBindings: {} });
      const restored = restore(JSON.parse(JSON.stringify(snapshot)), { source });
      const binding = restored.currentScope.lookup("iterator");
      if (!binding.found) throw new Error("Missing restored iterator");
      iterator = binding.value as RuntimeSnapshotValue;
      const next = await interpret(parseModule(`{return iterator.next(${sent})}`).body[0], {
        budget: restored.budget, bindings: { iterator: binding.value }
      });
      if (!next.ok) throw new Error(next.error.message);
      const actual = isSandboxPromise(next.returnValue) ? await next.returnValue.promise : next.returnValue;
      expect(actual).toEqual(await native.next(sent));
    }
  }
);

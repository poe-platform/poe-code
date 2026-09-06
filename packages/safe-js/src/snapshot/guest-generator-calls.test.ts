import { runInNewContext } from "node:vm";
import { expect, it } from "vitest";
import { interpret } from "../interp/interpreter.js";
import { Budget } from "../interp/budget.js";
import { createBuiltinBindings } from "../interp/globals.js";
import { isSandboxPromise } from "../interp/values.js";
import { parseModule } from "../parse/parser.js";
import { restore } from "./restore.js";
import { serialize, type RuntimeSnapshotValue } from "./serialize.js";

const bodies = [
  "const sent=((a,b)=>[a,b])(count++,yield 1);yield [count,sent]",
  "function f(a,b){return [a,b]}const sent=f(count++,yield 1);yield [count,sent]",
  "function f(a,b,c){return [a,b,c]}const sent=f(...[count++,7],yield 1);yield [count,sent]",
  "function f(a,b,c){return [a,b,c]}const sent=f(count++,yield 1,yield 2);yield [count,sent]",
  "const object={get f(){count++;return function(a,b){return [this===object,a,b]}}};const sent=object.f(count++,yield 1);yield [count,sent]",
  "function F(a,b){this.values=[a,b]}const sent=new F(count++,yield 1);yield [count,sent.values]",
  "const sent=Math.max(count++,yield 1);yield [count,sent]",
  "const sent='abcd'.slice(count++,yield 1);yield [count,sent]",
  "const array=[];array.push(count++,yield 1);yield [count,array]"
];

it.each(bodies.flatMap(body => [false, true].map(async => ({ body, async }))))(
  "preserves resolved calls across repeated restores: $body (async=$async)", async ({ body, async }) => {
  const definition = `${async ? "async " : ""}function* values(){${body}}`;
  const source = `{let count=0;${definition}const iterator=values();await iterator.next();return iterator}`;
  const ast = parseModule(source);
  const budget = new Budget();
  const original = await interpret(ast.body[0], { budget, bindings: { Math: createBuiltinBindings({ budget }).Math } });
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
});

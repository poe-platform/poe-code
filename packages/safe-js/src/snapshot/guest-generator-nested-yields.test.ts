import { expect, it } from "vitest";
import { runInNewContext } from "node:vm";
import { interpret } from "../interp/interpreter.js";
import { Budget } from "../interp/budget.js";
import { createBuiltinBindings } from "../interp/globals.js";
import { isSandboxPromise } from "../interp/values.js";
import { parseModule } from "../parse/parser.js";
import { restore } from "./restore.js";
import { serialize } from "./serialize.js";

const bodies = [
  ...["**", "*", "/", "%", "-", "<<", ">>", ">>>", "&", "|", "^"].flatMap(operator =>
    [operator, `${operator}=`].map(operation =>
      `const trace=[];let left={valueOf(){trace.push('left');return Symbol()}};
       try{left ${operation} (yield 1,{valueOf(){trace.push('right');throw new Error('wrong error')}})}
       catch(error){return [error.name,trace]}`)),
  "return (yield) ? yield : yield",
  "return false ? yield : yield",
  "return true ? (false ? yield : yield) : yield",
  "yield (yield 1);return 9",
  "yield* (yield 1,[2,3]);return 9",
  "yield (yield (yield 1));return 9",
  "yield* (yield 1,yield 2,[3,4]);return 9",
  "yield* [(yield 1),2];return 9",
  "let count=0;function input(){count++;return 2}yield (input()+(yield 1));return count",
  "let count=0;function input(){count++;return [2,3]}yield* (yield 1,input());return count",
  "try{yield (yield 1)}finally{yield 2}return 9"
];

it.each([...bodies.map(body => ({ body, operation: "next" })),
  ...["throw", "return"].map(operation => ({ operation,
    body: "let count=0;function input(){count++;return [2,3]}try{yield* (yield 1,input())}catch(error){yield error}finally{yield count}return 9"
  }))].flatMap(entry => [false, true].map(async => ({ ...entry, async }))))(
  "resumes suspension inside yield arguments: $body (async=$async, operation=$operation)", async ({ body, async, operation }) => {
    const source = `{${async ? "async " : ""}function* values(){${body}}const iterator=values();await iterator.next();return iterator}`;
    const ast = parseModule(source);
    const budget = new Budget();
    const globals = createBuiltinBindings({ budget });
    const original = await interpret(ast.body[0], { budget, bindings: { Symbol: globals.Symbol, Error: globals.Error } });
    if (!original.ok) throw new Error(original.error.message);
    const native = await runInNewContext(`(async()=>${source})()`);
    let iterator = original.returnValue;
    for (const sent of [4, 5, 6, 7]) {
      const wire = serialize({ source, currentAstNodeId: ast.body[0].nodeId!,
        scopeChain: [{ id: "external", bindings: { iterator } }],
        callStack: [], pendingPromises: [], moduleBindings: {} });
      const restored = restore(JSON.parse(JSON.stringify(wire)), { source });
      const binding = restored.currentScope.lookup("iterator");
      if (!binding.found) throw new Error("Missing iterator");
      iterator = binding.value;
      const method = sent === 4 ? operation : "next";
      const next = await interpret(parseModule(`{return iterator.${method}(${sent})}`).body[0], {
        budget: restored.budget, bindings: { iterator }
      });
      if (!next.ok) throw new Error(next.error.message);
      const actual = isSandboxPromise(next.returnValue) ? await next.returnValue.promise : next.returnValue;
      expect(actual).toEqual(await native[method](sent));
    }
  }
);

import { expect, it } from "vitest";
import { runInNewContext } from "node:vm";
import { interpret } from "../interp/interpreter.js";
import { isSandboxPromise } from "../interp/values.js";
import { parseModule } from "../parse/parser.js";
import { restore } from "./restore.js";
import { serialize } from "./serialize.js";

const bodies = [
  "let count=0;do{count++}while(yield 1);return count",
  "let count=0;do{count++;continue}while(yield 1);return count",
  "let count=0;do{yield count;count++}while(yield 1);return count",
  "let count=0;do{count++}while((count++,yield 1));return count",
  "let count=0;do{try{count++;continue}finally{count++}}while(yield 1);return count",
  "let count=0;do{do{count++}while(yield 1);count++}while(yield 2);return count"
];

it.each(bodies.flatMap(body => [false, true].flatMap(async =>
  ["next", "throw", "return"].map(operation => ({ body, async, operation }))))) (
  "restores do-while progress: $body (async=$async, operation=$operation)",
  async ({ body, async, operation }) => {
    const source = `{${async ? "async " : ""}function* values(){try{${body}}catch(error){return error}finally{yield 99}}const iterator=values();await iterator.next();return iterator}`;
    const ast = parseModule(source);
    const original = await interpret(ast.body[0]);
    if (!original.ok) throw new Error(original.error.message);
    const native = await runInNewContext(`(async()=>${source})()`);
    let iterator = original.returnValue;
    for (const [index, sent] of [1, 0, 0, 0, 0, 0, 0, 0].entries()) {
      const wire = serialize({ source, currentAstNodeId: ast.body[0].nodeId!,
        scopeChain: [{ id: "external", bindings: { iterator } }],
        callStack: [], pendingPromises: [], moduleBindings: {} });
      const restored = restore(JSON.parse(JSON.stringify(wire)), { source });
      const binding = restored.currentScope.lookup("iterator");
      if (!binding.found) throw new Error("Missing iterator");
      iterator = binding.value;
      const method = index === 0 ? operation : "next";
      const next = await interpret(parseModule(`{return iterator.${method}(${sent})}`).body[0], {
        budget: restored.budget, bindings: { iterator }
      });
      if (!next.ok) throw new Error(next.error.message);
      const actual = isSandboxPromise(next.returnValue) ? await next.returnValue.promise : next.returnValue;
      expect(actual).toEqual(await native[method](sent));
    }
  }
);

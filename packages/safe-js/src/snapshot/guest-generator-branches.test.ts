import { runInNewContext } from "node:vm";
import { expect, it } from "vitest";
import { interpret } from "../interp/interpreter.js";
import { isSandboxPromise } from "../interp/values.js";
import { parseModule } from "../parse/parser.js";
import { restore } from "./restore.js";
import { serialize, type RuntimeSnapshotValue } from "./serialize.js";

const bodies = [
  "exit:if(++count===1){yield 1;break exit}return count",
  "exit:try{yield 1;break exit}finally{yield ++count}return count",
  "if(++count===1){yield 1;return count}return 9",
  "if(++count!==1){return 9}else{yield 1;return count}",
  "if(++count===1){if(++count===2){yield 1;return count}}return 9",
  "if(++count===9){return 9}else if(++count===2){yield 1;return count}return 8",
  "if(++count===1){yield 1;count++;yield 2;return count}return 9",
  "if(yield 1){count++;yield 2;return count}else{return 9}",
  "if(++count===1)yield 1;else yield 2;return count",
  "try{if(++count===1){yield 1;yield 2}}catch(error){return [error,count]}finally{yield count}return count",
  "const sent=(count++===0)?(yield 1):(yield 2);yield [count,sent]",
  "const sent=(count++===1)?(yield 2):(yield 1);yield [count,sent]",
  "const sent=(++count)&&(yield 1);yield [count,sent]",
  "const sent=(count++)||(yield 1);yield [count,sent]",
  "const sent=(count++,null)??(yield 1);yield [count,sent]",
  "const sent=(++count===1)?((++count===2)?(yield 1):(yield 2)):(yield 3);yield [count,sent]",
  "const sent=(yield 1)?++count:--count;yield [count,sent]",
  "const sent=(yield 1)&&++count;yield [count,sent]"
];

it.each([...bodies.map(body => ({ body, operation: "next" })),
  ...["throw", "return"].map(operation => ({ operation,
    body: "try{if(++count===1){yield 1;yield 2}}catch(error){return [error,count]}finally{yield count}return count"
  }))].flatMap(entry => [false, true].map(async => ({ ...entry, async }))))(
  "restores branch selection without replaying conditions: $body (async=$async, operation=$operation)",
  async ({ body, async, operation }) => {
    const definition = `${async ? "async " : ""}function* values(){${body}}`;
    const source = `{let count=0;${definition}const iterator=values();await iterator.next();return iterator}`;
    const ast = parseModule(source);
    const original = await interpret(ast.body[0]);
    if (!original.ok) throw new Error(original.error.message);
    let iterator = original.returnValue as RuntimeSnapshotValue;
    const native = await runInNewContext(`(async()=>{let count=0;${definition}const iterator=values();await iterator.next();return iterator})()`);
    for (const [index, sent] of [4, 5, 6, 7, 8].entries()) {
      const snapshot = serialize({ source, currentAstNodeId: ast.body[0].nodeId!,
        scopeChain: [{ id: "external", bindings: { iterator } }],
        callStack: [], pendingPromises: [], moduleBindings: {} });
      const restored = restore(JSON.parse(JSON.stringify(snapshot)), { source });
      const binding = restored.currentScope.lookup("iterator");
      if (!binding.found) throw new Error("Missing restored iterator");
      iterator = binding.value as RuntimeSnapshotValue;
      const method = index === 0 ? operation : "next";
      const next = await interpret(parseModule(`{return iterator.${method}(${sent})}`).body[0], {
        budget: restored.budget, bindings: { iterator: binding.value }
      });
      if (!next.ok) throw new Error(next.error.message);
      const actual = isSandboxPromise(next.returnValue) ? await next.returnValue.promise : next.returnValue;
      expect(actual).toEqual(await native[method](sent));
    }
  }
);

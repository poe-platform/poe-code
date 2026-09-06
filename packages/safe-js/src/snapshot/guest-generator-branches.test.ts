import { runInNewContext } from "node:vm";
import { expect, it } from "vitest";
import { interpret } from "../interp/interpreter.js";
import { isSandboxPromise } from "../interp/values.js";
import { parseModule } from "../parse/parser.js";
import { restore } from "./restore.js";
import { serialize, type RuntimeSnapshotValue } from "./serialize.js";

const bodies = [
  "const sent=(count++===0)?(yield 1):(yield 2);yield [count,sent]",
  "const sent=(count++===1)?(yield 2):(yield 1);yield [count,sent]",
  "const sent=(++count)&&(yield 1);yield [count,sent]",
  "const sent=(count++)||(yield 1);yield [count,sent]",
  "const sent=(count++,null)??(yield 1);yield [count,sent]",
  "const sent=(++count===1)?((++count===2)?(yield 1):(yield 2)):(yield 3);yield [count,sent]",
  "const sent=(yield 1)?++count:--count;yield [count,sent]",
  "const sent=(yield 1)&&++count;yield [count,sent]"
];

it.each(bodies.flatMap(body => [false, true].map(async => ({ body, async }))))(
  "restores branch selection without replaying conditions: $body (async=$async)",
  async ({ body, async }) => {
    const definition = `${async ? "async " : ""}function* values(){${body}}`;
    const source = `{let count=0;${definition}const iterator=values();await iterator.next();return iterator}`;
    const ast = parseModule(source);
    const original = await interpret(ast.body[0]);
    if (!original.ok) throw new Error(original.error.message);
    let iterator = original.returnValue as RuntimeSnapshotValue;
    const native = await runInNewContext(`(async()=>{let count=0;${definition}const iterator=values();await iterator.next();return iterator})()`);
    for (const sent of [4, 5, 6]) {
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

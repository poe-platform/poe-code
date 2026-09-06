import { expect, it } from "vitest";
import { runInNewContext } from "node:vm";
import { interpret } from "../interp/interpreter.js";
import { isSandboxPromise } from "../interp/values.js";
import { parseModule } from "../parse/parser.js";
import { restore } from "./restore.js";
import { serialize } from "./serialize.js";
import { run } from "../run.js";
import { dump } from "../dump.js";
import { restore as restoreDump } from "../restore.js";

const bodies = [
  "let count=0;switch(++count){case 1:yield 1;return count;default:return 9}",
  "let count=0;switch(2){case ++count:yield 1;break;case ++count:yield 2;break}return count",
  "switch(1){case 1:let value=7;yield 1;return value}",
  "let count=0;switch(2){case (count++,yield 1):return count;default:return count+9}",
  "let count=0;switch(1){case 1:count++;yield 1;case 2:count++;yield 2;default:return count}",
  "switch(yield 1){case 2:yield 3;return 4;default:return 5}",
  "let count=0;switch(7){default:count++;yield 1;case (count++,yield 2):count++;yield 3}return count",
  "let count=0;switch(2){case (count++,yield 1):yield 2;break;case (count++,yield 2):yield 3}return count",
  "switch(1){case 1:const value=yield 1,other=yield 2;return [value,other]}",
  "let count=0;switch(1){case 1:switch(++count){case 1:yield 1;count++}yield 2;return count}",
  "let count=0;try{switch(++count){case 1:yield 1;count++;yield 2}}catch(error){return [error,count]}finally{yield count}return count"
];

it.each([...bodies.map(body => ({ body, operation: "next" })),
  ...["throw", "return"].map(operation => ({ body: bodies[bodies.length - 1]!, operation }))]
  .flatMap(entry => [false, true].map(async => ({ ...entry, async }))))(
  "restores switch selection and progress: $body (async=$async, operation=$operation)", async ({ body, async, operation }) => {
    const source = `{${async ? "async " : ""}function* values(){${body}}const iterator=values();await iterator.next();return iterator}`;
    const ast = parseModule(source);
    const original = await interpret(ast.body[0]);
    if (!original.ok) throw new Error(original.error.message);
    const native = await runInNewContext(`(async()=>${source})()`);
    let iterator = original.returnValue;
    for (const [index, sent] of [2, 0, 0, 0, 0].entries()) {
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

it.each(["valid", "index", "statement", "phase", "scope", "missing", "extra"])(
  "validates switch snapshot state: %s", async corruption => {
    const source = "function* values(){switch(1){case 1:let value=7;yield 1;return value}}const iterator=values();iterator.next();return 9";
    const pending = run(source);
    await pending;
    const wire = JSON.parse(await dump(pending));
    const generator = wire.heap[wire.bindings.iterator.id];
    const [id, expression] = Object.entries(generator.expressionStates as Record<string, Record<string, unknown>>)
      .find(([, entry]) => entry.kind === "switch")!;
    if (corruption === "index") expression.index = 999;
    if (corruption === "statement") expression.statementIndex = 0;
    if (corruption === "phase") expression.phase = "test";
    if (corruption === "scope") expression.scope = 7;
    if (corruption === "missing") delete generator.expressionStates[id];
    if (corruption === "extra") expression.extra = true;
    if (corruption === "valid") expect(() => restoreDump(wire, { source })).not.toThrow();
    else expect(() => restoreDump(wire, { source })).toThrow();
  }
);

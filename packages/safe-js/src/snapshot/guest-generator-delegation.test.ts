import { expect, it } from "vitest";
import { runInNewContext } from "node:vm";
import { interpret } from "../interp/interpreter.js";
import { isSandboxPromise } from "../interp/values.js";
import { parseModule } from "../parse/parser.js";
import { restore } from "./restore.js";
import { serialize } from "./serialize.js";
import { Budget } from "../interp/budget.js";
import { createBuiltinBindings } from "../interp/globals.js";
import { run } from "../run.js";
import { dump } from "../dump.js";
import { restore as restoreDump } from "../restore.js";

const bodies = [
  "let count=0;function input(){count++;return [2,3]}yield* input();return count",
  "let count=0;function* input(){count++;yield 2;yield 3;return 9}const result=yield* input();return [count,result]",
  "let count=0;function input(){count++;return 'ab'}yield* input();return count",
  "const events=[];const source={[Symbol.iterator](){events.push('iterator');let index=0;return {get next(){events.push('next getter');return function(value){events.push(['next',value]);return {value:++index,done:index>2}}}}}};const result=yield* source;return [events,result]"
];

const operationBody = "const events=[];const source={[Symbol.iterator](){events.push('iterator');let index=0;return {next(value){events.push(['next',value]);return {value:++index,done:index>2}},get return(){events.push('return getter');return function(value){events.push(['return',value]);return {value,done:false}}},get throw(){events.push('throw getter');return function(value){events.push(['throw',value]);return {value,done:false}}}}}};const result=yield* source;return [events,result]";

it.each([...([...bodies.map(body => ({ body, operation: "next" })),
  ...["return", "throw"].map(operation => ({ body: operationBody, operation }))]
  .flatMap(entry => [false, true].map(async => ({ ...entry, async })))),
  { body: "let count=0;async function* input(){count++;yield 2;yield 3;return 9}const result=yield* input();return [count,result]", operation: "next", async: true },
  { body: "const events=[];const source={[Symbol.asyncIterator](){events.push('iterator');let index=0;return {async next(value){events.push(['next',value]);return {value:++index,done:index>2}}}}};const result=yield* source;return [events,result]", operation: "next", async: true }
])(
  "preserves delegated iteration: $body (async=$async, operation=$operation)", async ({ body, async, operation }) => {
    const source = `{${async ? "async " : ""}function* values(){${body}}const iterator=values();await iterator.next();return iterator}`;
    const ast = parseModule(source);
    const budget = new Budget();
    const original = await interpret(ast.body[0], { budget, bindings: { Symbol: createBuiltinBindings({ budget }).Symbol } });
    if (!original.ok) throw new Error(original.error.message);
    const native = await runInNewContext(`(async()=>${source})()`);
    let iterator = original.returnValue;
    for (const sent of [4, 5, 6, 7, 8]) {
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

it.each(["valid", "missing", "async", "cursor", "next", "extra"])(
  "validates delegated iterator snapshot state: %s", async corruption => {
    const source = "function* values(){yield* [2,3]}const iterator=values();iterator.next();return 9";
    const pending = run(source);
    await pending;
    const wire = JSON.parse(await dump(pending));
    const generator = wire.heap[wire.bindings.iterator.id];
    const [id, expression] = Object.entries(generator.expressionStates as Record<string, {
      kind: string; async: boolean; iterator: { kind: string; index?: number }; extra?: boolean
    }>).find(([, entry]) => entry.kind === "yield-delegate")!;
    if (corruption === "missing") delete generator.expressionStates[id];
    if (corruption === "async") expression.async = true;
    if (corruption === "cursor") expression.iterator.index = -1;
    if (corruption === "next") Object.assign(expression, { iterator: { kind: "guest", value: wire.bindings.iterator, next: 3, async: false } });
    if (corruption === "extra") expression.extra = true;
    if (corruption === "valid") expect(() => restoreDump(wire, { source })).not.toThrow();
    else expect(() => restoreDump(wire, { source })).toThrow();
  }
);

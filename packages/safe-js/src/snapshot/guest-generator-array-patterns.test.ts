import { expect, it } from "vitest";
import { runInNewContext } from "node:vm";
import { interpret } from "../interp/interpreter.js";
import { isSandboxPromise } from "../interp/values.js";
import { Budget } from "../interp/budget.js";
import { createBuiltinBindings } from "../interp/globals.js";
import { parseModule } from "../parse/parser.js";
import { restore } from "./restore.js";
import { serialize } from "./serialize.js";
import { run } from "../run.js";
import { dump } from "../dump.js";
import { restore as restoreDump } from "../restore.js";

const bodies = [
  "const [first,second=yield 1]=[2];return [first,second]",
  "let count=0;const target={};function key(){count++;return 'x'}let second;[target[key()],second=yield 1]=[2];return [count,target.x,second]",
  "for(const [first,second=yield 1] of ['a','b'])yield [first,second];return 9",
  "const [first=yield 1,second=yield 2]=[];return [first,second]",
  "let count=0;const [first=(count++,2),second=yield 1]=[];return [count,first,second]",
  "const [,[first,second=yield 1]]=[0,[2]];return [first,second]",
  "const target={};let count=0;function key(){count++;return 'x'}[target[key()]=yield 1]=[];return [count,target.x]",
  "const target={};[target[yield 1]]=[9];return target",
  "const target={};[...target[yield 1]]=[2,3];return target",
  "const [first=yield 1,...rest]=[undefined,2,3];return [first,rest]",
  "const events=[];const source={[Symbol.iterator](){events.push('iterator');return {get next(){events.push('next getter');return function(){events.push('next');return {value:undefined,done:false}}},return(){events.push('return');return {done:true}}}}};const [first=yield 1,second=yield 2]=source;return [events,first,second]"
];

it.each(bodies.flatMap(body => [false, true].map(async => ({ body, async }))))(
  "preserves partial array binding: $body (async=$async)", async ({ body, async }) => {
  const source = `{${async ? "async " : ""}function* values(){${body}}const iterator=values();await iterator.next();return iterator}`;
  const ast = parseModule(source);
  const budget = new Budget();
  const original = await interpret(ast.body[0], { budget, bindings: { Symbol: createBuiltinBindings({ budget }).Symbol } });
  if (!original.ok) throw new Error(original.error.message);
  let iterator = original.returnValue;
  const native = await runInNewContext(`(async()=>${source})()`);
  for (const sent of [4, 5, 6, 7]) {
    const wire = serialize({ source, currentAstNodeId: ast.body[0].nodeId!,
      scopeChain: [{ id: "external", bindings: { iterator } }],
      callStack: [], pendingPromises: [], moduleBindings: {} });
    const restored = restore(JSON.parse(JSON.stringify(wire)), { source });
    const binding = restored.currentScope.lookup("iterator");
    if (!binding.found) throw new Error("Missing iterator");
    iterator = binding.value;
    const next = await interpret(parseModule(`{return iterator.next(${sent})}`).body[0], {
      budget: restored.budget, bindings: { iterator }
    });
    if (!next.ok) throw new Error(next.error.message);
    const actual = isSandboxPromise(next.returnValue) ? await next.returnValue.promise : next.returnValue;
    expect(actual).toEqual(await native.next(sent));
  }
});

it.each(["valid", "index", "phase", "done", "reference", "async", "next"])(
  "validates array-pattern snapshot state: %s", async corruption => {
    const source = "function* values(){const [first,second=yield 1]=[2];return [first,second]}const iterator=values();iterator.next();return 9";
    const pending = run(source);
    await pending;
    const wire = JSON.parse(await dump(pending));
    const generator = wire.heap[wire.bindings.iterator.id];
    const expression = Object.values(generator.expressionStates as Record<string, {
      kind: string; index: number; phase: string; done: unknown; referenceObject?: unknown; iterator: unknown
    }>).find(entry => entry.kind === "array-pattern")!;
    if (corruption === "index") expression.index = 0;
    if (corruption === "phase") expression.phase = "body";
    if (corruption === "done") expression.done = 0;
    if (corruption === "reference") expression.referenceObject = wire.bindings.iterator;
    if (corruption === "async") expression.iterator = { kind: "async-from-sync", inner: expression.iterator };
    if (corruption === "next") expression.iterator = { kind: "guest", value: wire.bindings.iterator, next: 3, async: false };
    if (corruption === "valid") expect(() => restoreDump(wire, { source })).not.toThrow();
    else expect(() => restoreDump(wire, { source })).toThrow();
  }
);

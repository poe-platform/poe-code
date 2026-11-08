import { expect, it } from "vitest";
import { runInNewContext } from "node:vm";
import { interpret } from "../interp/interpreter.js";
import { parseModule } from "../parse/parser.js";
import { restore } from "./restore.js";
import { serialize } from "./serialize.js";
import { isSandboxPromise } from "../interp/values.js";
import { run } from "../run.js";
import { dump } from "../dump.js";
import { restore as restoreDump } from "../restore.js";

const bodies = [
  "for(count++;count<3;count++){yield count;return count}",
  "for(let index=0;index<3;index++){yield index;return index}",
  "for(;count++<3;){yield count;return count}",
  "for(let index=0;index<3;index++){yield index}return 9",
  "for(count=yield 1;count<6;count++){yield count}return count",
  "for(;yield count;count++){if(count>2)return count}return count",
  "for(;count<3;count+=yield 1){count++}return count",
  "const callbacks=[];for(let index=0;index<3;index++){callbacks.push(()=>index);yield index}return callbacks.map(fn=>fn())",
  "for(let outer=0;outer<2;outer++){for(let inner=0;inner<2;inner++){yield [outer,inner]}}return 9",
  "for(let index=0;index<3;index++){try{continue}finally{yield index}}return 9",
  "for(let index=0;index<3;index++)yield index;return 9"
];
it.each(bodies.flatMap(body => [false, true].map(async => ({ body, async })) ))(
  "preserves for-loop progress: $body (async=$async)", async ({ body, async }) => {
  const source = `{let count=0;${async ? "async " : ""}function* values(){${body}}const iterator=values();await iterator.next();return iterator}`;
  const ast = parseModule(source);
  const original = await interpret(ast.body[0]);
  if (!original.ok) throw new Error(original.error.message);
  let iterator = original.returnValue;
  const native = await runInNewContext(`(async()=>${source})()`);
  for (const sent of [4, 1, 0, 5]) {
  const wire = serialize({ source, currentAstNodeId: ast.body[0].nodeId!,
    scopeChain: [{ id: "external", bindings: { iterator } }],
    callStack: [], pendingPromises: [], moduleBindings: {} });
  const restored = restore(JSON.parse(JSON.stringify(wire)), { source });
  const binding = restored.currentScope.lookup("iterator");
  if (!binding.found) throw new Error("Missing iterator");
  iterator = binding.value;
  const next = await interpret(parseModule(`{return iterator.next(${sent})}`).body[0], {
    budget: restored.budget, bindings: { iterator: binding.value }
  });
  if (!next.ok) throw new Error(next.error.message);
  const actual = isSandboxPromise(next.returnValue) ? await next.returnValue.promise : next.returnValue;
  expect(actual).toEqual(await native.next(sent));
  }
});

it.each(["valid", "phase", "scope", "leak"])("validates public for-loop continuation: %s", async corruption => {
  const source = "function* values(){for(let index=0;index<3;index++){yield index}}const iterator=values();iterator.next();return 9";
  const pending = run(source);
  await pending;
  const wire = JSON.parse(await dump(pending));
  const generator = wire.heap[wire.bindings.iterator.id];
  const expression = Object.values(generator.expressionStates as Record<string, {
    kind: string; phase: string; activeScope: unknown
  }>).find(entry => entry.kind === "for")!;
  if (corruption === "phase") expression.phase = "update";
  if (corruption === "scope") expression.activeScope = wire.bindings.iterator;
  if (corruption === "leak") wire.bindings.exposed = expression.activeScope;
  if (corruption === "valid") expect(() => restoreDump(wire, { source })).not.toThrow();
  else expect(() => restoreDump(wire, { source })).toThrow();
});

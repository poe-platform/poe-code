import { expect, it } from "vitest";
import { runInNewContext } from "node:vm";
import { interpret } from "../interp/interpreter.js";
import { parseModule } from "../parse/parser.js";
import { restore } from "./restore.js";
import { serialize } from "./serialize.js";
import { Budget } from "../interp/budget.js";
import { createBuiltinBindings } from "../interp/globals.js";
import { isSandboxPromise } from "../interp/values.js";
import { run } from "../run.js";
import { dump } from "../dump.js";
import { restore as restoreDump } from "../restore.js";

const bodies = [
  "for(const value of [1,2,3]){yield value}return 9",
  "for(const value of 'a😀c'){yield value}return 9",
  "let count=0;function input(){count++;return [1,2,3]}for(const value of input()){yield value}return count",
  "const input=[1,2,3];for(const value of input){input.length=0;yield value;yield value}return 9",
  "const input=[1,2];for(const value of input){if(value===1)input.push(3);yield value}return 9",
  "let value;for(value of [1,2]){value+=10;yield value;yield value}return value",
  "const callbacks=[];for(let value of [1,2,3]){callbacks.push(()=>value);yield value}return callbacks.map(fn=>fn())",
  "for(const value of [1,2]){try{continue}finally{yield value}}return 9",
  "for(const outer of [1,2]){for(const inner of [3,4])yield [outer,inner]}return 9",
  "const target={};for(target[yield 1] of [2,3]){yield target.x}return target",
  "for(const [value=yield 1] of [[undefined],[undefined]]){yield value}return 9",
  "for(const value of (yield 1)){yield value}return 9",
  "for(const value of new Set([1,2,3])){yield value}return 9",
  "for(const value of new Map([[1,2],[3,4]])){yield value}return 9",
  "function* inner(){yield 1;yield 2;yield 3}for(const value of inner()){yield value}return 9",
  "let count=0;const iterable={[Symbol.iterator](){count++;let index=0;return {next(){return {done:index>=3,value:++index}}}}};for(const value of iterable){yield value}return count",
  "let count=0;const iterable={[Symbol.iterator](){let index=0;return {get next(){count++;return ()=>({done:index>=3,value:++index})}}}};for(const value of iterable){yield value}return count",
  "let closed=0;const iterable={[Symbol.iterator](){let index=0;return {next(){return {done:false,value:++index}},return(){closed++;return {done:true}}}}};for(const value of iterable){yield value;break}return closed"
];
const cases = bodies.flatMap(body => [false, true].map(async => ({ body, async })));
cases.push(...[
  "for await(const value of [1,2,3])yield value;return 9",
  "async function* inner(){yield 1;yield 2;yield 3}for await(const value of inner())yield value;return 9",
  "let count=0;const iterable={[Symbol.asyncIterator](){count++;let index=0;return {async next(){return {done:index>=3,value:++index}}}}};for await(const value of iterable)yield value;return count",
  "const input=[1,2,3];for await(const value of input){input.length=0;yield value;yield value}return 9",
  "let count=0;const input=[1,2,3];Object.defineProperty(input,'0',{get(){count++;return 1}});for await(const value of input)yield value;return count",
  "for await(const value of 'a😀c')yield value;return 9",
  "const input=[1,2,3];for await(const value of input){Object.setPrototypeOf(input,null);yield value}return 9"
].map(body => ({ body, async: true })));
it.each(cases)(
  "retains for-of progress: $body (async=$async)", async ({ body, async }) => {
  const source = `{${async ? "async " : ""}function* values(){${body}}const iterator=values();await iterator.next();return iterator}`;
  const ast = parseModule(source);
  const budget = new Budget();
  const globals = createBuiltinBindings({ budget });
  const original = await interpret(ast.body[0], { budget, bindings: { Set: globals.Set, Map: globals.Map, Symbol: globals.Symbol, Object: globals.Object } });
  if (!original.ok) throw new Error(original.error.message);
  let iterator = original.returnValue;
  const native = await runInNewContext(`(async()=>${source})()`);
  for (let index = 0; index < 5; index++) {
    const wire = serialize({ source, currentAstNodeId: ast.body[0].nodeId!,
      scopeChain: [{ id: "external", bindings: { iterator } }],
      callStack: [], pendingPromises: [], moduleBindings: {} });
    const restored = restore(JSON.parse(JSON.stringify(wire)), { source });
    const binding = restored.currentScope.lookup("iterator");
    if (!binding.found) throw new Error("Missing iterator");
    iterator = binding.value;
    const next = await interpret(parseModule('{return iterator.next("x")}').body[0], {
      budget: restored.budget, bindings: { iterator }
    });
    if (!next.ok) throw new Error(next.error.message);
    const actual = isSandboxPromise(next.returnValue) ? await next.returnValue.promise : next.returnValue;
    expect(actual).toEqual(await native.next("x"));
  }
});

it.each(["valid", "phase", "protocol", "adapter-protocol", "scope", "leak", "next"])(
  "validates iterator-backed generator snapshot: %s", async corruption => {
    const source = "function* values(){const iterable={[Symbol.iterator](){let index=0;return {next(){return {done:index>=3,value:++index}}}}};for(const value of iterable)yield value}const iterator=values();iterator.next();return 9";
    const pending = run(source);
    await pending;
    const wire = JSON.parse(await dump(pending));
    const generator = wire.heap[wire.bindings.iterator.id];
    const expression = Object.values(generator.expressionStates as Record<string, {
      kind: string; phase: string; async: boolean; scope: unknown; iterator: { next: unknown; async: boolean }
    }>).find(entry => entry.kind === "for-of-iterator")!;
    if (corruption === "phase") expression.phase = "left";
    if (corruption === "protocol") expression.async = true;
    if (corruption === "adapter-protocol") expression.iterator.async = true;
    if (corruption === "scope") expression.scope = wire.bindings.iterator;
    if (corruption === "leak") wire.bindings.exposed = expression.scope;
    if (corruption === "next") expression.iterator.next = 5;
    if (corruption === "valid") expect(() => restoreDump(wire, { source })).not.toThrow();
    else expect(() => restoreDump(wire, { source })).toThrow();
  }
);

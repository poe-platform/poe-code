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
  "let count=0;function input(){count++;return {}}const {first:{second=yield 1}=input()}={};return [count,second]",
  "let count=0;function input(){count++;return []}const [[first=yield 1]=input()]=[];return [count,first]",
  "let count=0;function input(){count++;return {}}let second;({first:{second=yield 1}=input()}={});return [count,second]",
  "let count=0;function input(){count++;return {}}const {first:{second=yield 1}=input()}={first:{}};return [count,second]",
  "let count=0;function input(){count++;return {}}const {first:{second=yield 2}=(yield 1,input())}={};return [count,second]",
  "let count=0;function input(){count++;return {}}const {first:{second=yield 1,third=yield 2}=input()}={};return [count,second,third]",
  "let count=0;function input(){count++;return {}}for(const {first:{second=yield 1}=input()} of [{},{}])yield [count,second];return count"
];

it.each(bodies.flatMap(body => [false, true].map(async => ({ body, async }))))(
  "preserves completed pattern defaults: $body (async=$async)", async ({ body, async }) => {
    const source = `{${async ? "async " : ""}function* values(){${body}}const iterator=values();await iterator.next();return iterator}`;
    const ast = parseModule(source);
    const original = await interpret(ast.body[0]);
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
    const next = await interpret(parseModule(`{return iterator.next(${sent})}`).body[0], {
      budget: restored.budget, bindings: { iterator }
    });
    if (!next.ok) throw new Error(next.error.message);
    const actual = isSandboxPromise(next.returnValue) ? await next.returnValue.promise : next.returnValue;
    expect(actual).toEqual(await native.next(sent));
    }
  }
);

it.each(["valid", "missing", "unrelated", "reference"])(
  "validates completed default snapshot state: %s", async corruption => {
    const source = "function* values(){const {first:{second=yield 1}={}}={};return second}const iterator=values();iterator.next();return 9";
    const pending = run(source);
    await pending;
    const wire = JSON.parse(await dump(pending));
    const generator = wire.heap[wire.bindings.iterator.id];
    const sources = Object.entries(generator.expressionStates as Record<string, { kind: string; value: unknown }>)
      .filter(([, entry]) => entry.kind === "pattern-source");
    expect(sources).toHaveLength(2);
    const [id, expression] = sources.at(-1)!;
    if (corruption === "missing") delete generator.expressionStates[id];
    if (corruption === "unrelated") {
      delete generator.expressionStates[id];
      generator.expressionStates["999999"] = expression;
    }
    if (corruption === "reference") expression.value = { ...wire.bindings.iterator, id: "missing" };
    if (corruption === "valid") expect(() => restoreDump(wire, { source })).not.toThrow();
    else expect(() => restoreDump(wire, { source })).toThrow();
  }
);

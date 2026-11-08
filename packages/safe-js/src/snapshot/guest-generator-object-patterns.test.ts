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
  "const {first,second=yield 1}={first:2};return [first,second]",
  "let count=0;const source={get first(){count++;return 2}};let first,second;({first,second=yield 1}=source);return [count,first,second]",
  "let count=0;function key(){count++;return 'first'}const {[key()]:first=yield 1,...rest}={other:2};return [count,first,rest]",
  "const {first=yield 1,second=yield 2}={};return [first,second]",
  "const {outer:{first,second=yield 1}}={outer:{first:2}};return [first,second]",
  "const {[yield 1]:first,...rest}={4:2,other:3};return [first,rest]",
  "let count=0;const target={};function key(){count++;return 'x'}({first:target[key()]=yield 1}={});return [count,target]",
  "const target={};({first:target[yield 1]}={first:9});return target",
  "const target={};let first;({first,...target[yield 1]}={first:2,other:3});return [first,target]",
  "const [first,{second,third=yield 1}]=[2,{second:3}];return [first,second,third]",
  "const key=Symbol('key');const {[key]:first=yield 1,...rest}={[key]:undefined,other:2};return [first,rest[key],rest.other]",
  "for(const {first,second=yield 1} of [{first:2},{first:3}])yield [first,second];return 9"
];

it.each(bodies.flatMap(body => [false, true].map(async => ({ body, async }))))(
  "preserves partial object patterns: $body (async=$async)", async ({ body, async }) => {
    const source = `{${async ? "async " : ""}function* values(){${body}}const iterator=values();await iterator.next();return iterator}`;
    const ast = parseModule(source);
    const budget = new Budget();
    const original = await interpret(ast.body[0], { budget, bindings: { Symbol: createBuiltinBindings({ budget }).Symbol } });
    if (!original.ok) throw new Error(original.error.message);
    const native = await runInNewContext(`(async()=>${source})()`);
    let iterator = original.returnValue;
    for (const sent of [4, 5, 6]) {
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

it.each(["valid", "index", "phase", "key", "excluded", "reference", "missing"])(
  "validates object-pattern snapshot state: %s", async corruption => {
    const source = "function* values(){const {first,second=yield 1}={first:2};return [first,second]}const iterator=values();iterator.next();return 9";
    const pending = run(source);
    await pending;
    const wire = JSON.parse(await dump(pending));
    const generator = wire.heap[wire.bindings.iterator.id];
    const [id, expression] = Object.entries(generator.expressionStates as Record<string, {
      kind: string; index: number; phase: string; key: unknown; excludedKeys: unknown[]; referenceObject?: unknown
    }>).find(([, entry]) => entry.kind === "object-pattern")!;
    if (corruption === "index") expression.index = 0;
    if (corruption === "phase") expression.phase = "key";
    if (corruption === "key") expression.key = wire.bindings.iterator;
    if (corruption === "excluded") expression.excludedKeys.push(2);
    if (corruption === "reference") expression.referenceObject = wire.bindings.iterator;
    if (corruption === "missing") delete generator.expressionStates[id];
    if (corruption === "valid") expect(() => restoreDump(wire, { source })).not.toThrow();
    else expect(() => restoreDump(wire, { source })).toThrow();
  }
);

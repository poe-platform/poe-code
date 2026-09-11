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
  "let count=0;function input(){count++;return [2]}const [first,second=yield 1]=input();return [count,first,second]",
  "let count=0;function input(){count++;return [2]}let first,second;const result=([first,second=yield 1]=input());return [count,first,second,result]",
  "let count=0;function input(){count++;return []}const [first=yield 1,second=yield 2]=input();return [count,first,second]",
  "let count=0;function input(){count++;return {}}const {first=yield 1}=input();return [count,first]",
  "let count=0;function input(){count++;return {}}let first;const result=({first=yield 1}=input());return [count,first,result]",
  "let count=0;const target={};function input(){count++;return [9]}[target[yield 1]]=input();return [count,target]",
  "let count=0;const input=[undefined];function source(){count++;return input}let first;const result=([first=yield 1]=source());return [count,result===input,first]"
];

it.each(bodies.flatMap(body => [false, true].map(async => ({ body, async }))))(
  "preserves destructuring source evaluation: $body (async=$async)", async ({ body, async }) => {
    const source = `{${async ? "async " : ""}function* values(){${body}}const iterator=values();await iterator.next();return iterator}`;
    const ast = parseModule(source);
    const original = await interpret(ast.body[0]);
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

it.each(["valid", "missing", "unrelated", "reference", "extra"])(
  "validates destructuring source snapshot state: %s", async corruption => {
    const source = "function* values(){const [first,second=yield 1]=[2];return [first,second]}const iterator=values();iterator.next();return 9";
    const pending = run(source);
    await pending;
    const wire = JSON.parse(await dump(pending));
    const generator = wire.heap[wire.bindings.iterator.id];
    const [id, expression] = Object.entries(generator.expressionStates as Record<string, {
      kind: string; value: unknown; extra?: boolean
    }>).find(([, entry]) => entry.kind === "pattern-source")!;
    if (corruption === "missing") delete generator.expressionStates[id];
    if (corruption === "unrelated") {
      delete generator.expressionStates[id];
      generator.expressionStates["999999"] = expression;
    }
    if (corruption === "reference") expression.value = { ...wire.bindings.iterator, id: "missing" };
    if (corruption === "extra") expression.extra = true;
    if (corruption === "valid") expect(() => restoreDump(wire, { source })).not.toThrow();
    else expect(() => restoreDump(wire, { source })).toThrow();
  }
);

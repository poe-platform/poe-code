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
  "for(const key in {a:1,b:2,c:3})yield key;return 9",
  "let count=0;function object(){count++;return {a:1,b:2}}for(const key in object()){yield key}return count",
  "const object={a:1,b:2,c:3};for(const key in object){delete object[key];yield key}return 9",
  "const object={a:1,b:2,c:3};for(const key in object){delete object.b;yield key}return 9",
  "let key;for(key in {a:1,b:2}){key+='!';yield key;yield key}return key",
  "const callbacks=[];for(let key in {a:1,b:2}){callbacks.push(()=>key);yield key}return callbacks.map(fn=>fn())",
  "for(const key in {a:1,b:2}){try{continue}finally{yield key}}return 9",
  "for(const key in (yield 1)){yield key}return 9",
  "for(const outer in {a:1,b:2}){for(const inner in {x:1,y:2})yield [outer,inner]}return 9",
  "const object={a:1,b:2};for(const key in object){object.c=3;yield key}return 9"
];

it.each(bodies.flatMap(body => [false, true].map(async => ({ body, async }))))(
  "preserves for-in continuation: $body (async=$async)", async ({ body, async }) => {
    const source = `{${async ? "async " : ""}function* values(){${body}}const iterator=values();await iterator.next();return iterator}`;
    const ast = parseModule(source);
    const original = await interpret(ast.body[0]);
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
  }
);

it.each(["valid", "index", "key", "scope", "leak"])("validates for-in snapshot state: %s", async corruption => {
  const source = "function* values(){for(const key in {a:1,b:2})yield key}const iterator=values();iterator.next();return 9";
  const pending = run(source);
  await pending;
  const wire = JSON.parse(await dump(pending));
  const generator = wire.heap[wire.bindings.iterator.id];
  const expression = Object.values(generator.expressionStates as Record<string, {
    kind: string; index: number; keys: unknown[]; scope: unknown
  }>).find(entry => entry.kind === "for-in")!;
  if (corruption === "index") expression.index = expression.keys.length;
  if (corruption === "key") expression.keys[0] = 5;
  if (corruption === "scope") expression.scope = wire.bindings.iterator;
  if (corruption === "leak") wire.bindings.exposed = expression.scope;
  if (corruption === "valid") expect(() => restoreDump(wire, { source })).not.toThrow();
  else expect(() => restoreDump(wire, { source })).toThrow();
});

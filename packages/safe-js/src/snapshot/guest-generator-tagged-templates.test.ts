import { runInNewContext } from "node:vm";
import { expect, it } from "vitest";
import { interpret } from "../interp/interpreter.js";
import { isSandboxPromise } from "../interp/values.js";
import { parseModule } from "../parse/parser.js";
import { restore } from "./restore.js";
import { serialize, type RuntimeSnapshotValue } from "./serialize.js";

const bodies = [
  'function tag(parts,a,b){return [a,b]}const value=tag`${count++}:${yield 1}`;return [count,value]',
  'function tag(parts,a,b){return [a,b]}function select(){count++;return tag}const value=select()`${count++}:${yield 1}`;return [count,value]',
  'const receiver={id:7,get tag(){count++;return function(parts,a,b){return [this.id,a,b]}}};const value=receiver.tag`${count++}:${yield 1}`;return [count,value]',
  'const receiver={id:7,tag(parts,a,b){return [this.id,a,b]}};function select(){count++;return receiver}const value=select().tag`${count++}:${yield 1}`;return [count,value]',
  'function tag(parts,a,b,c){return [a,b,c]}const value=tag`${count++}:${yield 1}:${yield 2}`;return [count,value]',
  'function tag(parts,a,b){return [a,b]}const value=tag`${count++}:${tag`${count++}:${yield 1}`}`;return [count,value]'
];

it.each(bodies.flatMap(body => [false, true].map(async => ({ body, async }))))(
  "preserves tagged template calls: $body (async=$async)", async ({ body, async }) => {
    const definition = `${async ? "async " : ""}function* values(){${body}}`;
    const source = `{let count=0;${definition}const iterator=values();await iterator.next();return iterator}`;
    const ast = parseModule(source);
    const original = await interpret(ast.body[0]);
    if (!original.ok) throw new Error(original.error.message);
    let iterator = original.returnValue as RuntimeSnapshotValue;
    const native = await runInNewContext(`(async()=>{let count=0;${definition}const iterator=values();await iterator.next();return iterator})()`);
    for (const sent of [4, 5, 6, 7]) {
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

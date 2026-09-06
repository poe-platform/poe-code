import { runInNewContext } from "node:vm";
import { expect, it } from "vitest";
import { interpret } from "../interp/interpreter.js";
import { isSandboxPromise } from "../interp/values.js";
import { parseModule } from "../parse/parser.js";
import { restore } from "./restore.js";
import { serialize, type RuntimeSnapshotValue } from "./serialize.js";

const bodies = [
  'function select(){count++;return {x:7}}const value=select()[yield 1];return [count,value]',
  'const owner={get object(){count++;return {x:7}}};const value=owner.object[yield 1];return [count,value]',
  'function select(){count++;return {x:7}}const value=select()?.[yield 1];return [count,value]',
  'function select(){count++;return null}const value=select()?.[yield 1];return [count,value]',
  'function select(){count++;return {id:7,x(){return this.id}}}const value=select()[yield 1]();return [count,value]',
  'const object={x:7};function select(){count++;return object}const value=delete select()[yield 1];return [count,value,object.x]',
  'const object={x:7};function select(){count++;return object}const value=select()[yield 1]++;return [count,value,object.x]',
  'const object={x:7};function select(){count++;return object}select()[yield 1]=9;return [count,object.x]',
  'function select(){count++;return {x:{x:7}}}const value=select()[yield 1][yield 2];return [count,value]',
  'function select(){count++;return null}try{return select()[yield 1]}catch(error){return [count,error.name]}',
  'super'
];

it.each(bodies.flatMap(body => [false, true].map(async => ({ body, async }))))(
  "preserves selected member objects: $body (async=$async)", async ({ body, async }) => {
    const definition = body === "super"
      ? `const object={__proto__:{get x(){return this.id}},id:7,${async ? "async " : ""}*values(){return super[yield 1]}};const values=()=>object.values();`
      : `${async ? "async " : ""}function* values(){${body}}`;
    const source = `{let count=0;${definition}const iterator=values();await iterator.next();return iterator}`;
    const ast = parseModule(source);
    const original = await interpret(ast.body[0]);
    if (!original.ok) throw new Error(original.error.message);
    let iterator = original.returnValue as RuntimeSnapshotValue;
    const native = await runInNewContext(`(async()=>{let count=0;${definition}const iterator=values();await iterator.next();return iterator})()`);
    for (const sent of ["x", "x", "x"]) {
      const snapshot = serialize({ source, currentAstNodeId: ast.body[0].nodeId!,
        scopeChain: [{ id: "external", bindings: { iterator } }],
        callStack: [], pendingPromises: [], moduleBindings: {} });
      const restored = restore(JSON.parse(JSON.stringify(snapshot)), { source });
      const binding = restored.currentScope.lookup("iterator");
      if (!binding.found) throw new Error("Missing restored iterator");
      iterator = binding.value as RuntimeSnapshotValue;
      const next = await interpret(parseModule(`{return iterator.next(${JSON.stringify(sent)})}`).body[0], {
        budget: restored.budget, bindings: { iterator: binding.value }
      });
      if (!next.ok) throw new Error(next.error.message);
      const actual = isSandboxPromise(next.returnValue) ? await next.returnValue.promise : next.returnValue;
      expect(actual).toEqual(await native.next(sent));
    }
  }
);

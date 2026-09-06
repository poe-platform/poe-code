import { runInNewContext } from "node:vm";
import { expect, it } from "vitest";
import { interpret } from "../interp/interpreter.js";
import { isSandboxPromise } from "../interp/values.js";
import { parseModule } from "../parse/parser.js";
import { restore } from "./restore.js";
import { serialize, type RuntimeSnapshotValue } from "./serialize.js";

const bodies = [
  'const object={x:0};function select(){count++;return object}select().x=yield 1;return [count,object.x]',
  'const object={x:0};function key(){count++;return "x"}object[key()]=yield 1;return [count,object.x]',
  'const object={x:0};const key={toString(){count++;return "x"}};object[key]=yield 1;return [count,object.x]',
  'const object={x:2};function select(){count++;return object}select().x+=yield 1;return [count,object.x]',
  'let saved=2;const object={get x(){count++;return saved},set x(value){saved=value}};object.x+=yield 1;return [count,saved]',
  'const object={x:2};const key={toString(){count++;return "x"}};object[key]+=yield 1;return [count,object.x]',
  'let saved=2;const object={get x(){count++;return saved},set x(value){saved=value}};object.x&&=yield 1;return [count,saved]',
  'let saved=0;const object={get x(){count++;return saved},set x(value){saved=value}};object.x||=yield 1;return [count,saved]',
  'let saved=null;const object={get x(){count++;return saved},set x(value){saved=value}};object.x??=yield 1;return [count,saved]',
  'const object={x:0};function select(){count++;return object}select().x=(yield 1)+(yield 2);return [count,object.x]',
  'const object={4:2};function select(){count++;return object}select()[yield 1]+=yield 2;return [count,object[4]]',
  'const object={a:2,b:10};const key={toString(){return ++count===1?"a":"b"}};object[key]+=yield 1;return [count,object.a,object.b]',
  'function select(){count++;return null}try{select().x=yield 1}catch(error){return [count,error.name]}',
  'super'
];

it.each(bodies.flatMap(body => [false, true].map(async => ({ body, async }))))(
  "preserves pending member assignments: $body (async=$async)", async ({ body, async }) => {
    const definition = body === "super"
      ? `const object={__proto__:{get x(){count++;return this.id},set x(value){this.id=value}},id:2,${async ? "async " : ""}*values(){super.x+=yield 1;return [count,this.id]}};const values=()=>object.values();`
      : `${async ? "async " : ""}function* values(){${body}}`;
    const source = `{let count=0;${definition}const iterator=values();await iterator.next();return iterator}`;
    const ast = parseModule(source);
    const original = await interpret(ast.body[0]);
    if (!original.ok) throw new Error(original.error.message);
    let iterator = original.returnValue as RuntimeSnapshotValue;
    // ECMAScript 2026 GetValue caches the converted reference key. Node 22
    // converts object keys twice, so use a primitive-key arithmetic oracle for
    // those cases while still asserting one effectful conversion in SafeJS.
    const oracleDefinition = definition.replace("object[key]+=", "object[key.toString()]+=");
    const native = await runInNewContext(`(async()=>{let count=0;${oracleDefinition}const iterator=values();await iterator.next();return iterator})()`);
    for (const sent of [4, 5, 6]) {
      const wire = serialize({ source, currentAstNodeId: ast.body[0].nodeId!,
        scopeChain: [{ id: "external", bindings: { iterator } }],
        callStack: [], pendingPromises: [], moduleBindings: {} });
      const restored = restore(JSON.parse(JSON.stringify(wire)), { source });
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

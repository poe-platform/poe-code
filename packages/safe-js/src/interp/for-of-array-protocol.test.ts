import { expect, it } from "vitest";
import { run } from "../run.js";
import { interpret } from "./interpreter.js";
import { parseModule } from "../parse/parser.js";
import { serialize } from "../snapshot/serialize.js";
import { restore } from "../snapshot/restore.js";

it.each([
  "const source=[1,2];source[Symbol.iterator]=function*(){yield 7;yield 8};const result=[];for(const value of source)result.push(value);return result",
  "const source=[1,2];source[Symbol.iterator]=null;try{for(const value of source){}return 'accepted'}catch(error){return error.name}",
  "let reads=0;const source=[1,2];Object.defineProperty(source,'0',{get(){reads++;return 7}});const result=[];for(const value of source)result.push(value);return [result,reads]",
  "const source=[1,2];source[Symbol.iterator]=undefined;try{for(const value of source){}return 'accepted'}catch(error){return error.name}",
  "const source=[1,2];source[Symbol.iterator]=5;try{for(const value of source){}return 'accepted'}catch(error){return error.name}",
  "let reads=0;const source=[1,2];Object.defineProperty(source,Symbol.iterator,{get(){reads++;return function*(){yield this[1]}}});const result=[];for(const value of source)result.push(value);return [result,reads]",
  "const source=[1,2];Object.setPrototypeOf(source,{[Symbol.iterator]:function*(){yield 7}});const result=[];for(const value of source)result.push(value);return result",
  "let closes=0;const source=[1,2];source[Symbol.iterator]=function*(){try{yield 7;yield 8}finally{closes++}};for(const value of source)break;return closes"
])("honors array iteration protocol: %s", async source => {
  expect(await run(source)).toMatchObject({ ok: true, returnValue: new Function(source)() });
});

it("continues legacy indexed generator snapshots", async () => {
  const source = "{function* values(){for(const value of [1,2,3])yield value;return 9}const iterator=values();iterator.next();return iterator}";
  const ast = parseModule(source);
  const original = await interpret(ast.body[0]);
  if (!original.ok) throw new Error(original.error.message);
  let wire = serialize({ source, currentAstNodeId: ast.body[0].nodeId!,
    scopeChain: [{ id: "external", bindings: { iterator: original.returnValue } }],
    callStack: [], pendingPromises: [], moduleBindings: {} });
  const generator = Object.values(wire.heap!).find(value => value.kind === "guest-generator")!;
  const [id, expression] = Object.entries(generator.expressionStates!)[0];
  if (expression.kind !== "for-of-iterator") throw new Error("Missing iterator continuation");
  generator.expressionStates![id] = { kind: "for-of-array", phase: expression.phase,
    values: expression.value, current: expression.current, index: expression.index, scope: expression.scope };
  for (const expected of [{ value: 2, done: false }, { value: 3, done: false }, { value: 9, done: true }]) {
    const restored = restore(JSON.parse(JSON.stringify(wire)), { source });
    const binding = restored.currentScope.lookup("iterator");
    if (!binding.found) throw new Error("Missing iterator");
    const next = await interpret(parseModule("{return iterator.next()}").body[0], {
      budget: restored.budget, bindings: { iterator: binding.value }
    });
    expect(next).toMatchObject({ ok: true, returnValue: expected });
    wire = serialize({ source, currentAstNodeId: ast.body[0].nodeId!,
      scopeChain: [{ id: "external", bindings: { iterator: binding.value } }],
      callStack: [], pendingPromises: [], moduleBindings: {} });
  }
});

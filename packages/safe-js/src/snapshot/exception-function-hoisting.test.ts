import { runInNewContext } from "node:vm";
import { expect, it } from "vitest";
import { run } from "../run.js";
import { interpret } from "../interp/interpreter.js";
import { parseModule } from "../parse/parser.js";
import { serialize, type RuntimeSnapshotValue } from "./serialize.js";
import { restore } from "./restore.js";

it.each([
  'try{yield 0;return f();function f(){return 7}}finally{}',
  'try{throw 1}catch(e){yield 0;return f();function f(){return e+6}}',
  'try{}finally{yield 0;return f();function f(){return 7}}',
  'try{const first=f;yield 0;function f(){return 7};return first===f}finally{}',
  'try{throw 1}catch(e){const first=f;yield 0;function f(){return e};return [first===f,f()]}',
  'try{}finally{const first=f;yield 0;function f(){return 7};return first===f}'
])("restores hoisted exception-block functions: %s", async body => {
  const source = `{function* values(){${body}}const iterator=values();iterator.next();return iterator}`;
  const native = runInNewContext(`(function(){'use strict';${source}})()`);
  const original = await run(source);
  if (!original.ok) throw new Error(original.error.message);
  const wire = serialize({source, currentAstNodeId: parseModule(source).body[0].nodeId!,
    scopeChain: [{id: "external", bindings: {iterator: original.returnValue as RuntimeSnapshotValue}}],
    callStack: [], pendingPromises: [], moduleBindings: {}});
  const restored = restore(JSON.parse(JSON.stringify(wire)), {source});
  const binding = restored.currentScope.lookup("iterator");
  if (!binding.found) throw new Error("Missing restored iterator.");
  expect(await interpret(parseModule("{return iterator.next()}").body[0], {
    budget: restored.budget, bindings: {iterator: binding.value}
  })).toMatchObject({ok: true, returnValue: native.next()});
});

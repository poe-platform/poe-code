import { runInNewContext } from "node:vm";
import { expect, it } from "vitest";
import { run } from "../run.js";
import { interpret } from "../interp/interpreter.js";
import { parseModule } from "../parse/parser.js";
import { serialize, type RuntimeSnapshotValue } from "./serialize.js";
import { restore } from "./restore.js";

it.each([
  'try{missing}catch(e){yield 0;return [e.name,e instanceof ReferenceError]}',
  'try{try{missing}finally{yield 0}}catch(e){return e.name}'
])("restores reference-error exception flow: %s", async body => {
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

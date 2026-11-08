import { expect, it } from "vitest";
import { run } from "../run.js";
import { interpret } from "../interp/interpreter.js";
import { parseModule } from "../parse/parser.js";
import { serialize, type RuntimeSnapshotValue } from "./serialize.js";
import { restore } from "./restore.js";

it.each([
  "x = (delete x,yield 1)",
  "x += (delete x,yield 1)",
  "x ||= (delete x,yield 1)",
  "[x=(delete x,yield 1)]=[]",
  "({x=(delete x,yield 1)}={})"
])("restores a deleted eval binding during %s", async assignment => {
  const body = `return function*(){eval("var x=0");${assignment};return [x,delete x,typeof x]}`;
  const source = `{const iterator=Function(${JSON.stringify(body)})()();iterator.next();return iterator}`;
  const original = await run(source);
  if (!original.ok) throw new Error(original.error.message);
  const wire = serialize({
    source, currentAstNodeId: parseModule(source).body[0].nodeId!,
    scopeChain: [{id: "external", bindings: {iterator: original.returnValue as RuntimeSnapshotValue}}],
    callStack: [], pendingPromises: [], moduleBindings: {}
  });
  const restored = restore(JSON.parse(JSON.stringify(wire)), {source});
  expect(await interpret(parseModule("{return iterator.next(3)}").body[0], {
    budget: restored.budget, bindings: {iterator: restored.currentScope.lookup("iterator").value}
  })).toMatchObject({ok: true, returnValue: {done: true, value: [3, true, "undefined"]}});
});

import { expect, it } from "vitest";
import { run } from "../run.js";
import { interpret } from "../interp/interpreter.js";
import { parseModule } from "../parse/parser.js";
import { serialize, type RuntimeSnapshotValue } from "./serialize.js";
import { restore } from "./restore.js";

it.each([
  {declaration: "var x;", expected: [undefined, 2]},
  {declaration: "var x=3;", expected: [3, 2]}
])("preserves parameter and body environments after recovery: $declaration", async ({declaration, expected}) => {
  const parameters = 'a=eval("var x=2"),b=()=>x';
  const body = `${declaration}return ()=>[x,b()]`;
  const source = `{return Function(${JSON.stringify(parameters)},${JSON.stringify(body)})()}`;
  const original = await run(source);
  if (!original.ok) throw new Error(original.error.message);
  const wire = serialize({
    source, currentAstNodeId: parseModule(source).body[0].nodeId!,
    scopeChain: [{id: "external", bindings: {fn: original.returnValue as RuntimeSnapshotValue}}],
    callStack: [], pendingPromises: [], moduleBindings: {}
  });
  const restored = restore(JSON.parse(JSON.stringify(wire)), {source});
  expect(await interpret(parseModule("{return fn()}").body[0], {
    budget: restored.budget, bindings: {fn: restored.currentScope.lookup("fn").value}
  })).toMatchObject({ok: true, returnValue: expected});
});

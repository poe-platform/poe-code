import { expect, it } from "vitest";
import { run } from "../run.js";
import { interpret } from "../interp/interpreter.js";
import { parseModule } from "../parse/parser.js";
import { serialize, type RuntimeSnapshotValue } from "./serialize.js";
import { restore } from "./restore.js";

it.each(["2", "2n"])("preserves an eval binding deleted by restored numeric conversion: %s", async numeric => {
  const body = `eval("var x");x={valueOf(){delete x;return ${numeric}}};return ()=>{const old=x++;return [old,x,delete x]}`;
  const source = `{return Function(${JSON.stringify(body)})()}`;
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
  })).toMatchObject({ok: true, returnValue: numeric === "2" ? [2, 3, true] : [2n, 3n, true]});
});

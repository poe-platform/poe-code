import { expect, it } from "vitest";
import { run } from "../run.js";
import { interpret } from "../interp/interpreter.js";
import { parseModule } from "../parse/parser.js";
import { serialize, type RuntimeSnapshotValue } from "./serialize.js";
import { restore } from "./restore.js";
import { SnapshotValidationError } from "./validation.js";

it.each([
  'eval("var x=1"); return ()=>[delete x,typeof x]',
  'eval("function x(){}"); return ()=>[delete x,typeof x]',
  'var x=1; eval("var x=2"); return ()=>[delete x,x]'
])("preserves eval binding deletion through recovery: %s", async body => {
  const source = `{return Function(${JSON.stringify(body)})()}`;
  const expected: unknown = Function(body)()();
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
  const frame = Object.values(wire.heap).find(node => node.kind === "scope-frame" && node.cells.some(cell => cell.deletable));
  if (!body.startsWith("var")) {
    expect(frame).toBeDefined();
    for (const invalid of [false, "true", 1]) {
      const forged: typeof wire = JSON.parse(JSON.stringify(wire));
      for (const node of Object.values(forged.heap)) if (node.kind === "scope-frame")
        for (const cell of node.cells) if (cell.deletable) Object.assign(cell, {deletable: invalid});
      expect(() => restore(forged, {source})).toThrow(SnapshotValidationError);
    }
  }
});

import { runInNewContext } from "node:vm";
import { expect, it } from "vitest";
import { run } from "../run.js";
import { interpret } from "../interp/interpreter.js";
import { parseModule } from "../parse/parser.js";
import { serialize, type RuntimeSnapshotValue } from "./serialize.js";
import { restore } from "./restore.js";
import { SnapshotValidationError } from "./validation.js";

it.each([
  { thrown: "1", parameter: "e" },
  { thrown: "({e:1})", parameter: "{e}" },
  { thrown: "[1]", parameter: "[e]" }
])("preserves eval catch conflicts after generator restoration: $parameter", async ({ thrown, parameter }) => {
  const body = `return function*(){try{throw ${thrown}}catch(${parameter}){yield 0;try{eval("var e=2");return e}catch(error){return error.name}}}`;
  const source = `{const iterator=Function(${JSON.stringify(body)})()();iterator.next();return iterator}`;
  const native = runInNewContext(`(function()${source})()`);
  const original = await run(source);
  if (!original.ok) throw new Error(original.error.message);
  const wire = serialize({ source, currentAstNodeId: parseModule(source).body[0].nodeId!,
    scopeChain: [{ id: "external", bindings: { iterator: original.returnValue as RuntimeSnapshotValue } }],
    callStack: [], pendingPromises: [], moduleBindings: {} });
  const catchFrame = Object.values(wire.heap).find(node => node.kind === "scope-frame" && node.simpleCatchParameter !== undefined);
  expect(catchFrame !== undefined).toBe(parameter === "e");
  const restored = restore(JSON.parse(JSON.stringify(wire)), { source });
  const binding = restored.currentScope.lookup("iterator");
  if (!binding.found) throw new Error("Missing restored iterator.");
  expect(await interpret(parseModule("{return iterator.next()}").body[0], {
    budget: restored.budget, bindings: { iterator: binding.value }
  })).toMatchObject({ ok: true, returnValue: native.next() });

  if (parameter === "e") {
    if (catchFrame?.kind !== "scope-frame") throw new Error("Missing simple catch frame.");
    for (const invalid of [false, "", "missing"]) {
      const forged: typeof wire = JSON.parse(JSON.stringify(wire));
      const entry = Object.values(forged.heap).find(node => node.kind === "scope-frame" && node.simpleCatchParameter !== undefined) as Record<string, unknown>;
      entry.simpleCatchParameter = invalid;
      expect(() => restore(forged, { source })).toThrow(SnapshotValidationError);
    }
  }
});

import { expect, it } from "vitest";
import { run } from "../run.js";
import { interpret } from "../interp/interpreter.js";
import { parseModule } from "../parse/parser.js";
import { serialize, type RuntimeSnapshotValue } from "./serialize.js";
import { restore } from "./restore.js";

it("preserves the rejection source location through a JSON checkpoint", async () => {
  const source = "{const p=Promise.resolve().then(() => {\nreturn missing;\n});await p.catch(()=>0);return {p}}";
  const original = await run(source);
  if (!original.ok) throw new Error(original.error.message);
  const wire = serialize({
    source, currentAstNodeId: parseModule(source).body[0].nodeId!,
    scopeChain: [{id: "external", bindings: original.returnValue as Record<string, RuntimeSnapshotValue>}],
    callStack: [], pendingPromises: [], moduleBindings: {}
  });
  const restored = restore(JSON.parse(JSON.stringify(wire)), {source});
  expect(await interpret(parseModule("{return await p.catch(error=>error.stack)}").body[0], {
    budget: restored.budget, bindings: {p: restored.currentScope.lookup("p").value}
  })).toMatchObject({ok: true, returnValue: expect.stringContaining("(line 2, column 8)")});
});

import { expect, it } from "vitest";
import { run } from "../../run.js";
import { serialize, type RuntimeSnapshotValue } from "../../snapshot/serialize.js";
import { restore } from "../../snapshot/restore.js";
import { isSandboxClosure } from "../values.js";

it.each([
  ["String.prototype.toString", "'text'", "text"],
  ["String.prototype.valueOf", "'text'", "text"],
  ["Number.prototype.valueOf", "42", 42],
  ["Boolean.prototype.toString", "true", "true"],
  ["Boolean.prototype.valueOf", "true", true]
])("restores mutable properties and behavior of %s", async (expression, receiver, expected) => {
  const source = `const f=${expression};f.marker={count:0};f.self=f;return ()=>[f===${expression},f.self===f,f.marker.count++,f.call(${receiver})]`;
  const result = await run(source);
  if (!result.ok) throw result.error;
  let reader = result.returnValue as RuntimeSnapshotValue;
  for (let count = 0; count < 2; count++) {
    const saved = serialize({ source, currentAstNodeId: 1, scopeChain: [{ id: "module", bindings: { reader } }], callStack: [], pendingPromises: [], moduleBindings: {} });
    const restored = restore(JSON.parse(JSON.stringify(saved)), { source });
    const binding = restored.currentScope.lookup("reader");
    if (!binding.found || !isSandboxClosure(binding.value)) throw new Error("Missing reader");
    expect(await binding.value.call([])).toEqual([true, true, count, expected]);
    reader = binding.value;
  }
});

import { assert, expect, it } from "vitest";
import { run } from "../run.js";
import { Budget } from "../interp/budget.js";
import { invokeBuiltinClosure } from "../interp/builtin-call.js";
import { isSandboxClosure } from "../interp/values.js";
import { serialize, type RuntimeSnapshotValue } from "./serialize.js";
import { restore } from "./restore.js";

it.each([
  ["return ()=>undefined", undefined],
  ["let undefined=7;return ()=>undefined", 7]
])("preserves undefined lookup through repeated closure snapshots: %s", async (source, expected) => {
  const result = await run(source as string);
  assert(result.ok);
  let reader = result.returnValue as RuntimeSnapshotValue;
  for (let repeat=0;repeat<3;repeat++) {
    const snapshot = serialize({source:source as string,currentAstNodeId:1,scopeChain:[{id:"module",bindings:{reader}}],callStack:[],pendingPromises:[],moduleBindings:{}});
    const budget = new Budget();
    const restored = restore(JSON.parse(JSON.stringify(snapshot)), {source:source as string,budget});
    const binding = restored.currentScope.lookup("reader");
    assert(binding.found && isSandboxClosure(binding.value));
    expect(await invokeBuiltinClosure(binding.value,[],budget,undefined,undefined)).toBe(expected);
    reader = binding.value;
  }
});

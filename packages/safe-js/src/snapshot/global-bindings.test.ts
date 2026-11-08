import { assert, expect, it } from "vitest";
import { run } from "../run.js";
import { Budget } from "../interp/budget.js";
import { invokeBuiltinClosure } from "../interp/builtin-call.js";
import { isSandboxClosure } from "../interp/values.js";
import { serialize, type RuntimeSnapshotValue } from "./serialize.js";
import { restore } from "./restore.js";

it("preserves writable globals captured by a closure across repeated JSON round trips", async () => {
  const source = "Math={value:7};return ()=>{Math={value:Math.value+1};return Math.value}";
  const result = await run(source);
  assert(result.ok);
  let reader = result.returnValue as RuntimeSnapshotValue;
  for (const expected of [8,9]) {
    const snapshot = serialize({source,currentAstNodeId:1,scopeChain:[{id:"module",bindings:{reader}}],callStack:[],pendingPromises:[],moduleBindings:{}});
    const budget = new Budget();
    const restored = restore(JSON.parse(JSON.stringify(snapshot)), {source,budget});
    const binding = restored.currentScope.lookup("reader");
    assert(binding.found && isSandboxClosure(binding.value));
    expect(await invokeBuiltinClosure(binding.value,[],budget,undefined,undefined)).toBe(expected);
    reader = binding.value;
  }
});

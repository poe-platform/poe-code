import { assert, expect, it } from "vitest";
import { run } from "../run.js";
import { Budget } from "../interp/budget.js";
import { invokeBuiltinClosure } from "../interp/builtin-call.js";
import { awaitSandboxValue } from "../interp/cancel.js";
import { isSandboxClosure } from "../interp/values.js";
import { serialize, type RuntimeSnapshotValue } from "./serialize.js";
import { restore } from "./restore.js";

it.each([false, true])("restores escaped aggregate callbacks with partial results and shared called flags (properties: %s)", async properties => {
  const source = `const callbacks=[];let value;const resolve=result=>{value=result};const reject=reason=>{value=reason};function C(executor){executor(resolve,reject)}C.resolve=value=>({then(ok,fail){callbacks.push([ok,fail])}});Promise.allSettled.call(C,[1,2]);callbacks[0][0](7);${properties ? "callbacks[0][0].label='kept';" : ""}return async()=>{callbacks[0][1]('ignored');callbacks[1][1]('second');return ${properties ? "[value,callbacks[0][0].label]" : "value"}}`;
  const outcomes = [{status: "fulfilled", value: 7}, {status: "rejected", reason: "second"}];
  const expected = properties ? [outcomes, "kept"] : outcomes;
  const control = await run(source);
  assert(control.ok && isSandboxClosure(control.returnValue));
  const budget = new Budget();
  expect(await awaitSandboxValue(await invokeBuiltinClosure(control.returnValue, [], budget, undefined, undefined), undefined, budget)).toEqual(expected);
  const fresh = await run(source);
  assert(fresh.ok);
  const snapshot = serialize({source, currentAstNodeId: 1,
    scopeChain: [{id: "module", bindings: {read: fresh.returnValue as RuntimeSnapshotValue}}],
    callStack: [], pendingPromises: [], moduleBindings: {}});
  const restoredBudget = new Budget();
  const binding = restore(JSON.parse(JSON.stringify(snapshot)), {source, budget: restoredBudget}).currentScope.lookup("read");
  assert(binding.found && isSandboxClosure(binding.value));
  expect(await awaitSandboxValue(await invokeBuiltinClosure(binding.value, [], restoredBudget, undefined, undefined), undefined, restoredBudget)).toEqual(expected);
});

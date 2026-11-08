import { assert, expect, it } from "vitest";
import { run } from "../run.js";
import { Budget } from "../interp/budget.js";
import { invokeBuiltinClosure } from "../interp/builtin-call.js";
import { awaitSandboxValue } from "../interp/cancel.js";
import { isSandboxClosure } from "../interp/values.js";
import { serialize, type RuntimeSnapshotValue } from "./serialize.js";
import { restore } from "./restore.js";
import { validateGuestHeapNode } from "./guest-heap-validation.js";

it.each([
  ["setter", "const box={};Object.defineProperty(box,'value',{set:callbacks[0]});return ()=>{box.value=7;return result}", [7]],
  ["getter", "const box={};Object.defineProperty(box,'value',{get:callbacks[0]});return ()=>{box.value;return result}", [undefined]],
  ["bound", "const bound=callbacks[0].bind(null,7);return async()=>{await bound();return result}", [7]]
] as const)("restores an aggregate callback used as a %s", async (_name, tail, expected) => {
  const source = "const callbacks=[];let result;const resolve=value=>{result=value};const reject=()=>{};function C(executor){executor(resolve,reject)}C.resolve=value=>({then(ok){callbacks.push(ok)}});Promise.all.call(C,[1]);" + tail;
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

it.each(["promise-aggregate", "aggregate-entry", "pending-promise"])("does not accept non-callable %s records as getters", kind => {
  const getter = {kind: "ref", id: 1};
  const node = {kind: "guest-object", state: {properties: {extensible: true, properties: [
    ["value", {kind: "accessor", get: getter, set: {kind: "undefined"}, enumerable: true, configurable: true}]
  ]}}};
  expect(() => validateGuestHeapNode(node, {"1": {kind}})).toThrow("Wrong guest heap reference kind");
});

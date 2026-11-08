import { assert, expect, it } from "vitest";
import { run } from "../run.js";
import { Budget } from "../interp/budget.js";
import { invokeBuiltinClosure } from "../interp/builtin-call.js";
import { awaitSandboxValue } from "../interp/cancel.js";
import { isSandboxClosure, measureSandboxData } from "../interp/values.js";
import { serialize, type RuntimeSnapshotValue } from "./serialize.js";
import { restore } from "./restore.js";

it.each([
  ["const callbacks=[];function C(executor){executor(value=>{this.value=value},reason=>{this.reason=reason})}C.resolve=value=>({then(ok,fail){callbacks.push([ok,fail])}});const result=Promise.allSettled.call(C,[1,2]);callbacks[0][0](7);return async()=>{callbacks[1][1]('second');return result.value}", [{status: "fulfilled", value: 7}, {status: "rejected", reason: "second"}]],
  ["let saved;function C(executor){saved=executor;executor(()=>{},()=>{})}C.resolve=value=>Promise.resolve(value);Promise.all.call(C,[]);return ()=>{try{saved(()=>{},()=>{});return false}catch(error){return error instanceof TypeError}}", true],
  ["let saved;function C(executor){saved=executor}try{Promise.all.call(C,[])}catch{}return ()=>{saved(undefined,undefined);saved(undefined,undefined);saved(()=>{},()=>{});try{saved(()=>{},()=>{});return false}catch(error){return error instanceof TypeError}}", true],
  ["let saved;function C(executor){saved=executor;executor(1,undefined)}try{Promise.all.call(C,[])}catch{}return ()=>{try{saved(()=>{},()=>{});return false}catch(error){return error instanceof TypeError}}", true],
  ["let saved;function C(executor){saved=executor;executor(executor,undefined)}try{Promise.all.call(C,[])}catch{}saved.label='kept';Object.setPrototypeOf(saved,{tag:'prototype'});return ()=>[saved.label,Object.getPrototypeOf(saved).tag,saved.name,saved.length]", ["kept", "prototype", "", 2]],
  ["let saved;function C(executor){saved=executor}try{Promise.all.call(C,[])}catch{}const box={};Object.defineProperty(box,'value',{set:saved});return ()=>{box.value=undefined;box.value=()=>{};try{box.value=()=>{};return false}catch(error){return error instanceof TypeError}}", true]
] as const)("restores retained capability executor state: %s", async (source, expected) => {
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

it("accounts for values retained by an executor after capability validation fails", async () => {
  const result = await run("let saved;const payload={text:''};function C(executor){saved=executor;executor(payload,undefined)}try{Promise.all.call(C,[])}catch{}return [saved,()=>{payload.text='x'.repeat(400)}]");
  assert(result.ok && Array.isArray(result.returnValue));
  const [executor, grow] = result.returnValue;
  assert(isSandboxClosure(executor) && isSandboxClosure(grow));
  const before = measureSandboxData([executor]);
  await invokeBuiltinClosure(grow, [], new Budget(), undefined, undefined);
  expect(measureSandboxData([executor]) - before).toBe(400);
});

it("rejects a dangling executor state reference", async () => {
  const source = "let saved;function C(executor){saved=executor}try{Promise.all.call(C,[])}catch{}return ()=>saved";
  const result = await run(source);
  assert(result.ok);
  const snapshot = serialize({source, currentAstNodeId: 1,
    scopeChain: [{id: "module", bindings: {read: result.returnValue as RuntimeSnapshotValue}}],
    callStack: [], pendingPromises: [], moduleBindings: {}});
  assert(snapshot.heap !== undefined);
  const node = Object.values(snapshot.heap).find(node => node.kind === "capability-executor");
  assert(node?.kind === "capability-executor");
  node.resolve = {kind: "ref", id: 999999};
  expect(() => restore(JSON.parse(JSON.stringify(snapshot)), {source, budget: new Budget()})).toThrow();
});

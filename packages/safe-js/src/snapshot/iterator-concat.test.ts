import { expect, it } from "vitest";
import { run } from "../run.js";
import { Budget } from "../interp/budget.js";
import { invokeBuiltinClosure } from "../interp/builtin-call.js";
import { getSandboxPropertyDescriptor } from "../interp/object-model.js";
import { createSandboxClosure, isSandboxClosure, measureSandboxData } from "../interp/values.js";
import { iteratorHelperStates } from "../interp/iterator-helper.js";
import { serialize } from "./serialize.js";
import { restore } from "./restore.js";
import { validateGuestHeapNode } from "./guest-heap-validation.js";

it.each([0,1,2,3,4])("restores concat after %s next calls with remaining inputs and aliases", async advances => {
  const source=`const helper=Iterator.concat([1,2],[3]);for(let i=0;i<${advances};i++)helper.next();return helper`;
  const result=await run(source);
  if (!result.ok) throw result.error;
  const snapshot=serialize({source,currentAstNodeId:1,
    scopeChain:[{id:"external",bindings:{helper:result.returnValue,alias:result.returnValue}}],
    callStack:[],pendingPromises:[],moduleBindings:{}});
  const budget=new Budget();
  const restored=restore(JSON.parse(JSON.stringify(snapshot)),{source,budget});
  const helper=restored.currentScope.lookup("helper").value;
  expect(helper).toBe(restored.currentScope.lookup("alias").value);
  if (helper===null || typeof helper!=="object") throw new Error("Missing restored helper");
  const descriptor=getSandboxPropertyDescriptor(helper,"next",budget);
  if (descriptor===undefined || !("value" in descriptor) || !isSandboxClosure(descriptor.value))
    throw new Error("Missing restored next method");
  for (const value of [1,2,3].slice(advances))
    expect(await invokeBuiltinClosure(descriptor.value,[],budget,undefined,helper)).toEqual({value,done:false});
  expect(await invokeBuiltinClosure(descriptor.value,[],budget,undefined,helper)).toEqual({value:undefined,done:true});
});

it("validates empty pending concat state but rejects malformed queue states", () => {
  const valid={kind:"iterator-helper",method:"concat",status:"start",iterables:[],
    callback:{kind:"undefined"},remaining:0,index:0,
    state:{properties:{properties:[],extensible:true}}};
  expect(()=>validateGuestHeapNode(valid,{})).not.toThrow();
  for (const patch of [
    {iterables:null},{iterables:[{}]},{iterables:[{iterable:{kind:"undefined"},open:{kind:"undefined"}}]},
    {status:"yield"},{status:"done"},{remaining:1},{index:1},{callback:7}
  ]) expect(()=>validateGuestHeapNode({...valid,...patch},{})).toThrow(TypeError);
});

it("charges unopened input data and captured open methods", () => {
  const open=createSandboxClosure({sandbox:true,call:()=>undefined});
  const baseline={};
  const retained={};
  for (const [helper,payload] of [[baseline,""],[retained,"x".repeat(200)]] as const)
    iteratorHelperStates.set(helper,{method:"concat",status:"start",remaining:0,index:0,callback:undefined,
      iterables:[{iterable:{payload},open}]});
  expect(measureSandboxData([retained])-measureSandboxData([baseline])).toBe(200);
  const state=iteratorHelperStates.get(retained)!;
  state.iterables=undefined;
  expect(measureSandboxData([retained])).toBeLessThan(measureSandboxData([baseline]));
});

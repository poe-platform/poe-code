import { expect, it } from "vitest";
import { run } from "../run.js";
import { Budget } from "../interp/budget.js";
import { invokeBuiltinClosure } from "../interp/builtin-call.js";
import { getSandboxPropertyDescriptor, getSandboxPrototype } from "../interp/object-model.js";
import { isSandboxClosure, measureSandboxData } from "../interp/values.js";
import { iteratorHelperStates } from "../interp/iterator-helper.js";
import { serialize } from "./serialize.js";
import { restore } from "./restore.js";
import { validateGuestHeapNode } from "./guest-heap-validation.js";

it.each([0,1,2,3])("restores longest zip after %s advances, including exhausted columns", async advances => {
  const source=`const helper=Iterator.zip([[1],[2,3]],{mode:'longest',padding:[9,8]});
    for(let i=0;i<${advances};i++)helper.next();return helper`;
  const result=await run(source);
  if (!result.ok) throw result.error;
  const snapshot=serialize({source,currentAstNodeId:1,
    scopeChain:[{id:"external",bindings:{helper:result.returnValue,alias:result.returnValue}}],
    callStack:[],pendingPromises:[],moduleBindings:{}});
  const budget=new Budget();
  const restored=restore(JSON.parse(JSON.stringify(snapshot)),{source,budget});
  const helper=restored.currentScope.lookup("helper").value;
  expect(helper).toBe(restored.currentScope.lookup("alias").value);
  const next=getSandboxPropertyDescriptor(helper,"next",budget)?.value;
  if (!isSandboxClosure(next)) throw new Error("Missing next method");
  for (const value of [[1,2],[9,3]].slice(advances))
    expect(await invokeBuiltinClosure(next,[],budget,undefined,helper)).toEqual({value,done:false});
  expect(await invokeBuiltinClosure(next,[],budget,undefined,helper)).toEqual({value:undefined,done:true});
});

it("restores keyed symbols and padding aliases", async () => {
  const source=`const key=Symbol('key');const padding={marker:1};
    const helper=Iterator.zipKeyed({[key]:[],other:[1,2]},{mode:'longest',padding:{[key]:padding}});
    helper.next();return {helper,key,padding}`;
  const result=await run(source);
  if (!result.ok) throw result.error;
  const snapshot=serialize({source,currentAstNodeId:1,
    scopeChain:[{id:"external",bindings:{result:result.returnValue}}],callStack:[],pendingPromises:[],moduleBindings:{}});
  const budget=new Budget();
  const restored=restore(JSON.parse(JSON.stringify(snapshot)),{source,budget});
  const output=restored.currentScope.lookup("result").value as {helper:object;key:symbol;padding:object};
  const next=getSandboxPropertyDescriptor(output.helper,"next",budget)?.value;
  if (!isSandboxClosure(next)) throw new Error("Missing next method");
  const row=await invokeBuiltinClosure(next,[],budget,undefined,output.helper) as {value:Record<symbol,unknown>};
  expect(row.value[output.key]).toBe(output.padding);
});

it("validates joint state and rejects incompatible or malformed fields", () => {
  const valid={kind:"iterator-helper",method:"zip",status:"start",callback:{kind:"undefined"},remaining:0,index:0,
    joint:{mode:"longest",cursors:[],padding:[],arrayPrototype:{kind:"ref",id:1}},state:{properties:{properties:[],extensible:true}}};
  const heap={1:{kind:"guest-array"}};
  expect(()=>validateGuestHeapNode(valid,heap)).not.toThrow();
  for (const patch of [
    {joint:undefined},{status:"done"},{method:"concat"},{remaining:1},{index:1},
    {joint:{...valid.joint,mode:"invalid"}},
    {joint:{...valid.joint,cursors:[null]}},
    {joint:{...valid.joint,mode:"shortest",cursors:[null]}},
    {joint:{...valid.joint,keys:[]}},
    {joint:{...valid.joint,arrayPrototype:{kind:"undefined"}}}
  ]) expect(()=>validateGuestHeapNode({...valid,...patch},heap)).toThrow(TypeError);
});

it("restores zip's originating Array prototype and its alias", async () => {
  const source=`Array.prototype.marker=17;return {helper:Iterator.zip([[1],[2]]),prototype:Array.prototype}`;
  const result=await run(source);
  if (!result.ok) throw result.error;
  const snapshot=serialize({source,currentAstNodeId:1,
    scopeChain:[{id:"external",bindings:{result:result.returnValue}}],callStack:[],pendingPromises:[],moduleBindings:{}});
  const budget=new Budget();
  const restored=restore(JSON.parse(JSON.stringify(snapshot)),{source,budget});
  const output=restored.currentScope.lookup("result").value as {helper:object;prototype:object};
  const next=getSandboxPropertyDescriptor(output.helper,"next",budget)?.value;
  if (!isSandboxClosure(next)) throw new Error("Missing next method");
  const step=await invokeBuiltinClosure(next,[],budget,undefined,output.helper);
  const row=getSandboxPropertyDescriptor(step,"value",budget)?.value;
  expect(getSandboxPrototype(row,budget)).toBe(output.prototype);
  expect(getSandboxPropertyDescriptor(row,"marker",budget)?.value).toBe(17);
});

it("charges retained padding and releases completed joint state", () => {
  const small={},large={};
  for (const [helper,payload] of [[small,""],[large,"x".repeat(200)]] as const)
    iteratorHelperStates.set(helper,{method:"zip",status:"start",callback:undefined,remaining:0,index:0,
      joint:{mode:"longest",cursors:[{iterator:{},next:undefined}],padding:[{payload}]}});
  expect(measureSandboxData([large])-measureSandboxData([small])).toBe(200);
  iteratorHelperStates.get(large)!.joint=undefined;
  expect(measureSandboxData([large])).toBeLessThan(measureSandboxData([small]));
});

it("rejects duplicate well-known symbol keys represented by different heap IDs", () => {
  const ref=(id:number)=>({kind:"ref",id});
  const node={kind:"iterator-helper",method:"zipKeyed",status:"start",callback:{kind:"undefined"},remaining:0,index:0,
    joint:{mode:"shortest",cursors:[{iterator:ref(3),next:{kind:"undefined"}},{iterator:ref(3),next:{kind:"undefined"}}],
      padding:[],keys:[ref(1),ref(2)]},state:{properties:{properties:[],extensible:true}}};
  const heap={1:{kind:"symbol",wellKnown:"iterator"},2:{kind:"symbol",wellKnown:"iterator"},3:{kind:"guest-object"}};
  expect(()=>validateGuestHeapNode(node,heap)).toThrow(TypeError);
});

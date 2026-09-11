import {expect,it,vi} from "vitest";
import {createDynamicExecutionBuiltin,type DynamicExecutionRequest} from "./builtin-dynamic-execution.js";
import {RuntimeValues,type RuntimeValue} from "./runtime-values.js";
import {constructRuntimeDictionary} from "./runtime-dictionary-update.js";
import {ExecutionBudget,ExecutionLimitError} from "./execution-budget.js";

function fixture(name:"eval"|"exec"){
  const meter=new ExecutionBudget({maxSteps:1000000,maxAllocatedBytes:1000000}),v=new RuntimeValues(meter),requests:DynamicExecutionRequest[]=[];
  const keywords=constructRuntimeDictionary([],new Map(),v,{hash:()=>1n,equal:(a,b)=>a===b},meter);
  const execute=vi.fn((request:DynamicExecutionRequest)=>{requests.push(request);return v.notImplemented;});
  const builtin=createDynamicExecutionBuiltin(name,v,meter,{execute});
  const call=(args:readonly RuntimeValue[]=[v.string("1")])=>builtin.value.invoke(args,keywords,meter);
  return{v,meter,keywords,requests,execute,call};
}
it.each(["eval","exec"] as const)("binds %s defaults and preserves source identity",name=>{
  const state=fixture(name),source=state.v.cell({});
  expect(state.call([source])).toBe(name==="eval"?state.v.notImplemented:state.v.none);
  expect(state.requests).toEqual([{mode:name,source,globals:state.v.none,locals:state.v.none,closure:state.v.none}]);
});
it.each(["eval","exec"] as const)("accepts %s namespace keywords without touching the namespace objects",name=>{
  const state=fixture(name),globals=state.v.cell({}),locals=state.v.cell({});
  state.keywords.items.set(state.v.string("globals"),globals);state.keywords.items.set(state.v.string("locals"),locals);
  state.call();expect(state.requests[0]).toMatchObject({globals,locals});
});
it("passes exec closure unchanged to the explicit backend",()=>{
  const state=fixture("exec"),closure=state.v.tuple([state.v.cell({})]);state.keywords.items.set(state.v.string("closure"),closure);
  state.call();expect(state.requests[0].closure).toBe(closure);
});
it.each(["eval","exec"] as const)("requires positional source for %s",name=>{
  const state=fixture(name);state.keywords.items.set(state.v.string("source"),state.v.string("1"));
  expect(()=>state.call([])).toThrow(`${name}() takes at least 1 positional argument (0 given)`);expect(state.execute).not.toHaveBeenCalled();
  expect(()=>state.call()).toThrow(`${name}() got an unexpected keyword argument 'source'`);
});
it.each(["eval","exec"] as const)("reports %s duplicate namespaces",name=>{
  const state=fixture(name);state.keywords.items.set(state.v.string("globals"),state.v.none);
  expect(()=>state.call([state.v.string("1"),state.v.none])).toThrow(`argument for ${name}() given by name ('globals') and position (2)`);
});
it.each(["eval","exec"] as const)("suggests misspelled %s namespace keywords",name=>{
  const state=fixture(name);state.keywords.items.set(state.v.string("glboals"),state.v.none);
  expect(()=>state.call()).toThrow(`Did you mean 'globals'?`);expect(state.execute).not.toHaveBeenCalled();
});
it("does not accept closure for eval",()=>{
  const state=fixture("eval");state.keywords.items.set(state.v.string("closure"),state.v.none);
  expect(()=>state.call()).toThrow("eval() got an unexpected keyword argument 'closure'");
});
it.each(["eval","exec"] as const)("validates %s count before keyword contents",name=>{
  const state=fixture(name),max=name==="eval"?3:4;
  for(let i=0;i<max+1;i++)state.keywords.items.set(state.v.string(String(i)),state.v.none);
  expect(()=>state.call([])).toThrow(`${name}() takes at most ${max} keyword arguments (${max+1} given)`);
});
it("rejects non-string keyword keys",()=>{
  const state=fixture("exec");state.keywords.items.set(state.v.integer(1),state.v.none);
  expect(()=>state.call()).toThrow("keywords must be strings");
});
it.each(["eval","exec"] as const)("keeps cancellation fatal when the %s backend throws",name=>{
  const state=fixture(name),controller=new AbortController(),meter=new ExecutionBudget({maxSteps:10000,maxAllocatedBytes:100000,signal:controller.signal});
  const builtin=createDynamicExecutionBuiltin(name,state.v,meter,{execute(){controller.abort();throw Error("backend failed");}});
  expect(()=>builtin.value.invoke([state.v.string("1")],state.keywords,meter)).toThrow(ExecutionLimitError);
});

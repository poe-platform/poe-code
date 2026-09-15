import {expect,it,vi} from "vitest";
import {createNamespaceBuiltin} from "./builtin-namespace.js";
import {RuntimeValues,type RuntimeValue} from "./runtime-values.js";
import {ExecutionBudget,ExecutionLimitError} from "./execution-budget.js";
import {OrderedKeyMap} from "./ordered-key-map.js";

it.each(["locals","globals"] as const)("binds %s before reading the current namespace",name=>{
  const meter=new ExecutionBudget({maxSteps:10000,maxAllocatedBytes:100000}),v=new RuntimeValues(meter);
  const keywords=v.dictionary(new OrderedKeyMap<RuntimeValue,RuntimeValue>({hash:()=>1n,equal:(a,b)=>a===b},meter)),read=vi.fn(()=>v.none);
  const builtin=createNamespaceBuiltin(name,v,meter,read);
  expect(()=>builtin.value.invoke([v.none],keywords,meter)).toThrow(`${name}() takes no arguments (1 given)`);
  keywords.items.set(v.string("x"),v.none);
  expect(()=>builtin.value.invoke([v.none],keywords,meter)).toThrow(`${name}() takes no keyword arguments`);
  expect(read).not.toHaveBeenCalled();keywords.items.clear();
  expect(builtin.value.invoke([],keywords,meter)).toBe(v.none);expect(read).toHaveBeenCalledTimes(1);
});
it.each([false,true])("preserves cancellation after namespace policy (throws=%s)",throws=>{
  const controller=new AbortController(),meter=new ExecutionBudget({maxSteps:10000,maxAllocatedBytes:100000,signal:controller.signal}),v=new RuntimeValues(meter);
  const keywords=v.dictionary(new OrderedKeyMap<RuntimeValue,RuntimeValue>({hash:()=>1n,equal:(a,b)=>a===b},meter));
  const builtin=createNamespaceBuiltin("locals",v,meter,()=>{controller.abort();if(throws)throw Error("policy failed");return v.none;});
  expect(()=>builtin.value.invoke([],keywords,meter)).toThrow(ExecutionLimitError);
});

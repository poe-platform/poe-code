import {expect,it,vi} from "vitest";
import {prepareDynamicNamespaces} from "./dynamic-namespaces.js";
import {RuntimeValues,type RuntimeValue} from "./runtime-values.js";
import {ExecutionBudget,ExecutionLimitError} from "./execution-budget.js";
import {constructRuntimeDictionary} from "./runtime-dictionary-update.js";

function fixture(){
  const meter=new ExecutionBudget({maxSteps:100000,maxAllocatedBytes:1000000}),v=new RuntimeValues(meter);
  const dictionary=()=>constructRuntimeDictionary([],new Map(),v,{hash:()=>1n,equal:(a,b)=>a.kind==="str"&&b.kind==="str"?a.value.compare(b.value,meter)===0:a===b},meter);
  const globals=dictionary(),locals=dictionary(),builtins=dictionary(),events:string[]=[];
  const context={globals:vi.fn(()=>{events.push("globals");return globals;}),locals:vi.fn(()=>{events.push("locals");return locals;}),builtins:vi.fn(()=>{events.push("builtins");return builtins;}),isMapping(value:RuntimeValue){events.push("mapping");return value.kind==="dict"||value.kind==="list"||value.kind==="str";},typeName:(value:RuntimeValue)=>value.kind};
  return{v,meter,dictionary,globals,locals,builtins,context,events};
}
it.each(["eval","exec"] as const)("selects caller defaults for %s and inserts original builtins",mode=>{
  const s=fixture(),result=prepareDynamicNamespaces({mode,globals:s.v.none,locals:s.v.none},s.v,s.meter,s.context);
  expect(result).toEqual({globals:s.globals,locals:s.locals,builtins:s.builtins});
  expect(s.globals.items.lookup(s.v.string("__builtins__"))?.value).toBe(s.builtins);
});
it.each(["eval","exec"] as const)("uses explicit %s globals as default locals without reading frame defaults",mode=>{
  const s=fixture(),globals=s.dictionary();
  expect(prepareDynamicNamespaces({mode,globals,locals:s.v.none},s.v,s.meter,s.context)).toEqual({globals,locals:globals,builtins:s.builtins});
  expect(s.context.globals).not.toHaveBeenCalled();expect(s.context.locals).not.toHaveBeenCalled();
});
it.each(["eval","exec"] as const)("retains existing %s builtins even when None",mode=>{
  const s=fixture();s.globals.items.set(s.v.string("__builtins__"),s.v.none);
  expect(prepareDynamicNamespaces({mode,globals:s.globals,locals:s.v.none},s.v,s.meter,s.context).builtins).toBe(s.v.none);
  expect(s.context.builtins).not.toHaveBeenCalled();
});
it("validates eval locals before globals and before reading the frame",()=>{
  const s=fixture();expect(()=>prepareDynamicNamespaces({mode:"eval",globals:s.v.integer(1),locals:s.v.integer(2)},s.v,s.meter,s.context)).toThrow("locals must be a mapping");
  expect(s.context.globals).not.toHaveBeenCalled();expect(s.context.builtins).not.toHaveBeenCalled();
});
it("validates exec globals before locals",()=>{
  const s=fixture();expect(()=>prepareDynamicNamespaces({mode:"exec",globals:s.v.integer(1),locals:s.v.integer(2)},s.v,s.meter,s.context)).toThrow("exec() globals must be a dict, not int");
  expect(s.events).toEqual([]);
});
it("distinguishes eval mapping globals from other non-dictionaries",()=>{
  const s=fixture();
  expect(()=>prepareDynamicNamespaces({mode:"eval",globals:s.v.list([]),locals:s.v.none},s.v,s.meter,s.context)).toThrow("globals must be a real dict; try eval(expr, {}, mapping)");
  expect(()=>prepareDynamicNamespaces({mode:"eval",globals:s.v.integer(1),locals:s.v.none},s.v,s.meter,s.context)).toThrow("globals must be a dict");
});
it.each(["eval","exec"] as const)("does not insert builtins after invalid %s locals",mode=>{
  const s=fixture();expect(()=>prepareDynamicNamespaces({mode,globals:s.globals,locals:s.v.integer(1)},s.v,s.meter,s.context)).toThrow("locals must be a mapping");
  expect(s.globals.items.size).toBe(0);
});
it.each(["eval","exec"] as const)("supports subscriptable %s locals without copying them",mode=>{
  const s=fixture(),locals=s.v.list([]);
  expect(prepareDynamicNamespaces({mode,globals:s.globals,locals},s.v,s.meter,s.context).locals).toBe(locals);
});
it.each(["eval","exec"] as const)("rejects absent %s frame defaults",mode=>{
  const s=fixture();expect(()=>prepareDynamicNamespaces({mode,globals:s.v.none,locals:s.v.none},s.v,s.meter,{...s.context,globals:()=>undefined})).toThrow(mode==="eval"?"eval must be given globals and locals when called without a frame":"globals and locals cannot be NULL");
});
it("observes cancellation before builtins insertion",()=>{
  const s=fixture(),controller=new AbortController(),meter=new ExecutionBudget({maxSteps:10000,maxAllocatedBytes:100000,signal:controller.signal});
  expect(()=>prepareDynamicNamespaces({mode:"exec",globals:s.globals,locals:s.globals},s.v,meter,{...s.context,builtins(){controller.abort();return s.builtins;}})).toThrow(ExecutionLimitError);
  expect(s.globals.items.size).toBe(0);
});

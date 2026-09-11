import {expect,it} from "vitest";
import {createSingletonNewBuiltin} from "./builtin-singleton-new.js";
import {ExecutionBudget,ExecutionLimitError} from "./execution-budget.js";
import {OrderedKeyMap} from "./ordered-key-map.js";
import {RuntimeTypeRegistry} from "./runtime-type-registry.js";
import {RuntimeValues} from "./runtime-values.js";

it.each(["none","not-implemented","ellipsis"] as const)("keeps cancellation fatal when %s diagnostic type lookup throws",kind=>{
  const controller=new AbortController(),meter=new ExecutionBudget({maxSteps:100000,maxAllocatedBytes:1000000,signal:controller.signal}),v=new RuntimeValues(meter);
  const keys={hash:()=>1n,equal:(a:unknown,b:unknown)=>a===b},registry=new RuntimeTypeRegistry(v,keys,meter);
  const owner=kind==="none"?registry.noneType():registry.sentinelType(kind),singleton=kind==="none"?v.none:kind==="ellipsis"?v.ellipsis:v.notImplemented;
  const builtin=createSingletonNewBuiltin(owner,singleton,v,meter),keywords=v.dictionary(new OrderedKeyMap(keys,meter)),receiver=v.cell({});
  expect(()=>builtin.value.invoke([receiver],keywords,meter,{call(){throw Error("unexpected call");},typeName(){controller.abort();throw Error("type lookup failed");}})).toThrow(ExecutionLimitError);
});

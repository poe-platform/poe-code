import {expect,it} from "vitest";
import {ExecutionBudget,ExecutionLimitError} from "./execution-budget.js";
import {RuntimeCodecRegistry} from "./runtime-codec-registry.js";
import {RuntimeValues,type BuiltinInvocationContext} from "./runtime-values.js";

it.each(["", "strict", "é", "\ud800", "\0"])("observes cancellation before converting error policy %j",name=>{
  const controller=new AbortController();
  const meter=new ExecutionBudget({maxSteps:100000,maxAllocatedBytes:1000000,signal:controller.signal});
  const values=new RuntimeValues(meter),registry=new RuntimeCodecRegistry(values,meter);
  const source=values.string(name);
  let calls=0;
  const context:BuiltinInvocationContext={call:()=>{calls++;return values.none;},isStopIteration:()=>false};
  controller.abort();
  let fatal:unknown;
  try {meter.checkpoint();}catch(error){fatal=error;}
  expect(fatal).toBeInstanceOf(ExecutionLimitError);
  let caught:unknown;
  try {registry.unicodeErrorPolicy(source,context);}catch(error){caught=error;}
  expect(caught).toBe(fatal);
  expect(calls).toBe(0);
});

import {expect,it} from "vitest";
import {PythonRuntimeError} from "./error.js";
import {ExecutionBudget,ExecutionLimitError} from "./execution-budget.js";
import {RuntimeExceptionExecution,RuntimeRaisedException} from "./runtime-exception-execution.js";
import {runtimeExceptionPayload} from "./runtime-exception-state.js";
import {RuntimeTypeRegistry} from "./runtime-type-registry.js";
import {RuntimeValues,type BuiltinInvocationContext,type RuntimeValue} from "./runtime-values.js";

const cases=(["format","attach"] as const).flatMap(boundary=>
  (["return","ordinary failure","guest failure","fatal"] as const).flatMap(outcome=>
    [false,true].map(cancel=>({boundary,outcome,cancel}))));

it.each(cases)("codec note $boundary: $outcome, cancellation=$cancel",({boundary,outcome,cancel})=>{
  const controller=new AbortController();
  const meter=new ExecutionBudget({maxSteps:100000,maxAllocatedBytes:1000000,signal:controller.signal});
  const values=new RuntimeValues(meter);
  const types=new RuntimeTypeRegistry(values,{hash:()=>0n,equal:(a:RuntimeValue,b:RuntimeValue)=>a===b},meter);
  const exceptions=new RuntimeExceptionExecution(types,values,meter);
  const original=exceptions.prepare(new PythonRuntimeError("ValueError","codec failed")) as RuntimeRaisedException;
  const guest=exceptions.prepare(new PythonRuntimeError("TypeError","note failed")) as RuntimeRaisedException;
  const ordinary=new Error("note service failed"),fatal=new ExecutionLimitError("allocation");
  const events:string[]=[];
  const boundaryResult=()=>{
    if(cancel)controller.abort();
    if(outcome==="ordinary failure")throw ordinary;
    if(outcome==="guest failure")throw guest;
    if(outcome==="fatal")throw fatal;
  };
  const context:BuiltinInvocationContext={call(_method,args){
    events.push("attach");
    expect(args[0]).toBe(original.value);
    expect(args[1]).toEqual(values.string("codec note"));
    if(boundary==="attach")boundaryResult();
    return values.none;
  }};
  const run=()=>exceptions.addNote(original,()=>{
    events.push("format");
    if(boundary==="format")boundaryResult();
    return "codec note";
  },context);
  let result:unknown,caught:unknown;
  try{result=run();}catch(error){caught=error;}
  expect(events).toEqual(boundary==="attach"||!cancel&&outcome==="return"?["format","attach"]:["format"]);
  if(outcome==="fatal")expect(caught).toBe(fatal);
  else if(cancel)expect(caught).toMatchObject({reason:"cancelled"});
  else if(outcome==="ordinary failure")expect(caught).toBe(ordinary);
  else if(outcome==="guest failure"){
    expect(caught).toBe(guest);
    expect(runtimeExceptionPayload(guest.value)!.context).toBe(original.value);
  }else{
    expect(caught).toBeUndefined();
    expect(result).toBe(original);
  }
  if(cancel)expect(runtimeExceptionPayload(guest.value)!.context).toBeNull();
  if(cancel&&outcome!=="fatal"){
    const count=events.length;
    let repeated:unknown;
    try{run();}catch(error){repeated=error;}
    expect(repeated).toBe(caught);
    expect(events).toHaveLength(count);
  }
});

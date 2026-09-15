import {expect,it} from "vitest";
import {CodePointString} from "./code-point-string.js";
import {PythonRuntimeError} from "./error.js";
import {ExecutionBudget,ExecutionLimitError} from "./execution-budget.js";
import {RuntimeCharmap} from "./runtime-charmap.js";
import {RuntimeExceptionExecution} from "./runtime-exception-execution.js";
import {RuntimeTypeRegistry} from "./runtime-type-registry.js";
import {RuntimeValues,type BuiltinInvocationContext,type RuntimeValue} from "./runtime-values.js";

const cases=(["encode","decode"] as const).flatMap(operation=>
  (["lookup error","other error","ordinary failure","fatal"] as const).flatMap(outcome=>
    [false,true].map(cancel=>({operation,outcome,cancel}))));

it.each(cases)("charmap $operation classification: $outcome, cancellation=$cancel",({operation,outcome,cancel})=>{
  const controller=new AbortController();
  const meter=new ExecutionBudget({maxSteps:100000,maxAllocatedBytes:1000000,signal:controller.signal});
  const values=new RuntimeValues(meter);
  const types=new RuntimeTypeRegistry(values,{hash:()=>0n,equal:(a:RuntimeValue,b:RuntimeValue)=>a===b},meter);
  const exceptions=new RuntimeExceptionExecution(types,values,meter);
  const mapping=values.cell({}),text=CodePointString.fromString("A",meter);
  const replacement=CodePointString.fromString("?",meter),input=Uint8Array.of(65);
  const original=exceptions.prepare(new PythonRuntimeError(outcome==="other error"?"ValueError":"KeyError","mapping failed"));
  const failure=new Error("classification failed"),fatal=new ExecutionLimitError("allocation");
  let lookups=0,classifications=0,recoveries=0;
  const context:BuiltinInvocationContext={
    lookupSpecial:()=>mapping,
    call(){lookups++;throw original;},
    isException(error,name){
      classifications++;
      const matches=exceptions.matches(error,name);
      if(cancel)controller.abort();
      if(outcome==="ordinary failure")throw failure;
      if(outcome==="fatal")throw fatal;
      return matches;
    }
  };
  const codec=new RuntimeCharmap(values,meter);
  const run=()=>operation==="encode"
    ?codec.encode(text,mapping,()=>{recoveries++;return {replacement:Uint8Array.of(63),position:1};},context)
    :codec.decode(input,mapping,()=>{recoveries++;return {replacement,position:1,input};},context);
  let result:ReturnType<typeof run>|undefined,caught:unknown;
  try{result=run();}catch(error){caught=error;}
  expect({lookups,classifications,recoveries}).toEqual({lookups:1,classifications:1,recoveries:!cancel&&outcome==="lookup error"?1:0});
  if(outcome==="fatal")expect(caught).toBe(fatal);
  else if(cancel)expect(caught).toMatchObject({reason:"cancelled"});
  else if(outcome==="ordinary failure")expect(caught).toBe(failure);
  else if(outcome==="other error")expect(caught).toBe(original);
  else{
    expect(caught).toBeUndefined();
    expect(result instanceof Uint8Array?[...result]:[...result!.text]).toEqual([63]);
    if(!(result instanceof Uint8Array))expect(result!.consumed).toBe(1);
  }
  if(cancel){
    expect(run).toThrow(ExecutionLimitError);
    expect({lookups,classifications,recoveries}).toEqual({lookups:1,classifications:1,recoveries:0});
  }
});

it.each([false,true])("charmap replacement rejection observes classification cancellation=%s",cancel=>{
  const controller=new AbortController();
  const meter=new ExecutionBudget({maxSteps:100000,maxAllocatedBytes:1000000,signal:controller.signal});
  const values=new RuntimeValues(meter),mapping=values.cell({});
  const input=CodePointString.fromString("A",meter),replacement=CodePointString.fromString("?",meter);
  const missing=new PythonRuntimeError("KeyError","missing replacement");
  const rejected=new Error("replacement rejected");
  let lookups=0,classifications=0,recoveries=0,rejections=0;
  const context:BuiltinInvocationContext={
    lookupSpecial:()=>mapping,
    call(){if(++lookups===1)return values.none;throw missing;},
    isException(error,name){
      classifications++;
      expect(error).toBe(missing);expect(name).toBe("LookupError");
      if(cancel)controller.abort();
      return true;
    }
  };
  let caught:unknown;
  try{
    new RuntimeCharmap(values,meter).encode(input,mapping,()=>{
      recoveries++;
      return {replacement,position:1,rejectReplacement(){rejections++;throw rejected;}};
    },context);
  }catch(error){caught=error;}
  expect({lookups,classifications,recoveries,rejections}).toEqual({lookups:2,classifications:1,recoveries:1,rejections:cancel?0:1});
  if(cancel)expect(caught).toMatchObject({reason:"cancelled"});
  else expect(caught).toBe(rejected);
});

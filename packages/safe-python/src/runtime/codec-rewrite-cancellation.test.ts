import {expect,it} from "vitest";
import {PythonDecodeError} from "./decode-error.js";
import {PythonRuntimeError} from "./error.js";
import {ExecutionBudget,ExecutionLimitError} from "./execution-budget.js";
import {RuntimeExceptionExecution,RuntimeRaisedException} from "./runtime-exception-execution.js";
import {runtimeExceptionPayload} from "./runtime-exception-state.js";
import {RuntimeTypeRegistry} from "./runtime-type-registry.js";
import {RuntimeValues,type BuiltinInvocationContext,type RuntimeValue} from "./runtime-values.js";

const stages=["start","end","reason","constructor"] as const;
const cases=stages.flatMap(stage=>(["return","ordinary","guest","fatal"] as const).flatMap(outcome=>
  [false,true].map(cancel=>({stage,outcome,cancel}))));

it.each(cases)("codec error rewriting at $stage: $outcome, cancellation=$cancel",({stage,outcome,cancel})=>{
  const controller=new AbortController();
  const meter=new ExecutionBudget({maxSteps:100000,maxAllocatedBytes:1000000,signal:controller.signal});
  const values=new RuntimeValues(meter);
  const types=new RuntimeTypeRegistry(values,{hash:()=>0n,equal:(a:RuntimeValue,b:RuntimeValue)=>a===b},meter);
  const exceptions=new RuntimeExceptionExecution(types,values,meter);
  const source=values.bytes(Uint8Array.of(255));
  const original=exceptions.prepare(new PythonDecodeError("ascii",Uint8Array.of(255),0,1,"original"));
  const replacement=exceptions.prepare(new PythonDecodeError("custom",Uint8Array.of(255),0,1,"original"));
  const guest=exceptions.prepare(new PythonRuntimeError("ValueError","descriptor failed"));
  if(!(original instanceof RuntimeRaisedException)||!(replacement instanceof RuntimeRaisedException))throw Error("expected guest exceptions");
  const ordinary=new Error("service failed"),fatal=new ExecutionLimitError("allocation");
  const fields=new Map<string,RuntimeValue>([["start",values.integer(0)],["end",values.integer(1)],["reason",values.string("original")]]);
  const events:string[]=[];
  const boundary=(name:string,result:RuntimeValue)=>{
    events.push(name);
    expect(exceptions.active).toBe(original.value);
    if(name===stage){
      if(cancel)controller.abort();
      if(outcome==="ordinary")throw ordinary;
      if(outcome==="guest")throw guest;
      if(outcome==="fatal")throw fatal;
    }
    return result;
  };
  const invocation:BuiltinInvocationContext={
    attribute:(value,name)=>{
      expect(value).toBe(original.value);
      return boundary(name,fields.get(name)!);
    },
    call:(type,args)=>{
      expect(type).toBe(types.exceptionType("UnicodeDecodeError"));
      expect(args).toEqual([values.string("custom"),source,...fields.values()]);
      return boundary("constructor",replacement.value);
    }
  };
  let caught:unknown;
  try{exceptions.rewriteDecodeError(original,"custom",source,invocation);}catch(error){caught=error;}
  expect(events).toEqual(cancel||outcome!=="return"?stages.slice(0,stages.indexOf(stage)+1):stages);
  expect(exceptions.active).toBeNull();
  if(outcome==="fatal")expect(caught).toBe(fatal);
  else if(cancel)expect(caught).toMatchObject({reason:"cancelled"});
  else if(outcome==="ordinary")expect(caught).toBe(ordinary);
  else if(outcome==="guest")expect(caught).toBe(guest);
  else{
    expect(caught).toBeInstanceOf(RuntimeRaisedException);
    expect((caught as RuntimeRaisedException).value).toBe(replacement.value);
    const state=runtimeExceptionPayload(replacement.value)!;
    expect(state.context).toBe(original.value);
    expect(state.cause).toBeNull();
    expect(state.suppressContext).toBe(true);
  }
});

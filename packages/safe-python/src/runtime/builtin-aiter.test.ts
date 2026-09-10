import {expect,it} from "vitest";
import {createAiterBuiltin} from "./builtin-aiter.js";
import {ExecutionBudget,ExecutionLimitError} from "./execution-budget.js";
import {OrderedKeyMap} from "./ordered-key-map.js";
import {RuntimeValues,type RuntimeValue} from "./runtime-values.js";

function fixture(){
  const meter=new ExecutionBudget({maxSteps:10000,maxAllocatedBytes:100000}),v=new RuntimeValues(meter);
  const keywords=v.dictionary(new OrderedKeyMap<RuntimeValue,RuntimeValue>({hash:()=>1n,equal:(a,b)=>a===b},meter)),events:string[]=[];
  const protocol={
    lookupSpecial(_value:RuntimeValue,name:string):RuntimeValue|undefined{events.push(name);return v.true;},
    hasSpecial(_value:RuntimeValue,name:string){events.push(`has:${name}`);return true;},
    call(_method:RuntimeValue,_args:readonly RuntimeValue[]):RuntimeValue{events.push("call");return v.false;},
    typeName:()=>"Custom"
  };
  const builtin=createAiterBuiltin(v,meter,protocol);
  return {v,meter,keywords,events,protocol,builtin,run:(args:RuntimeValue[]= [v.none])=>builtin.value.invoke(args,keywords,meter)};
}

it("returns the exact async iterator without awaiting it or calling next",()=>{
  const f=fixture();expect(f.run()).toBe(f.v.false);expect(f.events).toEqual(["__aiter__","call","has:__anext__"]);
});
it("reports absent and invalid async protocols distinctly",()=>{
  const f=fixture();f.protocol.lookupSpecial=()=>undefined;
  expect(()=>f.run()).toThrow("'Custom' object is not an async iterable");
  f.protocol.lookupSpecial=()=>f.v.none;f.protocol.hasSpecial=()=>false;
  expect(()=>f.run()).toThrow("aiter() returned not an async iterator of type 'Custom'");
});
it.each([false,true])("limits type diagnostics for invalid-result mode %s",invalid=>{
  const f=fixture();f.protocol.typeName=()=>"X".repeat(300);
  if(invalid)f.protocol.hasSpecial=()=>false;else f.protocol.lookupSpecial=()=>undefined;
  expect(()=>f.run()).toThrow(invalid?`aiter() returned not an async iterator of type '${"X".repeat(100)}'`:`'${"X".repeat(200)}' object is not an async iterable`);
});
it.each([0,2,3])("validates %s positional arguments before inspecting protocols",count=>{
  const f=fixture();expect(()=>f.run(Array(count).fill(f.v.none))).toThrow(`aiter() takes exactly one argument (${count} given)`);expect(f.events).toEqual([]);
});
it("rejects keywords before positional arity",()=>{
  const f=fixture();f.keywords.items.set(f.v.string("x"),f.v.none);
  expect(()=>f.run([])).toThrow("aiter() takes no keyword arguments");expect(f.events).toEqual([]);
});
it.each(["lookupSpecial","call","hasSpecial"] as const)("preserves failures from %s without fallback",name=>{
  const f=fixture(),failure=Error("protocol failure");f.protocol[name]=()=>{throw failure;};
  expect(()=>f.run()).toThrow(failure);
});
it.each(["lookupSpecial","call","hasSpecial","typeName"] as const)("checks cancellation after %s before publishing a result or diagnostic",name=>{
  const f=fixture();let cancelled=false;
  const meter={checkpoint(){if(cancelled)throw new ExecutionLimitError("cancelled");}};
  if(name==="typeName")f.protocol.hasSpecial=()=>false;
  const original=f.protocol[name];f.protocol[name]=((...args:never[])=>{cancelled=true;return Reflect.apply(original,f.protocol,args);}) as typeof original;
  expect(()=>f.builtin.value.invoke([f.v.none],f.keywords,meter)).toThrow(ExecutionLimitError);
});
it.each(["lookupSpecial","call","hasSpecial","typeName"] as const)("does not let a failing %s callback hide cancellation",name=>{
  const f=fixture();let cancelled=false;
  const meter={checkpoint(){if(cancelled)throw new ExecutionLimitError("cancelled");}};
  if(name==="typeName")f.protocol.hasSpecial=()=>false;
  f.protocol[name]=()=>{cancelled=true;throw Error("callback failed after cancelling");};
  expect(()=>f.builtin.value.invoke([f.v.none],f.keywords,meter)).toThrow(ExecutionLimitError);
});

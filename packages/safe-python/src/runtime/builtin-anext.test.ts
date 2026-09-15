import {expect,it} from "vitest";
import {createAnextBuiltin} from "./builtin-anext.js";
import {ExecutionBudget,ExecutionLimitError} from "./execution-budget.js";
import {OrderedKeyMap} from "./ordered-key-map.js";
import {RuntimeValues,type RuntimeValue} from "./runtime-values.js";

function fixture(){
  const meter=new ExecutionBudget({maxSteps:10000,maxAllocatedBytes:100000}),v=new RuntimeValues(meter);
  const keywords=v.dictionary(new OrderedKeyMap<RuntimeValue,RuntimeValue>({hash:()=>1n,equal:(a,b)=>a===b},meter)),events:string[]=[];
  const protocol={
    lookupSpecial(_value:RuntimeValue,name:string):RuntimeValue|undefined{events.push(name);return v.true;},
    call(_method:RuntimeValue,_args:readonly RuntimeValue[]):RuntimeValue{events.push("call");return v.false;},
    typeName:()=>"Custom",
    wrapAnext(value:RuntimeValue,fallback:RuntimeValue):RuntimeValue{events.push("wrap");return v.tuple([value,fallback]);}
  };
  const builtin=createAnextBuiltin(v,meter,protocol);
  return {v,meter,keywords,events,protocol,builtin,run:(args:RuntimeValue[]=[v.none])=>builtin.value.invoke(args,keywords,meter)};
}
it("returns the unvalidated result immediately without a default",()=>{
  const f=fixture();expect(f.run()).toBe(f.v.false);expect(f.events).toEqual(["__anext__","call"]);
});
it("wraps the raw result with the exact default",()=>{
  const f=fixture();expect(f.run([f.v.none,f.v.true])).toEqual(f.v.tuple([f.v.false,f.v.true]));expect(f.events).toEqual(["__anext__","call","wrap"]);
});
it("bounds missing-slot type diagnostics",()=>{
  const f=fixture();f.protocol.lookupSpecial=()=>undefined;f.protocol.typeName=()=>"X".repeat(300);
  expect(()=>f.run()).toThrow(`'${"X".repeat(200)}' object is not an async iterator`);
});
it.each([0,3,4])("rejects %s positional arguments before lookup",count=>{
  const f=fixture();expect(()=>f.run(Array(count).fill(f.v.none))).toThrow(count===0?"anext expected at least 1 argument, got 0":`anext expected at most 2 arguments, got ${count}`);expect(f.events).toEqual([]);
});
it("rejects keywords before checking arity",()=>{
  const f=fixture();f.keywords.items.set(f.v.string("default"),f.v.none);expect(()=>f.run([])).toThrow("anext() takes no keyword arguments");expect(f.events).toEqual([]);
});
it.each(["lookupSpecial","call","wrapAnext"] as const)("preserves failures from %s",name=>{
  const f=fixture(),failure=Error("callback failed");f.protocol[name]=()=>{throw failure;};expect(()=>f.run([f.v.none,f.v.true])).toThrow(failure);
});
it.each(["lookupSpecial","call","typeName","wrapAnext"] as const)("checks cancellation after successful %s",name=>{
  const f=fixture();let cancelled=false;const meter={checkpoint(){if(cancelled)throw new ExecutionLimitError("cancelled");}};
  if(name==="typeName")f.protocol.lookupSpecial=()=>undefined;
  const original=f.protocol[name];f.protocol[name]=((...args:never[])=>{cancelled=true;return Reflect.apply(original,f.protocol,args);}) as typeof original;
  expect(()=>f.builtin.value.invoke([f.v.none,f.v.true],f.keywords,meter)).toThrow(ExecutionLimitError);
});
it.each(["lookupSpecial","call","typeName","wrapAnext"] as const)("does not mask cancellation with a failing %s",name=>{
  const f=fixture();let cancelled=false;const meter={checkpoint(){if(cancelled)throw new ExecutionLimitError("cancelled");}};
  if(name==="typeName")f.protocol.lookupSpecial=()=>undefined;
  f.protocol[name]=()=>{cancelled=true;throw Error("callback failed");};
  expect(()=>f.builtin.value.invoke([f.v.none,f.v.true],f.keywords,meter)).toThrow(ExecutionLimitError);
});

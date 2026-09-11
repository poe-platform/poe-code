import {expect,it} from "vitest";
import {ExecutionBudget,ExecutionLimitError} from "./execution-budget.js";
import {PythonRuntimeError} from "./error.js";
import {RuntimeValues,type RuntimeValue,type BuiltinInvocationContext} from "./runtime-values.js";
import {substituteRuntimeTypeParameters} from "./runtime-type-substitution.js";

function fixture(){
  const meter=new ExecutionBudget({maxSteps:1000000,maxAllocatedBytes:10000000}),v=new RuntimeValues(meter),p=v.integer(101),q=v.integer(102),events:string[]=[];
  const subst=v.builtinFunction({name:"subst",invoke:positional=>positional[0]});
  const invocation:BuiltinInvocationContext={isStopIteration:()=>false,
    call(callee,positional){events.push("call");if(callee!==subst)throw Error("unexpected callee");return positional[0];},
    attribute(value,name){events.push(name);if((value===p||value===q)&&name==="__typing_subst__")return subst;throw new PythonRuntimeError("AttributeError",name);}
  };
  return {meter,v,p,q,events,subst,invocation};
}
it("substitutes repeated parameters by identity in argument order",()=>{
  const s=fixture(),result=substituteRuntimeTypeParameters(s.v.none,s.v.tuple([s.q,s.p,s.q]),s.v.tuple([s.p,s.q]),s.v.tuple([s.v.true,s.v.false]),s.v,s.meter,s.invocation);
  expect(result.items).toEqual([s.v.false,s.v.true,s.v.false]);
  expect(s.events.filter(name=>name==="call")).toHaveLength(3);
});
it("repeats preparation when descending into nested containers and preserves their shapes",()=>{
  const s=fixture(),prepare=s.v.integer(103);let prepared=0;
  const original=s.invocation.attribute!;s.invocation.attribute=(value,name)=>value===s.p&&name==="__typing_prepare_subst__"?prepare:original(value,name);
  s.invocation.call=(callee,positional)=>{if(callee===prepare){prepared++;return positional[1];}return positional[0];};
  const result=substituteRuntimeTypeParameters(s.v.none,s.v.tuple([s.v.list([s.p]),s.v.tuple([s.p])]),s.v.tuple([s.p]),s.v.true,s.v,s.meter,s.invocation);
  expect(prepared).toBe(3);expect(result.items[0].kind).toBe("list");expect(result.items[1]).toEqual(s.v.tuple([s.v.true]));
  expect(result.items[0].kind==="list"&&result.items[0].items.get(0n)).toBe(s.v.true);
});
it("unpacks finite tuple metadata before invoking parameter preparation",()=>{
  const s=fixture(),item=s.v.integer(104),original=s.invocation.attribute!;
  s.invocation.attribute=(value,name)=>value===item&&name==="__typing_unpacked_tuple_args__"?s.v.tuple([s.v.true,s.v.false]):original(value,name);
  expect(substituteRuntimeTypeParameters(s.v.none,s.v.tuple([s.p,s.q]),s.v.tuple([s.p,s.q]),item,s.v,s.meter,s.invocation).items).toEqual([s.v.true,s.v.false]);
});
it("expands tuple results for unpacked parameters",()=>{
  const s=fixture(),original=s.invocation.attribute!;
  s.invocation.attribute=(value,name)=>value===s.p&&name==="__typing_is_unpacked_typevartuple__"?s.v.true:original(value,name);
  s.invocation.call=()=>s.v.tuple([s.v.true,s.v.false]);
  expect(substituteRuntimeTypeParameters(s.v.none,s.v.tuple([s.p]),s.v.tuple([s.p]),s.v.none,s.v,s.meter,s.invocation).items).toEqual([s.v.true,s.v.false]);
});
it.each(["attribute","call","truth"] as const)("retains cancellation over failing substitution %s callbacks",operation=>{
  const s=fixture(),controller=new AbortController(),meter=new ExecutionBudget({maxSteps:10000,maxAllocatedBytes:100000,signal:controller.signal});
  const fail=():never=>{controller.abort();throw new PythonRuntimeError("ValueError","callback");};
  if(operation==="truth"){
    const original=s.invocation.attribute!;s.invocation.attribute=(value,name)=>name==="__typing_is_unpacked_typevartuple__"?s.v.true:original(value,name);
    s.invocation.truth=fail;
  }else s.invocation[operation]=fail;
  expect(()=>substituteRuntimeTypeParameters(s.v.none,s.v.tuple([s.p]),s.v.tuple([s.p]),s.v.none,s.v,meter,s.invocation)).toThrow(ExecutionLimitError);
});
it("bounds recursive container substitution without overflowing the host stack",()=>{
  const s=fixture();let args:RuntimeValue=s.v.tuple([s.p]);for(let index=0;index<10000;index++)args=s.v.tuple([args]);
  let result:RuntimeValue=substituteRuntimeTypeParameters(s.v.none,args,s.v.tuple([s.p]),s.v.true,s.v,s.meter,s.invocation);
  for(let index=0;index<10001;index++){if(result.kind!=="tuple")throw Error("missing nested tuple");result=result.items[0];}
  expect(result).toBe(s.v.true);
  const cycle=s.v.list([]);cycle.items.append(cycle);
  expect(()=>substituteRuntimeTypeParameters(s.v.none,cycle,s.v.tuple([s.p]),s.v.true,s.v,new ExecutionBudget({maxSteps:100,maxAllocatedBytes:10000}),s.invocation)).toThrow(ExecutionLimitError);
});

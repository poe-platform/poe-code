import {expect,it} from "vitest";
import {compileSourceProgram} from "./source-program-compilation.js";
import {createFunctionState} from "./function-state.js";
import {ExecutionBudget,ExecutionLimitError} from "./execution-budget.js";
import {RuntimeValues} from "./runtime-values.js";
import {replaceRuntimeFunctionCode} from "./runtime-function-code.js";

function fixture(){
  const meter=new ExecutionBudget({maxSteps:100000,maxAllocatedBytes:1000000}),v=new RuntimeValues(meter);
  const program=compileSourceProgram("def f():return 1\ndef g():yield 2",{stripDocstring:false,enterRecursiveCall:()=>()=>{}},v,meter);
  const [first,second]=program.functions.values();
  const fn=v.function(createFunctionState(first,new Map(),{globals:new Map(),builtins:new Map(),none:v.none},meter));
  return {meter,v,fn,first,second};
}
it("emits the kind-change warning before replacing code and preserves state if warning raises",()=>{
  const {meter,v,fn,first,second}=fixture(),seen:string[]=[];
  expect(()=>replaceRuntimeFunctionCode(fn,second,v,meter,undefined,(category,message)=>{seen.push(category,message);throw Error("warning rejected");})).toThrow("warning rejected");
  expect(seen).toEqual(["DeprecationWarning","Assigning a code object of non-matching type is deprecated (e.g., from a generator to a plain function)"]);
  expect(fn.value.code).toBe(first);expect(fn.value.closureObject).toBeUndefined();
});
it("preserves fatal cancellation from a throwing warning policy",()=>{
  const {v,fn,first,second}=fixture(),controller=new AbortController();
  const meter=new ExecutionBudget({maxSteps:10000,maxAllocatedBytes:100000,signal:controller.signal});
  expect(()=>replaceRuntimeFunctionCode(fn,second,v,meter,undefined,()=>{controller.abort();throw Error("warning failed");})).toThrow(ExecutionLimitError);
  expect(fn.value.code).toBe(first);
});
it("leaves executable code and closure binding unchanged when allocation fails",()=>{
  const {v,fn,first,second}=fixture(),closure=fn.value.closure;
  const meter=new ExecutionBudget({maxSteps:10000,maxAllocatedBytes:0});
  expect(()=>replaceRuntimeFunctionCode(fn,second,v,meter)).toThrow(ExecutionLimitError);
  expect(fn.value.code).toBe(first);expect(fn.value.closure).toBe(closure);
});

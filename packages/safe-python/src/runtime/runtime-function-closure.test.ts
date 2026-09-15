import {expect,it} from "vitest";
import {compileSourceProgram} from "./source-program-compilation.js";
import {createFunctionState} from "./function-state.js";
import {bindRuntimeCodeClosure} from "./runtime-closure-binding.js";
import {runtimeFunctionClosure} from "./runtime-function-closure.js";
import {RuntimeValues,type RuntimeValue} from "./runtime-values.js";
import {ExecutionBudget,ExecutionLimitError} from "./execution-budget.js";

function fixture(){
  const meter=new ExecutionBudget({maxSteps:100000,maxAllocatedBytes:2000000}),v=new RuntimeValues(meter);
  const program=compileSourceProgram("def outer(x):\n def f():return x\n return f",{stripDocstring:false,enterRecursiveCall:()=>()=>{}},v,meter),code=[...program.functions.values()].at(-1)!;
  const cell=v.cell({}),tuple=v.tuple([cell]),closure=bindRuntimeCodeClosure(code,tuple,meter);
  const fn=v.function(createFunctionState(code,new Map(),{globals:new Map(),builtins:new Map(),none:v.none,closure},meter));
  return {meter,v,fn,cell,tuple};
}
it("reflects the canonical guest cell without reading an empty cell",()=>{
  const {meter,v,fn,cell}=fixture(),result=runtimeFunctionClosure(fn,v,meter);
  if(result.kind!=="tuple")throw Error("expected tuple");
  expect(result.items[0]).toBe(cell);expect(runtimeFunctionClosure(fn,v,meter)).toBe(result);
});
it("preserves a supplied closure tuple identity",()=>{
  const {meter,v,fn,tuple}=fixture();fn.value.closureObject=tuple;
  expect(runtimeFunctionClosure(fn,v,meter)).toBe(tuple);
});
it("does not cache a partially published closure after resource failure",()=>{
  const {v,fn}=fixture(),limited=new ExecutionBudget({maxSteps:10000,maxAllocatedBytes:0});
  expect(()=>runtimeFunctionClosure(fn,v,limited)).toThrow(ExecutionLimitError);
  expect(fn.value.closureObject).toBeUndefined();
});
it("preserves cancellation from a failing capture lookup",()=>{
  const {v,fn}=fixture(),controller=new AbortController(),meter=new ExecutionBudget({maxSteps:10000,maxAllocatedBytes:100000,signal:controller.signal});
  const closure=fn.value.closure as Map<string,import("./lexical-frame.js").LexicalCell<RuntimeValue>>;
  closure.get=()=>{controller.abort();throw Error("capture failed");};
  expect(()=>runtimeFunctionClosure(fn,v,meter)).toThrow(ExecutionLimitError);expect(fn.value.closureObject).toBeUndefined();
});

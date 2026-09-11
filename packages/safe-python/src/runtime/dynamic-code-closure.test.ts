import {expect,it} from "vitest";
import {prepareDynamicCodeClosure} from "./dynamic-code-closure.js";
import {compileSourceProgram} from "./source-program-compilation.js";
import {RuntimeValues} from "./runtime-values.js";
import {ExecutionBudget,ExecutionLimitError} from "./execution-budget.js";

function fixture(){
  const meter=new ExecutionBudget({maxSteps:100000,maxAllocatedBytes:1000000}),v=new RuntimeValues(meter);
  const program=compileSourceProgram("def outer():\n x=1\n y=2\n def inner():return x,y\n return inner",{stripDocstring:false,enterRecursiveCall:()=>()=>{}},v,meter);
  const code=[...program.functions.values()].find(code=>code.scope.free.size===2)!;
  return {v,meter,program,code};
}
it("retains exact closure tuples and shared or empty cells without reading them",()=>{
  const {v,meter,code}=fixture(),cell=v.cell({}),closure=v.tuple([cell,cell]);
  expect(prepareDynamicCodeClosure({mode:"exec",closure},code,meter)).toBe(closure);
  expect(cell.value.content).toBeUndefined();
});
it("rejects every malformed closure with the code's exact required length",()=>{
  const {v,meter,code}=fixture(),cell=v.cell({});
  for(const closure of [v.none,v.tuple([]),v.tuple([cell]),v.tuple([cell,cell,cell]),v.tuple([cell,v.none]),v.list([cell,cell])]){
    expect(()=>prepareDynamicCodeClosure({mode:"exec",closure},code,meter)).toThrow("code object requires a closure of exactly length 2");
  }
});
it("forbids free variables in eval code",()=>{
  const {v,meter,code,program}=fixture();
  expect(()=>prepareDynamicCodeClosure({mode:"eval",closure:v.none},code,meter)).toThrow("code object passed to eval() may not contain free variables");
  expect(prepareDynamicCodeClosure({mode:"eval",closure:v.none},program.module,meter)).toBeUndefined();
});
it("distinguishes closure-free code from non-code source",()=>{
  const {v,meter,program}=fixture();
  for(const code of [undefined,program.module]){
    expect(prepareDynamicCodeClosure({mode:"exec",closure:v.none},code,meter)).toBeUndefined();
    expect(()=>prepareDynamicCodeClosure({mode:"exec",closure:v.tuple([])},code,meter)).toThrow(code===undefined?"closure can only be used when source is a code object":"cannot use a closure with this code object");
  }
});
it("does not turn cancellation into closure validation errors",()=>{
  const {v,code}=fixture(),controller=new AbortController();controller.abort();
  const meter=new ExecutionBudget({maxSteps:10000,maxAllocatedBytes:100000,signal:controller.signal});
  expect(()=>prepareDynamicCodeClosure({mode:"exec",closure:v.none},code,meter)).toThrow(ExecutionLimitError);
});

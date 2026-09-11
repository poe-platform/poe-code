import {expect,it,vi} from "vitest";
import {executeRuntimeFunctionCode} from "./runtime-code-execution.js";
import {compileSourceProgram} from "./source-program-compilation.js";
import {ExecutionBudget,ExecutionLimitError} from "./execution-budget.js";
import {RuntimeValues,type RuntimeValue} from "./runtime-values.js";

function fixture(){
  const controller=new AbortController(),meter=new ExecutionBudget({maxSteps:100000,maxAllocatedBytes:2000000,signal:controller.signal}),v=new RuntimeValues(meter);
  const program=compileSourceProgram("def f(x=1):return x\nclass C:pass",{stripDocstring:false,enterRecursiveCall:()=>()=>{}},v,meter),code=[...program.functions.values()][0];
  const context={globals:new Map<string,RuntimeValue>(),builtins:new Map<string,RuntimeValue>(),none:v.none};
  return {controller,meter,v,code,context,classCode:[...program.classFunctions.values()][0]};
}
it("creates a fresh zero-argument function without definition-time defaults",()=>{
  const {meter,v,code,context}=fixture(),call=vi.fn((callee:RuntimeValue,args:readonly RuntimeValue[])=>{
    if(callee.kind!=="function")throw Error("expected function");
    expect(callee.value.code).toBe(code);expect(callee.value.defaults.size).toBe(0);expect(args).toEqual([]);return v.true;
  });
  expect(executeRuntimeFunctionCode(code,undefined,context,v,meter,{call})).toBe(v.true);
  expect(executeRuntimeFunctionCode(code,undefined,context,v,meter,{call})).toBe(v.true);
  expect(call.mock.calls[0][0]).not.toBe(call.mock.calls[1][0]);
});
it.each([false,true])("keeps cancellation fatal after code invocation (throws=%s)",throws=>{
  const {controller,meter,v,code,context}=fixture();
  expect(()=>executeRuntimeFunctionCode(code,undefined,context,v,meter,{call(){controller.abort();if(throws)throw Error("invocation failed");return v.none;}})).toThrow(ExecutionLimitError);
});
it.each([false,true])("executes class code in the original locals and publishes its optional cell (cell=%s)",withCell=>{
  const {meter,v,classCode,context}=fixture(),locals=v.none,cell=v.cell({}),call=vi.fn(()=>{throw Error("ordinary calls must not replace class locals");});
  const result=executeRuntimeFunctionCode(classCode,undefined,context,v,meter,{call,executeClassBody(fn,namespace){
    expect(namespace).toBe(locals);expect(fn.value.code).toBe(classCode);expect(fn.value.globals).toBe(context.globals);
    return withCell?cell.value:undefined;
  }},locals);
  expect(result).toBe(withCell?cell:v.none);expect(call).not.toHaveBeenCalled();
});
it.each([false,true])("keeps cancellation fatal after class-code execution (throws=%s)",throws=>{
  const {controller,meter,v,classCode,context}=fixture();
  expect(()=>executeRuntimeFunctionCode(classCode,undefined,context,v,meter,{call:()=>v.none,executeClassBody(){controller.abort();if(throws)throw Error("class failed");return undefined;}},v.none)).toThrow(ExecutionLimitError);
});

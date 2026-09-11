import {expect,it,vi} from "vitest";
import {compileSourceProgram,PythonSyntaxError} from "../index.js";
import {ExecutionBudget,ExecutionLimitError} from "./execution-budget.js";

const constants={string:(value:string):unknown=>value,integer:(value:number):unknown=>value,tuple:(values:readonly unknown[]):unknown=>values};
const options={stripDocstring:false,enterRecursiveCall:()=>()=>{}};
const budget=()=>new ExecutionBudget({maxSteps:1000000,maxAllocatedBytes:2000000});

it("compiles source into identity-linked nested code without executing it",()=>{
  const program=compileSourceProgram('"doc"\ndef outer(x):\n class C:\n  def method(self): return x\n return C\nmissing()', {...options,filename:"../🐍.py"},constants,budget());
  expect(program.module.docstring).toEqual({value:"doc"});
  expect([...program.functions.values()].map(code=>code.qualifiedName)).toEqual(["outer","outer.<locals>.C.method"]);
  for(const code of program.functions.values())expect(code.source).toBe(program.module.source);
  expect(program.module.source?.filename).toBe("../🐍.py");
});
it.each(["x=", "return 1", "def f(): nonlocal missing"])("preserves source diagnostics: %s",source=>{
  expect(()=>compileSourceProgram(source,{...options,filename:"input.py"},constants,budget())).toThrow(PythonSyntaxError);
  try{compileSourceProgram(source,{...options,filename:"input.py"},constants,budget());}catch(error){expect(error).toMatchObject({filename:"input.py",sourceLine:expect.any(String)});}
});
it("charges source analysis before allocating guest constants",()=>{
  const string=vi.fn(constants.string);
  expect(()=>compileSourceProgram("x="+"1+".repeat(100)+"1",options,{...constants,string},new ExecutionBudget({maxSteps:50,maxAllocatedBytes:1000000}))).toThrow(ExecutionLimitError);
  expect(string).not.toHaveBeenCalled();
});
it("uses the same cumulative meter for analysis and code preparation",()=>{
  const meter=budget(),charges:number[]=[];
  compileSourceProgram("pass",options,{...constants,string(value){charges.push(meter.usage.allocatedBytes);return value;}},meter);
  expect(charges[0]).toBeGreaterThan(448);
  expect(meter.usage.allocatedBytes).toBeGreaterThan(charges[0]);
});
it("forwards lexical callbacks once",()=>{
  const onComment=vi.fn(),onWarning=vi.fn();
  compileSourceProgram("match='\\q' # comment",{...options,onComment,onWarning},constants,budget());
  expect(onComment).toHaveBeenCalledTimes(1);expect(onWarning).toHaveBeenCalledTimes(1);
});
it("restores the shared recursion guard after a rejected entry",()=>{
  let depth=0;const failure=new Error("recursion policy");
  const enterRecursiveCall=()=>{if(depth===3)throw failure;depth++;return ()=>{depth--;};};
  expect(()=>compileSourceProgram("x="+"-".repeat(20)+"1",{...options,enterRecursiveCall},constants,budget())).toThrow(failure);
  expect(depth).toBe(0);
});
it("preserves cancellation from a throwing constant adapter",()=>{
  const controller=new AbortController(),meter=new ExecutionBudget({maxSteps:100000,maxAllocatedBytes:1000000,signal:controller.signal});
  expect(()=>compileSourceProgram("pass",options,{...constants,string(){controller.abort();throw new Error("constant failure");}},meter)).toThrow(ExecutionLimitError);
});
it("ignores type expressions and strips docstrings throughout nested code",()=>{
  const program=compileSourceProgram('"doc"\ntype Alias[T: missing()] = absent()\ndef f[T](x: nonexistent()) -> missing():\n "function doc"\n return x',{...options,stripDocstring:true},constants,budget());
  expect(program.module.docstring).toBeUndefined();
  expect([...program.functions.values()][0].docstring).toBeUndefined();
  expect([...program.module.scope.bindings.keys()]).toEqual(["f"]);
});

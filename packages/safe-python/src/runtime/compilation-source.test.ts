import {expect,it} from "vitest";
import {analyzeModule} from "../analysis.js";
import {ExecutionBudget,ExecutionLimitError} from "./execution-budget.js";
import {createCompilationSource} from "./compilation-source.js";
import {compileFunction} from "./function-compilation.js";
import {compileClassBody} from "./class-compilation.js";

const budget=()=>new ExecutionBudget({maxSteps:10000,maxAllocatedBytes:100000});
const constants={string:(value:string):unknown=>value,integer:(value:number):unknown=>value,tuple:(values:readonly unknown[]):unknown=>values};

it.each(["","<string>","../folder/🐍.py","/not/a/real/path.py","name\nwith\nlines.py"])("preserves the literal filename %j",filename=>{
  const source=createCompilationSource(filename,constants,budget());
  expect(source.filename).toBe(filename);expect(Object.isFrozen(source)).toBe(true);
});

it("distinguishes an undefined filename constant from absent source metadata",()=>{
  const source=createCompilationSource("source.py",{string:()=>undefined},budget());
  expect(source).toEqual({filename:undefined});expect(Object.hasOwn(source,"filename")).toBe(true);
});

it.each([false,true])("checks cancellation after filename allocation (throws=%s)",throws=>{
  const controller=new AbortController(),meter=new ExecutionBudget({signal:controller.signal,maxSteps:100,maxAllocatedBytes:1000});
  expect(()=>createCompilationSource("file.py",{string(){controller.abort();if(throws)throw Error("allocation failure");return "file.py";}},meter)).toThrow(ExecutionLimitError);
});

it("preserves ordinary filename allocation failures",()=>{
  const failure=Error("allocation failure");
  expect(()=>createCompilationSource("file.py",{string(){throw failure;}},budget())).toThrow(failure);
});

it.each(["function","class"])("retains explicit and default source identities in standalone %s compilation",kind=>{
  const analysis=analyzeModule(kind==="function"?"def f():pass":"class C:pass"),scope=analysis.scopes.children[0];
  for(const filename of [undefined,"standalone.py",""]){
    const options={stripDocstring:false,filename};
    const code=kind==="function"?compileFunction(scope,analysis,options,constants,budget()):compileClassBody(scope,analysis,options,constants,budget());
    expect(code.source?.filename).toBe(filename??"<string>");
  }
});

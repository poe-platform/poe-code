import {expect,it,vi} from "vitest";
import {compileSourceProgram} from "../index.js";
import {analyzeModule} from "../analysis.js";
import {compileFunction} from "./function-compilation.js";
import {compileClassBody} from "./class-compilation.js";
import {RuntimeValues,type RuntimeValue} from "./runtime-values.js";
import {ExecutionBudget} from "./execution-budget.js";

const budget=()=>new ExecutionBudget({maxSteps:1000000,maxAllocatedBytes:10000000});
const options={stripDocstring:false,enterRecursiveCall:()=>()=>{}};

it("retains original guest filename identity across the complete code graph",()=>{
  const meter=budget(),values=new RuntimeValues(meter),name=values.stringPoints(new Uint32Array([0xd800,0xdc00]));
  const program=compileSourceProgram<RuntimeValue>("def f():return lambda:1\nclass C:pass\nx=(x for x in xs)",{...options,filename:{displayName:"\ud800\udc00",value:name}},values,meter);
  for(const code of [program.module,...program.functions.values(),...program.classes.values(),...program.generatorExpressions!.values()])expect(code.source?.filename).toBe(name);
  expect(Array.from(name.value)).toEqual([0xd800,0xdc00]);
});
it("uses display text for syntax diagnostics instead of converting the guest constant",()=>{
  const meter=budget(),values=new RuntimeValues(meter),filename={displayName:"shown.py",value:values.string("guest.py")};
  try{compileSourceProgram("x=",{...options,filename},values,meter);throw Error("expected syntax failure");}catch(error){expect(error).toMatchObject({name:"SyntaxError",filename:"shown.py"});}
});
it("snapshots the filename record before lexer callbacks mutate it",()=>{
  const meter=budget(),values=new RuntimeValues(meter),original=values.string("original"),filename={displayName:"original",value:original};
  const program=compileSourceProgram("# change\npass",{...options,filename,onComment(){filename.value=values.string("changed");filename.displayName="changed";}},values,meter);
  expect(program.module.source?.filename).toBe(original);
});
it("preserves an explicit undefined filename constant without reallocating it",()=>{
  const string=vi.fn((value:string):unknown=>value);
  const program=compileSourceProgram("pass",{...options,filename:{displayName:"x",value:undefined}},{string,integer:value=>value,tuple:values=>values},budget());
  expect(program.module.source).toEqual({filename:undefined});expect(string).not.toHaveBeenCalled();
});
it.each(["function","class"])("supports retained filenames in standalone %s compilation",kind=>{
  const meter=budget(),values=new RuntimeValues(meter),name=values.string("filename"),analysis=analyzeModule(kind==="function"?"def f():pass":"class C:pass");
  const settings={stripDocstring:false,filename:{displayName:"shown",value:name}};
  const code=kind==="function"?compileFunction(analysis.scopes.children[0],analysis,settings,values,meter):compileClassBody(analysis.scopes.children[0],analysis,settings,values,meter);
  expect(code.source?.filename).toBe(name);
});

import {expect,it} from "vitest";
import {bindRuntimeCodeClosure} from "./runtime-closure-binding.js";
import {compileSourceProgram} from "./source-program-compilation.js";
import {ExecutionBudget} from "./execution-budget.js";
import {RuntimeValues} from "./runtime-values.js";
import {LexicalFrame} from "./lexical-frame.js";
import {ClassFrame} from "./class-frame.js";
import {mutateRuntimeCell} from "./runtime-cell.js";

function fixture(){
  const meter=new ExecutionBudget({maxSteps:100000,maxAllocatedBytes:2000000}),v=new RuntimeValues(meter);
  const program=compileSourceProgram("def outer():\n z=1\n a=2\n def inner():\n  nonlocal z,a\n  return z,a\n class C:\n  nonlocal a\n  a=3\n return inner",{stripDocstring:false,enterRecursiveCall:()=>()=>{}},v,meter);
  const code=[...program.functions.values()].find(code=>code.scope.free.size===2)!;
  return {meter,v,program,code};
}
it("binds compiler-ordered names without copying or reassigning guest cell owners",()=>{
  const {meter,v,code}=fixture(),a=v.cell({content:{value:v.integer(2)}}),z=v.cell({content:{value:v.integer(1)}});
  const closure=bindRuntimeCodeClosure(code,v.tuple([a,z]),meter),frame=new LexicalFrame(code.scope,{globals:new Map(),builtins:new Map(),closure},meter);
  expect(frame.load("a")).toEqual(v.integer(2));expect(frame.load("z")).toEqual(v.integer(1));
  frame.store("a",v.true);expect(a.value.content?.value).toBe(v.true);
  z.value.content={value:v.false};expect(frame.load("z")).toBe(v.false);
  expect("owner" in a.value).toBe(false);
  const other=bindRuntimeCodeClosure(code,v.tuple([a,a]),meter);
  other.get("a")!.content={value:v.none};expect(other.get("z")!.content?.value).toBe(v.none);
});
it.each(["function","class","cell"] as const)("propagates %s deletion through bound cells",kind=>{
  const {meter,v,code,program}=fixture(),cell=v.cell({content:{value:v.true}});
  if(kind==="class"){
    const body=[...program.classes.values()][0],closure=bindRuntimeCodeClosure(body,v.tuple([cell]),meter);
    const frame=new ClassFrame(body.scope,{globals:new Map(),builtins:new Map(),closure,locals:{lookup:()=>undefined,store(){},delete:()=>false,isGuest:()=>false}},meter);
    frame.delete("a");
  }else{
    const closure=bindRuntimeCodeClosure(code,v.tuple([cell,cell]),meter);
    if(kind==="function")new LexicalFrame(code.scope,{globals:new Map(),builtins:new Map(),closure},meter).delete("a");
    else mutateRuntimeCell(v.cell(closure.get("a")!),{kind:"delete"},meter);
  }
  expect(cell.value.content).toBeUndefined();
});
it("rejects unvalidated closure shapes at the host binding boundary",()=>{
  const {meter,v,code}=fixture();
  for(const closure of [undefined,v.tuple([]),v.tuple([v.none,v.none])])expect(()=>bindRuntimeCodeClosure(code,closure,meter)).toThrow("closure binding requires validated cells");
});

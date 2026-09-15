import {expect,it} from "vitest";
import {analyzeModule} from "../analysis.js";
import {PythonRuntimeError} from "./error.js";
import {ExecutionBudget,ExecutionLimitError} from "./execution-budget.js";
import {ModuleFrame} from "./module-frame.js";
import {RuntimeExceptionExecution} from "./runtime-exception-execution.js";
import {executeRuntimeImportStatement} from "./runtime-import-statement.js";
import {RuntimeTypeRegistry} from "./runtime-type-registry.js";
import {RuntimeValues,type BuiltinInvocationContext,type RuntimeValue} from "./runtime-values.js";

const cases=["from codecs import lookup","import encodings.utf_8 as codec","from codecs import *"].flatMap(source=>
  (["return","ordinary","guest","fatal"] as const).flatMap(outcome=>[false,true].map(cancel=>({source,outcome,cancel}))));

it.each(cases)("codec import attribute boundary: $source / $outcome / cancellation=$cancel",({source,outcome,cancel})=>{
  const controller=new AbortController();
  const meter=new ExecutionBudget({maxSteps:100000,maxAllocatedBytes:1000000,signal:controller.signal});
  const values=new RuntimeValues(meter);
  const types=new RuntimeTypeRegistry(values,{hash:()=>0n,equal:(a:RuntimeValue,b:RuntimeValue)=>a===b},meter);
  const exceptions=new RuntimeExceptionExecution(types,values,meter);
  const guest=exceptions.prepare(new PythonRuntimeError("ValueError","attribute failed"));
  const ordinary=new Error("attribute service failed"),fatal=new ExecutionLimitError("allocation");
  const analysis=analyzeModule(source),statement=analysis.module.body[0];
  if(statement.kind!=="import"&&statement.kind!=="import-from")throw Error("expected import syntax");
  const globals=Object.assign(new Map<string,RuntimeValue>(),{object:values.cell({})});
  const importer=values.cell({}),module=values.cell({}),result=values.tuple([]);
  const frame=new ModuleFrame(analysis.scopes,{globals,builtins:new Map([["__import__",importer]])},meter);
  const events:string[]=[];
  const context:BuiltinInvocationContext={
    call(fn){expect(fn).toBe(importer);events.push("import");return module;},
    attribute(object,name){
      expect(object).toBe(module);events.push(name);
      if(cancel)controller.abort();
      if(outcome==="ordinary")throw ordinary;
      if(outcome==="guest")throw guest;
      if(outcome==="fatal")throw fatal;
      return result;
    },
    isException(error,name){events.push("classify");return exceptions.matches(error,name);}
  };
  const run=()=>executeRuntimeImportStatement(statement,frame,values,context,meter);
  let caught:unknown;
  try{run();}catch(error){caught=error;}
  const attribute=source.includes("*")?"__all__":source.startsWith("from")?"lookup":"utf_8";
  expect(events).toEqual(["import",attribute,...(!cancel&&(outcome==="ordinary"||outcome==="guest")?["classify"]:[])]);
  if(outcome==="fatal")expect(caught).toBe(fatal);
  else if(cancel)expect(caught).toMatchObject({reason:"cancelled"});
  else if(outcome==="ordinary")expect(caught).toBe(ordinary);
  else if(outcome==="guest")expect(caught).toBe(guest);
  else{
    expect(caught).toBeUndefined();
    if(!source.includes("*"))expect(globals.get(source.startsWith("from")?"lookup":"codec")).toBe(result);
  }
  if(cancel){
    const prior=[...events];
    expect(run).toThrow(ExecutionLimitError);
    expect(events).toEqual(prior);
    expect(globals.size).toBe(0);
  }
});

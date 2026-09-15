import {expect,it} from "vitest";
import {PythonDecodeError} from "./decode-error.js";
import {ExecutionBudget,ExecutionLimitError} from "./execution-budget.js";
import {RuntimeCodecRegistry} from "./runtime-codec-registry.js";
import {RuntimeExceptionExecution} from "./runtime-exception-execution.js";
import {RuntimeTypeRegistry} from "./runtime-type-registry.js";
import {unicodeTextCodecs} from "./runtime-unicode-text-codecs.js";
import {RuntimeValues,type BuiltinInvocationContext,type RuntimeValue} from "./runtime-values.js";

const cases=(["match","nonmatch","ordinary failure","guest failure","fatal"] as const)
  .flatMap(outcome=>[false,true].map(cancel=>({outcome,cancel})));

it.each(cases)("Punycode prefix classification: $outcome, cancellation=$cancel",({outcome,cancel})=>{
  const controller=new AbortController();
  const meter=new ExecutionBudget({maxSteps:100000,maxAllocatedBytes:1000000,signal:controller.signal});
  const values=new RuntimeValues(meter),registry=new RuntimeCodecRegistry(values,meter);
  const types=new RuntimeTypeRegistry(values,{hash:()=>0n,equal:(a:RuntimeValue,b:RuntimeValue)=>a===b},meter);
  const exceptions=new RuntimeExceptionExecution(types,values,meter);
  const original=exceptions.prepare(new PythonDecodeError("ascii",Uint8Array.of(255),0,1,"ordinal not in range(128)"));
  const guest=exceptions.prepare(new PythonDecodeError("ascii",Uint8Array.of(254),0,1,"classification failure"));
  const ordinary=new Error("classification failure"),fatal=new ExecutionLimitError("allocation");
  let classifications=0,rewrites=0,caught:unknown;
  const invocation:BuiltinInvocationContext={
    codecs:registry,
    call(){throw original;},
    prepareException:(error,retained)=>exceptions.prepare(error,retained),
    isException(error,name){
      expect(error).toBe(original);
      expect(name).toBe("UnicodeDecodeError");
      classifications++;
      if(cancel)controller.abort();
      if(outcome==="ordinary failure")throw ordinary;
      if(outcome==="guest failure")throw guest;
      if(outcome==="fatal")throw fatal;
      return outcome==="match";
    },
    rewriteDecodeError(error,encoding,source){
      rewrites++;
      expect(error).toBe(original);
      expect(encoding).toBe("ascii");
      expect(source.kind).toBe("bytes");
      // Retain the original failure so this boundary test does not depend on
      // the separately tested descriptor/constructor rewrite protocol.
      throw original;
    },
  };
  const codec=unicodeTextCodecs.find(codec=>codec.name==="punycode")!;
  const run=()=>codec.decode(Uint8Array.of(255,45,97),"strict",meter,invocation);
  try{run();}catch(error){caught=error;}
  expect(classifications).toBe(1);
  expect(rewrites).toBe(!cancel&&outcome==="match"?1:0);
  if(outcome==="fatal")expect(caught).toBe(fatal);
  else if(cancel)expect(caught).toMatchObject({reason:"cancelled"});
  else expect(caught).toBe(outcome==="ordinary failure"?ordinary:outcome==="guest failure"?guest:original);
  if(cancel){
    expect(run).toThrow(ExecutionLimitError);
    expect(classifications).toBe(1);
  }
});

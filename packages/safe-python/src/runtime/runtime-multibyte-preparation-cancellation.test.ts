import {expect,it} from "vitest";
import {PythonDecodeError} from "./decode-error.js";
import {PythonEncodeError} from "./encode-error.js";
import {ExecutionBudget,ExecutionLimitError} from "./execution-budget.js";
import {RuntimeCodecRegistry} from "./runtime-codec-registry.js";
import {RuntimeExceptionExecution,RuntimeRaisedException} from "./runtime-exception-execution.js";
import {RuntimeMultibyteRecovery} from "./runtime-multibyte-recovery.js";
import {RuntimeTypeRegistry} from "./runtime-type-registry.js";
import {RuntimeValues,type BuiltinInvocationContext,type RuntimeValue} from "./runtime-values.js";

it.each(["encode","decode"] as const)("multibyte %s stops at cancelled exception preparation",operation=>{
  for(const policy of ["strict","custom"]){
    for(const outcome of ["return","ordinary failure","fatal"]){
      for(const cancel of [false,true]){
        const controller=new AbortController();
        const meter=new ExecutionBudget({maxSteps:100000,maxAllocatedBytes:1000000,signal:controller.signal});
        const values=new RuntimeValues(meter),registry=new RuntimeCodecRegistry(values,meter);
        const types=new RuntimeTypeRegistry(values,{hash:()=>0n,equal:(a:RuntimeValue,b:RuntimeValue)=>a===b},meter);
        const exceptions=new RuntimeExceptionExecution(types,values,meter);
        const text=values.string("\ud800"),bytes=values.bytes(Uint8Array.of(255));
        const source=operation==="encode"?text:bytes;
        const fault=operation==="encode"
          ?new PythonEncodeError("gb2312",text.value,0,1,"illegal multibyte sequence")
          :new PythonDecodeError("gb2312",Uint8Array.of(255),0,1,"incomplete multibyte sequence");
        const result=values.tuple([values.string("?"),values.integer(1)]);
        const failure=new Error("preparation failed"),fatal=new ExecutionLimitError("allocation");
        let preparations=0,chains=0,handlers=0,encoders=0,prepared:unknown,caught:unknown;
        const context:BuiltinInvocationContext={
          isCallable:()=>true,
          call(){handlers++;return result;},
          prepareException(error,retained){
            preparations++;
            prepared=exceptions.prepare(error,retained);
            if(cancel)controller.abort();
            if(outcome==="ordinary failure")throw failure;
            if(outcome==="fatal")throw fatal;
            return prepared;
          },
          chainException(error){chains++;return exceptions.chain(error);}
        };
        registry.registerError("custom",values.cell({}),context);
        const recovery=new RuntimeMultibyteRecovery(registry,source,context);
        const run=()=>fault instanceof PythonEncodeError
          ?recovery.recover(fault,policy,()=>{encoders++;return Uint8Array.of(63);})
          :recovery.recover(fault,policy);
        let recovered:ReturnType<typeof run>|undefined;
        try{recovered=run();}catch(error){caught=error;}
        const proceeds=!cancel&&outcome==="return";
        expect({preparations,chains,handlers,encoders},`${policy}/${outcome}/cancel=${cancel}`).toEqual({
          preparations:1,chains:proceeds&&policy==="strict"?1:0,
          handlers:proceeds&&policy==="custom"?1:0,
          encoders:proceeds&&policy==="custom"&&operation==="encode"?1:0
        });
        if(outcome==="fatal")expect(caught).toBe(fatal);
        else if(cancel)expect(caught).toMatchObject({reason:"cancelled"});
        else if(outcome==="ordinary failure")expect(caught).toBe(failure);
        else if(policy==="strict"){
          expect(caught).toBeInstanceOf(RuntimeRaisedException);
          expect((caught as RuntimeRaisedException).value).toBe((prepared as RuntimeRaisedException).value);
        }else{
          expect(caught).toBeUndefined();
          expect(recovered?.position).toBe(1n);
          expect(operation==="encode"?recovered?.replacement:[...recovered!.replacement]).toEqual(operation==="encode"?Uint8Array.of(63):[63]);
        }
        if(cancel){
          expect(run).toThrow(ExecutionLimitError);
          expect(preparations).toBe(1);
          expect(chains+handlers+encoders).toBe(0);
        }
      }
    }
  }
});

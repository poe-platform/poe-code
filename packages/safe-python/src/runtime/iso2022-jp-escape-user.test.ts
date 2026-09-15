import {describe,expect,it} from "vitest";
import baseEvidence from "./__snapshots__/iso2022-jp-escape-user-oracle.json";
import {PythonDecodeError} from "./decode-error.js";
import {DoubleByteIncrementalDecoder} from "./double-byte-incremental-decoder.js";
import {ExecutionBudget} from "./execution-budget.js";
import {iso2022JpCodec as baseCodec} from "./iso2022-jp-codec.js";
import {analyzeModule} from "../analysis.js";
import {CallStack} from "./call-stack.js";
import {compileProgram} from "./program-compilation.js";
import {RuntimeCodecRegistry} from "./runtime-codec-registry.js";
import {RuntimeMultibyteRecovery} from "./runtime-multibyte-recovery.js";
import {RuntimeExceptionExecution,RuntimeRaisedException} from "./runtime-exception-execution.js";
import {runtimeExceptionPayload} from "./runtime-exception-state.js";
import {executeRuntimeProgram,type RuntimeProgramContext} from "./runtime-program.js";
import {RuntimeTypeRegistry} from "./runtime-type-registry.js";
import {RuntimeValues,type RuntimeValue} from "./runtime-values.js";
import {runtimeHash} from "./runtime-hash.js";
import {runtimeComparison} from "./runtime-comparison.js";
import {createRuntimeBuiltins} from "./runtime-builtins.js";
import variantEvidence from "./__snapshots__/iso2022-jp-1-escape-oracle.json";
import {iso2022Jp1Codec} from "./iso2022-jp-1-codec.js";

import extEvidence from "./__snapshots__/iso2022-jp-ext-escape-oracle.json";
import {iso2022JpExtCodec} from "./iso2022-jp-ext-codec.js";

import jp2Evidence from "./__snapshots__/iso2022-jp-2-escape-oracle.json";
import {iso2022Jp2Codec} from "./iso2022-jp-2-codec.js";

describe.each([{codec:iso2022Jp2Codec,evidence:jp2Evidence},{codec:iso2022JpExtCodec,evidence:extEvidence},{codec:baseCodec,evidence:baseEvidence},{codec:iso2022Jp1Codec,evidence:variantEvidence}])("$codec.name",({codec:iso2022JpCodec,evidence})=>{

// Runs the native incremental kernel with real per-interpreter recovery and
// compiled invocation/exception machinery. Injected audit entry points do not
// establish public ISO-2022-JP module compatibility.
it.each(Array.from({length:Math.ceil(evidence.rows.length/40)},(_,index)=>index))(
  "matches malformed Japanese escape continuation batch %i",batch=>{
    for(const row of evidence.rows.slice(batch*40,(batch+1)*40)){
      const meter=new ExecutionBudget({maxSteps:1000000,maxAllocatedBytes:8000000}),values=new RuntimeValues(meter);
      const calls=new CallStack<object>(80,meter),globals=new Map<string,RuntimeValue>();
      const hash={none:values.none,identity:values.identity.hash.bind(values.identity),string:()=>23n,bytes:()=>29n};
      const keys={hash:(key:RuntimeValue)=>runtimeHash(key,hash,meter),equal:(a:RuntimeValue,b:RuntimeValue)=>runtimeComparison("==",a,b,values,meter).value};
      const types=new RuntimeTypeRegistry(values,keys,meter),exceptions=new RuntimeExceptionExecution(types,values,meter),registry=new RuntimeCodecRegistry(values,meter);
      const unavailable=():never=>{throw Error("unavailable test capability");};
      const builtins=createRuntimeBuiltins(values,meter,{hash,identity:values.identity,buildClass:{registry:types,keys},print:{stdout:unavailable,lookupWrite:unavailable,flush:unavailable}});
      builtins.set("str",types.stringType());
      const text=(value:RuntimeValue)=>{if(value.kind!=="str")return unavailable();return [...value.value].map(point=>String.fromCodePoint(point)).join("");};
      const context:RuntimeProgramContext={values,calls,keys,globals,builtins,exceptions,objectType:types.object,hooks:{
        expressions:()=>({warn:unavailable}),statements:()=>({setAttribute:unavailable,deleteAttribute:unavailable,executeUnhandled:unavailable}),
        callable:()=>false,invoke:unavailable,name:()=>"function()",keywordName:text,
        specialMethods:()=>({slots:()=>undefined,typeOf:value=>types.nativeType(value)??unavailable()})
      }};
      let decoder=new DoubleByteIncrementalDecoder(iso2022JpCodec);
      builtins.set("audit",values.builtinFunction({name:"audit",invoke:(_args,_keywords,_meter,invocation)=>{
        for(const step of row.steps){
          let result:unknown;
          const source=values.bytes(Uint8Array.from(step.data));
          const recovery=new RuntimeMultibyteRecovery(registry,source,invocation!);
          decoder.errors=row.policy==="strict"||row.policy==="ignore"||row.policy==="replace"
            ?row.policy:error=>recovery.recover(error,row.policy);
          try{result=["ok",[...decoder.decode(Uint8Array.from(step.data),step.final,meter)]];}
          catch(error){
            if(error instanceof PythonDecodeError){
              result=["error",error.name,error.message,error.encoding,[...error.object],Number(error.start),Number(error.end),error.reason];
            }else if(error instanceof RuntimeRaisedException){
              const state=runtimeExceptionPayload(error.value)!;
              const member=(name:string)=>state.member(name,meter)!;
              const object=member("object"),start=member("start"),end=member("end");
              if(object.kind!=="bytes"||start.kind!=="int"||end.kind!=="int")throw error;
              result=["error",error.value.type.value.name,text(invocation!.call(builtins.get("str")!,[error.value])),text(member("encoding")),[...object.value.toUint8Array(meter)],Number(start.value),Number(end.value),text(member("reason"))];
            }else throw error;
          }
          expect(result,JSON.stringify({row,step})).toEqual(step.result);
          const state=decoder.getstate(meter);
          expect([[...state[0]],String(state[1])]).toEqual(step.state);
          decoder=new DoubleByteIncrementalDecoder(iso2022JpCodec);
          decoder.setstate(state,meter);
        }
        return values.none;
      }}));
      executeRuntimeProgram(compileProgram<RuntimeValue>(analyzeModule("audit()"),{stripDocstring:false},values,meter),context,meter);
    }
  }
);

});

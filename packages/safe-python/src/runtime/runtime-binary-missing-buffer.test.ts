import {expect,it} from "vitest";
import {createRuntimeBase64Functions} from "./runtime-base64-functions.js";
import {createRuntimeHexadecimalFunctions} from "./runtime-hexadecimal-functions.js";
import {createRuntimeQuotedPrintableFunctions} from "./runtime-quoted-printable-functions.js";
import {createRuntimeUuFunctions} from "./runtime-uu-functions.js";
import {ExecutionBudget,ExecutionLimitError} from "./execution-budget.js";
import {PythonRuntimeError} from "./error.js";
import {OrderedKeyMap} from "./ordered-key-map.js";
import {RuntimeValues,type BuiltinInvocationContext,type RuntimeValue} from "./runtime-values.js";

const bindings=[
  {name:"a2b_base64",create:createRuntimeBase64Functions},
  {name:"unhexlify",create:createRuntimeHexadecimalFunctions},
  {name:"a2b_hex",create:createRuntimeHexadecimalFunctions},
  {name:"a2b_qp",create:createRuntimeQuotedPrintableFunctions},
  {name:"a2b_uu",create:createRuntimeUuFunctions}
];

it.each(bindings.flatMap(binding=>(["return","ordinary","fatal","cancel"] as const).map(outcome=>({...binding,outcome}))))(
  "$name absent buffer diagnoses once and preserves $outcome diagnostic service outcome",({name,create,outcome})=>{
    const controller=new AbortController();
    const meter=new ExecutionBudget({maxSteps:10000,maxAllocatedBytes:100000,signal:controller.signal});
    const values=new RuntimeValues(meter),events:string[]=[];
    const keywords=values.dictionary(new OrderedKeyMap<RuntimeValue,RuntimeValue>({hash:()=>0n,equal:(a,b)=>a===b},meter));
    const fn=new Map(create(values,meter)).get(name)!;
    const failure=new PythonRuntimeError("ValueError","diagnostic failed"),fatal=new ExecutionLimitError("steps");
    const context:BuiltinInvocationContext={
      call(){throw Error("unexpected guest call");},
      isException(){events.push("classify");return true;},
      buffers:{
        acquireSimple(){events.push("acquire");return undefined;},
        typeName(){
          events.push("name");
          if(outcome==="ordinary")throw failure;
          if(outcome==="fatal")throw fatal;
          if(outcome==="cancel")controller.abort();
          return "NoneType";
        }
      }
    };
    const run=()=>fn.value.invoke([values.none],keywords,meter,context);
    let thrown:unknown;try{run();}catch(error){thrown=error;}
    expect(events).toEqual(["acquire","name"]);
    if(outcome==="ordinary")expect(thrown).toBe(failure);
    else if(outcome==="fatal")expect(thrown).toBe(fatal);
    else if(outcome==="cancel"){
      expect(thrown).toMatchObject({reason:"cancelled"});
      expect(run).toThrow(ExecutionLimitError);
      expect(events).toEqual(["acquire","name"]);
    }else expect(thrown).toMatchObject({name:"TypeError",message:"argument should be bytes, buffer or ASCII string, not 'NoneType'"});
  }
);

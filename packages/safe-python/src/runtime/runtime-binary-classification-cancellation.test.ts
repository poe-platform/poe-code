import {expect,it} from "vitest";
import {createRuntimeBase64Functions} from "./runtime-base64-functions.js";
import {createRuntimeHexadecimalFunctions} from "./runtime-hexadecimal-functions.js";
import {createRuntimeQuotedPrintableFunctions} from "./runtime-quoted-printable-functions.js";
import {createRuntimeUuFunctions} from "./runtime-uu-functions.js";
import {ExecutionBudget,ExecutionLimitError} from "./execution-budget.js";
import {PythonRuntimeError} from "./error.js";
import {OrderedKeyMap} from "./ordered-key-map.js";
import {RuntimeValues,type BuiltinInvocationContext,type RuntimeValue} from "./runtime-values.js";

const decoders=[
  {name:"a2b_base64",create:createRuntimeBase64Functions},
  {name:"unhexlify",create:createRuntimeHexadecimalFunctions},
  {name:"a2b_hex",create:createRuntimeHexadecimalFunctions},
  {name:"a2b_qp",create:createRuntimeQuotedPrintableFunctions},
  {name:"a2b_uu",create:createRuntimeUuFunctions}
];
const cases=decoders.flatMap(decoder=>[false,true].flatMap(cancel=>
  (["guest","host","ordinary-failure","fatal-failure"] as const).map(outcome=>({...decoder,cancel,outcome}))));

it.each(cases)("$name classification $outcome, cancellation=$cancel preserves the service boundary",({name,create,cancel,outcome})=>{
  const controller=new AbortController();
  const meter=new ExecutionBudget({maxSteps:10000,maxAllocatedBytes:100000,signal:controller.signal});
  const values=new RuntimeValues(meter);
  const keywords=values.dictionary(new OrderedKeyMap<RuntimeValue,RuntimeValue>({hash:()=>0n,equal:(a,b)=>a===b},meter));
  const fn=new Map(create(values,meter)).get(name)!;
  const acquisitionFailure=Error("export failed"),classificationFailure=Error("classification failed"),fatal=new ExecutionLimitError("steps");
  const events:string[]=[];
  const context:BuiltinInvocationContext={
    call(){throw Error("unexpected guest call");},
    isException(error,type){
      expect(error).toBe(acquisitionFailure);expect(type).toBe("BaseException");
      events.push("classify");
      if(cancel)controller.abort();
      if(outcome==="ordinary-failure")throw classificationFailure;
      if(outcome==="fatal-failure")throw fatal;
      return outcome==="guest";
    },
    buffers:{
      acquireSimple(){events.push("acquire");throw acquisitionFailure;},
      typeName(){events.push("name");return "Exporter";}
    }
  };
  const invoke=()=>fn.value.invoke([values.none],keywords,meter,context);
  let thrown:unknown;
  try{invoke();}catch(error){thrown=error;}
  if(outcome==="fatal-failure")expect(thrown).toBe(fatal);
  else if(cancel)expect(thrown).toMatchObject({name:"ExecutionLimitError",reason:"cancelled"});
  else if(outcome==="ordinary-failure")expect(thrown).toBe(classificationFailure);
  else if(outcome==="host")expect(thrown).toBe(acquisitionFailure);
  else{
    expect(thrown).toBeInstanceOf(PythonRuntimeError);
    expect(thrown).toMatchObject({name:"TypeError",message:"argument should be bytes, buffer or ASCII string, not 'Exporter'"});
  }
  expect(events).toEqual(["acquire","classify",...!cancel&&outcome==="guest"?["name"]:[]]);
  if(cancel){
    const before=[...events];
    expect(invoke).toThrow(ExecutionLimitError);
    expect(events).toEqual(before);
  }
});

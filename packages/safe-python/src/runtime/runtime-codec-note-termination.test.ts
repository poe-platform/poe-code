import {expect,it} from "vitest";
import {ExecutionBudget,ExecutionLimitError} from "./execution-budget.js";
import {createRuntimeTextDecoder} from "./runtime-text-decoding.js";
import {createRuntimeUtf8Decoder} from "./runtime-utf8-decoding.js";
import {createRuntimeUtf8Encoder} from "./runtime-utf8-encoding.js";
import {RuntimeValues,type BuiltinInvocationContext} from "./runtime-values.js";

it.each(["text decoder","UTF-8 decoder","encoder"] as const)("%s does not checkpoint after exception annotation terminates execution",operation=>{
  let terminal=false,notes=0,postTermination=0;
  const failure=new ExecutionLimitError("cancelled");
  const meter={checkpoint:()=>{
    if(terminal){postTermination++;throw new Error("checkpoint after termination");}
  }};
  const values=new RuntimeValues(meter);
  const bytes=values.bytes(new Uint8Array([255])).value,text=values.string("\ud800");
  const context:BuiltinInvocationContext={
    call:()=>{throw new Error("unexpected guest call");},
    addExceptionNote:()=>{notes++;terminal=true;throw failure;}
  };
  const run=()=>operation==="encoder"
    ?createRuntimeUtf8Encoder(values)(text,"u8","strict",meter,context)
    :operation==="text decoder"
      ?createRuntimeTextDecoder(values)(bytes,"646","strict",meter,context)
      :createRuntimeUtf8Decoder(values)(bytes,"u8","strict",meter,context);
  let caught:unknown;
  try{run();}catch(error){caught=error;}
  expect(caught).toBe(failure);
  expect(notes).toBe(1);
  expect(postTermination).toBe(0);
});

it.each(["text decoder","UTF-8 decoder","encoder"] as const)("%s observes real-budget cancellation during annotation return or failure",operation=>{
  for(const throws of [false,true]){
    const controller=new AbortController();
    const meter=new ExecutionBudget({maxSteps:100000,maxAllocatedBytes:1000000,signal:controller.signal});
    const values=new RuntimeValues(meter);
    const bytes=values.bytes(new Uint8Array([255])).value,text=values.string("\ud800");
    let notes=0;
    const context:BuiltinInvocationContext={
      call:()=>{throw new Error("unexpected guest call");},
      addExceptionNote:error=>{
        notes++;controller.abort();if(throws)throw error;return error;
      }
    };
    const run=()=>operation==="encoder"
      ?createRuntimeUtf8Encoder(values)(text,"u8","strict",meter,context)
      :operation==="text decoder"
        ?createRuntimeTextDecoder(values)(bytes,"646","strict",meter,context)
        :createRuntimeUtf8Decoder(values)(bytes,"u8","strict",meter,context);
    let caught:unknown;
    try{run();}catch(error){caught=error;}
    expect(caught).toBeInstanceOf(ExecutionLimitError);
    expect(caught).toMatchObject({reason:"cancelled"});
    expect(notes).toBe(1);
    let repeated:unknown;
    try{run();}catch(error){repeated=error;}
    expect(repeated).toBe(caught);
    expect(notes).toBe(1);
  }
});

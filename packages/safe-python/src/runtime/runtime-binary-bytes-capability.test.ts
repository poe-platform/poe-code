import { expect,it } from "vitest";
import { ExecutionBudget,ExecutionLimitError } from "./execution-budget.js";
import { runtimeBinary } from "./runtime-binary.js";
import { RuntimeValues } from "./runtime-values.js";

it("shares bytearray payloads with percent bytes and character fields",()=>{
  const meter=new ExecutionBudget({maxSteps:10000,maxAllocatedBytes:100000}),v=new RuntimeValues(meter),source=v.cell({}),payload=v.bytes(Uint8Array.of(65)).value;
  const bytes={
    byteString(){expect(this).toBe(bytes);return undefined;},
    byteArray(value:unknown){expect(this).toBe(bytes);return value===source?payload:undefined;},
    lookupBytes():never{throw Error("native bytearray must bypass conversion");},
    typeName(){return "bytearray";}
  };
  const invocation={bytes,call():never{throw Error("unexpected call");},isStopIteration(){return false;}};
  for(const code of [98,99,115])expect(runtimeBinary("%",v.bytes(Uint8Array.of(37,code)),source,v,meter,undefined,undefined,invocation)).toEqual(v.bytes(Uint8Array.of(65)));
});

it("uses the owning bytes capability for conversion before buffer copying",()=>{
  const meter=new ExecutionBudget({maxSteps:10000,maxAllocatedBytes:100000}),v=new RuntimeValues(meter),source=v.cell({}),converted=v.cell({}),buffer=v.cell({}),payload=v.bytes(Uint8Array.of(65)).value,events:string[]=[];
  const bytes={
    byteString(value:unknown){expect(this).toBe(bytes);return value===converted?payload:undefined;},
    lookupBytes(value:unknown){expect(this).toBe(bytes);events.push("lookup");return value===source?()=>{events.push("convert");return converted;}:undefined;},
    bufferBytes(value:unknown){expect(this).toBe(bytes);events.push("buffer");return value===buffer?payload:undefined;},
    typeName(){return "Data";}
  };
  const invocation={bytes,call():never{throw Error("unexpected call");},isStopIteration(){return false;}};
  for(const value of [source,buffer])expect(runtimeBinary("%",v.bytes(Uint8Array.of(37,98)),value,v,meter,undefined,undefined,invocation)).toEqual(v.bytes(Uint8Array.of(65)));
  expect(events).toEqual(["lookup","convert","lookup","buffer"]);
});

it("preserves buffer capability faults without treating buffers as single-byte characters",()=>{
  const meter=new ExecutionBudget({maxSteps:10000,maxAllocatedBytes:100000}),v=new RuntimeValues(meter),source=v.cell({});
  for(const fault of [Error("host failure"),new ExecutionLimitError("cancelled")]) {
    let reads=0;
    const bytes={byteString(){return undefined;},lookupBytes(){return undefined;},typeName(){return "Buffer";},bufferBytes():never{reads++;throw fault;}};
    const invocation={bytes,call():never{throw Error("unexpected call");},isStopIteration(){return false;}};
    expect(()=>runtimeBinary("%",v.bytes(Uint8Array.of(37,99)),source,v,meter,undefined,undefined,invocation)).toThrow("%c requires");expect(reads).toBe(0);
    try{runtimeBinary("%",v.bytes(Uint8Array.of(37,98)),source,v,meter,undefined,undefined,invocation);expect.unreachable();}catch(error){expect(error).toBe(fault);}
    expect(reads).toBe(1);
  }
});

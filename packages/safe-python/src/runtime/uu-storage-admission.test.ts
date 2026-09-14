import {expect,it} from "vitest";
import {ExecutionBudget,ExecutionLimitError,type ExecutionMeter} from "./execution-budget.js";
import {encodeUu,decodeUu} from "./uuencode.js";
import {BinasciiError} from "./binascii-error.js";
import {createRuntimeUuFunctions} from "./runtime-uu-functions.js";
import {RuntimeValues,type RuntimeValue} from "./runtime-values.js";
import {OrderedKeyMap} from "./ordered-key-map.js";

it.each([
  {name:"empty encoder",run:(meter:ExecutionMeter)=>encodeUu(new Uint8Array(),false,meter)},
  {name:"zero-length decoder",run:(meter:ExecutionMeter)=>decodeUu(Uint8Array.of(32),meter)},
  {name:"encoder",run:(meter:ExecutionMeter)=>encodeUu(Uint8Array.of(65),true,meter)},
  {name:"decoder",run:(meter:ExecutionMeter)=>decodeUu(Uint8Array.of(33),meter)}
])("admits $name array ownership before allocation",({run})=>{
  const meter=new ExecutionBudget({maxSteps:1000,maxAllocatedBytes:6});
  expect(()=>run(meter)).toThrow(ExecutionLimitError);
  expect(meter.usage.allocatedBytes).toBe(0);
  expect(()=>meter.checkpoint()).toThrow(ExecutionLimitError);
});

it("observes cancellation at zero-length decoded storage admission",()=>{
  const failure=new ExecutionLimitError("cancelled");
  const meter:ExecutionMeter={checkpoint(_steps,bytes=0){if(bytes>0)throw failure;}};
  expect(()=>decodeUu(Uint8Array.of(32),meter)).toThrow(failure);
});

it("preserves validation before output allocation",()=>{
  const charges:number[]=[];
  const meter:ExecutionMeter={checkpoint(_steps,bytes=0){if(bytes)charges.push(bytes);}};
  expect(()=>encodeUu(new Uint8Array(46),false,meter)).toThrow(new BinasciiError("At most 45 bytes at once"));
  expect(()=>decodeUu(new Uint8Array(),meter)).toThrow(new BinasciiError("Missing length byte"));
  // Only the two faults allocate; neither invalid call creates output storage.
  expect(charges).toEqual([256,256]);
});

it("admits the native decoder ASCII scratch array even for empty input",()=>{
  const setup=new ExecutionBudget({maxSteps:10000,maxAllocatedBytes:100000}),values=new RuntimeValues(setup);
  const keywords=values.dictionary(new OrderedKeyMap<RuntimeValue,RuntimeValue>({hash:()=>0n,equal:(a,b)=>a===b},setup));
  const functions=new Map(createRuntimeUuFunctions(values,setup));
  const meter=new ExecutionBudget({maxSteps:1000,maxAllocatedBytes:96});
  expect(()=>functions.get("a2b_uu")!.value.invoke([values.string("")],keywords,meter)).toThrow(ExecutionLimitError);
  expect(meter.usage.allocatedBytes).toBe(96);
});

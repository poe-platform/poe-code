import {expect,it,vi} from "vitest";
import {PythonRuntimeError} from "./error.js";
import {ExecutionBudget,ExecutionLimitError} from "./execution-budget.js";
import {ImmutableBytes} from "./immutable-bytes.js";
import type {RuntimeBufferContext} from "./runtime-buffer-context.js";
import {createRuntimeNativeBuffers} from "./runtime-native-buffers.js";
import {RuntimeValues} from "./runtime-values.js";

function fixture(){
  const controller=new AbortController();
  const meter=new ExecutionBudget({maxSteps:100000,maxAllocatedBytes:1000000,signal:controller.signal});
  const values=new RuntimeValues(meter),bytes=ImmutableBytes.copyOf([65,255],meter),view=values.cell({});
  return {controller,meter,bytes,view};
}

it("retains an explicit ownerless-view capability, its receiver and storage identity",()=>{
  const {meter,bytes,view}=fixture();
  const provider:RuntimeBufferContext={acquireSimple:vi.fn(()=>undefined),createReadOnlyView(input){
    expect(this).toBe(provider);
    expect(input).toBe(bytes);
    return view;
  }};
  const buffers=createRuntimeNativeBuffers(meter,provider);
  expect(buffers.createReadOnlyView).toBeTypeOf("function");
  expect(buffers.createReadOnlyView!(bytes)).toBe(view);
  expect(provider.acquireSimple).not.toHaveBeenCalled();
});

it("does not advertise an unavailable view provider",()=>{
  const {meter}=fixture();
  for(const provider of [undefined,{acquireSimple:()=>undefined}]){
    expect(createRuntimeNativeBuffers(meter,provider).createReadOnlyView).toBeUndefined();
  }
});

it.each(["return","throw"] as const)("observes cancellation after the view provider's %s",outcome=>{
  const {controller,meter,bytes,view}=fixture();
  const createReadOnlyView=vi.fn(()=>{
    controller.abort();
    if(outcome==="throw")throw new PythonRuntimeError("ValueError","provider failed");
    return view;
  });
  const buffers=createRuntimeNativeBuffers(meter,{acquireSimple:()=>undefined,createReadOnlyView});
  let caught:unknown;
  try{buffers.createReadOnlyView!(bytes);}catch(error){caught=error;}
  expect(caught).toBeInstanceOf(ExecutionLimitError);
  expect(caught).toMatchObject({reason:"cancelled"});
  expect(()=>buffers.createReadOnlyView!(bytes)).toThrow(caught as Error);
  expect(createReadOnlyView).toHaveBeenCalledTimes(1);
});

it.each(["cancelled","steps","allocation"] as const)("never invokes a retained view provider after %s termination",reason=>{
  const {controller,meter,bytes,view}=fixture();
  const createReadOnlyView=vi.fn(()=>view);
  const buffers=createRuntimeNativeBuffers(meter,{acquireSimple:()=>undefined,createReadOnlyView});
  if(reason==="cancelled")controller.abort();
  let failure:unknown;
  try{meter.checkpoint(reason==="steps"?100001:0,reason==="allocation"?1000001:0);}catch(error){failure=error;}
  expect(failure).toBeInstanceOf(ExecutionLimitError);
  for(let attempt=0;attempt<2;attempt++)expect(()=>buffers.createReadOnlyView!(bytes)).toThrow(failure as Error);
  expect(createReadOnlyView).not.toHaveBeenCalled();
});

it("preserves an ordinary provider failure and allows a later retry",()=>{
  const {meter,bytes,view}=fixture();
  const failure=new PythonRuntimeError("BufferError","view unavailable");
  const createReadOnlyView=vi.fn().mockImplementationOnce(()=>{throw failure;}).mockReturnValue(view);
  const buffers=createRuntimeNativeBuffers(meter,{acquireSimple:()=>undefined,createReadOnlyView});
  expect(()=>buffers.createReadOnlyView!(bytes)).toThrow(failure);
  expect(buffers.createReadOnlyView!(bytes)).toBe(view);
  expect(failure.notes).toBeUndefined();
});

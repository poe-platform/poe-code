import {expect,it} from "vitest";
import {ExecutionBudget,ExecutionLimitError} from "./execution-budget.js";
import {RuntimeValues,type RuntimeValue,type BuiltinInvocationContext} from "./runtime-values.js";
import {OrderedKeyMap} from "./ordered-key-map.js";
import {constructRuntimeBytes} from "./runtime-bytes-construction.js";
import {createRuntimeUtf8Encoder} from "./runtime-utf8-encoding.js";
import {ImmutableBytes} from "./immutable-bytes.js";

function fixture(signal?:AbortSignal){
  const meter=new ExecutionBudget({maxSteps:100000,maxAllocatedBytes:2000000,signal}),values=new RuntimeValues(meter);
  const keywords=values.dictionary(new OrderedKeyMap<RuntimeValue,RuntimeValue>({hash:()=>1n,equal:(a,b)=>a===b},meter));
  const invocation:BuiltinInvocationContext={call(){throw Error('unexpected call');},isStopIteration:()=>false};
  const encode=createRuntimeUtf8Encoder(values);
  return {values,meter,invocation,call:(source:RuntimeValue)=>constructRuntimeBytes([source],keywords,values,meter,encode,invocation)};
}

it.each(['acquire','copy'] as const)('releases a full buffer after cancellation during %s',phase=>{
  const controller=new AbortController(),{values,meter,invocation,call}=fixture(controller.signal);
  const bytes=ImmutableBytes.copyOf([65],meter);let releases=0;
  Object.assign(invocation,{buffers:{acquireSimple(){throw Error('must request full export');},acquireFull(){
    if(phase==='acquire')controller.abort();
    return {byteLength:1,copy(){if(phase==='copy')controller.abort();return bytes;},release(){releases++;}};
  }}});
  expect(()=>call(values.cell({}))).toThrow(ExecutionLimitError);
  expect(releases).toBe(1);
});

it('copies mutable full exports and never aliases subsequent mutations',()=>{
  const {values,meter,invocation,call}=fixture(),storage=new Uint8Array([65,66]);let releases=0;
  Object.assign(invocation,{buffers:{acquireSimple(){throw Error('must request full export');},acquireFull(){return {byteLength:2,copy:()=>ImmutableBytes.copyOf(storage,meter),release(){releases++;}};}}});
  const result=call(values.cell({}));storage[0]=90;
  expect(result.kind).toBe('bytes');
  if(result.kind!=='bytes')throw Error('expected bytes');
  expect([...result.value]).toEqual([65,66]);expect(releases).toBe(1);
});

it('rejects oversized allocations through the execution budget before allocating',()=>{
  const {values,call}=fixture();
  expect(()=>call(values.integer(1n<<40n))).toThrow(ExecutionLimitError);
});

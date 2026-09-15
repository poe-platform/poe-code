import {expect,it} from "vitest";
import {CodePointString} from "./code-point-string.js";
import {PythonEncodeError} from "./encode-error.js";
import {DoubleByteIncrementalEncoder} from "./double-byte-incremental-encoder.js";
import {ExecutionBudget,ExecutionLimitError} from "./execution-budget.js";
import {gb2312Codec} from "./gb2312-codec.js";
import {gbkCodec} from "./gbk-codec.js";
import {hzCodec} from "./hz-codec.js";
import {iso2022JpCodec} from "./iso2022-jp-codec.js";
import {iso2022KrCodec} from "./iso2022-kr-codec.js";
import {RuntimeValues,type RuntimeValue} from "./runtime-values.js";
import {runtimeComparison} from "./runtime-comparison.js";
import {RuntimeTypeRegistry} from "./runtime-type-registry.js";
import {RuntimeExceptionExecution,RuntimeRaisedException} from "./runtime-exception-execution.js";
import {runtimeExceptionPayload} from "./runtime-exception-state.js";

// CPython 3.14.7, Unicode 16.0.0, Darwin little endian: the second callback
// retains the first construction's args while start/end advance to 1/2.
// Guest callback identity/mutation still require the public multibyte adapter.
it.each([gb2312Codec,gbkCodec,hzCodec,iso2022JpCodec,iso2022KrCodec])("preserves first encoder fault arguments across negative resume: $name",codec=>{
  const meter=new ExecutionBudget({maxSteps:100000,maxAllocatedBytes:1000000});
  const values=new RuntimeValues(meter);
  const keys={hash:()=>0n,equal:(a:RuntimeValue,b:RuntimeValue)=>runtimeComparison("==",a,b,values,meter).value};
  const types=new RuntimeTypeRegistry(values,keys,meter);
  const exceptions=new RuntimeExceptionExecution(types,values,meter);
  const seen:PythonEncodeError[]=[];
  const encoder=new DoubleByteIncrementalEncoder(codec,error=>{
    seen.push(error);
    if(seen.length===2)throw error;
    return {replacement:Uint8Array.of(63),position:-1n};
  });
  let failure:unknown;
  try{encoder.encode(CodePointString.fromString("🐍🐍",meter),true,meter);}
  catch(error){failure=error;}
  expect(seen).toHaveLength(2);
  expect(failure).toBe(seen[1]);
  const prepared=exceptions.prepare(failure);
  expect(prepared).toBeInstanceOf(RuntimeRaisedException);
  const state=runtimeExceptionPayload((prepared as RuntimeRaisedException).value)!;
  const expectedArgs=[values.string(codec.name),values.string("🐍🐍"),values.integer(0),values.integer(1),values.string("illegal multibyte sequence")];
  expect(state.args.items).toHaveLength(expectedArgs.length);
  for(const [index,expected] of expectedArgs.entries())expect(keys.equal(state.args.items[index],expected)).toBe(true);
  expect(keys.equal(state.member("start",meter)!,values.integer(1))).toBe(true);
  expect(keys.equal(state.member("end",meter)!,values.integer(2))).toBe(true);
  encoder.errors="strict";
  try{encoder.encode(CodePointString.fromString("A🐍",meter),true,meter);}
  catch(error){failure=error;}
  expect(failure).toBeInstanceOf(PythonEncodeError);
  expect((failure as PythonEncodeError).initial).toBeUndefined();
});

it("isolates initial encoder faults across reentry and later chunks",()=>{
  const meter=new ExecutionBudget({maxSteps:100000,maxAllocatedBytes:1000000});
  const seen:PythonEncodeError[]=[];
  let nested=false;
  const encoder=new DoubleByteIncrementalEncoder(hzCodec,error=>{
    seen.push(error);
    if(!nested){nested=true;encoder.encode(CodePointString.fromString("A🐍",meter),true,meter);}
    return {replacement:CodePointString.fromString("?",meter),position:BigInt(error.end)};
  });
  expect([...encoder.encode(CodePointString.fromString("🐍🐍",meter),true,meter)]).toEqual([63,63]);
  expect([...encoder.encode(CodePointString.fromString("A🐍",meter),true,meter)]).toEqual([65,63]);
  expect(seen.map(error=>[error.start,error.initial])).toEqual([
    [0,undefined],[1,undefined],[1,{start:0,end:1,reason:"illegal multibyte sequence"}],[1,undefined]
  ]);
});

it("gives an unencodable replacement its own fault arguments",()=>{
  const meter=new ExecutionBudget({maxSteps:100000,maxAllocatedBytes:1000000});
  let calls=0;
  const encoder=new DoubleByteIncrementalEncoder(hzCodec,()=>{
    calls++;
    return {replacement:CodePointString.fromString(calls===1?"?":"X🐍",meter),position:BigInt(calls)};
  });
  let failure:unknown;
  try{encoder.encode(CodePointString.fromString("🐍🐍",meter),true,meter);}
  catch(error){failure=error;}
  expect(calls).toBe(2);
  expect(failure).toBeInstanceOf(PythonEncodeError);
  const error=failure as PythonEncodeError;
  expect([...error.object]).toEqual([88,128013]);
  expect([error.start,error.end,error.initial]).toEqual([1,2,undefined]);
});

it.each([false,true])("stops after a cancelling encoder callback (throws=%s)",throws=>{
  const controller=new AbortController();
  const meter=new ExecutionBudget({maxSteps:100000,maxAllocatedBytes:1000000,signal:controller.signal});
  let calls=0;
  const encoder=new DoubleByteIncrementalEncoder(hzCodec,()=>{
    calls++;controller.abort();
    if(throws)throw Error("service failure");
    return {replacement:Uint8Array.of(63),position:-1n};
  });
  const input=CodePointString.fromString("🐍🐍",meter);
  expect(()=>encoder.encode(input,true,meter)).toThrow(ExecutionLimitError);
  expect(calls).toBe(1);
  expect(()=>encoder.getstate(meter)).toThrow(ExecutionLimitError);
});

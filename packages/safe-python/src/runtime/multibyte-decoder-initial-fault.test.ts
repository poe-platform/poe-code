import {expect,it} from "vitest";
import {CodePointString} from "./code-point-string.js";
import {PythonDecodeError} from "./decode-error.js";
import {DoubleByteIncrementalDecoder} from "./double-byte-incremental-decoder.js";
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

// CPython 3.14.7 / Unicode 16.0.0, Darwin little endian. The callback returns
// ('?', -1) and changes decoder.errors to 'strict'. Its cached exception keeps
// args (name, b'\xff\xff', 0, 1, 'illegal multibyte sequence'), while the final
// live span is 1:2. Public callback identity is a separate integration gate.
it.each([gb2312Codec,gbkCodec,hzCodec,iso2022JpCodec,iso2022KrCodec])("retains initial decoder arguments after a live policy change: $name",codec=>{
  const meter=new ExecutionBudget({maxSteps:100000,maxAllocatedBytes:1000000});
  const values=new RuntimeValues(meter);
  const keys={hash:()=>0n,equal:(a:RuntimeValue,b:RuntimeValue)=>runtimeComparison("==",a,b,values,meter).value};
  const types=new RuntimeTypeRegistry(values,keys,meter);
  const exceptions=new RuntimeExceptionExecution(types,values,meter);
  let calls=0;
  const decoder=new DoubleByteIncrementalDecoder(codec,()=>{
    calls++;
    decoder.errors="strict";
    return {replacement:CodePointString.fromString("?",meter),position:-1n};
  });
  let failure:unknown;
  try{decoder.decode(Uint8Array.of(255,255),true,meter);}
  catch(error){failure=error;}
  expect(calls).toBe(1);
  expect(failure).toBeInstanceOf(PythonDecodeError);
  const prepared=exceptions.prepare(failure);
  expect(prepared).toBeInstanceOf(RuntimeRaisedException);
  const state=runtimeExceptionPayload((prepared as RuntimeRaisedException).value)!;
  const expectedArgs=[
    values.string(codec.name),values.bytes(Uint8Array.of(255,255)),values.integer(0),values.integer(1),values.string("illegal multibyte sequence")
  ];
  expect(state.args.items).toHaveLength(expectedArgs.length);
  for(const [index,expected] of expectedArgs.entries())expect(keys.equal(state.args.items[index],expected)).toBe(true);
  expect(keys.equal(state.member("start",meter)!,values.integer(1))).toBe(true);
  expect(keys.equal(state.member("end",meter)!,values.integer(2))).toBe(true);
  expect(keys.equal(state.member("reason",meter)!,values.string(codec===gb2312Codec||codec===gbkCodec?"incomplete multibyte sequence":"illegal multibyte sequence"))).toBe(true);
  // A subsequent decode owns a fresh error cache, including after failure.
  try{decoder.decode(Uint8Array.of(65,255),true,meter);}
  catch(error){failure=error;}
  expect(failure).toBeInstanceOf(PythonDecodeError);
  expect((failure as PythonDecodeError).initial).toBeUndefined();
});

it("keeps nested decoder operations' initial faults independent",()=>{
  const meter=new ExecutionBudget({maxSteps:100000,maxAllocatedBytes:1000000});
  const seen:PythonDecodeError[]=[];
  let nested=false;
  const decoder=new DoubleByteIncrementalDecoder(hzCodec,error=>{
    seen.push(error);
    if(!nested){nested=true;decoder.decode(Uint8Array.of(65,255),true,meter);}
    return {replacement:CodePointString.fromString("?",meter),position:BigInt(error.end)};
  });
  expect([...decoder.decode(Uint8Array.of(255,255),true,meter)]).toEqual([63,63]);
  expect(seen.map(error=>[error.start,error.initial])).toEqual([
    [0,undefined],[1,undefined],[1,{start:0,end:1,reason:"illegal multibyte sequence"}]
  ]);
});

it.each([false,true])("does not resume after a cancelling decoder callback (throws=%s)",throws=>{
  const controller=new AbortController();
  const meter=new ExecutionBudget({maxSteps:100000,maxAllocatedBytes:1000000,signal:controller.signal});
  const replacement=CodePointString.fromString("?",meter);
  let calls=0;
  const decoder=new DoubleByteIncrementalDecoder(hzCodec,()=>{
    calls++;controller.abort();
    if(throws)throw Error("service failure");
    return {replacement,position:-1n};
  });
  expect(()=>decoder.decode(Uint8Array.of(255,255),true,meter)).toThrow(ExecutionLimitError);
  expect(calls).toBe(1);
  expect(()=>decoder.getstate(meter)).toThrow(ExecutionLimitError);
});

import {expect,it} from "vitest";
import reference from "./__snapshots__/punycode-3.14.7.json";
import {CodePointString} from "./code-point-string.js";
import {PythonDecodeError} from "./decode-error.js";
import {PythonRuntimeError} from "./error.js";
import {ExecutionBudget,ExecutionLimitError} from "./execution-budget.js";
import {encodePunycode,decodePunycode} from "./punycode.js";

it("encodes pinned Punycode vectors without host Unicode conversion",()=>{
  expect(reference.oracle.unicode).toBe("16.0.0");
  for(const row of reference.encode){
    expect([...encodePunycode(new CodePointString(new Uint32Array(row.input)))],JSON.stringify(row.input)).toEqual(row.result);
  }
});

it("decodes pinned Punycode vectors and exact malformed-input faults",()=>{
  for(const row of reference.decode){
    let actual:unknown;
    try{actual={result:[...decodePunycode(new Uint8Array(row.input),row.policy)]};}
    catch(error){
      if(error instanceof PythonDecodeError)actual={error:{name:error.name,encoding:error.encoding,object:[...error.object],start:error.start,end:error.end,reason:error.reason}};
      else if(error instanceof PythonRuntimeError)actual={failure:[error.name,error.message]};
      else throw error;
    }
    const expected=row.result!==undefined?{result:row.result}:row.error!==undefined?{error:row.error}:{failure:row.failure};
    expect(actual,JSON.stringify(row)).toEqual(expected);
  }
});

it.each(["surrogatepass","backslashreplace","unknown"])("rejects unsupported Punycode decode policy %s even on empty input",policy=>{
  expect(()=>decodePunycode(new Uint8Array(),policy)).toThrow(new PythonRuntimeError("UnicodeError",`Unsupported error handling: ${policy}`));
});

it("meters arbitrary-size integers and quadratic insertion work",()=>{
  expect(()=>decodePunycode(new Uint8Array(10000).fill(122),"strict",new ExecutionBudget({maxSteps:100,maxAllocatedBytes:1000000}))).toThrow(ExecutionLimitError);
  const text=new CodePointString(Uint32Array.from({length:1000},(_,index)=>128+index));
  expect(()=>encodePunycode(text,new ExecutionBudget({maxSteps:100,maxAllocatedBytes:1000000}))).toThrow(ExecutionLimitError);
  const controller=new AbortController();controller.abort();
  const meter=new ExecutionBudget({maxSteps:100,maxAllocatedBytes:1000000,signal:controller.signal});
  expect(()=>encodePunycode(new CodePointString(new Uint32Array()),meter)).toThrow(ExecutionLimitError);
  expect(()=>decodePunycode(new Uint8Array(),"strict",meter)).toThrow(ExecutionLimitError);
});

it("retains Py_ssize_t fault positions beyond JavaScript's exact number range",()=>{
  try{decodePunycode(new Uint8Array([..."999999999999999a"].map(char=>char.charCodeAt(0))));}
  catch(error){
    expect(error).toBeInstanceOf(PythonDecodeError);
    expect(error).toMatchObject({start:47638888888885384n,end:47638888888885385n,reason:"Invalid character U+a93f5129b76109"});
    return;
  }
  throw Error("expected UnicodeDecodeError");
});

it.each([false,true])("keeps ASCII prefix service cancellation terminal (throws=%s)",throws=>{
  const controller=new AbortController();
  const meter=new ExecutionBudget({maxSteps:10000,maxAllocatedBytes:1000000,signal:controller.signal});
  const input=Uint8Array.of(65,45,97);
  let calls=0;
  expect(()=>decodePunycode(input,"strict",meter,prefix=>{
    calls++;
    expect([...prefix]).toEqual([65]);
    controller.abort();
    if(throws)throw new PythonRuntimeError("ValueError","prefix service failed");
    return new CodePointString(Uint32Array.of(65));
  })).toThrow(ExecutionLimitError);
  expect(calls).toBe(1);
  expect([...input]).toEqual([65,45,97]);
});

it.each([false,true])("preserves ASCII prefix service failure identity (fatal=%s)",fatal=>{
  const failure=fatal?new ExecutionLimitError("cancelled"):new PythonRuntimeError("ValueError","prefix service failed");
  let afterFailure=0,failed=false;
  let caught:unknown;
  try{decodePunycode(Uint8Array.of(65,45),"strict",{
    checkpoint(){if(failed)afterFailure++;}
  },()=>{failed=true;throw failure;});}
  catch(error){caught=error;}
  expect(caught).toBe(failure);
  if(fatal)expect(afterFailure).toBe(0);
});

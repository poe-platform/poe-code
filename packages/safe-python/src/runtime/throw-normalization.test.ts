import { expect,it } from "vitest";
import { normalizeThrownException,type ThrowNormalizationContext } from "./throw-normalization.js";
import { ExecutionBudget,ExecutionLimitError } from "./execution-budget.js";
import { PythonRuntimeError } from "./error.js";

class GuestError {
  constructor(readonly type:string,readonly args:readonly unknown[]){}
}
function fixture() {
  const meter=new ExecutionBudget({maxSteps:1000,maxAllocatedBytes:10000}),calls:unknown[][]=[];
  const context:ThrowNormalizationContext<unknown>={
    isInstance:value=>value instanceof GuestError,isNone:value=>value===null,
    typeOf:value=>value instanceof GuestError?value.type:typeof value,typeName:type=>String(type),
    isSubclass:(type,requested)=>type===requested,tupleItems:value=>Array.isArray(value)?value:undefined,
    call(type,args){calls.push([type,...args]);return new GuestError(String(type),args);},repr:type=>`<class '${type}'>`,
    failure(error){
      if(error instanceof GuestError)return error;
      if(error instanceof PythonRuntimeError)return new GuestError(error.name,[error.message]);
      throw error;
    }
  };
  return {meter,context,calls};
}

it.each([null,[],[1,2],42])("normalizes None, tuple or single-value constructor args (%j)",value=>{
  const {context,meter,calls}=fixture();
  const args=value===null?[]:Array.isArray(value)?value:[value];
  expect(normalizeThrownException("Error",value,context,meter)).toEqual(new GuestError("Error",args));
  expect(calls).toEqual([["Error",...args]]);
});

it("preserves accepted subclass identity without constructor calls",()=>{
  const {context,meter,calls}=fixture(),original=new GuestError("Child",[]);
  context.isSubclass=()=>true;
  expect(normalizeThrownException("Parent",original,context,meter)).toBe(original);expect(calls).toEqual([]);
});

it("performs final restore construction for a mismatched native result",()=>{
  const {context,meter,calls}=fixture(),replacement=new GuestError("Other",[]);
  context.call=(type,args)=>{calls.push([type,...args]);return replacement;};
  expect(normalizeThrownException("Requested",null,context,meter)).toBe(replacement);
  expect(calls).toEqual([["Requested"],["Requested",replacement]]);
});

it("injects a failed final restore construction as its own exception",()=>{
  const {context,meter}=fixture(),failure=new GuestError("Failed",[]);
  let calls=0;
  context.call=()=>{if(++calls===2)throw failure;return new GuestError("Other",[]);};
  expect(normalizeThrownException("Requested",null,context,meter)).toBe(failure);expect(calls).toBe(2);
});

it("bounds repeated normalization failures and switches to canonical RecursionError",()=>{
  const {context,meter}=fixture(),failure=new GuestError("Broken",[]);
  let failures=0;
  context.call=()=>{failures++;throw failure;};
  context.isSubclass=(_type,requested)=>{if(requested==="RecursionError")return true;failures++;throw failure;};
  expect(normalizeThrownException("Requested",null,context,meter)).toEqual(new GuestError("RecursionError",["maximum recursion depth exceeded while normalizing an exception"]));
  expect(failures).toBe(32);
});

it.each([new ExecutionLimitError("steps"),Error("host failure")])("does not turn fatal failures into injected exceptions",failure=>{
  const {context,meter}=fixture();
  context.call=()=>{throw failure;};
  expect(()=>normalizeThrownException("Requested",null,context,meter)).toThrow(failure);
});

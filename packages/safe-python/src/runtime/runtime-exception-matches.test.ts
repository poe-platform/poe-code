import { expect,it } from "vitest";
import { PythonRuntimeError } from "./error.js";
import { ExecutionLimitError } from "./execution-budget.js";
import { runtimeExceptionMatches } from "./runtime-exception-matches.js";

it("matches exact native faults without requiring an execution policy",()=>{
  expect(runtimeExceptionMatches(new PythonRuntimeError("AttributeError","missing"),"AttributeError")).toBe(true);
  expect(runtimeExceptionMatches(new PythonRuntimeError("TypeError","wrong"),"AttributeError")).toBe(false);
  expect(runtimeExceptionMatches(Object.assign(Error("host"),{name:"AttributeError"}),"AttributeError")).toBe(false);
});

it("delegates guest inheritance without inspecting or rendering host payloads",()=>{
  const guest=Object.freeze({}),calls:unknown[]=[];
  const policy={isException(error:unknown,name:string){calls.push(error,name);return error===guest&&name==="LookupError";}};
  expect(runtimeExceptionMatches(guest,"LookupError",policy)).toBe(true);
  expect(calls).toEqual([guest,"LookupError"]);
});

it("never offers execution limits to an extension exception policy",()=>{
  for(const reason of ["steps","allocation","cancelled"] as const) {
    expect(runtimeExceptionMatches(new ExecutionLimitError(reason),"BaseException",{isException(){throw Error("must not be called");}})).toBe(false);
  }
});

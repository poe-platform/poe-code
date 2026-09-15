import {expect,it} from "vitest";
import {ExecutionBudget,ExecutionLimitError} from "./execution-budget.js";
import {ImmutableBytes} from "./immutable-bytes.js";
import {displayRuntimeEncodingName,normalizeRuntimeEncodingName} from "./runtime-encoding-name.js";

it.each(["normalize","display"] as const)("checks cancellation before %s even for empty codec names",operation=>{
  const controller=new AbortController();
  const meter=new ExecutionBudget({maxSteps:1000,maxAllocatedBytes:10000,signal:controller.signal});
  const bytes=ImmutableBytes.copyOf(new Uint8Array(),meter);
  controller.abort();
  let failure:unknown;
  try {meter.checkpoint();}catch(error){failure=error;}
  expect(failure).toBeInstanceOf(ExecutionLimitError);
  for(const name of ["", "ascii",bytes]){
    let caught:unknown;
    try {
      if(operation==="normalize")normalizeRuntimeEncodingName(name,meter);
      else displayRuntimeEncodingName(name,meter);
    }catch(error){caught=error;}
    expect(caught).toBe(failure);
  }
});

it("retains ordinary normalization and diagnostic spellings",()=>{
  const meter=new ExecutionBudget({maxSteps:1000,maxAllocatedBytes:10000});
  expect(normalizeRuntimeEncodingName("",meter)).toBe("");
  expect(normalizeRuntimeEncodingName(" UTF--8. ",meter)).toBe("utf_8.");
  expect(displayRuntimeEncodingName("",meter)).toBe("");
  expect(displayRuntimeEncodingName("UTF--8",meter)).toBe("UTF--8");
});

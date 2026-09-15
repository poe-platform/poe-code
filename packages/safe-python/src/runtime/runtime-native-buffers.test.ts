import {expect,it,vi} from "vitest";
import {ExecutionBudget,ExecutionLimitError} from "./execution-budget.js";
import {createRuntimeNativeBuffers} from "./runtime-native-buffers.js";
import {RuntimeValues} from "./runtime-values.js";

it.each(["simple","full","full-fallback"] as const)("does not invoke a retained %s export service after termination",mode=>{
  for(const reason of ["cancelled","steps","allocation"] as const){
    const controller=new AbortController();
    const meter=new ExecutionBudget({maxSteps:100000,maxAllocatedBytes:1000000,signal:controller.signal});
    const values=new RuntimeValues(meter),source=values.none;
    const acquireSimple=vi.fn(()=>undefined),acquireFull=vi.fn(()=>undefined);
    const buffers=createRuntimeNativeBuffers(meter,{acquireSimple,...(mode==="full"?{acquireFull}:{})});
    const acquire=mode==="simple"?buffers.acquireSimple:buffers.acquireFull!;
    if(reason==="cancelled")controller.abort();
    let failure:unknown;
    try{meter.checkpoint(reason==="steps"?100001:0,reason==="allocation"?1000001:0);}catch(error){failure=error;}
    expect(failure).toBeInstanceOf(ExecutionLimitError);
    expect(failure).toMatchObject({reason});
    for(let attempt=0;attempt<2;attempt++){
      let caught:unknown;
      try{acquire(source);}catch(error){caught=error;}
      expect(caught).toBe(failure);
    }
    expect(acquireSimple).not.toHaveBeenCalled();
    expect(acquireFull).not.toHaveBeenCalled();
  }
});

it.each(["simple","full"] as const)("observes cancellation before a %s acquisition without an exporter",mode=>{
  const controller=new AbortController();
  const meter=new ExecutionBudget({maxSteps:100000,maxAllocatedBytes:1000000,signal:controller.signal});
  const values=new RuntimeValues(meter),buffers=createRuntimeNativeBuffers(meter);
  controller.abort();
  expect(()=>mode==="simple"?buffers.acquireSimple(values.none):buffers.acquireFull!(values.none)).toThrow(ExecutionLimitError);
});

it.each(["simple","full","full-fallback"] as const)("terminates and cleans up after a %s exporter cancels",mode=>{
  for(const outcome of ["lease","missing","throw"] as const){
    const controller=new AbortController();
    const meter=new ExecutionBudget({maxSteps:100000,maxAllocatedBytes:1000000,signal:controller.signal});
    const values=new RuntimeValues(meter),release=vi.fn(),failure=new Error("export failed");
    const exporter=vi.fn(()=>{
      controller.abort();
      if(outcome==="throw")throw failure;
      return outcome==="missing"?undefined:{byteLength:0,copy:vi.fn(),release};
    });
    const buffers=createRuntimeNativeBuffers(meter,{acquireSimple:exporter,...(mode==="full"?{acquireFull:exporter}:{})});
    const acquire=mode==="simple"?buffers.acquireSimple:buffers.acquireFull!;
    let caught:unknown;
    try{acquire(values.none);}catch(error){caught=error;}
    expect(caught).toBeInstanceOf(ExecutionLimitError);
    expect(caught).toMatchObject({reason:"cancelled"});
    expect(release).toHaveBeenCalledTimes(outcome==="lease"?1:0);
    expect(()=>acquire(values.none)).toThrow(caught as Error);
    expect(exporter).toHaveBeenCalledTimes(1);
  }
});

it.each(["simple","full"] as const)("preserves ordinary %s exporter failures and transfers successful leases",mode=>{
  const meter=new ExecutionBudget({maxSteps:100000,maxAllocatedBytes:1000000});
  const values=new RuntimeValues(meter),failure=new Error("export failed"),release=vi.fn();
  const lease={byteLength:0,copy:vi.fn(),release};
  const exporter=vi.fn().mockImplementationOnce(()=>{throw failure;}).mockReturnValue(lease);
  const buffers=createRuntimeNativeBuffers(meter,{acquireSimple:exporter,acquireFull:exporter});
  const acquire=mode==="simple"?buffers.acquireSimple:buffers.acquireFull!;
  expect(()=>acquire(values.none)).toThrow(failure);
  expect(acquire(values.none)).toBe(lease);
  expect(release).not.toHaveBeenCalled();
});

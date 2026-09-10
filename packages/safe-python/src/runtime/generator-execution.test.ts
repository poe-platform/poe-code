import { expect,it,vi } from "vitest";
import { GeneratorExecution,type GeneratorRequest,type GeneratorExecutionContext } from "./generator-execution.js";
import { PythonRuntimeError } from "./error.js";
import { ExecutionBudget,ExecutionLimitError } from "./execution-budget.js";

type Value=number|null;
class GuestExit extends Error {}
const budget=()=>new ExecutionBudget({maxSteps:10000,maxAllocatedBytes:10000});
function context():GeneratorExecutionContext<Value> {
  return {none:null,enter:()=>()=>{},generatorExit:()=>new GuestExit(),
    isGeneratorExit:error=>error instanceof GuestExit,
    isStopIteration:error=>error instanceof PythonRuntimeError&&error.name==="StopIteration",
    wrapStopIteration:error=>Object.assign(new PythonRuntimeError("RuntimeError","generator raised StopIteration"),{cause:error})};
}

it("starts lazily, sends values, and exposes a return value only on the completing resume",()=>{
  const requests:GeneratorRequest<Value>[]=[],policy=context();
  const state=new GeneratorExecution<Value>(request=>{requests.push(request);return requests.length===1?{done:false,value:7}:{done:true,value:42};},policy,budget());
  expect(state.phase).toBe("created");expect(requests).toEqual([]);
  expect(state.resume({kind:"send",value:null})).toEqual({done:false,value:7});expect(state.phase).toBe("suspended");
  expect(state.resume({kind:"send",value:9})).toEqual({done:true,value:42});expect(state.phase).toBe("closed");
  expect(state.resume({kind:"send",value:99})).toEqual({done:true,value:null});
  expect(requests).toEqual([{kind:"send",value:null},{kind:"send",value:9}]);
});

it("rejects an initial non-None send without starting or closing the generator",()=>{
  const driver=vi.fn(()=>({done:false as const,value:1})),state=new GeneratorExecution(driver,context(),budget());
  expect(()=>state.resume({kind:"send",value:1})).toThrow("can't send non-None value to a just-started generator");
  expect(state.phase).toBe("created");expect(driver).not.toHaveBeenCalled();
  expect(state.resume({kind:"send",value:null})).toEqual({done:false,value:1});
});

it.each(["created","closed"] as const)("throws into a %s generator without entering its body",phase=>{
  const policy=context(),driver=vi.fn(()=>({done:true as const,value:1}));policy.enter=vi.fn(policy.enter);
  const state=new GeneratorExecution(driver,policy,budget()),failure=new PythonRuntimeError("ValueError","injected");
  if(phase==="closed")state.resume({kind:"close"});
  expect(()=>state.resume({kind:"throw",error:failure})).toThrow(failure);
  expect(state.phase).toBe("closed");expect(driver).not.toHaveBeenCalled();expect(policy.enter).not.toHaveBeenCalled();
});

it("injects the original exception into a suspended body that can catch and yield",()=>{
  const failure=new PythonRuntimeError("ValueError","injected");
  const state=new GeneratorExecution<Value>(request=>request.kind==="throw"?{done:false,value:request.error===failure?2:0}:{done:false,value:1},context(),budget());
  state.resume({kind:"send",value:null});
  expect(state.resume({kind:"throw",error:failure})).toEqual({done:false,value:2});expect(state.phase).toBe("suspended");
});

it("closes a new generator without running its body",()=>{
  const driver=vi.fn(()=>({done:false as const,value:1})),state=new GeneratorExecution(driver,context(),budget());
  expect(state.resume({kind:"close"})).toEqual({done:true,value:null});expect(state.phase).toBe("closed");
  expect(driver).not.toHaveBeenCalled();
});

it("returns a value from close when the resumed body returns",()=>{
  const state=new GeneratorExecution<Value>(request=>request.kind==="throw"?{done:true,value:42}:{done:false,value:1},context(),budget());
  state.resume({kind:"send",value:null});
  expect(state.resume({kind:"close"})).toEqual({done:true,value:42});
  expect(state.resume({kind:"close"})).toEqual({done:true,value:null});
});

it("swallows GeneratorExit only for close, not explicit throw",()=>{
  for(const close of [true,false]) {
    const state=new GeneratorExecution<Value>(request=>{if(request.kind==="throw")throw request.error;return {done:false,value:1};},context(),budget());
    state.resume({kind:"send",value:null});
    if(close)expect(state.resume({kind:"close"})).toEqual({done:true,value:null});
    else expect(()=>state.resume({kind:"throw",error:new GuestExit()})).toThrow(GuestExit);
    expect(state.phase).toBe("closed");
  }
});

it("leaves the generator suspended when close is ignored by yielding",()=>{
  let count=0;
  const state=new GeneratorExecution<Value>(()=>++count<3?{done:false,value:count}:{done:true,value:9},context(),budget());
  state.resume({kind:"send",value:null});
  expect(()=>state.resume({kind:"close"})).toThrow("generator ignored GeneratorExit");expect(state.phase).toBe("suspended");
  expect(state.resume({kind:"send",value:null})).toEqual({done:true,value:9});
});

it.each(["send","throw","close"] as const)("rejects reentrant %s without damaging the running activation",kind=>{
  const state:GeneratorExecution<Value>=new GeneratorExecution(()=>{
    expect(state.phase).toBe("running");
    const request=kind==="send"?{kind,value:null} as const:kind==="throw"?{kind,error:new GuestExit()} as const:{kind} as const;
    expect(()=>state.resume(request)).toThrow("generator already executing");
    expect(state.phase).toBe("running");return {done:false,value:1};
  },context(),budget());
  expect(state.resume({kind:"send",value:null})).toEqual({done:false,value:1});expect(state.phase).toBe("suspended");
});

it.each(["send","close"] as const)("converts escaping StopIteration during %s without confusing it with return",kind=>{
  const failure=new PythonRuntimeError("StopIteration","bad"),policy=context();let first=true;
  const state=new GeneratorExecution<Value>(()=>{if(first){first=false;return {done:false,value:1};}throw failure;},policy,budget());
  state.resume({kind:"send",value:null});
  const request=kind==="close"?{kind} as const:{kind,value:null} as const;
  let caught:unknown;try{state.resume(request);}catch(error){caught=error;}
  expect(caught).toMatchObject({name:"RuntimeError",message:"generator raised StopIteration",cause:failure});expect(state.phase).toBe("closed");
});

it("restores frame state without metered work after fatal body termination",()=>{
  const failure=new ExecutionLimitError("cancelled"),events:string[]=[],policy=context();let stopped=false;
  policy.enter=()=>{events.push("enter");return ()=>{events.push("leave");};};
  policy.isStopIteration=policy.isGeneratorExit=()=>{throw Error("fatal errors must not be classified");};
  const state=new GeneratorExecution<Value>(()=>{stopped=true;throw failure;},policy,{checkpoint(){if(stopped)throw Error("meter called after fatal error");}});
  expect(()=>state.resume({kind:"send",value:null})).toThrow(failure);
  expect(state.phase).toBe("closed");expect(events).toEqual(["enter","leave"]);
});

it("observes cancellation before publishing a yielded value",()=>{
  const controller=new AbortController(),policy=context();let restored=false;
  policy.enter=()=>()=>{restored=true;};
  const meter=new ExecutionBudget({maxSteps:100,maxAllocatedBytes:1000,signal:controller.signal});
  const state=new GeneratorExecution<Value>(()=>{controller.abort();return {done:false,value:1};},policy,meter);
  expect(()=>state.resume({kind:"send",value:null})).toThrow(ExecutionLimitError);
  expect(state.phase).toBe("closed");expect(restored).toBe(true);
});

it("observes cancellation during frame entry before executing the body",()=>{
  const controller=new AbortController(),policy=context(),driver=vi.fn(()=>({done:false as const,value:1}));let restored=false;
  policy.enter=()=>{controller.abort();return ()=>{restored=true;};};
  const meter=new ExecutionBudget({maxSteps:100,maxAllocatedBytes:1000,signal:controller.signal});
  const state=new GeneratorExecution(driver,policy,meter);
  expect(()=>state.resume({kind:"send",value:null})).toThrow(ExecutionLimitError);
  expect(driver).not.toHaveBeenCalled();expect(restored).toBe(true);expect(state.phase).toBe("closed");
});

it("leaves the prior state intact when host frame entry fails before body execution",()=>{
  const policy=context(),failure=Error("entry failed"),driver=vi.fn(()=>({done:false as const,value:1}));
  policy.enter=()=>{throw failure;};
  const state=new GeneratorExecution(driver,policy,budget());
  expect(()=>state.resume({kind:"send",value:null})).toThrow(failure);
  expect(state.phase).toBe("created");expect(driver).not.toHaveBeenCalled();
});

it.each([Error("host failure"),{name:"StopIteration",message:"spoof"},undefined])("propagates opaque host failures without converting their names: %s",failure=>{
  const state=new GeneratorExecution<Value>(()=>{throw failure;},context(),budget());
  let caught:unknown,thrown=false;try{state.resume({kind:"send",value:null});}catch(error){caught=error;thrown=true;}
  expect(thrown).toBe(true);expect(caught).toBe(failure);expect(state.phase).toBe("closed");
});

it("distinguishes an undefined return payload from the None used after completion",()=>{
  const state=new GeneratorExecution<unknown>(()=>({done:true,value:undefined}),context(),budget());
  expect(state.resume({kind:"send",value:null})).toEqual({done:true,value:undefined});
  expect(state.resume({kind:"send",value:null})).toEqual({done:true,value:null});
});

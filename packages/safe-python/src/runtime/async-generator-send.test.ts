import {expect,it,vi} from "vitest";
import {AsyncGeneratorSend,type AsyncGeneratorActivity,type AsyncGeneratorSendContext} from "./async-generator-send.js";
import {GeneratorExecution,type GeneratorInput} from "./generator-execution.js";
import {ExecutionBudget,ExecutionLimitError} from "./execution-budget.js";
import {PythonRuntimeError} from "./error.js";

type Value=number|null;
class Exit extends Error {}
class Exhausted extends Error {}
const meter=()=>new ExecutionBudget({maxSteps:10000,maxAllocatedBytes:10000});
function fixture(steps:Array<{kind:"await"|"item";value:Value}|{kind:"done"}|{kind:"error";error:unknown}>) {
  const activity:AsyncGeneratorActivity={running:false,closed:false},requests:GeneratorInput<Value>[]=[],budget=meter();
  const context:AsyncGeneratorSendContext<Value>={none:null,generatorExit:()=>new Exit(),isGeneratorExit:error=>error instanceof Exit,isStopAsyncIteration:error=>error instanceof Exhausted,exhausted:()=>new Exhausted()};
  const body={delegating:false,resume(input:GeneratorInput<Value>){
    requests.push(input);const step=steps.shift()??{kind:"done"};
    if(step.kind==="error")throw step.error;
    body.delegating=step.kind==="await";
    return step.kind==="done"?{done:true as const,value:null}:{done:false as const,value:step.value};
  }};
  return {activity,body,context,budget,requests,send:(value:Value=null)=>new AsyncGeneratorSend(body,activity,context,value,budget)};
}

it("delivers items as operation completion, but keeps ownership across awaited yields",()=>{
  const f=fixture([{kind:"await",value:1},{kind:"item",value:2}]),op=f.send();
  expect(op.phase).toBe("created");expect(f.requests).toEqual([]);
  expect(op.resume({kind:"send",value:null})).toEqual({done:false,value:1});expect(f.activity.running).toBe(true);
  expect(op.resume({kind:"send",value:9})).toEqual({done:true,value:2});expect(f.activity.running).toBe(false);
  expect(op.phase).toBe("closed");expect(f.activity.closed).toBe(false);
  expect(()=>op.resume({kind:"send",value:null})).toThrow("cannot reuse already awaited __anext__()/asend()");
});

it.each([null,7])("selects the initial asend argument only for a None first send: %s",value=>{
  const f=fixture([{kind:"item",value:1}]);f.send(3).resume({kind:"send",value});
  expect(f.requests).toEqual([{kind:"send",value:value===null?3:7}]);
});

it.each(["send","throw"] as const)("rejects a competing %s and permanently closes only that operation",kind=>{
  const f=fixture([{kind:"await",value:1},{kind:"item",value:2}]),first=f.send(),other=f.send();
  first.resume({kind:"send",value:null});
  expect(()=>other.resume(kind==="send"?{kind,value:null}:{kind,error:new Exit()})).toThrow("anext(): asynchronous generator is already running");
  expect(other.phase).toBe("closed");expect(first.phase).toBe("active");expect(f.activity.running).toBe(true);
  expect(first.resume({kind:"send",value:null})).toEqual({done:true,value:2});
});

it("distinguishes exhaustion from a yielded None and allows a fresh exhausted send",()=>{
  const f=fixture([{kind:"item",value:null},{kind:"done"}]);
  expect(f.send().resume({kind:"send",value:null})).toEqual({done:true,value:null});
  expect(()=>f.send().resume({kind:"send",value:null})).toThrow(Exhausted);
  expect(f.activity).toEqual({running:false,closed:true});
  expect(()=>f.send().resume({kind:"send",value:null})).toThrow(Exhausted);
});

it("injects throws without replacing them with the stored send argument",()=>{
  const f=fixture([{kind:"item",value:3}]),error=new Error("injected");
  expect(f.send(7).resume({kind:"throw",error})).toEqual({done:true,value:3});
  expect(f.requests).toEqual([{kind:"throw",error}]);
});

it.each([new Exit(),new Exhausted(),new Error("body")])("releases ownership on body failure %s",error=>{
  const f=fixture([{kind:"error",error}]),op=f.send();
  expect(()=>op.resume({kind:"send",value:null})).toThrow(error);
  expect(op.phase).toBe("closed");expect(f.activity.running).toBe(false);
  expect(f.activity.closed).toBe(error instanceof Exit||error instanceof Exhausted);
});

it.each([{kind:"item" as const,value:9},{kind:"done" as const},{kind:"error" as const,error:new Exit()}])("closes an operation without exposing its completion: %s",step=>{
  const f=fixture([step]),op=f.send();
  expect(op.resume({kind:"close"})).toEqual({done:true,value:null});
  expect(op.resume({kind:"close"})).toEqual({done:true,value:null});expect(f.requests).toHaveLength(1);
});

it("keeps an illicit await suspended when synchronous wrapper close fails",()=>{
  const f=fixture([{kind:"await",value:1},{kind:"error",error:new Exit()}]),op=f.send();
  expect(()=>op.resume({kind:"close"})).toThrow("coroutine ignored GeneratorExit");
  expect(op.phase).toBe("active");expect(f.activity.running).toBe(true);
  expect(op.resume({kind:"close"})).toEqual({done:true,value:null});expect(f.activity.running).toBe(false);
});

it("bypasses guest exception classification after fatal body failure",()=>{
  const error=new ExecutionLimitError("cancelled"),f=fixture([{kind:"error",error}]),op=f.send();
  f.context.isGeneratorExit=f.context.isStopAsyncIteration=vi.fn(()=>{throw Error("classified fatal failure");});
  expect(()=>op.resume({kind:"send",value:null})).toThrow(error);
  expect(f.context.isGeneratorExit).not.toHaveBeenCalled();expect(f.activity.running).toBe(false);expect(op.phase).toBe("closed");
});

it("converts escaping StopAsyncIteration in an async-generator body",()=>{
  const error=new PythonRuntimeError("StopAsyncIteration","escaped");
  const body=new GeneratorExecution<Value>(()=>{throw error;},{none:null,kind:"async generator",enter:()=>()=>{},generatorExit:()=>new Exit(),isGeneratorExit:e=>e instanceof Exit,isStopIteration:()=>false,isStopAsyncIteration:e=>e===error,wrapStopIteration:e=>Object.assign(new PythonRuntimeError("RuntimeError","async generator raised StopAsyncIteration"),{cause:e})},meter());
  expect(()=>body.resume({kind:"send",value:null})).toThrow("async generator raised StopAsyncIteration");
  expect(body.phase).toBe("closed");
});

it.each(["generator","coroutine"] as const)("does not apply async termination conversion to a %s",kind=>{
  const error=new PythonRuntimeError("StopAsyncIteration","escaped"),isStopAsyncIteration=vi.fn(()=>true),wrapStopIteration=vi.fn(()=>new Error("converted"));
  const body=new GeneratorExecution<Value>(()=>{throw error;},{none:null,kind,enter:()=>()=>{},generatorExit:()=>new Exit(),isGeneratorExit:e=>e instanceof Exit,isStopIteration:()=>false,isStopAsyncIteration,wrapStopIteration},meter());
  expect(()=>body.resume({kind:"send",value:null})).toThrow(error);
  expect(isStopAsyncIteration).not.toHaveBeenCalled();expect(wrapStopIteration).not.toHaveBeenCalled();
});

it("releases operation ownership when cancellation follows the body result",()=>{
  const controller=new AbortController(),f=fixture([]),budget=new ExecutionBudget({maxSteps:100,maxAllocatedBytes:1000,signal:controller.signal});
  const body={delegating:true,resume(){controller.abort();return {done:false as const,value:1};}};
  const op=new AsyncGeneratorSend(body,f.activity,f.context,null,budget);
  expect(()=>op.resume({kind:"send",value:null})).toThrow(ExecutionLimitError);
  expect(op.phase).toBe("closed");expect(f.activity.running).toBe(false);
});

it.each([false,true])("handles close-signal construction failure without releasing another owner (started: %s)",started=>{
  const f=fixture([{kind:"await",value:1}]),op=f.send(),error=new ExecutionLimitError("cancelled");
  if(started)op.resume({kind:"send",value:null});else f.activity.running=true;
  f.context.generatorExit=()=>{throw error;};
  expect(()=>op.resume({kind:"close"})).toThrow(error);
  expect(op.phase).toBe("closed");expect(f.activity.running).toBe(!started);
});

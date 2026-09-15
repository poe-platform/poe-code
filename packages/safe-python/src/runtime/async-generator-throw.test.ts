import {expect,it,vi} from "vitest";
import {AsyncGeneratorThrow} from "./async-generator-throw.js";
import {ExecutionBudget,ExecutionLimitError} from "./execution-budget.js";
import {PythonRuntimeError} from "./error.js";
import type {GeneratorInput,GeneratorPhase} from "./generator-execution.js";
import type {AsyncGeneratorSendContext} from "./async-generator-send.js";

type Value=number|null;
class Exit extends Error {}
class Exhausted extends Error {}
function fixture() {
  const budget=new ExecutionBudget({maxSteps:1000,maxAllocatedBytes:10000}),activity={running:false,closed:false};
  const context:AsyncGeneratorSendContext<Value>={none:null,generatorExit:()=>new Exit(),exhausted:()=>new Exhausted(),isGeneratorExit:error=>error instanceof Exit,isStopAsyncIteration:error=>error instanceof Exhausted};
  const requests:GeneratorInput<Value>[]=[],body={phase:"suspended" as GeneratorPhase,delegating:true,resume(input:GeneratorInput<Value>){requests.push(input);return {done:false as boolean,value:1 as Value};}};
  return {budget,activity,context,requests,body,operation:(initial?:(()=>unknown))=>new AsyncGeneratorThrow(body,activity,context,initial,budget)};
}

it("allows async close to await, then completes without exposing a body value",()=>{
  const f=fixture(),op=f.operation();
  expect(op.resume({kind:"send",value:null})).toEqual({done:false,value:1});
  expect(f.requests[0]).toMatchObject({kind:"throw",error:expect.any(Exit),closeDelegate:false});
  expect(f.activity).toEqual({running:true,closed:true});
  f.body.resume=()=>({done:true,value:7});
  expect(op.resume({kind:"send",value:null})).toEqual({done:true,value:null});expect(f.activity.running).toBe(false);
  expect(()=>op.resume({kind:"send",value:null})).toThrow("cannot reuse already awaited aclose()/athrow()");
});

it("rejects an initial non-None send before constructing its termination request",()=>{
  const f=fixture(),initial=vi.fn(()=>new Error()),op=f.operation(initial);
  expect(()=>op.resume({kind:"send",value:7})).toThrow("can't send non-None value to a just-started coroutine");
  expect(initial).not.toHaveBeenCalled();expect(op.phase).toBe("created");expect(f.activity.running).toBe(false);
});

it.each([false,true])("preserves a competing owner's activity for close mode %s",closing=>{
  const f=fixture();f.activity.running=true;
  const op=f.operation(closing?undefined:()=>new Error());
  expect(()=>op.resume({kind:"send",value:null})).toThrow(`${closing?"aclose":"athrow"}(): asynchronous generator is already running`);
  expect(op.phase).toBe("closed");expect(f.activity.running).toBe(true);expect(f.requests).toEqual([]);
});

it("retains an arity-rejected initial operation for its next send",()=>{
  const f=fixture(),error=new PythonRuntimeError("TypeError","arity"),op=f.operation(()=>{throw error;});
  expect(()=>op.resume({kind:"send",value:null})).toThrow(error);
  expect(op.phase).toBe("active");expect(f.activity.running).toBe(true);expect(f.requests).toEqual([]);
  f.body.delegating=false;
  expect(op.resume({kind:"send",value:null})).toEqual({done:true,value:1});expect(op.phase).toBe("active");
});

it.each([new ExecutionLimitError("cancelled"),new Error("host failure")])("releases ownership on fatal initial preparation failure: %s",error=>{
  const f=fixture(),op=f.operation(()=>{throw error;});
  expect(()=>op.resume({kind:"send",value:null})).toThrow(error);
  expect(op.phase).toBe("closed");expect(f.activity.running).toBe(false);
});

it("does not classify a fatal body failure",()=>{
  const f=fixture(),error=new ExecutionLimitError("cancelled"),op=f.operation();
  f.body.resume=()=>{throw error;};f.context.isGeneratorExit=f.context.isStopAsyncIteration=vi.fn(()=>{throw Error("classified fatal error");});
  expect(()=>op.resume({kind:"send",value:null})).toThrow(error);
  expect(op.phase).toBe("closed");expect(f.activity.running).toBe(false);expect(f.context.isGeneratorExit).not.toHaveBeenCalled();
});

it("releases ownership when cancellation occurs after the body returns",()=>{
  const f=fixture(),controller=new AbortController(),budget=new ExecutionBudget({maxSteps:100,maxAllocatedBytes:1000,signal:controller.signal});
  f.body.resume=()=>{controller.abort();return {done:false,value:1};};
  const op=new AsyncGeneratorThrow(f.body,f.activity,f.context,undefined,budget);
  expect(()=>op.resume({kind:"send",value:null})).toThrow(ExecutionLimitError);
  expect(op.phase).toBe("closed");expect(f.activity.running).toBe(false);
});

it("closes an active athrow if constructing its exhaustion signal fails",()=>{
  const f=fixture(),op=f.operation(()=>new Error("injected")),error=new ExecutionLimitError("cancelled");
  op.resume({kind:"send",value:null});f.body.resume=()=>({done:true,value:null});f.context.exhausted=()=>{throw error;};
  expect(()=>op.resume({kind:"send",value:null})).toThrow(error);
  expect(op.phase).toBe("closed");expect(f.activity.running).toBe(false);
});

it.each([false,true])("handles close-signal construction failure without releasing another owner (started: %s)",started=>{
  const f=fixture(),op=f.operation(()=>new Error("injected")),error=new ExecutionLimitError("cancelled");
  if(started)op.resume({kind:"send",value:null});else f.activity.running=true;
  f.context.generatorExit=()=>{throw error;};
  expect(()=>op.resume({kind:"close"})).toThrow(error);
  expect(op.phase).toBe("closed");expect(f.activity.running).toBe(!started);
});

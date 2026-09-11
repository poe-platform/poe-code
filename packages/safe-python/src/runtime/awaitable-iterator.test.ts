import { expect,it,vi } from "vitest";
import { acquireAwaitableIterator,type AwaitableContext } from "./awaitable-iterator.js";
import { ExecutionBudget,ExecutionLimitError } from "./execution-budget.js";

interface Value {kind?:"coroutine"|"iterable-coroutine";await?:()=>Value;next?:boolean;name?:string}
const budget=()=>new ExecutionBudget({maxSteps:1000,maxAllocatedBytes:10000});
function fixture() {
  const context:AwaitableContext<Value>={
    nativeKind:value=>value.kind,
    lookupAwait:value=>value.await,
    hasNext:value=>value.next===true,
    typeName:value=>value.name??"X"
  };
  return context;
}

it.each(["coroutine","iterable-coroutine"] as const)("accepts a native %s without invoking guest await or iter methods",kind=>{
  const context=fixture(),value:Value={kind};context.lookupAwait=vi.fn(()=>{throw Error("unexpected lookup");});
  expect(acquireAwaitableIterator(value,context,budget())).toBe(value);expect(context.lookupAwait).not.toHaveBeenCalled();
});

it("acquires once and validates next without calling iter or advancing",()=>{
  const iterator:Value={next:true},source:Value={await:vi.fn(()=>iterator)},context=fixture();
  expect(acquireAwaitableIterator(source,context,budget())).toBe(iterator);expect(source.await).toHaveBeenCalledOnce();
});

it("rejects plain iterators that lack the await protocol",()=>{
  expect(()=>acquireAwaitableIterator({next:true,name:"iterator"},fixture(),budget())).toThrow("'iterator' object can't be awaited");
});

it.each(["list","int","NoneType"])("rejects an await method returning %s instead of an iterator",name=>{
  expect(()=>acquireAwaitableIterator({await:()=>({name})},fixture(),budget())).toThrow(`__await__() returned non-iterator of type '${name}'`);
});

it.each(["coroutine","iterable-coroutine"] as const)("rejects a %s returned by an await method",kind=>{
  expect(()=>acquireAwaitableIterator({await:()=>({kind,next:true})},fixture(),budget())).toThrow("__await__() returned a coroutine");
});

it.each(["lookup","call","validation"])("preserves an exception from await %s",where=>{
  const failure=Error(where),context=fixture(),value:Value={await:()=>({next:true})};
  if(where==="lookup")context.lookupAwait=()=>{throw failure;};
  else if(where==="call")value.await=()=>{throw failure;};
  else context.hasNext=()=>{throw failure;};
  expect(()=>acquireAwaitableIterator(value,context,budget())).toThrow(failure);
});

it("checks cancellation after acquisition before inspecting the returned object",()=>{
  const controller=new AbortController(),context=fixture(),value:Value={await:()=>{controller.abort();return {next:true};}};
  context.hasNext=vi.fn(()=>true);
  const meter=new ExecutionBudget({maxSteps:1000,maxAllocatedBytes:10000,signal:controller.signal});
  expect(()=>acquireAwaitableIterator(value,context,meter)).toThrow(ExecutionLimitError);expect(context.hasNext).not.toHaveBeenCalled();
});

it.each(["native","lookup","call","returned-native","next","missing-name","returned-name"])("checks cancellation even when %s fails",stage=>{
  const controller=new AbortController(),context=fixture(),iterator:Value={next:true},value:Value={await:()=>iterator};
  const fail=()=>{controller.abort();throw Error("callback failed after cancellation");};
  if(stage==="native")context.nativeKind=fail;
  if(stage==="lookup")context.lookupAwait=fail;
  if(stage==="call")value.await=fail;
  if(stage==="returned-native")context.nativeKind=received=>received===iterator?fail():undefined;
  if(stage==="next")context.hasNext=fail;
  if(stage==="missing-name"){value.await=undefined;context.typeName=fail;}
  if(stage==="returned-name"){iterator.next=false;context.typeName=fail;}
  const meter=new ExecutionBudget({maxSteps:1000,maxAllocatedBytes:10000,signal:controller.signal});
  expect(()=>acquireAwaitableIterator(value,context,meter)).toThrow(ExecutionLimitError);
});

it.each(["native","lookup","returned-native","next","missing-name","returned-name"])("checks cancellation after successful %s",stage=>{
  const controller=new AbortController(),context=fixture(),iterator:Value={next:true},value:Value={await:()=>iterator};
  if(stage==="native")context.nativeKind=()=>{controller.abort();return "coroutine";};
  if(stage==="lookup")context.lookupAwait=()=>{controller.abort();return value.await;};
  if(stage==="returned-native")context.nativeKind=received=>{if(received===iterator)controller.abort();return undefined;};
  if(stage==="next")context.hasNext=()=>{controller.abort();return true;};
  if(stage==="missing-name"){value.await=undefined;context.typeName=()=>{controller.abort();return "Missing";};}
  if(stage==="returned-name"){iterator.next=false;context.typeName=()=>{controller.abort();return "Invalid";};}
  const meter=new ExecutionBudget({maxSteps:1000,maxAllocatedBytes:10000,signal:controller.signal});
  expect(()=>acquireAwaitableIterator(value,context,meter)).toThrow(ExecutionLimitError);
});

it.each([["X".repeat(300),"X".repeat(100)],["é".repeat(80),"é".repeat(50)],["X"+"😀".repeat(40),"X"+"😀".repeat(24)]])("bounds await type-name diagnostics to 100 complete UTF-8 bytes: %s",(name,limited)=>{
  expect(()=>acquireAwaitableIterator({name},fixture(),budget())).toThrow(`'${limited}' object can't be awaited`);
  expect(()=>acquireAwaitableIterator({await:()=>({name})},fixture(),budget())).toThrow(`__await__() returned non-iterator of type '${limited}'`);
});

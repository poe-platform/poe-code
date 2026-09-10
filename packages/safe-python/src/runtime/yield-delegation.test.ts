import { expect, it } from "vitest";
import { ExecutionBudget, ExecutionLimitError } from "./execution-budget.js";
import { YieldDelegation, type YieldDelegationContext } from "./yield-delegation.js";

type Value = unknown;
class GuestError {
  constructor(readonly kind: string, readonly value: Value = null) {}
}
type Method = (...args: Value[]) => Value;

function fixture() {
  const meter = new ExecutionBudget({ maxSteps: 1000, maxAllocatedBytes: 10000 });
  const source = {}, iterator = {}, events: unknown[] = [], methods = new Map<string, Method>();
  let index = 0;
  const context: YieldDelegationContext<Value, object, Method> = {
    none: null,
    acquire(value) { expect(value).toBe(source); events.push("iter"); return iterator; },
    next(value) { expect(value).toBe(iterator); events.push("next"); if (index++ < 2) return index; throw new GuestError("StopIteration", 9); },
    attribute(value, name) { expect(value).toBe(iterator); events.push(`get:${name}`); const method = methods.get(name); if (method === undefined) throw new GuestError("AttributeError"); return method; },
    call(method, args) { events.push(["call", ...args]); return method(...args); },
    isException(error, kind) { return error instanceof GuestError && (kind === "BaseException" || error.kind === kind); },
    completion(error) { return error instanceof GuestError && error.kind === "StopIteration" ? { value: error.value } : undefined; },
    throwArguments(error) { return [error]; },
    normalizeThrow(error) { return error; },
    unraisable(error, value) { expect(value).toBe(iterator); events.push(["unraisable", error]); }
  };
  return { source, iterator, context, events, methods, meter, delegate: () => new YieldDelegation(source, context, meter) };
}

it("lazily acquires once and returns completion without reacquiring", () => {
  const state=fixture(), delegate=state.delegate();
  expect(state.events).toEqual([]);
  expect(delegate.start()).toEqual({kind:"yield",value:1});
  expect(delegate.resume({kind:"send",value:null})).toEqual({kind:"yield",value:2});
  expect(delegate.resume({kind:"send",value:null})).toEqual({kind:"return",value:9});
  expect(state.events).toEqual(["iter","next","next","next"]);
  expect(()=>delegate.resume({kind:"send",value:null})).toThrow("not suspended");
});

it("passes non-None sends by identity and resolves the live method anew", () => {
  const state=fixture(),delegate=state.delegate(),value={};state.methods.set("send",item=>item);
  delegate.start();expect(delegate.resume({kind:"send",value})).toEqual({kind:"yield",value});
  state.methods.set("send",()=>{throw new GuestError("StopIteration",value);});
  expect(delegate.resume({kind:"send",value:7})).toEqual({kind:"return",value});
  expect(state.events).toEqual(["iter","next","get:send",["call",value],"get:send",["call",7]]);
});

it.each([1,2,3])("forwards the original %i throw arguments without normalization", count=>{
  const state=fixture(),delegate=state.delegate(),error=new GuestError("ValueError"),raw=[{}, "payload", null].slice(0,count);
  state.context.throwArguments=supplied=>{expect(supplied).toBe(error);return raw;};
  state.context.call=(_,args)=>{expect(args).toBe(raw);return 3;};
  state.methods.set("throw",()=>3);delegate.start();
  expect(delegate.resume({kind:"throw",error})).toEqual({kind:"yield",value:3});
});

it("returns a throw method's StopIteration value",()=>{
  const state=fixture(),delegate=state.delegate();state.methods.set("throw",()=>{throw new GuestError("StopIteration",7);});
  delegate.start();expect(delegate.resume({kind:"throw",error:new GuestError("ValueError")})).toEqual({kind:"return",value:7});
});

it("does not normalize a throw accepted by the delegate",()=>{
  const state=fixture(),delegate=state.delegate();
  state.context.normalizeThrow=()=>{throw Error("must not normalize");};
  state.methods.set("throw",()=>7);delegate.start();
  expect(delegate.resume({kind:"throw",error:new GuestError("ValueError")})).toEqual({kind:"yield",value:7});
});

it.each([false,true])("keeps the delegate after rejected throw normalization (closing: %s)",closing=>{
  const state=fixture(),delegate=state.delegate(),failure=new GuestError("TypeError");
  state.context.normalizeThrow=()=>{throw failure;};
  if(closing)state.methods.set("close",()=>null);
  delegate.start();
  expect(delegate.resume({kind:"throw",error:new GuestError(closing?"GeneratorExit":"ValueError")})).toEqual({kind:"reject",error:failure});
  expect(delegate.resume({kind:"send",value:null})).toEqual({kind:"yield",value:2});
});

it("raises the original injected StopIteration if throw is absent",()=>{
  const state=fixture(),delegate=state.delegate(),error=new GuestError("StopIteration",7);
  delegate.start();expect(delegate.resume({kind:"throw",error})).toEqual({kind:"raise",error});
});

it.each([false,true])("optionally closes and reraises GeneratorExit (present: %s)",present=>{
  const state=fixture(),delegate=state.delegate(),error=new GuestError("GeneratorExit");
  if(present)state.methods.set("close",()=>99);
  delegate.start();expect(delegate.resume({kind:"throw",error})).toEqual({kind:"raise",error});
  expect(state.events).toEqual(present?["iter","next","get:close",["call"]]:["iter","next","get:close"]);
});

it.each(["ValueError","AttributeError"])("raises %s from an existing close method",kind=>{
  const state=fixture(),delegate=state.delegate(),failure=new GuestError(kind);
  state.methods.set("close",()=>{throw failure;});delegate.start();
  expect(delegate.resume({kind:"throw",error:new GuestError("GeneratorExit")})).toEqual({kind:"raise",error:failure});
});

it("returns StopIteration from close to the enclosing yield-from expression",()=>{
  const state=fixture(),delegate=state.delegate();
  state.methods.set("close",()=>{throw new GuestError("StopIteration",8);});delegate.start();
  expect(delegate.resume({kind:"throw",error:new GuestError("GeneratorExit")})).toEqual({kind:"return",value:8});
});

it.each(["ValueError","StopIteration"])("rejects %s during throw lookup and stays suspended",kind=>{
  const state=fixture(),delegate=state.delegate(),failure=new GuestError(kind);
  state.context.attribute=()=>{throw failure;};delegate.start();
  expect(delegate.resume({kind:"throw",error:new GuestError("ValueError")})).toEqual({kind:"reject",error:failure});
  expect(delegate.resume({kind:"send",value:null})).toEqual({kind:"yield",value:2});
});

it.each(["ValueError","StopIteration"])("reports %s close-lookup failures as unraisable",kind=>{
  const state=fixture(),delegate=state.delegate(),failure=new GuestError(kind),error=new GuestError("GeneratorExit");
  state.context.attribute=()=>{throw failure;};delegate.start();
  expect(delegate.resume({kind:"throw",error})).toEqual({kind:"raise",error});
  expect(state.events).toEqual(["iter","next",["unraisable",failure]]);
});

it("does not consume StopIteration from iterator acquisition",()=>{
  const state=fixture(),error=new GuestError("StopIteration",8);
  state.context.acquire=()=>{throw error;};
  expect(state.delegate().start()).toEqual({kind:"raise",error});
});

it("consumes StopIteration from send lookup",()=>{
  const state=fixture(),delegate=state.delegate();delegate.start();
  state.context.attribute=()=>{throw new GuestError("StopIteration",8);};
  expect(delegate.resume({kind:"send",value:3})).toEqual({kind:"return",value:8});
});

it("raises missing send rather than treating it as absent optional throw",()=>{
  const state=fixture(),delegate=state.delegate();delegate.start();
  const result=delegate.resume({kind:"send",value:3});
  expect(result.kind).toBe("raise");if(result.kind==="raise")expect(result.error).toEqual(new GuestError("AttributeError"));
});

it("never routes injected host failures to guest methods",()=>{
  for(const error of [Error("host"),new ExecutionLimitError("cancelled")]){
    const state=fixture(),delegate=state.delegate();delegate.start();
    expect(()=>delegate.resume({kind:"throw",error})).toThrow(error);
    expect(state.events).toEqual(["iter","next"]);
  }
});

it("bypasses completion classification for execution limits",()=>{
  const state=fixture(),error=new ExecutionLimitError("cancelled");
  state.context.next=()=>{throw error;};
  state.context.completion=()=>{throw Error("must not classify");};
  expect(()=>state.delegate().start()).toThrow(error);
});

it("charges state before allocation and checks cancellation before acquisition",()=>{
  const state=fixture();
  expect(()=>new YieldDelegation(state.source,state.context,new ExecutionBudget({maxSteps:10,maxAllocatedBytes:159}))).toThrow(ExecutionLimitError);
  const controller=new AbortController(),delegate=new YieldDelegation(state.source,state.context,new ExecutionBudget({maxSteps:10,maxAllocatedBytes:1000,signal:controller.signal}));
  controller.abort();expect(()=>delegate.start()).toThrow(ExecutionLimitError);expect(state.events).toEqual([]);
});

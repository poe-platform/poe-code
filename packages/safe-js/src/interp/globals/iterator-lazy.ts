import { isFatalSandboxError, type Budget } from "../budget.js";
import { sandboxGetProperty } from "../guest-proxy-get.js";
import { invokeBuiltinClosure } from "../builtin-call.js";
import { createDataCheckpoint } from "../data-checkpoint.js";
import { closeIterator, type SandboxIterator } from "../iteration.js";
import { iteratorHelperStates, type IteratorHelperState } from "../iterator-helper.js";
import type { IteratorWrapperState } from "../iterator-wrapper.js";
import { registerBuiltinIdentities } from "../intrinsics.js";
import { createIntrinsicObject, materializeFunctionProperties, registerIntrinsicFunction, registerIntrinsicObject, setSandboxPrototype } from "../object-model.js";
import { retainValues } from "../resources.js";
import { createIteratorResult } from "../iterator-result.js";
import { sandboxNumber } from "../string-coercion.js";
import { createSandboxClosure, isSandboxClosure, type SandboxCallContext, type SandboxClosure, type SandboxObject, type SandboxValue } from "../values.js";

export function installLazyIteratorHelpers(common: SandboxObject,budget: Budget,constructor: SandboxClosure): void {
  const prototype: SandboxObject=createIntrinsicObject();
  setSandboxPrototype(prototype,common);
  Object.defineProperty(prototype,Symbol.toStringTag,{value:"Iterator Helper",configurable:true});
  for (const operation of ["next","return"] as const) {
    Object.defineProperty(prototype,operation,{writable:true,configurable:true,value:createSandboxClosure({
      guest:true,sandbox:true,name:operation,length:0,call:async (_args,context)=>{
        context=callContext(context);
        const receiver=context?.thisValue;
        const state=receiver !== null && typeof receiver === "object" ? iteratorHelperStates.get(receiver) : undefined;
        if (state === undefined) throw new TypeError("Iterator helper method requires a branded receiver.");
        if (state.status === "executing") throw new TypeError("Iterator helper is already executing.");
        if (state.status === "done") return createIteratorResult(undefined,true,budget);
        state.status="executing";
        try {
          const outer=state.outer!;
          if (operation === "return") {
            if (state.inner !== undefined) {
              try {await closeIterator(adapter(state.inner,context))}
              catch(error) {if (!isFatalSandboxError(error)) await closeIterator(adapter(outer,context),true);throw error}
            }
            if (outer !== undefined) await closeIterator(adapter(outer,context));
            complete(state);
            return createIteratorResult(undefined,true,budget);
          }
          while (true) {
            budget.visitNode();
            if (state.method === "concat") {
              if (state.outer === undefined) {
                const input=state.iterables?.[0];
                if (input === undefined) {complete(state);return createIteratorResult(undefined,true,budget)}
                const iterator=await invokeBuiltinClosure(input.open,[],budget,context,input.iterable);
                if (iterator === null || typeof iterator !== "object") throw new TypeError("Iterator must be an object.");
                state.outer={iterator,next:undefined};
                state.outer.next=await context.getProperty!(iterator,"next");
                state.iterables!.shift();
              }
              const result=await step(state.outer,context);
              if (result.done) {state.outer=undefined;continue}
              state.status="yield";
              return result;
            }
            if (state.inner !== undefined) {
              let innerResult;
              try {innerResult=await step(state.inner,context)}
              catch(error) {if (!isFatalSandboxError(error)) await closeIterator(adapter(outer,context),true);throw error}
              if (!innerResult.done) {state.status="yield";return innerResult}
              state.inner=undefined;
            }
            if (state.method === "take" && state.remaining === 0) {
              await closeIterator(adapter(outer,context));
              complete(state);
              return createIteratorResult(undefined,true,budget);
            }
            const skipping=state.method === "drop" && state.remaining>0;
            if ((state.method === "take" || skipping) && state.remaining !== Infinity) state.remaining--;
            const result=await step(outer,context,skipping);
            if (result.done) {complete(state);return result}
            if (skipping) continue;
            if (state.method === "take" || state.method === "drop") {state.status="yield";return result}
            let mapped: SandboxValue;
            const release=retainValues(budget,()=>[result.value,mapped]);
            try {
              try {
                mapped=await invokeBuiltinClosure(state.callback as SandboxClosure,[result.value,state.index++],budget,context,undefined);
                if (state.method === "flatMap") {
                  if (mapped === null || typeof mapped !== "object") throw new TypeError("flatMap callback must return an object.");
                  const method=await context.getProperty!(mapped,Symbol.iterator);
                  let inner=mapped;
                  if (method !== undefined && method !== null) {
                    if (!isSandboxClosure(method)) throw new TypeError("Symbol.iterator must be callable.");
                    const value=await invokeBuiltinClosure(method,[],budget,context,mapped);
                    if (value === null || typeof value !== "object") throw new TypeError("Inner iterator must be an object.");
                    inner=value;
                  }
                  state.inner={iterator:inner,next:await context.getProperty!(inner,"next")};
                }
              } catch(error) {if (!isFatalSandboxError(error)) await closeIterator(adapter(outer,context),true);throw error}
              if (state.method === "map") {state.status="yield";return createIteratorResult(mapped,false,budget)}
              if (state.method === "filter" && mapped) {state.status="yield";return result}
            } finally {release()}
          }
        } catch(error) {complete(state);throw error}
      }
    })});
  }
  for (const method of ["map","filter","take","drop","flatMap"] as const) {
    Object.defineProperty(common,method,{writable:true,configurable:true,value:createSandboxClosure({
      guest:true,sandbox:true,name:method,length:1,call:async ([argument],context)=>{
        context=callContext(context);
        const receiver=context?.thisValue;
        if (receiver === null || typeof receiver !== "object") throw new TypeError("Iterator helper requires an object.");
        const outer: IteratorWrapperState={iterator:receiver,next:undefined};
        let remaining=0;
        try {
          if (method === "take" || method === "drop") {
            const number=await sandboxNumber(argument,budget,context);
            if (Number.isNaN(number)) throw new RangeError("Iterator limit must not be NaN.");
            remaining=Math.trunc(number);
            if (remaining<0) throw new RangeError("Iterator limit must not be negative.");
          } else if (!isSandboxClosure(argument)) throw new TypeError("Iterator callback must be callable.");
        } catch(error) {if (!isFatalSandboxError(error)) await closeIterator(adapter(outer,context),true);throw error}
        outer.next=await context.getProperty!(receiver,"next");
        const helper: SandboxObject=Object.create(null);
        iteratorHelperStates.set(helper,{method,status:"start",outer,callback:method === "take" || method === "drop" ? undefined : argument,remaining,index:0});
        setSandboxPrototype(helper,prototype,budget);
        createDataCheckpoint(budget,context)(helper,0,true);
        return helper;
      }
    })});
  }
  const concat=createSandboxClosure({guest:true,sandbox:true,name:"concat",length:0,call:async (items,context)=>{
    context=callContext(context);
    const helper: SandboxObject=Object.create(null);
    const iterables: NonNullable<IteratorHelperState["iterables"]>=[];
    iteratorHelperStates.set(helper,{method:"concat",status:"start",iterables,callback:undefined,remaining:0,index:0});
    setSandboxPrototype(helper,prototype,budget);
    const release=retainValues(budget,()=>[helper,...items]);
    try {
      for (const iterable of items) {
        budget.visitNode();
        if (iterable === null || typeof iterable !== "object") throw new TypeError("Iterator.concat inputs must be objects.");
        const open=await context.getProperty!(iterable,Symbol.iterator);
        if (!isSandboxClosure(open)) throw new TypeError("Iterator.concat inputs must be iterable.");
        iterables.push({iterable,open});
        createDataCheckpoint(budget,context)(helper,0,true);
      }
      createDataCheckpoint(budget,context)(helper,0,true);
      return helper;
    } finally {release()}
  }});
  Object.defineProperty(materializeFunctionProperties(constructor),"concat",{value:concat,writable:true,configurable:true});
  registerBuiltinIdentities(budget,{Iterator:constructor,"%IteratorPrototype%":common,"%IteratorHelperPrototype%":prototype});
  registerIntrinsicFunction(budget,concat);
  registerIntrinsicObject(budget,prototype);
  registerIntrinsicObject(budget,common);

  function adapter(record: IteratorWrapperState,context: SandboxCallContext): SandboxIterator {
    return {asynchronous:true,next:async ()=>{
      if (!isSandboxClosure(record.next)) throw new TypeError("Iterator next must be callable.");
      const result=await invokeBuiltinClosure(record.next,[],budget,context,record.iterator);
      if (result === null || typeof result !== "object") throw new TypeError("Iterator result must be an object.");
      return result as unknown as IteratorResult<SandboxValue>;
    },getOperation:async ()=>{
      const method=await context.getProperty!(record.iterator,"return");
      if (method === undefined || method === null) return undefined;
      if (!isSandboxClosure(method)) throw new TypeError("Iterator return must be callable.");
      return async ()=>await invokeBuiltinClosure(method,[],budget,context,record.iterator) as unknown as IteratorResult<SandboxValue>;
    }};
  }
  async function step(record: IteratorWrapperState,context: SandboxCallContext,skipValue=false): Promise<{value:SandboxValue;done:boolean}> {
    let result: SandboxValue;
    const release=retainValues(budget,()=>[result]);
    try {
      result=await adapter(record,context).next() as unknown as SandboxValue;
      if (await context.getProperty!(result,"done")) return createIteratorResult(undefined,true,budget);
      return createIteratorResult(skipValue ? undefined : await context.getProperty!(result,"value"),false,budget);
    } finally {release()}
  }
  function callContext(context?: SandboxCallContext): SandboxCallContext {
    const caller: SandboxCallContext = {
      ...context,stack:context?.stack??[],thisValue:context?.thisValue,
      getProperty:context?.getProperty??((value,key)=>sandboxGetProperty(value,key,value,budget,bridge))
    };
    const bridge: SandboxCallContext = {
      ...caller,
      invokeClosure:context?.invokeClosure??((callee,args,receiver,construct,newTarget)=>
        invokeBuiltinClosure(callee,args,budget,caller,receiver,construct,newTarget))
    };
    return bridge;
  }
}

function complete(state: IteratorHelperState): void {
  state.status="done";
  state.outer=undefined;
  state.inner=undefined;
  state.iterables=undefined;
  state.callback=undefined;
}

import { PythonRuntimeError } from "./error.js";
import { ExecutionLimitError,type ExecutionMeter } from "./execution-budget.js";
import type { GeneratorDelegation, GeneratorInput } from "./generator-execution.js";
import { RuntimeRaisedException, type RuntimeExceptionExecution } from "./runtime-exception-execution.js";
import { runtimeExceptionPayload } from "./runtime-exception-state.js";
import { RuntimeGeneratorThrowRequest,throwRuntimeGenerator } from "./runtime-generator-throw-request.js";
import { acquireRuntimeIterator } from "./runtime-iterator-acquisition.js";
import type { BuiltinInvocationContext, RuntimeValue, RuntimeValues } from "./runtime-values.js";
import { YieldDelegation, type YieldDelegationResult } from "./yield-delegation.js";
import { acquireAwaitableIterator } from "./awaitable-iterator.js";

/** Bridge suspended expression cursors to caller-side delegation handling.
 * Rejected requests never enter the host cursor; accepted returns/errors do.
 * Only ordinary throw lookup runs in the caller's frame. */
export class RuntimeGeneratorDelegation implements GeneratorDelegation<RuntimeValue> {
  #current:YieldDelegation<RuntimeValue,RuntimeValue,RuntimeValue>|undefined;
  #pending:YieldDelegationResult<RuntimeValue>|undefined;
  #run:(<Result>(operation:()=>Result,preserveCallerException?:boolean)=>Result)|undefined;
  #throwing=false;
  constructor(private readonly values:RuntimeValues,private readonly exceptions:RuntimeExceptionExecution,private readonly meter:ExecutionMeter,private readonly report?:(error:unknown,iterator:RuntimeValue)=>void) {
    meter.checkpoint(1,128);
  }
  get active():boolean{return this.#current!==undefined;}
  get target():RuntimeValue|undefined{return this.#current?.iterator;}

  #owned<Result>(operation:()=>Result,bodyActive=false):Result {
    const prepared=()=>{try{return operation();}catch(error){throw this.exceptions.prepare(error);}};
    this.meter.checkpoint(0,64);
    return bodyActive||this.#run===undefined?prepared():this.#run(prepared,this.#throwing);
  }

  *delegate(source:RuntimeValue,invocation:BuiltinInvocationContext,awaiting:boolean|"anext"=false):Generator<RuntimeValue,RuntimeValue,RuntimeValue> {
    const {values,exceptions,meter}=this;
    meter.checkpoint(0,768);
    // Initial iteration already executes inside the body. A reentrant lookup
    // may leave an older request's runner on the stack while reaching here.
    let starting=true;
    const current=new YieldDelegation(source,{
      none:values.none,
      acquire:value=>{
        if(!awaiting) {
          if(value.kind==="instance"&&value.native?.kind==="coroutine")throw new PythonRuntimeError("TypeError","cannot 'yield from' a coroutine object in a non-coroutine generator");
          return acquireRuntimeIterator(value,values,meter,invocation.iteration);
        }
        meter.checkpoint(0,160);
        let iterator:RuntimeValue;
        try {iterator=acquireAwaitableIterator(value,{
          nativeKind:value=>value.kind==="instance"&&value.native?.kind==="coroutine"?"coroutine":undefined,
          lookupAwait:value=>{
            const method=invocation.lookupSpecial!(value,"__await__");
            if(method===undefined)return undefined;
            meter.checkpoint(0,64);return ()=>invocation.call(method,[]);
          },
          hasNext:value=>invocation.iteration!.hasNext(value),
          typeName:value=>invocation.typeName!(value)
        },meter);}catch(error) {
          if(awaiting!=="anext"||error instanceof ExecutionLimitError)throw error;
          throw exceptions.caused(error,"TypeError",`'async for' received an invalid object from __anext__: ${invocation.typeName!(value)}`);
        }
        if(awaiting!=="anext"&&iterator.kind==="instance"&&iterator.native?.kind==="coroutine"&&iterator.native.execution.delegating)
          throw new PythonRuntimeError("RuntimeError","coroutine is being awaited already");
        return iterator;
      },
      next:iterator=>this.#owned(()=>{
        if(iterator.kind==="instance"&&iterator.native?.kind==="coroutine") {
          const state=iterator.native,step=state.execution.resume({kind:"send",value:values.none});
          if(step.done)throw state.exceptions.completion(step.value);
          return step.value;
        }
        if(iterator.kind!=="iterator")return invocation.iteration!.next(iterator);
        const step=iterator.value.next();meter.checkpoint();
        if(!step.done)return step.value;
        if(step.exception!==undefined)throw step.exception.value;
        throw exceptions.completion(values.none);
      },starting),
      attribute:(iterator,name)=>{
        const lookup=()=>invocation.attribute!(iterator,name);
        if(name!=="throw")return this.#owned(lookup,starting);
        try{return lookup();}catch(error){throw exceptions.prepare(error);}
      },
      call:(method,args)=>this.#owned(()=>{
        const binding=method.kind==="builtin_function_or_method"?method.binding:undefined,target=binding?.instance;
        if(target?.kind==="instance"&&(target.native?.kind==="generator"||target.native?.kind==="coroutine")&&binding!.implementation.value.owner===target.type&&binding!.implementation.value.name==="throw")
          return throwRuntimeGenerator(target.native,args,invocation,values,meter);
        return invocation.call(method,args);
      },starting),
      isException:(error,name)=>error instanceof RuntimeGeneratorThrowRequest?name==="BaseException"||name==="GeneratorExit"&&exceptions.matchesThrowTarget(error.arguments[0],"GeneratorExit"):exceptions.matches(error,name),
      completion:error=>{
        if(!exceptions.matches(error,"StopIteration"))return undefined;
        meter.checkpoint(0,32);
        return {value:error instanceof RuntimeRaisedException?runtimeExceptionPayload(error.value)!.member("value",meter)??values.none:values.none};
      },
      throwArguments:error=>{
        if(error instanceof RuntimeGeneratorThrowRequest)return error.arguments;
        if(!(error instanceof RuntimeRaisedException))throw Error("delegated throw requires a native exception or raw request");
        meter.checkpoint(0,8);return [error.value];
      },
      normalizeThrow:error=>{
        if(!(error instanceof RuntimeGeneratorThrowRequest))return error;
        const args=error.arguments;
        if(args.length===3&&args[2].kind!=="none")throw new PythonRuntimeError("TypeError","throw() third argument must be a traceback object");
        return exceptions.throwError(args[0],args[1]??values.none,error.invocation);
      },
      unraisable:(error,iterator)=>{this.report?.(error,iterator);}
    },meter);
    let step=current.start();starting=false;
    try {
      while(step.kind==="yield") {
        this.#current=current;
        yield step.value;
        if(this.#pending===undefined)throw Error("delegated cursor resumed without a protocol result");
        step=this.#pending;this.#pending=undefined;
      }
    } finally {if(this.#current===current)this.#current=undefined;this.#pending=undefined;}
    if(step.kind==="return")return step.value;
    throw step.error;
  }

  resume(input:GeneratorInput<RuntimeValue>,run:<Result>(operation:()=>Result,preserveCallerException?:boolean)=>Result):ReturnType<GeneratorDelegation<RuntimeValue>["resume"]> {
    if(this.#current===undefined)throw Error("no active native delegation");
    const current=this.#current,previousRun=this.#run,previousThrowing=this.#throwing;
    this.#run=run;this.#throwing=input.kind==="throw";
    let step:YieldDelegationResult<RuntimeValue>;
    try {step=current.resume(input);}finally {this.#run=previousRun;this.#throwing=previousThrowing;}
    if(step.kind==="yield")return {kind:"yield",value:step.value};
    if(step.kind==="reject")return {kind:"reject",error:step.error};
    if(step.kind==="raise")return {kind:"resume",input:{kind:"throw",error:step.error}};
    // Reentrant lookup can move the instruction pointer. Completion belongs to
    // the now-suspended yield-from, or is injected at an ordinary yield/exit.
    if(this.#current===undefined)return {kind:"resume",input:{kind:"throw",error:this.exceptions.completion(step.value)}};
    this.meter.checkpoint(0,64);this.#pending=step;
    return {kind:"resume",input:{kind:"send",value:this.values.none}};
  }
}

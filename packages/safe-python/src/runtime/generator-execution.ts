import { PythonRuntimeError } from "./error.js";
import { ExecutionLimitError,type ExecutionMeter } from "./execution-budget.js";

export type GeneratorInput<Value>={readonly kind:"send";readonly value:Value}|{
  readonly kind:"throw";readonly error:unknown;
  /** Async termination forwards GeneratorExit through throw so cleanup may await. */
  readonly closeDelegate?:boolean;
};
export type GeneratorRequest<Value>=GeneratorInput<Value>|{readonly kind:"close"};
export type GeneratorPhase="created"|"running"|"suspended"|"closed";
export type GeneratorKind="generator"|"coroutine"|"async generator";

export interface GeneratorDelegation<Value> {
  readonly active:boolean;
  /** Optional guest-visible iterator identity; lifecycle gates its visibility. */
  readonly target?:Value;
  /** Throw lookup runs before body activation; callbacks selectively enter the
   * owning frame for operations whose Python semantics require it. */
  resume(input:GeneratorInput<Value>,run:<Result>(operation:()=>Result,preserveCallerException?:boolean,activateFrame?:boolean)=>Result):
    {readonly kind:"yield";readonly value:Value}|{readonly kind:"reject";readonly error:unknown}|{readonly kind:"resume";readonly input:GeneratorInput<Value>};
}

export interface GeneratorExecutionContext<Value> {
  readonly none:Value;
  /** Optional interpreter activation; released with the body on termination. */
  readonly frame?:object;
  readonly kind?:GeneratorKind;
  readonly delegation?:GeneratorDelegation<Value>;
  /** Host-only frame/handled-exception activation. Failure must restore its own
   * partial entry; successful entry returns unmetered, non-throwing cleanup.
   * This hook must not run guest code. */
  enter():()=>void;
  /** Delegated throw/close retains caller exception state. Close also skips
   * activation of the suspended delegating frame while retaining depth guards. */
  enterDelegated?(activateFrame:boolean):()=>void;
  /** Trusted, unmetered and non-throwing storage cleanup. Runs once when the
   * body is discarded, including failures before a suspended driver resumes. */
  finish?():void;
  generatorExit():unknown;
  isGeneratorExit(error:unknown):boolean;
  isStopIteration(error:unknown):boolean;
  /** Only async-generator bodies convert escaping StopAsyncIteration. */
  isStopAsyncIteration?(error:unknown):boolean;
  /** Construct native RuntimeError with the original StopIteration as cause
   * and context, bypassing guest exception constructors. Also handles escaping
   * StopAsyncIteration for async generators. Runs before deactivation. */
  wrapStopIteration(error:unknown):unknown;
}

/** Lifecycle for a trusted resumable Python body. The driver owns instruction
 * continuations, yield delegation and metering inside each resume; it returns
 * completion explicitly rather than throwing StopIteration for a normal return.
 * Native descriptors own argument validation/throw normalization before entry.
 * This state machine alone does not implement guest generator objects or yields. */
export class GeneratorExecution<Value> {
  #phase:GeneratorPhase="created";
  #driver:((input:GeneratorInput<Value>)=>IteratorResult<Value,Value>)|undefined;
  #context:GeneratorExecutionContext<Value>|undefined;
  readonly #none:Value;
  readonly #kind:GeneratorKind;
  constructor(driver:(input:GeneratorInput<Value>)=>IteratorResult<Value,Value>,context:GeneratorExecutionContext<Value>,private readonly meter:ExecutionMeter) {
    meter.checkpoint(1,120);this.#driver=driver;this.#context=context;this.#none=context.none;this.#kind=context.kind??"generator";Object.freeze(this);
  }
  get phase():GeneratorPhase{return this.#phase;}
  get frame():object|undefined{return this.#context?.frame;}
  get delegating():boolean{return this.#phase==="suspended"&&this.#context?.delegation?.active===true;}
  get yieldFrom():Value{return this.delegating?this.#context!.delegation!.target??this.#none:this.#none;}

  #runDelegated<Result>(operation:()=>Result,context:GeneratorExecutionContext<Value>,preserveCallerException=false,activateFrame=true):Result {
    const previous=this.#phase;
    if(previous==="running")throw new PythonRuntimeError("ValueError",`${this.#kind} already executing`);
    this.#phase="running";
    let restore:()=>void;
    try {restore=preserveCallerException&&context.enterDelegated!==undefined?context.enterDelegated(activateFrame):context.enter();}
    catch(error){this.#phase=previous;throw error;}
    try {this.meter.checkpoint();const result=operation();this.meter.checkpoint();return result;}
    finally {this.#phase=previous;restore();}
  }

  #finish():void {
    const context=this.#context;
    this.#phase="closed";this.#driver=undefined;this.#context=undefined;
    context?.finish?.();
  }

  resume(request:GeneratorRequest<Value>):IteratorResult<Value,Value> {
    const {meter}=this;
    meter.checkpoint(1,64);
    if(this.#phase==="running")throw new PythonRuntimeError("ValueError",`${this.#kind} already executing`);
    if(this.#phase==="closed"&&this.#kind==="coroutine"&&request.kind!=="close")throw new PythonRuntimeError("RuntimeError","cannot reuse already awaited coroutine");
    if(this.#phase==="created"&&request.kind==="send"&&request.value!==this.#none)
      throw new PythonRuntimeError("TypeError",`can't send non-None value to a just-started ${this.#kind}`);
    if(this.#phase==="closed"||this.#phase==="created"&&request.kind!=="send") {
      this.#finish();
      if(request.kind==="throw")throw request.error;
      return {done:true,value:this.#none};
    }
    const context=this.#context!;
    let input:GeneratorInput<Value>=request.kind==="close"?{kind:"throw",error:context.generatorExit()}:request;
    if(this.delegating) {
      let delegated:ReturnType<GeneratorDelegation<Value>["resume"]>;
      try {
        meter.checkpoint(0,64);
        delegated=context.delegation!.resume(input,(operation,preserve,activate)=>this.#runDelegated(operation,context,preserve,activate));
        meter.checkpoint();
      } catch(error){this.#finish();throw error;}
      if(delegated.kind==="reject")throw delegated.error;
      if(delegated.kind==="yield") {
        if(request.kind==="close")throw new PythonRuntimeError("RuntimeError",`${this.#kind} ignored GeneratorExit`);
        return {done:false,value:delegated.value};
      }
      input=delegated.input;
      // Throw lookup may reenter and finish this generator before the captured
      // delegate method returns. Never revive a cleared body in that case.
      if(this.phase==="closed") {
        if(input.kind==="throw")throw input.error;
        return {done:true,value:this.#none};
      }
    }
    meter.checkpoint();
    const previous=this.#phase;
    this.#phase="running";
    let restore:()=>void;
    try {restore=context.enter();}
    catch(error){this.#phase=previous;throw error;}
    try {
      let result:IteratorResult<Value,Value>;
      let done:boolean;
      try {
        meter.checkpoint();
        result=this.#driver!(input);
        done=result.done===true;
        meter.checkpoint();
      } catch(error) {
        this.#finish();
        if(error instanceof ExecutionLimitError)throw error;
        if(context.isStopIteration(error)||this.#kind==="async generator"&&context.isStopAsyncIteration?.(error))throw context.wrapStopIteration(error);
        if(request.kind==="close"&&context.isGeneratorExit(error))return {done:true,value:this.#none};
        throw error;
      }
      if(done) {
        this.#finish();
        return result;
      }
      this.#phase="suspended";
      // This error belongs to the close caller. The body remains suspended at
      // its illicit yield and can still be resumed or closed again.
      if(request.kind==="close")throw new PythonRuntimeError("RuntimeError",`${this.#kind} ignored GeneratorExit`);
      return result;
    } finally {restore();}
  }
}

import { PythonRuntimeError } from "./error.js";
import { ExecutionLimitError,type ExecutionMeter } from "./execution-budget.js";

export type GeneratorInput<Value>={readonly kind:"send";readonly value:Value}|{readonly kind:"throw";readonly error:unknown};
export type GeneratorRequest<Value>=GeneratorInput<Value>|{readonly kind:"close"};
export type GeneratorPhase="created"|"running"|"suspended"|"closed";

export interface GeneratorDelegation<Value> {
  readonly active:boolean;
  /** Optional guest-visible iterator identity; lifecycle gates its visibility. */
  readonly target?:Value;
  /** Throw lookup runs before body activation; callbacks selectively enter the
   * owning frame for operations whose Python semantics require it. */
  resume(input:GeneratorInput<Value>,run:<Result>(operation:()=>Result,preserveCallerException?:boolean)=>Result):
    {readonly kind:"yield";readonly value:Value}|{readonly kind:"reject";readonly error:unknown}|{readonly kind:"resume";readonly input:GeneratorInput<Value>};
}

export interface GeneratorExecutionContext<Value> {
  readonly none:Value;
  readonly delegation?:GeneratorDelegation<Value>;
  /** Host-only frame/handled-exception activation. Failure must restore its own
   * partial entry; successful entry returns unmetered, non-throwing cleanup.
   * This hook must not run guest code. */
  enter():()=>void;
  /** Delegated throw/close calls link the frame but retain caller exception
   * state, unlike normal body/send activation. */
  enterDelegated?():()=>void;
  generatorExit():unknown;
  isGeneratorExit(error:unknown):boolean;
  isStopIteration(error:unknown):boolean;
  /** Construct native RuntimeError with the original StopIteration as cause
   * and context, bypassing guest exception constructors. Runs before deactivation. */
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
  constructor(driver:(input:GeneratorInput<Value>)=>IteratorResult<Value,Value>,context:GeneratorExecutionContext<Value>,private readonly meter:ExecutionMeter) {
    meter.checkpoint(1,112);this.#driver=driver;this.#context=context;this.#none=context.none;Object.freeze(this);
  }
  get phase():GeneratorPhase{return this.#phase;}
  get delegating():boolean{return this.#phase==="suspended"&&this.#context?.delegation?.active===true;}
  get yieldFrom():Value{return this.delegating?this.#context!.delegation!.target??this.#none:this.#none;}

  #runDelegated<Result>(operation:()=>Result,context:GeneratorExecutionContext<Value>,preserveCallerException=false):Result {
    const previous=this.#phase;
    if(previous==="running")throw new PythonRuntimeError("ValueError","generator already executing");
    this.#phase="running";
    let restore:()=>void;
    try {restore=preserveCallerException&&context.enterDelegated!==undefined?context.enterDelegated():context.enter();}
    catch(error){this.#phase=previous;throw error;}
    try {this.meter.checkpoint();const result=operation();this.meter.checkpoint();return result;}
    finally {this.#phase=previous;restore();}
  }

  #finish():void {
    this.#phase="closed";this.#driver=undefined;this.#context=undefined;
  }

  resume(request:GeneratorRequest<Value>):IteratorResult<Value,Value> {
    const {meter}=this;
    meter.checkpoint(1,64);
    if(this.#phase==="running")throw new PythonRuntimeError("ValueError","generator already executing");
    if(this.#phase==="created"&&request.kind==="send"&&request.value!==this.#none)
      throw new PythonRuntimeError("TypeError","can't send non-None value to a just-started generator");
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
        delegated=context.delegation!.resume(input,(operation,preserve)=>this.#runDelegated(operation,context,preserve));
        meter.checkpoint();
      } catch(error){this.#finish();throw error;}
      if(delegated.kind==="reject")throw delegated.error;
      if(delegated.kind==="yield") {
        if(request.kind==="close")throw new PythonRuntimeError("RuntimeError","generator ignored GeneratorExit");
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
        if(context.isStopIteration(error))throw context.wrapStopIteration(error);
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
      if(request.kind==="close")throw new PythonRuntimeError("RuntimeError","generator ignored GeneratorExit");
      return result;
    } finally {restore();}
  }
}

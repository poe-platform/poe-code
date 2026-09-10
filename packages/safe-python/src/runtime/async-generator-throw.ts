import {ExecutionLimitError,type ExecutionMeter} from "./execution-budget.js";
import {PythonRuntimeError} from "./error.js";
import type {GeneratorExecution,GeneratorInput,GeneratorRequest} from "./generator-execution.js";
import type {AsyncGeneratorActivity,AsyncGeneratorSendContext} from "./async-generator-send.js";

/** Athrow/aclose awaitable lifecycle. An absent initial request means aclose;
 * otherwise the factory validates the stored athrow arity at first send.
 * Unlike asend, athrow send completion after an await can remain resumable.
 * The body owns exception normalization, delegation and frame activation. */
export class AsyncGeneratorThrow<Value> {
  #phase:"created"|"active"|"closed"="created";
  constructor(
    private readonly body:Pick<GeneratorExecution<Value>,"resume"|"delegating"|"phase">,
    private readonly activity:AsyncGeneratorActivity,
    private readonly context:AsyncGeneratorSendContext<Value>,
    private readonly initial:(()=>unknown)|undefined,
    private readonly meter:ExecutionMeter
  ){meter.checkpoint(1,120);Object.freeze(this);}
  get phase():"created"|"active"|"closed" {return this.#phase;}

  resume(request:GeneratorRequest<Value>):IteratorResult<Value,Value> {
    this.meter.checkpoint(1,64);
    if(request.kind!=="close")return this.#advance(request);
    if(this.#phase==="closed")return {done:true,value:this.context.none};
    let exit:unknown;
    try {exit=this.context.generatorExit();}
    catch(error){
      if(this.#phase==="active")this.activity.running=false;
      this.#phase="closed";throw error;
    }
    try {
      const result=this.#advance({kind:"throw",error:exit});
      if(result.done)return {done:true,value:this.context.none};
    }catch(error){
      if(error instanceof ExecutionLimitError)throw error;
      if(this.context.isGeneratorExit(error)||this.context.isStopAsyncIteration(error))return {done:true,value:this.context.none};
      throw error;
    }
    throw new PythonRuntimeError("RuntimeError","coroutine ignored GeneratorExit");
  }

  #advance(input:GeneratorInput<Value>):IteratorResult<Value,Value> {
    if(this.#phase==="closed")throw new PythonRuntimeError("RuntimeError","cannot reuse already awaited aclose()/athrow()");
    const {activity,context}=this,closing=this.initial===undefined,throwing=input.kind==="throw";
    if(!throwing&&this.body.phase==="closed") {this.#phase="closed";return {done:true,value:context.none};}
    let initialSend=false;
    if(this.#phase==="created") {
      if(activity.running) {
        this.#phase="closed";
        throw new PythonRuntimeError("RuntimeError",`${closing?"aclose":"athrow"}(): asynchronous generator is already running`);
      }
      if(input.kind==="send") {
        if(activity.closed){this.#phase="closed";throw context.exhausted();}
        if(input.value!==context.none)throw new PythonRuntimeError("RuntimeError","can't send non-None value to a just-started coroutine");
      }
      this.#phase="active";activity.running=true;
      if(!throwing) {
        initialSend=true;
        if(closing)activity.closed=true;
        try {input={kind:"throw",error:closing?context.generatorExit():this.initial!(),closeDelegate:false};}
        catch(error){
          // Native arity rejection preserves the activated operation. Opaque
          // host failures and cancellation release ownership without callbacks.
          if(!(error instanceof PythonRuntimeError&&error.name==="TypeError")){activity.running=false;this.#phase="closed";}
          throw error;
        }
      }
    }
    const terminal=initialSend||throwing||closing;
    let result:IteratorResult<Value,Value>;
    try {result=this.body.resume(input);this.meter.checkpoint();}
    catch(error){
      activity.running=false;
      if(terminal||error instanceof ExecutionLimitError)this.#phase="closed";
      if(error instanceof ExecutionLimitError)throw error;
      const ended=context.isGeneratorExit(error)||context.isStopAsyncIteration(error);
      if(ended&&closing)return {done:true,value:context.none};
      if(ended)activity.closed=true;
      throw error;
    }
    if(result.done) {
      activity.running=false;
      if(terminal)this.#phase="closed";
      if(closing)return {done:true,value:context.none};
      activity.closed=true;
      let exhausted:unknown;
      try {exhausted=context.exhausted();}
      catch(error){this.#phase="closed";throw error;}
      throw exhausted;
    }
    if(this.body.delegating)return result;
    activity.running=false;
    if(terminal)this.#phase="closed";
    if(closing)throw new PythonRuntimeError("RuntimeError","async generator ignored GeneratorExit");
    return {done:true,value:result.value};
  }
}

import {ExecutionLimitError,type ExecutionMeter} from "./execution-budget.js";
import {PythonRuntimeError} from "./error.js";
import type {GeneratorExecution,GeneratorInput,GeneratorRequest} from "./generator-execution.js";

/** Shared by all operations on one async generator. Body execution and logical
 * closure are distinct from ownership retained across an awaited suspension. */
export interface AsyncGeneratorActivity {running:boolean;closed:boolean}
export interface AsyncGeneratorSendContext<Value> {
  readonly none:Value;
  generatorExit():unknown;
  isGeneratorExit(error:unknown):boolean;
  isStopAsyncIteration(error:unknown):boolean;
  exhausted():unknown;
}

/** Awaitable asend/anext operation around a trusted generator continuation.
 * A delegated yield is an await suspension; an ordinary yield completes this
 * operation with an item. Native wrappers translate completion to StopIteration.
 * Body-level StopIteration/StopAsyncIteration conversion belongs to the driver.
 */
export class AsyncGeneratorSend<Value> {
  #phase:"created"|"active"|"closed"="created";
  constructor(
    private readonly body:Pick<GeneratorExecution<Value>,"resume"|"delegating">,
    private readonly activity:AsyncGeneratorActivity,
    private readonly context:AsyncGeneratorSendContext<Value>,
    private readonly initial:Value,
    private readonly meter:ExecutionMeter
  ) {meter.checkpoint(1,120);Object.freeze(this);}
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
    } catch(error) {
      if(error instanceof ExecutionLimitError)throw error;
      if(this.context.isGeneratorExit(error)||this.context.isStopAsyncIteration(error))return {done:true,value:this.context.none};
      throw error;
    }
    // Synchronous wrapper close cannot drive an await in the cleanup body.
    // The operation retains that suspension and can be resumed or closed again.
    throw new PythonRuntimeError("RuntimeError","coroutine ignored GeneratorExit");
  }

  #advance(input:GeneratorInput<Value>):IteratorResult<Value,Value> {
    if(this.#phase==="closed")throw new PythonRuntimeError("RuntimeError","cannot reuse already awaited __anext__()/asend()");
    const {activity,context}=this;
    if(this.#phase==="created") {
      if(activity.running) {
        this.#phase="closed";
        throw new PythonRuntimeError("RuntimeError","anext(): asynchronous generator is already running");
      }
      if(input.kind==="send"&&input.value===context.none)input={kind:"send",value:this.initial};
      this.#phase="active";activity.running=true;
    } else if(input.kind==="send")activity.running=true;
    let result:IteratorResult<Value,Value>;
    try {
      result=this.body.resume(input);
      this.meter.checkpoint();
    } catch(error) {
      activity.running=false;this.#phase="closed";
      if(error instanceof ExecutionLimitError)throw error;
      if(context.isGeneratorExit(error)||context.isStopAsyncIteration(error))activity.closed=true;
      throw error;
    }
    if(result.done) {
      activity.running=false;activity.closed=true;this.#phase="closed";
      throw context.exhausted();
    }
    if(this.body.delegating)return result;
    activity.running=false;this.#phase="closed";
    return {done:true,value:result.value};
  }
}

import type {ExecutionMeter} from "./execution-budget.js";
import type {CompletionIterator,CompletionResult} from "./iterator-completion.js";
import type {IterationContext} from "./protocol-iterator.js";

/** Advance an already acquired guest iterator, never calling iter again.
 * Guest exhaustion belongs to one pull; native completion is already classified. */
export class PreparedIterator<Value> implements CompletionIterator<Value> {
  readonly #native:CompletionIterator<Value>|undefined;
  constructor(private readonly iterator:Value,private readonly context:Pick<IterationContext<Value>,"next"|"nativeIterator"|"isStopIteration">,private readonly meter:ExecutionMeter){
    meter.checkpoint(1,64);
    try{this.#native=context.nativeIterator?.(iterator);}finally{meter.checkpoint();}
  }
  next():CompletionResult<Value>{
    const {meter,context}=this;meter.checkpoint(1,16);
    if(this.#native!==undefined){
      try{return this.#native.next();}finally{meter.checkpoint();}
    }
    let value:Value;
    try{value=context.next(this.iterator);}
    catch(error){
      meter.checkpoint();
      const ended=context.isStopIteration(error);meter.checkpoint();
      if(!ended)throw error;
      meter.checkpoint(0,32);return {done:true,value:undefined,exception:{value:error}};
    }
    meter.checkpoint();return {done:false,value};
  }
}

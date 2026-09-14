import type {ConstantValues} from "./constant-values.js";
import {PythonRuntimeError} from "./error.js";
import {ExecutionLimitError,type ExecutionMeter} from "./execution-budget.js";
import {runtimeBytesPayload} from "./runtime-bytes-payload.js";
import {runtimeIntegerPayload} from "./runtime-integer-payload.js";
import type {RuntimeValue,RuntimeValues,TypeValue} from "./runtime-values.js";

/** The cursor retains the original exporter, including a bytes subtype. Reaching
 * its length does not release it until a subsequent next observes exhaustion. */
export class RuntimeBytesIterator implements IterableIterator<RuntimeValue> {
  #source:RuntimeValue|undefined;
  #index=0;
  readonly #length:number;
  constructor(source:RuntimeValue,private readonly values:ConstantValues,private readonly meter:ExecutionMeter){
    meter.checkpoint(1,48);
    const payload=runtimeBytesPayload(source);
    if(payload===undefined)throw Error("bytes iterator requires bytes storage");
    this.#source=source;this.#length=payload.value.length;
  }
  [Symbol.iterator]():IterableIterator<RuntimeValue>{return this;}
  next():IteratorResult<RuntimeValue>{
    this.meter.checkpoint(1,16);
    if(this.#source===undefined||this.#index===this.#length){this.#source=undefined;return {done:true,value:undefined};}
    const value=this.values.integer(runtimeBytesPayload(this.#source)!.value.byteAt(BigInt(this.#index),this.meter));
    this.#index++;return {done:false,value};
  }
  lengthHint():number {this.meter.checkpoint();return this.#source===undefined?0:this.#length-this.#index;}
  state():{readonly source:RuntimeValue|undefined;readonly index:number}{
    this.meter.checkpoint(1,32);return {source:this.#source,index:this.#index};
  }
  setState(state:RuntimeValue):void {
    this.meter.checkpoint();
    const integer=runtimeIntegerPayload(state);
    if(integer===undefined)throw new PythonRuntimeError("TypeError","an integer is required");
    const index=integer.kind==="bool"?(integer.value?1n:0n):integer.value;
    if(BigInt.asIntN(64,index)!==index)throw new PythonRuntimeError("OverflowError","Python int too large to convert to C ssize_t");
    if(this.#source!==undefined)this.#index=index<0n?0:index>BigInt(this.#length)?this.#length:Number(index);
  }
}

const methods=[
  {name:"__iter__",wrapper:true,doc:"Implement iter(self).",signature:"($self, /)"},
  {name:"__next__",wrapper:true,doc:"Implement next(self).",signature:"($self, /)"},
  {name:"__length_hint__",wrapper:false,doc:"Private method returning an estimate of len(list(it)).",signature:"($self, /)"},
  {name:"__reduce__",wrapper:false,doc:"Return state information for pickling.",signature:"($self, /)"},
  {name:"__setstate__",wrapper:false,doc:"Set state information for unpickling.",signature:"($self, object, /)"}
] as const;

/** Install real descriptors over the cursor; reduction resolves the calling
 * frame's builtin iter before inspecting state, allowing reentrant lookup. */
export function installRuntimeBytesIterator(owner:TypeValue,values:RuntimeValues,meter:ExecutionMeter):void {
  owner.value.namespace.items.set(values.string("__doc__"),values.none);
  for(const {name,wrapper,doc,signature} of methods){
    meter.checkpoint(1,96);
    const capability={owner,name,doc,textSignature:signature,accepts:receiver=>receiver.kind==="iterator"&&receiver.value instanceof RuntimeBytesIterator,
      invoke(receiver,positional,keywords,meter,invocation){
        let fatal=false;
        try{
          meter.checkpoint();
          if(receiver.kind!=="iterator"||!(receiver.value instanceof RuntimeBytesIterator))throw Error("bytes iterator descriptor requires a bytes cursor");
          const count=name==="__setstate__"?1:0;
          if(keywords.items.size!==0)throw new PythonRuntimeError("TypeError",wrapper?`wrapper ${name}() takes no keyword arguments`:`bytes_iterator.${name}() takes no keyword arguments`);
          if(positional.length!==count)throw new PythonRuntimeError("TypeError",wrapper?`expected 0 arguments, got ${positional.length}`:`bytes_iterator.${name}() takes ${count===1?"exactly one argument":"no arguments"} (${positional.length} given)`);
          switch(name){
            case "__iter__":return receiver;
            case "__next__":{
              const step=receiver.value.next();
              if(step.done)throw new PythonRuntimeError("StopIteration");
              return step.value;
            }
            case "__length_hint__":return values.integer(receiver.value.lengthHint());
            case "__setstate__":receiver.value.setState(positional[0]);return values.none;
            case "__reduce__":{
              if(invocation?.lookupBuiltin===undefined)throw Error("iterator reduction requires the calling builtin namespace");
              const iter=invocation.lookupBuiltin("iter");meter.checkpoint();
              const state=receiver.value.state();
              return state.source===undefined?values.tuple([iter,values.tuple([values.tuple([])])]):values.tuple([iter,values.tuple([state.source]),values.integer(state.index)]);
            }
          }
        }catch(error){fatal=error instanceof ExecutionLimitError;throw error;}finally{if(!fatal)meter.checkpoint();}
      }
    } satisfies Parameters<RuntimeValues["methodDescriptor"]>[0];
    owner.value.namespace.items.set(values.string(name),wrapper?values.wrapperDescriptor(capability):values.methodDescriptor(capability));
  }
}

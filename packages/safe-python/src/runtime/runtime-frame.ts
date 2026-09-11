import type {LexicalFrame} from "./lexical-frame.js";
import type {ExecutionMeter} from "./execution-budget.js";
import type {RuntimeValue,RuntimeValues,TypeValue} from "./runtime-values.js";

/** Native identity around an interpreter-owned activation, never a host stack. */
export interface RuntimeFrameState {
  readonly kind:"frame";
  readonly frame:LexicalFrame<RuntimeValue>;
}

export function installRuntimeFrameDescriptors(owner:TypeValue,values:RuntimeValues,meter:ExecutionMeter,locals:(frame:LexicalFrame<RuntimeValue>)=>RuntimeValue):void {
  meter.checkpoint(0,96);
  owner.value.namespace.items.set(values.string("f_locals"),values.getsetDescriptor({owner,name:"f_locals",
    accepts:value=>value.kind==="instance"&&value.type===owner&&value.native?.kind==="frame",
    get(receiver,meter){
      meter.checkpoint();
      if(receiver.kind!=="instance"||receiver.native?.kind!=="frame")throw Error("frame locals require native frame storage");
      try{return locals(receiver.native.frame);}finally{meter.checkpoint();}
    }
  }));
}

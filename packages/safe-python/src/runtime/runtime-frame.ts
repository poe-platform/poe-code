import type {LexicalFrame} from "./lexical-frame.js";
import type {ExecutionMeter} from "./execution-budget.js";
import type {RuntimeValue,RuntimeValues,TypeValue} from "./runtime-values.js";

/** Native identity around an interpreter-owned activation, never a host stack. */
export interface RuntimeFrameState {
  readonly kind:"frame";
  readonly frame:LexicalFrame<RuntimeValue>;
}

export function installRuntimeFrameDescriptors(owner:TypeValue,values:RuntimeValues,meter:ExecutionMeter,locals:(frame:LexicalFrame<RuntimeValue>)=>RuntimeValue):void {
  for(const name of ["f_locals","f_globals","f_builtins"] as const){
  meter.checkpoint(0,96);
  owner.value.namespace.items.set(values.string(name),values.getsetDescriptor({owner,name,
    accepts:value=>value.kind==="instance"&&value.type===owner&&value.native?.kind==="frame",
    get(receiver,meter){
      meter.checkpoint();
      if(receiver.kind!=="instance"||receiver.native?.kind!=="frame")throw Error("frame locals require native frame storage");
      try{
        const frame=receiver.native.frame;
        if(name==="f_locals")return locals(frame);
        const namespace=name==="f_globals"?frame.namespaces.globals:frame.namespaces.builtins;
        const object=namespace.object;meter.checkpoint();
        if(object===undefined)throw Error("frame namespace reflection requires an original guest object");
        return object;
      }finally{meter.checkpoint();}
    }
  }));
  }
}

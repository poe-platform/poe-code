import type {LexicalFrame} from "./lexical-frame.js";
import type {ExecutionMeter} from "./execution-budget.js";
import type {RuntimeValue,RuntimeValues,TypeValue} from "./runtime-values.js";
import type {CompiledFunction} from "./function-compilation.js";
import {PythonRuntimeError} from "./error.js";

/** Native identity around an interpreter-owned activation, never a host stack. */
export interface RuntimeFrameState {
  readonly kind:"frame";
  readonly frame:LexicalFrame<RuntimeValue>;
}

export function installRuntimeFrameDescriptors(owner:TypeValue,values:RuntimeValues,meter:ExecutionMeter,locals:(frame:LexicalFrame<RuntimeValue>)=>RuntimeValue,code:(code:CompiledFunction<RuntimeValue>)=>RuntimeValue):void {
  for(const name of ["f_locals","f_globals","f_builtins","f_code","f_lineno"] as const){
  meter.checkpoint(0,96);
  owner.value.namespace.items.set(values.string(name),values.getsetDescriptor({owner,name,
    accepts:value=>value.kind==="instance"&&value.type===owner&&value.native?.kind==="frame",
    get(receiver,meter){
      meter.checkpoint();
      if(receiver.kind!=="instance"||receiver.native?.kind!=="frame")throw Error("frame locals require native frame storage");
      try{
        const frame=receiver.native.frame;
        if(name==="f_lineno"){
          if(frame.executionPosition!==undefined)return values.integer(frame.executionPosition.start.line);
          if(frame.code===undefined)throw Error("frame line reflection requires compiled function metadata before execution");
          return frame.code.firstLine;
        }
        if(name==="f_locals")return locals(frame);
        if(name==="f_code"){
          if(frame.code===undefined)throw Error("frame code reflection requires compiled function metadata");
          return code(frame.code);
        }
        const namespace=name==="f_globals"?frame.namespaces.globals:frame.namespaces.builtins;
        const object=namespace.object;meter.checkpoint();
        if(object===undefined)throw Error("frame namespace reflection requires an original guest object");
        return object;
      }finally{meter.checkpoint();}
    },
    // Guest tracing is not implemented. Ordinary writes must not pretend to
    // redirect execution, and exact-integer validation must not invoke __index__.
    set:name!=="f_lineno"?undefined:(_receiver,value,meter)=>{
      meter.checkpoint();
      throw new PythonRuntimeError("ValueError",value.kind==="int"?"f_lineno can only be set in a trace function":"lineno must be an integer");
    },
    delete:name!=="f_lineno"?undefined:(_receiver,meter)=>{
      meter.checkpoint();throw new PythonRuntimeError("AttributeError","cannot delete attribute");
    }
  }));
  }
}

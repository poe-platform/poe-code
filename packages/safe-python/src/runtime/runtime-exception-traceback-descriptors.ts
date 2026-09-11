import {PythonRuntimeError} from "./error.js";
import {runtimeExceptionPayload} from "./runtime-exception-state.js";
import type {ExecutionMeter} from "./execution-budget.js";
import type {RuntimeValue,RuntimeValues,TypeValue} from "./runtime-values.js";

/** Explicit attachment modifies owned exception storage, bypassing guest
 * __setattr__ and descriptor overrides. Raising/unwinding adds frames separately. */
export function installRuntimeExceptionTracebackDescriptors(owner:TypeValue,values:RuntimeValues,meter:ExecutionMeter):void {
  function set(receiver:RuntimeValue,value:RuntimeValue,meter:ExecutionMeter):void {
    meter.checkpoint();
    if(value.kind!=="none"&&(value.kind!=="instance"||value.native?.kind!=="traceback"))throw new PythonRuntimeError("TypeError","__traceback__ must be a traceback or None");
    runtimeExceptionPayload(receiver)!.assignTraceback(value.kind==="none"?null:value,meter);
  }
  meter.checkpoint(0,192);
  owner.value.namespace.items.set(values.string("__traceback__"),values.getsetDescriptor({owner,name:"__traceback__",accepts:value=>runtimeExceptionPayload(value)!==undefined,
    get(receiver,meter){meter.checkpoint();return runtimeExceptionPayload(receiver)!.traceback??values.none;},
    set,
    delete(_receiver,meter){meter.checkpoint();throw new PythonRuntimeError("TypeError","__traceback__ may not be deleted");}
  }));
  owner.value.namespace.items.set(values.string("with_traceback"),values.methodDescriptor({owner,name:"with_traceback",accepts:value=>runtimeExceptionPayload(value)!==undefined,
    invoke(receiver,positional,keywords,meter,_invocation,bound){
      meter.checkpoint();
      if(keywords.items.size!==0||positional.length!==1){
        const name=bound&&receiver.kind==="instance"?receiver.type.value.name:owner.value.name;
        meter.checkpoint(0,128+name.length*2);
        if(keywords.items.size!==0)throw new PythonRuntimeError("TypeError",`${name}.with_traceback() takes no keyword arguments`);
        throw new PythonRuntimeError("TypeError",`${name}.with_traceback() takes exactly one argument (${positional.length} given)`);
      }
      set(receiver,positional[0],meter);return receiver;
    }
  }));
}

import { PythonRuntimeError } from "./error.js";
import type { ExecutionMeter } from "./execution-budget.js";
import { runtimeExceptionPayload } from "./runtime-exception-state.js";
import type { MethodDescriptorValue, RuntimeValues, TypeValue } from "./runtime-values.js";

/** Reduction captures native state without invoking attribute hooks or exposing
 * a previously unmaterialized dictionary. Existing dictionary aliases survive. */
export function createExceptionReduceDescriptor(owner:TypeValue,values:RuntimeValues,meter:ExecutionMeter):MethodDescriptorValue {
  meter.checkpoint(0,96);
  return values.methodDescriptor({owner,name:"__reduce__",textSignature:"($self, /)",accepts:value=>runtimeExceptionPayload(value)!==undefined,
    invoke(receiver,positional,keywords,meter,_invocation,bound) {
      meter.checkpoint();
      if(receiver.kind!=="instance")throw Error("exception reduction requires an instance");
      const name=bound?receiver.type.value.name:owner.value.name;
      if(keywords.items.size!==0)throw new PythonRuntimeError("TypeError",`${name}.__reduce__() takes no keyword arguments`);
      if(positional.length!==0)throw new PythonRuntimeError("TypeError",`${name}.__reduce__() takes no arguments (${positional.length} given)`);
      const args=runtimeExceptionPayload(receiver)!.args,dictionary=receiver.state.dictionaryObject;
      return dictionary===undefined?values.tuple([receiver.type,args]):values.tuple([receiver.type,args,dictionary]);
    }
  });
}

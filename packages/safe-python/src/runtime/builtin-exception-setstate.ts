import { validateAttributeName } from "./attribute-name.js";
import { PythonRuntimeError } from "./error.js";
import type { ExecutionMeter } from "./execution-budget.js";
import { runtimeDictionaryPayload } from "./runtime-dictionary-payload.js";
import { runtimeExceptionPayload } from "./runtime-exception-state.js";
import type { MethodDescriptorValue, RuntimeValues, TypeValue } from "./runtime-values.js";

/** Restore in native dictionary position order, retaining each original key
 * and value across setter callbacks. Mutations are visible to subsequent scans. */
export function createExceptionSetstateDescriptor(owner:TypeValue,values:RuntimeValues,meter:ExecutionMeter):MethodDescriptorValue {
  meter.checkpoint(0,96);
  return values.methodDescriptor({owner,name:"__setstate__",textSignature:"($self, state, /)",accepts:value=>runtimeExceptionPayload(value)!==undefined,
    invoke(receiver,positional,keywords,meter,invocation,bound) {
      meter.checkpoint();
      const name=bound&&receiver.kind==="instance"?receiver.type.value.name:owner.value.name;
      if(keywords.items.size!==0)throw new PythonRuntimeError("TypeError",`${name}.__setstate__() takes no keyword arguments`);
      if(positional.length!==1)throw new PythonRuntimeError("TypeError",`${name}.__setstate__() takes exactly one argument (${positional.length} given)`);
      const state=positional[0];if(state.kind==="none")return values.none;
      const dictionary=runtimeDictionaryPayload(state);
      if(dictionary===undefined)throw new PythonRuntimeError("TypeError","state is not a dictionary");
      let position=0;
      for(;;) {
        const entry=dictionary.items.nextDictionaryEntry(position);
        if(entry===undefined)return values.none;
        position=entry.position;
        validateAttributeName(entry.key,{typeName:invocation?.typeName,isString:value=>invocation?.formatting?.string(value)!==undefined},meter);
        if(invocation?.lookupSpecial===undefined)throw Error("exception restoration requires an attribute setter policy");
        const setter=invocation.lookupSpecial(receiver,"__setattr__");
        if(setter===undefined)throw Error("exception instance has no attribute setter");
        invocation.call(setter,[entry.key,entry.value]);
        meter.checkpoint();
      }
    }
  });
}

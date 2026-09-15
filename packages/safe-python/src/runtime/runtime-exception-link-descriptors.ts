import { PythonRuntimeError } from "./error.js";
import type { ExecutionMeter } from "./execution-budget.js";
import { runtimeExceptionPayload } from "./runtime-exception-state.js";
import type { RuntimeValues,TypeValue } from "./runtime-values.js";

/** Explicit guest link assignment allows self-links and cycles. Automatic
 * context chaining owns cycle removal; virtual subclass checks never apply. */
export function installRuntimeExceptionLinkDescriptors(owner:TypeValue,values:RuntimeValues,meter:ExecutionMeter):void {
  for(const [name,label] of [["__cause__","cause"],["__context__","context"]] as const) {
    meter.checkpoint(0,96);
    owner.value.namespace.items.set(values.string(name),values.getsetDescriptor({owner,name,accepts:value=>runtimeExceptionPayload(value)!==undefined,
      get(value,meter) {
        meter.checkpoint();const storage=runtimeExceptionPayload(value)!;
        return (label==="cause"?storage.cause:storage.context)??values.none;
      },
      set(value,input,meter) {
        meter.checkpoint();
        if(input.kind!=="none"&&(input.kind!=="instance"||runtimeExceptionPayload(input)===undefined))throw new PythonRuntimeError("TypeError",`exception ${label} must be None or derive from BaseException`);
        const storage=runtimeExceptionPayload(value)!,link=input.kind==="none"?null:input;
        if(label==="cause")storage.assignCause(link,meter);else storage.assignContext(link,meter);
      },
      delete(){throw new PythonRuntimeError("TypeError",`${name} may not be deleted`);}
    }));
  }
  meter.checkpoint(0,96);
  owner.value.namespace.items.set(values.string("__suppress_context__"),values.memberDescriptor({owner,name:"__suppress_context__",accepts:value=>runtimeExceptionPayload(value)!==undefined,
    get(value,meter){meter.checkpoint();return values.boolean(runtimeExceptionPayload(value)!.suppressContext);},
    set(value,input,meter) {
      meter.checkpoint();
      if(input.kind!=="bool")throw new PythonRuntimeError("TypeError","attribute value type must be bool");
      runtimeExceptionPayload(value)!.assignSuppression(input.value,meter);
    },
    delete(){throw new PythonRuntimeError("TypeError","can't delete numeric/char attribute");}
  }));
}

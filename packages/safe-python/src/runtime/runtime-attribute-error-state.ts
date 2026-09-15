import { PythonRuntimeError } from "./error.js";
import type { ExecutionMeter } from "./execution-budget.js";
import { runtimeExceptionPayload } from "./runtime-exception-state.js";
import type { RuntimeValues, TypeValue } from "./runtime-values.js";

/** AttributeError serializes a copy of ordinary state plus native name/args.
 * The native object reference is intentionally excluded; subclass state hooks
 * are not consulted by its native reduction implementation. */
export function installAttributeErrorStateDescriptors(owner:TypeValue,values:RuntimeValues,meter:ExecutionMeter):void {
  for(const method of ["__getstate__","__reduce__"] as const) {
    meter.checkpoint(0,96);
    owner.value.namespace.items.set(values.string(method),values.methodDescriptor({owner,name:method,
      accepts(value,meter) {
        if(value.kind!=="instance"||runtimeExceptionPayload(value)===undefined)return false;
        for(const base of value.type.value.mro){meter.checkpoint();if(base===owner.value)return true;}
        return false;
      },
      invoke(receiver,positional,keywords,meter,_invocation,bound) {
        meter.checkpoint();
        if(receiver.kind!=="instance")throw Error("attribute exception state requires an instance");
        const type=bound?receiver.type.value.name:owner.value.name;
        if(keywords.items.size!==0)throw new PythonRuntimeError("TypeError",`${type}.${method}() takes no keyword arguments`);
        if(positional.length!==0)throw new PythonRuntimeError("TypeError",`${type}.${method}() takes no arguments (${positional.length} given)`);
        const storage=runtimeExceptionPayload(receiver)!,state=values.dictionary(receiver.dictionary?.items.copy()??owner.value.namespace.items.emptyCopy());
        const name=storage.member("name",meter);
        if(name!==undefined)state.items.set(values.string("name"),name);
        state.items.set(values.string("args"),storage.args);
        return method==="__getstate__"?state:values.tuple([receiver.type,storage.args,state]);
      }
    }));
  }
}

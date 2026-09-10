import { diagnosticTypeName } from "./diagnostic-type-name.js";
import { PythonRuntimeError } from "./error.js";
import type { ExecutionMeter } from "./execution-budget.js";
import { convertRuntimeFloatNumber } from "./runtime-float-construction.js";
import { runtimeFloatPayload } from "./runtime-float-payload.js";
import type { ClassMethodDescriptorValue, RuntimeValues, TypeValue } from "./runtime-values.js";

/** Unlike float(), from_number bypasses float-subclass conversion overrides
 * and never parses text or requests a buffer. */
export function createFloatFromNumberDescriptor(owner:TypeValue,values:RuntimeValues,meter:ExecutionMeter):ClassMethodDescriptorValue {
  meter.checkpoint(0,96);
  return values.classMethodDescriptor({owner,name:"from_number",doc:"Convert real number to a floating-point number.",
    accepts(receiver,meter) {
      if(receiver.kind!=="type")return false;
      for(const ancestor of receiver.value.mro){meter.checkpoint();if(ancestor===owner.value)return true;}
      return false;
    },
    invoke(receiver,positional,keywords,meter,invocation) {
      meter.checkpoint();
      if(receiver.kind!=="type")throw Error("float from_number descriptor requires a bound type");
      if(keywords.items.size!==0||positional.length!==1) {
        meter.checkpoint(0,128+receiver.value.name.length*2);
        if(keywords.items.size!==0)throw new PythonRuntimeError("TypeError",`${receiver.value.name}.from_number() takes no keyword arguments`);
        throw new PythonRuntimeError("TypeError",`${receiver.value.name}.from_number() takes exactly one argument (${positional.length} given)`);
      }
      const source=positional[0],payload=runtimeFloatPayload(source);
      const result=payload===undefined?convertRuntimeFloatNumber(source,values,meter,invocation):source.kind==="float"?source:values.float(payload.value);
      if(result===undefined) {
        const type=diagnosticTypeName(invocation?.typeName?.(source)??(source.kind==="none"?"NoneType":source.kind==="not-implemented"?"NotImplementedType":source.kind),meter,50);
        throw new PythonRuntimeError("TypeError",`must be real number, not ${type}`);
      }
      if(receiver===owner)return result;
      if(invocation===undefined)throw Error("float subclass numeric construction requires an invocation policy");
      return invocation.call(receiver,[result]);
    }
  });
}

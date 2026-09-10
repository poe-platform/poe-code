import { diagnosticTypeName } from "./diagnostic-type-name.js";
import { PythonRuntimeError } from "./error.js";
import type { ExecutionMeter } from "./execution-budget.js";
import { runtimeComplexPayload } from "./runtime-complex-payload.js";
import { runtimeFloatPayload } from "./runtime-float-payload.js";
import { convertRuntimeComplexSpecial } from "./runtime-complex-special.js";
import { convertRuntimeFloatNumber } from "./runtime-float-construction.js";
import type { ClassMethodDescriptorValue,RuntimeValues,TypeValue } from "./runtime-values.js";

/** Numeric-only construction. Complex storage precedes __complex__; real
 * storage bypasses __float__. Bound subtypes construct from a plain complex. */
export function createComplexFromNumberDescriptor(owner:TypeValue,values:RuntimeValues,meter:ExecutionMeter):ClassMethodDescriptorValue {
  meter.checkpoint(0,96);
  return values.classMethodDescriptor({owner,name:"from_number",doc:"Convert number to a complex floating-point number.",
    accepts(receiver,meter) {
      if(receiver.kind!=="type")return false;
      for(const ancestor of receiver.value.mro){meter.checkpoint();if(ancestor===owner.value)return true;}
      return false;
    },
    invoke(receiver,positional,keywords,meter,invocation) {
      meter.checkpoint();
      if(receiver.kind!=="type")throw Error("complex from_number descriptor requires a bound type");
      if(keywords.items.size!==0||positional.length!==1) {
        meter.checkpoint(0,128+receiver.value.name.length*2);
        if(keywords.items.size!==0)throw new PythonRuntimeError("TypeError",`${receiver.value.name}.from_number() takes no keyword arguments`);
        throw new PythonRuntimeError("TypeError",`${receiver.value.name}.from_number() takes exactly one argument (${positional.length} given)`);
      }
      const source=positional[0];
      if(receiver===owner&&source.kind==="complex")return source;
      const payload=runtimeComplexPayload(source);
      let result=payload===undefined?convertRuntimeComplexSpecial(source,values,meter,invocation):values.complex(payload.real,payload.imaginary);
      if(result===undefined) {
        const real=runtimeFloatPayload(source)??convertRuntimeFloatNumber(source,values,meter,invocation);
        if(real===undefined) {
          const name=diagnosticTypeName(invocation?.typeName?.(source)??(source.kind==="none"?"NoneType":source.kind==="not-implemented"?"NotImplementedType":source.kind),meter,50);
          throw new PythonRuntimeError("TypeError",`must be real number, not ${name}`);
        }
        result=values.complex(real.value,0);
      }
      if(receiver===owner)return result;
      if(invocation===undefined)throw Error("complex subclass numeric construction requires an invocation policy");
      return invocation.call(receiver,[result]);
    }
  });
}

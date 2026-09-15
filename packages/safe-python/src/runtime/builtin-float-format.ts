import { diagnosticTypeName } from "./diagnostic-type-name.js";
import { PythonRuntimeError } from "./error.js";
import type { ExecutionMeter } from "./execution-budget.js";
import { floatFormat } from "./float-format.js";
import { NumericLocale } from "./numeric-locale.js";
import { representationObject } from "./representation-protocol.js";
import { runtimeFloatPayload } from "./runtime-float-payload.js";
import { createRuntimeRepresentationContext } from "./runtime-representation.js";
import type { MethodDescriptorValue, RuntimeValues, TypeValue } from "./runtime-values.js";

/** Empty specs invoke str on the original object; nonempty specs format native
 * storage directly, without invoking subclass numeric conversion overrides. */
export function createFloatFormatDescriptor(owner: TypeValue, values: RuntimeValues, meter: ExecutionMeter): MethodDescriptorValue {
  meter.checkpoint(0,96);
  return values.methodDescriptor({textSignature: "($self, format_spec, /)", owner,name:"__format__",doc:"Formats the float according to format_spec.",accepts:receiver=>runtimeFloatPayload(receiver)!==undefined,
    invoke(receiver,positional,keywords,meter,invocation) {
      meter.checkpoint();
      if(keywords.items.size!==0)throw new PythonRuntimeError("TypeError","float.__format__() takes no keyword arguments");
      if(positional.length!==1)throw new PythonRuntimeError("TypeError",`float.__format__() takes exactly one argument (${positional.length} given)`);
      const context=invocation?.formatting??createRuntimeRepresentationContext(values,meter,{defaultRepr(){throw Error("float formatting requires a representation policy");}});
      const storage=context.string(positional[0]);meter.checkpoint();
      if(storage===undefined) {
        const type=positional[0].kind==="none"?"None":diagnosticTypeName(context.typeName(positional[0]),meter,50);
        throw new PythonRuntimeError("TypeError",`__format__() argument must be str, not ${type}`);
      }
      if(storage.length===0)return representationObject(receiver,"str",context,meter);
      const type=context.typeName(receiver);meter.checkpoint();
      const locale=()=>invocation?.formatting?.numericLocale?.()??NumericLocale.portable(meter);
      return values.stringPoints(floatFormat(runtimeFloatPayload(receiver)!.value,storage,type,meter,locale),"canonical");
    }
  });
}

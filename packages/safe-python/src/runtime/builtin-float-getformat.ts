import { diagnosticTypeName } from "./diagnostic-type-name.js";
import { PythonRuntimeError } from "./error.js";
import type { ExecutionMeter } from "./execution-budget.js";
import { encodeUtf8 } from "./utf8-encode.js";
import type { ClassMethodDescriptorValue, RuntimeValues, TypeValue } from "./runtime-values.js";

/** The virtual platform uses IEEE storage and fixed little-endian native
 * encoding, independently of the JavaScript host's architecture. */
export function createFloatGetformatDescriptor(owner:TypeValue,values:RuntimeValues,meter:ExecutionMeter):ClassMethodDescriptorValue {
  meter.checkpoint(0,96);
  return values.classMethodDescriptor({owner,name:"__getformat__",doc:"You probably don't want to use this function.\n\n  typestr\n    Must be 'double' or 'float'.\n\nIt exists mainly to be used in Python's test suite.\n\nThis function returns whichever of 'unknown', 'IEEE, big-endian' or\n'IEEE, little-endian' best describes the format of floating-point\nnumbers used by the C type named by typestr.",
    accepts(receiver,meter) {
      if(receiver.kind!=="type")return false;
      for(const ancestor of receiver.value.mro){meter.checkpoint();if(ancestor===owner.value)return true;}
      return false;
    },
    invoke(receiver,positional,keywords,meter,invocation) {
      meter.checkpoint();
      if(receiver.kind!=="type")throw Error("float getformat descriptor requires a bound type");
      if(keywords.items.size!==0||positional.length!==1) {
        meter.checkpoint(0,128+receiver.value.name.length*2);
        if(keywords.items.size!==0)throw new PythonRuntimeError("TypeError",`${receiver.value.name}.__getformat__() takes no keyword arguments`);
        throw new PythonRuntimeError("TypeError",`${receiver.value.name}.__getformat__() takes exactly one argument (${positional.length} given)`);
      }
      const source=positional[0];
      if(source.kind!=="str") {
        const type=source.kind==="none"?"None":diagnosticTypeName(invocation?.typeName?.(source)??source.kind,meter,50);
        throw new PythonRuntimeError("TypeError",`__getformat__() argument must be str, not ${type}`);
      }
      // CPython validates the complete UTF-8 encoding before checking nulls.
      const bytes=encodeUtf8(source.value,"strict",meter);
      for(const byte of bytes){meter.checkpoint();if(byte===0)throw new PythonRuntimeError("ValueError","embedded null character");}
      const isFloat=bytes.length===5&&bytes[0]===102&&bytes[1]===108&&bytes[2]===111&&bytes[3]===97&&bytes[4]===116;
      const isDouble=bytes.length===6&&bytes[0]===100&&bytes[1]===111&&bytes[2]===117&&bytes[3]===98&&bytes[4]===108&&bytes[5]===101;
      if(!isFloat&&!isDouble)throw new PythonRuntimeError("ValueError","__getformat__() argument 1 must be 'double' or 'float'");
      return values.string("IEEE, little-endian");
    }
  });
}

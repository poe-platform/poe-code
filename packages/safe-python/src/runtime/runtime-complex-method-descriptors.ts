import { PythonRuntimeError } from "./error.js";
import type { ExecutionMeter } from "./execution-budget.js";
import { runtimeComplexPayload } from "./runtime-complex-payload.js";
import type { RuntimeValues,TypeValue } from "./runtime-values.js";

export function installRuntimeComplexMethodDescriptors(owner:TypeValue,values:RuntimeValues,meter:ExecutionMeter):void {
  for(const [name,doc] of [["real","the real part of a complex number"],["imag","the imaginary part of a complex number"]] as const) {
    meter.checkpoint(0,96);
    owner.value.namespace.items.set(values.string(name),values.memberDescriptor({owner,name,doc,accepts:receiver=>runtimeComplexPayload(receiver)!==undefined,
      get(receiver,meter){meter.checkpoint();const payload=runtimeComplexPayload(receiver)!;return values.float(name==="real"?payload.real:payload.imaginary);}
    }));
  }
  for(const [name,doc] of [["__complex__","Convert this value to exact type complex."],["conjugate","Return the complex conjugate of its argument. (3-4j).conjugate() == 3+4j."],["__getnewargs__",undefined]] as const) {
    meter.checkpoint(0,96);
    owner.value.namespace.items.set(values.string(name),values.methodDescriptor({owner,name,doc,accepts:receiver=>runtimeComplexPayload(receiver)!==undefined,
      invoke(receiver,positional,keywords,meter) {
        meter.checkpoint();
        if(keywords.items.size!==0)throw new PythonRuntimeError("TypeError",`complex.${name}() takes no keyword arguments`);
        if(positional.length!==0)throw new PythonRuntimeError("TypeError",`complex.${name}() takes no arguments (${positional.length} given)`);
        const payload=runtimeComplexPayload(receiver)!;
        if(name==="__getnewargs__")return values.tuple([values.float(payload.real),values.float(payload.imaginary)]);
        if(name==="conjugate")return values.complex(payload.real,-payload.imaginary);
        return receiver.kind==="complex"?receiver:values.complex(payload.real,payload.imaginary);
      }
    }));
  }
}

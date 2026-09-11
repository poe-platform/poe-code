import {PythonRuntimeError} from "./error.js";
import type {ExecutionMeter} from "./execution-budget.js";
import type {GetsetDescriptorValue,RuntimeValues,TypeValue} from "./runtime-values.js";

/** Native modules come from trusted type names; heap modules are arbitrary,
 * live values in the type's own namespace, never inherited metadata. */
export function createTypeModuleDescriptor(owner:TypeValue,values:RuntimeValues,meter:ExecutionMeter):GetsetDescriptorValue {
  meter.checkpoint(1,96);
  const key=values.string("__module__");
  return values.getsetDescriptor({owner,name:"__module__",accepts:receiver=>receiver.kind==="type",
    get(receiver,meter){
      if(receiver.kind!=="type")throw Error("type module requires a type");
      meter.checkpoint();
      if(receiver.immutable){
        const name=receiver.value.nativeName;
        meter.checkpoint(0,32+2*(name?.length??0));
        const dot=name?.lastIndexOf(".")??-1;
        return values.string(dot<0?"builtins":name!.slice(0,dot));
      }
      const value=receiver.value.namespace.items.lookup(key)?.value;
      if(value===undefined)throw new PythonRuntimeError("AttributeError","__module__");
      return value;
    },
    set(receiver,value,meter){
      if(receiver.kind!=="type")throw Error("type module requires a type");
      meter.checkpoint();
      if(receiver.immutable){
        meter.checkpoint(0,128+2*receiver.value.diagnosticName.length);
        throw new PythonRuntimeError("TypeError",`cannot set '__module__' attribute of immutable type '${receiver.value.diagnosticName}'`);
      }
      receiver.value.namespace.items.set(key,value);
    },
    delete(receiver,meter){
      if(receiver.kind!=="type")throw Error("type module requires a type");
      meter.checkpoint(0,128+2*receiver.value.diagnosticName.length);
      throw new PythonRuntimeError("TypeError",`cannot ${receiver.immutable?"set":"delete"} '__module__' attribute of immutable type '${receiver.value.diagnosticName}'`);
    }
  });
}

import {PythonRuntimeError} from "./error.js";
import {createNativeHashWrapper} from "./builtin-native-hash.js";
import {installRuntimeComparisonMethods} from "./runtime-native-comparison-method.js";
import type {ExecutionMeter} from "./execution-budget.js";
import type {RuntimeValue,RuntimeValues,TypeValue} from "./runtime-values.js";

/** Canonical sentinel slots; inherited object methods still resolve through MRO. */
export function installRuntimeSingletonSlots(kind:"none"|"not-implemented"|"ellipsis",owner:TypeValue,values:RuntimeValues,meter:ExecutionMeter):void {
  const spelling=kind==="none"?"None":kind==="ellipsis"?"Ellipsis":"NotImplemented";
  const accepts=(value:RuntimeValue)=>value.kind===kind;
  meter.checkpoint(1,192);
  for(const name of kind==="ellipsis"?["__repr__"] as const:["__repr__","__bool__"] as const){
    const descriptor=values.wrapperDescriptor({owner,name,textSignature:"($self, /)",doc:name==="__repr__"?"Return repr(self).":"True if self else False",accepts,
      invoke(_receiver,positional,keywords,meter){
        meter.checkpoint();
        try {
          if(keywords.items.size)throw new PythonRuntimeError("TypeError",`wrapper ${name}() takes no keyword arguments`);
          if(positional.length)throw new PythonRuntimeError("TypeError",`expected 0 arguments, got ${positional.length}`);
          if(name==="__repr__")return values.string(spelling);
          if(kind==="none")return values.false;
          throw new PythonRuntimeError("TypeError","NotImplemented should not be used in a boolean context");
        } finally{meter.checkpoint();}
      }
    });
    owner.value.namespace.items.set(values.string(name),descriptor);
    // Native slot publication follows CPython's type dictionary order.
    if(kind==="none"&&name==="__repr__"){
      owner.value.namespace.items.set(values.string("__hash__"),createNativeHashWrapper(kind,owner,values,meter));
      installRuntimeComparisonMethods(kind,owner,values,meter);
    }
  }
  if(kind!=="none"){
    const descriptor=values.methodDescriptor({owner,name:"__reduce__",textSignature:"($self, /)",accepts,
      invoke(_receiver,positional,keywords,meter){
        meter.checkpoint();
        try {
          if(keywords.items.size)throw new PythonRuntimeError("TypeError",`${owner.value.name}.__reduce__() takes no keyword arguments`);
          if(positional.length)throw new PythonRuntimeError("TypeError",`${owner.value.name}.__reduce__() takes no arguments (${positional.length} given)`);
          return values.string(spelling);
        } finally{meter.checkpoint();}
      }
    });
    owner.value.namespace.items.set(values.string("__reduce__"),descriptor);
  }
  owner.value.namespace.items.set(values.string("__doc__"),values.string(`The type of the ${spelling} singleton.`));
}

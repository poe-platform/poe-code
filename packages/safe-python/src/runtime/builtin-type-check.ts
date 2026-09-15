import {PythonRuntimeError} from "./error.js";
import type {ExecutionMeter} from "./execution-budget.js";
import {runtimeRealClassInstance,runtimeRealClassSubclass} from "./runtime-real-type-check.js";
import type {MethodDescriptorValue,RuntimeValues,TypeValue} from "./runtime-values.js";

/** Native default checks are ordinary descriptors, not class methods. Explicit
 * calls from virtual overrides must not dispatch to those overrides again. */
export function createTypeCheckDescriptor(name:"__instancecheck__"|"__subclasscheck__",owner:TypeValue,values:RuntimeValues,meter:ExecutionMeter):MethodDescriptorValue {
  meter.checkpoint(0,96);
  return values.methodDescriptor({owner,name,doc:name==="__instancecheck__"?"Check if an object is an instance.":"Check if a class is a subclass.",accepts:receiver=>receiver.kind==="type",
    invoke(receiver,positional,keywords,meter,invocation,bound){
      if(receiver.kind!=="type")throw Error("type check descriptor requires a class receiver");
      meter.checkpoint();
      if(keywords.items.size||positional.length!==1){
        let typeName="type";
        if(bound){typeName="";for(const point of receiver.value.names.get("__qualname__",values,meter).value){meter.checkpoint(1,point>0xffff?4:2);typeName+=String.fromCodePoint(point);}}
        meter.checkpoint(0,128+2*(typeName.length+name.length));
        throw new PythonRuntimeError("TypeError",`${typeName}.${name}() takes ${keywords.items.size?"no keyword arguments":`exactly one argument (${positional.length} given)`}`);
      }
      return values.boolean(name==="__instancecheck__"?runtimeRealClassInstance(positional[0],receiver,meter,invocation):runtimeRealClassSubclass(positional[0],receiver,meter,invocation));
    }
  });
}

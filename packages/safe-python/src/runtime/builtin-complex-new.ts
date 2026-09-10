import { PythonRuntimeError } from "./error.js";
import { diagnosticTypeName } from "./diagnostic-type-name.js";
import type { ExecutionMeter } from "./execution-budget.js";
import { constructRuntimeComplex } from "./runtime-complex-construction.js";
import type { BuiltinFunctionValue,RuntimeValues,TypeValue } from "./runtime-values.js";

/** Complex subtypes own fixed native storage. Unlike float, custom initializers
 * do not relax constructor keyword validation. Initializers run in type call. */
export function createComplexNewBuiltin(owner:TypeValue,values:RuntimeValues,meter:ExecutionMeter,owns:(type:TypeValue)=>boolean):BuiltinFunctionValue {
  meter.checkpoint(0,96);
  return values.builtinFunction({name:"__new__",owner,keywordValidation:"callee",doc:"Create and return a new object.  See help(type) for accurate signature.",
    invoke(positional,keywords,meter,invocation) {
      meter.checkpoint();
      if(positional.length===0)throw new PythonRuntimeError("TypeError","complex.__new__(): not enough arguments");
      const type=positional[0];
      if(type.kind!=="type") {
        const name=invocation?.typeName?.(type)??(type.kind==="none"?"NoneType":type.kind==="not-implemented"?"NotImplementedType":type.kind);
        throw new PythonRuntimeError("TypeError",`complex.__new__(X): X is not a type object (${diagnosticTypeName(name,meter)})`);
      }
      if(!owns(type))throw Error("type is not owned by this complex allocator");
      let subtype=false;
      for(const ancestor of type.value.mro){meter.checkpoint();if(ancestor===owner.value){subtype=true;break;}}
      const name=diagnosticTypeName(type.value.name,meter);
      if(!subtype)throw new PythonRuntimeError("TypeError",`complex.__new__(${name}): ${name} is not a subtype of complex`);
      if(type.value.nativeStorage!==owner.value)throw new PythonRuntimeError("TypeError",`complex.__new__(${name}) is not safe, use ${name}.__new__()`);
      meter.checkpoint(0,positional.length*8);
      const result=constructRuntimeComplex(positional.slice(1),keywords,values,meter,invocation);
      if(type===owner)return result;
      const dictionary=type.value.hasInstanceDictionary?values.dictionary(owner.value.namespace.items.emptyCopy()):undefined;
      return values.instance(type,dictionary,values.complex(result.real,result.imaginary));
    }
  });
}

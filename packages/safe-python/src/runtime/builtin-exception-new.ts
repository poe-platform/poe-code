import { diagnosticTypeName } from "./diagnostic-type-name.js";
import { PythonRuntimeError } from "./error.js";
import type { ExecutionMeter } from "./execution-budget.js";
import { RuntimeExceptionState } from "./runtime-exception-state.js";
import type { BuiltinFunctionValue,RuntimeValues,TypeValue } from "./runtime-values.js";

/** Capture positional args during allocation; keyword validation belongs to
 * the initializer, so a guest exception may supply its own initializer. */
export function createExceptionNewBuiltin(owner:TypeValue,values:RuntimeValues,meter:ExecutionMeter,owns:(type:TypeValue)=>boolean):BuiltinFunctionValue {
  meter.checkpoint(0,96);
  return values.builtinFunction({name:"__new__",owner,keywordValidation:"callee",doc:"Create and return a new object.  See help(type) for accurate signature.",
    invoke(positional,_keywords,meter,invocation) {
      meter.checkpoint();
      if(positional.length===0)throw new PythonRuntimeError("TypeError","BaseException.__new__(): not enough arguments");
      const type=positional[0];
      if(type.kind!=="type") {
        const name=invocation?.typeName?.(type)??(type.kind==="none"?"NoneType":type.kind==="not-implemented"?"NotImplementedType":type.kind);
        throw new PythonRuntimeError("TypeError",`BaseException.__new__(X): X is not a type object (${diagnosticTypeName(name,meter)})`);
      }
      if(!owns(type))throw Error("type is not owned by this exception allocator");
      let subtype=false;
      for(const ancestor of type.value.mro){meter.checkpoint();if(ancestor===owner.value){subtype=true;break;}}
      const name=diagnosticTypeName(type.value.name,meter);
      if(!subtype)throw new PythonRuntimeError("TypeError",`BaseException.__new__(${name}): ${name} is not a subtype of BaseException`);
      if(type.value.nativeStorage!==owner.value)throw new PythonRuntimeError("TypeError",`BaseException.__new__(${name}) is not safe, use ${name}.__new__()`);
      const args=values.tuple(positional.length-1,index=>positional[index+1]);
      const dictionary=values.dictionary(owner.value.namespace.items.emptyCopy());
      return values.instance(type,dictionary,new RuntimeExceptionState(args,meter));
    }
  });
}

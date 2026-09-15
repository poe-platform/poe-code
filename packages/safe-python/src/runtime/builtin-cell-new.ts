import {diagnosticTypeName} from "./diagnostic-type-name.js";
import {PythonRuntimeError} from "./error.js";
import type {ExecutionMeter} from "./execution-budget.js";
import type {BuiltinFunctionValue,RuntimeValues,TypeValue} from "./runtime-values.js";

/** Allocate independent storage; omitted contents and explicit None are distinct. */
export function createCellNewBuiltin(owner:TypeValue,values:RuntimeValues,meter:ExecutionMeter):BuiltinFunctionValue {
  meter.checkpoint(0,96);
  return values.builtinFunction({name:"__new__",owner,keywordValidation:"callee",
    invoke(positional,keywords,meter,invocation){
      meter.checkpoint();
      try {
        if(positional.length===0)throw new PythonRuntimeError("TypeError","cell.__new__(): not enough arguments");
        const type=positional[0];
        if(type.kind!=="type"){
          const name=diagnosticTypeName(invocation?.typeName?.(type)??(type.kind==="none"?"NoneType":type.kind),meter);
          throw new PythonRuntimeError("TypeError",`cell.__new__(X): X is not a type object (${name})`);
        }
        if(type!==owner){
          const name=diagnosticTypeName(type.value.name,meter);
          throw new PythonRuntimeError("TypeError",`cell.__new__(${name}): ${name} is not a subtype of cell`);
        }
        if(keywords.items.size)throw new PythonRuntimeError("TypeError","cell() takes no keyword arguments");
        if(positional.length>2)throw new PythonRuntimeError("TypeError",`cell expected at most 1 argument, got ${positional.length-1}`);
        meter.checkpoint(1,positional.length===2?48:32);
        return values.cell(positional.length===2?{content:{value:positional[1]}}:{});
      } finally {meter.checkpoint();}
    }
  });
}

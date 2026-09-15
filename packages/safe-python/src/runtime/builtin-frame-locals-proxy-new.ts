import {PythonRuntimeError} from "./error.js";
import {runtimeQualifiedTypeName} from "./runtime-qualified-type-name.js";
import type {ExecutionMeter} from "./execution-budget.js";
import type {RuntimeFrame} from "./runtime-program.js";
import type {BuiltinFunctionValue,RuntimeValue,RuntimeValues,TypeValue} from "./runtime-values.js";

export function createFrameLocalsProxyNewBuiltin(owner:TypeValue,values:RuntimeValues,meter:ExecutionMeter,create:(frame:RuntimeFrame)=>RuntimeValue):BuiltinFunctionValue {
  meter.checkpoint(0,96);
  return values.builtinFunction({name:"__new__",owner,keywordValidation:"callee",
    invoke(positional,keywords,meter,invocation){
      meter.checkpoint();
      try {
        if(positional.length===0)throw new PythonRuntimeError("TypeError","FrameLocalsProxy.__new__(): not enough arguments");
        const type=positional[0];
        if(type.kind!=="type"){
          const name=invocation?.typeName?.(type)??(type.kind==="instance"?type.type.value.name:type.kind==="none"?"NoneType":type.kind==="not-implemented"?"NotImplementedType":type.kind);meter.checkpoint(1,128+name.length*2);
          throw new PythonRuntimeError("TypeError",`FrameLocalsProxy.__new__(X): X is not a type object (${name})`);
        }
        if(type!==owner){
          const name=type.value.name;meter.checkpoint(0,128+name.length*4);
          throw new PythonRuntimeError("TypeError",`FrameLocalsProxy.__new__(${name}): ${name} is not a subtype of FrameLocalsProxy`);
        }
        if(positional.length!==2)throw new PythonRuntimeError("TypeError",`FrameLocalsProxy expected 1 argument, got ${positional.length-1}`);
        const frame=positional[1];
        if(frame.kind!=="instance"||frame.native?.kind!=="frame"){
          const actual=invocation?.actualType?.(frame)??(frame.kind==="instance"?frame.type:frame.kind==="type"?frame.metaclass:undefined);meter.checkpoint();
          const name=actual===undefined?invocation?.typeName?.(frame)??(frame.kind==="none"?"NoneType":frame.kind==="not-implemented"?"NotImplementedType":frame.kind):runtimeQualifiedTypeName(actual,values,meter);meter.checkpoint(1,64+name.length*2);
          throw new PythonRuntimeError("TypeError",`expect frame, not ${name}`);
        }
        if(keywords.items.size!==0)throw new PythonRuntimeError("TypeError","FrameLocalsProxy takes no keyword arguments");
        return create(frame.native.frame);
      } finally {meter.checkpoint();}
    }
  });
}

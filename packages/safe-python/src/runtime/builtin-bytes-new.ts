import {PythonRuntimeError} from "./error.js";
import {ExecutionLimitError,type ExecutionMeter} from "./execution-budget.js";
import {constructRuntimeBytes} from "./runtime-bytes-construction.js";
import type {RuntimeTextEncoder} from "./runtime-utf8-encoding.js";
import {runtimeBytesPayload} from "./runtime-bytes-payload.js";
import type {BuiltinFunctionValue,RuntimeValues,TypeValue} from "./runtime-values.js";

/** bytes.__new__ owns native subtype allocation, not guest initialization. Exact
 * bytes preserves conversion-result identity; heap subtypes get distinct storage
 * wrappers and dictionaries while safely sharing immutable byte storage. */
export function createBytesNewBuiltin(owner:TypeValue,values:RuntimeValues,meter:ExecutionMeter,owns:(type:TypeValue)=>boolean,encode:RuntimeTextEncoder):BuiltinFunctionValue {
  meter.checkpoint(0,96);
  return values.builtinFunction({name:"__new__",owner,textSignature:"($type, *args, **kwargs)",keywordValidation:"callee",doc:"Create and return a new object.  See help(type) for accurate signature.",
    invoke(positional,keywords,meter,invocation){
      let fatal=false;
      try {
        meter.checkpoint();
        if(positional.length===0)throw new PythonRuntimeError("TypeError","bytes.__new__(): not enough arguments");
        const type=positional[0];
        if(type.kind!=="type"){
          const name=invocation?.typeName?.(type)??(type.kind==="none"?"NoneType":type.kind==="not-implemented"?"NotImplementedType":type.kind);
          meter.checkpoint(0,128+2*name.length);
          throw new PythonRuntimeError("TypeError",`bytes.__new__(X): X is not a type object (${name})`);
        }
        const owned=owns(type);meter.checkpoint();
        if(!owned)throw Error("type is not owned by this bytes allocator");
        let subtype=false;
        for(const ancestor of type.value.mro){meter.checkpoint();if(ancestor===owner.value){subtype=true;break;}}
        const name=type.value.diagnosticName;
        if(!subtype){
          meter.checkpoint(0,128+4*name.length);
          throw new PythonRuntimeError("TypeError",`bytes.__new__(${name}): ${name} is not a subtype of bytes`);
        }
        if(type.value.nativeStorage!==owner.value){
          meter.checkpoint(0,128+4*name.length);
          throw new PythonRuntimeError("TypeError",`bytes.__new__(${name}) is not safe, use ${name}.__new__()`);
        }
        meter.checkpoint(0,positional.length*8);
        const result=constructRuntimeBytes(positional.slice(1),keywords,values,meter,encode,invocation);
        if(type===owner)return result;
        const payload=runtimeBytesPayload(result)?.value;meter.checkpoint();
        if(payload===undefined)throw Error("bytes allocator requires native bytes storage");
        const dictionary=type.value.hasInstanceDictionary?values.dictionary(owner.value.namespace.items.emptyCopy()):undefined;
        return values.instance(type,dictionary,values.bytes(payload,"fresh"));
      } catch(error){fatal=error instanceof ExecutionLimitError;throw error;}
      finally{if(!fatal)meter.checkpoint();}
    }
  });
}

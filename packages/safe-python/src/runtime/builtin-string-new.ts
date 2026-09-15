import {diagnosticTypeName} from "./diagnostic-type-name.js";
import {PythonRuntimeError} from "./error.js";
import {ExecutionLimitError,type ExecutionMeter} from "./execution-budget.js";
import {constructRuntimeString,type RuntimeStringConstructionContext} from "./runtime-string-construction.js";
import {runtimeStringPayload} from "./runtime-string-payload.js";
import type {BuiltinFunctionValue,RuntimeValues,TypeValue} from "./runtime-values.js";

/** str.__new__ owns native subtype allocation, not guest initialization. Exact
 * str preserves conversion-result identity; heap subtypes get distinct storage
 * wrappers and dictionaries while safely sharing immutable code points. */
export function createStringNewBuiltin(owner:TypeValue,values:RuntimeValues,meter:ExecutionMeter,owns:(type:TypeValue)=>boolean,decode:NonNullable<RuntimeStringConstructionContext["decode"]>):BuiltinFunctionValue {
  meter.checkpoint(0,96);
  return values.builtinFunction({name:"__new__",owner,keywordValidation:"callee",doc:"Create and return a new object.  See help(type) for accurate signature.",
    invoke(positional,keywords,meter,invocation){
      let fatal=false;
      try {
        meter.checkpoint();
        if(positional.length===0)throw new PythonRuntimeError("TypeError","str.__new__(): not enough arguments");
        const type=positional[0];
        if(type.kind!=="type"){
          const name=invocation?.typeName?.(type)??(type.kind==="none"?"NoneType":type.kind==="not-implemented"?"NotImplementedType":type.kind);
          meter.checkpoint();
          throw new PythonRuntimeError("TypeError",`str.__new__(X): X is not a type object (${diagnosticTypeName(name,meter)})`);
        }
        const owned=owns(type);meter.checkpoint();
        if(!owned)throw Error("type is not owned by this string allocator");
        let subtype=false;
        for(const ancestor of type.value.mro){meter.checkpoint();if(ancestor===owner.value){subtype=true;break;}}
        const name=diagnosticTypeName(type.value.name,meter);
        if(!subtype)throw new PythonRuntimeError("TypeError",`str.__new__(${name}): ${name} is not a subtype of str`);
        if(type.value.nativeStorage!==owner.value)throw new PythonRuntimeError("TypeError",`str.__new__(${name}) is not safe, use ${name}.__new__()`);
        meter.checkpoint(0,positional.length*8);
        const result=constructRuntimeString(positional.slice(1),keywords,values,meter,{invocation,decode,argumentMode:"new"});
        if(type===owner)return result;
        const payload=runtimeStringPayload(result)?.value??invocation?.formatting?.string(result);meter.checkpoint();
        if(payload===undefined)throw Error("string allocator requires native string storage");
        const dictionary=type.value.hasInstanceDictionary?values.dictionary(owner.value.namespace.items.emptyCopy()):undefined;
        return values.instance(type,dictionary,values.stringPoints(payload));
      } catch(error){fatal=error instanceof ExecutionLimitError;throw error;}
      finally{if(!fatal)meter.checkpoint();}
    }
  });
}

import { diagnosticTypeName } from "./diagnostic-type-name.js";
import { PythonRuntimeError } from "./error.js";
import type { ExecutionMeter } from "./execution-budget.js";
import { RuntimeExceptionState } from "./runtime-exception-state.js";
import { lookupMroAttribute } from "./class-attributes.js";
import type { BuiltinFunctionValue,RuntimeValues,TypeValue,RuntimeValue,DictionaryValue,BuiltinInvocationContext,InstanceValue } from "./runtime-values.js";

/** Capture positional args during allocation; keyword validation belongs to
 * the initializer, so a guest exception may supply its own initializer.
 * MemoryError's exact allocation starts empty; its subclasses use ordinary
 * BaseException argument capture, independently of their __init__ override. */
export function createExceptionNewBuiltin(owner:TypeValue,values:RuntimeValues,meter:ExecutionMeter,owns:(type:TypeValue)=>boolean,allocation:"arguments"|"empty"="arguments",construct?:(type:TypeValue,args:readonly RuntimeValue[],keywords:DictionaryValue,invocation:BuiltinInvocationContext|undefined)=>InstanceValue):BuiltinFunctionValue {
  meter.checkpoint(0,96);
  return values.builtinFunction({name:"__new__",owner,keywordValidation:"callee",doc:"Create and return a new object.  See help(type) for accurate signature.",textSignature:"($type, *args, **kwargs)",
    invoke(positional,_keywords,meter,invocation) {
      meter.checkpoint();
      const ownerName=owner.value.name;
      if(positional.length===0)throw new PythonRuntimeError("TypeError",`${ownerName}.__new__(): not enough arguments`);
      const type=positional[0];
      if(type.kind!=="type") {
        const name=invocation?.typeName?.(type)??(type.kind==="none"?"NoneType":type.kind==="not-implemented"?"NotImplementedType":type.kind);
        throw new PythonRuntimeError("TypeError",`${ownerName}.__new__(X): X is not a type object (${diagnosticTypeName(name,meter)})`);
      }
      if(!owns(type))throw Error("type is not owned by this exception allocator");
      let subtype=false;
      for(const ancestor of type.value.mro){meter.checkpoint();if(ancestor===owner.value){subtype=true;break;}}
      const name=diagnosticTypeName(type.value.name,meter);
      if(!subtype)throw new PythonRuntimeError("TypeError",`${ownerName}.__new__(${name}): ${name} is not a subtype of ${ownerName}`);
      if(type.value.nativeAllocator!==owner.value.nativeAllocator) {
        let staticBase=type.value;
        const newName=values.string("__new__");
        while(staticBase.layoutBase!==undefined) {
          const method=lookupMroAttribute(staticBase.mro,newName,(base,key)=>base.namespace.items.lookup(key),meter)?.value;
          if(method?.kind==="builtin_function_or_method"&&method.value.name==="__new__"&&method.value.owner!==undefined)break;
          staticBase=staticBase.layoutBase;
        }
        throw new PythonRuntimeError("TypeError",`${ownerName}.__new__(${name}) is not safe, use ${diagnosticTypeName(staticBase.name,meter)}.__new__()`);
      }
      if(construct!==undefined){
        meter.checkpoint(0,32+8*(positional.length-1));
        const args=positional.slice(1),original=values.argumentTuples.get(positional);
        if(original!==undefined&&original.offset===1){meter.checkpoint(0,64);values.argumentTuples.set(args,{tuple:original.tuple,offset:0});}
        return construct(type,args,_keywords,invocation);
      }
      const args=values.tuple(allocation==="empty"&&type===owner?0:positional.length-1,index=>positional[index+1]);
      meter.checkpoint(0,32);
      const dictionary=()=>values.dictionary(owner.value.namespace.items.emptyCopy());
      return values.instance(type,dictionary,new RuntimeExceptionState(args,meter));
    }
  });
}

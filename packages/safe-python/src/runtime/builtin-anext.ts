import {PythonRuntimeError} from "./error.js";
import {diagnosticTypeName} from "./diagnostic-type-name.js";
import type {ExecutionMeter} from "./execution-budget.js";
import type {BuiltinFunctionValue,BuiltinInvocationContext,RuntimeValue,RuntimeValues} from "./runtime-values.js";

export type AnextBuiltinContext=Pick<BuiltinInvocationContext,"lookupSpecial"|"call"|"typeName"|"wrapAnext">;

/** Invoke anext immediately. Only the default form wraps its result; acquisition
 * errors are never replaced by a default, and await validation remains lazy. */
export function createAnextBuiltin(values:RuntimeValues,meter:ExecutionMeter,explicit?:AnextBuiltinContext):BuiltinFunctionValue {
  meter.checkpoint(1,64);
  return values.builtinFunction({name:"anext",invoke(args,keywords,meter,invocation){
    meter.checkpoint();
    if(keywords.items.size)throw new PythonRuntimeError("TypeError","anext() takes no keyword arguments");
    if(args.length<1)throw new PythonRuntimeError("TypeError","anext expected at least 1 argument, got 0");
    if(args.length>2)throw new PythonRuntimeError("TypeError",`anext expected at most 2 arguments, got ${args.length}`);
    const context=explicit??invocation;
    if(!context?.lookupSpecial||!context.typeName)throw Error("anext requires type-level protocol capabilities");
    let method:RuntimeValue|undefined;
    try {method=context.lookupSpecial(args[0],"__anext__");}finally{meter.checkpoint();}
    if(method===undefined) {
      let name:string;try{name=context.typeName(args[0]);}finally{meter.checkpoint();}
      throw new PythonRuntimeError("TypeError",`'${diagnosticTypeName(name,meter)}' object is not an async iterator`);
    }
    let awaitable:RuntimeValue;
    try{awaitable=context.call(method,[]);}finally{meter.checkpoint();}
    if(args.length===1)return awaitable;
    if(!context.wrapAnext)throw Error("anext default requires an awaitable wrapper capability");
    try{return context.wrapAnext(awaitable,args[1]);}finally{meter.checkpoint();}
  }});
}

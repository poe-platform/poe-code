import {lookupMroAttribute} from "./class-attributes.js";
import {PythonRuntimeError} from "./error.js";
import type {ExecutionMeter} from "./execution-budget.js";
import {RuntimeRaisedException} from "./runtime-exception-execution.js";
import {runtimeExceptionPayload} from "./runtime-exception-state.js";
import {runtimeQualifiedTypeName} from "./runtime-qualified-type-name.js";
import type {PreparedContextManager} from "./statement-execution.js";
import type {BuiltinInvocationContext,RuntimeValue,RuntimeValues} from "./runtime-values.js";

/** Cache type-level exit before enter. Instance attributes and arbitrary host
 * properties are never protocol candidates. Exception traceback identity comes
 * from native exception storage; frame capture belongs to exception execution. */
export function prepareRuntimeContextManager(source:RuntimeValue,invocation:BuiltinInvocationContext,values:RuntimeValues,meter:ExecutionMeter):PreparedContextManager<RuntimeValue> {
  meter.checkpoint(1,256);
  if(!invocation.lookupSpecial||!invocation.actualType||!invocation.hasSpecial)throw Error("context managers require type-level protocol capabilities");
  const methods:RuntimeValue[]=[];
  for(const name of ["__exit__","__enter__"]){
    let method:RuntimeValue|undefined;
    try{method=invocation.lookupSpecial(source,name);}finally{meter.checkpoint();}
    if(method===undefined){
      let type:ReturnType<NonNullable<BuiltinInvocationContext["actualType"]>>;
      try{type=invocation.actualType(source);}finally{meter.checkpoint();}
      let suggest=true;
      for(const alternative of ["__aenter__","__aexit__"]){
        const attribute=lookupMroAttribute(type.value.mro,values.string(alternative),(owner,key)=>owner.namespace.items.lookup(key),meter);
        if(attribute===undefined){suggest=false;break;}
        try{suggest=invocation.hasSpecial(attribute.value,"__get__");}finally{meter.checkpoint();}
        if(!suggest)break;
      }
      const typeName=runtimeQualifiedTypeName(type,values,meter);
      throw new PythonRuntimeError("TypeError",`'${typeName}' object does not support the context manager protocol (missed ${name} method)${suggest?" but it supports the asynchronous context manager protocol. Did you mean to use 'async with'?":""}`);
    }
    methods.push(method);
  }
  const [exit,enter]=methods;
  return {
    enter(){meter.checkpoint();try{return invocation.call(enter,[]);}finally{meter.checkpoint();}},
    exit(exception){
      meter.checkpoint(1,24);
      let args:RuntimeValue[];
      if(exception===null)args=[values.none,values.none,values.none];
      else {
        if(!(exception.error instanceof RuntimeRaisedException))throw Error("context manager exit requires a native guest exception");
        const value=exception.error.value;
        args=[value.type,value,runtimeExceptionPayload(value)!.traceback??values.none];
      }
      try{return invocation.call(exit,args);}finally{meter.checkpoint();}
    }
  };
}

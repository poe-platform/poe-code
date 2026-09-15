import {PythonRuntimeError} from "./error.js";
import {PythonUnicodeMessageError} from "./unicode-message-error.js";
import type {ExecutionMeter} from "./execution-budget.js";
import {suggestName} from "./name-suggestion.js";
import {runtimeStringPayload} from "./runtime-string-payload.js";
import {representationObject} from "./representation-protocol.js";
import type {BuiltinInvocationContext,DictionaryValue,RuntimeValue,RuntimeValues} from "./runtime-values.js";

/** Argument Clinic's error path checks all keys with Python equality after
 * native Unicode binding. Only a rejected key is converted with str(). */
export function rejectRuntimeClinicKeywords(operation:string,entries:readonly (readonly [RuntimeValue,RuntimeValue])[],parameters:readonly string[],values:RuntimeValues,meter:ExecutionMeter,invocation?:BuiltinInvocationContext):never {
  for(const [key] of entries){
    let namePoints=runtimeStringPayload(key)!.value;
    let name="";for(const point of namePoints){meter.checkpoint(1,2);name+=String.fromCodePoint(point);}
    let accepted=false;
    for(const parameter of parameters){
      if(key.kind==="str")accepted=name===parameter;
      else{
        if(invocation?.compareTruth===undefined)throw Error("native keyword diagnostics require interpreter equality");
        // Clinic's parameter identifiers retain their interned identity when
        // a string subclass observes the error-path rich comparison.
        accepted=invocation.compareTruth("==",key,values.internString(parameter));
        meter.checkpoint();
      }
      if(accepted)break;
    }
    if(accepted)continue;
    const suggestion=suggestName(name,parameters,meter);
    if(key.kind!=="str"){
      if(invocation?.formatting===undefined)throw Error("native keyword diagnostics require interpreter string conversion");
      const rendered=representationObject(key,"str",invocation.formatting,meter);
      namePoints=runtimeStringPayload(rendered)!.value;
    }
    // Guest strings can contain adjacent surrogate code points. Formatting the
    // diagnostic through host UTF-16 would combine them in exception.args.
    const message=values.string(`${operation}() got an unexpected keyword argument '`).value
      .concat(namePoints,meter)
      .concat(values.string(`'${suggestion===undefined?"":`. Did you mean '${suggestion}'?`}`).value,meter);
    throw new PythonUnicodeMessageError("TypeError",message,meter);
  }
  throw new PythonRuntimeError("TypeError",`invalid keyword argument for ${operation}()`);
}

/** Bind native Unicode names before running the error-path rich comparisons.
 * Empty parameter names mark positional-only slots. Arity and required argument
 * checks belong to each caller's Argument Clinic signature. */
export function bindRuntimeClinicArguments(operation:string,parameters:readonly string[],positional:readonly RuntimeValue[],keywords:DictionaryValue,values:RuntimeValues,meter:ExecutionMeter,invocation?:BuiltinInvocationContext):readonly (RuntimeValue|undefined)[] {
  meter.checkpoint(1,64+8*(positional.length+parameters.length));
  const args=[...positional],entries=keywords.items.snapshot();let unexpected=false,duplicate=-1;
  for(const [key,value] of entries){
    const payload=runtimeStringPayload(key);
    if(payload===undefined)throw new PythonRuntimeError("TypeError","keywords must be strings");
    let name="";for(const point of payload.value){meter.checkpoint(1,64);name+=String.fromCodePoint(point);}
    const index=(parameters as readonly string[]).indexOf(name);
    if(index<0||name===""){unexpected=true;continue;}
    if(index<positional.length){if(duplicate<0||index<duplicate)duplicate=index;continue;}
    if(args[index]!==undefined){unexpected=true;continue;}
    args[index]=value;
  }
  if(duplicate>=0)throw new PythonRuntimeError("TypeError",`argument for ${operation}() given by name ('${parameters[duplicate]}') and position (${duplicate+1})`);
  if(unexpected)rejectRuntimeClinicKeywords(operation,entries,parameters.filter(name=>name!==""),values,meter,invocation);
  return args;
}

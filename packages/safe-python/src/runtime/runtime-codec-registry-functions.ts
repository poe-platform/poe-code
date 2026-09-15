import {diagnosticTypeName} from "./diagnostic-type-name.js";
import {PythonRuntimeError} from "./error.js";
import {ExecutionLimitError} from "./execution-budget.js";
import {rejectRuntimeClinicKeywords} from "./runtime-clinic-arguments.js";
import type {RuntimeCodecRegistry} from "./runtime-codec-registry.js";
import {runtimeStringPayload} from "./runtime-string-payload.js";
import type {BuiltinFunctionValue,RuntimeValue} from "./runtime-values.js";

// CPython 3.14.7 clinic metadata; see CPYTHON-LICENSE.txt at package root.
const registryMetadata={
  "lookup": {
    "signature": "($module, encoding, /)",
    "doc": "Looks up a codec tuple in the Python codec registry and returns a CodecInfo object."
  },
  "register": {
    "signature": "($module, search_function, /)",
    "doc": "Register a codec search function.\n\nSearch functions are expected to take one argument, the encoding\nname in all lower case letters, and either return None, or a tuple\nof functions (encoder, decoder, stream_reader, stream_writer) (or\na CodecInfo object)."
  },
  "unregister": {
    "signature": "($module, search_function, /)",
    "doc": "Unregister a codec search function and clear the registry's cache.\n\nIf the search function is not registered, do nothing."
  },
  "register_error": {
    "signature": "($module, errors, handler, /)",
    "doc": "Register the specified error handler under the name errors.\n\nhandler must be a callable object, that will be called with an exception\ninstance containing information about the location of the\nencoding/decoding error and must return a (replacement, new position)\ntuple."
  },
  "lookup_error": {
    "signature": "($module, name, /)",
    "doc": "lookup_error(errors) -> handler\n\nReturn the error handler for the specified error handling name or raise\na LookupError, if no handler exists under this name."
  },
  "_unregister_error": {
    "signature": "($module, errors, /)",
    "doc": "Un-register the specified error handler for the error handling `errors'.\n\nOnly custom error handlers can be un-registered. An exception is raised\nif the error handling is a built-in one (e.g., 'strict'), or if an error\noccurs.\n\nOtherwise, this returns True if a custom handler has been successfully\nun-registered, and False if no custom handler for the specified error\nhandling exists."
  },
  "encode": {
    "signature": "($module, /, obj, encoding='utf-8', errors='strict')",
    "doc": "Encodes obj using the codec registered for encoding.\n\nThe default encoding is 'utf-8'.  errors may be given to set a\ndifferent error handling scheme.  Default is 'strict' meaning that\nencoding errors raise a ValueError.  Other possible values are 'ignore',\n'replace' and 'backslashreplace' as well as any other name registered\nwith codecs.register_error that can handle ValueErrors."
  },
  "decode": {
    "signature": "($module, /, obj, encoding='utf-8', errors='strict')",
    "doc": "Decodes obj using the codec registered for encoding.\n\nDefault encoding is 'utf-8'.  errors may be given to set a\ndifferent error handling scheme.  Default is 'strict' meaning that\nencoding errors raise a ValueError.  Other possible values are 'ignore',\n'replace' and 'backslashreplace' as well as any other name registered\nwith codecs.register_error that can handle ValueErrors."
  }
} as const;

/** Argument Clinic boundary for the owning interpreter's _codecs registry.
 * The module loader supplies publication and module identity. Codec execution,
 * search mutation and error recovery use the same explicitly supplied registry.
 */
export function createRuntimeCodecRegistryFunctions(registry:RuntimeCodecRegistry):ReadonlyMap<string,BuiltinFunctionValue>{
  const {values,meter}=registry,functions=new Map<string,BuiltinFunctionValue>();
  for(const name of Object.keys(registryMetadata) as (keyof typeof registryMetadata)[]){
    meter.checkpoint(1,128);
    functions.set(name,values.builtinFunction({name,module:"_codecs",keywordValidation:"callee",textSignature:registryMetadata[name].signature,doc:registryMetadata[name].doc,invoke(positional,keywords,meter,context){
      let fatal=false;
      try{
        meter.checkpoint(1,128);
        const transform=name==="encode"||name==="decode";
        let args:readonly (RuntimeValue|undefined)[]=positional;
        if(transform){
          const parameters=["obj","encoding","errors"],count=positional.length+keywords.items.size;
          if(count>3){
            meter.checkpoint(0,256+2*name.length);
            throw new PythonRuntimeError("TypeError",`${name}() takes at most 3 ${positional.length===0?"keyword ":""}arguments (${count} given)`);
          }
          const bound=[...positional],entries=keywords.items.snapshot();let unexpected=false,duplicate=-1;
          for(const [key,value] of entries){
            const text=runtimeStringPayload(key);
            if(text===undefined){
              meter.checkpoint(0,192);
              throw new PythonRuntimeError("TypeError","keywords must be strings");
            }
            let keyword="";for(const point of text.value){meter.checkpoint(1,4);keyword+=String.fromCodePoint(point);}
            const index=parameters.indexOf(keyword);
            if(index<0){unexpected=true;continue;}
            if(index<positional.length){if(duplicate<0||index<duplicate)duplicate=index;continue;}
            if(bound[index]!==undefined){unexpected=true;continue;}
            bound[index]=value;
          }
          if(bound[0]===undefined){
            meter.checkpoint(0,256+2*name.length);
            throw new PythonRuntimeError("TypeError",`${name}() missing required argument 'obj' (pos 1)`);
          }
          if(duplicate>=0){
            meter.checkpoint(0,256+2*(name.length+parameters[duplicate].length));
            throw new PythonRuntimeError("TypeError",`argument for ${name}() given by name ('${parameters[duplicate]}') and position (${duplicate+1})`);
          }
          if(unexpected)rejectRuntimeClinicKeywords(name,entries,parameters,values,meter,context);
          args=bound;
        }else{
          if(keywords.items.size!==0){
            meter.checkpoint(0,256+2*name.length);
            throw new PythonRuntimeError("TypeError",`_codecs.${name}() takes no keyword arguments`);
          }
          const expected=name==="register_error"?2:1;
          if(args.length!==expected){
            // Entry storage covers binding, not an escaping exception and its
            // formatted arity diagnostic. Exhaustion must remain terminal.
            meter.checkpoint(0,256+2*name.length);
            throw new PythonRuntimeError("TypeError",expected===2?`register_error expected 2 arguments, got ${args.length}`:`_codecs.${name}() takes exactly one argument (${args.length} given)`);
          }
        }
        const stringPayload=(value:RuntimeValue,label:string)=>{
          const text=runtimeStringPayload(value);
          if(text===undefined){
            const type=value.kind==="none"?"None":context?.typeName?.(value)??(value.kind==="instance"?value.type.value.diagnosticName:value.kind==="not-implemented"?"NotImplementedType":value.kind);
            const diagnostic=diagnosticTypeName(type,meter,50);
            // Type-name services can consume the remaining allowance. Admit
            // the exception after that boundary and before formatting it.
            meter.checkpoint(0,256+2*(name.length+label.length+diagnostic.length));
            throw new PythonRuntimeError("TypeError",`${name}() ${label} must be str, not ${diagnostic}`);
          }
          return text;
        };
        const string=(value:RuntimeValue,label:string)=>{
          stringPayload(value,label);
          if(context===undefined)throw Error("codec names require an interpreter invocation context");
          return registry.unicodeErrorPolicy(value,context);
        };
        if(context===undefined)throw Error("codec registry bindings require an interpreter invocation context");
        if(transform){
          let encoding: string | ReturnType<RuntimeCodecRegistry["unicodeUtf8"]> = "utf-8";
          if(args[1]!==undefined){
            stringPayload(args[1],"argument 'encoding'");
            encoding=registry.unicodeUtf8(args[1],context);
            for(const byte of encoding){
              meter.checkpoint();
              if(byte===0){meter.checkpoint(0,192);throw new PythonRuntimeError("ValueError","embedded null character");}
            }
          }
          // Omission passes one argument to the codec; explicit strict passes two.
          const errors=args[2]===undefined?undefined:string(args[2],"argument 'errors'");
          return registry.transform(name,args[0]!,encoding,errors,context);
        }
        switch(name){
          case "register":registry.register(args[0]!,context);return values.none;
          case "unregister":registry.unregister(args[0]!);return values.none;
          case "lookup":{
            stringPayload(args[0]!,"argument");
            return registry.lookup(registry.unicodeUtf8(args[0]!,context),context);
          }
          case "lookup_error":return registry.lookupError(string(args[0]!,"argument"),context);
          case "_unregister_error":return values.boolean(registry.unregisterError(string(args[0]!,"argument"),context));
          case "register_error":registry.registerError(string(args[0]!,"argument 1"),args[1]!,context);return values.none;
        }
      }catch(error){fatal=error instanceof ExecutionLimitError;throw error;}
      finally{if(!fatal)meter.checkpoint();}
    }}));
  }
  return functions;
}

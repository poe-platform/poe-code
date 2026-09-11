import {normalizeFutureFlags} from "../future-flags.js";
import {diagnosticTypeName} from "./diagnostic-type-name.js";
import {PythonRuntimeError} from "./error.js";
import {ExecutionLimitError,type ExecutionMeter} from "./execution-budget.js";
import {runtimeIntegerIndex} from "./runtime-integer-index.js";
import {runtimeTruth} from "./runtime-truth.js";
import {suggestName} from "./name-suggestion.js";
import {snapshotCompilationFilename,type CompilationFilename} from "./compilation-source.js";
import type {BuiltinFunctionValue,BuiltinInvocationContext,RuntimeValue,RuntimeValues} from "./runtime-values.js";

export interface CompileRequest {
  readonly source:RuntimeValue;
  readonly filename:string|CompilationFilename<RuntimeValue>;
  readonly mode:"exec"|"eval"|"single"|"func_type";
  /** Explicit flags combined with caller futures unless dont_inherit was true. */
  readonly flags:number;
  readonly optimize:number;
  readonly featureVersion:number;
}
export interface CompileContext {
  /** Explicit filesystem-name conversion policy; this must not load the file. */
  filename(value:RuntimeValue,invocation:BuiltinInvocationContext|undefined,meter:ExecutionMeter):string|CompilationFilename<RuntimeValue>;
  /** Calling frame's future bits only; queried after argument validation. */
  inheritedFlags?(invocation:BuiltinInvocationContext|undefined,meter:ExecutionMeter):number;
  /** Own source decoding/AST handling, compiler options and guest code publication.
   * No host compiler or filesystem capability is discovered implicitly. */
  compile(request:CompileRequest,invocation:BuiltinInvocationContext|undefined,meter:ExecutionMeter):RuntimeValue;
}

const parameters=["source","filename","mode","flags","dont_inherit","optimize","_feature_version"] as const;

/** Python compile call binding and conversion, with an explicit compiler backend. */
export function createCompileBuiltin(values:RuntimeValues,meter:ExecutionMeter,context:CompileContext):BuiltinFunctionValue {
  meter.checkpoint(1,128);
  return values.builtinFunction({name:"compile",keywordValidation:"callee",invoke(positional,keywords,meter,invocation){
    let fatal=false;
    try {
      meter.checkpoint(1,512);
      const count=positional.length+keywords.items.size;
      if(count>7)throw new PythonRuntimeError("TypeError",`compile() takes at most 7 ${positional.length===0?"keyword ":""}arguments (${count} given)`);
      if(positional.length>6)throw new PythonRuntimeError("TypeError",`compile() takes at most 6 positional arguments (${positional.length} given)`);
      const args=new Array<RuntimeValue|undefined>(7);
      for(let index=0;index<positional.length;index++){meter.checkpoint();args[index]=positional[index];}
      let unexpected:string|undefined;
      let duplicate=-1;
      for(const [key,value] of keywords.items.snapshot()){
        if(key.kind!=="str")throw new PythonRuntimeError("TypeError","keywords must be strings");
        const name=stringText(key,meter),index=(parameters as readonly string[]).indexOf(name);
        meter.checkpoint(1,192+2*name.length);
        if(index<0){unexpected??=name;continue;}
        if(index<positional.length){if(duplicate<0)duplicate=index;continue;}
        args[index]=value;
      }
      for(let index=0;index<3;index++)if(args[index]===undefined)throw new PythonRuntimeError("TypeError",`compile() missing required argument '${parameters[index]}' (pos ${index+1})`);
      if(duplicate>=0)throw new PythonRuntimeError("TypeError",`argument for compile() given by name ('${parameters[duplicate]}') and position (${duplicate+1})`);
      if(unexpected!==undefined){
        const suggestion=suggestName(unexpected,parameters,meter);
        meter.checkpoint(1,160+2*unexpected.length);
        throw new PythonRuntimeError("TypeError",`compile() got an unexpected keyword argument '${unexpected}'${suggestion===undefined?"":`. Did you mean '${suggestion}'?`}`);
      }
      const filename=snapshotCompilationFilename(context.filename(args[1]!,invocation,meter),meter);
      const displayName=typeof filename==="string"?filename:filename.displayName;
      meter.checkpoint(1+displayName.length);
      if(displayName.includes("\0"))throw new PythonRuntimeError("ValueError","embedded null character");
      const modeValue=args[2]!;
      if(modeValue.kind!=="str"){
        const name=modeValue.kind==="none"?"None":invocation?.typeName?.(modeValue)??(modeValue.kind==="not-implemented"?"NotImplementedType":modeValue.kind);
        throw new PythonRuntimeError("TypeError",`compile() argument 'mode' must be str, not ${diagnosticTypeName(name,meter)}`);
      }
      const mode=stringText(modeValue,meter);
      meter.checkpoint(1+mode.length);
      if(mode.includes("\0"))throw new PythonRuntimeError("ValueError","embedded null character");
      let flags=cInt(args[3],0,meter,invocation);
      const dontInherit=args[4]===undefined?false:invocation?.truth===undefined?runtimeTruth(args[4],meter,invocation):invocation.truth(args[4]);
      meter.checkpoint();
      const optimize=cInt(args[5],-1,meter,invocation),featureVersion=cInt(args[6],-1,meter,invocation);
      if(flags<0||(flags&~0x1fef610)!==0)throw new PythonRuntimeError("ValueError","compile(): unrecognised flags");
      if(optimize< -1||optimize>2)throw new PythonRuntimeError("ValueError","compile(): invalid optimize value");
      if(mode==="func_type"&&!(flags&0x400))throw new PythonRuntimeError("ValueError","compile() mode 'func_type' requires flag PyCF_ONLY_AST");
      if(mode!=="exec"&&mode!=="eval"&&mode!=="single"&&mode!=="func_type")throw new PythonRuntimeError("ValueError",flags&0x400?"compile() mode must be 'exec', 'eval', 'single' or 'func_type'":"compile() mode must be 'exec', 'eval' or 'single'");
      if(!dontInherit&&context.inheritedFlags!==undefined)flags|=normalizeFutureFlags(context.inheritedFlags(invocation,meter),meter);
      meter.checkpoint(1,96);
      return context.compile({source:args[0]!,filename,mode,flags,optimize,featureVersion},invocation,meter);
    } catch(error){fatal=error instanceof ExecutionLimitError;throw error;}
    finally{if(!fatal)meter.checkpoint();}
  }});
}

function cInt(value:RuntimeValue|undefined,fallback:number,meter:ExecutionMeter,invocation?:BuiltinInvocationContext):number {
  if(value===undefined)return fallback;
  const integer=runtimeIntegerIndex(value,meter,invocation?.integerIndex);
  meter.checkpoint();
  if(integer< -2147483648n||integer>2147483647n)throw new PythonRuntimeError("OverflowError","Python int too large to convert to C int");
  return Number(integer);
}

function stringText(value:Extract<RuntimeValue,{kind:"str"}>,meter:ExecutionMeter):string {
  meter.checkpoint(1,32);
  let text="";
  for(const point of value.value){meter.checkpoint(1,64+(point>0xffff?4:2));text+=String.fromCodePoint(point);}
  return text;
}

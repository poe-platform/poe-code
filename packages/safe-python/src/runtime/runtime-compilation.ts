import type {CompileContext} from "./builtin-compile.js";
import {ExecutionLimitError} from "./execution-budget.js";
import type {CompiledModule} from "./program-compilation.js";
import type {RuntimeCodePrograms} from "./runtime-code-programs.js";
import {runtimeCompilationSource} from "./runtime-compilation-source.js";
import {decodeRuntimeFileSystemName,runtimeFileSystemPath,type FileSystemNameDecoder} from "./runtime-filesystem-path.js";
import type {RuntimeValue,RuntimeValues} from "./runtime-values.js";
import {compileSourceProgram,type SourceCompilationOptions} from "./source-program-compilation.js";

export interface RuntimeCompilationPolicy extends Pick<CompileContext,"inheritedFlags"> {
  /** Execution defaults and shared recursion guard; explicit request optimization
   * overrides the default. Future inheritance belongs to the builtin binder. */
  compilation():Omit<SourceCompilationOptions<RuntimeValue>,"mode"|"filename"|"futureFlags">;
  code(code:CompiledModule<RuntimeValue>):RuntimeValue;
  decodeFilename?:FileSystemNameDecoder;
  /** Explicit extension for AST, single/func_type and non-future compiler flags.
   * These requests must never silently run with reduced compiler semantics. */
  compileExtended?:CompileContext["compile"];
}

/** Compile builtin backend with lossless filename identity and execution-owned
 * code registration. Filename conversion is diagnostic only, never filesystem I/O. */
export function createRuntimeCompilation(values:RuntimeValues,programs:RuntimeCodePrograms,policy:RuntimeCompilationPolicy):CompileContext {
  return {
    inheritedFlags:policy.inheritedFlags?.bind(policy),
    filename(value,invocation,meter){
      let fatal=false;
      try {
        const path=runtimeFileSystemPath(value,meter,invocation);
        const name=path.kind==="str"?path:values.stringPoints(decodeRuntimeFileSystemName(path,meter,undefined,policy.decodeFilename));
        meter.checkpoint(1,80);
        let displayName="";
        for(const point of name.value){meter.checkpoint(1,64+(point>0xffff?4:2));displayName+=String.fromCodePoint(point);}
        return {displayName,value:name};
      } catch(error){fatal=error instanceof ExecutionLimitError;throw error;}
      finally{if(!fatal)meter.checkpoint();}
    },
    compile(request,invocation,meter){
      let fatal=false;
      try {
        meter.checkpoint(1,192);
        if((request.mode!=="exec"&&request.mode!=="eval")||(request.flags&~0x1fe0010)!==0){
          if(policy.compileExtended===undefined)throw Error("compilation requires an extended backend for this mode or compiler flags");
          return policy.compileExtended(request,invocation,meter);
        }
        const source=runtimeCompilationSource(request.source,meter,invocation);
        const options=policy.compilation();meter.checkpoint();
        const optimize=request.optimize===-1?options.optimize??0:request.optimize as 0|1|2;
        const program=compileSourceProgram<RuntimeValue>(source,{...options,mode:request.mode,filename:request.filename,futureFlags:request.flags,optimize},values,meter);
        programs.register(program);
        return policy.code(program.module);
      } catch(error){fatal=error instanceof ExecutionLimitError;throw error;}
      finally{if(!fatal)meter.checkpoint();}
    }
  };
}

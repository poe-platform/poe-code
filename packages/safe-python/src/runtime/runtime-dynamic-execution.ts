import type {DynamicExecutionContext} from "./builtin-dynamic-execution.js";
import {prepareDynamicCodeClosure} from "./dynamic-code-closure.js";
import {prepareDynamicNamespaces,type DynamicNamespaceContext} from "./dynamic-namespaces.js";
import {ExecutionLimitError} from "./execution-budget.js";
import type {NameNamespace} from "./namespace-lookup.js";
import {executeRuntimeFunctionCode} from "./runtime-code-execution.js";
import type {RuntimeCodePrograms} from "./runtime-code-programs.js";
import {runtimeCompilationSource} from "./runtime-compilation-source.js";
import {RuntimeDictionaryNamespace} from "./runtime-dictionary-namespace.js";
import {RuntimeMappingNamespace} from "./runtime-mapping-namespace.js";
import {executeRuntimeProgram,type RuntimeExecutionContext} from "./runtime-program.js";
import type {BuiltinInvocationContext,RuntimeValue} from "./runtime-values.js";
import {compileSourceProgram,type SourceCompilationOptions} from "./source-program-compilation.js";
import {createRuntimeSourceCodecRecovery} from "./runtime-source-codec-recovery.js";
import {createRuntimeSourceCodecDecoder} from "./runtime-source-codec-decoder.js";

export interface RuntimeDynamicExecutionPolicy extends Pick<DynamicNamespaceContext,"globals"|"locals"|"builtins"> {
  /** Read caller compilation policy only after namespace and source admission.
   * Recursion accounting must be shared with the calling execution. */
  compilation():Omit<SourceCompilationOptions<RuntimeValue>,"mode"|"filename">;
  /** Optional module-to-dictionary resolution for selected __builtins__. */
  resolveBuiltins?(value:RuntimeValue,invocation:BuiltinInvocationContext):NameNamespace<RuntimeValue>;
}

/** Shared eval/exec backend. All state and host policies are execution-owned;
 * this does not discover host namespaces, load files, or use host eval. */
export function createRuntimeDynamicExecution(context:RuntimeExecutionContext,programs:RuntimeCodePrograms,policy:RuntimeDynamicExecutionPolicy):DynamicExecutionContext {
  return {execute(request,invocation,meter){
    let fatal=false;
    try {
      meter.checkpoint(1,192);
      if(invocation===undefined)throw Error("dynamic execution requires invocation context");
      const v=context.values;
      const selected=prepareDynamicNamespaces(request,v,meter,{
        globals:()=>policy.globals(),locals:()=>policy.locals(),builtins:()=>policy.builtins(),
        isMapping(value){if(invocation.hasSpecial===undefined)throw Error("dynamic execution requires mapping slot inspection");return invocation.hasSpecial(value,"__getitem__");},
        typeName(value){if(invocation.typeName===undefined)throw Error("dynamic execution requires type names");return invocation.typeName(value);}
      });
      const code=request.source.kind==="instance"&&request.source.native?.kind==="code"?request.source.native.code:undefined;
      const closure=prepareDynamicCodeClosure(request,code,meter);
      let program=code===undefined?undefined:programs.lookup(code);
      if(code===undefined){
        const source=runtimeCompilationSource(request.source,meter,invocation,request.mode);
        const options=policy.compilation();meter.checkpoint();
        const sourceException=invocation.sourceException;
        program=compileSourceProgram<RuntimeValue>(source,{...options,mode:request.mode,filename:"<string>",
          decodeSource:options.decodeSource??(typeof source==="string"?undefined:createRuntimeSourceCodecDecoder(invocation)),
          sourceDecodeRecovery:options.sourceDecodeRecovery??(typeof source==="string"?undefined:createRuntimeSourceCodecRecovery(invocation)),
          ...(sourceException===undefined?{}:{sourceException:(error:unknown)=>sourceException(error,v.string("<string>"))})
        },v,meter);
        programs.register(program);
      }
      const globals=new RuntimeDictionaryNamespace(selected.globals,v,meter,invocation);
      const locals=selected.locals.kind==="dict"?new RuntimeDictionaryNamespace(selected.locals,v,meter,invocation):new RuntimeMappingNamespace(selected.locals,v,meter,invocation);
      const builtins=policy.resolveBuiltins!==undefined?policy.resolveBuiltins(selected.builtins,invocation):selected.builtins.kind==="dict"?new RuntimeDictionaryNamespace(selected.builtins,v,meter,invocation):new RuntimeMappingNamespace(selected.builtins,v,meter,invocation);
      meter.checkpoint();
      const callable=code===undefined?undefined:programs.functionCode(code);
      if(callable!==undefined&&callable.body.kind!=="module")return executeRuntimeFunctionCode(callable,closure,{globals,builtins,none:v.none,resolveBuiltins:()=>builtins},v,meter,invocation,selected.locals);
      // Direct module execution must preserve explicitly selected locals, unlike
      // calling a function whose __code__ was replaced with module code.
      if(program===undefined||code!==undefined&&code!==program.module)throw Error("dynamic execution requires registered module or callable code");
      return executeRuntimeProgram(program,{...context,globals,locals,builtins},meter)??v.none;
    } catch(error){fatal=error instanceof ExecutionLimitError;throw error;}
    finally{if(!fatal)meter.checkpoint();}
  }};
}

import {createCompileBuiltin} from "./builtin-compile.js";
import {createDynamicExecutionBuiltin} from "./builtin-dynamic-execution.js";
import {createNamespaceBuiltin} from "./builtin-namespace.js";
import {createVarsBuiltin} from "./builtin-vars.js";
import {createDirBuiltin} from "./builtin-dir.js";
import {ExecutionLimitError,type ExecutionMeter} from "./execution-budget.js";
import type {RuntimeCodePrograms} from "./runtime-code-programs.js";
import {createRuntimeCompilation,type RuntimeCompilationPolicy} from "./runtime-compilation.js";
import {createRuntimeDynamicExecution,type RuntimeDynamicExecutionPolicy} from "./runtime-dynamic-execution.js";
import type {RuntimeExecutionContext,RuntimeFrame} from "./runtime-program.js";
import type {BuiltinFunctionValue,RuntimeValue} from "./runtime-values.js";

export interface RuntimeCodeBuiltinPolicy extends Omit<RuntimeCompilationPolicy,"inheritedFlags">,Pick<RuntimeDynamicExecutionPolicy,"resolveBuiltins"> {
  currentFrame():RuntimeFrame|undefined;
  frameLocals(frame:RuntimeFrame):RuntimeValue;
  /** Explicit fallback when there is no frame or its host namespace has no
   * original guest identity. A frame's captured builtins otherwise take priority. */
  readonly builtins:RuntimeValue;
}

/** Assemble the code/namespace builtin family against one execution context.
 * Caller future bits follow the active guest frame; optimization is an execution
 * default, not inherited from the caller's optimization at compile time. */
export function createRuntimeCodeBuiltins(context:RuntimeExecutionContext,programs:RuntimeCodePrograms,policy:RuntimeCodeBuiltinPolicy,meter:ExecutionMeter):Readonly<Record<"compile"|"eval"|"exec"|"globals"|"locals"|"vars"|"dir",BuiltinFunctionValue>> {
  let fatal=false;
  try {
  meter.checkpoint(1,512);
  const values=context.values;
  const globals=()=>{const frame=policy.currentFrame();meter.checkpoint();return frame?.namespaces.globals.object;};
  const locals=()=>{
    const frame=policy.currentFrame();meter.checkpoint();
    if(frame===undefined)throw Error("locals require a current guest frame");
    return policy.frameLocals(frame);
  };
  const inheritedFlags=()=>{
    const frame=policy.currentFrame();meter.checkpoint();
    // Executable flags (generator, coroutine, nested, class scope, etc.) are not
    // compiler futures and must not escape into normalizeFutureFlags.
    return (frame?.code?.flags??0)&0x1fe0000;
  };
  const compilation=createRuntimeCompilation(values,programs,{
    compilation:policy.compilation.bind(policy),code:policy.code.bind(policy),
    decodeFilename:policy.decodeFilename,compileExtended:policy.compileExtended?.bind(policy),inheritedFlags
  });
  const dynamic=createRuntimeDynamicExecution(context,programs,{
    globals,locals,
    builtins(){const frame=policy.currentFrame();meter.checkpoint();return frame?.namespaces.builtins.object??policy.builtins;},
    compilation(){const options=policy.compilation();meter.checkpoint();return {...options,futureFlags:inheritedFlags()};},
    resolveBuiltins:policy.resolveBuiltins?.bind(policy)
  });
  return Object.freeze({
    compile:createCompileBuiltin(values,meter,compilation),
    eval:createDynamicExecutionBuiltin("eval",values,meter,dynamic),
    exec:createDynamicExecutionBuiltin("exec",values,meter,dynamic),
    globals:createNamespaceBuiltin("globals",values,meter,()=>{const object=globals();if(object===undefined)throw Error("globals require an original guest dictionary");return object;}),
    locals:createNamespaceBuiltin("locals",values,meter,locals),
    vars:createVarsBuiltin(values,meter,locals),
    dir:createDirBuiltin(values,meter,locals)
  });
  } catch(error){fatal=error instanceof ExecutionLimitError;throw error;}
  finally{if(!fatal)meter.checkpoint();}
}

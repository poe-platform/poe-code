import type {DynamicExecutionRequest} from "./builtin-dynamic-execution.js";
import {diagnosticTypeName} from "./diagnostic-type-name.js";
import {PythonRuntimeError} from "./error.js";
import {ExecutionLimitError,type ExecutionMeter} from "./execution-budget.js";
import {runtimeDictionaryPayload} from "./runtime-dictionary-payload.js";
import type {RuntimeValue,RuntimeValues} from "./runtime-values.js";

export interface DynamicNamespaceContext {
  /** Execution-owned defaults. Undefined globals means no current frame/main.
   * Locals must implement the frame's fresh-snapshot or live-mapping policy. */
  globals():RuntimeValue|undefined;
  locals():RuntimeValue;
  builtins():RuntimeValue;
  /** PyMapping_Check-style slot inspection, not isinstance(Mapping) or keys(). */
  isMapping(value:RuntimeValue):boolean;
  typeName(value:RuntimeValue):string;
}
export interface DynamicNamespaces {
  readonly globals:RuntimeValue;
  readonly locals:RuntimeValue;
  /** Raw selected __builtins__; the execution backend resolves module objects. */
  readonly builtins:RuntimeValue;
}

/** Select/validate namespaces before source admission. Dictionary storage access
 * bypasses subclass item overrides, while returned guest identities are retained.
 * No namespace is copied here; frame default-locals policy is an explicit hook. */
export function prepareDynamicNamespaces(request:Pick<DynamicExecutionRequest,"mode"|"globals"|"locals">,values:RuntimeValues,meter:ExecutionMeter,context:DynamicNamespaceContext):DynamicNamespaces {
  let fatal=false;
  try {
    meter.checkpoint(1,256);
    const mode=request.mode;
    let globals:RuntimeValue|undefined=request.globals,locals=request.locals;
    if(mode==="eval"){
      if(locals.kind!=="none"){
        const valid=context.isMapping(locals);meter.checkpoint();
        if(!valid)throw new PythonRuntimeError("TypeError","locals must be a mapping");
      }
      if(globals.kind!=="none"&&runtimeDictionaryPayload(globals)===undefined){
        const mapping=context.isMapping(globals);meter.checkpoint();
        throw new PythonRuntimeError("TypeError",mapping?"globals must be a real dict; try eval(expr, {}, mapping)":"globals must be a dict");
      }
    }
    const fromFrame=globals.kind==="none";
    if(fromFrame){globals=context.globals();meter.checkpoint();}
    if(globals===undefined)throw new PythonRuntimeError(mode==="eval"?"TypeError":"SystemError",mode==="eval"?"eval must be given globals and locals when called without a frame":"globals and locals cannot be NULL");
    if(locals.kind==="none"){locals=fromFrame?context.locals():globals;meter.checkpoint();}
    const storage=runtimeDictionaryPayload(globals);
    if(storage===undefined){
      if(mode==="eval")throw Error("default eval globals must have dictionary storage");
      const type=diagnosticTypeName(context.typeName(globals),meter,100);meter.checkpoint(0,160+2*type.length);
      throw new PythonRuntimeError("TypeError",`exec() globals must be a dict, not ${type}`);
    }
    if(mode==="exec"){
      const valid=context.isMapping(locals);meter.checkpoint();
      if(!valid){
        const type=diagnosticTypeName(context.typeName(locals),meter,100);meter.checkpoint(0,160+2*type.length);
        throw new PythonRuntimeError("TypeError",`locals must be a mapping or None, not ${type}`);
      }
    }
    const key=values.string("__builtins__"),existing=storage.items.lookup(key);meter.checkpoint();
    let builtins:RuntimeValue;
    if(existing!==undefined)builtins=existing.value;
    else {builtins=context.builtins();meter.checkpoint();storage.items.set(key,builtins);meter.checkpoint();}
    return Object.freeze({globals,locals,builtins});
  } catch(error){fatal=error instanceof ExecutionLimitError;throw error;}
  finally{if(!fatal)meter.checkpoint();}
}

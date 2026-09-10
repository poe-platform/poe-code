import { executeClassBody } from "./class-body.js";
import type { ExecutionMeter } from "./execution-budget.js";
import type { CellStorage } from "./lexical-frame.js";
import type { LocalNamespace } from "./module-frame.js";
import { OrderedKeyMap } from "./ordered-key-map.js";
import { runtimeDictionaryStorage } from "./runtime-dictionary-storage.js";
import type { CompiledProgram } from "./program-compilation.js";
import { RuntimeDictionaryNamespace } from "./runtime-dictionary-namespace.js";
import { invokeRuntimeFunction } from "./runtime-function-call.js";
import { createRuntimeFrameBody, type RuntimeExecutionContext } from "./runtime-program.js";
import type { FunctionValue, RuntimeValue } from "./runtime-values.js";

export interface RuntimeBuilderBodyContext extends RuntimeExecutionContext {
  /** Adapt non-dictionary prepared mappings through explicit guest protocols.
   * Ordinary optimized functions must not consult this mapping. */
  namespace?(value: RuntimeValue): LocalNamespace<RuntimeValue>;
}

/** Execute an already validated Python function for __build_class__. Compiled
 * class bodies use prepared locals; ordinary functions keep optimized locals and
 * normal argument binding. Only a returned cell participates in construction
 * validation. Captures and nested code registries belong to the body function,
 * not the calling builder. Arbitrary mappings and suspension remain explicit.
 */
export function executeRuntimeBuilderBody(
  fn: FunctionValue, namespace: RuntimeValue, program: CompiledProgram<RuntimeValue>,
  context: RuntimeBuilderBodyContext, meter: ExecutionMeter
): CellStorage<RuntimeValue> | undefined {
  meter.checkpoint(1, 128);
  const { values, keys, calls, hooks } = context, code = fn.value.code;
  const body = createRuntimeFrameBody(program, context, meter);
  const bindBody = (frame: Parameters<typeof body>[0]) => body(frame, fn.value, code.definitions ?? program.functions, code.classDefinitions ?? program.classFunctions);
  if (code.body.kind === "class") {
    if(namespace.kind==="dict")meter.checkpoint(0,96);
    const locals = namespace.kind === "dict" ? new RuntimeDictionaryNamespace(namespace, values, meter,{isException:context.exceptions?.matches.bind(context.exceptions)}) : context.namespace?.(namespace);
    meter.checkpoint();
    if (locals === undefined) throw new Error("prepared class namespace mapping adapter is unavailable");
    const result = executeClassBody(code.body.code, {
      globals: fn.value.globals, builtins: fn.value.builtins, closure: fn.value.closure,
      locals, calls, cell: values.cell.bind(values), body: bindBody
    }, meter);
    meter.checkpoint();
    return result;
  }
  const keywords = values.dictionary(new OrderedKeyMap<RuntimeValue, RuntimeValue>(keys, meter, runtimeDictionaryStorage));
  const result = invokeRuntimeFunction(fn, [], keywords, {
    values, keys, calls, body: bindBody, suspended: hooks.suspended?.bind(hooks)
  }, meter);
  meter.checkpoint();
  return result.kind === "cell" ? result.value : undefined;
}

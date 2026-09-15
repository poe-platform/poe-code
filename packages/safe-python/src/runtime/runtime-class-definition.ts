import type { ClassDefinitionContext } from "./class-definition.js";
import { PythonRuntimeError } from "./error.js";
import type { ExecutionMeter } from "./execution-budget.js";
import { createFunctionState } from "./function-state.js";
import { lookupNamespace } from "./namespace-lookup.js";
import type { CompiledProgram } from "./program-compilation.js";
import type { RuntimeFunctionDefinitionBindings } from "./runtime-function-definition.js";
import type { RuntimeValue, RuntimeValues } from "./runtime-values.js";

/** Bind class statements to their compiled body functions and active builtins.
 * Builder overrides receive ordinary function records without executing suites.
 * The builtin builder's metaclass lifecycle is intentionally independent. */
export function createRuntimeClassDefinitions(
  program: Pick<CompiledProgram<RuntimeValue>, "classFunctions">,
  bindings: RuntimeFunctionDefinitionBindings & Pick<ClassDefinitionContext<RuntimeValue>, "decorate">,
  values: RuntimeValues, meter: ExecutionMeter
): ClassDefinitionContext<RuntimeValue> {
  meter.checkpoint(1, 192);
  return {
    evaluate: bindings.evaluate.bind(bindings), store: bindings.store.bind(bindings),
    beginCall: bindings.beginCall.bind(bindings), decorate: bindings.decorate.bind(bindings),
    nameValue: values.string.bind(values),
    lookupBuilder() {
      meter.checkpoint();
      const found = lookupNamespace(bindings.builtins, "__build_class__");
      meter.checkpoint();
      if (found === undefined) throw new PythonRuntimeError("NameError", "__build_class__ not found");
      return found.value;
    },
    createBody(statement) {
      meter.checkpoint();
      const code = program.classFunctions.get(statement);
      if (code === undefined) throw new Error("class definition has no matching compiled function code");
      const closure = bindings.capture?.(code.scope); meter.checkpoint();
      return values.function(createFunctionState(code, new Map(), {
        globals: bindings.globals, builtins: bindings.builtins, closure, none: values.none,
        resolveBuiltins: bindings.resolveBuiltins?.bind(bindings)
      }, meter));
    }
  };
}

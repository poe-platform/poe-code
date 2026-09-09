import type { FunctionNode } from "../expression-context.js";
import type { ResolvedScope } from "../symbol-resolution.js";
import type { ExecutionMeter } from "./execution-budget.js";
import type { ExpressionCall } from "./call-arguments.js";
import type { FunctionDefinitionContext } from "./function-definition.js";
import { createFunctionState, type FunctionCreationContext } from "./function-state.js";
import type { LexicalCell } from "./lexical-frame.js";
import type { CompiledProgram } from "./program-compilation.js";
import type { FunctionValue, RuntimeValue, RuntimeValues } from "./runtime-values.js";

export interface RuntimeFunctionDefinitionBindings extends Omit<FunctionCreationContext<RuntimeValue>, "none" | "closure">,
  Pick<FunctionDefinitionContext<RuntimeValue>, "evaluate" | "store"> {
  capture?(scope: ResolvedScope): ReadonlyMap<string, LexicalCell<RuntimeValue>>;
  beginCall(callee: RuntimeValue): ExpressionCall<RuntimeValue>;
}

export interface RuntimeFunctionDefinitions extends Omit<FunctionDefinitionContext<RuntimeValue>, "create"> {
  /** Also serves the expression runtime's createLambda hook. */
  create(node: FunctionNode, defaults: ReadonlyMap<string, RuntimeValue>): FunctionValue;
}

/** Bind definition/lambda creation to precompiled AST identities and the defining
 * namespace. Capture cells, not copied contents; defaults were evaluated by the
 * shared statement/expression engines. No body runs during creation. Classes,
 * descriptors and concrete builtin namespace adaptation remain separate hooks.
 */
export function createRuntimeFunctionDefinitions(program: Pick<CompiledProgram<RuntimeValue>, "functions">, bindings: RuntimeFunctionDefinitionBindings, values: RuntimeValues, meter: ExecutionMeter): RuntimeFunctionDefinitions {
  meter.checkpoint(1, 192);
  return {
    evaluate: bindings.evaluate.bind(bindings),
    store: bindings.store.bind(bindings),
    create(node, defaults) {
      meter.checkpoint();
      const code = program.functions.get(node);
      if (code === undefined) throw new Error("function definition has no matching compiled code");
      const closure = bindings.capture?.(code.scope);
      meter.checkpoint();
      const context: FunctionCreationContext<RuntimeValue> = { globals: bindings.globals, builtins: bindings.builtins, none: values.none, closure };
      if (bindings.resolveBuiltins) context.resolveBuiltins = bindings.resolveBuiltins.bind(bindings);
      return values.function(createFunctionState(code, defaults, context, meter));
    },
    decorate(decorator, value) {
      meter.checkpoint();
      const call = bindings.beginCall(decorator); meter.checkpoint();
      call.positional(value); meter.checkpoint();
      const result = call.invoke(); meter.checkpoint();
      return result;
    }
  };
}

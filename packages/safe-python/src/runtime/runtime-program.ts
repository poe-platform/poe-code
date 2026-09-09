import type { ExecutionMeter } from "./execution-budget.js";
import { evaluateExpression } from "./expression-evaluation.js";
import { executeFunctionDefinition } from "./function-definition.js";
import type { FunctionCreationContext } from "./function-state.js";
import type { FunctionInvocationContext } from "./function-invocation.js";
import { LexicalFrame, type LexicalNamespaces } from "./lexical-frame.js";
import type { ModuleFrame, ModuleNamespaces } from "./module-frame.js";
import { executeModule } from "./module-execution.js";
import type { CallStack } from "./call-stack.js";
import type { KeyOperations } from "./ordered-key-map.js";
import type { CompiledProgram } from "./program-compilation.js";
import { beginRuntimeCall, type RuntimeCallContext } from "./runtime-call.js";
import { createRuntimeExpressionContext, type RuntimeExpressionBindings } from "./runtime-expression-context.js";
import { createRuntimeFunctionDefinitions } from "./runtime-function-definition.js";
import { invokeRuntimeFunction, type RuntimeFunctionContext } from "./runtime-function-call.js";
import { createRuntimeStatementContext, type RuntimeStatementBindings } from "./runtime-statement-context.js";
import type { DictionaryValue, RuntimeValue, RuntimeValues } from "./runtime-values.js";

export type RuntimeFrame = ModuleFrame<RuntimeValue> | LexicalFrame<RuntimeValue>;

/** Explicit extension points. Factories prepare hooks for an active frame; they
 * must not execute its body. Host objects/filesystem APIs are never discovered
 * implicitly. Non-function calls use the supplied guest object policy.
 */
export interface RuntimeProgramHooks extends Pick<RuntimeCallContext, "callable" | "name" | "keywordName">,
  Pick<FunctionCreationContext<RuntimeValue>, "resolveBuiltins">,
  Pick<FunctionInvocationContext<RuntimeValue>, "suspended"> {
  expressions(frame: RuntimeFrame): Pick<RuntimeExpressionBindings, "attribute" | "beginSet" | "warn">;
  statements(frame: RuntimeFrame): Omit<RuntimeStatementBindings, "deleteName">;
  invoke(callee: RuntimeValue, positional: readonly RuntimeValue[], keywords: DictionaryValue, frame: RuntimeFrame): RuntimeValue;
}

export interface RuntimeProgramContext extends ModuleNamespaces<RuntimeValue> {
  readonly values: RuntimeValues;
  readonly keys: KeyOperations<RuntimeValue>;
  readonly calls: Pick<CallStack<RuntimeFrame>, "enter">;
  readonly hooks: RuntimeProgramHooks;
}

/** Assemble the internal concrete execution path with shared values, key policy,
 * namespaces, depth policy and meter. Module/class scopes remain distinct; nested
 * function bodies use the callee's captured namespaces, not the module defaults.
 * This is not a complete public interpreter: object/builtin/class/import hooks,
 * suspended execution, full resource accounting and safe-fs still need integration.
 */
export function executeRuntimeProgram(program: CompiledProgram<RuntimeValue>, context: RuntimeProgramContext, meter: ExecutionMeter): void {
  meter.checkpoint(1, 192);
  const { values, keys, hooks, calls } = context;
  const body = (frame: RuntimeFrame, namespaces: LexicalNamespaces<RuntimeValue>) => {
    meter.checkpoint(1, 384);
    const expressionHooks = hooks.expressions(frame); meter.checkpoint();
    const statementHooks = hooks.statements(frame); meter.checkpoint();
    const beginCall = (callee: RuntimeValue) => beginRuntimeCall(callee, {
      values, keys, name: hooks.name.bind(hooks), keywordName: hooks.keywordName.bind(hooks),
      callable: value => value.kind === "function" || hooks.callable(value),
      invoke(value, positional, keywords) {
        if (value.kind !== "function") return hooks.invoke(value, positional, keywords, frame);
        const invocation: RuntimeFunctionContext = {
          values, keys, calls, body: child => body(child, value.value)
        };
        if (hooks.suspended) invocation.suspended = hooks.suspended.bind(hooks);
        return invokeRuntimeFunction(value, positional, keywords, invocation, meter);
      }
    }, meter);
    const definitions = createRuntimeFunctionDefinitions(program, {
      globals: namespaces.globals, builtins: namespaces.builtins,
      capture: frame instanceof LexicalFrame ? frame.capture.bind(frame) : undefined,
      resolveBuiltins: hooks.resolveBuiltins?.bind(hooks),
      evaluate: expression => evaluateExpression(expression, expressions, meter),
      beginCall, store: frame.store.bind(frame)
    }, values, meter);
    const expressions = createRuntimeExpressionContext(values, {
      load: frame.load.bind(frame), store: frame.store.bind(frame),
      attribute: expressionHooks.attribute.bind(expressionHooks), beginSet: expressionHooks.beginSet.bind(expressionHooks),
      warn: expressionHooks.warn.bind(expressionHooks), beginCall, dictionaryKeys: keys,
      createLambda: definitions.create.bind(definitions)
    }, meter);
    return createRuntimeStatementContext(expressions, {
      deleteName: frame.delete.bind(frame),
      setAttribute: statementHooks.setAttribute.bind(statementHooks), deleteAttribute: statementHooks.deleteAttribute.bind(statementHooks),
      assertions: statementHooks.assertions, managers: statementHooks.managers, exceptions: statementHooks.exceptions,
      executeUnhandled(statement) {
        if (statement.kind === "function") executeFunctionDefinition(statement, definitions, meter);
        else statementHooks.executeUnhandled(statement);
      }
    }, values, meter);
  };
  executeModule(program.module, {
    globals: context.globals, builtins: context.builtins, locals: context.locals, calls,
    body: frame => body(frame, context)
  }, meter);
}

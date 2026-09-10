import { ExecutionLimitError, type ExecutionMeter } from "./execution-budget.js";
import { PythonRuntimeError } from "./error.js";
import { evaluateExpression, UnsupportedExpressionError } from "./expression-evaluation.js";
import type { FormatContext } from "./format-protocol.js";
import { createRuntimeFormatContext } from "./runtime-format.js";
import { createRuntimeInvocationFormatContext } from "./runtime-invocation-format.js";
import { createRuntimeNumericContext } from "./runtime-numeric-context.js";
import { createRuntimePowerContext } from "./runtime-power-context.js";
import { createRuntimeRichComparisonContext } from "./runtime-rich-comparison-context.js";
import { runtimeInPlaceSpecialMethod } from "./runtime-inplace-special-method.js";
import type { RuntimeRepresentationState } from "./runtime-representation.js";
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
import { runtimeCallable } from "./runtime-callability.js";
import { runtimeTruth } from "./runtime-truth.js";
import { createRuntimeIndexContext } from "./runtime-index-context.js";
import type { IntegerIndexContext } from "./index-protocol.js";
import { createRuntimeExpressionContext, type RuntimeExpressionBindings } from "./runtime-expression-context.js";
import { createRuntimeFunctionDefinitions, type RuntimeFunctionDefinitionBindings } from "./runtime-function-definition.js";
import { invokeRuntimeFunction, type RuntimeFunctionContext } from "./runtime-function-call.js";
import { createRuntimeStatementContext, type RuntimeStatementBindings } from "./runtime-statement-context.js";
import type { BuiltinInvocationContext, DictionaryValue, RuntimeValue, RuntimeValues } from "./runtime-values.js";
import { ClassFrame } from "./class-frame.js";
import { executeClassBody } from "./class-body.js";
import { createRuntimeClassDefinitions } from "./runtime-class-definition.js";
import { executeClassDefinition } from "./class-definition.js";
import { lookupRuntimeSpecialMethod, type RuntimeSpecialMethodContext } from "./runtime-special-method.js";
import { lookupMroAttribute } from "./class-attributes.js";

export type RuntimeFrame = ModuleFrame<RuntimeValue> | LexicalFrame<RuntimeValue> | ClassFrame<RuntimeValue>;

/** Explicit extension points. Factories prepare hooks for an active frame; they
 * must not execute its body. Host objects/filesystem APIs are never discovered
 * implicitly. Non-function calls use the supplied guest object policy.
 */
export interface RuntimeProgramHooks extends Pick<RuntimeCallContext, "callable" | "name" | "keywordName">,
  Pick<FunctionCreationContext<RuntimeValue>, "resolveBuiltins">,
  Pick<FunctionInvocationContext<RuntimeValue>, "suspended"> {
  expressions(frame: RuntimeFrame): Pick<RuntimeExpressionBindings, "attribute" | "beginSet" | "warn" | "formattedString" | "addition" | "multiplication" | "numeric" | "unary" | "truth" | "richComparison" | "containment" | "iteration" | "power" | "integerIndex" | "bytes" | "translation" | "buffers">;
  statements(frame: RuntimeFrame): Omit<RuntimeStatementBindings, "deleteName" | "integerIndex">;
  specialMethods?(frame: RuntimeFrame): RuntimeSpecialMethodContext;
  invoke(callee: RuntimeValue, positional: readonly RuntimeValue[], keywords: DictionaryValue, frame: RuntimeFrame): RuntimeValue;
}

export interface RuntimeExecutionContext {
  /** Shared by all frames; builtin registration can use this same context. */
  readonly formatting?: FormatContext<RuntimeValue>;
  readonly values: RuntimeValues;
  readonly keys: KeyOperations<RuntimeValue>;
  readonly calls: Pick<CallStack<RuntimeFrame>, "enter">;
  readonly hooks: RuntimeProgramHooks;
}

export interface RuntimeProgramContext extends ModuleNamespaces<RuntimeValue>, RuntimeExecutionContext {}

/** Assemble the internal concrete execution path with shared values, key policy,
 * namespaces, depth policy and meter. Module/class scopes remain distinct; nested
 * function bodies use the callee's captured namespaces, not the module defaults.
 * This is not a complete public interpreter: object/builtin/class/import hooks,
 * suspended execution, full resource accounting and safe-fs still need integration.
 */
export function createRuntimeFrameBody(program: CompiledProgram<RuntimeValue>, context: RuntimeExecutionContext, meter: ExecutionMeter) {
  meter.checkpoint(1, 256);
  const { values, keys, hooks, calls } = context;
  meter.checkpoint(0, 16);
  const representationState: RuntimeRepresentationState = {};
  let defaultFormatting: FormatContext<RuntimeValue> | undefined;
  const getDefaultFormatting = () => defaultFormatting ??= createRuntimeFormatContext(values, meter, { defaultRepr() { throw new UnsupportedExpressionError("interpolated-string"); } }, representationState);
  const body = (frame: RuntimeFrame, namespaces: LexicalNamespaces<RuntimeValue>, functions = program.functions, classFunctions = program.classFunctions, literals = program.literals ?? null) => {
    meter.checkpoint(1, 512);
    const expressionHooks = hooks.expressions(frame); meter.checkpoint();
    const statementHooks = hooks.statements(frame); meter.checkpoint();
    const specialMethods = hooks.specialMethods?.(frame); meter.checkpoint();
    const beginCall = (callee: RuntimeValue) => beginRuntimeCall(callee, {
      iteration: expressionHooks.iteration,
      values, keys, name: value => value.kind === "builtin_function_or_method" ? `${value.value.name}()` : hooks.name(value.kind === "method" ? value.value.function : value), keywordName: hooks.keywordName.bind(hooks),
      callable: value => runtimeCallable(value, meter, hooks),
      invoke(value, positional, keywords) {
        if (value.kind === "builtin_function_or_method") return value.value.invoke(positional, keywords, meter, builtinCalls);
        const fn = value.kind === "method" ? value.value.function : value;
        let args = positional;
        if (value.kind === "method") {
          meter.checkpoint(1, 32 + 8 * (positional.length + 1));
          args = Object.freeze([value.value.instance, ...positional]);
        }
        if (fn.kind !== "function") return hooks.invoke(fn, args, keywords, frame);
        const invocation: RuntimeFunctionContext = {
          values, keys, calls, body: child => body(child, fn.value, fn.value.code.definitions ?? functions, fn.value.code.classDefinitions ?? classFunctions, fn.value.code.literals ?? null),
          classBody(code) {
            let result: RuntimeValue = values.none;
            const globals = fn.value.globals;
            executeClassBody(code, {
              ...fn.value, calls,
              locals: {
                lookup: name => globals.has(name) ? { value: globals.get(name)! } : undefined,
                store: (name, value) => { globals.set(name, value); },
                delete: name => globals.delete(name), isGuest: () => false
              },
              cell: cell => { result = values.cell(cell); return result; },
              body: child => body(child, fn.value, fn.value.code.definitions ?? functions, fn.value.code.classDefinitions ?? classFunctions, fn.value.code.literals ?? null)
            }, meter);
            return result;
          }
        };
        if (hooks.suspended) invocation.suspended = hooks.suspended.bind(hooks);
        return invokeRuntimeFunction(fn, args, keywords, invocation, meter);
      }
    }, meter);
    meter.checkpoint(0, 128);
    const builtinCalls: BuiltinInvocationContext = {
      get formatting() { return getFormatting(); },
      hasSpecial(value, name) {
        if (specialMethods === undefined) return false;
        const type = specialMethods.typeOf(value); meter.checkpoint();
        return lookupMroAttribute(type.value.mro, values.string(name), (owner, key) => owner.namespace.items.lookup(key), meter) !== undefined;
      },
      warn: expressionHooks.warn.bind(expressionHooks),
      lookupSpecial(value, name) {
        if (specialMethods === undefined) return undefined;
        const type = specialMethods.typeOf(value); meter.checkpoint();
        return lookupRuntimeSpecialMethod(value, type, values.string(name), specialMethods, values, meter);
      },
      typeName: specialMethods === undefined ? undefined : value => {
        const type = specialMethods.typeOf(value); meter.checkpoint(); return type.value.name;
      },
      setAttribute: statementHooks.setAttribute.bind(statementHooks),
      deleteAttribute: statementHooks.deleteAttribute.bind(statementHooks),
      attribute: (object, name) => expressions.attribute(object, name),
      get power() { return power; },
      numeric: expressionHooks.numeric?.bind(expressionHooks) ?? (specialMethods === undefined ? undefined : (operator, left, right) => createRuntimeNumericContext(operator, left, right, values, meter, specialMethods, builtinCalls)),
      isCallable: value => runtimeCallable(value, meter, hooks),
      binary: (operator, left, right) => expressions.binary(operator, left, right),
      get integerIndex() { return getIntegerIndex(); },
      iteration: expressionHooks.iteration,
      truth: value => expressions.truth(value),
      compare: (operator, left, right) => expressions.compare(operator, left, right),
      compareTruth(operator, left, right) {
        const result = expressions.compare(operator, left, right); meter.checkpoint();
        return expressions.truth(result);
      },
      call(callee, positional) {
        const call = beginCall(callee);
        for (const value of positional) { meter.checkpoint(); call.positional(value); }
        return call.invoke();
      },
      isStopIteration(error) {
        if (error instanceof ExecutionLimitError) return false;
        if (error instanceof PythonRuntimeError && error.name === "StopIteration") return true;
        const result = expressionHooks.iteration?.isStopIteration(error) ?? false;
        meter.checkpoint(); return result;
      }
    };
    const power = expressionHooks.power ?? (specialMethods === undefined ? undefined : createRuntimePowerContext(values, meter, specialMethods, builtinCalls));
    let integerIndex: IntegerIndexContext<RuntimeValue> | undefined, indexResolved = false;
    const getIntegerIndex = () => {
      meter.checkpoint();
      if (!indexResolved) {
        integerIndex = expressionHooks.integerIndex ?? (specialMethods === undefined ? undefined : createRuntimeIndexContext(builtinCalls, meter));
        meter.checkpoint(); indexResolved = true;
      }
      return integerIndex;
    };
    let formatting: FormatContext<RuntimeValue> | undefined;
    const getFormatting = () => {
      meter.checkpoint();
      formatting ??= context.formatting ?? (specialMethods !== undefined
        ? createRuntimeInvocationFormatContext(values, meter, builtinCalls, getDefaultFormatting(), representationState)
        : getDefaultFormatting());
      meter.checkpoint(); return formatting;
    };
    const definitionBindings: RuntimeFunctionDefinitionBindings = {
      globals: namespaces.globals, builtins: namespaces.builtins,
      capture: frame instanceof LexicalFrame || frame instanceof ClassFrame ? frame.capture.bind(frame) : undefined,
      resolveBuiltins: hooks.resolveBuiltins?.bind(hooks),
      evaluate: expression => evaluateExpression(expression, expressions, meter),
      beginCall, store: frame.store.bind(frame)
    };
    const definitions = createRuntimeFunctionDefinitions({ functions }, definitionBindings, values, meter);
    const classDefinitions = createRuntimeClassDefinitions({ classFunctions }, { ...definitionBindings, decorate: definitions.decorate.bind(definitions) }, values, meter);
    const expressions = createRuntimeExpressionContext(values, {
      bytes: expressionHooks.bytes,
      translation: expressionHooks.translation,
      buffers: expressionHooks.buffers,
      get integerIndex() { return getIntegerIndex(); },
      constants: literals?.folded,
      literal: literals === null ? undefined : node => {
        meter.checkpoint();
        if (!literals.has(node)) throw new Error("literal is missing from originating compiled code");
        return literals.get(node)!;
      },
      load: frame.load.bind(frame), store: frame.store.bind(frame),
      attribute: expressionHooks.attribute?.bind(expressionHooks), beginSet: expressionHooks.beginSet?.bind(expressionHooks),
      get formattedString() { return expressionHooks.formattedString; },
      addition: expressionHooks.addition?.bind(expressionHooks) ?? (specialMethods === undefined ? undefined : (left, right) => createRuntimeNumericContext("+", left, right, values, meter, specialMethods, builtinCalls)),
      multiplication: expressionHooks.multiplication?.bind(expressionHooks) ?? (specialMethods === undefined ? undefined : (left, right) => createRuntimeNumericContext("*", left, right, values, meter, specialMethods, builtinCalls)),
      numeric: builtinCalls.numeric,
      power,
      unary: expressionHooks.unary ?? (specialMethods === undefined ? undefined : builtinCalls),
      truth: expressionHooks.truth?.bind(expressionHooks) ?? (specialMethods === undefined ? undefined : value => runtimeTruth(value, meter, builtinCalls)),
      richComparison: expressionHooks.richComparison?.bind(expressionHooks) ?? (specialMethods === undefined ? undefined : (operator, left, right) => createRuntimeRichComparisonContext(operator, left, right, values, meter, specialMethods, builtinCalls)),
      containment: expressionHooks.containment?.bind(expressionHooks),
      iteration: expressionHooks.iteration,
      get formatting() { return getFormatting(); },
      warn: expressionHooks.warn.bind(expressionHooks), beginCall, dictionaryKeys: keys,
      createLambda: definitions.create.bind(definitions)
    }, meter);
    let inplace = statementHooks.inplace?.bind(statementHooks);
    if (inplace === undefined && specialMethods !== undefined) {
      meter.checkpoint(0, 64);
      inplace = (operator, left, right) => runtimeInPlaceSpecialMethod(operator, left, right, values, meter, builtinCalls);
    }
    return createRuntimeStatementContext(expressions, {
      get integerIndex() { return getIntegerIndex(); },
      deleteName: frame.delete.bind(frame),
      inplace,
      setAttribute: statementHooks.setAttribute.bind(statementHooks), deleteAttribute: statementHooks.deleteAttribute.bind(statementHooks),
      assertions: statementHooks.assertions, managers: statementHooks.managers, exceptions: statementHooks.exceptions,
      executeUnhandled(statement) {
        if (statement.kind === "function") executeFunctionDefinition(statement, definitions, meter);
        else if (statement.kind === "class") executeClassDefinition(statement, classDefinitions, meter);
        else statementHooks.executeUnhandled(statement);
      }
    }, values, meter);
  };
  return body;
}

/** Execute the compiled module with the same frame assembly used for functions
 * and prepared class suites. Ordinary module locals retain their own routing. */
export function executeRuntimeProgram(program: CompiledProgram<RuntimeValue>, context: RuntimeProgramContext, meter: ExecutionMeter): void {
  const body = createRuntimeFrameBody(program, context, meter);
  executeModule(program.module, {
    globals: context.globals, builtins: context.builtins, locals: context.locals, calls: context.calls,
    body: frame => body(frame, context)
  }, meter);
}

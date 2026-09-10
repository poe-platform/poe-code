import { ExecutionLimitError, type ExecutionMeter } from "./execution-budget.js";
import type { Expression } from "../ast.js";
import { PythonRuntimeError } from "./error.js";
import { createExpressionContinuation, evaluateExpression, UnsupportedExpressionError } from "./expression-evaluation.js";
import type { FormatContext } from "./format-protocol.js";
import { createRuntimeFormatContext } from "./runtime-format.js";
import { createRuntimeInvocationFormatContext } from "./runtime-invocation-format.js";
import { createRuntimeNumericContext } from "./runtime-numeric-context.js";
import { createRuntimePowerContext } from "./runtime-power-context.js";
import { createRuntimeRichComparisonContext } from "./runtime-rich-comparison-context.js";
import { runtimeReceiverComparison } from "./runtime-receiver-comparison.js";
import { createRuntimeIterationContext } from "./runtime-iteration-context.js";
import { createRuntimeContainmentPolicy } from "./runtime-containment-context.js";
import { runtimeInPlaceSpecialMethod } from "./runtime-inplace-special-method.js";
import type { RuntimeRepresentationState } from "./runtime-representation.js";
import { RepresentationStack } from "./representation-stack.js";
import { listRepresentation } from "./list-representation.js";
import { runtimeSetRepresentation } from "./runtime-set-representation.js";
import { runtimeListPayload } from "./runtime-list-payload.js";
import { createFunctionDefinitionContinuation, executeFunctionDefinition } from "./function-definition.js";
import type { FunctionCreationContext } from "./function-state.js";
import { UnsupportedFunctionExecutionError, type FunctionInvocationContext } from "./function-invocation.js";
import { LexicalFrame, type LexicalNamespaces } from "./lexical-frame.js";
import type { ModuleFrame, ModuleNamespaces } from "./module-frame.js";
import { executeModule } from "./module-execution.js";
import type { CallStack } from "./call-stack.js";
import type { KeyOperations } from "./ordered-key-map.js";
import type { CompiledProgram } from "./program-compilation.js";
import { beginRuntimeCall, type RuntimeCallContext } from "./runtime-call.js";
import { runtimeDirectMethod } from "./runtime-direct-method.js";
import { runtimeCallable } from "./runtime-callability.js";
import { runtimeTruth } from "./runtime-truth.js";
import { createRuntimeIndexContext } from "./runtime-index-context.js";
import type { IntegerIndexContext } from "./index-protocol.js";
import { createRuntimeExpressionContext, type RuntimeExpressionBindings } from "./runtime-expression-context.js";
import { createRuntimeFunctionDefinitions, type RuntimeFunctionDefinitionBindings } from "./runtime-function-definition.js";
import { invokeRuntimeFunction, type RuntimeFunctionContext } from "./runtime-function-call.js";
import { createRuntimeStatementContext, type RuntimeStatementBindings, type RuntimeStatementContext } from "./runtime-statement-context.js";
import { hasRuntimeInstanceAttributes, type BuiltinInvocationContext, type DictionaryValue, type RuntimeValue, type RuntimeValues } from "./runtime-values.js";
import { ClassFrame } from "./class-frame.js";
import { executeClassBody } from "./class-body.js";
import { RuntimeDictionaryNamespace } from "./runtime-dictionary-namespace.js";
import { RuntimeMappingNamespace } from "./runtime-mapping-namespace.js";
import { createRuntimeClassDefinitions } from "./runtime-class-definition.js";
import { createClassDefinitionContinuation, executeClassDefinition } from "./class-definition.js";
import { lookupRuntimeSpecialMethod, runtimeActualType, type RuntimeSpecialMethodContext } from "./runtime-special-method.js";
import { lookupMroAttribute } from "./class-attributes.js";
import { callRuntimeType } from "./runtime-type-call.js";
import { finalizeRuntimeType } from "./runtime-type-finalization.js";
import { representationObject } from "./representation-protocol.js";
import { callRuntimeMethodDescriptor } from "./runtime-method-descriptor.js";
import { runtimeInstanceAttribute, runtimeMutateInstanceAttribute } from "./runtime-instance-attributes.js";
import { runtimeTypeAttribute, runtimeMutateTypeAttribute } from "./runtime-type-attributes.js";
import { runtimeMutateFunctionAttribute } from "./runtime-function-mutation.js";
import { runtimeObjectAttribute, runtimeMutateObjectAttribute } from "./runtime-object-attributes.js";
import { runtimeOwnedDescriptorSlots } from "./runtime-owned-descriptor.js";
import { isRuntimeMethodDecoratorSubclass } from "./runtime-method-decorator.js";
import type { RuntimeExceptionExecution } from "./runtime-exception-execution.js";
import { ComprehensionCursor,executeComprehensionClauses } from "./comprehension-execution.js";
import { createStatementContinuation } from "./statement-execution.js";

export type RuntimeFrame = ModuleFrame<RuntimeValue> | LexicalFrame<RuntimeValue> | ClassFrame<RuntimeValue>;

/** Explicit extension points. Factories prepare hooks for an active frame; they
 * must not execute its body. Host objects/filesystem APIs are never discovered
 * implicitly. With an actual-type policy, type calls use the shared metaclass
 * and instantiation lifecycle; other non-function calls use the supplied policy.
 */
export interface RuntimeProgramHooks extends Pick<RuntimeCallContext, "callable" | "name" | "keywordName">,
  Pick<FunctionCreationContext<RuntimeValue>, "resolveBuiltins">,
  Pick<FunctionInvocationContext<RuntimeValue>, "suspended"> {
  expressions(frame: RuntimeFrame): Pick<RuntimeExpressionBindings, "attribute" | "beginSet" | "warn" | "formattedString" | "addition" | "multiplication" | "numeric" | "unary" | "truth" | "richComparison" | "containment" | "iteration" | "power" | "integerIndex" | "bytes" | "translation" | "buffers" | "subscription" | "mapping" | "percent">;
  statements(frame: RuntimeFrame): Omit<RuntimeStatementBindings, "deleteName" | "integerIndex">;
  specialMethods?(frame: RuntimeFrame): RuntimeSpecialMethodContext;
  invoke(callee: RuntimeValue, positional: readonly RuntimeValue[], keywords: DictionaryValue, frame: RuntimeFrame): RuntimeValue;
}

export interface RuntimeExecutionContext {
  readonly exceptions?: RuntimeExceptionExecution;
  /** Share an override with id registration and identity hashing when supplied. */
  readonly identity?: BuiltinInvocationContext["identity"];
  /** Shared by all frames; builtin registration can use this same context. */
  readonly formatting?: FormatContext<RuntimeValue>;
  readonly values: RuntimeValues;
  readonly keys: KeyOperations<RuntimeValue> & {
    /** Optional execution-owned policy; collection identity stays shared. */
    bindInvocation?(frame: RuntimeFrame, invocation: BuiltinInvocationContext): void;
    identityHash?(value: RuntimeValue): bigint;
    nativeHash?(value: RuntimeValue): bigint;
  };
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
  const body = (frame: RuntimeFrame, namespaces: LexicalNamespaces<RuntimeValue>, functions = program.functions, classFunctions = program.classFunctions, literals = program.literals ?? null, comprehensions = program.comprehensions):RuntimeStatementContext => {
    meter.checkpoint(1, 512);
    const expressionHooks = hooks.expressions(frame); meter.checkpoint();
    const statementHooks = hooks.statements(frame); meter.checkpoint();
    const suppliedSpecialMethods = hooks.specialMethods?.(frame); meter.checkpoint(1, suppliedSpecialMethods === undefined ? 0 : 96);
    const specialMethods = suppliedSpecialMethods === undefined ? undefined : Object.freeze({
      typeOf: suppliedSpecialMethods.typeOf.bind(suppliedSpecialMethods),
      slots(value: RuntimeValue) {
        const supplied = suppliedSpecialMethods.slots(value);
        if (supplied !== undefined || !hasRuntimeInstanceAttributes(value)) return supplied;
        return runtimeOwnedDescriptorSlots(value, values, meter, builtinCalls, () => calls.enter(frame));
      },
      get invocation(): BuiltinInvocationContext { return builtinCalls; }
    });
    const callability = { callable(value: RuntimeValue) {
      if (hasRuntimeInstanceAttributes(value) && specialMethods !== undefined) return builtinCalls.hasSpecial!(value, "__call__");
      return hooks.callable(value);
    } };
    const beginCall = (callee: RuntimeValue) => beginRuntimeCall(callee, {
      get invocation() { return builtinCalls; },
      get iteration() { return getIteration(); },
      values, keys, name(value) {
        while (value.kind === "method" || value.kind === "staticmethod") { meter.checkpoint(); value = value.kind === "method" ? value.value.function : value.value; }
        if (value.kind === "builtin_function_or_method") return `${value.value.owner === undefined ? "" : value.value.owner.value.name + "."}${value.value.name}()`;
        if ((value.kind === "method_descriptor" || value.kind === "classmethod_descriptor") || value.kind === "wrapper_descriptor") return `${value.value.owner.value.name}.${value.value.name}()`;
        if (value.kind === "method-wrapper") return `${value.value.descriptor.value.owner.value.name}.${value.value.descriptor.value.name}()`;
        return hooks.name(value);
      }, keywordName: hooks.keywordName.bind(hooks),
      callable: value => runtimeCallable(value, meter, callability),
      invoke(value, positional, keywords) {
        if ((value.kind === "instance" || isRuntimeMethodDecoratorSubclass(value)) && specialMethods !== undefined) {
          const leave = calls.enter(frame);
          try {
            const hook = builtinCalls.lookupSpecial!(value, "__call__"); meter.checkpoint();
            if (hook === undefined) throw new PythonRuntimeError("TypeError", `'${value.type.value.name}' object is not callable`);
            return builtinCalls.call(hook, positional, keywords);
          } finally { leave(); }
        }
        if (value.kind === "method" || value.kind === "staticmethod") {
          const receivers: RuntimeValue[] = [];
          let callable: RuntimeValue = value;
          while (callable.kind === "method" || (callable.kind === "staticmethod" && (specialMethods === undefined || !isRuntimeMethodDecoratorSubclass(callable)))) {
            meter.checkpoint();
            if (callable.kind === "method") { meter.checkpoint(0, 8); receivers.push(callable.value.instance); callable = callable.value.function; }
            else callable = callable.value;
          }
          meter.checkpoint(0, 32 + 8 * (receivers.length + positional.length));
          const args: RuntimeValue[] = [];
          for (let index = receivers.length - 1; index >= 0; index--) { meter.checkpoint(); args.push(receivers[index]); }
          for (const item of positional) { meter.checkpoint(); args.push(item); }
          return builtinCalls.call(callable, args, keywords);
        }
        if (value.kind === "builtin_function_or_method") return value.value.invoke(positional, keywords, meter, builtinCalls);
        if ((value.kind === "method_descriptor" || value.kind === "classmethod_descriptor") || value.kind === "wrapper_descriptor" || value.kind === "method-wrapper") return callRuntimeMethodDescriptor(value, positional, keywords, meter, builtinCalls);
        if (value.kind === "type" && specialMethods !== undefined) {
          const leave = calls.enter(frame);
          try { return callRuntimeType(value, positional, keywords, specialMethods, values, meter, beginCall, expressionHooks.attribute?.bind(expressionHooks)); }
          finally { leave(); }
        }
        const fn = value;
        if (fn.kind !== "function") return hooks.invoke(fn, positional, keywords, frame);
        const invocation: RuntimeFunctionContext = {
          values, keys, calls, body: child => body(child, fn.value, fn.value.code.definitions ?? functions, fn.value.code.classDefinitions ?? classFunctions, fn.value.code.literals ?? null, fn.value.code.comprehensions ?? comprehensions),
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
              body: child => body(child, fn.value, fn.value.code.definitions ?? functions, fn.value.code.classDefinitions ?? classFunctions, fn.value.code.literals ?? null, fn.value.code.comprehensions ?? comprehensions)
            }, meter);
            return result;
          }
        };
        if (hooks.suspended) invocation.suspended = hooks.suspended.bind(hooks);
        else if (context.exceptions) invocation.suspended = (kind, child, code) => {
          if (kind !== "generator") throw new UnsupportedFunctionExecutionError(kind);
          meter.checkpoint(0, 288);
          const origin = fn.value;
          // Context preparation is delayed until the first resume. Binding the
          // arguments above must not execute body hooks or guest instructions.
          function* run(): Generator<RuntimeValue, RuntimeValue, RuntimeValue> {
            const inner = body(child, origin, code.definitions ?? functions, code.classDefinitions ?? classFunctions, code.literals ?? null, code.comprehensions ?? comprehensions).suspend();
            if (code.body.kind === "expression") return yield* inner.evaluate(code.body.expression);
            if (code.body.kind !== "suite") throw Error("generator code must have an expression or suite body");
            const result = yield* createStatementContinuation(code.body.statements, inner, meter);
            return result.kind === "return" && Object.hasOwn(result, "value") ? result.value! : values.none;
          }
          const cursor = run();
          return context.exceptions!.generator(input => input.kind === "throw" ? cursor.throw(input.error) : cursor.next(input.value), child, calls);
        };
        return invokeRuntimeFunction(fn, positional, keywords, invocation, meter);
      }
    }, meter);
    meter.checkpoint(0, 128);
    const builtinCalls: BuiltinInvocationContext = {
      enterRecursiveCall: () => calls.enter(frame),
      get identity() { return context.identity ?? values.identity; },
      identityHash: keys.identityHash?.bind(keys),
      nativeHash: keys.nativeHash?.bind(keys),
      get formatting() { return getFormatting(); },
      bytes: expressionHooks.bytes,
      buffers: expressionHooks.buffers,
      hasSpecial(value, name) {
        if (specialMethods === undefined) return false;
        const type = runtimeActualType(value, specialMethods, meter); meter.checkpoint();
        return lookupMroAttribute(type.value.mro, values.string(name), (owner, key) => owner.namespace.items.lookup(key), meter) !== undefined;
      },
      warn: expressionHooks.warn.bind(expressionHooks),
      lookupSpecial(value, name) {
        if (specialMethods === undefined) return undefined;
        const type = runtimeActualType(value, specialMethods, meter); meter.checkpoint();
        return lookupRuntimeSpecialMethod(value, type, values.string(name), specialMethods, values, meter);
      },
      typeName: specialMethods === undefined ? undefined : value => {
        const type = runtimeActualType(value, specialMethods, meter); meter.checkpoint(); return type.value.name;
      },
      actualType: specialMethods === undefined ? undefined : value => runtimeActualType(value, specialMethods, meter),
      nativeListRepr(value) {
        meter.checkpoint();
        const payload = runtimeListPayload(value);
        if (payload === undefined) throw Error("list representation requires list storage");
        const stack = representationState.stack ??= new RepresentationStack<RuntimeValue>(100, meter);
        return values.stringPoints(listRepresentation(value, payload.items, getFormatting(), stack, meter));
      },
      nativeSetRepr(value) {
        meter.checkpoint();
        const stack = representationState.stack ??= new RepresentationStack<RuntimeValue>(100, meter);
        return values.stringPoints(runtimeSetRepresentation(value, values, getFormatting(), stack, meter));
      },
      get moduleName() { return namespaces.globals.get("__name__"); },
      executeClassBody(fn, namespace) {
        meter.checkpoint();
        if (fn.value.code.body.kind !== "class") {
          const result = builtinCalls.call(fn, []); meter.checkpoint();
          return result.kind === "cell" ? result.value : undefined;
        }
        const locals = namespace.kind === "dict" ? new RuntimeDictionaryNamespace(namespace, values, meter, builtinCalls)
          : new RuntimeMappingNamespace(namespace, values, meter, builtinCalls);
        return executeClassBody(fn.value.code.body.code, {
          ...fn.value, calls, locals, cell: cell => values.cell(cell),
          body: child => body(child, fn.value, fn.value.code.definitions ?? functions, fn.value.code.classDefinitions ?? classFunctions, fn.value.code.literals ?? null, fn.value.code.comprehensions ?? comprehensions)
        }, meter);
      },
      finalizeType: specialMethods === undefined ? undefined : (type, keywords) => finalizeRuntimeType(type, keywords, specialMethods, values, meter, {
        call: builtinCalls.call.bind(builtinCalls),
        isException: builtinCalls.isException, addExceptionNote: builtinCalls.addExceptionNote,
        repr(value) {
          const formatting = getFormatting(), result = representationObject(value, "repr", formatting, meter), points = formatting.string(result); meter.checkpoint();
          if (points === undefined) throw Error("representation did not produce string storage");
          let text = "";
          for (const point of points) { meter.checkpoint(1, point > 0xffff ? 4 : 2); text += String.fromCodePoint(point); }
          return text;
        }
      }),
      assignClassDefault: (object, type) => statementHooks.setAttribute(object, "__class__", type),
      typeAttributeDefault: specialMethods === undefined ? undefined : (type, name) => runtimeTypeAttribute(type, name, values, meter, specialMethods),
      mutateTypeAttributeDefault: specialMethods === undefined ? undefined : (type, name, change) => runtimeMutateTypeAttribute(type, name, change, values, meter, specialMethods),
      objectAttributeDefault: specialMethods === undefined ? undefined : (object, name) => runtimeObjectAttribute(object, name, values, meter, specialMethods, (object, name) => expressions.attribute(object, name)),
      mutateObjectAttributeDefault: specialMethods === undefined ? undefined : (object, name, change) => runtimeMutateObjectAttribute(object, name, change, values, meter, specialMethods, (object, name, change) => {
        if (change.kind === "set") statementHooks.setAttribute(object, name, change.value);
        else statementHooks.deleteAttribute(object, name);
      }),
      callTypeDefault: specialMethods === undefined ? undefined : (type, positional, keywords) => {
        const leave = calls.enter(frame);
        try { return callRuntimeType(type, positional, keywords, specialMethods, values, meter, beginCall, expressionHooks.attribute?.bind(expressionHooks), "default"); }
        finally { leave(); }
      },
      setAttribute(object, name, value) {
        if (object.kind === "function" && runtimeMutateFunctionAttribute(object, name, { kind: "set", value }, values, meter)) return;
        if (hasRuntimeInstanceAttributes(object) && specialMethods !== undefined) runtimeMutateInstanceAttribute(object, name, { kind: "set", value }, values, meter, specialMethods, builtinCalls);
        else if (object.kind === "type" && specialMethods !== undefined) runtimeMutateTypeAttribute(object, name, { kind: "set", value }, values, meter, specialMethods, builtinCalls);
        else if (specialMethods !== undefined) runtimeMutateObjectAttribute(object, name, { kind: "set", value }, values, meter, specialMethods, (object, name, change) => {
          if (change.kind === "set") statementHooks.setAttribute(object, name, change.value);
        });
        else statementHooks.setAttribute(object, name, value);
      },
      deleteAttribute(object, name) {
        if (object.kind === "function" && runtimeMutateFunctionAttribute(object, name, { kind: "delete" }, values, meter)) return;
        if (hasRuntimeInstanceAttributes(object) && specialMethods !== undefined) runtimeMutateInstanceAttribute(object, name, { kind: "delete" }, values, meter, specialMethods, builtinCalls);
        else if (object.kind === "type" && specialMethods !== undefined) runtimeMutateTypeAttribute(object, name, { kind: "delete" }, values, meter, specialMethods, builtinCalls);
        else if (specialMethods !== undefined) runtimeMutateObjectAttribute(object, name, { kind: "delete" }, values, meter, specialMethods, (object, name) => statementHooks.deleteAttribute(object, name));
        else statementHooks.deleteAttribute(object, name);
      },
      attribute: (object, name) => expressions.attribute(object, name),
      get power() { return power; },
      numeric: expressionHooks.numeric?.bind(expressionHooks) ?? (specialMethods === undefined ? undefined : (operator, left, right) => createRuntimeNumericContext(operator, left, right, values, meter, specialMethods, builtinCalls)),
      isCallable: value => runtimeCallable(value, meter, callability),
      binary: (operator, left, right) => expressions.binary(operator, left, right),
      get integerIndex() { return getIntegerIndex(); },
      get iteration() { return getIteration(); },
      truth: value => expressions.truth(value),
      compare: (operator, left, right) => expressions.compare(operator, left, right),
      compareSlot: (operator, left, right) => runtimeReceiverComparison(operator, left, right, values, meter, richComparison?.(operator, left, right), builtinCalls),
      compareTruth(operator, left, right) {
        const result = expressions.compare(operator, left, right); meter.checkpoint();
        return expressions.truth(result);
      },
      call(callee, positional, keywords) {
        const call = beginCall(callee);
        for (const value of positional) { meter.checkpoint(); call.positional(value); }
        if (keywords !== undefined) { meter.checkpoint(); call.mapping(keywords); }
        return call.invoke();
      },
      isException: context.exceptions?.matches.bind(context.exceptions),
      exceptionArguments: context.exceptions?.arguments.bind(context.exceptions),
      addExceptionNote: context.exceptions===undefined?undefined:(error,build)=>context.exceptions!.addNote(error,build,builtinCalls),
      isStopIteration(error) {
        if (error instanceof ExecutionLimitError) return false;
        if (error instanceof PythonRuntimeError && error.name === "StopIteration") return true;
        if (context.exceptions?.matches(error,"StopIteration")) return true;
        const result = expressionHooks.iteration?.isStopIteration(error) ?? false;
        meter.checkpoint(); return result;
      }
    };
    const richComparison = expressionHooks.richComparison?.bind(expressionHooks) ?? (specialMethods === undefined ? undefined : (operator: string, left: RuntimeValue, right: RuntimeValue) => createRuntimeRichComparisonContext(operator, left, right, values, meter, specialMethods, builtinCalls));
    const power = expressionHooks.power ?? (specialMethods === undefined ? undefined : createRuntimePowerContext(values, meter, specialMethods, builtinCalls));
    let iteration = expressionHooks.iteration;
    const getIteration = () => {
      meter.checkpoint();
      iteration ??= specialMethods === undefined ? undefined : createRuntimeIterationContext(values, meter, specialMethods, builtinCalls);
      return iteration;
    };
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
      beginMethodCall: expressionHooks.attribute === undefined ? (receiver, name) => {
        const callee = expressions.attribute(receiver, name);
        const descriptor = runtimeDirectMethod(receiver, name, callee, values, meter, builtinCalls);
        const call = beginCall(descriptor ?? callee);
        if (descriptor !== undefined) call.positional(receiver);
        return call;
      } : undefined,
      mapping: expressionHooks.mapping ?? builtinCalls,
      isException: builtinCalls.isException,
      subscription: expressionHooks.subscription ?? (specialMethods === undefined ? undefined : builtinCalls),
      percent: expressionHooks.percent ?? builtinCalls,
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
      instanceAttribute: specialMethods === undefined ? undefined : (instance, name) => runtimeInstanceAttribute(instance, name, values, meter, specialMethods, builtinCalls),
      typeAttribute: specialMethods === undefined ? undefined : (type, name) => runtimeTypeAttribute(type, name, values, meter, specialMethods, builtinCalls),
      actualType: builtinCalls.actualType,
      get formattedString() { return expressionHooks.formattedString; },
      addition: expressionHooks.addition?.bind(expressionHooks) ?? (specialMethods === undefined ? undefined : (left, right) => createRuntimeNumericContext("+", left, right, values, meter, specialMethods, builtinCalls)),
      multiplication: expressionHooks.multiplication?.bind(expressionHooks) ?? (specialMethods === undefined ? undefined : (left, right) => createRuntimeNumericContext("*", left, right, values, meter, specialMethods, builtinCalls)),
      numeric: builtinCalls.numeric,
      power,
      unary: expressionHooks.unary ?? (specialMethods === undefined ? undefined : builtinCalls),
      truth: expressionHooks.truth?.bind(expressionHooks) ?? (specialMethods === undefined ? undefined : value => runtimeTruth(value, meter, builtinCalls)),
      richComparison,
      containment: expressionHooks.containment?.bind(expressionHooks) ?? (specialMethods === undefined ? undefined : createRuntimeContainmentPolicy(values, meter, builtinCalls)),
      get iteration() { return getIteration(); },
      get formatting() { return getFormatting(); },
      warn: expressionHooks.warn.bind(expressionHooks), beginCall, dictionaryKeys: keys,
      createLambda: definitions.create.bind(definitions),
      comprehension(node) {
        meter.checkpoint();
        if(node.kind==="comprehension"&&node.collection==="generator"&&context.exceptions===undefined)throw new UnsupportedExpressionError(node.kind);
        for(const clause of node.clauses){meter.checkpoint();if(clause.async)throw new UnsupportedExpressionError(node.kind);}
        const scope=comprehensions?.get(node);
        if(scope===undefined)throw Error("comprehension has no matching compiled scope");
        let leave=calls.enter(frame);
        try {
          const outer=expressions.iterate(evaluateExpression(node.clauses[0].iterable,expressions,meter));
          meter.checkpoint(0,192);
          const closure=frame instanceof LexicalFrame||frame instanceof ClassFrame?frame.capture(scope):undefined;
          const child=new LexicalFrame(scope,{...namespaces,closure},meter);
          leave();leave=calls.enter(child);
          const inner=body(child,namespaces,functions,classFunctions,literals,comprehensions);
          if(node.kind==="comprehension"&&node.collection==="generator") {
            const cursor=new ComprehensionCursor(node.clauses,outer,inner,()=>inner.evaluate(node.element),meter);
            return context.exceptions!.generator(input=>{
              if(input.kind==="throw")throw input.error;
              const step=cursor.next();
              return step.done?{done:true,value:values.none}:step;
            },child,calls);
          }
          if(node.kind==="dictionary-comprehension") {
            const result=expressions.beginDictionary([]);
            executeComprehensionClauses(node.clauses,outer,inner,()=>{const key=inner.evaluate(node.key),value=inner.evaluate(node.value);result.set(key,value);},meter);
            return result.finish();
          }
          if(node.collection==="set") {
            const result=expressions.beginSet([]);
            executeComprehensionClauses(node.clauses,outer,inner,()=>result.add(inner.evaluate(node.element)),meter);
            return result.finish();
          }
          const result=values.list([]);
          executeComprehensionClauses(node.clauses,outer,inner,()=>result.items.append(inner.evaluate(node.element)),meter);
          return result;
        } finally {
          leave();
        }
      }
    }, meter);
    keys.bindInvocation?.(frame, builtinCalls); meter.checkpoint();
    let inplace = statementHooks.inplace?.bind(statementHooks);
    if (inplace === undefined && specialMethods !== undefined) {
      meter.checkpoint(0, 64);
      inplace = (operator, left, right) => runtimeInPlaceSpecialMethod(operator, left, right, values, meter, builtinCalls);
    }
    return createRuntimeStatementContext(expressions, {
      invocation: builtinCalls,
      subscription: statementHooks.subscription ?? (specialMethods === undefined ? undefined : builtinCalls),
      get integerIndex() { return getIntegerIndex(); },
      deleteName: frame.delete.bind(frame),
      inplace,
      setAttribute: builtinCalls.setAttribute!.bind(builtinCalls), deleteAttribute: builtinCalls.deleteAttribute!.bind(builtinCalls),
      assertions: statementHooks.assertions ?? context.exceptions?.assertions(), managers: statementHooks.managers,
      exceptions: statementHooks.exceptions ?? context.exceptions?.statements(frame),
      executeUnhandled(statement) {
        if (statement.kind === "function") executeFunctionDefinition(statement, definitions, meter);
        else if (statement.kind === "class") executeClassDefinition(statement, classDefinitions, meter);
        else if (statement.kind === "raise" && context.exceptions) context.exceptions.raise(statement,expression=>evaluateExpression(expression,expressions,meter),builtinCalls);
        else statementHooks.executeUnhandled(statement);
      },
      *executeUnhandledContinuation(statement) {
        meter.checkpoint(0, 192);
        const evaluate = (expression: Expression) => createExpressionContinuation(expression, expressions, meter, values.none);
        if (statement.kind === "function") yield* createFunctionDefinitionContinuation(statement, { ...definitions, evaluate }, meter);
        else if (statement.kind === "class") yield* createClassDefinitionContinuation(statement, { ...classDefinitions, evaluate }, meter);
        else if (statement.kind === "raise" && context.exceptions) yield* context.exceptions.raiseContinuation(statement, evaluate, builtinCalls);
        else if (statementHooks.executeUnhandledContinuation) yield* statementHooks.executeUnhandledContinuation(statement);
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

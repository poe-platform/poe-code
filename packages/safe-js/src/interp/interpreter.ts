import { promiseReplayContext } from "./promise-replay.js";
import { createSandboxBox } from "./boxed.js";
import { legacyBlockFunctions, prepareLegacyEvalFunctions } from "./legacy-block-functions.js";
import { compileDynamicFunction } from "./dynamic-function.js";
import { getIntrinsicIdentity, resolveIntrinsicIdentity } from "./intrinsics.js";
import { createEvalSource } from "../parse/dynamic-source.js";
import { evalFunctionDeclarations } from "../parse/function-source.js";
import { hoistedVarDeclarations } from "../parse/bindings.js";
import { StatementCompletion } from "./statement-completion.js";
import { findPrivateElement, type PrivateName } from "./private-state.js";
import { invokeBuiltinClosure } from "./builtin-call.js";
import { isSandboxModuleNamespace } from "./module-namespace.js";
import { bigIntOperation, type BigIntOperator } from "./bigint-operators.js";
import { accessorAdapter, readPropertyDescriptor, writePropertyDescriptor } from "./accessors.js";
import { deleteHostObjectMember, getHostObjectKeys, getHostObjectMember, hasHostObjectMember, isGuestHostObject, setHostObjectMember } from "./host-capabilities.js";
import { propertyFunctionName, toPropertyKey } from "./property-key.js";
import { assertPromiseExecutionAllowed } from "./promise-tracker.js";
import { SandboxJobQueue, runAsyncPrefix, suspendJob } from "./jobs.js";
import { awaitSandboxValue, withCancellationSignal } from "./cancel.js";
import { evaluateResourceScope, registerScopeResource, resourceSuspension } from "./resource-management.js";
import { asyncGeneratorDrivers } from "./async-generator-driver.js";
import { getGeneratorOrigin } from "./closure-origin.js";
import { retainValues } from "./resources.js";
import { templateObject, templateRawArrays } from "./template-objects.js";
import { evaluateClass } from "./classes.js";
import { defineDataProperty, reflectionProperties } from "./globals/object-array.js";
import { objectToPrimitive, sandboxString } from "./string-coercion.js";
import type {
  ArrayExpression,
  ArrayPattern,
  AssignmentPattern,
  AssignmentExpression,
  ArrowFunctionExpression,
  AwaitExpression,
  BinaryExpression,
  BlockStatement,
  BooleanLiteral,
  CallExpression,
  ConditionalExpression,
  ContinueStatement,
  DoWhileStatement,
  EmptyStatement,
  Expression,
  Identifier,
  ExportDefaultDeclaration,
  ExportNamedDeclaration,
  ForInStatement,
  ForOfStatement,
  ForStatement,
  FunctionDeclaration,
  FunctionExpression,
  IfStatement,
  LogicalExpression,
  MemberExpression,
  MetaProperty,
  NewExpression,
  NullLiteral,
  NumericLiteral,
  ObjectExpression,
  ObjectPattern,
  ParseResult,
  Property,
  RegexLiteral,
  BreakStatement,
  ReturnStatement,
  SequenceExpression,
  SourceSpan,
  SpreadElement,
  StringLiteral,
  SwitchStatement,
  TaggedTemplateExpression,
  TemplateLiteral,
  ThrowStatement,
  ThisExpression,
  TryStatement,
  UnaryExpression,
  UndefinedLiteral,
  UpdateExpression,
  ExpressionStatement,
  VariableDeclaration,
  RestElement,
  WhileStatement
} from "../parse.js";
import type { YieldExpression } from "../parse/parser.js";
import {
  attachErrorSpan,
  formatErrorStack,
  replaceErrorStack
} from "../error/shape.js";
import {
  evaluateArrowFunctionExpression,
  evaluateFunctionExpression,
  evaluateAwaitExpression,
  emitResumeBreakpoint,
  suspendAsyncFunctionValue,
  createInterpretedClosure,
  normalizeClosureResult,
  type AsyncEvaluationContext,
  type AsyncEvaluationResult,
  type InterpreterYieldPoint
} from "./async.js";
import type { GeneratorCompletion } from "./generator.js";
import { HostCallResumabilityError } from "./host-call.js";
import { Budget, isFatalSandboxError, SandboxError, type CompileOwner } from "./budget.js";
import { CompileScope, RegexCompileGuard } from "./regex/compile-guard.js";
import { containsResumeTarget } from "./resume-target.js";
import {
  createCapturedException,
  coerceThrownValue,
  createThrowCompletion,
  evaluateThrowStatement as evaluateThrowStatementResult,
  evaluateTryStatement as evaluateTryStatementResult,
  isCapturedException,
  isInterpreterError,
  referenceErrorDiagnostics,
  surfaceThrownValue
} from "./exceptions.js";
import {
  callArrayMethod,
  getArrayMember,
  isArrayMethodName,
  type ArrayMethodName,
  type ArrayMethodOptions
} from "./methods/array.js";
import { getFunctionMember, type FunctionMethodOptions } from "./methods/function.js";
import { getBoxedPrototype, getSandboxPropertyDescriptor, getSandboxPrototype, hasExplicitSandboxPrototype, isDefaultArrayMethod, isDefaultBoxedMethod, isGuestClosure, materializeFunctionProperties, setSandboxPrototype } from "./object-model.js";
import { guestProxyStates } from "./guest-proxy.js";
import { sandboxDeleteProperty } from "./guest-proxy-delete.js";
import { sandboxHasProperty } from "./guest-proxy-has.js";
import { sandboxGetProperty } from "./guest-proxy-get.js";
import { sandboxSetProperty } from "./guest-proxy-set.js";
import { sandboxOwnKeys } from "./guest-proxy-own-keys.js";
import { sandboxGetOwnPropertyDescriptor } from "./guest-proxy-descriptor.js";
import { sandboxGetPrototypeOf } from "./guest-proxy-prototype.js";
import { getStringIndex } from "./methods/string.js";
import { assertSandboxDataDepth } from "../graph-depth.js";
import {
  callMapMethod,
  getMapMember,
  isMapMethodName,
  type MapMethodName,
  type MapMethodOptions
} from "./methods/map.js";
import { callNumberMethod, getNumberMember, isNumberMethodName } from "./methods/number.js";
import { createPendingPromiseCapability, getPromiseMember } from "./promise.js";
import { resolveModuleNamespace } from "../modules/registry.js";
import { acquireSandboxIterator, closeIterator, readIteratorResult, restoreSandboxIterator } from "./iteration.js";
import type { GeneratorExpressionState } from "./generator-expression-state.js";
import { assertCollectionMutable } from "./running-state.js";
import { getGeneratorMember } from "./methods/generator.js";
import { getGeneratorProperties } from "./generator-properties.js";
import { getRegexMember, setRegexMember } from "./methods/regex.js";
import { bindPattern, type BindPatternResult, type PatternContext } from "./patterns.js";
import {
  callStringMethod,
  getStringMember,
  isStringMethodName,
  validateStringMethodArguments
} from "./methods/string.js";
import {
  callSetMethod,
  getSetMember,
  isSetMethodName,
  type SetMethodName,
  type SetMethodOptions
} from "./methods/set.js";
import { evaluateInstanceof } from "./instanceof.js";
import { hasOwnSandboxProperty } from "./globals/object.js";
import { collectionIteratorState, isSandboxCollectionIterator } from "./collection-iterator.js";
import { getCollectionIteratorMember } from "./methods/collection-iterator.js";
import { isSandboxRegExpIterator, regexpIteratorState } from "./regexp-iterator.js";
import { getRegExpIteratorMember } from "./methods/regexp-iterator.js";
import {
  getTypedArrayMember,
  setTypedArrayMember
} from "./globals/numeric-typed-array.js";
import { isNumericTypedArray } from "./typed-array.js";
import { dateString, dateTime, isSandboxDate } from "./date.js";
import {
  createSandboxRegex,
  createSandboxPromise,
  allocateProducedSandboxValue,
  ownEnumerableSandboxKeys,
  ownSandboxSymbolKeys,
  isSandboxClosure,
  isSandboxGenerator,
  isSandboxMap,
  isSandboxPromise,
  getPromiseProperties,
  isSandboxRegex,
  getRegexProperties,
  getCollectionProperties,
  isSandboxSet,
  reconcileCompiledValues,
  type SandboxArray,
  type SandboxClosure,
  type SandboxCallContext,
  type SandboxMap,
  type SandboxObject,
  type SandboxPrimitive,
  type SandboxSet,
  type SandboxValue
} from "./values.js";
import { Scope, type BindingReference } from "./scope.js";
import { hoistVarDeclarations } from "./var-hoist.js";

export type InterpreterValue = SandboxValue;

export type InterpreterStats = {
  nodeVisits: number;
  currentDataSize: number;
  peakDataSize: number;
};

export type InterpreterSnapshot = {
  bindings: Record<string, InterpreterValue>;
  loopIterations?: Record<string, LoopIterationSnapshot>;
  resumeNodeId?: number;
};

export type LoopIterationSnapshot =
  | number
  | {
      index: number;
      values: InterpreterValue[];
    };

export type InterpreterErrorCode = "LABEL_NOT_FOUND" | "UNBOUND_IDENTIFIER" | "UNSUPPORTED_NODE";

export type InterpreterError = {
  code: InterpreterErrorCode;
  message: string;
  name: string;
  nodeId?: number;
  nodeType: ParseResult["type"];
  span: SourceSpan;
  stack: string;
};

export type InterpreterResult =
  | {
      ok: true;
      returnValue?: InterpreterValue;
      snapshot: InterpreterSnapshot;
      stats: InterpreterStats;
    }
  | {
      ok: false;
      error: InterpreterError;
      snapshot: InterpreterSnapshot;
      stats: InterpreterStats;
    };

export type InterpretOptions = {
  assertActive?: () => void;
  onSuspend?: () => void;
  jobs?: SandboxJobQueue;
  nested?: boolean;
  compilation?: CompileScope;
  compileOwner?: CompileOwner;
  captureReplayState?: () => unknown;
  bindings?: Record<string, InterpreterValue>;
  budget?: Budget;
  onYield?: (yieldPoint: InterpreterYieldPoint) => void;
  scope?: Scope;
  signal?: AbortSignal;
  surfaceUnhandledThrows?: boolean;
  useScopeDirectly?: boolean;
  generatorYield?: (value?: SandboxValue, yieldNodeId?: number) => Promise<GeneratorCompletion>;
  asyncGenerator?: boolean;
  generatorResume?: {
    sent: GeneratorCompletion[];
    yieldNodeId: number;
  };
  snapshot?: InterpreterSnapshot;
};

type EvaluationContext = AsyncEvaluationContext;

type EvaluationResult = AsyncEvaluationResult;
type MemberReference = { kind: "nullish" } | {
  kind: "resolved"; object: InterpreterValue; property: SandboxValue; privateName?: PrivateName; superReceiver?: { value: SandboxValue };
};

type HelperResult<TValue> =
  | {
      ok: true;
      value: TValue;
    }
  | {
      ok: false;
      result: EvaluationResult;
    };

type NodeHandler<TNode extends ParseResult> = (
  node: TNode,
  context: EvaluationContext
) => Promise<EvaluationResult>;

type DispatchTable = Partial<{
  [K in ParseResult["type"]]: NodeHandler<Extract<ParseResult, { type: K }>>;
}>;

const dispatchTable: DispatchTable = {
  ArrayExpression: evaluateArrayExpression,
  AssignmentExpression: evaluateAssignmentExpression,
  ArrowFunctionExpression: evaluateArrowFunction,
  AwaitExpression: evaluateAwait,
  BinaryExpression: evaluateBinaryExpression,
  BigIntLiteral: async (node, context) => {
    const allocation = {};
    context.budget.visitNode(node.value.length);
    context.budget.setRetainedDataUsage(allocation, node.value.length);
    try {
      return { kind: "normal", hasValue: true, value: BigInt(node.value) };
    } finally {
      context.budget.setRetainedDataUsage(allocation, 0);
    }
  },
  BlockStatement: evaluateBlockStatement,
  BooleanLiteral: evaluatePrimitiveLiteral,
  CallExpression: evaluateCallExpression,
  ClassDeclaration: (node, context) => evaluateClass(node, context, evaluateNode, createCoercionContext(context)),
  ClassExpression: (node, context) => evaluateClass(node, context, evaluateNode, createCoercionContext(context)),
  NewTargetExpression: async (_node, context) => ({ kind: "normal", hasValue: true, value: context.functionEnvironment?.newTarget }),
  Super: async (_node, context) => {
    const home = context.functionEnvironment?.homeObject;
    if (home === undefined) throw new ReferenceError("Super binding is unavailable.");
    return { kind: "normal", hasValue: true, value: getSandboxPrototype(home, context.budget) as SandboxValue };
  },
  ConditionalExpression: evaluateConditionalExpression,
  ContinueStatement: evaluateContinueStatement,
  DoWhileStatement: evaluateDoWhileStatement,
  EmptyStatement: evaluateEmptyStatement,
  ExportDefaultDeclaration: evaluateExportDefaultDeclaration,
  ExportNamedDeclaration: evaluateExportNamedDeclaration,
  ExpressionStatement: evaluateExpressionStatement,
  ForInStatement: evaluateForInStatement,
  ForOfStatement: evaluateForOfStatement,
  ForStatement: evaluateForStatement,
  FunctionDeclaration: evaluateFunctionDeclaration,
  FunctionExpression: evaluateFunction,
  IfStatement: evaluateIfStatement,
  Identifier: evaluateIdentifier,
  WithStatement: evaluateWithStatement,
  LogicalExpression: evaluateLogicalExpression,
  MemberExpression: evaluateMemberExpression,
  MetaProperty: evaluateMetaProperty,
  ImportExpression: async (node, context) => {
    const restored = context.generatorResume === undefined || node.nodeId === undefined
      ? undefined : context.restoredGeneratorExpressionStates?.get(node.nodeId);
    if (restored !== undefined && restored.kind !== "dynamic-import") throw new TypeError("Invalid dynamic import continuation.");
    const source = restored === undefined ? await evaluateNode(node.source, context)
      : {kind:"normal" as const,hasValue:true,value:restored.source};
    if (source.kind !== "normal") return source;
    if (context.generatorYield !== undefined && node.nodeId !== undefined) context = {
      ...context,generatorExpressionStates:new Map([...(context.generatorExpressionStates ?? []),
        [node.nodeId,{kind:"dynamic-import",source:source.value}]])
    };
    const retained: SandboxValue[] = [source.value];
    const release = retainValues(context.budget,()=>retained);
    try {
    const options = node.options === undefined ? {kind:"normal" as const,value:undefined}
      : await evaluateNode(node.options, context);
    if (options.kind !== "normal") return options;
    retained.push(options.value);
    const callContext = createCoercionContext(context);
    const capability = createPendingPromiseCapability(context.budget,callContext);
    retained.push(capability.promise);
    try {
      const specifier = await sandboxString(source.value,context.budget,callContext);
      if (options.value !== undefined) {
        if (typeof options.value !== "object" || options.value === null) throw new TypeError("Import options must be an object.");
        const attributes = await getPropertyValue(options.value,"with",context);
        if (attributes !== undefined) {
          if (typeof attributes !== "object" || attributes === null) throw new TypeError("Import attributes must be an object.");
          const keys = ownEnumerableSandboxKeys(attributes);
          const values = [];
          for (const key of keys) values.push(await getPropertyValue(attributes,key,context));
          if (values.some(value=>typeof value !== "string")) throw new TypeError("Import attribute values must be strings.");
          if (keys.length !== 0) throw new TypeError("Registered modules do not support import attributes.");
        }
      }
      const environment = context.scope.lookupModuleEnvironment();
      if (environment === undefined) throw new Error(`Unknown module '${specifier}'. No modules are registered.`);
      await invokeBuiltinClosure(capability.resolve,[resolveModuleNamespace(environment,specifier)],context.budget,callContext,undefined);
    } catch (error) {
      const captured = isCapturedException(error) ? error : undefined;
      const reason = captured === undefined ? error : captured.reason;
      if (isFatalSandboxError(reason) || reason instanceof HostCallResumabilityError) throw error;
      const value = coerceThrownValue(reason,context.budget,captured?.stackFrames ?? context.callStack,node.span,captured?.sandbox ?? true);
      await invokeBuiltinClosure(capability.reject,[value],context.budget,callContext,undefined);
    }
    return {kind:"normal",hasValue:true,value:capability.promise};
    } finally { release(); }
  },
  NewExpression: evaluateNewExpression,
  NullLiteral: evaluatePrimitiveLiteral,
  NumericLiteral: evaluatePrimitiveLiteral,
  RegexLiteral: evaluateRegexLiteral,
  ObjectExpression: evaluateObjectExpression,
  BreakStatement: evaluateBreakStatement,
  ReturnStatement: evaluateReturnStatement,
  SequenceExpression: evaluateSequenceExpression,
  StringLiteral: evaluatePrimitiveLiteral,
  SwitchStatement: evaluateSwitchStatement,
  TaggedTemplateExpression: evaluateTaggedTemplateExpression,
  TemplateLiteral: evaluateTemplateLiteral,
  ThrowStatement: evaluateThrowStatement,
  ThisExpression: evaluateThisExpression,
  TryStatement: evaluateTryStatement,
  UnaryExpression: evaluateUnaryExpression,
  UpdateExpression: evaluateUpdateExpression,
  VariableDeclaration: evaluateVariableDeclaration,
  WhileStatement: evaluateWhileStatement,
  YieldExpression: evaluateYieldExpression,
  UndefinedLiteral: evaluatePrimitiveLiteral
};

export async function interpret(
  node: ParseResult,
  options: InterpretOptions = {}
): Promise<InterpreterResult> {
  const budget = options.budget ?? new Budget();
  const operation = budget.acquireCompileOwner(
    false,
    options.compileOwner ?? options.compilation?.owner
  );
  const compilation = new CompileScope(operation.owner, options.compilation);
  try {
    const scope =
      options.scope === undefined
        ? new Scope(
            options.bindings,
            undefined,
            undefined,
            {
              chargeData: false
            },
            options.snapshot?.bindings
          ).child({}, { functionBoundary: true })
        : options.useScopeDirectly === true && options.bindings === undefined
          ? options.scope
          : options.scope.child(options.bindings ?? {}, {
              functionBoundary: true
            });
    const stats = { nodeVisits: 0 } as InterpreterStats;
    Object.defineProperties(stats, {
      currentDataSize: { enumerable: false, value: 0, writable: true },
      peakDataSize: { enumerable: false, value: 0, writable: true }
    });
    const activeLoopIterations = new Map<number, LoopIterationSnapshot>();
    const jobs = options.jobs ?? new SandboxJobQueue();
    hoistVarDeclarations(node, scope);
    const context = {
      assertActive: options.assertActive,
      compilation,
      budget,
      callStack: [],
      onYield: options.onYield,
      onSuspend: options.onSuspend,
      captureReplayState: options.captureReplayState,
      rootNode: node,
      scope,
      signal: options.signal,
      stats,
      activeLoopIterations,
      restoredLoopIterations: new Map(
        Object.entries(options.snapshot?.loopIterations ?? {}).map(([nodeId, iteration]) => [
          Number(nodeId),
          iteration
        ])
      ),
      generatorResume: options.generatorResume,
      generatorYield: options.generatorYield,
      asyncGenerator: options.asyncGenerator,
      resumeTarget: { nodeId: options.snapshot?.resumeNodeId }
    };
    const execute = () => node.type === "VariableDeclaration" && node.disposal !== undefined
      ? evaluateResourceScope(scope, budget, {...createCoercionContext(context), onSuspend: context.onSuspend, signal: context.signal}, () => evaluateNode(node, context))
      : evaluateNode(node, context);
    const evaluation = await withCancellationSignal(options.signal, () =>
      options.nested ? runAsyncPrefix(execute) : jobs.run(execute)
    );
    if (!options.nested) await jobs.drain();
    const snapshot = scope.snapshot();
    reconcileDataBudget(
      budget,
      stats,
      scope,
      "hasValue" in evaluation && evaluation.hasValue ? evaluation.value : undefined,
      compilation,
      options.compilation
    );

    if (evaluation.kind === "error") {
      return {
        ok: false,
        error: evaluation.error,
        snapshot,
        stats
      };
    }

    if (evaluation.kind === "throw") {
      if (options.surfaceUnhandledThrows === true) {
        throw surfaceThrownValue(evaluation.value, budget, evaluation.stackFrames, evaluation.span);
      }

      throw evaluation.value;
    }

    if (
      (evaluation.kind === "break" || evaluation.kind === "continue") &&
      evaluation.label !== undefined
    ) {
      return {
        ok: false,
        error: createError(
          "LABEL_NOT_FOUND",
          evaluation.node ?? node,
          `Label '${evaluation.label}' not found`
        ),
        snapshot,
        stats
      };
    }

    if (evaluation.hasValue) {
      return {
        ok: true,
        returnValue: evaluation.value,
        snapshot,
        stats
      };
    }

    return {
      ok: true,
      snapshot,
      stats
    };
  } finally {
    compilation.dispose();
    operation.release();
  }
}

export { Scope } from "./scope.js";

export async function evaluateNode(
  node: ParseResult,
  context: EvaluationContext,
  onReference?: (reference: BindingReference) => void
): Promise<EvaluationResult> {
  context.assertActive?.();
  if (context.generatorResume?.completed === true) context.generatorResume = undefined;
  if (context.inferredName !== undefined && node.type !== "ClassExpression" &&
      node.type !== "FunctionExpression" && node.type !== "ArrowFunctionExpression") context = { ...context, inferredName: undefined };
  const replayWait = promiseReplayContext.getStore()?.beforeNode(node.nodeId);
  if (replayWait !== undefined) await suspendJob(replayWait);
  assertPromiseExecutionAllowed();
  context.budget.visitNode();
  context.stats.nodeVisits += 1;

  if (node.nodeId !== undefined && context.resumeTarget?.nodeId === node.nodeId) {
    context.resumeTarget.nodeId = undefined;
  }

  const handler = dispatchTable[node.type];
  if (handler === undefined) {
    return {
      kind: "error",
      error: createError("UNSUPPORTED_NODE", node, `Unsupported AST node type '${node.type}'.`)
    };
  }

  const compilation = new CompileScope(context.compilation?.owner, context.compilation);
  const evaluationContext = {
    ...context,
    compilation,
    get generatorResume() {
      return context.generatorResume;
    },
    set generatorResume(value) {
      context.generatorResume = value;
    }
  };
  try {
    const result = node.type === "Identifier" && onReference !== undefined
      ? await evaluateIdentifier(node, evaluationContext, onReference)
      : await handler(node as never, evaluationContext);
    reconcileDataBudget(
      context.budget,
      context.stats,
      context.scope,
      "hasValue" in result && result.hasValue ? result.value : undefined,
      compilation,
      context.compilation
    );
    if (result.kind === "break" && result.label !== undefined && "labels" in node && node.labels?.includes(result.label))
      return { kind: "normal", hasValue: context.evalCompletion === true && result.hasValue, value: context.evalCompletion ? result.value : undefined };
    return result;
  } catch (error) {
    if (error instanceof HostCallResumabilityError) {
      throw error;
    }

    if (isFatalSandboxError(error)) {
      attachFatalSandboxErrorContext(error, node, context.callStack);
      throw error;
    }

    if (isInterpreterError(error)) {
      return {
        kind: "error",
        error
      };
    }

    const completion = createThrowCompletion(error, context.budget, context.callStack, node.span);

    reconcileDataBudget(
      context.budget,
      context.stats,
      context.scope,
      completion.value,
      compilation,
      context.compilation
    );

    return completion;
  } finally {
    compilation.dispose();
  }
}

function reconcileDataBudget(
  budget: Budget,
  stats: InterpreterStats,
  scope: Scope,
  transient: SandboxValue | undefined,
  compilation?: CompileScope,
  parent?: CompileScope
): void {
  reconcileCompiledValues(
    budget,
    [...scope.retainedDataRoots(), transient],
    compilation,
    parent,
    [transient]
  );
  stats.currentDataSize = budget.currentDataSize;
  stats.peakDataSize = budget.peakDataSize;
}

async function evaluatePrimitiveLiteral(
  node: BooleanLiteral | NullLiteral | NumericLiteral | StringLiteral | UndefinedLiteral,
  context: EvaluationContext
): Promise<EvaluationResult> {
  const value =
    typeof node.value === "string" ? context.budget.allocateString(node.value) : node.value;

  return {
    kind: "normal",
    hasValue: true,
    value
  };
}

async function evaluateRegexLiteral(
  node: RegexLiteral,
  context: EvaluationContext
): Promise<EvaluationResult> {
  const lastSlash = node.raw.lastIndexOf("/");
  const guard = new RegexCompileGuard(context.compilation);
  try {
    guard.checkLength(Math.max(0, lastSlash - 1));
    guard.checkLength(node.raw.length - lastSlash - 1, true);
    guard.allocate(Math.max(0, node.raw.length - 2));
    guard.work(Math.max(0, node.raw.length - 2));
    return {
      kind: "normal",
      hasValue: true,
      value: createSandboxRegex(
        node.raw.slice(1, lastSlash),
        node.raw.slice(lastSlash + 1),
        0,
        context.compilation
      )
    };
  } finally {
    guard.close();
  }
}

async function evaluateEmptyStatement(
  _node: EmptyStatement,
  _context: EvaluationContext
): Promise<EvaluationResult> {
  return {
    kind: "normal",
    hasValue: false,
    value: undefined
  };
}

async function evaluateArrayExpression(
  node: ArrayExpression,
  context: EvaluationContext
): Promise<EvaluationResult> {
  const restored = context.generatorResume === undefined || node.nodeId === undefined
    ? undefined : context.restoredGeneratorExpressionStates?.get(node.nodeId);
  if (restored !== undefined && (restored.kind !== "array" || !Array.isArray(restored.values)))
    throw new TypeError("Invalid array expression continuation.");
  const values: SandboxArray = restored?.kind === "array" ? restored.values as SandboxArray : [];
  const expressionState = { kind: "array" as const, values, index: restored?.kind === "array" ? restored.index : 0 };
  if (context.generatorYield !== undefined && node.nodeId !== undefined) context = {
    ...context, generatorExpressionStates: new Map([...(context.generatorExpressionStates ?? []), [node.nodeId, expressionState]])
  };
  const release = retainValues(context.budget, () => [values]);
  try {
    for (let index = expressionState.index; index < node.elements.length; index++) {
      expressionState.index = index;
      const element = node.elements[index];
      if (element.type === "UndefinedLiteral" && element.elision === true) {
        values.length += 1;
        context.budget.allocateArrayLength(values.length);
        continue;
      }

      if (element.type === "SpreadElement") {
        const spreadValues = await evaluateSpreadElement(element, context);
        if (!spreadValues.ok) {
          return spreadValues.result;
        }

        appendArrayValues(values, spreadValues.value);
        context.budget.allocateArrayLength(values.length);
        continue;
      }

      const result = await evaluateNode(element, context);
      if (result.kind !== "normal") {
        return result;
      }

      values.push(result.value);
      context.budget.allocateArrayLength(values.length);
    }

    return {
      kind: "normal",
      hasValue: true,
      value: values
    };
  } finally {
    release();
  }
}

async function evaluateObjectExpression(
  node: ObjectExpression,
  context: EvaluationContext
): Promise<EvaluationResult> {
  const restored = context.generatorResume === undefined || node.nodeId === undefined
    ? undefined : context.restoredGeneratorExpressionStates?.get(node.nodeId);
  if (restored !== undefined && (restored.kind !== "object" || restored.value === null ||
      typeof restored.value !== "object" || Array.isArray(restored.value)))
    throw new TypeError("Invalid object expression continuation.");
  const object = restored?.kind === "object" ? restored.value as SandboxObject : Object.create(null) as SandboxObject;
  const state: { kind: "object"; value: SandboxObject; index: number; key?: PropertyKey } = {
    kind: "object", value: object, index: restored?.kind === "object" ? restored.index : 0
  };
  if (restored?.kind === "object" && Object.hasOwn(restored, "key")) {
    if (typeof restored.key !== "string" && typeof restored.key !== "number" && typeof restored.key !== "symbol")
      throw new TypeError("Invalid object expression key.");
    state.key = restored.key;
  }
  if (context.generatorYield !== undefined && node.nodeId !== undefined) context = {
    ...context, generatorExpressionStates: new Map([...(context.generatorExpressionStates ?? []), [node.nodeId, state]])
  };
  const release = retainValues(context.budget, () => [object]);
  try {
    const startIndex = state.index;
    for (let index = startIndex; index < node.properties.length; index++) {
      state.index = index;
      if (index !== startIndex) delete state.key;
      const property = node.properties[index];
      if (property.type === "SpreadElement") {
        const spreadEntries = await evaluateObjectSpread(property, context);
        if (!spreadEntries.ok) {
          return spreadEntries.result;
        }

        for (const [key, value] of spreadEntries.value) {
          defineSandboxProperty(object, key, value);
        }
        continue;
      }

      const key = Object.hasOwn(state, "key") ? { ok: true as const, value: state.key! }
        : await evaluateObjectPropertyKey(property, context);
      if (!key.ok) {
        return key.result;
      }
      state.key = key.value;

      const releaseKey = retainValues(context.budget, () => [key.value]);
      let value: EvaluationResult;
      try {
        value = await evaluateNode(property.value, {
          ...context,
          inferredName: propertyFunctionName(key.value),
          ...(property.value.type === "FunctionExpression" && property.value.method === true
            ? { functionEnvironment: { homeObject: object } }
            : {})
        });
      } finally {
        releaseKey();
      }
      if (value.kind !== "normal") {
        return value;
      }

      if (property.kind !== undefined) {
        if (!isSandboxClosure(value.value)) throw new TypeError("An accessor must be callable.");
        Object.defineProperty(materializeFunctionProperties(value.value), "name", {
          value: `${property.kind} ${propertyFunctionName(key.value)}`
        });
        await defineDataProperty(object, key.value, {
          [property.kind]: accessorAdapter(value.value, property.kind),
          configurable: true,
          enumerable: true
        }, context.budget, createCoercionContext(context));
        continue;
      }

      if (isObjectPrototypeSetterProperty(property, key.value)) {
        if (value.value === null || typeof value.value === "object") {
          setSandboxPrototype(object, value.value as object | null, context.budget);
        }
        continue;
      }

      defineSandboxProperty(object, key.value, value.value);
    }

    return {
      kind: "normal",
      hasValue: true,
      value: object
    };
  } finally {
    release();
  }
}

function isObjectPrototypeSetterProperty(property: Property, key: PropertyKey): boolean {
  return !property.computed && !property.shorthand && key === "__proto__" &&
    !(property.value.type === "FunctionExpression" && property.value.method === true);
}

async function evaluateTemplateLiteral(
  node: TemplateLiteral,
  context: EvaluationContext
): Promise<EvaluationResult> {
  const restored = context.generatorResume === undefined || node.nodeId === undefined
    ? undefined : context.restoredGeneratorExpressionStates?.get(node.nodeId);
  if (restored !== undefined && restored.kind !== "template") throw new TypeError("Invalid template continuation.");
  const state = { kind: "template" as const, prefix: restored?.prefix ?? "", index: restored?.index ?? 0 };
  let value = context.budget.allocateString(restored?.prefix ?? node.quasis[0]?.value.cooked ?? "");
  if (context.generatorYield !== undefined && node.nodeId !== undefined) context = {
    ...context, generatorExpressionStates: new Map([...(context.generatorExpressionStates ?? []), [node.nodeId, state]])
  };
  let input: SandboxValue = undefined;
  const release = retainValues(context.budget, () => [value, input]);
  try {
    for (let index = state.index; index < node.expressions.length; index += 1) {
      state.index = index;
      state.prefix = value;
      const expression = await evaluateNode(node.expressions[index], context);
      if (expression.kind !== "normal") {
        return expression;
      }

      input = expression.value;
      const text = sandboxString(input, context.budget, createCoercionContext(context));
      const expressionText = typeof text === "string" ? text : await text;
      input = undefined;
      value = context.budget.allocateString(value + expressionText);

      const quasiText = context.budget.allocateString(node.quasis[index + 1]?.value.cooked ?? "");
      value = context.budget.allocateString(value + quasiText);
    }

    return {
      kind: "normal",
      hasValue: true,
      value
    };
  } finally {
    release();
  }
}

async function evaluateTaggedTemplateExpression(
  node: TaggedTemplateExpression,
  context: EvaluationContext
): Promise<EvaluationResult> {
  const invokeTag = async (tag: SandboxValue, receiver: SandboxValue): Promise<EvaluationResult> => {
    const call = createCallContinuation(node, tag, context, receiver);
    context = call.context;
    const release = retainValues(context.budget, () => [tag, receiver]);
    try {
      const values = await evaluateCallArguments(node.quasi.expressions, context, call.state);
      if (!values.ok) return values.result;
      if (!isSandboxClosure(tag)) throw new TypeError("Tagged template tag must be a function.");
      return {
        kind: "normal", hasValue: true,
        value: await invokeSandboxClosure(tag,
          [templateObject(node.quasi, context.budget), ...values.value], context,
          [...context.callStack, formatStackFrame(node, tag.name)], node.span, receiver)
      };
    } finally { release(); }
  };
  const restored = context.generatorResume === undefined || node.nodeId === undefined
    ? undefined : context.restoredGeneratorExpressionStates?.get(node.nodeId);
  if (restored !== undefined) {
    if (restored.kind !== "tagged") throw new TypeError("Invalid tagged template continuation.");
    return invokeTag(restored.callee, restored.thisValue);
  }
  if (node.tag.type === "MemberExpression") return evaluateMemberAccess(node.tag, context, async member => {
    if (member.kind === "nullish") throw new TypeError("Tagged template tag must be a function.");
    if (member.privateName !== undefined) return invokeTag(await readPrivateValue(member.object, member.privateName, context), member.object);
    const key = await toPropertyKey(member.property, context.budget, createCoercionContext(context));
    const receiver = member.superReceiver === undefined ? member.object : member.superReceiver.value;
    return invokeTag(await getPropertyValue(member.object, key, context, receiver), receiver);
  });
  const tag = await evaluateNode(node.tag, context);
  return tag.kind === "normal" ? invokeTag(tag.value, undefined) : tag;
}

async function evaluateArrowFunction(
  node: ArrowFunctionExpression,
  context: EvaluationContext
): Promise<EvaluationResult> {
  return evaluateArrowFunctionExpression(node, context, evaluateNode);
}

async function evaluateFunctionDeclaration(
  node: FunctionDeclaration,
  context: EvaluationContext
): Promise<EvaluationResult> {
  if (node.id === undefined) throw new Error("An anonymous declaration requires a default export.");
  if (context.evalCompletion && evalFunctionDeclarations.has(node)) return normalEmptyResult();
  if (!context.scope.hasOwnBinding(node.id.name)) {
    context.scope.declare(
      node.id.name,
      "const",
      createInterpretedClosure(node, context, evaluateNode)
    );
  }
  if (legacyBlockFunctions.has(node)) {
    const binding = context.scope.lookup(node.id.name);
    if (binding.found) {
      const assigned = context.scope.assignVar(node.id.name, binding.value, (object, key, value) =>
        setSandboxProperty(object, key, value, context.budget, true, createCoercionContext(context), false));
      if (assigned !== undefined) await assigned;
    }
  }

  return {
    kind: "normal",
    hasValue: false,
    value: undefined
  };
}

async function evaluateFunction(
  node: FunctionExpression,
  context: EvaluationContext
): Promise<EvaluationResult> {
  return evaluateFunctionExpression(node, context, evaluateNode);
}

async function evaluateAwait(
  node: AwaitExpression,
  context: EvaluationContext
): Promise<EvaluationResult> {
  return evaluateAwaitExpression(node, context, evaluateNode);
}

async function evaluateBinaryExpression(
  node: BinaryExpression,
  context: EvaluationContext
): Promise<EvaluationResult> {
  if (node.left.type === "PrivateIdentifier" && node.operator === "in") {
    const name = context.scope.resolvePrivateName(node.left.name);
    const right = await evaluateNode(node.right, context);
    if (right.kind !== "normal") return right;
    return { kind: "normal", hasValue: true, value: findPrivateElement(right.value, name) !== undefined };
  }
  const restored = context.generatorResume === undefined || node.nodeId === undefined
    ? undefined : context.restoredGeneratorExpressionStates?.get(node.nodeId);
  if (restored !== undefined && restored.kind !== "binary") throw new TypeError("Invalid binary expression continuation.");
  const left = restored?.kind === "binary"
    ? { kind: "normal" as const, hasValue: true, value: restored.left }
    : await evaluateNode(node.left, context);
  if (left.kind !== "normal") {
    return left;
  }

  let leftValue = left.value;
  if (context.generatorYield !== undefined && node.nodeId !== undefined) context = {
    ...context, generatorExpressionStates: new Map([...(context.generatorExpressionStates ?? []), [node.nodeId, { kind: "binary", left: leftValue }]])
  };
  let rightValue: SandboxValue;
  const release = retainValues(context.budget, () => [leftValue, rightValue]);
  try {
    const right = await evaluateNode(node.right, context);
    if (right.kind !== "normal") {
      return right;
    }

    rightValue = right.value;
    if (node.operator === "in") {
      if (typeof right.value !== "object" || right.value === null) {
        throw new TypeError("Right-hand side of 'in' must be an object.");
      }
      leftValue = await toPropertyKey(leftValue, context.budget, createCoercionContext(context));
    }
    if (!["in", "instanceof", "===", "!=="].includes(node.operator)) {
      const equality = node.operator === "==" || node.operator === "!=";
      const hint = equality || node.operator === "+" ? "default" : "number";
      if (leftValue !== null && typeof leftValue === "object" && (!equality || (rightValue !== null && rightValue !== undefined && typeof rightValue !== "object")))
        leftValue = await toNumericPrimitive(leftValue, context, hint);
      if (rightValue !== null && typeof rightValue === "object" && (!equality || (left.value !== null && left.value !== undefined && typeof left.value !== "object")))
        rightValue = await toNumericPrimitive(rightValue, context, hint);
    }
    const operation = applyBinaryOperator(node, leftValue, rightValue, context);
    const value = operation instanceof Promise ? await operation : operation;

    return {
      kind: "normal",
      hasValue: true,
      value
    };
  } finally {
    release();
  }
}

async function evaluateAssignmentExpression(
  node: AssignmentExpression,
  context: EvaluationContext
): Promise<EvaluationResult> {
  if (node.left.type === "ArrayPattern" || node.left.type === "ObjectPattern") {
    const restored = context.generatorResume === undefined || node.nodeId === undefined
      ? undefined : context.restoredGeneratorExpressionStates?.get(node.nodeId);
    if (restored !== undefined && restored.kind !== "pattern-source") throw new TypeError("Invalid pattern source continuation.");
    const right = restored === undefined ? await evaluateNode(node.right, context)
      : { kind: "normal" as const, hasValue: true as const, value: restored.value };
    if (right.kind !== "normal") {
      return right;
    }

    if (context.generatorYield !== undefined && node.nodeId !== undefined) {
      context = { ...context, generatorExpressionStates: new Map([...(context.generatorExpressionStates ?? []),
        [node.nodeId, { kind: "pattern-source", value: right.value }]]) };
    }
    const release = retainValues(context.budget, () => [right.value]);
    try {
      const binding = await bindPattern(node.left, right.value, { assign: true }, context.scope, createPatternContext(context));
      if (!binding.ok) return binding.result;
      return { kind: "normal", hasValue: true, value: right.value };
    } finally {
      release();
    }
  }

  if (node.left.type === "MemberExpression") {
    return evaluateMemberAssignmentExpression(node, context);
  }

  if (node.left.type !== "Identifier") {
    return {
      kind: "error",
      error: createError(
        "UNSUPPORTED_NODE",
        node,
        `Unsupported assignment target '${node.left.type}'.`
      )
    };
  }

  const restored = context.generatorResume === undefined || node.nodeId === undefined
    ? undefined : context.restoredGeneratorExpressionStates?.get(node.nodeId);
  if (restored !== undefined && restored.kind !== "identifier-assignment") throw new TypeError("Invalid identifier assignment continuation.");
  const reference: BindingReference = restored?.referenceKind === "object"
    ? {kind: "object", name: node.left.name, object: restored.referenceObject as SandboxObject, withEnvironment: false}
    : restored?.referenceKind === "binding"
      ? {kind: "binding", name: node.left.name, scope: restored.referenceScope!}
      : restored?.referenceKind === "unresolvable" ? {kind: "unresolvable", name: node.left.name}
        : await context.scope.resolveBinding(node.left.name, bindingOperations(context));
  if (reference.kind === "unresolvable" && node.operator !== "=")
    throw new ReferenceError(`Cannot assign to undeclared binding '${node.left.name}'.`);
  const current = restored === undefined
    ? node.operator === "=" ? undefined : await getReferenceValue(reference, context)
    : restored.current;

  if (node.operator === "&&=" && !isTruthy(current)) {
    return {
      kind: "normal",
      hasValue: true,
      value: current
    };
  }

  if (node.operator === "||=" && isTruthy(current)) {
    return {
      kind: "normal",
      hasValue: true,
      value: current
    };
  }

  if (node.operator === "??=" && current !== null && current !== undefined) {
    return {
      kind: "normal",
      hasValue: true,
      value: current
    };
  }

  if (context.generatorYield !== undefined && node.nodeId !== undefined) {
    context = { ...context, generatorExpressionStates: new Map([...(context.generatorExpressionStates ?? []),
      [node.nodeId, { kind: "identifier-assignment", current, referenceKind: reference.kind,
        ...(reference.kind === "object" ? {referenceObject: reference.object} : {}),
        ...(reference.kind === "binding" ? {referenceScope: reference.scope} : {}) }]]) };
  }
  const release = retainValues(context.budget, () => [current,
    ...(reference.kind === "object" ? [reference.object] : reference.kind === "binding" ? reference.scope.retainedDataRoots() : [])]);
  try {
    const right = await evaluateNode(node.right, { ...context, inferredName: node.left.name });
    if (right.kind !== "normal") {
      return right;
    }

    const value =
      node.operator === "=" ||
      node.operator === "&&=" ||
      node.operator === "||=" ||
      node.operator === "??="
        ? right.value
        : await applyCompoundAssignmentOperator(node.operator, current, right.value, context);

    if (reference.kind === "unresolvable" && context.strict === false) {
      const global = resolveIntrinsicIdentity(context.budget, '["globalThis"]') as SandboxObject;
      await setSandboxProperty(global, node.left.name, value, context.budget, true, createCoercionContext(context), false);
    } else if (reference.kind === "object") {
      if (context.strict !== false && !await bindingOperations(context).has(reference.object, reference.name))
        throw new ReferenceError(`Cannot assign to undeclared binding '${reference.name}'.`);
      await setSandboxProperty(reference.object, reference.name, value, context.budget, true, createCoercionContext(context), context.strict !== false);
    } else if (reference.kind === "binding") {
      reference.scope.assignOwnBinding(reference.name, value, context.strict !== false);
    } else throw new ReferenceError(`Cannot assign to undeclared binding '${node.left.name}'.`);

    return {
      kind: "normal",
      hasValue: true,
      value
    };
  } finally {
    release();
  }
}

async function evaluateMemberAssignmentExpression(
  node: AssignmentExpression,
  context: EvaluationContext
): Promise<EvaluationResult> {
  if (node.left.type !== "MemberExpression") {
    throw new TypeError("Expected member assignment target.");
  }

  const restored = context.generatorResume === undefined || node.nodeId === undefined
    ? undefined : context.restoredGeneratorExpressionStates?.get(node.nodeId);
  if (restored !== undefined && restored.kind !== "member-assignment") throw new TypeError("Invalid assignment continuation.");
  const assign = async (member: MemberReference): Promise<EvaluationResult> => {
    if (member.kind === "nullish") {
      throw new TypeError("Cannot assign properties of null or undefined.");
    }
    let property = restored?.key as PropertyKey | undefined;
    let current: SandboxValue = restored?.current;
    if (node.operator !== "=" && restored === undefined) {
      if (member.object === null || member.object === undefined) {
        throw new TypeError("Cannot assign properties of null or undefined.");
      }
      property = member.privateName === undefined ? await toPropertyKey(
        member.property,
        context.budget,
        createCoercionContext(context)
      ) : undefined;
      current = member.privateName !== undefined ? await readPrivateValue(member.object, member.privateName, context) : await getPropertyValue(
        member.object,
        property!,
        context,
        member.superReceiver === undefined ? member.object : member.superReceiver.value
      );
    }

    if (node.operator === "&&=" && !isTruthy(current)) {
      return {
        kind: "normal",
        hasValue: true,
        value: current
      };
    }

    if (node.operator === "||=" && isTruthy(current)) {
      return {
        kind: "normal",
        hasValue: true,
        value: current
      };
    }

    if (node.operator === "??=" && current !== null && current !== undefined) {
      return {
        kind: "normal",
        hasValue: true,
        value: current
      };
    }

    if (context.generatorYield !== undefined && node.nodeId !== undefined) {
      const state = { kind: "member-assignment" as const, object: member.object, property: member.property, current,
        ...(member.privateName === undefined ? {} : { privateName: member.privateName.description }),
        ...(property === undefined ? {} : { key: property }),
        ...(member.superReceiver === undefined ? {} : { superReceiver: member.superReceiver.value }) };
      context = { ...context, generatorExpressionStates: new Map([...(context.generatorExpressionStates ?? []), [node.nodeId, state]]) };
    }
    let operands: SandboxValue[] = [current, property, member.object, member.property, member.superReceiver?.value];
    const release = retainValues(context.budget, () => operands);
    try {
      const right = await evaluateNode(node.right, context);
      if (right.kind !== "normal") {
        return right;
      }

      operands.push(right.value);
      const value =
        node.operator === "=" ||
        node.operator === "&&=" ||
        node.operator === "||=" ||
        node.operator === "??="
          ? right.value
          : await applyCompoundAssignmentOperator(node.operator, current, right.value, context);

      if (member.object === null || member.object === undefined) {
        throw new TypeError("Cannot assign properties of null or undefined.");
      }
      operands = [value, member.object, member.property, member.superReceiver?.value];
      if (member.privateName === undefined) property ??= await toPropertyKey(
        member.property,
        context.budget,
        createCoercionContext(context)
      );
      if (member.privateName !== undefined) await writePrivateValue(member.object, member.privateName, value, context);
      else if (member.superReceiver === undefined)
        await setSandboxProperty(
          member.object,
          property!,
          value,
          context.budget,
          true,
          createCoercionContext(context),
          context.strict !== false
        );
      else
        await setSuperProperty(member.object, member.superReceiver.value, property!, value, context);

      return {
        kind: "normal",
        hasValue: true,
        value
      };
    } finally {
      release();
    }
  };
  if (restored !== undefined) return assign({ kind: "resolved", object: restored.object, property: restored.property,
    ...(restored.privateName === undefined ? {} : { privateName: context.scope.resolvePrivateName(restored.privateName) }),
    ...(Object.hasOwn(restored, "superReceiver") ? { superReceiver: { value: restored.superReceiver } } : {}) });
  return evaluateMemberAccess(node.left, context, assign);
}

async function evaluateLogicalExpression(
  node: LogicalExpression,
  context: EvaluationContext
): Promise<EvaluationResult> {
  if (context.generatorResume !== undefined &&
      containsResumeTarget(node.right, new Set([context.generatorResume.yieldNodeId])))
    return evaluateNode(node.right, context);
  const left = await evaluateNode(node.left, context);
  if (left.kind !== "normal") {
    return left;
  }

  switch (node.operator) {
    case "&&":
      if (!isTruthy(left.value)) {
        return left;
      }
      break;
    case "||":
      if (isTruthy(left.value)) {
        return left;
      }
      break;
    case "??":
      if (left.value !== null && left.value !== undefined) {
        return left;
      }
      break;
  }

  return evaluateNode(node.right, context);
}

async function evaluateSequenceExpression(
  node: SequenceExpression,
  context: EvaluationContext
): Promise<EvaluationResult> {
  let result: EvaluationResult = {
    kind: "normal",
    hasValue: true,
    value: undefined
  };

  const resumeIndex = context.generatorResume === undefined ? -1 : node.expressions.findIndex(expression =>
    containsResumeTarget(expression, new Set([context.generatorResume!.yieldNodeId]))
  );
  for (let index = Math.max(0, resumeIndex); index < node.expressions.length; index++) {
    const expression = node.expressions[index];
    result = await evaluateNode(expression, context);
    if (result.kind !== "normal") {
      return result;
    }
  }

  return result;
}

async function evaluateConditionalExpression(
  node: ConditionalExpression,
  context: EvaluationContext
): Promise<EvaluationResult> {
  if (context.generatorResume !== undefined) {
    const target = new Set([context.generatorResume.yieldNodeId]);
    if (containsResumeTarget(node.consequent, target)) return evaluateNode(node.consequent, context);
    if (containsResumeTarget(node.alternate, target)) return evaluateNode(node.alternate, context);
  }
  const test = await evaluateNode(node.test, context);
  if (test.kind !== "normal") {
    return test;
  }

  return evaluateNode(isTruthy(test.value) ? node.consequent : node.alternate, context);
}

async function evaluateIdentifier(
  node: Identifier,
  context: EvaluationContext,
  onReference?: (reference: BindingReference) => void
): Promise<EvaluationResult> {
  const resolved = context.scope.resolveBinding(node.name, bindingOperations(context));
  const reference = "kind" in resolved ? resolved : await resolved;

  if (reference.kind === "unresolvable") {
    return {
      kind: "error",
      error: createError(
        "UNBOUND_IDENTIFIER",
        node,
        `Identifier '${node.name}' is not defined.`,
        context.callStack
      )
    };
  }

  const value = reference.kind === "binding"
    ? getReferenceValue(reference, context) : await getReferenceValue(reference, context);
  onReference?.(reference);
  return { kind: "normal", hasValue: true, value };
}

async function evaluateWithStatement(
  node: import("../parse.js").WithStatement, context: EvaluationContext
): Promise<EvaluationResult> {
  const result = await evaluateNode(node.object, context);
  if (result.kind !== "normal") return result;
  if (result.value === null || result.value === undefined) throw new TypeError("Cannot create a with environment from null or undefined.");
  const object = typeof result.value === "object" ? result.value : createSandboxBox(result.value);
  const evaluation = evaluateNode(node.body, {...context, scope: context.scope.withObject(object as SandboxObject)});
  if (!context.evalCompletion) return evaluation;
  const completion = await evaluation;
  return completion.kind !== "error" && !completion.hasValue
    ? { ...completion, hasValue: true, value: undefined } : completion;
}

function bindingOperations(context: EvaluationContext) {
  return {
    has: (object: SandboxObject, key: string) => isGuestHostObject(object)
      ? hasSandboxProperty(object, key, context)
      : sandboxHasProperty(object, key, context.budget, createCoercionContext(context)),
    get: (object: SandboxObject, key: PropertyKey) => getPropertyValue(object, key, context)
  };
}

function getReferenceValue(reference: Extract<BindingReference, {kind: "binding"}>, context: EvaluationContext): SandboxValue;
function getReferenceValue(reference: BindingReference, context: EvaluationContext): SandboxValue | Promise<SandboxValue>;
function getReferenceValue(reference: BindingReference, context: EvaluationContext): SandboxValue | Promise<SandboxValue> {
  if (reference.kind === "object") return getPropertyValue(reference.object, reference.name, context);
  if (reference.kind === "binding") {
    const binding = reference.scope.lookup(reference.name);
    if (binding.found) return binding.value;
  }
  throw new ReferenceError(`Identifier '${reference.name}' is not defined.`);
}

async function evaluateThisExpression(
  _node: ThisExpression,
  context: EvaluationContext
): Promise<EvaluationResult> {
  return {
    kind: "normal",
    hasValue: true,
    value: context.scope.lookupThis()
  };
}

async function evaluateMetaProperty(
  _node: MetaProperty,
  context: EvaluationContext
): Promise<EvaluationResult> {
  return {
    kind: "normal",
    hasValue: true,
    value: context.scope.lookupImportMeta()
  };
}

async function evaluateExportDefaultDeclaration(
  node: ExportDefaultDeclaration,
  context: EvaluationContext
): Promise<EvaluationResult> {
  if (node.declaration.type === "FunctionDeclaration") {
    if (!context.scope.hasOwnBinding("default")) predeclareStatementListBindings([node], context);
    return { kind: "normal", hasValue: false, value: undefined };
  }
  const declaration = await evaluateNode(node.declaration, { ...context, inferredName: "default" });
  if (declaration.kind !== "normal") {
    return declaration;
  }

  if (node.declaration.type === "ClassDeclaration") {
    context.scope.declareAlias("default", node.declaration.id.name);
  } else {
    context.scope.declare("default", "const", declaration.value);
  }

  return {
    kind: "normal",
    hasValue: false,
    value: undefined
  };
}

async function evaluateExportNamedDeclaration(
  node: ExportNamedDeclaration,
  context: EvaluationContext
): Promise<EvaluationResult> {
  return evaluateVariableDeclaration(node.declaration, context);
}

async function evaluateVariableDeclaration(
  node: VariableDeclaration,
  context: EvaluationContext
): Promise<EvaluationResult> {
  const saved = context.generatorResume === undefined || node.nodeId === undefined
    ? undefined : context.restoredGeneratorExpressionStates?.get(node.nodeId);
  if (saved !== undefined && saved.kind !== "declaration") throw new TypeError("Invalid declaration continuation.");
  if (node.kind !== "var") {
    predeclareDeclarationBindings(node, context.scope);
  }

  for (let index = saved?.index ?? 0; index < node.declarations.length; index++) {
    const declarator = node.declarations[index];
    if (context.generatorYield !== undefined && node.nodeId !== undefined) {
      context = { ...context, generatorExpressionStates: new Map([...(context.generatorExpressionStates ?? []),
        [node.nodeId, { kind: "declaration", index }]]) };
    }
    if (
      node.kind === "var" &&
      declarator.init === undefined &&
      declarator.id.type === "Identifier" &&
      context.scope.lookup(declarator.id.name).found
    ) {
      continue;
    }

    if (declarator.id.type === "ArrayPattern" || declarator.id.type === "ObjectPattern") {
      const names = getPatternBindingNames(declarator.id);
      const restoredBindings: Array<[string, InterpreterValue]> = [];
      for (const name of names) {
        const restored = context.scope.consumeRestoredBinding(name);
        if (restored.found && isRestorableBindingValue(restored.value)) {
          restoredBindings.push([name, restored.value]);
        }
      }
      if (names.length > 0 && restoredBindings.length === names.length) {
        for (const [name, value] of restoredBindings) {
          if (node.kind === "var") context.scope.assign(name, value);
          else context.scope.declare(name, node.kind, value);
        }
        continue;
      }
    }

    const restoredSource = context.generatorResume === undefined || declarator.nodeId === undefined
      ? undefined : context.restoredGeneratorExpressionStates?.get(declarator.nodeId);
    if (restoredSource !== undefined && restoredSource.kind !== "pattern-source") throw new TypeError("Invalid declaration source continuation.");
    const restoredValue =
      declarator.id.type === "Identifier"
        ? context.scope.consumeRestoredBinding(declarator.id.name)
        : { found: false as const };
    const value =
      restoredSource !== undefined
        ? { kind: "normal" as const, hasValue: true as const, value: restoredSource.value }
        : restoredValue.found && isRestorableBindingValue(restoredValue.value)
        ? {
            kind: "normal" as const,
            hasValue: true as const,
            value: restoredValue.value
          }
        : declarator.init === undefined
          ? {
              kind: "normal" as const,
              hasValue: true as const,
              value: undefined
            }
          : await evaluateNode(declarator.init, { ...context, inferredName: declarator.id.type === "Identifier" ? declarator.id.name : undefined });

    if (value.kind !== "normal") {
      return value;
    }

    const bindingContext = context.generatorYield === undefined || declarator.nodeId === undefined ||
      declarator.init === undefined || declarator.id.type === "Identifier" ? context : {
        ...context, generatorExpressionStates: new Map([...(context.generatorExpressionStates ?? []),
          [declarator.nodeId, { kind: "pattern-source" as const, value: value.value }]])
      };
    const release = retainValues(context.budget, () => [value.value]);
    try {
      if (node.disposal !== undefined) await registerScopeResource(context.scope, value.value, node.disposal, context.budget, createCoercionContext(context));
      const binding = await bindPattern(
        declarator.id,
        value.value,
        { kind: node.kind },
        context.scope,
        createPatternContext(bindingContext)
      );
      if (!binding.ok) return binding.result;
    } finally {
      release();
    }
  }

  return {
    kind: "normal",
    hasValue: false,
    value: undefined
  };
}

function isRestorableBindingValue(value: InterpreterValue, seen = new WeakSet<object>()): boolean {
  if (typeof value !== "object" || value === null) {
    return true;
  }
  if (seen.has(value)) return true;
  seen.add(value);
  if (isSandboxRegExpIterator(value)) return isRestorableBindingValue(regexpIteratorState(value).matcher, seen);
  if (isSandboxCollectionIterator(value)) {
    return isRestorableBindingValue(collectionIteratorState(value).collection, seen);
  }
  if (isSandboxMap(value)) {
    for (const [key, entry] of value.entries) {
      if (!isRestorableBindingValue(key, seen) || !isRestorableBindingValue(entry, seen)) {
        return false;
      }
    }
    return true;
  }
  if (isSandboxSet(value)) {
    for (const entry of value.values) {
      if (!isRestorableBindingValue(entry, seen)) return false;
    }
    return true;
  }
  if (Array.isArray(value)) {
    return value.every((entry) => isRestorableBindingValue(entry, seen));
  }
  if (Object.hasOwn(value, "kind")) {
    return !["fn", "generator", "map", "promise", "regex", "set"].includes(
      String((value as { kind?: unknown }).kind)
    );
  }
  return Object.values(value).every((entry) => isRestorableBindingValue(entry, seen));
}

function predeclareDeclarationBindings(node: VariableDeclaration, scope: Scope): void {
  for (const name of getDeclarationBindingNames(node)) {
    if (!scope.hasOwnBinding(name)) {
      scope.predeclare(name, node.kind);
    }
  }
}

function getForStatementBindingNames(node: ForStatement): string[] {
  return node.init?.type === "VariableDeclaration" && node.init.kind !== "var"
    ? getDeclarationBindingNames(node.init)
    : [];
}

function getDeclarationBindingNames(node: VariableDeclaration): string[] {
  return node.declarations.flatMap((declarator) => getPatternBindingNames(declarator.id));
}

function getPatternBindingNames(
  pattern:
    | ArrayPattern
    | AssignmentPattern
    | Identifier
    | MemberExpression
    | ObjectPattern
    | RestElement
): string[] {
  switch (pattern.type) {
    case "Identifier":
      return [pattern.name];
    case "MemberExpression":
      return [];
    case "AssignmentPattern":
      return getPatternBindingNames(pattern.left);
    case "ArrayPattern":
      return pattern.elements.flatMap((element) =>
        element === null ? [] : getPatternBindingNames(element)
      );
    case "ObjectPattern":
      return pattern.properties.flatMap((property) =>
        property.type === "RestElement"
          ? getPatternBindingNames(property)
          : getPatternBindingNames(property.value)
      );
    case "RestElement":
      return getPatternBindingNames(pattern.argument);
  }
}

async function evaluateBlockStatement(
  node: BlockStatement,
  context: EvaluationContext
): Promise<EvaluationResult> {
  const blockContext = createBlockContext(node, context);
  const resumeIndex = findResumeStatementIndex(node, blockContext);
  const generatorResumeIndex = findGeneratorResumeStatementIndex(node, blockContext);
  const completion = context.evalCompletion && node !== context.functionBody ? new StatementCompletion(context.budget) : undefined;
  const evaluation = evaluateResourceScope(blockContext.scope, context.budget, {...createCoercionContext(blockContext), ...resourceSuspension(blockContext, node), onSuspend: blockContext.onSuspend, signal: blockContext.signal}, async () => {
  for (let index = 0; index < node.body.length; index += 1) {
    const statement = node.body[index]!;
    if (generatorResumeIndex !== undefined && index < generatorResumeIndex) {
      continue;
    }
    if (
      resumeIndex !== undefined &&
      index < resumeIndex &&
      statement.type !== "VariableDeclaration"
    ) {
      continue;
    }
    const evaluated = await evaluateNode(statement, blockContext);
    const result = completion?.update(evaluated) ?? evaluated;
    if (result.kind !== "normal") {
      return result;
    }
  }

  return completion?.normal() ?? {
    kind: "normal",
    hasValue: false,
    value: undefined
  };
  });
  if (completion === undefined) return evaluation;
  try { return await evaluation; } finally { completion.close(); }
}

function findGeneratorResumeStatementIndex(
  node: BlockStatement,
  context: EvaluationContext
): number | undefined {
  if (context.generatorResume === undefined) {
    return undefined;
  }
  const index = node.body.findIndex((statement) =>
    containsResumeTarget(statement, new Set([context.generatorResume!.yieldNodeId]))
  );
  return index === -1 ? undefined : index;
}

function findResumeStatementIndex(
  node: BlockStatement,
  context: EvaluationContext
): number | undefined {
  if (context.restoredLoopIterations.size === 0 && context.resumeTarget?.nodeId === undefined) {
    return undefined;
  }

  const targetNodeIds = new Set(context.restoredLoopIterations.keys());
  if (context.resumeTarget?.nodeId !== undefined) {
    targetNodeIds.add(context.resumeTarget.nodeId);
  }
  const index = node.body.findIndex((statement) => containsResumeTarget(statement, targetNodeIds));
  return index === -1 ? undefined : index;
}

function createBlockContext(node: BlockStatement, context: EvaluationContext): EvaluationContext {
  const restoredScope = context.generatorResume === undefined || node.nodeId === undefined
    ? undefined : context.restoredGeneratorBlockScopes?.get(node.nodeId);
  const scope =
    restoredScope ?? (node === context.rootNode ||
    node === context.functionBody ||
    context.generatorResume !== undefined
      ? context.scope
      : context.scope.child());
  const blockContext = {
    ...context,
    scope,
    ...(context.generatorYield === undefined || node.nodeId === undefined ? {} : {
      generatorBlockScopes: new Map([...(context.generatorBlockScopes ?? []), [node.nodeId, scope]])
    })
  };
  if (context.generatorResume === undefined) {
    predeclareBlockBindings(node, blockContext);
  }
  return blockContext;
}

function predeclareBlockBindings(node: BlockStatement, context: EvaluationContext): void {
  predeclareStatementListBindings(
    node.body,
    context,
    node === context.functionBody || node === context.rootNode
  );
}

function predeclareStatementListBindings(
  statements: readonly import("../parse.js").Statement[],
  context: EvaluationContext,
  functionBody = false
): void {
  const { scope } = context;
  const names = new Set<string>();
  const legacyFunctions = new Set<string>();

  for (const entry of statements) {
    const exportedFunction = entry.type === "ExportDefaultDeclaration" && entry.declaration.type === "FunctionDeclaration";
    const statement = entry.type === "ExportDefaultDeclaration" &&
      (entry.declaration.type === "ClassDeclaration" || entry.declaration.type === "FunctionDeclaration")
      ? entry.declaration : entry;
    if (statement.type === "ClassDeclaration") {
      scope.predeclare(statement.id.name, "let");
      names.add(statement.id.name);
      continue;
    }
    if (statement.type === "FunctionDeclaration") {
      if (statement.id === undefined && !exportedFunction) throw new Error("An anonymous declaration requires a default export.");
      const name = statement.id?.name ?? "default";
      const closure = createInterpretedClosure(statement, exportedFunction ? { ...context, inferredName: name } : context, evaluateNode);
      if (functionBody && context.evalCompletion && !exportedFunction) {
        scope.declareVar(name, {functionValue: closure, deletable: true});
        names.add(name);
        continue;
      }
      const legacyFunction = !functionBody && !exportedFunction && context.strict === false &&
        !statement.async && !statement.generator;
      const repeatedLegacyFunction = legacyFunction && legacyFunctions.has(name);
      if (names.has(name) && !repeatedLegacyFunction &&
          !(!exportedFunction && functionBody && scope.getOwnBindingKind(name) === "var")) {
        throw new Error(`Cannot redeclare binding '${name}' in the same scope.`);
      }

      const ownBindingKind = scope.getOwnBindingKind(name);
      if ((ownBindingKind === "var" && !exportedFunction) ||
          (ownBindingKind === "let" && repeatedLegacyFunction)) {
        names.add(name);
        scope.assign(name, closure);
        continue;
      }
      if (ownBindingKind !== undefined) {
        throw new Error(`Cannot redeclare binding '${name}' in the same scope.`);
      }

      names.add(name);
      if (legacyFunction) legacyFunctions.add(name);
      scope.declare(name, exportedFunction ? (statement.id === undefined ? "const" : "let") : functionBody ? "var" : "let", closure);
      if (exportedFunction && statement.id !== undefined) scope.declareAlias("default", name);
      continue;
    }

    if (statement.type !== "VariableDeclaration" || statement.kind === "var") {
      continue;
    }

    for (const name of getDeclarationBindingNames(statement)) {
      if (names.has(name) || scope.hasOwnBinding(name)) {
        throw new Error(`Cannot redeclare binding '${name}' in the same scope.`);
      }

      names.add(name);
      scope.predeclare(name, statement.kind);
    }
  }
}

async function evaluateSwitchStatement(
  node: SwitchStatement,
  context: EvaluationContext
): Promise<EvaluationResult> {
  const saved = context.generatorResume === undefined || node.nodeId === undefined
    ? undefined : context.restoredGeneratorExpressionStates?.get(node.nodeId);
  if (saved !== undefined && saved.kind !== "switch") throw new TypeError("Invalid switch continuation.");
  const discriminant = saved === undefined ? await evaluateNode(node.discriminant, context)
    : { kind: "normal" as const, value: saved.value };
  if (discriminant.kind !== "normal") {
    return discriminant;
  }

  const progress: Extract<GeneratorExpressionState, { kind: "switch" }> = saved === undefined
    ? { kind: "switch", phase: "test", index: 0, statementIndex: 0, value: discriminant.value, scope: context.scope.child() }
    : { ...saved };
  const switchContext: EvaluationContext = { ...context, scope: progress.scope,
    ...(context.generatorYield === undefined || node.nodeId === undefined ? {} : {
      generatorExpressionStates: new Map([...(context.generatorExpressionStates ?? []), [node.nodeId, progress]])
    }) };
  if (saved === undefined) predeclareStatementListBindings(
    node.cases.flatMap((switchCase) => switchCase.consequent),
    switchContext
  );

  const completion = context.evalCompletion ? new StatementCompletion(context.budget, true) : undefined;
  const release = retainValues(context.budget, () => [progress.value]);
  try {
    return await evaluateResourceScope(progress.scope, context.budget, {...createCoercionContext(switchContext), ...resourceSuspension(switchContext, node), onSuspend: switchContext.onSuspend, signal: switchContext.signal}, async () => {
    const defaultIndex = node.cases.findIndex(entry => entry.test === undefined);
    let startIndex: number | undefined = saved?.phase === "body" ? saved.index : undefined;
    for (let index = progress.index; startIndex === undefined && index < node.cases.length; index += 1) {
      const switchCase = node.cases[index]!;
      if (switchCase.test === undefined) {
        continue;
      }

      progress.index = index;
      const test = await evaluateNode(switchCase.test, switchContext);
      if (test.kind !== "normal") {
        return test;
      }
      if (discriminant.value === test.value) {
        startIndex = index;
        break;
      }
    }

    startIndex ??= defaultIndex < 0 ? undefined : defaultIndex;
    if (startIndex === undefined) {
      return completion?.normal() ?? normalEmptyResult();
    }

    for (let caseIndex = startIndex; caseIndex < node.cases.length; caseIndex += 1) {
      progress.phase = "body";
      progress.index = caseIndex;
      const statements = node.cases[caseIndex]!.consequent;
      for (let statementIndex = saved?.phase === "body" && caseIndex === saved.index ? saved.statementIndex : 0;
        statementIndex < statements.length; statementIndex++) {
        progress.statementIndex = statementIndex;
        const statement = statements[statementIndex]!;
        const evaluated = await evaluateNode(statement, switchContext);
        const result = completion?.update(evaluated) ?? evaluated;
        if (result.kind === "break" && result.label === undefined) {
          return completion?.normal() ?? normalEmptyResult();
        }
        if (result.kind !== "normal") {
          return result;
        }
      }
    }

    return completion?.normal() ?? normalEmptyResult();
    });
  } finally {
    release();
    completion?.close();
  }
}

async function evaluateIfStatement(
  node: IfStatement,
  context: EvaluationContext
): Promise<EvaluationResult> {
  if (context.generatorResume !== undefined && context.generatorResume.completed !== true) {
    const target = new Set([context.generatorResume.yieldNodeId]);
    if (containsResumeTarget(node.consequent, target)) return evaluateNode(node.consequent, context);
    if (node.alternate !== undefined && containsResumeTarget(node.alternate, target)) return evaluateNode(node.alternate, context);
  }
  const test = await evaluateNode(node.test, context);
  if (test.kind !== "normal") {
    return test;
  }

  const branch = isTruthy(test.value) ? node.consequent : node.alternate;
  if (branch === undefined) {
    return {
      kind: "normal",
      hasValue: context.evalCompletion === true,
      value: undefined
    };
  }

  if (!context.evalCompletion) return evaluateNode(branch, context);
  const result = await evaluateNode(branch, context);
  return context.evalCompletion && result.kind !== "error" && !result.hasValue
    ? {...result, hasValue: true, value: undefined} : result;
}

async function evaluateForOfStatement(
  node: ForOfStatement,
  context: EvaluationContext
): Promise<EvaluationResult> {
  const saved = context.generatorResume === undefined || node.nodeId === undefined
    ? undefined : context.restoredGeneratorExpressionStates?.get(node.nodeId);
  if (saved !== undefined && saved.kind !== "for-of-array" && saved.kind !== "for-of-iterator") throw new TypeError("Invalid for-of continuation.");
  if (saved?.kind === "for-of-iterator") return evaluateForOfIterator(node, saved.value, context);
  const restoredIteration = context.restoredLoopIterations.get(node.nodeId ?? -1);
  let restoredEntry: IteratorResult<SandboxValue> | undefined;
  if (typeof restoredIteration === "object" && typeof restoredIteration.values[0] === "string") {
    const restored = context.scope.consumeRestoredBinding(restoredIteration.values[0]);
    if (restored.found && Array.isArray(restored.value)) {
      restoredEntry = { done: false, value: restored.value[1] };
      if (Array.isArray(restored.value[0]) || isSandboxMap(restored.value[0]) || isSandboxSet(restored.value[0]) || isSandboxCollectionIterator(restored.value[0]) || isSandboxRegExpIterator(restored.value[0])) {
        return evaluateForOfIterator(node, restored.value[0], context, restoredEntry);
      }
    }
  }
  const iterable = saved === undefined ? await evaluateNode(node.right, context) : { kind: "normal" as const, value: saved.values };
  if (iterable.kind !== "normal") {
    return iterable;
  }

  // New executions always acquire the iterator protocol. Keep the indexed
  // path only for snapshots created before protocol-based array iteration.
  const values = saved?.kind === "for-of-array" && Array.isArray(saved.values) ? saved.values : undefined;
  if (values === undefined) {
    return evaluateForOfIterator(node, iterable.value, context, restoredEntry);
  }

  const restoredIndex = saved?.index ?? consumeRestoredLoopIterationIndex(node, context);
  for (let index = restoredIndex; index < values.length || (saved !== undefined && index === saved.index); index += 1) {
    context.activeLoopIterations.set(node.nodeId ?? -1, index);

    const resuming = saved !== undefined && index === saved.index;
    const scope = resuming ? saved.scope : context.scope.child();
    const current = resuming ? saved.current : values[index]!;
    const phaseContext = (phase: "left" | "body"): EvaluationContext => ({ ...context,
      ...(context.generatorYield === undefined || node.nodeId === undefined ? {} : {
        generatorExpressionStates: new Map([...(context.generatorExpressionStates ?? []),
          [node.nodeId, { kind: "for-of-array", phase, values, current, index, scope }]])
      }) });
    if (!resuming || saved.phase === "left") {
      const binding = await bindIterationVariable(node.left, current, scope, phaseContext("left"));
      if (!binding.ok) return binding.result;
    }

    const iterationContext = createLoopIterationContext(phaseContext("body"), scope);
    emitLoopIterationBreakpoint(node, iterationContext);
    const result = await evaluateResourceScope(scope, context.budget, {...createCoercionContext(iterationContext), ...resourceSuspension(iterationContext, node), onSuspend: iterationContext.onSuspend, signal: iterationContext.signal}, () => evaluateNode(node.body, iterationContext));

    if (isMatchingBreak(result, loopLabels(node))) {
      context.activeLoopIterations.delete(node.nodeId ?? -1);
      return {
        kind: "normal",
        hasValue: false,
        value: undefined
      };
    }

    if (isMatchingContinue(result, loopLabels(node))) {
      continue;
    }

    if (result.kind !== "normal") {
      context.activeLoopIterations.delete(node.nodeId ?? -1);
      return result;
    }
  }

  context.activeLoopIterations.delete(node.nodeId ?? -1);

  return {
    kind: "normal",
    hasValue: false,
    value: undefined
  };
}

async function evaluateForOfIterator(
  node: ForOfStatement,
  value: SandboxValue,
  context: EvaluationContext,
  restoredEntry?: IteratorResult<SandboxValue>
): Promise<EvaluationResult> {
  const saved = context.generatorResume === undefined || node.nodeId === undefined
    ? undefined : context.restoredGeneratorExpressionStates?.get(node.nodeId);
  if (saved !== undefined && saved.kind !== "for-of-iterator") throw new TypeError("Invalid iterator continuation.");
  let resumeCurrent = saved !== undefined && saved.phase !== "next";
  let resumeNext = saved?.phase === "next";
  let index = saved?.index ?? consumeRestoredLoopIterationIndex(node, context);
  const iterator = saved === undefined
    ? await acquireSandboxIterator(value, context.budget, createCoercionContext(context), node.await, context.signal)
    : "kind" in saved.iterator ? await restoreSandboxIterator(saved.iterator, context.budget, createCoercionContext(context), context.signal) : saved.iterator;
  if (iterator === undefined) {
    throw new TypeError(`${String(value)} is not a supported iterable`);
  }

  const nextIteration = async () => {
    if ((context.asyncFunction || context.asyncGeneratorFrame !== undefined) && node.await && iterator.resumeAwait !== undefined && node.nodeId !== undefined) {
      iterator.awaitValue = (awaited, awaitState) => suspendAsyncFunctionValue(awaited, node, {
        ...context,
        generatorExpressionStates: new Map([...(context.generatorExpressionStates ?? []),
          [node.nodeId!, {kind: "for-of-iterator", phase: "next", awaitState, async: true, value,
            current: undefined, index, scope: context.scope, iterator}]])
      }, undefined, createCoercionContext(context));
      try {
        if (resumeNext) {
          resumeNext = false;
          if (saved?.awaitState === undefined) throw new TypeError("Missing iterator await continuation.");
          return await iterator.resumeAwait(saved.awaitState, () => iterator.awaitValue!(undefined, saved.awaitState!));
        }
        return await iterator.next();
      } finally {delete iterator.awaitValue;}
    }
    const pending = Promise.resolve(iterator.next());
    if (!node.await) return pending;
    context.onSuspend?.();
    const leaveAwait = context.budget.enterAwait();
    try {
      return await suspendJob(pending);
    } finally {
      leaveAwait();
    }
  };

  const completion = context.evalCompletion ? new StatementCompletion(context.budget, true) : undefined;
  const releaseIterator = retainValues(context.budget, () => [value, iterator.retainedValue]);
  const closeLoopIterator = async (completion: EvaluationResult): Promise<void> => {
    const preserveThrow = completion.kind === "throw";
    if ((!context.asyncFunction && context.asyncGeneratorFrame === undefined) || !node.await || iterator.resumeAwait === undefined || node.nodeId === undefined || completion.kind === "error") {
      await closeIterator(iterator, preserveThrow);
      return;
    }
    const {node: ignoredNode, stackFrames, ...metadata} = completion;
    const closeCompletion = {...metadata, ...(stackFrames === undefined ? {} : {stackFrames: [...stackFrames]})};
    iterator.awaitValue = (awaited, awaitState) => suspendAsyncFunctionValue(awaited, node, {
      ...context,
      generatorExpressionStates: new Map([...(context.generatorExpressionStates ?? []),
        [node.nodeId!, {kind: "for-of-iterator", phase: "close", awaitState, closeCompletion, async: true, value,
          current: undefined, index, scope: context.scope, iterator}]])
    }, undefined, createCoercionContext(context));
    try {
      if (saved?.phase === "close" && context.generatorResume?.completed !== true) {
        if (saved.awaitState === undefined) throw new TypeError("Missing iterator close continuation.");
        await iterator.resumeAwait(saved.awaitState, () => iterator.awaitValue!(undefined, saved.awaitState!));
      } else await closeIterator(iterator, preserveThrow);
    } catch (error) {
      if (!preserveThrow || isFatalSandboxError(error) || error instanceof HostCallResumabilityError) throw error;
    } finally {delete iterator.awaitValue;}
  };
  try {
    if (saved?.phase === "close") {
      if (saved.closeCompletion === undefined) throw new TypeError("Missing iterator close completion.");
      await closeLoopIterator(saved.closeCompletion);
      return saved.closeCompletion;
    }
    const nodeId = node.nodeId ?? -1;
    for (let skipped = 0; saved === undefined && skipped < index; skipped += 1) {
      const skippedIteration = await nextIteration();
      if (typeof skippedIteration !== "object" || skippedIteration === null) {
        throw new TypeError("Iterator result must be an object.");
      }
      if ((await readIteratorResult(iterator, skippedIteration, "done")).value) {
        return completion?.normal() ?? normalEmptyResult();
      }
    }

    while (true) {
      const resuming = resumeCurrent;
      resumeCurrent = false;
      const iteration = resuming ? { done: false, value: saved!.current } : restoredEntry ?? (await nextIteration());
      restoredEntry = undefined;
      if (typeof iteration !== "object" || iteration === null) {
        throw new TypeError("Iterator result must be an object.");
      }
      if ((await readIteratorResult(iterator, iteration, "done")).value) {
        context.activeLoopIterations.delete(nodeId);
        return completion?.normal() ?? normalEmptyResult();
      }

      const nextValue = (await readIteratorResult(iterator, iteration, "value")).value;
      context.activeLoopIterations.set(
        nodeId,
        iterator.snapshotIndex === undefined
          ? index
          : {
              get index() {
                return iterator.snapshotIndex!();
              },
              values: [value, nextValue]
            }
      );
      const scope = resuming ? saved!.scope : context.scope.child();
      const phaseContext = (phase: "left" | "body"): EvaluationContext => ({ ...context,
        ...(context.generatorYield === undefined || node.nodeId === undefined ? {} : {
          generatorExpressionStates: new Map([...(context.generatorExpressionStates ?? []),
            [node.nodeId, { kind: "for-of-iterator", phase, async: node.await === true, value, current: nextValue, index, scope, iterator }]])
        }) });
      let binding: BindPatternResult;
      try {
        binding = resuming && saved!.phase === "body" ? { ok: true } : await bindIterationVariable(node.left, nextValue, scope, phaseContext("left"));
      } catch (error) {
        if (isFatalSandboxError(error) || error instanceof HostCallResumabilityError) throw error;
        await closeLoopIterator(createThrowCompletion(error, context.budget, context.callStack));
        throw error;
      }
      if (!binding.ok) {
        await closeLoopIterator(binding.result);
        return binding.result;
      }

      const iterationContext = createLoopIterationContext(phaseContext("body"), scope);
      emitLoopIterationBreakpoint(node, iterationContext);
      const evaluated = await evaluateResourceScope(scope, context.budget, {...createCoercionContext(iterationContext), ...resourceSuspension(iterationContext, node), onSuspend: iterationContext.onSuspend, signal: iterationContext.signal}, () => evaluateNode(node.body, iterationContext));
      const result = completion?.update(evaluated) ?? evaluated;
      if (isMatchingBreak(result, loopLabels(node))) {
        context.activeLoopIterations.delete(nodeId);
        const finished = completion?.normal() ?? normalEmptyResult();
        await closeLoopIterator(finished);
        return finished;
      }
      if (isMatchingContinue(result, loopLabels(node))) {
        index += 1;
        continue;
      }
      if (result.kind !== "normal") {
        context.activeLoopIterations.delete(nodeId);
        await closeLoopIterator(result);
        return result;
      }
      index += 1;
    }
  } finally {
    releaseIterator();
    completion?.close();
  }
}

async function evaluateForInStatement(
  node: ForInStatement,
  context: EvaluationContext
): Promise<EvaluationResult> {
  const restored = context.generatorResume === undefined || node.nodeId === undefined
    ? undefined : context.restoredGeneratorExpressionStates?.get(node.nodeId);
  if (restored !== undefined && restored.kind !== "for-in") throw new TypeError("Invalid for-in continuation.");
  const right = restored === undefined ? await evaluateNode(node.right, context)
    : { kind: "normal" as const, value: restored.object };
  if (right.kind !== "normal") {
    return right;
  }

  const object = forInObject(right.value);
  if (object === undefined) {
    return { kind: "normal", hasValue: context.evalCompletion === true, value: undefined };
  }

  const completion = context.evalCompletion ? new StatementCompletion(context.budget, true) : undefined;
  let keys: string[] = [];
  const release = retainValues(context.budget, () => [right.value, keys]);
  try {
  const restoredIteration = consumeRestoredLoopIteration(node, context);
  keys = restored?.keys ?? (
    restoredIteration === undefined || typeof restoredIteration === "number"
      ? await forInKeys(object, context.budget, createCoercionContext(context))
      : restoredIteration.values.map(String));
  const restoredIndex = restored?.index ?? (
    typeof restoredIteration === "number" ? restoredIteration : (restoredIteration?.index ?? 0));
  for (let index = restoredIndex; index < keys.length; index += 1) {
    context.activeLoopIterations.set(node.nodeId ?? -1, { index, values: keys });
    const key = keys[index]!;
    const resuming = restored !== undefined && index === restored.index;
    if (!resuming && !await hasForInProperty(object, key, context.budget, createCoercionContext(context))) {
      continue;
    }

    const scope = resuming ? restored.scope : context.scope.child();
    const phaseContext = (phase: "left" | "body"): EvaluationContext => ({
      ...context,
      ...(context.generatorYield === undefined || node.nodeId === undefined ? {} : {
        generatorExpressionStates: new Map([...(context.generatorExpressionStates ?? []),
          [node.nodeId, { kind: "for-in", phase, object: right.value, keys, index, scope }]])
      })
    });
    if (!resuming || restored.phase === "left") {
      const binding = await bindIterationVariable(node.left, key, scope, phaseContext("left"));
      if (!binding.ok) {
        context.activeLoopIterations.delete(node.nodeId ?? -1);
        return binding.result;
      }
    }

    const iterationContext = createLoopIterationContext(phaseContext("body"), scope);
    emitLoopIterationBreakpoint(node, iterationContext);
    const evaluated = await evaluateNode(node.body, iterationContext);
    const result = completion?.update(evaluated) ?? evaluated;
    if (isMatchingBreak(result, loopLabels(node))) {
      context.activeLoopIterations.delete(node.nodeId ?? -1);
      return completion?.normal() ?? normalEmptyResult();
    }
    if (isMatchingContinue(result, loopLabels(node))) {
      continue;
    }
    if (result.kind !== "normal") {
      context.activeLoopIterations.delete(node.nodeId ?? -1);
      return result;
    }
  }

  context.activeLoopIterations.delete(node.nodeId ?? -1);
  return completion?.normal() ?? normalEmptyResult();
  } finally {
    release();
    completion?.close();
  }
}

function forInObject(value: SandboxValue): object | undefined {
  if (isSandboxClosure(value)) return value;
  if (value === null || value === undefined) {
    return undefined;
  }
  if (
    typeof value === "string" ||
    Array.isArray(value) ||
    isNumericTypedArray(value) ||
    isPlainForInObject(value)
  ) {
    return Object(value);
  }
  return undefined;
}

async function forInKeys(object: object, budget: Budget, context: SandboxCallContext): Promise<string[]> {
  if (isGuestHostObject(object)) return getHostObjectKeys(object);
  const keys: string[] = [];
  const seen = new Set<string>();
  let depth = 0;
  let current: object | null = object;
  const release = retainValues(budget, () => [object as SandboxValue, current as SandboxValue, keys]);
  try {
  for (; current !== null; current = await sandboxGetPrototypeOf(current as SandboxValue, budget, context) as object | null) {
    if (depth > 0) budget.visitNode();
    assertSandboxDataDepth(depth++);
    if (guestProxyStates.has(current)) {
      for (const key of await sandboxOwnKeys(current as SandboxValue, budget, context)) {
        if (typeof key !== "string" || seen.has(key)) continue;
        seen.add(key);
        keys.push(key);
      }
      continue;
    }
    const properties = isSandboxGenerator(current) ? getGeneratorProperties(current) : isSandboxPromise(current) ? getPromiseProperties(current) : isGuestClosure(current) ? materializeFunctionProperties(current) : isSandboxClosure(current) ? current.properties ?? {} : isSandboxRegex(current) ? getRegexProperties(current) : isSandboxMap(current) || isSandboxSet(current) ? getCollectionProperties(current) : current;
    for (const key of Object.getOwnPropertyNames(properties)) {
      if (seen.has(key)) continue;
      seen.add(key);
      if (Object.getOwnPropertyDescriptor(properties, key)?.enumerable) keys.push(key);
    }
  }
  return keys;
  } finally {
    release();
  }
}

async function hasForInProperty(object: object, key: string, budget: Budget, context: SandboxCallContext): Promise<boolean> {
  if (isGuestHostObject(object)) return hasHostObjectMember(object, key, true);
  let depth = 0;
  let current: object | null = object;
  const release = retainValues(budget, () => [object as SandboxValue, current as SandboxValue, key]);
  try {
  for (; current !== null; current = await sandboxGetPrototypeOf(current as SandboxValue, budget, context) as object | null) {
    if (depth > 0) budget.visitNode();
    assertSandboxDataDepth(depth++);
    if (guestProxyStates.has(current)) {
      const descriptor = await sandboxGetOwnPropertyDescriptor(current as SandboxValue, key, budget, context);
      if (descriptor !== undefined) return descriptor.enumerable === true;
      continue;
    }
    const properties = isSandboxGenerator(current) ? getGeneratorProperties(current) : isSandboxPromise(current) ? getPromiseProperties(current) : isGuestClosure(current) ? materializeFunctionProperties(current) : isSandboxClosure(current) ? current.properties ?? {} : isSandboxRegex(current) ? getRegexProperties(current) : isSandboxMap(current) || isSandboxSet(current) ? getCollectionProperties(current) : current;
    if (Object.hasOwn(properties, key)) return true;
  }
  return false;
  } finally {
    release();
  }
}

function isArrayIndexKey(key: string): boolean {
  const index = Number(key);
  return Number.isInteger(index) && index >= 0 && index < 4_294_967_295 && String(index) === key;
}

function isPlainForInObject(value: unknown): value is Record<string, SandboxValue> {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function normalEmptyResult(): EvaluationResult {
  return { kind: "normal", hasValue: false, value: undefined };
}

async function evaluateForStatement(
  node: ForStatement,
  context: EvaluationContext
): Promise<EvaluationResult> {
  const restored = context.generatorResume === undefined || node.nodeId === undefined
    ? undefined : context.restoredGeneratorExpressionStates?.get(node.nodeId);
  if (restored !== undefined && restored.kind !== "for") throw new TypeError("Invalid for-loop continuation.");
  let resumePhase = restored?.phase;
  const loopScope = restored?.loopScope ?? context.scope.child();
  const loopBindingNames = getForStatementBindingNames(node);
  const loopContext = {
    ...context,
    scope: loopScope
  };
  const phaseContext = (phase: "init" | "test" | "body" | "update" | "dispose", scope: Scope): EvaluationContext => ({
    ...loopContext, scope,
    ...(context.generatorYield === undefined || node.nodeId === undefined ? {} : {
      generatorExpressionStates: new Map([...(context.generatorExpressionStates ?? []),
        [node.nodeId, { kind: "for", phase, loopScope, activeScope: scope }]])
    })
  });
  const completion = context.evalCompletion ? new StatementCompletion(context.budget, true) : undefined;
  const evaluation = evaluateResourceScope(loopScope, context.budget, {...createCoercionContext(loopContext), ...resourceSuspension(phaseContext("dispose", loopScope), node), onSuspend: loopContext.onSuspend, signal: loopContext.signal}, async () => {
  if (node.init !== undefined && (resumePhase === undefined || resumePhase === "init")) {
    const init = await evaluateNode(node.init, phaseContext("init", loopScope));
    if (init.kind !== "normal") {
      return init;
    }
  }

  while (true) {
    context.budget.visitNode();
    context.stats.nodeVisits += 1;

    if (node.test !== undefined && resumePhase !== "body" && resumePhase !== "update") {
      const test = await evaluateNode(node.test, phaseContext("test", loopScope));
      if (test.kind !== "normal") {
        return test;
      }

      if (!isTruthy(test.value)) {
        return completion?.normal() ?? {
          kind: "normal",
          hasValue: false,
          value: undefined
        };
      }
    }

    const iterationScope =
      resumePhase === "body" || resumePhase === "update" ? restored!.activeScope
        : loopBindingNames.length === 0 ? loopScope : loopScope.iterationChild(loopBindingNames);
    if (resumePhase !== "update") {
      const iterationContext = createLoopIterationContext(phaseContext("body", iterationScope), iterationScope);
      emitLoopIterationBreakpoint(node, iterationContext);
      const evaluated = await evaluateNode(node.body, iterationContext);
      const result = completion?.update(evaluated) ?? evaluated;

      if (isMatchingBreak(result, loopLabels(node))) {
        return completion?.normal() ?? {
          kind: "normal",
          hasValue: false,
          value: undefined
        };
      }

      if (result.kind !== "normal" && !isMatchingContinue(result, loopLabels(node))) {
        return result;
      }
    }

    const updateScope =
      resumePhase === "update" ? restored!.activeScope : loopBindingNames.length === 0
        ? iterationScope
        : iterationScope.iterationChild(loopBindingNames);
    const updateContext = phaseContext("update", updateScope);

    if (node.update !== undefined) {
      const update = await evaluateNode(node.update, updateContext);
      if (update.kind !== "normal") {
        return update;
      }
    }

    loopScope.copyInitializedBindingsFrom(updateScope, loopBindingNames);
    resumePhase = undefined;
  }
  });
  if (completion === undefined) return evaluation;
  try { return await evaluation; } finally { completion.close(); }
}

async function evaluateWhileStatement(
  node: WhileStatement,
  context: EvaluationContext
): Promise<EvaluationResult> {
  const completion = context.evalCompletion ? new StatementCompletion(context.budget, true) : undefined;
  try {
  let resumeBody = context.generatorResume !== undefined && context.generatorResume.completed !== true &&
    containsResumeTarget(node.body, new Set([context.generatorResume.yieldNodeId]));
  while (true) {
    if (!resumeBody) {
      const test = await evaluateNode(node.test, context);
      if (test.kind !== "normal") return test;
      if (!isTruthy(test.value)) return completion?.normal() ?? { kind: "normal", hasValue: false, value: undefined };
    }
    resumeBody = false;

    const iterationContext = createLoopIterationContext(context, context.scope);
    emitLoopIterationBreakpoint(node, iterationContext);
    const evaluated = await evaluateNode(node.body, iterationContext);
    const result = completion?.update(evaluated) ?? evaluated;

    if (isMatchingBreak(result, loopLabels(node))) {
      return completion?.normal() ?? {
        kind: "normal",
        hasValue: false,
        value: undefined
      };
    }

    if (isMatchingContinue(result, loopLabels(node))) {
      continue;
    }

    if (result.kind !== "normal") {
      return result;
    }
  }
  } finally {
    completion?.close();
  }
}

async function evaluateDoWhileStatement(
  node: DoWhileStatement,
  context: EvaluationContext
): Promise<EvaluationResult> {
  const completion = context.evalCompletion ? new StatementCompletion(context.budget, true) : undefined;
  try {
  let resumeTest = context.generatorResume !== undefined && context.generatorResume.completed !== true &&
    containsResumeTarget(node.test, new Set([context.generatorResume.yieldNodeId]));
  while (true) {
    if (!resumeTest) {
      const iterationContext = createLoopIterationContext(context, context.scope);
      emitLoopIterationBreakpoint(node, iterationContext);
      const evaluated = await evaluateNode(node.body, iterationContext);
      const result = completion?.update(evaluated) ?? evaluated;

      if (isMatchingBreak(result, loopLabels(node))) {
        return completion?.normal() ?? {
          kind: "normal",
          hasValue: false,
          value: undefined
        };
      }

      if (result.kind !== "normal" && !isMatchingContinue(result, loopLabels(node))) {
        return result;
      }
    }
    resumeTest = false;

    const test = await evaluateNode(node.test, context);
    if (test.kind !== "normal") {
      return test;
    }

    if (!isTruthy(test.value)) {
      return completion?.normal() ?? {
        kind: "normal",
        hasValue: false,
        value: undefined
      };
    }
  }
  } finally {
    completion?.close();
  }
}

function emitLoopIterationBreakpoint(
  node: ForInStatement | ForOfStatement | ForStatement | WhileStatement | DoWhileStatement,
  context: EvaluationContext
): void {
  emitResumeBreakpoint(context, {
    kind: "loop-iteration",
    nodeId: node.nodeId,
    span: node.span
  });
}

function createLoopIterationContext(context: EvaluationContext, scope: Scope): EvaluationContext {
  return {
    ...context,
    scope,
    snapshot: (currentScope: Scope) => {
      const snapshot = currentScope.snapshot();
      if (context.activeLoopIterations.size === 0) return snapshot;
      snapshot.loopIterations = {};
      for (const [nodeId, iteration] of context.activeLoopIterations) {
        if (
          typeof iteration !== "number" &&
          (Array.isArray(iteration.values[0]) || isSandboxMap(iteration.values[0]) || isSandboxSet(iteration.values[0]) || isSandboxCollectionIterator(iteration.values[0]) || isSandboxRegExpIterator(iteration.values[0]))
        ) {
          const bindingName = `#for-of:${nodeId}`;
          snapshot.bindings[bindingName] = iteration.values;
          snapshot.loopIterations[nodeId] = { index: iteration.index, values: [bindingName] };
        } else {
          snapshot.loopIterations[nodeId] = iteration;
        }
      }
      return snapshot;
    }
  };
}

function consumeRestoredLoopIteration(
  node: ForInStatement | ForOfStatement,
  context: EvaluationContext
): LoopIterationSnapshot | undefined {
  const nodeId = node.nodeId ?? -1;
  const iteration = context.restoredLoopIterations.get(nodeId);
  context.restoredLoopIterations.delete(nodeId);
  return iteration;
}

function consumeRestoredLoopIterationIndex(
  node: ForInStatement | ForOfStatement,
  context: EvaluationContext
): number {
  const iteration = consumeRestoredLoopIteration(node, context);
  return typeof iteration === "number" ? iteration : (iteration?.index ?? 0);
}

function isMatchingBreak(result: EvaluationResult, labels: string[] | string | undefined): boolean {
  return (
    result.kind === "break" && (result.label === undefined || hasLoopLabel(labels, result.label))
  );
}

function isMatchingContinue(
  result: EvaluationResult,
  labels: string[] | string | undefined
): boolean {
  return (
    result.kind === "continue" && (result.label === undefined || hasLoopLabel(labels, result.label))
  );
}

function loopLabels(
  node: ForInStatement | ForOfStatement | ForStatement | WhileStatement | DoWhileStatement
): string[] | string | undefined {
  return node.labels ?? node.label;
}

function hasLoopLabel(labels: string[] | string | undefined, target: string): boolean {
  return Array.isArray(labels) ? labels.includes(target) : labels === target;
}

async function bindIterationVariable(
  left: ForOfStatement["left"],
  value: SandboxValue,
  scope: Scope,
  context: EvaluationContext
): Promise<BindPatternResult> {
  if (left.type !== "VariableDeclaration") {
    return bindPattern(left, value, { assign: true }, scope, createPatternContext(context, scope));
  }

  const [declarator] = left.declarations;
  if (left.declarations.length !== 1 || declarator === undefined) {
    throw new TypeError("for...of declarations must include exactly one declarator.");
  }

  if (context.generatorYield !== undefined && left.nodeId !== undefined) {
    context = { ...context, generatorExpressionStates: new Map([...(context.generatorExpressionStates ?? []),
      [left.nodeId, { kind: "declaration", index: 0 }]]) };
  }
  if (left.disposal !== undefined) await registerScopeResource(scope, value, left.disposal, context.budget, createCoercionContext({...context, scope}));
  return bindPattern(declarator.id, value, { kind: left.kind }, scope, createPatternContext(context, scope));
}

async function evaluateExpressionStatement(
  node: ExpressionStatement,
  context: EvaluationContext
): Promise<EvaluationResult> {
  return evaluateNode(node.expression, context);
}

async function evaluateBreakStatement(
  node: BreakStatement,
  _context: EvaluationContext
): Promise<EvaluationResult> {
  return {
    kind: "break",
    hasValue: false,
    ...(node.label === undefined ? {} : { label: node.label }),
    node,
    value: undefined
  };
}

async function evaluateContinueStatement(
  node: ContinueStatement,
  _context: EvaluationContext
): Promise<EvaluationResult> {
  return {
    kind: "continue",
    hasValue: false,
    ...(node.label === undefined ? {} : { label: node.label }),
    node,
    value: undefined
  };
}

async function evaluateReturnStatement(
  node: ReturnStatement,
  context: EvaluationContext
): Promise<EvaluationResult> {
  if (node.argument === undefined) {
    return {
      kind: "return",
      hasValue: false,
      value: undefined
    };
  }

  const argument = context.asyncGeneratorFrame !== undefined && context.generatorResume?.completed !== true && context.generatorResume?.yieldNodeId === node.nodeId
    ? {kind: "normal" as const, hasValue: true, value: undefined}
    : await evaluateNode(node.argument, context);
  if (argument.kind !== "normal") {
    return argument;
  }

  return {
    kind: "return",
    hasValue: argument.hasValue,
    value: context.asyncGeneratorFrame !== undefined
      ? await suspendAsyncFunctionValue(argument.value, node, context, undefined, createCoercionContext(context), "return")
      : context.asyncGenerator ? await suspendJob(awaitSandboxValue(argument.value, context.signal, context.budget, createCoercionContext(context)))
      : argument.value
  };
}

async function evaluateYieldExpression(
  node: YieldExpression,
  context: EvaluationContext
): Promise<EvaluationResult> {
  if (context.generatorYield === undefined) {
    throw new TypeError("yield is only valid inside a generator.");
  }

  if (
    context.generatorResume !== undefined &&
    node.nodeId !== context.generatorResume.yieldNodeId &&
    (node.argument === undefined || !containsResumeTarget(node.argument, new Set([context.generatorResume.yieldNodeId])))
  ) {
    return { kind: "normal", hasValue: true, value: undefined };
  }

  if (node.delegate) {
    return evaluateYieldDelegate(node, context);
  }

  const argument =
    (context.generatorResume !== undefined && node.nodeId === context.generatorResume.yieldNodeId) || node.argument === undefined
      ? { kind: "normal" as const, hasValue: true, value: undefined }
      : await evaluateNode(node.argument, context);
  if (argument.kind !== "normal") {
    return argument;
  }

  if (context.generatorResume?.completed === true) context.generatorResume = undefined;
  const completion = await yieldGeneratorValue(argument.value, node, context);
  if (context.generatorResume !== undefined) context.generatorResume.completed = true;
  context.generatorResume = undefined;
  return generatorCompletionResult(completion);
}

async function yieldGeneratorValue(value: SandboxValue, node: YieldExpression, context: EvaluationContext): Promise<GeneratorCompletion> {
  const frame = context.asyncGeneratorFrame;
  const origin = frame === undefined ? undefined : getGeneratorOrigin(frame);
  const resuming = context.generatorResume?.completed !== true && context.generatorResume?.yieldNodeId === node.nodeId;
  if (frame !== undefined && resuming && origin?.awaitPhase === "resume-return") {
    try {
      return {type: "return", value: await suspendAsyncFunctionValue(undefined, node, context, undefined, createCoercionContext(context), "resume-return")};
    } catch (error) {return {type: "throw", value: error};}
  }
  if (frame !== undefined && !node.delegate && (!resuming || origin?.awaitPhase === "yield"))
    value = await suspendAsyncFunctionValue(value, node, context, undefined, createCoercionContext(context), "yield");
  else if (frame === undefined && context.asyncGenerator && !node.delegate)
    value = await suspendJob(awaitSandboxValue(value, context.signal, context.budget, createCoercionContext(context)));
  if (frame !== undefined) {
    const driver = asyncGeneratorDrivers.get(frame);
    if (driver === undefined) throw new TypeError("Missing async generator yield owner.");
    driver.suspension = "yield";
  }
  context.captureGeneratorScope?.(context.scope, context.generatorBlockScopes, context.finallyCompletions, context.generatorExpressionStates);
  const completionPromise = context.generatorYield!(allocateProducedSandboxValue(value, context.budget), node.nodeId);
  emitResumeBreakpoint(context, {
    kind: "generator-yield",
    nodeId: node.nodeId,
    span: node.span
  });
  const completion = await (context.asyncGenerator && frame === undefined ? suspendJob(completionPromise) : completionPromise);
  if (context.asyncGenerator && completion.type === "return") {
    try {
      return { type: "return", value: frame === undefined
        ? await suspendJob(awaitSandboxValue(completion.value as SandboxValue, context.signal, context.budget, createCoercionContext(context)))
        : await suspendAsyncFunctionValue(completion.value as SandboxValue, node, context, undefined, createCoercionContext(context), "resume-return") };
    } catch (error) {
      return { type: "throw", value: error };
    }
  }
  return completion;
}

async function evaluateYieldDelegate(
  node: YieldExpression,
  context: EvaluationContext
): Promise<EvaluationResult> {
  const saved = context.generatorResume === undefined || node.nodeId === undefined
    ? undefined : context.restoredGeneratorExpressionStates?.get(node.nodeId);
  if (saved !== undefined && saved.kind !== "yield-delegate") throw new TypeError("Invalid delegated yield continuation.");
  const argument = saved === undefined ? await evaluateNode(node.argument!, context)
    : { kind: "normal" as const, hasValue: true as const, value: saved.value };
  if (argument.kind !== "normal") {
    return argument;
  }
  if (context.generatorResume?.completed === true) context.generatorResume = undefined;
  const iterator = saved === undefined ? await acquireSandboxIterator(
    argument.value,
    context.budget,
    createCoercionContext(context),
    context.asyncGenerator,
    context.signal
  ) : "kind" in saved.iterator
    ? await restoreSandboxIterator(saved.iterator, context.budget, createCoercionContext(context), context.signal)
    : saved.iterator;
  if (iterator === undefined) {
    throw new TypeError(`${String(argument.value)} is not a supported iterable`);
  }

  const state: Extract<GeneratorExpressionState, { kind: "yield-delegate" }> = {
    kind: "yield-delegate", async: context.asyncGenerator === true,
    value: argument.value, current: saved?.current, iterator,
    ...(saved?.phase === undefined ? {} : {phase: saved.phase, awaitState: saved.awaitState, completion: saved.completion})
  };
  if (node.nodeId !== undefined) context = { ...context,
    generatorExpressionStates: new Map([...(context.generatorExpressionStates ?? []), [node.nodeId, state]]) };
  if (context.asyncGeneratorFrame !== undefined && iterator.resumeAwait !== undefined)
    iterator.awaitValue = (value, awaitState) => {
      state.awaitState = awaitState;
      return suspendAsyncFunctionValue(value, node, context, undefined, createCoercionContext(context));
    };
  const releaseIterator = retainValues(context.budget, () => [
    argument.value,
    iterator.retainedValue,
    state.current
  ]);
  try {
    let completion: { type: "normal" | "return" | "throw"; value: SandboxValue } = saved?.completion ?? {
      type: "normal",
      value: undefined
    };
    const replay = saved === undefined ? context.generatorResume?.sent ?? [] : [];
    let replayIndex = 0;
    let resumeOperation = saved?.phase !== undefined;
    if (saved !== undefined && !resumeOperation) {
      completion = (await yieldGeneratorValue(saved.current, node, context)) as typeof completion;
      if (context.generatorResume !== undefined) context.generatorResume.completed = true;
      context.generatorResume = undefined;
    }
    while (true) {
      const method = completion.type === "normal" ? "next" : completion.type;
      let result: IteratorResult<SandboxValue>;
      if (resumeOperation) {
        resumeOperation = false;
        if (iterator.resumeAwait === undefined || iterator.awaitValue === undefined || saved?.awaitState === undefined)
          throw new TypeError("Missing delegated iterator await continuation.");
        result = await iterator.resumeAwait(saved.awaitState, () => iterator.awaitValue!(undefined, saved.awaitState!));
        if (saved.phase === "close") throw new TypeError("Delegated iterator does not provide a throw method.");
        context.generatorResume = undefined;
      } else {
        const iteratorMethod = iterator.getOperation === undefined ? iterator[method] : await iterator.getOperation(method);
        if (iteratorMethod === undefined) {
          if (completion.type === "throw") {
            if (iterator.awaitValue !== undefined) {state.phase = "close"; state.completion = completion;}
            await closeIterator(iterator, false, context.asyncGeneratorFrame === undefined ? suspendJob
              : async pending => await suspendAsyncFunctionValue(createSandboxPromise(pending as Promise<SandboxValue>), node, context, undefined, createCoercionContext(context)) as Awaited<typeof pending>);
            throw new TypeError("Delegated iterator does not provide a throw method.");
          }
          return generatorCompletionResult(completion);
        }
        if (iterator.awaitValue !== undefined) {state.phase = "await"; state.completion = completion;}
        const pendingResult = Promise.resolve(iteratorMethod(completion.value));
        result = context.asyncGeneratorFrame !== undefined && iterator.awaitValue === undefined
          ? await suspendAsyncFunctionValue(createSandboxPromise(pendingResult as unknown as Promise<SandboxValue>), node, context, undefined, createCoercionContext(context)) as unknown as IteratorResult<SandboxValue>
          : await (context.asyncGenerator && iterator.awaitValue === undefined ? suspendJob(pendingResult) : pendingResult);
      }
      delete state.phase;
      delete state.awaitState;
      delete state.completion;
      if ((typeof result !== "object" && typeof result !== "function") || result === null) {
        throw new TypeError("Iterator result must be an object.");
      }
      const done = (await readIteratorResult(iterator, result, "done")).value;
      const value = (await readIteratorResult(iterator, result, "value")).value;
      if (done) {
        if (completion.type === "return") {
          return generatorCompletionResult({ type: "return", value });
        }
        return {
          kind: "normal",
          hasValue: true,
          value
        };
      }
      if (replayIndex < replay.length - 1) {
        completion = replay[replayIndex + 1] as typeof completion;
        replayIndex += 1;
        continue;
      }
      state.current = value;
      completion = (await yieldGeneratorValue(value, node, context)) as typeof completion;
      context.generatorResume = undefined;
    }
  } finally {
    delete iterator.awaitValue;
    releaseIterator();
  }
}

function generatorCompletionResult(completion: {
  type: "normal" | "return" | "throw";
  value: unknown;
}): EvaluationResult {
  if (completion.type === "throw") {
    return { kind: "throw", hasValue: true, value: completion.value as SandboxValue };
  }
  if (completion.type === "return") {
    return { kind: "return", hasValue: true, value: completion.value as SandboxValue };
  }
  return { kind: "normal", hasValue: true, value: completion.value as SandboxValue };
}

async function evaluateThrowStatement(
  node: ThrowStatement,
  context: EvaluationContext
): Promise<EvaluationResult> {
  return evaluateThrowStatementResult(node, context, evaluateNode);
}

async function evaluateTryStatement(
  node: TryStatement,
  context: EvaluationContext
): Promise<EvaluationResult> {
  const evaluation = evaluateTryStatementResult(node, {
    ...context,
    instantiateBlock: (block: BlockStatement, scope: Scope) => predeclareStatementListBindings(block.body, {...context, scope}),
    toPropertyKey: (value: SandboxValue) => toPropertyKey(value, context.budget, createCoercionContext(context)),
    getProperty: (value: SandboxValue, key: PropertyKey) => getPropertyValue(value, key, context)
  }, evaluateNode);
  if (!context.evalCompletion) return evaluation;
  const result = await evaluation;
  return context.evalCompletion && result.kind !== "error" && !result.hasValue
    ? {...result, hasValue: true, value: undefined} : result;
}

async function evaluateUnaryExpression(
  node: UnaryExpression,
  context: EvaluationContext
): Promise<EvaluationResult> {
  if (node.operator === "delete") {
    return evaluateDeleteExpression(node, context);
  }

  if (
    node.operator === "typeof" &&
    node.argument.type === "Identifier"
  ) {
    const reference = await context.scope.resolveBinding(node.argument.name, bindingOperations(context));
    if (reference.kind === "unresolvable") return {kind: "normal", hasValue: true, value: "undefined"};
    context.budget.visitNode();
    context.stats.nodeVisits += 1;
    const value = await getReferenceValue(reference, context);
    reconcileDataBudget(context.budget, context.stats, context.scope, value, context.compilation, context.compilation?.parent);
    return {
      kind: "normal",
      hasValue: true,
      value: await applyUnaryOperator("typeof", value, context)
    };
  }

  const argument = await evaluateNode(node.argument, context);
  if (argument.kind !== "normal") {
    return argument;
  }

  if (node.operator === "void") {
    return {
      kind: "normal",
      hasValue: true,
      value: undefined
    };
  }

  return {
    kind: "normal",
    hasValue: true,
    value: await applyUnaryOperator(node.operator, argument.value, context)
  };
}

async function evaluateDeleteExpression(
  node: UnaryExpression,
  context: EvaluationContext
): Promise<EvaluationResult> {
  if (node.argument.type === "Identifier" && context.strict === false) {
    const reference = await context.scope.resolveBinding(node.argument.name, bindingOperations(context));
    return {kind: "normal", hasValue: true, value: reference.kind === "unresolvable" ? true
      : reference.kind === "binding" ? reference.scope.deleteBinding(reference.name)
      : guestProxyStates.has(reference.object)
        ? await sandboxDeleteProperty(reference.object, reference.name, context.budget, createCoercionContext(context))
        : deleteSandboxProperty(reference.object, reference.name, false)};
  }
  if (node.argument.type !== "MemberExpression") {
    if (node.argument.type !== "Identifier") {
      const argument = await evaluateNode(node.argument, context);
      return argument.kind === "normal" ? {kind: "normal", hasValue: true, value: true} : argument;
    }
    throw createError(
      "UNSUPPORTED_NODE",
      node,
      "Unary operator 'delete' requires a member target."
    );
  }

  return evaluateMemberAccess(node.argument, context, async member => {
    if (member.kind === "resolved" && member.superReceiver !== undefined)
      throw new ReferenceError("Cannot delete a super property.");
    if (member.kind === "nullish" || member.object === null || member.object === undefined) {
      if (member.kind === "nullish") {
        return {
          kind: "normal",
          hasValue: true,
          value: true
        };
      }

      throw new TypeError("Cannot delete properties of null or undefined.");
    }

    if (typeof member.object === "object" && !isIndexableSandboxValue(member.object) && !isSandboxPromise(member.object) && !isSandboxRegex(member.object) && !isSandboxMap(member.object) && !isSandboxSet(member.object)) {
      throw new TypeError("Unary operator 'delete' requires a sandbox object property.");
    }

    const property = await toPropertyKey(member.property, context.budget, createCoercionContext(context));
    const deleted = typeof member.object === "object" && guestProxyStates.has(member.object)
      ? await sandboxDeleteProperty(member.object, property, context.budget, createCoercionContext(context))
      : deleteSandboxProperty(member.object, property, context.strict !== false);
    if (!deleted && context.strict !== false) throw new TypeError("Cannot delete property.");

    return {
      kind: "normal",
      hasValue: true,
      value: deleted
    };
  });
}

async function evaluateUpdateExpression(
  node: UpdateExpression,
  context: EvaluationContext
): Promise<EvaluationResult> {
  if (node.argument.type === "Identifier") {
    return evaluateIdentifierUpdateExpression(node, context);
  }

  return evaluateMemberUpdateExpression(node, context);
}

async function evaluateIdentifierUpdateExpression(
  node: UpdateExpression,
  context: EvaluationContext
): Promise<EvaluationResult> {
  if (node.argument.type !== "Identifier") {
    throw new TypeError("Expected identifier update target.");
  }

  const reference = await context.scope.resolveBinding(node.argument.name, bindingOperations(context));
  if (reference.kind === "unresolvable") {
    return {
      kind: "error",
      error: createError(
        "UNBOUND_IDENTIFIER",
        node.argument,
        `Identifier '${node.argument.name}' is not defined.`
      )
    };
  }

  const primitive = await toNumericPrimitive(await getReferenceValue(reference, context), context);
  const current = typeof primitive === "bigint" ? primitive : toNumber(primitive);
  const next = typeof current === "bigint"
    ? bigIntOperation(node.operator === "++" ? "+" : "-", current, 1n, context.budget)
    : node.operator === "++" ? current + 1 : current - 1;
  if (reference.kind === "object") {
    await setSandboxProperty(reference.object, reference.name, next, context.budget, true, createCoercionContext(context), context.strict !== false);
  } else {
    reference.scope.assignOwnBinding(reference.name, next, context.strict !== false);
  }

  return {
    kind: "normal",
    hasValue: true,
    value: node.prefix ? next : current
  };
}

async function evaluateMemberUpdateExpression(
  node: UpdateExpression,
  context: EvaluationContext
): Promise<EvaluationResult> {
  if (node.argument.type !== "MemberExpression") {
    throw new TypeError("Expected member update target.");
  }

  return evaluateMemberAccess(node.argument, context, async member => {
    if (member.kind === "nullish" || member.object === null || member.object === undefined) {
      throw new TypeError("Cannot update properties of null or undefined.");
    }
    const property = member.privateName === undefined ? await toPropertyKey(member.property, context.budget, createCoercionContext(context)) : undefined;
    const primitive = await toNumericPrimitive(member.privateName !== undefined ? await readPrivateValue(member.object, member.privateName, context) : await getPropertyValue(member.object, property!, context, member.superReceiver === undefined ? member.object : member.superReceiver.value), context);
    const current = typeof primitive === "bigint" ? primitive : toNumber(primitive);
    const next = typeof current === "bigint"
      ? bigIntOperation(node.operator === "++" ? "+" : "-", current, 1n, context.budget)
      : node.operator === "++" ? current + 1 : current - 1;
    if (member.privateName !== undefined) await writePrivateValue(member.object, member.privateName, next, context);
    else if (member.superReceiver === undefined) await setSandboxProperty(member.object, property!, next, context.budget, true, createCoercionContext(context), context.strict !== false);
    else await setSuperProperty(member.object, member.superReceiver.value, property!, next, context);

    return {
      kind: "normal",
      hasValue: true,
      value: node.prefix ? next : current
    };
  });
}

async function evaluateMemberExpression(
  node: MemberExpression,
  context: EvaluationContext
): Promise<EvaluationResult> {
  return evaluateMemberAccess(node, context, async (member) => {
    if (member.kind === "nullish" || member.object === null || member.object === undefined) {
      if (member.kind === "nullish") return { kind: "normal", hasValue: true, value: undefined };
      throw new TypeError("Cannot read properties of null or undefined.");
    }
    return {
      kind: "normal",
      hasValue: true,
      value: member.privateName !== undefined ? await readPrivateValue(member.object, member.privateName, context) : await getPropertyValue(
        member.object,
        await toPropertyKey(member.property, context.budget, createCoercionContext(context)),
        context,
        member.superReceiver === undefined ? member.object : member.superReceiver.value
      )
    };
  });
}

async function readPrivateValue(receiver: SandboxValue, name: PrivateName, context: EvaluationContext): Promise<SandboxValue> {
  const element = findPrivateElement(receiver, name);
  if (element === undefined) throw new TypeError(`Receiver does not declare #${name.description}.`);
  if (element.kind !== "accessor") return element.value;
  if (element.get === undefined) throw new TypeError(`Private accessor #${name.description} has no getter.`);
  return invokeBuiltinClosure(element.get, [], context.budget, createCoercionContext(context), receiver);
}

async function writePrivateValue(receiver: SandboxValue, name: PrivateName, value: SandboxValue, context: EvaluationContext): Promise<void> {
  const element = findPrivateElement(receiver, name);
  if (element === undefined) throw new TypeError(`Receiver does not declare #${name.description}.`);
  if (element.kind === "field") { element.value = value; return; }
  if (element.kind === "method" || element.set === undefined) throw new TypeError(`Private element #${name.description} is not writable.`);
  await invokeBuiltinClosure(element.set, [value], context.budget, createCoercionContext(context), receiver);
}

function getPropertyValue(
  target: InterpreterValue,
  property: PropertyKey,
  context: EvaluationContext,
  receiver: SandboxValue = target
): SandboxValue | Promise<SandboxValue> {
  if (isGuestHostObject(target)) return typeof property === "symbol" ? undefined : getHostObjectMember(target, String(property));
  let proxyBoundary: object | undefined;
  const descriptor = getSandboxPropertyDescriptor(target, property, context.budget, proxy => { proxyBoundary = proxy; });
  if (proxyBoundary !== undefined)
    return sandboxGetProperty(proxyBoundary as SandboxValue, property, receiver, context.budget, createCoercionContext(context));
  if (descriptor !== undefined)
    return readPropertyDescriptor(descriptor, receiver, createCoercionContext(context), true);
  if (isSandboxRegExpIterator(target)) return hasExplicitSandboxPrototype(target) ? undefined : getRegExpIteratorMember(property, context.budget);
  if (typeof target === "symbol" || typeof target === "bigint") {
    const prototype = getBoxedPrototype(target, context.budget);
    return prototype === undefined ? undefined : getPropertyValue(prototype, property, context, receiver);
  }
  if (typeof target === "string" || typeof target === "number" || typeof target === "boolean") {
    const prototype = getBoxedPrototype(target, context.budget);
    if (prototype !== undefined) {
      if (
        typeof target === "string" &&
        typeof property !== "symbol" &&
        (property === "length" || getStringIndex(property) !== undefined)
      )
        return getStringMember(target, property, context.budget);
      return getPropertyValue(prototype, property, context, receiver);
    }
  }
  if (typeof property === "symbol") return undefined;
  if (typeof target === "string") return getStringMember(target, property, context.budget);
  if (typeof target === "number") return getNumberMember(property, context.budget);
  if (typeof target === "boolean") return undefined;
  if (isNumericTypedArray(target)) return getTypedArrayMember(target, property, context.budget);
  if (isSandboxDate(target)) return undefined;
  if (isSandboxMap(target)) return getSandboxPrototype(target, context.budget) === null
    ? getMapMember(target, property, createMapMethodOptions(context)) : undefined;
  if (isSandboxSet(target)) return getSandboxPrototype(target, context.budget) === null
    ? getSetMember(target, property, createSetMethodOptions(context)) : undefined;
  if (isSandboxCollectionIterator(target))
    return hasExplicitSandboxPrototype(target) ? undefined : getCollectionIteratorMember(target, property, context.budget);
  if (isSandboxGenerator(target)) return hasExplicitSandboxPrototype(target)
    ? undefined : getGeneratorMember(target, property, context.budget);
  if (isSandboxClosure(target)) return getClosureMemberValue(target, property, context);
  if (isSandboxPromise(target)) return hasExplicitSandboxPrototype(target)
    ? undefined : getPromiseMember(property, context.budget);
  if (isSandboxRegex(target)) return hasExplicitSandboxPrototype(target) || getSandboxPrototype(target, context.budget) !== null
    ? undefined : getRegexMember(target, property, context.budget, createCoercionContext(context));
  if (!isIndexableSandboxValue(target)) {
    throw new TypeError("Attempted to read a property from a non-object value.");
  }
  return getMemberValue(target, property, context);
}

export function createPatternContext(
  context: AsyncEvaluationContext,
  scope = context.scope,
  evaluate = evaluateNode
): PatternContext {
  const evaluationContext = { ...context, scope };
  return {
    strict: context.strict !== false,
    bindingOperations: bindingOperations(evaluationContext),
    unresolvableAssignmentTarget: context.strict === false
      ? resolveIntrinsicIdentity(context.budget, '["globalThis"]') as SandboxObject : undefined,
    restoredPatternState: id => context.generatorResume === undefined ? undefined : context.restoredGeneratorExpressionStates?.get(id),
    withPatternState: (id, state) => context.generatorYield === undefined ? createPatternContext(context, scope, evaluate)
      : createPatternContext({ ...context, generatorExpressionStates: new Map([...(context.generatorExpressionStates ?? []), [id, state]]) }, scope, evaluate),
    prepareMemberReference: async pattern => {
      let reference: import("./patterns.js").AssignmentReference | undefined;
      const result = await evaluateMemberAccess(pattern, evaluationContext, async member => {
        if (member.kind === "nullish") throw new TypeError("Cannot assign properties of null or undefined.");
        reference = member.privateName === undefined
          ? { object: member.object, key: await toPropertyKey(member.property, context.budget, createCoercionContext(evaluationContext)) }
          : { object: member.object, key: member.privateName.description, privateName: member.privateName.description };
        return normalEmptyResult();
      });
      return result.kind === "normal" ? { ok: true, reference: reference! } : { ok: false, result };
    },
    budget: context.budget,
    callContext: createCoercionContext(evaluationContext),
    setPrivateProperty: (receiver, name, value) => writePrivateValue(receiver, scope.resolvePrivateName(name), value, evaluationContext),
    evaluate: (node, inferredName) => evaluate(node, { ...evaluationContext, inferredName }),
    toPropertyKey: (value) =>
      toPropertyKey(value, context.budget, createCoercionContext(evaluationContext)),
    getProperty: (value, key) => getPropertyValue(value, key, evaluationContext),
    setProperty: (target, key, value) =>
      setSandboxProperty(
        target,
        key,
        value,
        context.budget,
        true,
        createCoercionContext(evaluationContext),
        context.strict !== false
      )
  };
}

async function evaluateCallExpression(
  node: CallExpression,
  context: EvaluationContext
): Promise<EvaluationResult> {
  const restored = context.generatorResume === undefined || node.nodeId === undefined
    ? undefined : context.restoredGeneratorExpressionStates?.get(node.nodeId);
  if (restored?.kind === "call") return evaluateResolvedCallExpression(node, restored.callee, context, restored.thisValue);
  if (restored?.kind === "array-call") {
    if (!Array.isArray(restored.target) || !isArrayMethodName(restored.method)) throw new TypeError("Invalid array call continuation.");
    return evaluateArrayMethodCall(node, restored.target, restored.method, context);
  }
  if (node.callee.type === "Super") {
    const construction = context.functionEnvironment?.construction;
    if (construction === undefined)
      throw new ReferenceError("Super constructor binding is unavailable.");
    const args = await evaluateCallArguments(node.arguments, context);
    if (!args.ok) return args.result;
    return { kind: "normal", hasValue: true, value: await construction.superCall(args.value) };
  }
  if (node.callee.type === "MemberExpression") {
    context.budget.visitNode();
    context.stats.nodeVisits += 1;
    return evaluateMemberCallExpression(node, context);
  }

  let receiver: SandboxObject | undefined;
  const callee = await evaluateNode(node.callee, context, reference => {
    if (reference.kind === "object" && reference.withEnvironment) receiver = reference.object;
  });
  if (callee.kind !== "normal") {
    return callee;
  }

  return evaluateResolvedCallExpression(node, callee.value, context, receiver);
}

async function evaluateGuestEval(source: string, context: EvaluationContext, direct: boolean): Promise<SandboxValue> {
  const parent = direct ? context.scope : context.scope.globalScope();
  const parsed = createEvalSource(source, {
    strict: direct && context.strict !== false,
    newTarget: direct && context.functionEnvironment !== undefined,
    superProperty: direct && context.functionEnvironment?.homeObject !== undefined,
    superCall: direct && context.functionEnvironment?.construction?.derived === true,
    arguments: !direct || context.functionEnvironment?.classInitializer !== true,
    privateNames: direct && source.includes("#") ? parent.visiblePrivateNames() : undefined
  }, context.compilation?.owner);
  if (!parsed.strict) {
    const names = new Set<string>();
    const functions = new Set<string>();
    for (const declaration of hoistedVarDeclarations(parsed.node.body)) {
      for (const name of getDeclarationBindingNames(declaration)) names.add(name);
    }
    for (const statement of parsed.node.body) {
      if (statement.type === "FunctionDeclaration" && statement.id !== undefined) {
        names.add(statement.id.name);
        functions.add(statement.id.name);
      }
    }
    const conflict = parent.findEvalVarConflict(names);
    if (conflict !== undefined) throw new SyntaxError(`Cannot redeclare binding '${conflict}' in eval.`);
    parent.validateEvalGlobalDeclarations(names, functions);
  }
  const scope = parent.child({}, {functionBoundary: parsed.strict});
  if (!direct) scope.declare("this", "const", resolveIntrinsicIdentity(context.budget, '["globalThis"]') as SandboxObject);
  const evaluationContext: EvaluationContext = {
    ...context, scope, strict: parsed.strict, functionBody: undefined, evalCompletion: true,
    functionEnvironment: direct ? context.functionEnvironment : undefined
  };
  let value: SandboxValue;
  const release = retainValues(context.budget, () => [...scope.retainedDataRoots(), source, value]);
  try {
    for (const statement of parsed.node.body) hoistVarDeclarations(statement, scope, {deletable: true});
    if (!parsed.strict) prepareLegacyEvalFunctions(parsed.node.body, scope);
    predeclareStatementListBindings(parsed.node.body, evaluationContext, true);
    for (const statement of parsed.node.body) {
      const result = await evaluateNode(statement, evaluationContext);
      if (result.kind === "error") throw result.error;
      if (result.kind === "throw") throw result.value;
      if (result.kind !== "normal") throw new SyntaxError("Invalid eval completion.");
      if (result.hasValue) value = result.value;
    }
    return value;
  } finally {release();}
}

async function evaluateNewExpression(
  node: NewExpression,
  context: EvaluationContext
): Promise<EvaluationResult> {
  const restored = context.generatorResume === undefined || node.nodeId === undefined
    ? undefined : context.restoredGeneratorExpressionStates?.get(node.nodeId);
  const callee = restored?.kind === "new" ? { kind: "normal" as const, value: restored.callee }
    : await evaluateNode(node.callee, context);
  if (callee.kind !== "normal") {
    return callee;
  }

  const name = getConstructorName(node.callee);
  const call = createCallContinuation(node, callee.value, context);
  context = call.context;
  const args = await evaluateCallArguments(node.arguments, context, call.state);
  if (!args.ok) {
    return args.result;
  }
  if (!isSandboxClosure(callee.value) || callee.value.construct === undefined) {
    throw new TypeError(`${name} is not a constructor.`);
  }

  const stack = [...context.callStack, formatStackFrame(node, callee.value.name ?? name)];
  return {
    kind: "normal",
    hasValue: true,
    value: await invokeSandboxClosure(
      callee.value,
      args.value,
      context,
      stack,
      node.span,
      undefined,
      true
    )
  };
}

function getConstructorName(callee: Expression): string {
  if (callee.type === "Identifier") {
    return callee.name;
  }
  if (callee.type === "MemberExpression") {
    if (!callee.computed && callee.property.type === "Identifier") {
      return callee.property.name;
    }
    if (callee.computed && callee.property.type === "StringLiteral") {
      return callee.property.value;
    }
    if (callee.computed && callee.property.type === "NumericLiteral") {
      return String(callee.property.value);
    }
  }
  return "<anonymous>";
}

function formatStackFrame(node: { span: SourceSpan }, name: string | undefined): string {
  return `    at ${name ?? "<anonymous>"} (line ${node.span.start.line}, column ${node.span.start.column})`;
}

function createError(
  code: InterpreterErrorCode,
  node: ParseResult,
  message: string,
  stackFrames: readonly string[] = []
): InterpreterError {
  const name = code === "UNBOUND_IDENTIFIER" ? "ReferenceError" : "Error";
  const stack = [...stackFrames, formatStackFrame(node, undefined)];
  const error = {
    code,
    message,
    name,
    nodeId: node.nodeId,
    nodeType: node.type,
    span: node.span,
    stack: formatErrorStack(name, message, stack)
  };
  if (code === "UNBOUND_IDENTIFIER") referenceErrorDiagnostics.add(error);
  return error;
}

function attachFatalSandboxErrorContext(
  error: SandboxError,
  node: ParseResult,
  stackFrames: readonly string[]
): void {
  attachErrorSpan(error, node.span);
  replaceErrorStack(error, stackFrames);
}

async function evaluateMemberAccess(
  node: MemberExpression,
  context: EvaluationContext,
  consume: (member: MemberReference) => Promise<EvaluationResult>
): Promise<EvaluationResult> {
  const restored = context.generatorResume === undefined || node.nodeId === undefined
    ? undefined : context.restoredGeneratorExpressionStates?.get(node.nodeId);
  if (restored !== undefined && restored.kind !== "member") throw new TypeError("Invalid member continuation.");
  const superReceiver = restored?.kind === "member" && Object.hasOwn(restored, "superReceiver")
    ? { value: restored.superReceiver }
    : node.object.type === "Super" ? { value: context.scope.lookupThis() } : undefined;
  const object = restored?.kind === "member" ? { kind: "normal" as const, value: restored.object }
    : await evaluateNode(node.object, context);
  if (object.kind !== "normal") return object;

  if ((object.value === null || object.value === undefined) && node.optional) {
    return consume({ kind: "nullish" });
  }

  if (node.property.type === "PrivateIdentifier")
    return consume({ kind: "resolved", object: object.value, property: undefined,
      privateName: context.scope.resolvePrivateName(node.property.name) });

  let property: SandboxValue;
  if (node.computed && context.generatorYield !== undefined && node.nodeId !== undefined) {
    const state = { kind: "member" as const, object: object.value,
      ...(superReceiver === undefined ? {} : { superReceiver: superReceiver.value }) };
    context = { ...context, generatorExpressionStates: new Map([...(context.generatorExpressionStates ?? []), [node.nodeId, state]]) };
  }
  const release = retainValues(context.budget, () => [object.value, property]);
  try {
    const result = node.computed
      ? await evaluateNode(node.property, context)
      : { kind: "normal" as const, value: getStaticPropertyName(node.property) };
    if (result.kind !== "normal") return result;
    property = result.value;
    return await consume({ kind: "resolved", object: object.value, property,
      ...(superReceiver === undefined ? {} : { superReceiver }) });
  } finally {
    release();
  }
}

async function evaluateMemberProperty(
  node: MemberExpression["property"],
  context: EvaluationContext
): Promise<HelperResult<PropertyKey>> {
  const property = await evaluateNode(node, context);
  if (property.kind !== "normal") {
    return {
      ok: false,
      result: property
    };
  }

  return {
    ok: true,
    value: await toPropertyKey(property.value, context.budget, createCoercionContext(context))
  };
}

async function evaluateObjectPropertyKey(
  node: Property,
  context: EvaluationContext
): Promise<HelperResult<PropertyKey>> {
  if (!node.computed) {
    return {
      ok: true,
      value: getStaticPropertyName(node.key)
    };
  }

  return evaluateMemberProperty(node.key, context);
}

function getStaticPropertyName(node: MemberExpression["property"]): string | number {
  if (node.type === "BigIntLiteral") return BigInt(node.value).toString();
  if (node.type === "Identifier") {
    return node.name;
  }

  if (node.type === "StringLiteral" || node.type === "NumericLiteral") {
    return node.value;
  }

  throw new TypeError(`Unsupported static property node '${node.type}'.`);
}

async function evaluateMemberCallExpression(
  node: CallExpression,
  context: EvaluationContext
): Promise<EvaluationResult> {
  if (node.callee.type !== "MemberExpression") {
    throw new TypeError("Expected member call expression.");
  }

  return evaluateMemberAccess(node.callee, context, async reference => {
    if (reference.kind === "nullish" || reference.object === null || reference.object === undefined) {
      if (reference.kind === "nullish") {
        return {
          kind: "normal",
          hasValue: true,
          value: undefined
        };
      }

      throw new TypeError("Cannot read properties of null or undefined.");
    }

    if (reference.privateName !== undefined)
      return evaluateResolvedCallExpression(node, await readPrivateValue(reference.object, reference.privateName, context), context, reference.object);
    const member = {
      ...reference,
      property: await toPropertyKey(reference.property, context.budget, createCoercionContext(context))
    };

    if (context.generatorYield !== undefined && node.arguments.some(argument => containsResumeTarget(argument.type === "SpreadElement" ? argument.argument : argument))) {
      if (Array.isArray(member.object) &&
          typeof member.property !== "symbol" && isArrayMethodName(member.property) && isDefaultArrayMethod(member.object, member.property, context.budget))
        return evaluateArrayMethodCall(node, member.object, member.property, context);
      const receiver = member.superReceiver?.value ?? member.object;
      return evaluateResolvedCallExpression(node, await getPropertyValue(member.object, member.property, context, receiver), context, receiver);
    }

    if (member.superReceiver !== undefined)
      return evaluateResolvedCallExpression(node, await getPropertyValue(member.object, member.property, context, member.superReceiver.value), context, member.superReceiver.value);

    if (typeof member.property === "symbol")
      return evaluateResolvedCallExpression(node, await getPropertyValue(member.object, member.property, context), context, member.object);

    if ((isSandboxMap(member.object) || isSandboxSet(member.object)) && getSandboxPrototype(member.object, context.budget) !== null)
      return evaluateResolvedCallExpression(node, await getPropertyValue(member.object, member.property, context), context, member.object);

    if (Array.isArray(member.object) && hasExplicitSandboxPrototype(member.object))
      return evaluateResolvedCallExpression(node, await getPropertyValue(member.object, member.property, context), context, member.object);

    if (Array.isArray(member.object) && isArrayMethodName(member.property) && !isDefaultArrayMethod(member.object, member.property, context.budget))
      return evaluateResolvedCallExpression(node, await getPropertyValue(member.object, member.property, context), context, member.object);

    if ((typeof member.object === "string" || typeof member.object === "number" || typeof member.object === "bigint" || typeof member.object === "boolean" || typeof member.object === "symbol") &&
        getBoxedPrototype(member.object, context.budget) !== undefined) {
      if (isDefaultBoxedMethod(member.object, member.property, context.budget)) {
        if (typeof member.object === "string" && isStringMethodName(member.property))
          return evaluateStringMethodCall(node, member.object, member.property, context);
        if (typeof member.object === "number" && isNumberMethodName(member.property))
          return evaluateNumberMethodCall(node, member.object, member.property, context);
      }
      return evaluateResolvedCallExpression(node, await getPropertyValue(member.object, member.property, context), context, member.object);
    }

    if (typeof member.object === "string" && isStringMethodName(member.property)) {
      return evaluateStringMethodCall(node, member.object, member.property, context);
    }

    if (typeof member.object === "number" && isNumberMethodName(member.property)) {
      return evaluateNumberMethodCall(node, member.object, member.property, context);
    }

    if (
      Array.isArray(member.object) &&
      isArrayMethodName(member.property) &&
      !Object.hasOwn(member.object, member.property)
    ) {
      return evaluateArrayMethodCall(node, member.object, member.property, context);
    }

    if (isSandboxMap(member.object) && isMapMethodName(member.property)) {
      return evaluateMapMethodCall(node, member.object, member.property, context);
    }

    if (isSandboxSet(member.object) && isSetMethodName(member.property)) {
      return evaluateSetMethodCall(node, member.object, member.property, context);
    }

    if (typeof member.object === "string") {
      return evaluatePrimitiveMemberCall(
        node,
        "String",
        member.property,
        getStringMember(member.object, member.property, context.budget),
        context
      );
    }

    if (typeof member.object === "number") {
      return evaluatePrimitiveMemberCall(
        node,
        "Number",
        member.property,
        getNumberMember(member.property, context.budget),
        context
      );
    }

    if (Array.isArray(member.object) && !Object.hasOwn(member.object, member.property)) {
      if (getSandboxPropertyDescriptor(member.object, member.property, context.budget) !== undefined)
        return evaluateResolvedCallExpression(node, await getPropertyValue(member.object, member.property, context), context, member.object);
      return evaluatePrimitiveMemberCall(
        node,
        "Array",
        member.property,
        getArrayMemberValue(member.object, member.property, context),
        context
      );
    }

    if (isSandboxMap(member.object)) {
      return evaluatePrimitiveMemberCall(
        node,
        "Map",
        member.property,
        getMapMember(member.object, member.property, createMapMethodOptions(context)),
        context
      );
    }

    if (isSandboxDate(member.object)) {
      return evaluateResolvedCallExpression(node, await getPropertyValue(member.object, member.property, context), context, member.object);
    }
    if (isNumericTypedArray(member.object)) {
      return evaluateResolvedCallExpression(
        node,
        await getPropertyValue(member.object, member.property, context),
        context,
        member.object
      );
    }

    if (isSandboxSet(member.object)) {
      return evaluatePrimitiveMemberCall(
        node,
        "Set",
        member.property,
        getSetMember(member.object, member.property, createSetMethodOptions(context)),
        context
      );
    }

    if (isSandboxGenerator(member.object)) {
      const memberValue = await getPropertyValue(member.object, member.property, context);
      if (memberValue === undefined) {
        throw new TypeError(`Generator#${String(member.property)} is not a supported method.`);
      }
      return evaluateResolvedCallExpression(node, memberValue, context, member.object);
    }

    if (isSandboxClosure(member.object)) {
      const memberValue = await getPropertyValue(member.object, member.property, context);
      if (memberValue === undefined) {
        throw new TypeError(`Function#${String(member.property)} is not a supported method.`);
      }

      return evaluateResolvedCallExpression(node, memberValue, context, member.object);
    }

    if (isSandboxPromise(member.object)) {
      return evaluateResolvedCallExpression(
        node,
        await getPropertyValue(member.object, member.property, context),
        context,
        member.object
      );
    }

    if (isSandboxRegex(member.object)) {
      return evaluateResolvedCallExpression(
        node,
        await getPropertyValue(member.object, member.property, context),
        context,
        member.object
      );
    }

    if (!isIndexableSandboxValue(member.object)) {
      throw new TypeError("Attempted to read a property from a non-object value.");
    }

    return evaluateResolvedCallExpression(
      node,
      await getPropertyValue(member.object, member.property, context),
      context,
      member.object
    );
  });
}

function evaluatePrimitiveMemberCall(
  node: CallExpression,
  receiverType: "Array" | "Map" | "Number" | "Set" | "String",
  property: string | number,
  value: SandboxValue | undefined,
  context: EvaluationContext
): Promise<EvaluationResult> {
  if (value === undefined) {
    throw new TypeError(`${receiverType}#${String(property)} is not a supported method.`);
  }

  return evaluateResolvedCallExpression(node, value, context);
}

async function evaluateStringMethodCall(
  node: CallExpression,
  target: string,
  methodName: Parameters<typeof validateStringMethodArguments>[0],
  context: EvaluationContext
): Promise<EvaluationResult> {
  validateStringMethodArguments(methodName, node.arguments as Expression[]);

  const args = await evaluateCallArguments(node.arguments, context);
  if (!args.ok) {
    return args.result;
  }

  const leaveCall = context.budget.enterCall();

  try {
    return {
      kind: "normal",
      hasValue: true,
      value: await callStringMethod(
        target,
        methodName,
        args.value,
        context.budget,
        (closure, closureArgs) =>
          invokeSandboxClosure(closure, closureArgs, context, context.callStack),
        context.compilation,
        createCoercionContext(context)
      )
    };
  } catch (error) {
    if (isFatalSandboxError(error)) {
      throw error;
    }

    throw captureException(error, [...context.callStack, formatStackFrame(node, methodName)], true);
  } finally {
    leaveCall();
  }
}

async function evaluateArrayMethodCall(
  node: CallExpression,
  target: SandboxArray,
  methodName: ArrayMethodName,
  context: EvaluationContext
): Promise<EvaluationResult> {
  const restored = context.generatorResume === undefined || node.nodeId === undefined
    ? undefined : context.restoredGeneratorExpressionStates?.get(node.nodeId);
  if (restored !== undefined && (restored.kind !== "array-call" || !Array.isArray(restored.args)))
    throw new TypeError("Invalid array call continuation.");
  const state = { kind: "array-call" as const, target, method: methodName,
    args: restored?.kind === "array-call" ? restored.args as SandboxValue[] : [],
    index: restored?.kind === "array-call" ? restored.index : 0 };
  if (context.generatorYield !== undefined && node.nodeId !== undefined) context = {
    ...context, generatorExpressionStates: new Map([...(context.generatorExpressionStates ?? []), [node.nodeId, state]])
  };
  const args = await evaluateCallArguments(node.arguments, context, state);
  if (!args.ok) {
    return args.result;
  }

  const leaveCall = context.budget.enterCall();

  try {
    return {
      kind: "normal",
      hasValue: true,
      value: await callArrayMethod(
        target,
        methodName,
        args.value,
        createArrayMethodOptions(context),
        context.callStack
      )
    };
  } catch (error) {
    if (isFatalSandboxError(error)) {
      throw error;
    }

    throw captureException(error, [...context.callStack, formatStackFrame(node, methodName)], true);
  } finally {
    leaveCall();
  }
}

async function evaluateMapMethodCall(
  node: CallExpression,
  target: SandboxMap,
  methodName: MapMethodName,
  context: EvaluationContext
): Promise<EvaluationResult> {
  const args = await evaluateCallArguments(node.arguments, context);
  if (!args.ok) {
    return args.result;
  }

  const leaveCall = context.budget.enterCall();
  try {
    return {
      kind: "normal",
      hasValue: true,
      value: await callMapMethod(
        target,
        methodName,
        args.value,
        createMapMethodOptions(context),
        context.callStack
      )
    };
  } catch (error) {
    if (isFatalSandboxError(error)) {
      throw error;
    }
    throw captureException(error, [...context.callStack, formatStackFrame(node, methodName)], true);
  } finally {
    leaveCall();
  }
}

async function evaluateSetMethodCall(
  node: CallExpression,
  target: SandboxSet,
  methodName: SetMethodName,
  context: EvaluationContext
): Promise<EvaluationResult> {
  const args = await evaluateCallArguments(node.arguments, context);
  if (!args.ok) {
    return args.result;
  }

  const leaveCall = context.budget.enterCall();
  try {
    return {
      kind: "normal",
      hasValue: true,
      value: await callSetMethod(
        target,
        methodName,
        args.value,
        createSetMethodOptions(context),
        context.callStack
      )
    };
  } catch (error) {
    if (isFatalSandboxError(error)) {
      throw error;
    }
    throw captureException(error, [...context.callStack, formatStackFrame(node, methodName)], true);
  } finally {
    leaveCall();
  }
}

async function applyUnaryOperator(
  operator: UnaryExpression["operator"],
  value: InterpreterValue,
  context: EvaluationContext
): Promise<InterpreterValue> {
  switch (operator) {
    case "!":
      return !value;
    case "delete":
      return true;
    case "typeof":
      return describeTypeofValue(value);
    case "void":
      return undefined;
    case "+":
      return toNumber(await toNumericPrimitive(value, context));
    case "-": {
      const primitive = await toNumericPrimitive(value, context);
      return typeof primitive === "bigint" ? bigIntOperation("-", 0n, primitive, context.budget) : -toNumber(primitive);
    }
    case "~": {
      const primitive = await toNumericPrimitive(value, context);
      return typeof primitive === "bigint" ? bigIntOperation("^", primitive, -1n, context.budget) : ~toNumber(primitive);
    }
  }
}

function describeTypeofValue(value: InterpreterValue): string {
  if (isSandboxClosure(value)) {
    return "function";
  }

  if (value === null || typeof value === "object") {
    return "object";
  }

  return typeof value;
}

function isTruthy(value: InterpreterValue): boolean {
  return Boolean(value);
}

function applyBinaryOperator(
  node: BinaryExpression,
  left: InterpreterValue,
  right: InterpreterValue,
  context: EvaluationContext
): InterpreterValue | Promise<InterpreterValue> {
  if ((typeof left === "bigint" || typeof right === "bigint") &&
      ["-", "*", "/", "%", "**", "&", "|", "^", "<<", ">>", ">>>"].includes(node.operator)) {
    if (typeof left !== "bigint" || typeof right !== "bigint") throw new TypeError("Cannot mix BigInt and other numeric types.");
    return bigIntOperation(node.operator as BigIntOperator, left, right, context.budget);
  }
  switch (node.operator) {
    case "+":
      return applyAdditionOperator(left, right, context);
    case "-":
      return toNumber(left) - toNumber(right);
    case "*":
      return toNumber(left) * toNumber(right);
    case "/":
      return toNumber(left) / toNumber(right);
    case "%":
      return toNumber(left) % toNumber(right);
    case "**":
      return toNumber(left) ** toNumber(right);
    case "<":
      return compareRelational(left, right, "<");
    case "<=":
      return compareRelational(left, right, "<=");
    case ">":
      return compareRelational(left, right, ">");
    case ">=":
      return compareRelational(left, right, ">=");
    case "===":
      return left === right;
    case "!==":
      return left !== right;
    case "==":
      return isLooselyEqual(left, right);
    case "!=":
      return !isLooselyEqual(left, right);
    case "&":
      return toNumber(left) & toNumber(right);
    case "|":
      return toNumber(left) | toNumber(right);
    case "^":
      return toNumber(left) ^ toNumber(right);
    case "<<":
      return toNumber(left) << toNumber(right);
    case ">>":
      return toNumber(left) >> toNumber(right);
    case ">>>":
      return toNumber(left) >>> toNumber(right);
    case "instanceof":
      return evaluateInstanceof(left, right, context.budget, createCoercionContext(context));
    case "in":
      return isGuestHostObject(right)
        ? hasSandboxProperty(right, left as string | symbol, context)
        : sandboxHasProperty(right, left as string | symbol, context.budget, createCoercionContext(context));
  }
}

export function createCoercionContext(context: EvaluationContext): SandboxCallContext {
  return {
    evaluateEval: source => evaluateGuestEval(source, context, false),
    createDynamicFunction: (kind, parameters, body) => compileDynamicFunction(context, evaluateNode, kind, parameters, body),
    stack: context.callStack,
    thisValue: undefined,
    compilation: context.compilation,
    getProperty: (value, property) => getPropertyValue(value, property, context),
    reconcileData: value => reconcileDataBudget(context.budget, context.stats, context.scope, value, context.compilation, context.compilation?.parent),
    invokeClosure: (closure, args, thisValue, construct, newTarget) =>
      invokeSandboxClosure(closure, args, context, context.callStack, undefined, thisValue, construct, newTarget)
  };
}

function hasSandboxProperty(value: SandboxValue, key: PropertyKey, context: EvaluationContext): boolean {
  let current = value;
  let depth = 0;
  while (typeof current === "object" && current !== null) {
    if (isGuestHostObject(current)) return typeof key === "symbol" ? false : hasHostObjectMember(current, String(key));
    if (hasOwnSandboxProperty(current, key, false)) return true;
    if (!isSandboxDate(current) && !isSandboxRegex(current) && !isSandboxMap(current) && !isSandboxSet(current) && !((isGuestClosure(current) || isSandboxGenerator(current) || Array.isArray(current)) && hasExplicitSandboxPrototype(current)) &&
        (Array.isArray(current) || !isPlainSandboxObject(current) ||
        isSandboxDate(current) || isNumericTypedArray(current) || isSandboxGenerator(current) || isSandboxCollectionIterator(current) || isSandboxRegExpIterator(current))) {
      return getPropertyValue(current, key, context) !== undefined;
    }
    current = getSandboxPrototype(current, context.budget) as SandboxValue;
    if (current !== null) {
      context.budget.visitNode();
      assertSandboxDataDepth(++depth);
    }
  }
  return false;
}

async function applyCompoundAssignmentOperator(
  operator: Exclude<AssignmentExpression["operator"], "=" | "&&=" | "||=" | "??=">,
  left: InterpreterValue,
  right: InterpreterValue,
  context: EvaluationContext
): Promise<InterpreterValue> {
  const convertingObject = typeof left === "object" && left !== null;
  let convertedLeft: InterpreterValue;
  const release = retainValues(context.budget, () => [convertedLeft]);
  try {
    left = await toNumericPrimitive(left, context, operator === "+=" ? "default" : "number");
    if (convertingObject) convertedLeft = left;
    right = await toNumericPrimitive(right, context, operator === "+=" ? "default" : "number");
    if (operator !== "+=" && (typeof left === "bigint" || typeof right === "bigint")) {
      if (typeof left !== "bigint" || typeof right !== "bigint") throw new TypeError("Cannot mix BigInt and other numeric types.");
      return bigIntOperation(operator.slice(0, -1) as BigIntOperator, left, right, context.budget);
    }
    switch (operator) {
      case "+=":
        return applyAdditionOperator(left, right, context);
      case "-=":
        return toNumber(left) - toNumber(right);
      case "*=":
        return toNumber(left) * toNumber(right);
      case "/=":
        return toNumber(left) / toNumber(right);
      case "%=":
        return toNumber(left) % toNumber(right);
      case "**=":
        return toNumber(left) ** toNumber(right);
      case "&=":
        return toNumber(left) & toNumber(right);
      case "|=":
        return toNumber(left) | toNumber(right);
      case "^=":
        return toNumber(left) ^ toNumber(right);
      case "<<=":
        return toNumber(left) << toNumber(right);
      case ">>=":
        return toNumber(left) >> toNumber(right);
      case ">>>=":
        return toNumber(left) >>> toNumber(right);
    }
  } finally {
    release();
  }
}

function applyAdditionOperator(
  left: InterpreterValue,
  right: InterpreterValue,
  context: EvaluationContext
): InterpreterValue {
  const leftPrimitive = toPrimitive(left);
  const rightPrimitive = toPrimitive(right);

  if (typeof leftPrimitive === "string" || typeof rightPrimitive === "string") {
    return context.budget.allocateString(toString(leftPrimitive) + toString(rightPrimitive));
  }

  if (typeof leftPrimitive === "bigint" || typeof rightPrimitive === "bigint") {
    if (typeof leftPrimitive !== "bigint" || typeof rightPrimitive !== "bigint") throw new TypeError("Cannot mix BigInt and other numeric types.");
    return bigIntOperation("+", leftPrimitive, rightPrimitive, context.budget);
  }

  return toNumber(leftPrimitive) + toNumber(rightPrimitive);
}

function compareRelational(
  left: InterpreterValue,
  right: InterpreterValue,
  operator: "<" | "<=" | ">" | ">="
): boolean {
  const leftPrimitive = isSandboxDate(left) ? dateTime(left) : toPrimitive(left);
  const rightPrimitive = isSandboxDate(right) ? dateTime(right) : toPrimitive(right);

  if (typeof leftPrimitive === "string" && typeof rightPrimitive === "string") {
    switch (operator) {
      case "<":
        return leftPrimitive < rightPrimitive;
      case "<=":
        return leftPrimitive <= rightPrimitive;
      case ">":
        return leftPrimitive > rightPrimitive;
      case ">=":
        return leftPrimitive >= rightPrimitive;
    }
  }

  const hasBigInt = typeof leftPrimitive === "bigint" || typeof rightPrimitive === "bigint";
  const leftNumber = typeof leftPrimitive === "bigint" || (hasBigInt && typeof leftPrimitive === "string") ? leftPrimitive : toNumber(leftPrimitive);
  const rightNumber = typeof rightPrimitive === "bigint" || (hasBigInt && typeof rightPrimitive === "string") ? rightPrimitive : toNumber(rightPrimitive);

  switch (operator) {
    case "<":
      return leftNumber < rightNumber;
    case "<=":
      return leftNumber <= rightNumber;
    case ">":
      return leftNumber > rightNumber;
    case ">=":
      return leftNumber >= rightNumber;
  }
}

function isLooselyEqual(left: InterpreterValue, right: InterpreterValue): boolean {
  if (typeof left === "bigint" || typeof right === "bigint") return left == right;
  const leftType = getCoercionType(left);
  const rightType = getCoercionType(right);

  if (leftType === rightType) {
    return left === right;
  }

  if ((left === null && right === undefined) || (left === undefined && right === null)) {
    return true;
  }

  if (leftType === "number" && rightType === "string") {
    return isLooselyEqual(left, toNumber(right));
  }

  if (leftType === "string" && rightType === "number") {
    return isLooselyEqual(toNumber(left), right);
  }

  if (leftType === "boolean") {
    return isLooselyEqual(toNumber(left), right);
  }

  if (rightType === "boolean") {
    return isLooselyEqual(left, toNumber(right));
  }

  if (isPrimitiveCoercionType(leftType) && rightType === "object") {
    return isLooselyEqual(left, toPrimitive(right));
  }

  if (leftType === "object" && isPrimitiveCoercionType(rightType)) {
    return isLooselyEqual(toPrimitive(left), right);
  }

  return false;
}

function isPrimitiveCoercionType(type: CoercionType): boolean {
  return type !== "object";
}

type CoercionType = "boolean" | "null" | "number" | "bigint" | "object" | "string" | "symbol" | "undefined";

function getCoercionType(value: InterpreterValue): CoercionType {
  if (typeof value === "bigint") return "bigint";
  if (typeof value === "symbol") return "symbol";
  if (value === null) {
    return "null";
  }

  if (value === undefined) {
    return "undefined";
  }

  if (typeof value === "string") {
    return "string";
  }

  if (typeof value === "number") {
    return "number";
  }

  if (typeof value === "boolean") {
    return "boolean";
  }

  return "object";
}

function toPrimitive(value: InterpreterValue): SandboxPrimitive {
  if (isPrimitiveCoercionType(getCoercionType(value))) {
    return value as SandboxPrimitive;
  }

  return toString(value);
}

async function toNumericPrimitive(
  value: InterpreterValue,
  context: EvaluationContext,
  hint: "number" | "default" = "number"
): Promise<SandboxPrimitive> {
  if (isPrimitiveCoercionType(getCoercionType(value))) {
    return value as SandboxPrimitive;
  }

  if (value !== null && typeof value === "object")
    return objectToPrimitive(value, context.budget, createCoercionContext(context), new Set(), hint);
  throw new TypeError("Expected a sandbox value.");
}

function toNumber(value: InterpreterValue): number {
  if (typeof value === "bigint") throw new TypeError("Cannot convert a BigInt value to a number");
  if (typeof value === "symbol") throw new TypeError("Cannot convert a Symbol value to a number");
  if (isSandboxDate(value)) return dateTime(value);
  if (typeof value === "number") {
    return value;
  }

  if (typeof value === "string") {
    return Number(value);
  }

  if (typeof value === "boolean") {
    return value ? 1 : 0;
  }

  if (value === null) {
    return 0;
  }

  if (value === undefined) {
    return NaN;
  }

  return toNumber(toPrimitive(value));
}

function toString(value: InterpreterValue): string {
  if (typeof value === "symbol") throw new TypeError("Cannot convert a Symbol value to a string");
  if (isSandboxDate(value)) return dateString(value);
  if (Array.isArray(value)) {
    return value
      .map((entry) => (entry === null || entry === undefined ? "" : toString(entry)))
      .join(",");
  }

  if (typeof value === "object" && value !== null) {
    return "[object Object]";
  }

  return String(value);
}

function isIndexableSandboxValue(value: SandboxValue): value is SandboxArray | SandboxObject {
  if (isSandboxDate(value)) return true;
  return Array.isArray(value) || isPlainSandboxObject(value) || isSandboxClosure(value);
}

function appendArrayValues(target: SandboxValue[], values: readonly SandboxValue[]): void {
  for (const value of values) {
    target.push(value);
  }
}

function isPlainSandboxObject(value: SandboxValue): value is SandboxObject {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    !isSandboxClosure(value) &&
    !isSandboxMap(value) &&
    !isSandboxSet(value) &&
    !isSandboxPromise(value) &&
    !isSandboxRegex(value)
  );
}

function getMemberValue(
  target: SandboxArray | SandboxObject,
  property: string | number,
  context: EvaluationContext
): SandboxValue | Promise<SandboxValue> {
  if (isGuestHostObject(target)) return getHostObjectMember(target, String(property));
  let current: SandboxValue = target;
  let depth = 0;
  while (typeof current === "object" && current !== null) {
    if (isSandboxClosure(current)) return getClosureMemberValue(current, property, context);
    if (Array.isArray(current)) return getArrayMemberValue(current, property, context);
    if (!isPlainSandboxObject(current) || isSandboxGenerator(current) || isSandboxCollectionIterator(current) || isSandboxRegExpIterator(current) || isNumericTypedArray(current)) {
      return getPropertyValue(current, property, context);
    }
    if (Object.hasOwn(current, String(property))) return (current as SandboxObject)[String(property)];
    current = getSandboxPrototype(current, context.budget) as SandboxValue;
    if (current !== null) {
      context.budget.visitNode();
      assertSandboxDataDepth(++depth);
    }
  }
  return undefined;
}

function getArrayMemberValue(
  target: SandboxArray,
  property: string | number,
  context: EvaluationContext
): SandboxValue | undefined {
  if (hasExplicitSandboxPrototype(target)) return undefined;
  if (property === "raw" && templateRawArrays.has(target)) {
    return templateRawArrays.get(target);
  }

  if (getSandboxPrototype(target, context.budget) !== null) return undefined;

  return getArrayMember(target, property, createArrayMethodOptions(context));
}

export function setSandboxProperty(
  target: SandboxValue,
  property: PropertyKey,
  value: SandboxValue,
  budget: Budget,
  checkInherited = true,
  context?: SandboxCallContext,
  throwOnFailure = true
): void | Promise<void> {
  if (isGuestHostObject(target)) {
    if (typeof property === "symbol") throw new TypeError("Host properties require string keys.");
    setHostObjectMember(target, String(property), value);
    return;
  }
  const prototypeOwner = target;
  if (isSandboxModuleNamespace(target)) {
    if (!throwOnFailure) return;
    throw new TypeError("Cannot assign to a module namespace.");
  }
  if (checkInherited || (typeof target === "object" && target !== null && guestProxyStates.has(target))) {
    let proxyBoundary: object | undefined;
    const descriptor = getSandboxPropertyDescriptor(target, property, budget, proxy => { proxyBoundary = proxy; });
    if (proxyBoundary !== undefined) {
      return sandboxSetProperty(proxyBoundary as SandboxValue, property, value, target, budget, context).then(success => {
        if (!success && throwOnFailure) throw new TypeError("Proxy refused property assignment.");
      });
    }
    if (descriptor !== undefined) {
      if (!("value" in descriptor)) {
        if (!throwOnFailure && descriptor.set === undefined) return;
        return writePropertyDescriptor(descriptor, target, value, context);
      }
      if (!throwOnFailure && descriptor.writable === false) return;
    }
  }
  if (isSandboxClosure(target)) target = materializeFunctionProperties(target);
  if (isSandboxPromise(target)) target = getPromiseProperties(target);
  if (isSandboxGenerator(target)) target = getGeneratorProperties(target);
  if (isSandboxMap(target) || isSandboxSet(target)) target = getCollectionProperties(target);
  if (isNumericTypedArray(target)) {
    return setTypedArrayMember(target, property, value, budget, context);
  }
  if (isSandboxRegex(target)) {
    setRegexMember(target, property, value, budget);
    return;
  }
  if (!isIndexableSandboxValue(target)) {
    if (!throwOnFailure && target !== null && target !== undefined && typeof target !== "object") return;
    throw new TypeError("Assignment expressions require a sandbox object property.");
  }
  const key = typeof property === "symbol" ? property : String(property);
  if (Array.isArray(target)) {
    assertCollectionMutable(target);
    if (typeof key === "string" && (key === "length" || isArrayIndexKey(key))) {
      if (!throwOnFailure) {
        Reflect.set(target, key, value);
        return;
      }
      (target as unknown as Record<string, SandboxValue>)[key] = value;
      return;
    }
  }

  const descriptor = Object.getOwnPropertyDescriptor(target, key);
  if (descriptor !== undefined) {
    if (descriptor.writable !== true) {
      if (!throwOnFailure) return;
      throw new TypeError(`Cannot assign to read only property '${String(key)}'.`);
    }
    Object.defineProperty(target, key, { value });
  } else {
    if (!throwOnFailure && !Object.isExtensible(target)) return;
    if (checkInherited && typeof prototypeOwner === "object" && prototypeOwner !== null) {
      let depth = 0;
      for (
        let prototype = getSandboxPrototype(prototypeOwner, budget);
        prototype !== null;
        prototype = getSandboxPrototype(prototype, budget)
      ) {
        budget.visitNode();
        assertSandboxDataDepth(depth++);
        if (isSandboxModuleNamespace(prototype)) throw new TypeError("Cannot assign through a module namespace.");
        const properties = isSandboxGenerator(prototype) ? getGeneratorProperties(prototype) : isSandboxClosure(prototype) ? prototype.properties : prototype;
        const inherited =
          properties === undefined ? undefined : Object.getOwnPropertyDescriptor(properties, key);
        if (inherited === undefined) continue;
        if (inherited.writable !== true)
          throw new TypeError(`Cannot assign to read only property '${String(key)}'.`);
        break;
      }
    }
    defineSandboxProperty(target, key, value);
  }
}

function setSuperProperty(
  base: SandboxValue,
  receiver: SandboxValue,
  key: PropertyKey,
  value: SandboxValue,
  context: EvaluationContext
): void | Promise<void> {
  const budget = context.budget;
  if (typeof base !== "object" || base === null)
    throw new TypeError("Cannot assign a property of null.");
  if (typeof receiver === "object" && receiver !== null && guestProxyStates.has(receiver)) {
    return sandboxSetProperty(base, key, value, receiver, budget, createCoercionContext(context)).then(success => {
      if (!success && context.strict !== false) throw new TypeError("Cannot assign a super property.");
    });
  }
  let depth = 0;
  for (
    let current: object | null = base;
    current !== null;
    current = getSandboxPrototype(current, budget)
  ) {
    budget.visitNode();
    assertSandboxDataDepth(depth++);
    if (guestProxyStates.has(current)) {
      return sandboxSetProperty(current as SandboxValue, key, value, receiver, budget, createCoercionContext(context)).then(success => {
        if (!success && context.strict !== false) throw new TypeError("Proxy refused super assignment.");
      });
    }
    if (isSandboxModuleNamespace(current)) throw new TypeError("Cannot assign through a module namespace.");
    const properties = isSandboxGenerator(current) ? getGeneratorProperties(current) : isSandboxClosure(current) ? current.properties : current;
    const descriptor =
      properties === undefined ? undefined : Object.getOwnPropertyDescriptor(properties, key);
    if (descriptor === undefined) continue;
    if (!("value" in descriptor))
      return writePropertyDescriptor(descriptor, receiver, value, createCoercionContext(context));
    if (descriptor.writable !== true)
      throw new TypeError(`Cannot assign to read only property '${String(key)}'.`);
    break;
  }
  if (typeof receiver !== "object" || receiver === null)
    throw new TypeError("Super assignment requires an object receiver.");
  return setSandboxProperty(receiver, key, value, budget, false);
}

export function deleteSandboxProperty(
  target: SandboxValue,
  property: PropertyKey,
  throwOnFailure = true
): boolean {
  if (target !== null && target !== undefined && typeof target !== "object") target = Object(target) as SandboxObject;
  if (isGuestHostObject(target)) return deleteHostObjectMember(target, String(property));
  if (isSandboxClosure(target)) target = materializeFunctionProperties(target);
  if (isSandboxRegex(target)) target = getRegexProperties(target);
  if (isSandboxPromise(target)) target = getPromiseProperties(target);
  if (isSandboxGenerator(target)) target = getGeneratorProperties(target);
  if (isSandboxMap(target) || isSandboxSet(target)) target = getCollectionProperties(target);
  if (Array.isArray(target)) {
    assertCollectionMutable(target);
  }
  if (!throwOnFailure) return Reflect.deleteProperty(target as object, property);
  return delete (target as unknown as Record<PropertyKey, SandboxValue>)[property];
}

function getClosureMemberValue(
  target: SandboxClosure,
  property: string | number,
  context: EvaluationContext
): SandboxValue | undefined {
  return getFunctionMember(target, property, createFunctionMethodOptions(context));
}

async function evaluateResolvedCallExpression(
  node: CallExpression,
  callee: InterpreterValue,
  context: EvaluationContext,
  thisValue: SandboxValue = undefined
): Promise<EvaluationResult> {
  if ((callee === null || callee === undefined) && node.optional) {
    return {
      kind: "normal",
      hasValue: true,
      value: undefined
    };
  }

  const call = createCallContinuation(node, callee, context, thisValue);
  context = call.context;
  const args = await evaluateCallArguments(node.arguments, context, call.state);
  if (!args.ok) {
    return args.result;
  }

  if (!isSandboxClosure(callee)) {
    throw new TypeError("Attempted to call a non-function value.");
  }

  // The syntax and captured callee survive argument suspension; do not resolve
  // the binding again when a saved call resumes.
  const directEval = node.callee.type === "Identifier" && node.callee.name === "eval" &&
    node.optional !== true && getIntrinsicIdentity(callee) === '["eval"]' &&
    callee === resolveIntrinsicIdentity(context.budget, '["eval"]');
  return {
    kind: "normal",
    hasValue: true,
    value: await invokeSandboxClosure(
      callee,
      args.value,
      context,
      [...context.callStack, formatStackFrame(node, callee.name)],
      node.span,
      thisValue,
      false,
      undefined,
      directEval
    )
  };
}

async function evaluateNumberMethodCall(
  node: CallExpression,
  target: number,
  methodName: Parameters<typeof callNumberMethod>[1],
  context: EvaluationContext
): Promise<EvaluationResult> {
  const args = await evaluateCallArguments(node.arguments, context);
  if (!args.ok) {
    return args.result;
  }

  try {
    return {
      kind: "normal",
      hasValue: true,
      value: await callNumberMethod(target, methodName, args.value, context.budget, createCoercionContext(context))
    };
  } catch (error) {
    if (isFatalSandboxError(error)) {
      throw error;
    }

    throw captureException(error, [...context.callStack, formatStackFrame(node, methodName)], true);
  }
}

function createArrayMethodOptions(context: EvaluationContext): ArrayMethodOptions {
  const callContext = createCoercionContext(context);
  return {
    budget: context.budget,
    context: callContext,
    hasProperty: (value, property) => hasSandboxProperty(value, property, context),
    setProperty: (value, property, entry) => setSandboxProperty(value, property, entry, context.budget, true, callContext),
    deleteProperty: deleteSandboxProperty,
    callClosure: (
      closure: Extract<InterpreterValue, { kind: "fn" }>,
      args: readonly SandboxValue[],
      stack: readonly string[],
      thisValue?: SandboxValue
    ) => invokeSandboxClosure(closure, args, context, stack, undefined, thisValue)
  };
}

function createMapMethodOptions(context: EvaluationContext): MapMethodOptions {
  return {
    budget: context.budget,
    callClosure: (closure, args, stack, thisValue) =>
      invokeSandboxClosure(closure, args, context, stack, undefined, thisValue)
  };
}

function createSetMethodOptions(context: EvaluationContext): SetMethodOptions {
  return {
    budget: context.budget,
    callClosure: (closure, args, stack, thisValue) =>
      invokeSandboxClosure(closure, args, context, stack, undefined, thisValue)
  };
}

function createFunctionMethodOptions(context: EvaluationContext): FunctionMethodOptions {
  return {
    budget: context.budget,
    callClosure: (closure, args, stack, thisValue, construct, newTarget) =>
      invokeSandboxClosure(closure, args, context, stack, undefined, thisValue, construct, newTarget)
  };
}

async function invokeSandboxClosure(
  callee: Extract<InterpreterValue, { kind: "fn" }>,
  args: readonly SandboxValue[],
  context: EvaluationContext,
  stack: readonly string[],
  span?: SourceSpan,
  thisValue: SandboxValue = undefined,
  construct = false,
  newTarget?: SandboxClosure,
  directEval = false
): Promise<SandboxValue> {
  const leaveCall = context.budget.enterCall();

  try {
    const invoke = construct ? callee.construct : callee.call;
    if (invoke === undefined) throw new TypeError("Value is not a constructor.");
    const result = Reflect.apply(invoke, undefined, [
      args,
      {
        stack,
        thisValue,
        newTarget: construct ? newTarget ?? callee : undefined,
        evaluateEval: (source: string) => evaluateGuestEval(source, context, directEval),
        createDynamicFunction: (kind: import("../parse/parser.js").DynamicFunctionKind, parameters: string, body: string) =>
          compileDynamicFunction(context, evaluateNode, kind, parameters, body),
        compilation: context.compilation,
        getProperty: (value: SandboxValue, property: string | number) =>
          getPropertyValue(value, property, context),
        reconcileData: (value: SandboxValue) =>
          reconcileDataBudget(context.budget, context.stats, context.scope, value, context.compilation, context.compilation?.parent),
        invokeClosure: (
          closure: SandboxClosure,
          argumentsList: readonly SandboxValue[],
          receiver: SandboxValue,
          asConstructor?: boolean,
          target?: SandboxClosure
        ) => invokeSandboxClosure(closure, argumentsList, context, stack, span, receiver, asConstructor, target),
        ...(span === undefined ? {} : { span })
      }
    ]);

    if (isSandboxPromise(result) && result.synchronousPrefix !== undefined) {
      await result.synchronousPrefix;
    }

    return !construct && callee.async === true
      ? normalizeClosureResult(
          wrapHostResult(result, stack, callee.sandbox === true),
          context.budget
        )
      : await wrapHostResult(result, stack, callee.sandbox === true);
  } catch (error) {
    if (isFatalSandboxError(error)) {
      throw error;
    }

    throw captureException(error, stack, callee.sandbox === true);
  } finally {
    leaveCall();
  }
}

function createCallContinuation(
  node: CallExpression | NewExpression | TaggedTemplateExpression,
  callee: SandboxValue,
  context: EvaluationContext,
  thisValue: SandboxValue = undefined
) {
  const kind: "new" | "call" | "tagged" = node.type === "NewExpression" ? "new" : node.type === "TaggedTemplateExpression" ? "tagged" : "call";
  const restored = context.generatorResume === undefined || node.nodeId === undefined
    ? undefined : context.restoredGeneratorExpressionStates?.get(node.nodeId);
  if (restored !== undefined && ((restored.kind !== "call" && restored.kind !== "new" && restored.kind !== "tagged") || restored.kind !== kind || !Array.isArray(restored.args)))
    throw new TypeError("Invalid call expression continuation.");
  const state = { kind, callee, thisValue,
    args: restored?.kind === "call" || restored?.kind === "new" || restored?.kind === "tagged" ? restored.args as SandboxValue[] : [],
    index: restored?.kind === "call" || restored?.kind === "new" || restored?.kind === "tagged" ? restored.index : 0 };
  return { state, context: context.generatorYield === undefined || node.nodeId === undefined ? context : {
    ...context, generatorExpressionStates: new Map([...(context.generatorExpressionStates ?? []), [node.nodeId, state]])
  } };
}

async function evaluateCallArguments(
  args: CallExpression["arguments"],
  context: EvaluationContext,
  continuation?: { args: SandboxValue[]; index: number }
): Promise<HelperResult<SandboxValue[]>> {
  const values: SandboxValue[] = continuation?.args ?? [];
  const release = retainValues(context.budget, () => values);
  try {
    for (let index = continuation?.index ?? 0; index < args.length; index++) {
      if (continuation !== undefined) continuation.index = index;
      const arg = args[index];
      if (arg.type === "SpreadElement") {
        const spreadValues = await evaluateSpreadElement(arg, context);
        if (!spreadValues.ok) {
          return spreadValues;
        }

        appendArrayValues(values, spreadValues.value);
        context.budget.allocateArrayLength(values.length);
        continue;
      }

      const result = await evaluateNode(arg, context);
      if (result.kind !== "normal") {
        return {
          ok: false,
          result
        };
      }

      values.push(result.value);
      context.budget.allocateArrayLength(values.length);
    }

    return {
      ok: true,
      value: values
    };
  } finally {
    release();
  }
}

async function evaluateSpreadElement(
  node: SpreadElement,
  context: EvaluationContext
): Promise<HelperResult<SandboxValue[]>> {
  const value = await evaluateNode(node.argument, context);
  if (value.kind !== "normal") {
    return {
      ok: false,
      result: value
    };
  }

  const iterator = await acquireSandboxIterator(value.value, context.budget, createCoercionContext(context));
  if (iterator === undefined) {
    throw new TypeError("Spread arguments must evaluate to an iterable.");
  }

  const spreadValues: SandboxValue[] = [];
  const release = retainValues(context.budget, () => [value.value, iterator.retainedValue, ...spreadValues]);
  try {
    while (true) {
      const next = await iterator.next();
      if (typeof next !== "object" || next === null) {
        throw new TypeError("Iterator result must be an object.");
      }

      const done = iterator.readResultProperty === undefined
        ? next.done
        : (await readIteratorResult(iterator, next, "done")).value;
      if (done) {
        break;
      }

      const item = iterator.readResultProperty === undefined
        ? next.value
        : (await readIteratorResult(iterator, next, "value")).value;
      spreadValues.push(item);
      context.budget.allocateArrayLength(spreadValues.length);
    }

    return {
      ok: true,
      value: spreadValues
    };
  } finally {
    release();
  }
}

async function evaluateObjectSpread(
  node: SpreadElement,
  context: EvaluationContext
): Promise<HelperResult<Array<readonly [PropertyKey, SandboxValue]>>> {
  const value = await evaluateNode(node.argument, context);
  if (value.kind !== "normal") {
    return {
      ok: false,
      result: value
    };
  }

  if (value.value === null || value.value === undefined) {
    return {
      ok: true,
      value: []
    };
  }

  if (isGuestHostObject(value.value)) {
    const entries: Array<readonly [string, SandboxValue]> = [];
    for (const key of getHostObjectKeys(value.value)) {
      if (hasHostObjectMember(value.value, key, true))
        entries.push([key, getHostObjectMember(value.value, key)]);
    }
    return { ok: true, value: entries };
  }

  const proxy = typeof value.value === "object" && guestProxyStates.has(value.value);
  const callContext = createCoercionContext(context);
  let keys: PropertyKey[] = [];
  const entries: Array<readonly [PropertyKey, SandboxValue]> = [];
  const release = retainValues(context.budget, () => [value.value, entries, keys]);
  try {
    keys = proxy ? await sandboxOwnKeys(value.value, context.budget, callContext)
      : [...Object.getOwnPropertyNames(reflectionProperties(value.value)), ...ownSandboxSymbolKeys(value.value)];
    context.budget.allocateArrayLength(keys.length);
    for (const key of keys) {
      context.budget.visitNode();
      const enumerable = proxy
        ? (await sandboxGetOwnPropertyDescriptor(value.value, key, context.budget, callContext))?.enumerable
        : hasOwnSandboxProperty(value.value, key, true);
      if (!enumerable) continue;
      entries.push([key, await getPropertyValue(value.value, key, context)]);
    }
    return { ok: true, value: entries };
  } finally {
    release();
  }
}

function defineSandboxProperty(
  target: SandboxArray | SandboxObject,
  key: PropertyKey,
  value: SandboxValue
): void {
  Object.defineProperty(target, key, {
    configurable: true,
    enumerable: true,
    value,
    writable: true
  });
}

function wrapHostResult(
  result: InterpreterValue | Promise<InterpreterValue> | PromiseLike<InterpreterValue>,
  stack: readonly string[],
  sandbox: boolean
): InterpreterValue | Promise<InterpreterValue> {
  if (!isPromiseLikeResult(result)) {
    return result;
  }

  return Promise.resolve(result).then(
    (value) => value,
    (reason) =>
      Promise.reject(
        isInterpreterError(reason) || reason instanceof SandboxError || isCapturedException(reason)
          ? reason
          : createCapturedException(reason, stack, sandbox)
      )
  );
}

function captureException(error: unknown, stack: readonly string[], sandbox: boolean) {
  return isCapturedException(error) ? error : createCapturedException(error, stack, sandbox);
}

function isPromiseLikeResult(
  value: InterpreterValue | Promise<InterpreterValue> | PromiseLike<InterpreterValue>
): value is PromiseLike<InterpreterValue> {
  return typeof value === "object" && value !== null && "then" in value;
}

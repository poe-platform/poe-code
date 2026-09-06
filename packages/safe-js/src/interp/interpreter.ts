import { promiseReplayContext } from "./promise-replay.js";
import { bigIntOperation, type BigIntOperator } from "./bigint-operators.js";
import { accessorAdapter, readPropertyDescriptor, writePropertyDescriptor } from "./accessors.js";
import { deleteHostObjectMember, getHostObjectKeys, getHostObjectMember, hasHostObjectMember, isGuestHostObject, setHostObjectMember } from "./host-capabilities.js";
import { propertyFunctionName, toPropertyKey } from "./property-key.js";
import { assertPromiseExecutionAllowed } from "./promise-tracker.js";
import { SandboxJobQueue, runAsyncPrefix, suspendJob } from "./jobs.js";
import { awaitSandboxValue, withCancellationSignal } from "./cancel.js";
import { retainValues } from "./resources.js";
import { templateObject, templateRawArrays } from "./template-objects.js";
import { evaluateClass } from "./classes.js";
import { defineDataProperty } from "./globals/object-array.js";
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
  createThrowCompletion,
  evaluateThrowStatement as evaluateThrowStatementResult,
  evaluateTryStatement as evaluateTryStatementResult,
  isCapturedException,
  isInterpreterError,
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
import { getBoxedPrototype, getSandboxPropertyDescriptor, getSandboxPrototype, hasExplicitSandboxPrototype, isDefaultBoxedMethod, isGuestClosure, materializeFunctionProperties, setSandboxPrototype } from "./object-model.js";
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
import { getPromiseMember, isSandboxPromiseConstructor } from "./promise.js";
import { acquireSandboxIterator, closeIterator, readIteratorResult, restoreSandboxIterator } from "./iteration.js";
import type { GeneratorExpressionState } from "./generator-expression-state.js";
import { assertCollectionMutable } from "./running-state.js";
import { getGeneratorMember } from "./methods/generator.js";
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
import { isSandboxErrorConstructorInstance } from "./globals/error.js";
import { hasOwnSandboxProperty } from "./globals/object.js";
import { isSandboxMapConstructor, isSandboxSetConstructor } from "./globals/collections.js";
import { collectionIteratorState, isSandboxCollectionIterator } from "./collection-iterator.js";
import { getCollectionIteratorMember } from "./methods/collection-iterator.js";
import { isSandboxRegExpIterator, regexpIteratorState } from "./regexp-iterator.js";
import { getRegExpIteratorMember } from "./methods/regexp-iterator.js";
import {
  getFloat32Member,
  isFloat32ArrayConstructor,
  setFloat32Member
} from "./globals/float32array.js";
import { isFloat32Array } from "./float32.js";
import { dateString, dateTime, isSandboxDate } from "./date.js";
import { getDateMember, getDatePrototype, isDateConstructor } from "./globals/date.js";
import {
  createSandboxRegex,
  allocateProducedSandboxValue,
  ownEnumerableSandboxKeys,
  isSandboxClosure,
  isSandboxGenerator,
  isSandboxMap,
  isSandboxPromise,
  isSandboxRegex,
  getRegexProperties,
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
import { Scope } from "./scope.js";
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
  kind: "resolved"; object: InterpreterValue; property: SandboxValue; superReceiver?: { value: SandboxValue };
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
  LogicalExpression: evaluateLogicalExpression,
  MemberExpression: evaluateMemberExpression,
  MetaProperty: evaluateMetaProperty,
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
    const evaluation = await withCancellationSignal(options.signal, () =>
      options.nested ? runAsyncPrefix(() => evaluateNode(node, context)) : jobs.run(() => evaluateNode(node, context))
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
  context: EvaluationContext
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
    const result = await handler(node as never, evaluationContext);
    reconcileDataBudget(
      context.budget,
      context.stats,
      context.scope,
      "hasValue" in result && result.hasValue ? result.value : undefined,
      compilation,
      context.compilation
    );
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
    [...scope.retainedValues(), transient],
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
        defineDataProperty(object, key.value, {
          [property.kind]: accessorAdapter(value.value, property.kind),
          configurable: true,
          enumerable: true
        }, context.budget);
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
  if (!context.scope.hasOwnBinding(node.id.name)) {
    context.scope.declare(
      node.id.name,
      "const",
      createInterpretedClosure(node, context, evaluateNode)
    );
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
  const binding = node.operator === "=" || restored !== undefined ? undefined : context.scope.lookup(node.left.name);
  if (binding?.found === false) {
    throw new ReferenceError(`Cannot assign to undeclared binding '${node.left.name}'.`);
  }
  const current = restored === undefined ? binding?.value : restored.current;

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
      [node.nodeId, { kind: "identifier-assignment", current }]]) };
  }
  const release = retainValues(context.budget, () => [current]);
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

    context.scope.assign(node.left.name, value);

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
      property = await toPropertyKey(
        member.property,
        context.budget,
        createCoercionContext(context)
      );
      current = await getPropertyValue(
        member.object,
        property,
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
      property ??= await toPropertyKey(
        member.property,
        context.budget,
        createCoercionContext(context)
      );
      if (member.superReceiver === undefined)
        await setSandboxProperty(
          member.object,
          property,
          value,
          context.budget,
          true,
          createCoercionContext(context)
        );
      else
        await setSuperProperty(member.object, member.superReceiver.value, property, value, context);

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
  context: EvaluationContext
): Promise<EvaluationResult> {
  const binding = context.scope.lookup(node.name);

  if (!binding.found) {
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

  return {
    kind: "normal",
    hasValue: true,
    value: binding.value
  };
}

async function evaluateThisExpression(
  _node: ThisExpression,
  context: EvaluationContext
): Promise<EvaluationResult> {
  const binding = context.scope.lookup("this");
  return {
    kind: "normal",
    hasValue: true,
    value: binding.found ? binding.value : undefined
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
    const result = await evaluateNode(statement, blockContext);
    if (result.kind === "break" && result.label !== undefined && node.labels?.includes(result.label))
      return { kind: "normal", hasValue: false, value: undefined };
    if (result.kind !== "normal") {
      return result;
    }
  }

  return {
    kind: "normal",
    hasValue: false,
    value: undefined
  };
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
      if (names.has(name) && !(!exportedFunction && functionBody && scope.getOwnBindingKind(name) === "var")) {
        throw new Error(`Cannot redeclare binding '${name}' in the same scope.`);
      }

      const closure = createInterpretedClosure(statement, exportedFunction ? { ...context, inferredName: name } : context, evaluateNode);
      const ownBindingKind = scope.getOwnBindingKind(name);
      if (ownBindingKind === "var" && !exportedFunction) {
        names.add(name);
        scope.assign(name, closure);
        continue;
      }
      if (ownBindingKind !== undefined) {
        throw new Error(`Cannot redeclare binding '${name}' in the same scope.`);
      }

      names.add(name);
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

  const release = retainValues(context.budget, () => [progress.value]);
  try {
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
      return normalEmptyResult();
    }

    for (let caseIndex = startIndex; caseIndex < node.cases.length; caseIndex += 1) {
      progress.phase = "body";
      progress.index = caseIndex;
      const statements = node.cases[caseIndex]!.consequent;
      for (let statementIndex = saved?.phase === "body" && caseIndex === saved.index ? saved.statementIndex : 0;
        statementIndex < statements.length; statementIndex++) {
        progress.statementIndex = statementIndex;
        const statement = statements[statementIndex]!;
        const result = await evaluateNode(statement, switchContext);
        if (result.kind === "break" && result.label === undefined) {
          return normalEmptyResult();
        }
        if (result.kind !== "normal") {
          return result;
        }
      }
    }

    return normalEmptyResult();
  } finally {
    release();
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
      hasValue: false,
      value: undefined
    };
  }

  return evaluateNode(branch, context);
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
    const result = await evaluateNode(node.body, iterationContext);

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
  let resumeCurrent = saved !== undefined;
  const iterator = saved === undefined
    ? await acquireSandboxIterator(value, context.budget, createCoercionContext(context), node.await, context.signal)
    : "kind" in saved.iterator ? await restoreSandboxIterator(saved.iterator, context.budget, createCoercionContext(context), context.signal) : saved.iterator;
  if (iterator === undefined) {
    throw new TypeError(`${String(value)} is not a supported iterable`);
  }

  const nextIteration = async () => {
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

  const releaseIterator = retainValues(context.budget, () => [value, iterator.retainedValue]);
  try {
    const nodeId = node.nodeId ?? -1;
    let index = saved?.index ?? consumeRestoredLoopIterationIndex(node, context);
    for (let skipped = 0; saved === undefined && skipped < index; skipped += 1) {
      const skippedIteration = await nextIteration();
      if (typeof skippedIteration !== "object" || skippedIteration === null) {
        throw new TypeError("Iterator result must be an object.");
      }
      if ((await readIteratorResult(iterator, skippedIteration, "done")).value) {
        return normalEmptyResult();
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
        return normalEmptyResult();
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
        await closeIterator(iterator, true);
        throw error;
      }
      if (!binding.ok) {
        await closeIterator(iterator, binding.result.kind === "throw");
        return binding.result;
      }

      const iterationContext = createLoopIterationContext(phaseContext("body"), scope);
      emitLoopIterationBreakpoint(node, iterationContext);
      const result = await evaluateNode(node.body, iterationContext);
      if (isMatchingBreak(result, loopLabels(node))) {
        context.activeLoopIterations.delete(nodeId);
        await closeIterator(iterator);
        return normalEmptyResult();
      }
      if (isMatchingContinue(result, loopLabels(node))) {
        index += 1;
        continue;
      }
      if (result.kind !== "normal") {
        context.activeLoopIterations.delete(nodeId);
        await closeIterator(iterator, result.kind === "throw");
        return result;
      }
      index += 1;
    }
  } finally {
    releaseIterator();
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
    return normalEmptyResult();
  }

  const restoredIteration = consumeRestoredLoopIteration(node, context);
  const keys = restored?.keys ?? (
    restoredIteration === undefined || typeof restoredIteration === "number"
      ? forInKeys(object, context.budget)
      : restoredIteration.values.map(String));
  const restoredIndex = restored?.index ?? (
    typeof restoredIteration === "number" ? restoredIteration : (restoredIteration?.index ?? 0));
  for (let index = restoredIndex; index < keys.length; index += 1) {
    context.activeLoopIterations.set(node.nodeId ?? -1, { index, values: keys });
    const key = keys[index]!;
    const resuming = restored !== undefined && index === restored.index;
    if (!resuming && !hasForInProperty(object, key, context.budget)) {
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
    const result = await evaluateNode(node.body, iterationContext);
    if (isMatchingBreak(result, loopLabels(node))) {
      context.activeLoopIterations.delete(node.nodeId ?? -1);
      return normalEmptyResult();
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
  return normalEmptyResult();
}

function forInObject(value: SandboxValue): object | undefined {
  if (isGuestClosure(value)) return value;
  if (value === null || value === undefined || isSandboxClosure(value) || isSandboxPromise(value)) {
    return undefined;
  }
  if (
    typeof value === "string" ||
    Array.isArray(value) ||
    isFloat32Array(value) ||
    isPlainForInObject(value)
  ) {
    return Object(value);
  }
  return undefined;
}

function forInKeys(object: object, budget: Budget): string[] {
  if (isGuestHostObject(object)) return getHostObjectKeys(object);
  const keys: string[] = [];
  const seen = new Set<string>();
  let depth = 0;
  for (let current: object | null = object; current !== null; current = getSandboxPrototype(current, budget)) {
    if (depth > 0) budget.visitNode();
    assertSandboxDataDepth(depth++);
    const properties = isGuestClosure(current) ? materializeFunctionProperties(current) : isSandboxClosure(current) ? current.properties ?? {} : current;
    for (const key of Object.getOwnPropertyNames(properties)) {
      if (seen.has(key)) continue;
      seen.add(key);
      if (Array.isArray(properties) && !isArrayIndexKey(key)) continue;
      if (Object.getOwnPropertyDescriptor(properties, key)?.enumerable) keys.push(key);
    }
  }
  return keys;
}

function hasForInProperty(object: object, key: string, budget: Budget): boolean {
  if (isGuestHostObject(object)) return hasHostObjectMember(object, key, true);
  let depth = 0;
  for (let current: object | null = object; current !== null; current = getSandboxPrototype(current, budget)) {
    if (depth > 0) budget.visitNode();
    assertSandboxDataDepth(depth++);
    const properties = isGuestClosure(current) ? materializeFunctionProperties(current) : isSandboxClosure(current) ? current.properties ?? {} : current;
    if (Object.hasOwn(properties, key)) return true;
  }
  return false;
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
  const phaseContext = (phase: "init" | "test" | "body" | "update", scope: Scope): EvaluationContext => ({
    ...loopContext, scope,
    ...(context.generatorYield === undefined || node.nodeId === undefined ? {} : {
      generatorExpressionStates: new Map([...(context.generatorExpressionStates ?? []),
        [node.nodeId, { kind: "for", phase, loopScope, activeScope: scope }]])
    })
  });

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
        return {
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
      const result = await evaluateNode(node.body, iterationContext);

      if (isMatchingBreak(result, loopLabels(node))) {
        return {
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
}

async function evaluateWhileStatement(
  node: WhileStatement,
  context: EvaluationContext
): Promise<EvaluationResult> {
  let resumeBody = context.generatorResume !== undefined && context.generatorResume.completed !== true &&
    containsResumeTarget(node.body, new Set([context.generatorResume.yieldNodeId]));
  while (true) {
    if (!resumeBody) {
      const test = await evaluateNode(node.test, context);
      if (test.kind !== "normal") return test;
      if (!isTruthy(test.value)) return { kind: "normal", hasValue: false, value: undefined };
    }
    resumeBody = false;

    const iterationContext = createLoopIterationContext(context, context.scope);
    emitLoopIterationBreakpoint(node, iterationContext);
    const result = await evaluateNode(node.body, iterationContext);

    if (isMatchingBreak(result, loopLabels(node))) {
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
      return result;
    }
  }
}

async function evaluateDoWhileStatement(
  node: DoWhileStatement,
  context: EvaluationContext
): Promise<EvaluationResult> {
  let resumeTest = context.generatorResume !== undefined && context.generatorResume.completed !== true &&
    containsResumeTarget(node.test, new Set([context.generatorResume.yieldNodeId]));
  while (true) {
    if (!resumeTest) {
      const iterationContext = createLoopIterationContext(context, context.scope);
      emitLoopIterationBreakpoint(node, iterationContext);
      const result = await evaluateNode(node.body, iterationContext);

      if (isMatchingBreak(result, loopLabels(node))) {
        return {
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
      return {
        kind: "normal",
        hasValue: false,
        value: undefined
      };
    }
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

  const argument = await evaluateNode(node.argument, context);
  if (argument.kind !== "normal") {
    return argument;
  }

  return {
    kind: "return",
    hasValue: argument.hasValue,
    value: context.asyncGenerator
      ? await suspendJob(awaitSandboxValue(argument.value, context.signal, context.budget))
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
  if (context.asyncGenerator && !node.delegate) value = await suspendJob(awaitSandboxValue(value, context.signal, context.budget));
  context.captureGeneratorScope?.(context.scope, context.generatorBlockScopes, context.finallyCompletions, context.generatorExpressionStates);
  const completionPromise = context.generatorYield!(allocateProducedSandboxValue(value, context.budget), node.nodeId);
  emitResumeBreakpoint(context, {
    kind: "generator-yield",
    nodeId: node.nodeId,
    span: node.span
  });
  const completion = await (context.asyncGenerator ? suspendJob(completionPromise) : completionPromise);
  if (context.asyncGenerator && completion.type === "return") {
    try {
      return { type: "return", value: await suspendJob(awaitSandboxValue(completion.value as SandboxValue, context.signal, context.budget)) };
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
    value: argument.value, current: saved?.current, iterator
  };
  if (node.nodeId !== undefined) context = { ...context,
    generatorExpressionStates: new Map([...(context.generatorExpressionStates ?? []), [node.nodeId, state]]) };
  const releaseIterator = retainValues(context.budget, () => [
    argument.value,
    iterator.retainedValue,
    state.current
  ]);
  try {
    let completion: { type: "normal" | "return" | "throw"; value: SandboxValue } = {
      type: "normal",
      value: undefined
    };
    const replay = saved === undefined ? context.generatorResume?.sent ?? [] : [];
    let replayIndex = 0;
    if (saved !== undefined) {
      completion = (await yieldGeneratorValue(saved.current, node, context)) as typeof completion;
      if (context.generatorResume !== undefined) context.generatorResume.completed = true;
      context.generatorResume = undefined;
    }
    while (true) {
      const method = completion.type === "normal" ? "next" : completion.type;
      const iteratorMethod = iterator.getOperation === undefined ? iterator[method] : await iterator.getOperation(method);
      if (iteratorMethod === undefined) {
        if (completion.type === "throw") {
          await closeIterator(iterator);
          throw new TypeError("Delegated iterator does not provide a throw method.");
        }
        return generatorCompletionResult(completion);
      }
      const pendingResult = Promise.resolve(iteratorMethod(completion.value));
      const result = await (context.asyncGenerator ? suspendJob(pendingResult) : pendingResult);
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
  return evaluateTryStatementResult(node, {
    ...context,
    toPropertyKey: (value: SandboxValue) => toPropertyKey(value, context.budget, createCoercionContext(context)),
    getProperty: (value: SandboxValue, key: PropertyKey) => getPropertyValue(value, key, context)
  }, evaluateNode);
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
    node.argument.type === "Identifier" &&
    !context.scope.lookup(node.argument.name).found
  ) {
    return {
      kind: "normal",
      hasValue: true,
      value: "undefined"
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
  if (node.argument.type !== "MemberExpression") {
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

    if (!isIndexableSandboxValue(member.object) && !isSandboxRegex(member.object)) {
      throw new TypeError("Unary operator 'delete' requires a sandbox object property.");
    }

    const property = await toPropertyKey(member.property, context.budget, createCoercionContext(context));
    const deleted = deleteSandboxProperty(member.object, property);

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

  const binding = context.scope.lookup(node.argument.name);
  if (!binding.found) {
    return {
      kind: "error",
      error: createError(
        "UNBOUND_IDENTIFIER",
        node.argument,
        `Identifier '${node.argument.name}' is not defined.`
      )
    };
  }

  const primitive = await toNumericPrimitive(binding.value, context);
  const current = typeof primitive === "bigint" ? primitive : toNumber(primitive);
  const next = typeof current === "bigint"
    ? bigIntOperation(node.operator === "++" ? "+" : "-", current, 1n, context.budget)
    : node.operator === "++" ? current + 1 : current - 1;
  context.scope.assign(node.argument.name, next);

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
    const property = await toPropertyKey(member.property, context.budget, createCoercionContext(context));
    const primitive = await toNumericPrimitive(await getPropertyValue(member.object, property, context, member.superReceiver === undefined ? member.object : member.superReceiver.value), context);
    const current = typeof primitive === "bigint" ? primitive : toNumber(primitive);
    const next = typeof current === "bigint"
      ? bigIntOperation(node.operator === "++" ? "+" : "-", current, 1n, context.budget)
      : node.operator === "++" ? current + 1 : current - 1;
    if (member.superReceiver === undefined) await setSandboxProperty(member.object, property, next, context.budget, true, createCoercionContext(context));
    else await setSuperProperty(member.object, member.superReceiver.value, property, next, context);

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
      value: await getPropertyValue(
        member.object,
        await toPropertyKey(member.property, context.budget, createCoercionContext(context)),
        context,
        member.superReceiver === undefined ? member.object : member.superReceiver.value
      )
    };
  });
}

function getPropertyValue(
  target: InterpreterValue,
  property: PropertyKey,
  context: EvaluationContext,
  receiver: SandboxValue = target
): SandboxValue | Promise<SandboxValue> {
  if (isGuestHostObject(target)) return typeof property === "symbol" ? undefined : getHostObjectMember(target, String(property));
  const descriptor = getSandboxPropertyDescriptor(target, property, context.budget);
  if (descriptor !== undefined)
    return readPropertyDescriptor(descriptor, receiver, createCoercionContext(context), true);
  if (isSandboxRegExpIterator(target)) return getRegExpIteratorMember(property, context.budget);
  if (typeof target === "symbol" || typeof target === "bigint") {
    const prototype = getBoxedPrototype(target, context.budget);
    return prototype === undefined ? undefined : getPropertyValue(prototype, property, context, receiver);
  }
  if (typeof property === "symbol") return isSandboxDate(target)
    ? getDateMember(property, context.budget, context.compilation?.owner)
    : undefined;
  if (typeof target === "string" || typeof target === "number" || typeof target === "boolean") {
    const prototype = getBoxedPrototype(target, context.budget);
    if (prototype !== undefined) {
      if (
        typeof target === "string" &&
        (property === "length" || getStringIndex(property) !== undefined)
      )
        return getStringMember(target, property, context.budget);
      return getPropertyValue(prototype, property, context, receiver);
    }
  }
  if (typeof target === "string") return getStringMember(target, property, context.budget);
  if (typeof target === "number") return getNumberMember(property, context.budget);
  if (typeof target === "boolean") return undefined;
  if (isFloat32Array(target)) return getFloat32Member(target, property, context.budget);
  if (isSandboxDate(target))
    return getDateMember(property, context.budget, context.compilation?.owner);
  if (isSandboxMap(target)) return getMapMember(target, property, createMapMethodOptions(context));
  if (isSandboxSet(target)) return getSetMember(target, property, createSetMethodOptions(context));
  if (isSandboxCollectionIterator(target))
    return getCollectionIteratorMember(target, property, context.budget);
  if (isSandboxGenerator(target)) return getGeneratorMember(target, property, context.budget);
  if (isSandboxClosure(target)) return getClosureMemberValue(target, property, context);
  if (isSandboxPromise(target)) return getPromiseMember(property, context.budget);
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
    restoredPatternState: id => context.generatorResume === undefined ? undefined : context.restoredGeneratorExpressionStates?.get(id),
    withPatternState: (id, state) => context.generatorYield === undefined ? createPatternContext(context, scope, evaluate)
      : createPatternContext({ ...context, generatorExpressionStates: new Map([...(context.generatorExpressionStates ?? []), [id, state]]) }, scope, evaluate),
    prepareMemberReference: async pattern => {
      let reference: import("./patterns.js").AssignmentReference | undefined;
      const result = await evaluateMemberAccess(pattern, evaluationContext, async member => {
        if (member.kind === "nullish") throw new TypeError("Cannot assign properties of null or undefined.");
        reference = { object: member.object, key: await toPropertyKey(member.property, context.budget, createCoercionContext(evaluationContext)) };
        return normalEmptyResult();
      });
      return result.kind === "normal" ? { ok: true, reference: reference! } : { ok: false, result };
    },
    budget: context.budget,
    callContext: createCoercionContext(evaluationContext),
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
        createCoercionContext(evaluationContext)
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

  const callee = await evaluateNode(node.callee, context);
  if (callee.kind !== "normal") {
    return callee;
  }

  return evaluateResolvedCallExpression(node, callee.value, context);
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
  return {
    code,
    message,
    name,
    nodeId: node.nodeId,
    nodeType: node.type,
    span: node.span,
    stack: formatErrorStack(name, message, stack)
  };
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
  const thisBinding = node.object.type === "Super" ? context.scope.lookup("this") : undefined;
  const superReceiver = restored?.kind === "member" && Object.hasOwn(restored, "superReceiver")
    ? { value: restored.superReceiver }
    : thisBinding === undefined ? undefined : { value: thisBinding.found ? thisBinding.value : undefined };
  const object = restored?.kind === "member" ? { kind: "normal" as const, value: restored.object }
    : await evaluateNode(node.object, context);
  if (object.kind !== "normal") return object;

  if ((object.value === null || object.value === undefined) && node.optional) {
    return consume({ kind: "nullish" });
  }

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

    const member = {
      ...reference,
      property: await toPropertyKey(reference.property, context.budget, createCoercionContext(context))
    };

    if (context.generatorYield !== undefined && node.arguments.some(argument => containsResumeTarget(argument.type === "SpreadElement" ? argument.argument : argument))) {
      if (Array.isArray(member.object) && !hasExplicitSandboxPrototype(member.object) &&
          typeof member.property !== "symbol" && isArrayMethodName(member.property) && !Object.hasOwn(member.object, member.property))
        return evaluateArrayMethodCall(node, member.object, member.property, context);
      const receiver = member.superReceiver?.value ?? member.object;
      return evaluateResolvedCallExpression(node, await getPropertyValue(member.object, member.property, context, receiver), context, receiver);
    }

    if (member.superReceiver !== undefined)
      return evaluateResolvedCallExpression(node, await getPropertyValue(member.object, member.property, context, member.superReceiver.value), context, member.superReceiver.value);

    if (typeof member.property === "symbol")
      return evaluateResolvedCallExpression(node, await getPropertyValue(member.object, member.property, context), context, member.object);

    if (Array.isArray(member.object) && hasExplicitSandboxPrototype(member.object))
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
    if (isFloat32Array(member.object)) {
      return evaluateResolvedCallExpression(
        node,
        getFloat32Member(member.object, member.property, context.budget),
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
      const memberValue = getGeneratorMember(member.object, member.property, context.budget);
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
        getPromiseMember(member.property, context.budget),
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
      return evaluateInstanceof(left, right, context);
    case "in":
      return hasSandboxProperty(right, left as string | symbol, context);
  }
}

async function evaluateInstanceof(
  left: SandboxValue,
  right: SandboxValue,
  context: EvaluationContext
): Promise<boolean> {
  while (true) {
    if (right === null || (typeof right !== "object" && typeof right !== "function"))
      throw new TypeError("Right-hand side of 'instanceof' must be an object.");
    const method = await getPropertyValue(right, Symbol.hasInstance, context);
    if (method !== undefined && method !== null) {
      if (!isSandboxClosure(method)) throw new TypeError("Symbol.hasInstance must be callable.");
      return Boolean(await invokeSandboxClosure(method, [left], context, context.callStack, undefined, right));
    }
    if (!isSandboxClosure(right))
      throw new TypeError("Right-hand side of 'instanceof' is not a function.");
    if (right.boundTarget === undefined) break;
    context.budget.visitNode();
    right = right.boundTarget;
  }

  if (isSandboxPromiseConstructor(right)) return isSandboxPromise(left);
  if (isSandboxMapConstructor(right) && isSandboxMap(left)) return true;
  if (isFloat32ArrayConstructor(right)) return isFloat32Array(left);
  if (isDateConstructor(right))
    return isSandboxDate(left) && getDatePrototype(left, context.budget, context.compilation?.owner) !== null;
  if (isSandboxSetConstructor(right) && isSandboxSet(left)) return true;
  if (isSandboxErrorConstructorInstance(left, right)) return true;
  if (isGuestClosure(right)) {
    if (typeof left !== "object" || left === null) return false;
    const prototype = await getPropertyValue(right, "prototype", context);
    if (typeof prototype !== "object" || prototype === null)
      throw new TypeError("Function has a non-object prototype in instanceof check.");
    let depth = 0;
    for (
      let current = getSandboxPrototype(left, context.budget);
      current !== null;
      current = getSandboxPrototype(current, context.budget)
    ) {
      context.budget.visitNode();
      assertSandboxDataDepth(depth++);
      if (current === prototype) return true;
    }
  }
  return false;
}

function createCoercionContext(context: EvaluationContext): SandboxCallContext {
  return {
    stack: context.callStack,
    thisValue: undefined,
    compilation: context.compilation,
    getProperty: (value, property) => getPropertyValue(value, property, context),
    reconcileData: value => reconcileDataBudget(context.budget, context.stats, context.scope, value, context.compilation, context.compilation?.parent),
    invokeClosure: (closure, args, thisValue, construct) =>
      invokeSandboxClosure(closure, args, context, context.callStack, undefined, thisValue, construct)
  };
}

function hasSandboxProperty(value: SandboxValue, key: PropertyKey, context: EvaluationContext): boolean {
  let current = value;
  let depth = 0;
  while (typeof current === "object" && current !== null) {
    if (isGuestHostObject(current)) return typeof key === "symbol" ? false : hasHostObjectMember(current, String(key));
    if (hasOwnSandboxProperty(current, key, false)) return true;
    if (!isSandboxRegex(current) && !((isGuestClosure(current) || Array.isArray(current)) && hasExplicitSandboxPrototype(current)) &&
        (Array.isArray(current) || !isPlainSandboxObject(current) ||
        isSandboxDate(current) || isFloat32Array(current) || isSandboxGenerator(current) || isSandboxCollectionIterator(current) || isSandboxRegExpIterator(current))) {
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
  return Array.isArray(value) || isPlainSandboxObject(value) || isGuestClosure(value);
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
    if (!isPlainSandboxObject(current) || isSandboxGenerator(current) || isSandboxCollectionIterator(current) || isSandboxRegExpIterator(current) || isFloat32Array(current)) {
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

  return getArrayMember(target, property, createArrayMethodOptions(context));
}

export function setSandboxProperty(
  target: SandboxValue,
  property: PropertyKey,
  value: SandboxValue,
  budget: Budget,
  checkInherited = true,
  context?: SandboxCallContext
): void | Promise<void> {
  if (isGuestHostObject(target)) {
    if (typeof property === "symbol") throw new TypeError("Host properties require string keys.");
    setHostObjectMember(target, String(property), value);
    return;
  }
  const prototypeOwner = target;
  if (checkInherited) {
    const descriptor = getSandboxPropertyDescriptor(target, property, budget);
    if (descriptor !== undefined && !("value" in descriptor))
      return writePropertyDescriptor(descriptor, target, value, context);
  }
  if (isGuestClosure(target)) target = materializeFunctionProperties(target);
  if (isFloat32Array(target)) {
    if (typeof property === "symbol") throw new TypeError("Typed array symbol properties are not yet supported.");
    setFloat32Member(target, property, value);
    return;
  }
  if (isSandboxRegex(target)) {
    setRegexMember(target, property, value, budget);
    return;
  }
  if (!isIndexableSandboxValue(target)) {
    throw new TypeError("Assignment expressions require a sandbox object property.");
  }
  const key = typeof property === "symbol" ? property : String(property);
  if (Array.isArray(target)) {
    assertCollectionMutable(target);
    if (typeof key === "string" && (key === "length" || isArrayIndexKey(key))) {
      (target as unknown as Record<string, SandboxValue>)[key] = value;
      return;
    }
  }

  const descriptor = Object.getOwnPropertyDescriptor(target, key);
  if (descriptor !== undefined) {
    if (descriptor.writable !== true) {
      throw new TypeError(`Cannot assign to read only property '${String(key)}'.`);
    }
    Object.defineProperty(target, key, { value });
  } else {
    if (checkInherited && typeof prototypeOwner === "object" && prototypeOwner !== null) {
      let depth = 0;
      for (
        let prototype = getSandboxPrototype(prototypeOwner, budget);
        prototype !== null;
        prototype = getSandboxPrototype(prototype, budget)
      ) {
        budget.visitNode();
        assertSandboxDataDepth(depth++);
        const properties = isSandboxClosure(prototype) ? prototype.properties : prototype;
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
  let depth = 0;
  for (
    let current: object | null = base;
    current !== null;
    current = getSandboxPrototype(current, budget)
  ) {
    budget.visitNode();
    assertSandboxDataDepth(depth++);
    const properties = isSandboxClosure(current) ? current.properties : current;
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

function deleteSandboxProperty(
  target: SandboxValue,
  property: PropertyKey
): boolean {
  if (isGuestHostObject(target)) return deleteHostObjectMember(target, String(property));
  if (isGuestClosure(target)) target = materializeFunctionProperties(target);
  if (isSandboxRegex(target)) target = getRegexProperties(target);
  if (Array.isArray(target)) {
    assertCollectionMutable(target);
  }
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

  return {
    kind: "normal",
    hasValue: true,
    value: await invokeSandboxClosure(
      callee,
      args.value,
      context,
      [...context.callStack, formatStackFrame(node, callee.name)],
      node.span,
      thisValue
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
  return {
    budget: context.budget,
    context: createCoercionContext(context),
    hasProperty: (value, property) => hasSandboxProperty(value, property, context),
    setProperty: (value, property, entry) => setSandboxProperty(value, property, entry, context.budget, true, createCoercionContext(context)),
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
  newTarget?: SandboxClosure
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

  if (
    (isSandboxClosure(value.value) && !isGuestClosure(value.value)) ||
    isSandboxPromise(value.value)
  ) {
    throw new TypeError(
      `Cannot spread ${describeObjectSpreadValue(value.value)} into object literal.`
    );
  }

  const keys = ownEnumerableSandboxKeys(value.value, true);
  context.budget.allocateArrayLength(keys.length);
  const entries: Array<readonly [PropertyKey, SandboxValue]> = [];
  const release = retainValues(context.budget, () => [value.value, entries]);
  try {
    for (const key of keys) {
      if (!hasOwnSandboxProperty(value.value, key, true)) continue;
      entries.push([key, await getPropertyValue(value.value, key, context)]);
    }
    return { ok: true, value: entries };
  } finally {
    release();
  }
}

function describeObjectSpreadValue(value: SandboxValue): string {
  if (value === null) {
    return "null";
  }

  if (value === undefined) {
    return "undefined";
  }

  if (isSandboxClosure(value)) {
    return "function";
  }

  if (isSandboxPromise(value)) {
    return "promise";
  }

  return typeof value;
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

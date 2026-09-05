import { promiseReplayContext } from "./promise-replay.js";
import { deleteHostObjectMember, getHostObjectKeys, getHostObjectMember, hasHostObjectMember, isGuestHostObject, setHostObjectMember } from "./host-capabilities.js";
import { sandboxString } from "./string-coercion.js";
import { assertPromiseExecutionAllowed } from "./promise-tracker.js";
import { SandboxJobQueue, runAsyncPrefix, suspendJob } from "./jobs.js";
import { withCancellationSignal } from "./cancel.js";
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
  readErrorSpan,
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
import { Budget, SandboxError, type CompileOwner } from "./budget.js";
import { CompileScope, RegexCompileGuard } from "./regex/compile-guard.js";
import {
  coerceThrownValue,
  createCapturedException,
  evaluateThrowStatement as evaluateThrowStatementResult,
  evaluateTryStatement as evaluateTryStatementResult,
  isCapturedException,
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
import { getGuestFunctionProperty, getSandboxPrototype, isGuestClosure, materializeFunctionProperties, setSandboxPrototype } from "./object-model.js";
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
import { getSandboxIterator, type SandboxIterator } from "./iteration.js";
import { assertCollectionMutable } from "./running-state.js";
import { getGeneratorMember } from "./methods/generator.js";
import { getRegexMember, isRegexMethodName, setRegexMember } from "./methods/regex.js";
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
  isSandboxClosure,
  isSandboxGenerator,
  isSandboxMap,
  isSandboxPromise,
  isSandboxRegex,
  isSandboxSet,
  reconcileCompiledValues,
  type SandboxArray,
  type SandboxClosure,
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
  generatorResume?: {
    sent: GeneratorCompletion[];
    yieldNodeId: number;
  };
  snapshot?: InterpreterSnapshot;
};

type EvaluationContext = AsyncEvaluationContext;

type EvaluationResult = AsyncEvaluationResult;

const taggedTemplateRawArrays = new WeakMap<SandboxArray, SandboxArray>();

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
  BlockStatement: evaluateBlockStatement,
  BooleanLiteral: evaluatePrimitiveLiteral,
  CallExpression: evaluateCallExpression,
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

async function evaluateNode(
  node: ParseResult,
  context: EvaluationContext
): Promise<EvaluationResult> {
  context.assertActive?.();
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

    const exception = isCapturedException(error)
      ? coerceThrownValue(error.reason, context.budget, error.stackFrames, node.span, error.sandbox)
      : coerceThrownValue(error, context.budget, context.callStack, node.span, true);

    reconcileDataBudget(
      context.budget,
      context.stats,
      context.scope,
      exception,
      compilation,
      context.compilation
    );

    return {
      kind: "throw",
      hasValue: true,
      span: readErrorSpan(exception) ?? node.span,
      stackFrames: isCapturedException(error) ? error.stackFrames : context.callStack,
      value: exception
    };
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
    [...scope.retainedValues(), ...budget.retainedValues(), transient],
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
  const values: SandboxArray = [];

  for (const element of node.elements) {
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
}

async function evaluateObjectExpression(
  node: ObjectExpression,
  context: EvaluationContext
): Promise<EvaluationResult> {
  const object = Object.create(null) as SandboxObject;

  for (const property of node.properties) {
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

    const key = await evaluateObjectPropertyKey(property, context);
    if (!key.ok) {
      return key.result;
    }

    const value = await evaluateNode(property.value, context);
    if (value.kind !== "normal") {
      return value;
    }

    if (isObjectPrototypeSetterProperty(property, key.value)) {
      if (value.value === null || typeof value.value === "object") {
        setSandboxPrototype(object, value.value as object | null, context.budget);
      }
      continue;
    }

    defineSandboxProperty(object, String(key.value), value.value);
  }

  return {
    kind: "normal",
    hasValue: true,
    value: object
  };
}

function isObjectPrototypeSetterProperty(property: Property, key: string | number): boolean {
  return !property.computed && !property.shorthand && key === "__proto__";
}

async function evaluateTemplateLiteral(
  node: TemplateLiteral,
  context: EvaluationContext
): Promise<EvaluationResult> {
  let value = context.budget.allocateString(node.quasis[0]?.value.cooked ?? "");

  for (let index = 0; index < node.expressions.length; index += 1) {
    const expression = await evaluateNode(node.expressions[index], context);
    if (expression.kind !== "normal") {
      return expression;
    }

    const expressionText = context.budget.allocateString(String(expression.value));
    value = context.budget.allocateString(value + expressionText);

    const quasiText = context.budget.allocateString(node.quasis[index + 1]?.value.cooked ?? "");
    value = context.budget.allocateString(value + quasiText);
  }

  return {
    kind: "normal",
    hasValue: true,
    value
  };
}

async function evaluateTaggedTemplateExpression(
  node: TaggedTemplateExpression,
  context: EvaluationContext
): Promise<EvaluationResult> {
  const tag = await evaluateNode(node.tag, context);
  if (tag.kind !== "normal") {
    return tag;
  }

  if (!isSandboxClosure(tag.value)) {
    throw new TypeError("Tagged template tag must be a function.");
  }

  const values = await evaluateTemplateExpressionValues(node.quasi, context);
  if (!values.ok) {
    return values.result;
  }

  return {
    kind: "normal",
    hasValue: true,
    value: await invokeSandboxClosure(
      tag.value,
      [createTaggedTemplateStrings(node.quasi, context), ...values.value],
      context,
      [...context.callStack, formatStackFrame(node, tag.value.name)]
    )
  };
}

async function evaluateTemplateExpressionValues(
  node: TemplateLiteral,
  context: EvaluationContext
): Promise<HelperResult<SandboxValue[]>> {
  const values: SandboxValue[] = [];

  for (const expressionNode of node.expressions) {
    const expression = await evaluateNode(expressionNode, context);
    if (expression.kind !== "normal") {
      return {
        ok: false,
        result: expression
      };
    }

    values.push(expression.value);
  }

  return {
    ok: true,
    value: values
  };
}

function createTaggedTemplateStrings(
  node: TemplateLiteral,
  context: EvaluationContext
): SandboxArray {
  context.budget.allocateArrayLength(node.quasis.length);
  const strings = node.quasis.map((quasi) =>
    quasi.value.cooked === undefined ? undefined : context.budget.allocateString(quasi.value.cooked)
  ) as SandboxArray;

  context.budget.allocateArrayLength(node.quasis.length);
  const raw = node.quasis.map((quasi) =>
    context.budget.allocateString(quasi.value.raw)
  ) as SandboxArray;
  Object.defineProperty(strings, "raw", {
    configurable: false,
    enumerable: false,
    value: raw,
    writable: false
  });
  taggedTemplateRawArrays.set(strings, raw);

  return strings;
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
  const left = await evaluateNode(node.left, context);
  if (left.kind !== "normal") {
    return left;
  }

  const right = await evaluateNode(node.right, context);
  if (right.kind !== "normal") {
    return right;
  }

  let leftValue = left.value;
  if (node.operator === "in") {
    if (typeof right.value !== "object" || right.value === null) {
      throw new TypeError("Right-hand side of 'in' must be an object.");
    }
    leftValue = await toPropertyKey(leftValue, context);
  }
  const value = applyBinaryOperator(node, leftValue, right.value, context);

  return {
    kind: "normal",
    hasValue: true,
    value
  };
}

async function evaluateAssignmentExpression(
  node: AssignmentExpression,
  context: EvaluationContext
): Promise<EvaluationResult> {
  if (node.left.type === "ArrayPattern" || node.left.type === "ObjectPattern") {
    const right = await evaluateNode(node.right, context);
    if (right.kind !== "normal") {
      return right;
    }

    const binding = await bindPattern(node.left, right.value, { assign: true }, context.scope, createPatternContext(context));
    if (!binding.ok) {
      return binding.result;
    }

    return {
      kind: "normal",
      hasValue: true,
      value: right.value
    };
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

  const binding = node.operator === "=" ? undefined : context.scope.lookup(node.left.name);
  if (binding?.found === false) {
    throw new ReferenceError(`Cannot assign to undeclared binding '${node.left.name}'.`);
  }
  const current = binding?.value;

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

  const right = await evaluateNode(node.right, context);
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
}

async function evaluateMemberAssignmentExpression(
  node: AssignmentExpression,
  context: EvaluationContext
): Promise<EvaluationResult> {
  if (node.left.type !== "MemberExpression") {
    throw new TypeError("Expected member assignment target.");
  }

  const member = await evaluateMemberAccess(node.left, context);
  if (member.kind === "error") {
    return member;
  }
  if (member.kind === "completion") {
    return member.result;
  }
  if (member.kind === "nullish") {
    throw new TypeError("Cannot assign properties of null or undefined.");
  }
  const current =
    node.operator === "=" ? undefined : getPropertyValue(member.object, member.property, context);

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

  const right = await evaluateNode(node.right, context);
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

  setSandboxProperty(member.object, member.property, value, context.budget);

  return {
    kind: "normal",
    hasValue: true,
    value
  };
}

async function evaluateLogicalExpression(
  node: LogicalExpression,
  context: EvaluationContext
): Promise<EvaluationResult> {
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

  for (const expression of node.expressions) {
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
  const declaration = await evaluateNode(node.declaration, context);
  if (declaration.kind !== "normal") {
    return declaration;
  }

  context.scope.declare("default", "const", declaration.value);

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
  if (node.kind !== "var") {
    predeclareDeclarationBindings(node, context.scope);
  }

  for (const declarator of node.declarations) {
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

    const restoredValue =
      declarator.id.type === "Identifier"
        ? context.scope.consumeRestoredBinding(declarator.id.name)
        : { found: false as const };
    const value =
      restoredValue.found && isRestorableBindingValue(restoredValue.value)
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
          : await evaluateNode(declarator.init, context);

    if (value.kind !== "normal") {
      return value;
    }

    const binding = await bindPattern(
      declarator.id,
      value.value,
      { kind: node.kind },
      context.scope,
      createPatternContext(context)
    );
    if (!binding.ok) {
      return binding.result;
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

function containsResumeTarget(node: ParseResult, targetNodeIds: ReadonlySet<number>): boolean {
  if (node.nodeId !== undefined && targetNodeIds.has(node.nodeId)) {
    return true;
  }
  if (
    node.type === "ArrowFunctionExpression" ||
    node.type === "FunctionDeclaration" ||
    node.type === "FunctionExpression"
  ) {
    return false;
  }

  for (const value of Object.values(node)) {
    if (Array.isArray(value)) {
      if (
        value.some((entry) => isParseResult(entry) && containsResumeTarget(entry, targetNodeIds))
      ) {
        return true;
      }
      continue;
    }
    if (isParseResult(value) && containsResumeTarget(value, targetNodeIds)) {
      return true;
    }
  }

  return false;
}

function isParseResult(value: unknown): value is ParseResult {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as { type?: unknown }).type === "string" &&
    Object.hasOwn(value, "span")
  );
}

function createBlockContext(node: BlockStatement, context: EvaluationContext): EvaluationContext {
  const scope =
    node === context.rootNode ||
    node === context.functionBody ||
    context.generatorResume !== undefined
      ? context.scope
      : context.scope.child();
  const blockContext = {
    ...context,
    scope
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

  for (const statement of statements) {
    if (statement.type === "FunctionDeclaration") {
      const name = statement.id.name;
      if (names.has(name) && !(functionBody && scope.getOwnBindingKind(name) === "var")) {
        throw new Error(`Cannot redeclare binding '${name}' in the same scope.`);
      }

      const closure = createInterpretedClosure(statement, context, evaluateNode);
      const ownBindingKind = scope.getOwnBindingKind(name);
      if (ownBindingKind === "var") {
        names.add(name);
        scope.assign(name, closure);
        continue;
      }
      if (ownBindingKind !== undefined) {
        throw new Error(`Cannot redeclare binding '${name}' in the same scope.`);
      }

      names.add(name);
      scope.declare(name, functionBody ? "var" : "let", closure);
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
  const discriminant = await evaluateNode(node.discriminant, context);
  if (discriminant.kind !== "normal") {
    return discriminant;
  }

  const switchContext = { ...context, scope: context.scope.child() };
  predeclareStatementListBindings(
    node.cases.flatMap((switchCase) => switchCase.consequent),
    switchContext
  );

  let defaultIndex: number | undefined;
  let startIndex: number | undefined;
  for (let index = 0; index < node.cases.length; index += 1) {
    const switchCase = node.cases[index]!;
    if (switchCase.test === undefined) {
      defaultIndex = index;
      continue;
    }

    const test = await evaluateNode(switchCase.test, switchContext);
    if (test.kind !== "normal") {
      return test;
    }
    if (discriminant.value === test.value) {
      startIndex = index;
      break;
    }
  }

  startIndex ??= defaultIndex;
  if (startIndex === undefined) {
    return normalEmptyResult();
  }

  for (let caseIndex = startIndex; caseIndex < node.cases.length; caseIndex += 1) {
    for (const statement of node.cases[caseIndex]!.consequent) {
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
}

async function evaluateIfStatement(
  node: IfStatement,
  context: EvaluationContext
): Promise<EvaluationResult> {
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
  const restoredIteration = context.restoredLoopIterations.get(node.nodeId ?? -1);
  let restoredEntry: IteratorResult<SandboxValue> | undefined;
  if (typeof restoredIteration === "object" && typeof restoredIteration.values[0] === "string") {
    const restored = context.scope.consumeRestoredBinding(restoredIteration.values[0]);
    if (restored.found && Array.isArray(restored.value)) {
      restoredEntry = { done: false, value: restored.value[1] };
      if (isSandboxMap(restored.value[0]) || isSandboxSet(restored.value[0])) {
        return evaluateForOfIterator(node, restored.value[0], context, restoredEntry);
      }
    }
  }
  const iterable = await evaluateNode(node.right, context);
  if (iterable.kind !== "normal") {
    return iterable;
  }

  const values = snapshotableIterationValues(iterable.value);
  if (values === undefined) {
    return evaluateForOfIterator(node, iterable.value, context, restoredEntry);
  }

  const restoredIndex = consumeRestoredLoopIterationIndex(node, context);
  for (let index = restoredIndex; index < values.length; index += 1) {
    context.activeLoopIterations.set(node.nodeId ?? -1, index);

    const scope = context.scope.child();
    const binding = await bindForOfLoopVariable(node.left, values[index]!, scope, context);
    if (!binding.ok) {
      return binding.result;
    }

    const iterationContext = createLoopIterationContext(context, scope);
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
  const iterator = getSandboxIterator(value);
  if (iterator === undefined) {
    throw new TypeError(`${String(value)} is not a supported iterable`);
  }

  const nodeId = node.nodeId ?? -1;
  let index = consumeRestoredLoopIterationIndex(node, context);
  for (let skipped = 0; skipped < index; skipped += 1) {
    const skippedIteration = await iterator.next();
    if (typeof skippedIteration !== "object" || skippedIteration === null) {
      throw new TypeError("Iterator result must be an object.");
    }
    if (skippedIteration.done) {
      return normalEmptyResult();
    }
  }

  while (true) {
    const iteration = restoredEntry ?? (await iterator.next());
    restoredEntry = undefined;
    if (typeof iteration !== "object" || iteration === null) {
      throw new TypeError("Iterator result must be an object.");
    }
    if (iteration.done) {
      context.activeLoopIterations.delete(nodeId);
      return normalEmptyResult();
    }

    context.activeLoopIterations.set(
      nodeId,
      iterator.snapshotIndex === undefined
        ? index
        : {
            get index() {
              return iterator.snapshotIndex!();
            },
            values: [value, iteration.value]
          }
    );
    const scope = context.scope.child();
    const binding = await bindForOfLoopVariable(node.left, iteration.value, scope, context);
    if (!binding.ok) {
      return binding.result;
    }

    const iterationContext = createLoopIterationContext(context, scope);
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
      await closeIterator(iterator);
      return result;
    }
    index += 1;
  }
}

async function evaluateForInStatement(
  node: ForInStatement,
  context: EvaluationContext
): Promise<EvaluationResult> {
  const right = await evaluateNode(node.right, context);
  if (right.kind !== "normal") {
    return right;
  }

  const object = forInObject(right.value);
  if (object === undefined) {
    return normalEmptyResult();
  }

  const restoredIteration = consumeRestoredLoopIteration(node, context);
  const keys =
    restoredIteration === undefined || typeof restoredIteration === "number"
      ? forInKeys(object, context.budget)
      : restoredIteration.values.map(String);
  const restoredIndex =
    typeof restoredIteration === "number" ? restoredIteration : (restoredIteration?.index ?? 0);
  for (let index = restoredIndex; index < keys.length; index += 1) {
    context.activeLoopIterations.set(node.nodeId ?? -1, { index, values: keys });
    const key = keys[index]!;
    if (!hasForInProperty(object, key, context.budget)) {
      continue;
    }

    const scope = context.scope.child();
    const binding = await bindForInLoopVariable(node.left, key, scope, context);
    if (!binding.ok) {
      context.activeLoopIterations.delete(node.nodeId ?? -1);
      return binding.result;
    }

    const iterationContext = createLoopIterationContext(context, scope);
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

async function bindForInLoopVariable(
  left: ForInStatement["left"],
  key: string,
  scope: Scope,
  context: EvaluationContext
): Promise<BindPatternResult> {
  if (left.type === "Identifier") {
    return bindPattern(left, key, { assign: true }, scope, createPatternContext(context, scope));
  }

  const [declarator] = left.declarations;
  if (left.declarations.length !== 1 || declarator?.id.type !== "Identifier") {
    throw new TypeError("for...in keys are strings; destructure inside the body");
  }
  return bindPattern(declarator.id, key, { kind: left.kind }, scope, createPatternContext(context, scope));
}

function normalEmptyResult(): EvaluationResult {
  return { kind: "normal", hasValue: false, value: undefined };
}

async function evaluateForStatement(
  node: ForStatement,
  context: EvaluationContext
): Promise<EvaluationResult> {
  const loopScope = context.scope.child();
  const loopBindingNames = getForStatementBindingNames(node);
  const loopContext = {
    ...context,
    scope: loopScope
  };

  if (node.init !== undefined) {
    const init = await evaluateNode(node.init, loopContext);
    if (init.kind !== "normal") {
      return init;
    }
  }

  while (true) {
    context.budget.visitNode();
    context.stats.nodeVisits += 1;

    if (node.test !== undefined) {
      const test = await evaluateNode(node.test, loopContext);
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
      loopBindingNames.length === 0 ? loopScope : loopScope.iterationChild(loopBindingNames);
    const iterationContext = {
      ...loopContext,
      ...createLoopIterationContext(loopContext, iterationScope)
    };
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

    const updateScope =
      loopBindingNames.length === 0
        ? iterationScope
        : iterationScope.iterationChild(loopBindingNames);
    const updateContext = {
      ...loopContext,
      scope: updateScope
    };

    if (node.update !== undefined) {
      const update = await evaluateNode(node.update, updateContext);
      if (update.kind !== "normal") {
        return update;
      }
    }

    loopScope.copyInitializedBindingsFrom(updateScope, loopBindingNames);
  }
}

async function evaluateWhileStatement(
  node: WhileStatement,
  context: EvaluationContext
): Promise<EvaluationResult> {
  while (true) {
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
  while (true) {
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
          (isSandboxMap(iteration.values[0]) || isSandboxSet(iteration.values[0]))
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

function snapshotableIterationValues(value: SandboxValue): SandboxValue[] | undefined {
  if (typeof value === "string") {
    return Array.from(value);
  }
  if (Array.isArray(value)) {
    return value;
  }
  return undefined;
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

async function bindForOfLoopVariable(
  left: ForOfStatement["left"],
  value: SandboxValue,
  scope: Scope,
  context: EvaluationContext
): Promise<BindPatternResult> {
  if (left.type === "Identifier") {
    return bindPattern(left, value, { assign: true }, scope, createPatternContext(context, scope));
  }

  if (left.type !== "VariableDeclaration") {
    throw new TypeError(`Unsupported for...of left-hand side '${left.type}'.`);
  }

  const [declarator] = left.declarations;
  if (left.declarations.length !== 1 || declarator === undefined) {
    throw new TypeError("for...of declarations must include exactly one declarator.");
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
    value: argument.value
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
    node.nodeId !== context.generatorResume.yieldNodeId
  ) {
    return { kind: "normal", hasValue: true, value: undefined };
  }

  if (node.delegate) {
    return evaluateYieldDelegate(node, context);
  }

  const argument =
    context.generatorResume !== undefined || node.argument === undefined
      ? { kind: "normal" as const, hasValue: true, value: undefined }
      : await evaluateNode(node.argument, context);
  if (argument.kind !== "normal") {
    return argument;
  }

  const completionPromise = context.generatorYield(
    allocateProducedSandboxValue(argument.value, context.budget),
    node.nodeId
  );
  emitResumeBreakpoint(context, {
    kind: "generator-yield",
    nodeId: node.nodeId,
    span: node.span
  });
  const completion = await completionPromise;
  context.generatorResume = undefined;
  return generatorCompletionResult(completion);
}

async function evaluateYieldDelegate(
  node: YieldExpression,
  context: EvaluationContext
): Promise<EvaluationResult> {
  const argument = await evaluateNode(node.argument!, context);
  if (argument.kind !== "normal") {
    return argument;
  }
  const iterator = getSandboxIterator(argument.value);
  if (iterator === undefined) {
    throw new TypeError(`${String(argument.value)} is not a supported iterable`);
  }

  let completion: { type: "normal" | "return" | "throw"; value: SandboxValue } = {
    type: "normal",
    value: undefined
  };
  const replay = context.generatorResume?.sent ?? [];
  let replayIndex = 0;
  while (true) {
    const method = completion.type === "normal" ? "next" : completion.type;
    const iteratorMethod = iterator[method];
    if (iteratorMethod === undefined) {
      if (completion.type === "throw") {
        throw completion.value;
      }
      return generatorCompletionResult(completion);
    }
    const result = await iteratorMethod(completion.value);
    if (result.done) {
      if (completion.type === "return") {
        return generatorCompletionResult({ type: "return", value: result.value });
      }
      return {
        kind: "normal",
        hasValue: true,
        value: result.value
      };
    }
    if (replayIndex < replay.length - 1) {
      completion = replay[replayIndex + 1] as typeof completion;
      replayIndex += 1;
      continue;
    }
    const completionPromise = context.generatorYield!(
      allocateProducedSandboxValue(result.value, context.budget),
      node.nodeId
    );
    emitResumeBreakpoint(context, {
      kind: "generator-yield",
      nodeId: node.nodeId,
      span: node.span
    });
    completion = (await completionPromise) as typeof completion;
    context.generatorResume = undefined;
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
  return evaluateTryStatementResult(node, context, evaluateNode);
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

  const member = await evaluateMemberAccess(node.argument, context);
  if (member.kind === "error") {
    return member;
  }
  if (member.kind === "completion") {
    return member.result;
  }

  if (member.kind === "nullish") {
    if (node.argument.optional) {
      return {
        kind: "normal",
        hasValue: true,
        value: true
      };
    }

    throw new TypeError("Cannot delete properties of null or undefined.");
  }

  if (!isIndexableSandboxValue(member.object)) {
    throw new TypeError("Unary operator 'delete' requires a sandbox object property.");
  }

  const deleted = deleteSandboxProperty(member.object, member.property);

  return {
    kind: "normal",
    hasValue: true,
    value: deleted
  };
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

  const current = toNumber(await toNumericPrimitive(binding.value, context));
  const next = node.operator === "++" ? current + 1 : current - 1;
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

  const member = await evaluateMemberAccess(node.argument, context);
  if (member.kind === "error") {
    return member;
  }
  if (member.kind === "completion") {
    return member.result;
  }
  if (member.kind === "nullish") {
    throw new TypeError("Cannot update properties of null or undefined.");
  }
  const current = toNumber(
    await toNumericPrimitive(getPropertyValue(member.object, member.property, context), context)
  );
  const next = node.operator === "++" ? current + 1 : current - 1;
  setSandboxProperty(member.object, member.property, next, context.budget);

  return {
    kind: "normal",
    hasValue: true,
    value: node.prefix ? next : current
  };
}

async function evaluateMemberExpression(
  node: MemberExpression,
  context: EvaluationContext
): Promise<EvaluationResult> {
  const member = await evaluateMemberAccess(node, context);
  if (member.kind === "error") return member;
  if (member.kind === "completion") return member.result;
  if (member.kind === "nullish") {
    if (node.optional) return { kind: "normal", hasValue: true, value: undefined };
    throw new TypeError("Cannot read properties of null or undefined.");
  }
  return {
    kind: "normal",
    hasValue: true,
    value: getPropertyValue(member.object, member.property, context)
  };
}

function getPropertyValue(
  target: InterpreterValue,
  property: string | number,
  context: EvaluationContext
): SandboxValue {
  if (isGuestHostObject(target)) return getHostObjectMember(target, String(property));
  if (typeof target === "string") return getStringMember(target, property, context.budget);
  if (typeof target === "number") return getNumberMember(target, property, context.budget);
  if (typeof target === "boolean") return undefined;
  if (isFloat32Array(target)) return getFloat32Member(target, property, context.budget);
  if (isSandboxDate(target)) return getDateMember(property, context.budget, context.compilation?.owner);
  if (isSandboxMap(target)) return getMapMember(target, property, createMapMethodOptions(context));
  if (isSandboxSet(target)) return getSetMember(target, property, createSetMethodOptions(context));
  if (isSandboxGenerator(target)) return getGeneratorMember(target, property, context.budget);
  if (isSandboxClosure(target)) return getClosureMemberValue(target, property, context);
  if (isSandboxPromise(target)) return getPromiseMember(property, context.budget);
  if (isSandboxRegex(target)) return getRegexMember(target, property);
  if (!isIndexableSandboxValue(target)) {
    throw new TypeError("Attempted to read a property from a non-object value.");
  }
  return getMemberValue(target, property, context);
}

export function createPatternContext(context: AsyncEvaluationContext, scope = context.scope, evaluate = evaluateNode): PatternContext {
  const evaluationContext = { ...context, scope };
  return {
    evaluate: node => evaluate(node, evaluationContext),
    getProperty: (value, key) => getPropertyValue(value, key, evaluationContext),
    setProperty: (target, key, value) => setSandboxProperty(target, key, value, context.budget)
  };
}

async function evaluateCallExpression(
  node: CallExpression,
  context: EvaluationContext
): Promise<EvaluationResult> {
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
  const callee = await evaluateNode(node.callee, context);
  if (callee.kind !== "normal") {
    return callee;
  }

  const name = getConstructorName(node.callee);
  const args = await evaluateCallArguments(node.arguments, context);
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
  context: EvaluationContext
): Promise<
  | {
      kind: "error";
      error: InterpreterError;
    }
  | {
      kind: "completion";
      result: EvaluationResult;
    }
  | {
      kind: "nullish";
    }
  | {
      kind: "resolved";
      object: InterpreterValue;
      property: string | number;
    }
> {
  const object = await evaluateNode(node.object, context);
  if (object.kind !== "normal") {
    return {
      kind: "completion",
      result: object
    };
  }

  if ((object.value === null || object.value === undefined) && node.optional) {
    return {
      kind: "nullish"
    };
  }

  const property: HelperResult<string | number> = node.computed
    ? await evaluateMemberProperty(node.property, context)
    : { ok: true, value: getStaticPropertyName(node.property) };
  if (!property.ok) {
    return property.result.kind === "error"
      ? {
          kind: "error",
          error: property.result.error
        }
      : {
          kind: "completion",
          result: property.result
        };
  }

  if (object.value === null || object.value === undefined) {
    return {
      kind: "nullish"
    };
  }

  return {
    kind: "resolved",
    object: object.value,
    property: property.value
  };
}

async function evaluateMemberProperty(
  node: MemberExpression["property"],
  context: EvaluationContext
): Promise<HelperResult<string | number>> {
  const property = await evaluateNode(node, context);
  if (property.kind !== "normal") {
    return {
      ok: false,
      result: property
    };
  }

  if (typeof property.value === "string" || typeof property.value === "number") {
    return {
      ok: true,
      value: property.value
    };
  }

  throw new TypeError("Computed property access requires a string or number key.");
}

async function evaluateObjectPropertyKey(
  node: Property,
  context: EvaluationContext
): Promise<HelperResult<string | number>> {
  if (!node.computed) {
    return {
      ok: true,
      value: getStaticPropertyName(node.key)
    };
  }

  return evaluateMemberProperty(node.key, context);
}

function getStaticPropertyName(node: MemberExpression["property"]): string | number {
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

  const member = await evaluateMemberAccess(node.callee, context);
  if (member.kind === "error") {
    return member;
  }
  if (member.kind === "completion") {
    return member.result;
  }

  if (member.kind === "nullish") {
    if (node.optional || node.callee.optional) {
      return {
        kind: "normal",
        hasValue: true,
        value: undefined
      };
    }

    throw new TypeError("Cannot read properties of null or undefined.");
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
      getNumberMember(member.object, member.property, context.budget),
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
    return evaluateResolvedCallExpression(node, getDateMember(member.property, context.budget, context.compilation?.owner), context, member.object);
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
    const memberValue = getClosureMemberValue(member.object, member.property, context);
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

  if (isSandboxRegex(member.object) && isRegexMethodName(member.property)) {
    return evaluateResolvedCallExpression(
      node,
      getRegexMember(member.object, member.property),
      context,
      member.object
    );
  }

  if (!isIndexableSandboxValue(member.object)) {
    throw new TypeError("Attempted to read a property from a non-object value.");
  }

  return evaluateResolvedCallExpression(
    node,
    getMemberValue(member.object, member.property, context),
    context,
    member.object
  );
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
        context.compilation
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
  const args = await evaluateCallArguments(node.arguments, context);
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
    case "-":
      return -toNumber(await toNumericPrimitive(value, context));
    case "~":
      return ~toNumber(await toNumericPrimitive(value, context));
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
): InterpreterValue {
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
      while (isSandboxClosure(right) && right.boundTarget !== undefined) right = right.boundTarget;
      if (isSandboxPromiseConstructor(right)) return isSandboxPromise(left);
      if (isSandboxMapConstructor(right) && isSandboxMap(left)) {
        return true;
      }
      if (isFloat32ArrayConstructor(right)) return isFloat32Array(left);
      if (isDateConstructor(right)) return isSandboxDate(left) && getDatePrototype(left, context.budget, context.compilation?.owner) !== null;
      if (isSandboxSetConstructor(right) && isSandboxSet(left)) {
        return true;
      }
      if (isSandboxErrorConstructorInstance(left, right)) {
        return true;
      }
      if (isGuestClosure(right)) {
        if (typeof left !== "object" || left === null) return false;
        const prototype = getGuestFunctionProperty(right, "prototype");
        if (typeof prototype !== "object" || prototype === null) {
          throw new TypeError("Function has a non-object prototype in instanceof check.");
        }
        let depth = 0;
        for (let current = getSandboxPrototype(left, context.budget); current !== null; current = getSandboxPrototype(current, context.budget)) {
          context.budget.visitNode();
          assertSandboxDataDepth(depth++);
          if (current === prototype) return true;
        }
      }
      return false;
    case "in":
      return hasSandboxProperty(right, left as string, context);
  }
}

async function toPropertyKey(value: SandboxValue, context: EvaluationContext): Promise<string> {
  if (isPlainSandboxObject(value) && !isSandboxDate(value) && !isFloat32Array(value) &&
      !isSandboxGenerator(value) && !isGuestHostObject(value)) {
    for (const name of ["toString", "valueOf"] as const) {
      const method = getMemberValue(value, name, context);
      if (!isSandboxClosure(method)) continue;
      const primitive = await invokeSandboxClosure(method, [], context, context.callStack, undefined, value);
      if (primitive === null || typeof primitive !== "object") {
        return context.budget.allocateString(String(primitive));
      }
    }
    throw new TypeError("Cannot convert object to primitive value.");
  }
  return sandboxString(value, context.budget, {
    stack: context.callStack,
    thisValue: undefined,
    invokeClosure: (closure, args, thisValue) =>
      invokeSandboxClosure(closure, args, context, context.callStack, undefined, thisValue)
  });
}

function hasSandboxProperty(value: SandboxValue, key: string, context: EvaluationContext): boolean {
  let current = value;
  let depth = 0;
  while (typeof current === "object" && current !== null) {
    if (isGuestHostObject(current)) return hasHostObjectMember(current, key);
    if (hasOwnSandboxProperty(current, key, false)) return true;
    if (Array.isArray(current) || !isPlainSandboxObject(current) ||
        isSandboxDate(current) || isFloat32Array(current) || isSandboxGenerator(current)) {
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
  left = await toNumericPrimitive(left, context);
  right = await toNumericPrimitive(right, context);
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

  const leftNumber = toNumber(leftPrimitive);
  const rightNumber = toNumber(rightPrimitive);

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

type CoercionType = "boolean" | "null" | "number" | "object" | "string" | "undefined";

function getCoercionType(value: InterpreterValue): CoercionType {
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
  context: EvaluationContext
): Promise<SandboxPrimitive> {
  if (isSandboxDate(value)) return dateTime(value);
  if (isPrimitiveCoercionType(getCoercionType(value))) {
    return value as SandboxPrimitive;
  }

  if (isIndexableSandboxValue(value)) {
    for (const methodName of ["valueOf", "toString"] as const) {
      const method = getMemberValue(value, methodName, context);
      if (methodName === "toString" && method === undefined && !Object.hasOwn(value, methodName)) {
        return toString(value);
      }
      if (!isSandboxClosure(method)) {
        continue;
      }

      const result = await invokeSandboxClosure(
        method,
        [],
        context,
        context.callStack,
        undefined,
        value
      );
      if (isPrimitiveCoercionType(getCoercionType(result))) {
        return result as SandboxPrimitive;
      }
    }
    throw new TypeError("Cannot convert object to primitive value.");
  }

  return toString(value);
}

function toNumber(value: InterpreterValue): number {
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
): SandboxValue {
  if (isGuestHostObject(target)) return getHostObjectMember(target, String(property));
  let current: SandboxValue = target;
  let depth = 0;
  while (typeof current === "object" && current !== null) {
    if (isSandboxClosure(current)) return getClosureMemberValue(current, property, context);
    if (Array.isArray(current)) return getArrayMemberValue(current, property, context);
    if (!isPlainSandboxObject(current) || isSandboxGenerator(current) || isFloat32Array(current)) {
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
  if (property === "raw" && taggedTemplateRawArrays.has(target)) {
    return taggedTemplateRawArrays.get(target);
  }

  return getArrayMember(target, property, createArrayMethodOptions(context));
}

export function setSandboxProperty(
  target: SandboxValue,
  property: string | number,
  value: SandboxValue,
  budget: Budget
): void {
  if (isSandboxDate(target)) throw new TypeError("Date own properties are not supported.");
  if (isGuestHostObject(target)) {
    setHostObjectMember(target, String(property), value);
    return;
  }
  const prototypeOwner = target;
  if (isGuestClosure(target)) target = materializeFunctionProperties(target);
  if (isFloat32Array(target)) {
    setFloat32Member(target, property, value);
    return;
  }
  if (isSandboxRegex(target)) {
    setRegexMember(target, property, value);
    return;
  }
  if (!isIndexableSandboxValue(target)) {
    throw new TypeError("Assignment expressions require a sandbox object property.");
  }
  const key = String(property);
  if (Array.isArray(target)) {
    assertCollectionMutable(target);
    if (key === "length" || isArrayIndexKey(key)) {
      (target as unknown as Record<string, SandboxValue>)[key] = value;
      return;
    }
  }

  const descriptor = Object.getOwnPropertyDescriptor(target, key);
  if (descriptor !== undefined) {
    if (descriptor.writable !== true) {
      throw new TypeError(`Cannot assign to read only property '${key}'.`);
    }
    Object.defineProperty(target, key, { value });
  } else {
    if (typeof prototypeOwner === "object" && prototypeOwner !== null) {
      let depth = 0;
      for (let prototype = getSandboxPrototype(prototypeOwner, budget); prototype !== null; prototype = getSandboxPrototype(prototype, budget)) {
        budget.visitNode();
        assertSandboxDataDepth(depth++);
        const properties = isSandboxClosure(prototype) ? prototype.properties : prototype;
        const inherited = properties === undefined ? undefined : Object.getOwnPropertyDescriptor(properties, key);
        if (inherited === undefined) continue;
        if (inherited.writable !== true) throw new TypeError(`Cannot assign to read only property '${key}'.`);
        break;
      }
    }
    defineSandboxProperty(target, key, value);
  }
}

function deleteSandboxProperty(
  target: SandboxArray | SandboxObject,
  property: string | number
): boolean {
  if (isGuestHostObject(target)) return deleteHostObjectMember(target, String(property));
  if (isGuestClosure(target)) target = materializeFunctionProperties(target);
  if (Array.isArray(target)) {
    assertCollectionMutable(target);
  }
  return delete (target as unknown as Record<string, SandboxValue>)[String(property)];
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

  const args = await evaluateCallArguments(node.arguments, context);
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
      value: callNumberMethod(target, methodName, args.value, context.budget)
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
    callClosure: (closure, args, stack, thisValue, construct) =>
      invokeSandboxClosure(closure, args, context, stack, undefined, thisValue, construct)
  };
}

async function invokeSandboxClosure(
  callee: Extract<InterpreterValue, { kind: "fn" }>,
  args: readonly SandboxValue[],
  context: EvaluationContext,
  stack: readonly string[],
  span?: SourceSpan,
  thisValue: SandboxValue = undefined,
  construct = false
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
        compilation: context.compilation,
        invokeClosure: (
          closure: SandboxClosure,
          argumentsList: readonly SandboxValue[],
          receiver: SandboxValue
        ) => invokeSandboxClosure(closure, argumentsList, context, stack, span, receiver),
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

async function evaluateCallArguments(
  args: CallExpression["arguments"],
  context: EvaluationContext
): Promise<HelperResult<SandboxValue[]>> {
  const values: SandboxValue[] = [];

  for (const arg of args) {
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

  const iterator = getSpreadIterator(value.value);
  if (iterator === undefined) {
    throw new TypeError("Spread arguments must evaluate to an iterable.");
  }

  const spreadValues: SandboxValue[] = [];
  while (true) {
    const next = await iterator.next();
    if (typeof next !== "object" || next === null) {
      throw new TypeError("Iterator result must be an object.");
    }

    if (next.done === true) {
      break;
    }

    spreadValues.push(next.value as SandboxValue);
    context.budget.allocateArrayLength(spreadValues.length);
  }

  return {
    ok: true,
    value: spreadValues
  };
}

async function evaluateObjectSpread(
  node: SpreadElement,
  context: EvaluationContext
): Promise<HelperResult<Array<readonly [string, SandboxValue]>>> {
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
      if (hasHostObjectMember(value.value, key, true)) entries.push([key, getHostObjectMember(value.value, key)]);
    }
    return { ok: true, value: entries };
  }

  if ((isSandboxClosure(value.value) && !isGuestClosure(value.value)) || isSandboxPromise(value.value)) {
    throw new TypeError(
      `Cannot spread ${describeObjectSpreadValue(value.value)} into object literal.`
    );
  }

  const spreadValue = isGuestClosure(value.value) ? value.value.properties ?? {} : Object(value.value) as Record<string, SandboxValue>;
  const keys = Object.keys(spreadValue);
  context.budget.allocateArrayLength(keys.length);

  return {
    ok: true,
    value: keys.map((key) => [key, spreadValue[key]] as const)
  };
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

function getSpreadIterator(value: SandboxValue): SandboxIterator | undefined {
  return getSandboxIterator(value);
}

async function closeIterator(iterator: SandboxIterator): Promise<void> {
  if (iterator.generator && iterator.return !== undefined) {
    await iterator.return();
  }
}

function defineSandboxProperty(
  target: SandboxArray | SandboxObject,
  key: string,
  value: SandboxValue
): void {
  Object.defineProperty(target, key, {
    configurable: true,
    enumerable: true,
    value,
    writable: true
  });
}

function isInterpreterError(value: unknown): value is InterpreterError {
  return (
    typeof value === "object" &&
    value !== null &&
    hasOwnProperty(value, "code") &&
    hasOwnProperty(value, "message") &&
    hasOwnProperty(value, "nodeType") &&
    hasOwnProperty(value, "span") &&
    (value.code === "UNBOUND_IDENTIFIER" || value.code === "UNSUPPORTED_NODE")
  );
}

function hasOwnProperty<Name extends PropertyKey>(
  value: object,
  name: Name
): value is Record<Name, unknown> {
  return Object.prototype.hasOwnProperty.call(value, name);
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

function isFatalSandboxError(error: unknown): error is SandboxError {
  return (
    error instanceof SandboxError && (error.code === "budgetExceeded" || error.code === "reentry")
  );
}

function isPromiseLikeResult(
  value: InterpreterValue | Promise<InterpreterValue> | PromiseLike<InterpreterValue>
): value is PromiseLike<InterpreterValue> {
  return typeof value === "object" && value !== null && "then" in value;
}

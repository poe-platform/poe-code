import type {
  ArrayPattern,
  AssignmentPattern,
  BlockStatement,
  CatchClause,
  BreakStatement,
  ContinueStatement,
  Identifier,
  MemberExpression,
  ObjectPattern,
  ParseResult,
  RestElement,
  ThrowStatement,
  TryStatement
} from "../parse.js";
import {
  attachErrorSpan,
  attachWrappedErrorCause,
  describeThrownValue,
  formatErrorStack,
  readErrorCause,
  readErrorSpan,
  sandboxErrorNames,
  sandboxErrorTypes,
  type SandboxErrorName,
  type ErrorSourceSpan
} from "../error/shape.js";
import { isFatalSandboxError, SandboxError, type Budget } from "./budget.js";
import { HostCallResumabilityError } from "./host-call.js";
import { withFatalPromiseCleanup } from "./promise-tracker.js";
import type { Scope } from "./scope.js";
import type { InterpreterError } from "./interpreter.js";
import { deepCopyToSandbox, type SandboxObject, type SandboxValue } from "./values.js";
import { getSandboxDataProperty, setSandboxPrototype } from "./object-model.js";
import { errorPrototypes } from "./error-prototypes.js";
import { internalSymbols } from "./internal-symbols.js";
import { containsResumeTarget } from "./resume-target.js";
import { evaluateResourceScope, resourceSuspension } from "./resource-management.js";
import { syntaxDiagnostics } from "../parse/syntax-diagnostic.js";
import type { AsyncSuspensionContext } from "./async.js";
import { StatementCompletion } from "./statement-completion.js";
import type { GeneratorExpressionState } from "./generator-expression-state.js";

const capturedExceptionBrand = Symbol("CapturedException");
export const referenceErrorDiagnostics = new WeakSet<object>();
const referenceErrorValues = new WeakMap<Budget, WeakMap<object, SandboxObject>>();

export function isSourceReferenceError(value: unknown): value is InterpreterError {
  return typeof value === "object" && value !== null && referenceErrorDiagnostics.has(value);
}
const readDOMExceptionCode = Object.getOwnPropertyDescriptor(DOMException.prototype, "code")?.get;
internalSymbols.add(capturedExceptionBrand);
export type { SandboxErrorName } from "../error/shape.js";

export type CompletionKind = "normal" | "return" | "throw" | "break" | "continue";

export type CompletionResult = {
  kind: CompletionKind;
  hasValue: boolean;
  span?: ErrorSourceSpan;
  stackFrames?: readonly string[];
  value: SandboxValue;
  // Internal expression state, not a guest value; only a contiguous chain consumes it.
  optionalChainShortCircuited?: true;
  label?: string;
  node?: BreakStatement | ContinueStatement;
};

export type EvaluationResult<TError> =
  | CompletionResult
  | {
      kind: "error";
      error: TError;
    };

type PatternBindingResult<TError> =
  | {
      ok: true;
    }
  | {
      ok: false;
      result: EvaluationResult<TError>;
    };

type CapturedException = {
  readonly reason: unknown;
  readonly sandbox: boolean;
  readonly stackFrames: readonly string[];
  readonly [capturedExceptionBrand]: true;
};

type ExceptionContext = AsyncSuspensionContext & {
  evalCompletion?: boolean;
  onSuspend?: () => void;
  signal?: AbortSignal;
  budget: Budget;
  callStack: readonly string[];
  scope: Scope;
  generatorYield?: unknown;
  generatorResume?: { yieldNodeId: number; completed?: boolean };
  generatorBlockScopes?: ReadonlyMap<number, Scope>;
  restoredGeneratorBlockScopes?: ReadonlyMap<number, Scope>;
  generatorExpressionStates?: ReadonlyMap<number, GeneratorExpressionState>;
  restoredGeneratorExpressionStates?: ReadonlyMap<number, GeneratorExpressionState>;
  finallyCompletions?: ReadonlyMap<number, CompletionResult>;
  restoredFinallyCompletions?: ReadonlyMap<number, CompletionResult>;
  toPropertyKey?: (value: SandboxValue) => string | symbol | Promise<string | symbol>;
  getProperty?: (value: SandboxValue, key: PropertyKey) => SandboxValue | Promise<SandboxValue>;
};

type EvaluateExceptionNode<TContext, TError> = (
  node: ParseResult,
  context: TContext
) => Promise<EvaluationResult<TError>>;

type BlockExceptionContext = ExceptionContext & {
  instantiateBlock(node: BlockStatement, scope: Scope): void;
};

type BindCatchParameter<TContext, TError> = (
  pattern: NonNullable<CatchClause["param"]>,
  value: SandboxValue,
  context: TContext
) => Promise<PatternBindingResult<TError>>;

export async function evaluateThrowStatement<TContext extends ExceptionContext, TError>(
  node: ThrowStatement,
  context: TContext,
  evaluateNode: EvaluateExceptionNode<TContext, TError>
): Promise<EvaluationResult<TError>> {
  const argument = await evaluateNode(node.argument, context);
  if (argument.kind !== "normal") {
    return argument;
  }

  return {
    kind: "throw",
    hasValue: true,
    span: node.span,
    stackFrames: context.callStack,
    value: argument.value
  };
}

export async function evaluateTryStatement<TContext extends BlockExceptionContext, TError>(
  node: TryStatement,
  context: TContext,
  evaluateNode: EvaluateExceptionNode<TContext, TError>,
  bindCatchParameter: BindCatchParameter<TContext, TError>
): Promise<EvaluationResult<TError>> {
  let fatalBudgetError: SandboxError | undefined;
  let tryResult: EvaluationResult<TError>;
  const resume = context.generatorResume;
  const resumeInCatch = resume !== undefined && resume.completed !== true && node.handler !== undefined &&
    containsResumeTarget(node.handler, new Set([resume.yieldNodeId]));
  const resumeInFinally = resume !== undefined && resume.completed !== true && node.finalizer !== undefined &&
    containsResumeTarget(node.finalizer, new Set([resume.yieldNodeId]));
  const pendingCompletion = node.nodeId === undefined ? undefined : context.restoredFinallyCompletions?.get(node.nodeId);
  if (resumeInFinally && pendingCompletion === undefined) throw new TypeError("Missing pending finally completion.");

  try {
    tryResult = resumeInFinally ? pendingCompletion! : resumeInCatch ? { kind: "normal", hasValue: false, value: undefined }
      : await evaluateBlockCompletion(node.block, context, evaluateNode);
  } catch (error) {
    if (!isBudgetExceeded(error) || node.finalizer === undefined) {
      throw error;
    }

    fatalBudgetError = error;
    tryResult = {
      kind: "throw",
      hasValue: true,
      value: undefined
    };
  }

  tryResult = sourceReferenceCompletion(tryResult, context);
  let tryOrCatchResult = tryResult;
  let catchFailure: CompletionResult | undefined;
  if (!resumeInFinally && fatalBudgetError === undefined && (resumeInCatch || tryResult.kind === "throw") && node.handler !== undefined) {
    try {
      tryOrCatchResult = await evaluateCatchClause(node.handler, "value" in tryResult ? tryResult.value : undefined, context, evaluateNode, bindCatchParameter);
    } catch (error) {
      if (isFatalSandboxError(error) || isInterpreterError(error) || error instanceof HostCallResumabilityError) {
        throw error;
      }
      catchFailure = createThrowCompletion(error, context.budget, context.callStack, node.span);
      tryOrCatchResult = catchFailure;
    }
  }

  tryOrCatchResult = sourceReferenceCompletion(tryOrCatchResult, context);
  if (node.finalizer === undefined || tryOrCatchResult.kind === "error") {
    return tryOrCatchResult;
  }

  const finalizerContext = node.nodeId === undefined || context.generatorYield === undefined ? context : {
    ...context,
    finallyCompletions: new Map([...(context.finallyCompletions ?? []), [node.nodeId, tryOrCatchResult]])
  };
  const evaluateFinalizer = () =>
    fatalBudgetError?.budget === "deadline"
      ? evaluateWithoutDeadlineChecks(context, () =>
          evaluateBlockCompletion(node.finalizer as BlockStatement, finalizerContext, evaluateNode)
        )
      : evaluateBlockCompletion(node.finalizer as BlockStatement, finalizerContext, evaluateNode);
  if (catchFailure !== undefined) {
    const value = catchFailure.value;
    context.budget.setRetainedValues(catchFailure, () => [value]);
  }
  try {
    const evaluatedFinalizer = await (fatalBudgetError === undefined
      ? evaluateFinalizer()
      : withFatalPromiseCleanup(evaluateFinalizer));

    if (fatalBudgetError !== undefined) {
      throw fatalBudgetError;
    }

    const finalizerResult = sourceReferenceCompletion(evaluatedFinalizer, context);
    if (finalizerResult.kind === "normal") {
      return tryOrCatchResult;
    }

    return finalizerResult;
  } finally {
    if (catchFailure !== undefined) context.budget.setRetainedValues(catchFailure, undefined);
  }
}

function sourceReferenceCompletion<TError>(result: EvaluationResult<TError>, context: ExceptionContext): EvaluationResult<TError> {
  if (result.kind !== "error" || !isInterpreterError(result.error) || result.error.code !== "UNBOUND_IDENTIFIER") return result;
  const {message, stack, span} = result.error;
  if (isSourceReferenceError(result.error)) return createThrowCompletion(result.error, context.budget, context.callStack, result.error.span);
  const error = new ReferenceError(message);
  error.stack = stack;
  return createThrowCompletion(error, context.budget, context.callStack, span);
}

export function createThrowCompletion(
  error: unknown,
  budget: Budget,
  stackFrames: readonly string[],
  span?: ErrorSourceSpan
): CompletionResult {
  const value = isCapturedException(error)
    ? coerceThrownValue(error.reason, budget, error.stackFrames, span, error.sandbox)
    : coerceThrownValue(error, budget, stackFrames, span, true);
  return {
    kind: "throw",
    hasValue: true,
    span: readErrorSpan(value) ?? span,
    stackFrames: isCapturedException(error) ? error.stackFrames : stackFrames,
    value
  };
}

export function isInterpreterError(value: unknown): value is InterpreterError {
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

export function createCapturedException(
  reason: unknown,
  stackFrames: readonly string[],
  sandbox = false
): CapturedException {
  return {
    reason,
    sandbox,
    stackFrames,
    [capturedExceptionBrand]: true
  };
}

export function isCapturedException(value: unknown): value is CapturedException {
  return typeof value === "object" && value !== null && capturedExceptionBrand in value;
}

export function coerceThrownValue(
  reason: unknown,
  budget: Budget,
  stackFrames: readonly string[],
  span?: ErrorSourceSpan,
  sandbox = false
): SandboxValue {
  if (reason instanceof HostCallResumabilityError) {
    throw reason;
  }

  if (isSourceReferenceError(reason)) {
    let values = referenceErrorValues.get(budget);
    if (values === undefined) {
      values = new WeakMap();
      referenceErrorValues.set(budget, values);
    }
    const existing = values.get(reason);
    if (existing !== undefined) return existing;
    const value = createSubsetErrorValue("ReferenceError", reason.message, stackFrames, budget, {
      chargeBudget: false, span: reason.span ?? span, stack: reason.stack
    });
    values.set(reason, value);
    return value;
  }

  if (isSubsetErrorValue(reason)) {
    attachErrorSpan(reason, readErrorSpan(reason) ?? span);
    return reason;
  }

  if (reason instanceof Error) {
    const diagnostic = syntaxDiagnostics.get(reason);
    const error = createSubsetErrorValue(reason.name || "Error", reason.message, stackFrames, budget, {
      chargeBudget: false,
      cause: readErrorCause(reason),
      span: diagnostic === undefined ? span : readErrorSpan(reason) ?? span
    });
    if (diagnostic !== undefined) Object.assign(error, diagnostic);
    if (readDOMExceptionCode !== undefined && reason instanceof DOMException)
      Object.defineProperty(error, "code", { value: Reflect.apply(readDOMExceptionCode, reason, []), enumerable: true });
    return error;
  }

  if (sandbox) {
    return reason as SandboxValue;
  }

  if (isErrorLikeValue(reason)) {
    return createSubsetErrorValue(reason.name || "Error", reason.message, stackFrames, budget, {
      chargeBudget: false,
      cause: readErrorCause(reason),
      span
    });
  }

  return deepCopyToSandbox(reason);
}

export function surfaceThrownValue(
  reason: unknown,
  budget: Budget,
  stackFrames: readonly string[] = [],
  span?: ErrorSourceSpan
): SandboxObject {
  if (reason instanceof HostCallResumabilityError) {
    throw reason;
  }

  if (isSubsetErrorValue(reason)) {
    return normalizeSurfacedSubsetError(reason, budget, stackFrames, span);
  }

  if (reason instanceof Error) {
    const error = createSubsetErrorValue(
      reason.name || "Error",
      reason.message,
      stackFrames,
      budget,
      {
        cause: reason,
        chargeBudget: false,
        span
      }
    );
    return normalizeSurfacedSubsetError(error, budget, stackFrames, span);
  }

  if (isErrorLikeValue(reason)) {
    const error = createSubsetErrorValue(
      reason.name || "Error",
      reason.message,
      stackFrames,
      budget,
      {
        cause: readErrorCause(reason),
        chargeBudget: false,
        span
      }
    );
    return normalizeSurfacedSubsetError(error, budget, stackFrames, span);
  }

  const error = createSubsetErrorValue("Error", describeThrownValue(reason), stackFrames, budget, {
    chargeBudget: false,
    span
  });
  return normalizeSurfacedSubsetError(error, budget, stackFrames, span);
}

export function createSubsetErrorValue(
  name: string,
  message: SandboxValue,
  stackFrames: readonly string[],
  budget: Budget,
  options: { cause?: unknown; chargeBudget?: boolean; span?: ErrorSourceSpan; transport?: boolean; stack?: string } = {}
): SandboxObject {
  const resumeChecks = options.chargeBudget === false ? budget.suspendChecks() : undefined;

  try {
    const errorName = budget.allocateString(name === "" ? "Error" : name);
    const errorMessage = budget.allocateString(coerceErrorMessage(message));
    const header = errorMessage === "" ? errorName : `${errorName}: ${errorMessage}`;
    const stack = budget.allocateString(options.stack ?? [header, ...[...stackFrames].reverse()].join("\n"));
    const prototype = options.transport ? undefined : errorPrototypes.get(budget)?.get(toSandboxErrorName(errorName));
    const error: SandboxObject = prototype === undefined ? { name: errorName, message: errorMessage, stack } : {};
    if (prototype !== undefined) {
      if (message !== undefined) Object.defineProperty(error, "message", { value: errorMessage, writable: true, configurable: true });
      if (!errorPrototypes.get(budget)!.has(errorName as SandboxErrorName))
        Object.defineProperty(error, "name", { value: errorName, writable: true, configurable: true });
      Object.defineProperty(error, "stack", { value: stack, writable: true, configurable: true });
      setSandboxPrototype(error, prototype, budget);
    }

    sandboxErrorTypes.set(error, toSandboxErrorName(errorName));
    attachErrorSpan(error, options.span);
    attachWrappedErrorCause(error, options.cause);
    return error;
  } finally {
    resumeChecks?.();
  }
}

export function isSandboxErrorConstructorInstance(
  value: SandboxValue,
  name: SandboxErrorName
): boolean {
  if (typeof value !== "object" || value === null) return false;
  const errorType = sandboxErrorTypes.get(value);
  return errorType !== undefined && (name === "Error" || name === errorType);
}

function toSandboxErrorName(name: string): SandboxErrorName {
  return sandboxErrorNames.includes(name as SandboxErrorName)
    ? (name as SandboxErrorName)
    : "Error";
}

function isSubsetErrorValue(value: unknown): value is SandboxObject {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  if (sandboxErrorTypes.has(value)) return true;

  const prototype = Object.getPrototypeOf(value);
  return (
    (prototype === Object.prototype || prototype === null) &&
    typeof (value as { name?: unknown }).name === "string" &&
    typeof (value as { message?: unknown }).message === "string" &&
    typeof (value as { stack?: unknown }).stack === "string"
  );
}

function normalizeSurfacedSubsetError(
  error: SandboxObject,
  budget: Budget,
  stackFrames: readonly string[],
  span: ErrorSourceSpan | undefined
): SandboxObject {
  const resumeChecks = budget.suspendChecks();

  try {
    const name = budget.allocateString(toSandboxErrorName(readErrorName(error)));
    const message = budget.allocateString(readSurfacedErrorMessage(error, name));
    const frames = readSandboxStackFrames(error.stack);
    if (!Object.isExtensible(error) || ["name", "message", "stack"].some(key => {
      const descriptor = Object.getOwnPropertyDescriptor(error, key);
      return descriptor !== undefined && (!("value" in descriptor) || !descriptor.writable);
    })) {
      // Public diagnostics must not mutate frozen guest state or invoke setters.
      const original = error;
      const descriptors = Object.getOwnPropertyDescriptors(original);
      delete descriptors.name;
      delete descriptors.message;
      delete descriptors.stack;
      error = Object.defineProperties({}, descriptors) as SandboxObject;
      const errorType = sandboxErrorTypes.get(original);
      if (errorType !== undefined) sandboxErrorTypes.set(error, errorType);
    }
    error.name = name;
    error.message = message;
    error.stack = budget.allocateString(
      formatErrorStack(name, message, frames.length > 0 ? frames : [...stackFrames].reverse())
    );
    attachErrorSpan(error, readErrorSpan(error) ?? span);
    return error;
  } finally {
    resumeChecks();
  }
}

function readErrorName(error: SandboxObject): string {
  const name = getSandboxDataProperty(error, "name");
  return typeof name === "string" && name.length > 0 ? name : sandboxErrorTypes.get(error) ?? "Error";
}

function readSurfacedErrorMessage(error: SandboxObject, name: string): string {
  const value = getSandboxDataProperty(error, "message");
  const message = typeof value === "string" ? value : "";

  if (message === "") {
    return `${name} thrown`;
  }

  if (message === "[object Object]") {
    return `${name} thrown with non-string message`;
  }

  return message;
}

function readSandboxStackFrames(stack: unknown): string[] {
  if (typeof stack !== "string") {
    return [];
  }

  const [, ...frames] = stack.split("\n");
  return frames;
}

function isErrorLikeValue(value: unknown): value is { message: string; name: string } {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as { name?: unknown }).name === "string" &&
    typeof (value as { message?: unknown }).message === "string"
  );
}

function coerceErrorMessage(message: SandboxValue): string {
  if (message === undefined) {
    return "";
  }

  if (Array.isArray(message)) {
    return message
      .map((value) => (value === null || value === undefined ? "" : String(value)))
      .join(",");
  }

  if (typeof message === "object" && message !== null) {
    return "[object Object]";
  }

  return String(message);
}

async function evaluateWithoutDeadlineChecks<TValue>(
  context: ExceptionContext,
  evaluate: () => Promise<TValue>
): Promise<TValue> {
  const resumeDeadlineChecks = context.budget.suspendDeadlineChecks();

  try {
    return await evaluate();
  } finally {
    resumeDeadlineChecks();
  }
}

function isBudgetExceeded(error: unknown): error is SandboxError {
  return error instanceof SandboxError && error.code === "budgetExceeded";
}

async function evaluateCatchClause<TContext extends BlockExceptionContext, TError>(
  node: CatchClause,
  thrownValue: SandboxValue,
  context: TContext,
  evaluateNode: EvaluateExceptionNode<TContext, TError>,
  bindCatchParameter: BindCatchParameter<TContext, TError>
): Promise<EvaluationResult<TError>> {
  const resuming = context.generatorResume !== undefined && context.generatorResume.completed !== true;
  const restoredScope = !resuming || node.nodeId === undefined
    ? undefined : context.restoredGeneratorBlockScopes?.get(node.nodeId);
  const scope = restoredScope ?? context.scope.child({}, node.param?.type === "Identifier"
    ? {simpleCatchParameter: node.param.name} : {});
  const catchContext = {
    ...context,
    scope
  };
  if (resuming && node.body.nodeId !== undefined && context.restoredGeneratorBlockScopes?.has(node.body.nodeId))
    return evaluateBlockCompletion(node.body, catchContext, evaluateNode);

  if (node.param !== undefined) {
    for (const name of restoredScope === undefined ? getPatternBindingNames(node.param) : []) {
      scope.predeclare(name, "let");
    }
    const saved = !resuming || node.nodeId === undefined ? undefined
      : context.restoredGeneratorExpressionStates?.get(node.nodeId);
    if (saved !== undefined && saved.kind !== "pattern-source") throw new TypeError("Invalid catch binding source.");
    const value = saved === undefined ? thrownValue : saved.value;
    const bindingContext = context.generatorYield === undefined || node.nodeId === undefined ? catchContext : {
      ...catchContext,
      generatorBlockScopes: new Map([...(context.generatorBlockScopes ?? []), [node.nodeId, scope]]),
      generatorExpressionStates: new Map([...(context.generatorExpressionStates ?? []),
        [node.nodeId, {kind: "pattern-source" as const, value}]])
    };
    const binding = await bindCatchParameter(node.param, value, bindingContext);
    if (!binding.ok) {
      return binding.result;
    }
  }

  return evaluateBlockCompletion(node.body, catchContext, evaluateNode);
}

async function evaluateBlockCompletion<TContext extends BlockExceptionContext, TError>(
  node: BlockStatement,
  context: TContext,
  evaluateNode: EvaluateExceptionNode<TContext, TError>
): Promise<EvaluationResult<TError>> {
  const restoredScope = context.generatorResume === undefined || context.generatorResume.completed === true || node.nodeId === undefined
    ? undefined : context.restoredGeneratorBlockScopes?.get(node.nodeId);
  const scope = restoredScope ?? context.scope.child();
  const blockContext = {
    ...context,
    scope,
    ...(context.generatorYield === undefined || node.nodeId === undefined ? {} : {
      generatorBlockScopes: new Map([...(context.generatorBlockScopes ?? []), [node.nodeId, scope]])
    })
  };
  if (restoredScope === undefined) context.instantiateBlock(node, blockContext.scope);
  const completion = context.evalCompletion ? new StatementCompletion(context.budget) : undefined;
  const evaluation = evaluateResourceScope(scope, context.budget, {...resourceSuspension(blockContext, node), stack: context.callStack, thisValue: undefined, getProperty: context.getProperty, onSuspend: context.onSuspend, signal: context.signal}, async () => {
  let result: EvaluationResult<TError> = {
    kind: "normal",
    hasValue: false,
    value: undefined
  };

  const resume = context.generatorResume;
  const resumeIndex = resume === undefined || resume.completed === true ? -1
    : node.body.findIndex(statement => containsResumeTarget(statement, new Set([resume.yieldNodeId])));
  for (let index = Math.max(0, resumeIndex); index < node.body.length; index++) {
    const statement = node.body[index];
    result = await evaluateNode(statement, blockContext);
    if (completion !== undefined) result = completion.update(result);
    if (result.kind !== "normal") {
      return result;
    }
  }

  return completion?.normal() ?? result;
  });
  if (completion === undefined) return evaluation;
  try { return await evaluation; } finally { completion.close(); }
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

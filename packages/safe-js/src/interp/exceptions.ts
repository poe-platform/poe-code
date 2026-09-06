import type {
  ArrayPattern,
  AssignmentPattern,
  AssignmentProperty,
  BlockStatement,
  CatchClause,
  BreakStatement,
  ContinueStatement,
  Expression,
  Identifier,
  MemberExpression,
  ObjectPattern,
  ParseResult,
  RestElement,
  ThrowStatement,
  TryStatement,
  VariableDeclaration
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
import { deepCopyToSandbox, ownEnumerableSandboxKeys, type SandboxObject, type SandboxValue } from "./values.js";
import { hasOwnSandboxProperty } from "./globals/object.js";
import { retainValues } from "./resources.js";
import { getSandboxDataProperty } from "./object-model.js";
import { toPropertyKey } from "./property-key.js";
import { internalSymbols } from "./internal-symbols.js";
import { containsResumeTarget } from "./resume-target.js";

const capturedExceptionBrand = Symbol("CapturedException");
internalSymbols.add(capturedExceptionBrand);
export type { SandboxErrorName } from "../error/shape.js";

export type CompletionKind = "normal" | "return" | "throw" | "break" | "continue";

export type CompletionResult = {
  kind: CompletionKind;
  hasValue: boolean;
  span?: ErrorSourceSpan;
  stackFrames?: readonly string[];
  value: SandboxValue;
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

type ExceptionContext = {
  budget: Budget;
  callStack: readonly string[];
  scope: Scope;
  generatorYield?: unknown;
  generatorResume?: { yieldNodeId: number; completed?: boolean };
  generatorBlockScopes?: ReadonlyMap<number, Scope>;
  restoredGeneratorBlockScopes?: ReadonlyMap<number, Scope>;
  finallyCompletions?: ReadonlyMap<number, CompletionResult>;
  restoredFinallyCompletions?: ReadonlyMap<number, CompletionResult>;
  toPropertyKey?: (value: SandboxValue) => string | symbol | Promise<string | symbol>;
  getProperty?: (value: SandboxValue, key: PropertyKey) => SandboxValue | Promise<SandboxValue>;
};

type EvaluateExceptionNode<TContext, TError> = (
  node: ParseResult,
  context: TContext
) => Promise<EvaluationResult<TError>>;

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

export async function evaluateTryStatement<TContext extends ExceptionContext, TError>(
  node: TryStatement,
  context: TContext,
  evaluateNode: EvaluateExceptionNode<TContext, TError>
): Promise<EvaluationResult<TError>> {
  let fatalBudgetError: SandboxError | undefined;
  let tryResult: EvaluationResult<TError>;
  const resume = context.generatorResume;
  const resumeInCatch = resume !== undefined && resume.completed !== true && node.handler !== undefined &&
    containsResumeTarget(node.handler.body, new Set([resume.yieldNodeId]));
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

  let tryOrCatchResult = tryResult;
  let catchFailure: CompletionResult | undefined;
  if (!resumeInFinally && fatalBudgetError === undefined && (resumeInCatch || tryResult.kind === "throw") && node.handler !== undefined) {
    try {
      tryOrCatchResult = await evaluateCatchClause(node.handler, "value" in tryResult ? tryResult.value : undefined, context, evaluateNode);
    } catch (error) {
      if (isFatalSandboxError(error) || isInterpreterError(error) || error instanceof HostCallResumabilityError) {
        throw error;
      }
      catchFailure = createThrowCompletion(error, context.budget, context.callStack, node.span);
      tryOrCatchResult = catchFailure;
    }
  }

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
    const finalizerResult = await (fatalBudgetError === undefined
      ? evaluateFinalizer()
      : withFatalPromiseCleanup(evaluateFinalizer));

    if (fatalBudgetError !== undefined) {
      throw fatalBudgetError;
    }

    if (finalizerResult.kind === "normal") {
      return tryOrCatchResult;
    }

    return finalizerResult;
  } finally {
    if (catchFailure !== undefined) context.budget.setRetainedValues(catchFailure, undefined);
  }
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

  if (isSubsetErrorValue(reason)) {
    attachErrorSpan(reason, readErrorSpan(reason) ?? span);
    return reason;
  }

  if (reason instanceof Error) {
    return createSubsetErrorValue(reason.name || "Error", reason.message, stackFrames, budget, {
      chargeBudget: false,
      cause: readErrorCause(reason),
      span
    });
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
    normalizeSurfacedSubsetError(reason, budget, stackFrames, span);
    return reason;
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
    normalizeSurfacedSubsetError(error, budget, stackFrames, span);
    return error;
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
    normalizeSurfacedSubsetError(error, budget, stackFrames, span);
    return error;
  }

  return createSubsetErrorValue("Error", describeThrownValue(reason), stackFrames, budget, {
    chargeBudget: false,
    span
  });
}

export function createSubsetErrorValue(
  name: string,
  message: SandboxValue,
  stackFrames: readonly string[],
  budget: Budget,
  options: { cause?: unknown; chargeBudget?: boolean; span?: ErrorSourceSpan } = {}
): SandboxObject {
  const resumeChecks = options.chargeBudget === false ? budget.suspendChecks() : undefined;

  try {
    const errorName = budget.allocateString(name === "" ? "Error" : name);
    const errorMessage = budget.allocateString(coerceErrorMessage(message));
    const header = errorMessage === "" ? errorName : `${errorName}: ${errorMessage}`;
    const stack = budget.allocateString([header, ...[...stackFrames].reverse()].join("\n"));
    const error = {
      name: errorName,
      message: errorMessage,
      stack
    };

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
): void {
  const resumeChecks = budget.suspendChecks();

  try {
    const name = budget.allocateString(toSandboxErrorName(readErrorName(error)));
    const message = budget.allocateString(readSurfacedErrorMessage(error, name));
    const frames = readSandboxStackFrames(error.stack);
    error.name = name;
    error.message = message;
    error.stack = budget.allocateString(
      formatErrorStack(name, message, frames.length > 0 ? frames : [...stackFrames].reverse())
    );
    attachErrorSpan(error, readErrorSpan(error) ?? span);
  } finally {
    resumeChecks();
  }
}

function readErrorName(error: SandboxObject): string {
  return typeof error.name === "string" && error.name.length > 0 ? error.name : "Error";
}

function readSurfacedErrorMessage(error: SandboxObject, name: string): string {
  const message = typeof error.message === "string" ? error.message : "";

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

async function evaluateCatchClause<TContext extends ExceptionContext, TError>(
  node: CatchClause,
  thrownValue: SandboxValue,
  context: TContext,
  evaluateNode: EvaluateExceptionNode<TContext, TError>
): Promise<EvaluationResult<TError>> {
  if (context.generatorResume !== undefined && context.generatorResume.completed !== true &&
      node.body.nodeId !== undefined && context.restoredGeneratorBlockScopes?.has(node.body.nodeId))
    return evaluateBlockCompletion(node.body, context, evaluateNode);
  const scope = context.scope.child();
  const catchContext = {
    ...context,
    scope
  };

  if (node.param !== undefined) {
    for (const name of getPatternBindingNames(node.param)) {
      scope.predeclare(name, "let");
    }
    const binding = await bindPattern(node.param, thrownValue, catchContext, evaluateNode);
    if (!binding.ok) {
      return binding.result;
    }
  }

  return evaluateBlockCompletion(node.body, catchContext, evaluateNode);
}

async function evaluateBlockCompletion<TContext extends ExceptionContext, TError>(
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
  if (restoredScope === undefined) predeclareBlockBindings(node, blockContext.scope);
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
    if (result.kind !== "normal") {
      return result;
    }
  }

  return result;
}

function predeclareBlockBindings(node: BlockStatement, scope: Scope): void {
  const names = new Set<string>();

  for (const statement of node.body) {
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

async function bindPattern<TContext extends ExceptionContext, TError>(
  pattern:
    | ArrayPattern
    | AssignmentPattern
    | Identifier
    | MemberExpression
    | ObjectPattern
    | RestElement,
  value: SandboxValue,
  context: TContext,
  evaluateNode: EvaluateExceptionNode<TContext, TError>
): Promise<PatternBindingResult<TError>> {
  switch (pattern.type) {
    case "Identifier":
      context.scope.declare(pattern.name, "let", value);
      return { ok: true };
    case "MemberExpression":
      throw new TypeError("Catch bindings do not support member expressions.");
    case "AssignmentPattern":
      return bindAssignmentPattern(pattern, value, context, evaluateNode);
    case "ArrayPattern":
      return bindArrayPattern(pattern, value, context, evaluateNode);
    case "ObjectPattern":
      return bindObjectPattern(pattern, value, context, evaluateNode);
    case "RestElement":
      return bindPattern(pattern.argument, value, context, evaluateNode);
  }
}

async function bindAssignmentPattern<TContext extends ExceptionContext, TError>(
  pattern: AssignmentPattern,
  value: SandboxValue,
  context: TContext,
  evaluateNode: EvaluateExceptionNode<TContext, TError>
): Promise<PatternBindingResult<TError>> {
  let nextValue = value;

  if (nextValue === undefined) {
    const defaultValue = await evaluateNode(pattern.right, {
      ...context,
      inferredName: pattern.left.type === "Identifier" ? pattern.left.name : undefined
    });
    if (defaultValue.kind !== "normal") {
      return {
        ok: false,
        result: defaultValue
      };
    }

    nextValue = defaultValue.value;
  }

  return bindPattern(pattern.left, nextValue, context, evaluateNode);
}

async function bindArrayPattern<TContext extends ExceptionContext, TError>(
  pattern: ArrayPattern,
  value: SandboxValue,
  context: TContext,
  evaluateNode: EvaluateExceptionNode<TContext, TError>
): Promise<PatternBindingResult<TError>> {
  if (!Array.isArray(value)) {
    throw new TypeError("Array catch bindings require an array value.");
  }

  let cursor = 0;
  let done = false;
  const next = async (): Promise<IteratorResult<SandboxValue>> => {
    if (done || cursor >= value.length) {
      done = true;
      return { done: true, value: undefined };
    }
    const key = cursor++;
    return {
      done: false,
      value:
        context.getProperty === undefined
          ? getSandboxDataProperty(value, key, context.budget)
          : await context.getProperty(value, key)
    };
  };

  for (let index = 0; index < pattern.elements.length; index += 1) {
    const element = pattern.elements[index];
    if (element === null) {
      await next();
      continue;
    }

    let elementValue: SandboxValue;
    if (element.type === "RestElement") {
      const rest: SandboxValue[] = [];
      for (let entry = await next(); !entry.done; entry = await next()) {
        context.budget.allocateArrayLength(rest.length + 1);
        rest.push(entry.value);
      }
      elementValue = rest;
    } else elementValue = (await next()).value;
    const binding = await bindPattern(element, elementValue, context, evaluateNode);
    if (!binding.ok) {
      return binding;
    }
  }

  return { ok: true };
}

async function bindObjectPattern<TContext extends ExceptionContext, TError>(
  pattern: ObjectPattern,
  value: SandboxValue,
  context: TContext,
  evaluateNode: EvaluateExceptionNode<TContext, TError>
): Promise<PatternBindingResult<TError>> {
  if (value === null || value === undefined) {
    throw new TypeError("Object catch bindings require a non-nullish value.");
  }

  const excludedKeys = new Set<PropertyKey>();

  for (const property of pattern.properties) {
    if (property.type === "RestElement") {
      const restValue = await copyObjectRest(value, excludedKeys, context);
      const binding = await bindPattern(property, restValue, context, evaluateNode);
      if (!binding.ok) {
        return binding;
      }

      continue;
    }

    const key = await resolvePatternPropertyKey(property, context, evaluateNode);
    if (!key.ok) {
      return key;
    }

    excludedKeys.add(typeof key.value === "symbol" ? key.value : String(key.value));
    const binding = await bindPattern(
      property.value,
      context.getProperty === undefined
        ? getSandboxDataProperty(value, key.value, context.budget)
        : await context.getProperty(value, key.value),
      context,
      evaluateNode
    );
    if (!binding.ok) {
      return binding;
    }
  }

  return { ok: true };
}

async function resolvePatternPropertyKey<TContext extends ExceptionContext, TError>(
  property: AssignmentProperty,
  context: TContext,
  evaluateNode: EvaluateExceptionNode<TContext, TError>
): Promise<
  | {
      ok: true;
      value: PropertyKey;
    }
  | {
      ok: false;
      result: EvaluationResult<TError>;
    }
> {
  if (!property.computed) {
    return {
      ok: true,
      value: getStaticPropertyKey(property.key)
    };
  }

  const computedKey = await evaluateNode(property.key as Expression, context);
  if (computedKey.kind !== "normal") {
    return {
      ok: false,
      result: computedKey
    };
  }

  return {
    ok: true,
    value: await (context.toPropertyKey?.(computedKey.value) ?? toPropertyKey(
      computedKey.value,
      context.budget,
      { stack: context.callStack, thisValue: undefined }
    ))
  };
}

function getStaticPropertyKey(property: AssignmentProperty["key"]): string | number {
  switch (property.type) {
    case "Identifier":
      return property.name;
    case "StringLiteral":
    case "NumericLiteral":
      return property.value;
    default:
      throw new TypeError(`Unsupported catch binding property key '${property.type}'.`);
  }
}

async function copyObjectRest(
  value: Exclude<SandboxValue, null | undefined>,
  excludedKeys: ReadonlySet<PropertyKey>,
  context: ExceptionContext
): Promise<SandboxObject> {
  const rest = Object.create(null) as SandboxObject;
  const release = retainValues(context.budget, () => [value, rest]);
  try {
    for (const key of ownEnumerableSandboxKeys(value, true)) {
      if (excludedKeys.has(key) || !hasOwnSandboxProperty(value, key, true)) continue;
      rest[key] =
        context.getProperty === undefined
          ? getSandboxDataProperty(value, key, context.budget)
          : await context.getProperty(value, key);
    }

    return rest;
  } finally {
    release();
  }
}

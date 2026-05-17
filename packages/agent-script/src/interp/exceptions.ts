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
  TryStatement
} from "../parse.js";
import type { Budget } from "./budget.js";
import type { Scope } from "./scope.js";
import { deepCopyToSandbox, type SandboxObject, type SandboxValue } from "./values.js";

const capturedExceptionBrand = Symbol("CapturedException");

export type CompletionKind = "normal" | "return" | "throw" | "break" | "continue";

export type CompletionResult = {
  kind: CompletionKind;
  hasValue: boolean;
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
  readonly stackFrames: readonly string[];
  readonly [capturedExceptionBrand]: true;
};

type ExceptionContext = {
  budget: Budget;
  callStack: readonly string[];
  scope: Scope;
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
    value: argument.value
  };
}

export async function evaluateTryStatement<TContext extends ExceptionContext, TError>(
  node: TryStatement,
  context: TContext,
  evaluateNode: EvaluateExceptionNode<TContext, TError>
): Promise<EvaluationResult<TError>> {
  const tryResult = await evaluateBlockCompletion(node.block, context, evaluateNode);
  const tryOrCatchResult =
    tryResult.kind === "throw" && node.handler !== undefined
      ? await evaluateCatchClause(node.handler, tryResult.value, context, evaluateNode)
      : tryResult;

  if (node.finalizer === undefined || tryOrCatchResult.kind === "error") {
    return tryOrCatchResult;
  }

  const finalizerResult = await evaluateBlockCompletion(node.finalizer, context, evaluateNode);
  if (finalizerResult.kind === "normal") {
    return tryOrCatchResult;
  }

  return finalizerResult;
}

export function createCapturedException(reason: unknown, stackFrames: readonly string[]): CapturedException {
  return {
    reason,
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
  stackFrames: readonly string[]
): SandboxValue {
  if (reason instanceof Error) {
    return createSubsetErrorValue(reason.name || "Error", reason.message, stackFrames, budget);
  }

  return deepCopyToSandbox(reason);
}

export function createSubsetErrorValue(
  name: string,
  message: SandboxValue,
  stackFrames: readonly string[],
  budget: Budget
): SandboxObject {
  const errorName = budget.allocateString(name === "" ? "Error" : name);
  const errorMessage = budget.allocateString(message === undefined ? "" : String(message));
  const header = errorMessage === "" ? errorName : `${errorName}: ${errorMessage}`;
  const stack = budget.allocateString([header, ...[...stackFrames].reverse()].join("\n"));

  return {
    name: errorName,
    message: errorMessage,
    stack
  };
}

async function evaluateCatchClause<TContext extends ExceptionContext, TError>(
  node: CatchClause,
  thrownValue: SandboxValue,
  context: TContext,
  evaluateNode: EvaluateExceptionNode<TContext, TError>
): Promise<EvaluationResult<TError>> {
  const scope = context.scope.child();
  const catchContext = {
    ...context,
    scope
  };

  if (node.param !== undefined) {
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
  let result: EvaluationResult<TError> = {
    kind: "normal",
    hasValue: false,
    value: undefined
  };

  for (const statement of node.body) {
    result = await evaluateNode(statement, context);
    if (result.kind !== "normal") {
      return result;
    }
  }

  return result;
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
      context.scope.declare(pattern.name, "const", value);
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
    const defaultValue = await evaluateNode(pattern.right, context);
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

  for (let index = 0; index < pattern.elements.length; index += 1) {
    const element = pattern.elements[index];
    if (element === null) {
      continue;
    }

    const elementValue =
      element.type === "RestElement" ? value.slice(index) : (value[index] as SandboxValue);
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
  if ((typeof value !== "object" && !Array.isArray(value)) || value === null) {
    throw new TypeError("Object catch bindings require a non-null object value.");
  }

  const excludedKeys = new Set<string>();

  for (const property of pattern.properties) {
    if (property.type === "RestElement") {
      const restValue = copyObjectRest(value, excludedKeys);
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

    excludedKeys.add(String(key.value));
    const binding = await bindPattern(
      property.value,
      getObjectPatternValue(value, key.value),
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
      value: string | number;
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

  if (typeof computedKey.value !== "string" && typeof computedKey.value !== "number") {
    throw new TypeError("Computed catch binding keys must evaluate to a string or number.");
  }

  return {
    ok: true,
    value: computedKey.value
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

function getObjectPatternValue(value: Exclude<SandboxValue, null | undefined>, key: string | number): SandboxValue {
  return (value as Record<string | number, SandboxValue>)[key];
}

function copyObjectRest(
  value: Exclude<SandboxValue, null | undefined>,
  excludedKeys: ReadonlySet<string>
): SandboxObject {
  const rest: SandboxObject = {};

  for (const [key, entryValue] of Object.entries(value)) {
    if (excludedKeys.has(key)) {
      continue;
    }

    rest[key] = entryValue;
  }

  return rest;
}

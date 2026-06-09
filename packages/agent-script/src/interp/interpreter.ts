import type {
  ArrayExpression,
  ArrayPattern,
  AssignmentPattern,
  AssignmentProperty,
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
  ForOfStatement,
  ForStatement,
  IfStatement,
  LogicalExpression,
  MemberExpression,
  MetaProperty,
  NullLiteral,
  NumericLiteral,
  ObjectExpression,
  ObjectPattern,
  ParseResult,
  Property,
  BreakStatement,
  ReturnStatement,
  SequenceExpression,
  SourceSpan,
  SpreadElement,
  StringLiteral,
  TaggedTemplateExpression,
  TemplateLiteral,
  ThrowStatement,
  TryStatement,
  UnaryExpression,
  UndefinedLiteral,
  UpdateExpression,
  ExpressionStatement,
  VariableDeclaration,
  VariableDeclarationKind,
  VariableDeclarator,
  RestElement,
  WhileStatement
} from "../parse.js";
import {
  attachErrorSpan,
  formatErrorStack,
  readErrorSpan,
  replaceErrorStack
} from "../error/shape.js";
import {
  evaluateArrowFunctionExpression,
  evaluateAwaitExpression,
  normalizeClosureResult,
  resolveClosureResult,
  type AsyncEvaluationContext,
  type AsyncEvaluationResult,
  type InterpreterYieldPoint
} from "./async.js";
import { Budget, SandboxError } from "./budget.js";
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
import { callNumberMethod, getNumberMember, isNumberMethodName } from "./methods/number.js";
import { getPromiseMember } from "./promise.js";
import {
  callStringMethod,
  getStringMember,
  isStringMethodName,
  validateStringMethodArguments
} from "./methods/string.js";
import { isSandboxErrorConstructorInstance } from "./globals/error.js";
import {
  isSandboxClosure,
  isSandboxPromise,
  type SandboxArray,
  type SandboxClosure,
  type SandboxObject,
  type SandboxPrimitive,
  type SandboxValue
} from "./values.js";
import { Scope } from "./scope.js";

export type InterpreterValue = SandboxValue;

export type InterpreterStats = {
  nodeVisits: number;
};

export type InterpreterSnapshot = {
  bindings: Record<string, InterpreterValue>;
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
  bindings?: Record<string, InterpreterValue>;
  budget?: Budget;
  onYield?: (yieldPoint: InterpreterYieldPoint) => void;
  scope?: Scope;
  surfaceUnhandledThrows?: boolean;
  useScopeDirectly?: boolean;
};

type EvaluationContext = AsyncEvaluationContext;

type EvaluationResult = AsyncEvaluationResult;

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
  ForOfStatement: evaluateForOfStatement,
  ForStatement: evaluateForStatement,
  IfStatement: evaluateIfStatement,
  Identifier: evaluateIdentifier,
  LogicalExpression: evaluateLogicalExpression,
  MemberExpression: evaluateMemberExpression,
  MetaProperty: evaluateMetaProperty,
  NullLiteral: evaluatePrimitiveLiteral,
  NumericLiteral: evaluatePrimitiveLiteral,
  ObjectExpression: evaluateObjectExpression,
  BreakStatement: evaluateBreakStatement,
  ReturnStatement: evaluateReturnStatement,
  SequenceExpression: evaluateSequenceExpression,
  StringLiteral: evaluatePrimitiveLiteral,
  TaggedTemplateExpression: evaluateTaggedTemplateExpression,
  TemplateLiteral: evaluateTemplateLiteral,
  ThrowStatement: evaluateThrowStatement,
  TryStatement: evaluateTryStatement,
  UnaryExpression: evaluateUnaryExpression,
  UpdateExpression: evaluateUpdateExpression,
  VariableDeclaration: evaluateVariableDeclaration,
  WhileStatement: evaluateWhileStatement,
  UndefinedLiteral: evaluatePrimitiveLiteral
};

export async function interpret(
  node: ParseResult,
  options: InterpretOptions = {}
): Promise<InterpreterResult> {
  const budget = options.budget ?? new Budget();
  const scope =
    options.scope === undefined
      ? new Scope(options.bindings)
      : options.useScopeDirectly === true && options.bindings === undefined
        ? options.scope
        : options.scope.child(options.bindings ?? {});
  const stats: InterpreterStats = {
    nodeVisits: 0
  };
  const evaluation = await evaluateNode(node, {
    budget,
    callStack: [],
    onYield: options.onYield,
    rootNode: node,
    scope,
    stats
  });
  const snapshot = scope.snapshot();

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
}

export { Scope } from "./scope.js";

async function evaluateNode(
  node: ParseResult,
  context: EvaluationContext
): Promise<EvaluationResult> {
  context.budget.visitNode();
  context.stats.nodeVisits += 1;

  const handler = dispatchTable[node.type];
  if (handler === undefined) {
    return {
      kind: "error",
      error: createError("UNSUPPORTED_NODE", node, `Unsupported AST node type '${node.type}'.`)
    };
  }

  try {
    return await handler(node as never, context);
  } catch (error) {
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
      ? coerceThrownValue(error.reason, context.budget, error.stackFrames, node.span)
      : coerceThrownValue(error, context.budget, context.callStack, node.span);

    return {
      kind: "throw",
      hasValue: true,
      span: readErrorSpan(exception) ?? node.span,
      stackFrames: isCapturedException(error) ? error.stackFrames : context.callStack,
      value: exception
    };
  }
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
    if (element.type === "SpreadElement") {
      const spreadValues = await evaluateSpreadElement(element, context);
      if (!spreadValues.ok) {
        return spreadValues.result;
      }

      values.push(...spreadValues.value);
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

    defineSandboxProperty(object, String(key.value), value.value);
  }

  return {
    kind: "normal",
    hasValue: true,
    value: object
  };
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
    context.budget.allocateString(quasi.value.cooked)
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

  return strings;
}

async function evaluateArrowFunction(
  node: ArrowFunctionExpression,
  context: EvaluationContext
): Promise<EvaluationResult> {
  return evaluateArrowFunctionExpression(node, context, evaluateNode);
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

  const value = applyBinaryOperator(node, left.value, right.value, context);

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

  const binding = context.scope.lookup(node.left.name);
  if (!binding.found) {
    throw new ReferenceError(`Cannot assign to undeclared binding '${node.left.name}'.`);
  }

  if (binding.kind === "const") {
    throw new Error(`Cannot assign to const '${node.left.name}'`);
  }

  if (node.operator === "&&=" && !isTruthy(binding.value)) {
    return {
      kind: "normal",
      hasValue: true,
      value: binding.value
    };
  }

  if (node.operator === "||=" && isTruthy(binding.value)) {
    return {
      kind: "normal",
      hasValue: true,
      value: binding.value
    };
  }

  if (node.operator === "??=" && binding.value !== null && binding.value !== undefined) {
    return {
      kind: "normal",
      hasValue: true,
      value: binding.value
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
      : applyCompoundAssignmentOperator(node.operator, binding.value, right.value, context);

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
  if (!isIndexableSandboxValue(member.object)) {
    throw new TypeError("Assignment expressions require a sandbox object property.");
  }

  if (node.operator === "&&=" && !isTruthy(getMemberValue(member.object, member.property))) {
    return {
      kind: "normal",
      hasValue: true,
      value: getMemberValue(member.object, member.property)
    };
  }

  if (node.operator === "||=" && isTruthy(getMemberValue(member.object, member.property))) {
    return {
      kind: "normal",
      hasValue: true,
      value: getMemberValue(member.object, member.property)
    };
  }

  if (
    node.operator === "??=" &&
    getMemberValue(member.object, member.property) !== null &&
    getMemberValue(member.object, member.property) !== undefined
  ) {
    return {
      kind: "normal",
      hasValue: true,
      value: getMemberValue(member.object, member.property)
    };
  }

  const right = await evaluateNode(node.right, context);
  if (right.kind !== "normal") {
    return right;
  }

  const current = getMemberValue(member.object, member.property);
  const value =
    node.operator === "=" ||
    node.operator === "&&=" ||
    node.operator === "||=" ||
    node.operator === "??="
      ? right.value
      : applyCompoundAssignmentOperator(node.operator, current, right.value, context);

  setSandboxProperty(member.object, member.property, value);

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
    if (node.name === "this") {
      return {
        kind: "normal",
        hasValue: true,
        value: undefined
      };
    }

    return {
      kind: "error",
      error: createError("UNBOUND_IDENTIFIER", node, `Identifier '${node.name}' is not defined.`)
    };
  }

  return {
    kind: "normal",
    hasValue: true,
    value: binding.value
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
  predeclareDeclarationBindings(node, context.scope);

  for (const declarator of node.declarations) {
    const value =
      declarator.init === undefined
        ? {
            kind: "normal" as const,
            hasValue: true as const,
            value: undefined
          }
        : await evaluateNode(declarator.init, context);

    if (value.kind !== "normal") {
      return value;
    }

    const binding = await bindDeclarationPattern(declarator.id, value.value, node.kind, context);
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

async function bindDeclarationPattern(
  pattern: VariableDeclarator["id"] | AssignmentPattern | MemberExpression | RestElement,
  value: SandboxValue,
  kind: VariableDeclarationKind,
  context: EvaluationContext
): Promise<
  | {
      ok: true;
    }
  | {
      ok: false;
      result: EvaluationResult;
    }
> {
  switch (pattern.type) {
    case "Identifier":
      context.scope.declare(pattern.name, kind, value);
      return { ok: true };
    case "MemberExpression":
      throw new TypeError("Destructuring declarations cannot bind to member expressions.");
    case "AssignmentPattern":
      return bindDeclarationAssignmentPattern(pattern, value, kind, context);
    case "ArrayPattern":
      return bindDeclarationArrayPattern(pattern, value, kind, context);
    case "ObjectPattern":
      return bindDeclarationObjectPattern(pattern, value, kind, context);
    case "RestElement":
      return bindDeclarationPattern(pattern.argument, value, kind, context);
  }
}

function predeclareDeclarationBindings(node: VariableDeclaration, scope: Scope): void {
  for (const name of getDeclarationBindingNames(node)) {
    if (!scope.hasOwnBinding(name)) {
      scope.predeclare(name, node.kind);
    }
  }
}

function getForStatementBindingNames(node: ForStatement): string[] {
  return node.init?.type === "VariableDeclaration" ? getDeclarationBindingNames(node.init) : [];
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

async function bindDeclarationAssignmentPattern(
  pattern: AssignmentPattern,
  value: SandboxValue,
  kind: VariableDeclarationKind,
  context: EvaluationContext
): Promise<
  | {
      ok: true;
    }
  | {
      ok: false;
      result: EvaluationResult;
    }
> {
  if (value !== undefined) {
    return bindDeclarationPattern(pattern.left, value, kind, context);
  }

  const defaultValue = await evaluateNode(pattern.right, context);
  if (defaultValue.kind !== "normal") {
    return {
      ok: false,
      result: defaultValue
    };
  }

  return bindDeclarationPattern(pattern.left, defaultValue.value, kind, context);
}

async function bindDeclarationArrayPattern(
  pattern: ArrayPattern,
  value: SandboxValue,
  kind: VariableDeclarationKind,
  context: EvaluationContext
): Promise<
  | {
      ok: true;
    }
  | {
      ok: false;
      result: EvaluationResult;
    }
> {
  const values = getArrayPatternValues(value);

  for (let index = 0; index < pattern.elements.length; index += 1) {
    const element = pattern.elements[index];
    if (element === null) {
      continue;
    }

    const elementValue =
      element.type === "RestElement" ? values.slice(index) : (values[index] as SandboxValue);
    const binding = await bindDeclarationPattern(element, elementValue, kind, context);
    if (!binding.ok) {
      return binding;
    }
  }

  return { ok: true };
}

function getArrayPatternValues(value: unknown): SandboxArray {
  if (Array.isArray(value)) {
    return value as SandboxArray;
  }

  if (typeof value === "string") {
    return Array.from(value);
  }

  if (isIterableValue(value)) {
    throw new TypeError(
      `Array destructuring declarations support only arrays and strings; received ${describeRuntimeValue(value)}.`
    );
  }

  throw new TypeError("Array destructuring declarations require an array or string iterable.");
}

function isIterableValue(value: unknown): value is Iterable<unknown> {
  return (
    typeof value === "object" &&
    value !== null &&
    Symbol.iterator in value &&
    typeof value[Symbol.iterator] === "function"
  );
}

function describeRuntimeValue(value: unknown): string {
  if (value === null) {
    return "null";
  }

  if (value === undefined) {
    return "undefined";
  }

  if (typeof value === "object") {
    return value.constructor?.name ?? "Object";
  }

  return typeof value;
}

async function bindDeclarationObjectPattern(
  pattern: ObjectPattern,
  value: SandboxValue,
  kind: VariableDeclarationKind,
  context: EvaluationContext
): Promise<
  | {
      ok: true;
    }
  | {
      ok: false;
      result: EvaluationResult;
    }
> {
  if (typeof value !== "object" || value === null) {
    throw new TypeError("Object destructuring declarations require a non-null object value.");
  }

  const excludedKeys = new Set<string>();

  for (const property of pattern.properties) {
    if (property.type === "RestElement") {
      const binding = await bindDeclarationPattern(
        property,
        copyObjectRestValue(value, excludedKeys),
        kind,
        context
      );
      if (!binding.ok) {
        return binding;
      }

      continue;
    }

    const key = await evaluateDeclarationPatternKey(property, context);
    if (!key.ok) {
      return key;
    }

    excludedKeys.add(String(key.value));
    const binding = await bindDeclarationPattern(
      property.value,
      (value as Record<string | number, SandboxValue>)[key.value],
      kind,
      context
    );
    if (!binding.ok) {
      return binding;
    }
  }

  return { ok: true };
}

async function evaluateDeclarationPatternKey(
  property: AssignmentProperty,
  context: EvaluationContext
): Promise<HelperResult<string | number>> {
  if (!property.computed) {
    return {
      ok: true,
      value: getStaticPropertyName(property.key)
    };
  }

  return evaluateMemberProperty(property.key, context);
}

function copyObjectRestValue(
  value: Exclude<SandboxValue, null | undefined>,
  excludedKeys: ReadonlySet<string>
): SandboxObject {
  const rest = Object.create(null) as SandboxObject;

  for (const [key, entryValue] of Object.entries(value)) {
    if (excludedKeys.has(key)) {
      continue;
    }

    defineSandboxProperty(rest, key, entryValue);
  }

  return rest;
}

async function evaluateBlockStatement(
  node: BlockStatement,
  context: EvaluationContext
): Promise<EvaluationResult> {
  const blockContext = createBlockContext(node, context);

  for (const statement of node.body) {
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

function createBlockContext(node: BlockStatement, context: EvaluationContext): EvaluationContext {
  const scope = node === context.rootNode ? context.scope : context.scope.child();
  predeclareBlockBindings(node, scope);

  return {
    ...context,
    scope
  };
}

function predeclareBlockBindings(node: BlockStatement, scope: Scope): void {
  const names = new Set<string>();

  for (const statement of node.body) {
    if (statement.type !== "VariableDeclaration") {
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
  const iterable = await evaluateNode(node.right, context);
  if (iterable.kind !== "normal") {
    return iterable;
  }

  if (!isForOfIterableValue(iterable.value)) {
    throw new TypeError(`${String(iterable.value)} is not a supported iterable`);
  }

  const iterator = iterable.value[Symbol.iterator]();
  while (true) {
    const iteration = iterator.next();
    if (typeof iteration !== "object" || iteration === null) {
      throw new TypeError("Iterator result must be an object.");
    }

    if (iteration.done) {
      break;
    }

    const scope = context.scope.child();
    bindForOfLoopVariable(node.left, iteration.value as SandboxValue, scope);

    const result = await evaluateNode(node.body, {
      ...context,
      scope
    });

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

  return {
    kind: "normal",
    hasValue: false,
    value: undefined
  };
}

function isForOfIterableValue(value: unknown): value is Iterable<unknown> {
  return Array.isArray(value) || isIterableValue(value);
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
      scope: iterationScope
    };
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

    const result = await evaluateNode(node.body, context);

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
    const result = await evaluateNode(node.body, context);

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
  node: ForOfStatement | ForStatement | WhileStatement | DoWhileStatement
): string[] | string | undefined {
  return node.labels ?? node.label;
}

function hasLoopLabel(labels: string[] | string | undefined, target: string): boolean {
  return Array.isArray(labels) ? labels.includes(target) : labels === target;
}

function bindForOfLoopVariable(
  left: ForOfStatement["left"],
  value: SandboxValue,
  scope: Scope
): void {
  if (left.type !== "VariableDeclaration") {
    throw new TypeError(`Unsupported for...of left-hand side '${left.type}'.`);
  }

  const [declarator] = left.declarations;
  if (left.declarations.length !== 1 || declarator === undefined) {
    throw new TypeError("for...of declarations must include exactly one declarator.");
  }

  if (declarator.id.type !== "Identifier") {
    throw new TypeError(`Unsupported for...of declaration pattern '${declarator.id.type}'.`);
  }

  scope.declare(declarator.id.name, left.kind, value);
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
    value: applyUnaryOperator(node.operator, argument.value)
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

  deleteSandboxProperty(member.object, member.property);

  return {
    kind: "normal",
    hasValue: true,
    value: true
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

  if (binding.kind === "const") {
    throw new Error(`Cannot assign to const '${node.argument.name}'`);
  }

  const current = Number(binding.value);
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
  if (!isIndexableSandboxValue(member.object)) {
    throw new TypeError("Update expressions require a sandbox object property.");
  }

  const current = Number(getMemberValue(member.object, member.property));
  const next = node.operator === "++" ? current + 1 : current - 1;
  setSandboxProperty(member.object, member.property, next);

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
  if (member.kind === "error") {
    return member;
  }
  if (member.kind === "completion") {
    return member.result;
  }

  if (member.kind === "nullish") {
    if (node.optional) {
      return {
        kind: "normal",
        hasValue: true,
        value: undefined
      };
    }

    throw new TypeError("Cannot read properties of null or undefined.");
  }

  if (typeof member.object === "string") {
    return {
      kind: "normal",
      hasValue: true,
      value: getStringMember(member.object, member.property, context.budget)
    };
  }

  if (typeof member.object === "number") {
    return {
      kind: "normal",
      hasValue: true,
      value: getNumberMember(member.object, member.property, context.budget)
    };
  }

  if (Array.isArray(member.object)) {
    const arrayMember = getArrayMember(
      member.object,
      member.property,
      createArrayMethodOptions(context)
    );
    if (arrayMember !== undefined) {
      return {
        kind: "normal",
        hasValue: true,
        value: arrayMember
      };
    }
  }

  if (isSandboxClosure(member.object)) {
    return {
      kind: "normal",
      hasValue: true,
      value: getClosureMemberValue(member.object, member.property)
    };
  }

  if (isSandboxPromise(member.object)) {
    return {
      kind: "normal",
      hasValue: true,
      value: getPromiseMember(member.object, member.property, context.budget)
    };
  }

  if (!isIndexableSandboxValue(member.object)) {
    throw new TypeError("Attempted to read a property from a non-object value.");
  }

  return {
    kind: "normal",
    hasValue: true,
    value: getMemberValue(member.object, member.property)
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

function formatStackFrame(node: { span: SourceSpan }, name: string | undefined): string {
  return `    at ${name ?? "<anonymous>"} (line ${node.span.start.line}, column ${node.span.start.column})`;
}

function createError(
  code: InterpreterErrorCode,
  node: ParseResult,
  message: string
): InterpreterError {
  const name = code === "UNBOUND_IDENTIFIER" ? "ReferenceError" : "Error";
  return {
    code,
    message,
    name,
    nodeId: node.nodeId,
    nodeType: node.type,
    span: node.span,
    stack: formatErrorStack(name, message, [formatStackFrame(node, undefined)])
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

  if (Array.isArray(member.object) && isArrayMethodName(member.property)) {
    return evaluateArrayMethodCall(node, member.object, member.property, context);
  }

  if (typeof member.object === "string") {
    return evaluateResolvedCallExpression(
      node,
      getStringMember(member.object, member.property, context.budget),
      context
    );
  }

  if (typeof member.object === "number") {
    return evaluateResolvedCallExpression(
      node,
      getNumberMember(member.object, member.property, context.budget),
      context
    );
  }

  if (isSandboxClosure(member.object)) {
    return evaluateResolvedCallExpression(
      node,
      getClosureMemberValue(member.object, member.property),
      context
    );
  }

  if (isSandboxPromise(member.object)) {
    return evaluateResolvedCallExpression(
      node,
      getPromiseMember(member.object, member.property, context.budget),
      context
    );
  }

  if (!isIndexableSandboxValue(member.object)) {
    throw new TypeError("Attempted to read a property from a non-object value.");
  }

  return evaluateResolvedCallExpression(
    node,
    getMemberValue(member.object, member.property),
    context
  );
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
      value: callStringMethod(target, methodName, args.value, context.budget)
    };
  } catch (error) {
    if (isFatalSandboxError(error)) {
      throw error;
    }

    throw captureException(error, [...context.callStack, formatStackFrame(node, methodName)]);
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

    throw captureException(error, [...context.callStack, formatStackFrame(node, methodName)]);
  } finally {
    leaveCall();
  }
}

function applyUnaryOperator(
  operator: UnaryExpression["operator"],
  value: InterpreterValue
): InterpreterValue {
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
      return toNumber(value);
    case "-":
      return -toNumber(value);
    case "~":
      return ~toNumber(value);
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
  return applyUnaryOperator("!", value) === false;
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
      return isSandboxErrorConstructorInstance(left, right);
    case "in":
      throw createError("UNSUPPORTED_NODE", node, "Binary operator 'in' is not supported.");
  }
}

function applyCompoundAssignmentOperator(
  operator: Exclude<AssignmentExpression["operator"], "=" | "&&=" | "||=" | "??=">,
  left: InterpreterValue,
  right: InterpreterValue,
  context: EvaluationContext
): InterpreterValue {
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
  const leftPrimitive = toPrimitive(left);
  const rightPrimitive = toPrimitive(right);

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

function toNumber(value: InterpreterValue): number {
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
  return Array.isArray(value) || isPlainSandboxObject(value);
}

function isPlainSandboxObject(value: SandboxValue): value is SandboxObject {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    !isSandboxClosure(value) &&
    !isSandboxPromise(value)
  );
}

function getMemberValue(
  target: SandboxArray | SandboxObject,
  property: string | number
): SandboxValue {
  if (Array.isArray(target)) {
    if (typeof property === "number") {
      return target[property];
    }

    return (
      (target as unknown as Record<string, SandboxValue>)[property] ?? target[Number(property)]
    );
  }

  return target[String(property)];
}

function setSandboxProperty(
  target: SandboxArray | SandboxObject,
  property: string | number,
  value: SandboxValue
): void {
  if (Array.isArray(target)) {
    (target as unknown as Record<string, SandboxValue>)[String(property)] = value;
    return;
  }

  defineSandboxProperty(target, String(property), value);
}

function deleteSandboxProperty(
  target: SandboxArray | SandboxObject,
  property: string | number
): void {
  delete (target as unknown as Record<string, SandboxValue>)[String(property)];
}

function getClosureMemberValue(target: SandboxClosure, property: string | number): SandboxValue {
  return target.properties?.[String(property)];
}

async function evaluateResolvedCallExpression(
  node: CallExpression,
  callee: InterpreterValue,
  context: EvaluationContext
): Promise<EvaluationResult> {
  if (callee === null || callee === undefined) {
    if (node.optional) {
      return {
        kind: "normal",
        hasValue: true,
        value: undefined
      };
    }

    throw new TypeError("Attempted to call a non-function value.");
  }

  if (!isSandboxClosure(callee)) {
    throw new TypeError("Attempted to call a non-function value.");
  }

  const args = await evaluateCallArguments(node.arguments, context);
  if (!args.ok) {
    return args.result;
  }

  return {
    kind: "normal",
    hasValue: true,
    value: await invokeSandboxClosure(
      callee,
      args.value,
      context,
      [...context.callStack, formatStackFrame(node, callee.name)],
      node.span
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

    throw captureException(error, [...context.callStack, formatStackFrame(node, methodName)]);
  }
}

function createArrayMethodOptions(context: EvaluationContext): ArrayMethodOptions {
  return {
    budget: context.budget,
    callClosure: (
      closure: Extract<InterpreterValue, { kind: "fn" }>,
      args: readonly SandboxValue[],
      stack: readonly string[]
    ) => invokeSandboxClosure(closure, args, context, stack)
  };
}

async function invokeSandboxClosure(
  callee: Extract<InterpreterValue, { kind: "fn" }>,
  args: readonly SandboxValue[],
  context: EvaluationContext,
  stack: readonly string[],
  span?: SourceSpan
): Promise<SandboxValue> {
  const leaveCall = context.budget.enterCall();

  try {
    const result = Reflect.apply(callee.call, undefined, [
      args,
      {
        stack,
        ...(span === undefined ? {} : { span })
      }
    ]);

    return callee.async === true
      ? normalizeClosureResult(wrapHostResult(result, stack), context.budget)
      : await resolveClosureResult(wrapHostResult(result, stack));
  } catch (error) {
    if (isFatalSandboxError(error)) {
      throw error;
    }

    throw captureException(error, stack);
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

      values.push(...spreadValues.value);
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
    const next = iterator.next();
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

  if (isSandboxClosure(value.value) || isSandboxPromise(value.value)) {
    throw new TypeError(
      `Cannot spread ${describeObjectSpreadValue(value.value)} into object literal.`
    );
  }

  const spreadValue = Object(value.value) as Record<string, SandboxValue>;
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

function getSpreadIterator(value: SandboxValue): Iterator<unknown> | undefined {
  if (typeof value === "string") {
    return value[Symbol.iterator]();
  }

  if ((typeof value !== "object" && typeof value !== "function") || value === null) {
    return undefined;
  }

  const iteratorMethod = (value as { [Symbol.iterator]?: unknown })[Symbol.iterator];
  if (typeof iteratorMethod !== "function") {
    return undefined;
  }

  return Reflect.apply(iteratorMethod, value, []) as Iterator<unknown>;
}

function defineSandboxProperty(target: SandboxObject, key: string, value: SandboxValue): void {
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
  stack: readonly string[]
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
          : createCapturedException(reason, stack)
      )
  );
}

function captureException(error: unknown, stack: readonly string[]) {
  return isCapturedException(error) ? error : createCapturedException(error, stack);
}

function isFatalSandboxError(error: unknown): error is SandboxError {
  return error instanceof SandboxError && error.code === "budgetExceeded";
}

function isPromiseLikeResult(
  value: InterpreterValue | Promise<InterpreterValue> | PromiseLike<InterpreterValue>
): value is PromiseLike<InterpreterValue> {
  return typeof value === "object" && value !== null && "then" in value;
}

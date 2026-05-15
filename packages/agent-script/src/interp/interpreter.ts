import type {
  ArrayExpression,
  ArrowFunctionExpression,
  AwaitExpression,
  BinaryExpression,
  BlockStatement,
  BooleanLiteral,
  CallExpression,
  ContinueStatement,
  Expression,
  Identifier,
  ExportDefaultDeclaration,
  ExportNamedDeclaration,
  IfStatement,
  MemberExpression,
  MetaProperty,
  NullLiteral,
  NumericLiteral,
  ObjectExpression,
  ParseResult,
  Property,
  BreakStatement,
  ReturnStatement,
  SourceSpan,
  SpreadElement,
  StringLiteral,
  ThrowStatement,
  TryStatement,
  UnaryExpression,
  UndefinedLiteral,
  ExpressionStatement,
  VariableDeclaration
} from "../parse.js";
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
  isCapturedException
} from "./exceptions.js";
import {
  callArrayMethod,
  getArrayMember,
  isArrayMethodName,
  type ArrayMethodName,
  type ArrayMethodOptions
} from "./methods/array.js";
import { callNumberMethod, getNumberMember, isNumberMethodName } from "./methods/number.js";
import {
  callStringMethod,
  getStringMember,
  isStringMethodName,
  validateStringMethodArguments
} from "./methods/string.js";
import {
  isSandboxClosure,
  isSandboxPromise,
  type SandboxArray,
  type SandboxObject,
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

export type InterpreterErrorCode = "UNBOUND_IDENTIFIER" | "UNSUPPORTED_NODE";

export type InterpreterError = {
  code: InterpreterErrorCode;
  message: string;
  nodeId?: number;
  nodeType: ParseResult["type"];
  span: SourceSpan;
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
  ArrowFunctionExpression: evaluateArrowFunction,
  AwaitExpression: evaluateAwait,
  BinaryExpression: evaluateBinaryExpression,
  BlockStatement: evaluateBlockStatement,
  BooleanLiteral: evaluatePrimitiveLiteral,
  CallExpression: evaluateCallExpression,
  ContinueStatement: evaluateContinueStatement,
  ExportDefaultDeclaration: evaluateExportDefaultDeclaration,
  ExportNamedDeclaration: evaluateExportNamedDeclaration,
  ExpressionStatement: evaluateExpressionStatement,
  IfStatement: evaluateIfStatement,
  Identifier: evaluateIdentifier,
  MemberExpression: evaluateMemberExpression,
  MetaProperty: evaluateMetaProperty,
  NullLiteral: evaluatePrimitiveLiteral,
  NumericLiteral: evaluatePrimitiveLiteral,
  ObjectExpression: evaluateObjectExpression,
  BreakStatement: evaluateBreakStatement,
  ReturnStatement: evaluateReturnStatement,
  StringLiteral: evaluatePrimitiveLiteral,
  ThrowStatement: evaluateThrowStatement,
  TryStatement: evaluateTryStatement,
  UnaryExpression: evaluateUnaryExpression,
  VariableDeclaration: evaluateVariableDeclaration,
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
    throw evaluation.value;
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
      throw error;
    }

    if (isInterpreterError(error)) {
      return {
        kind: "error",
        error
      };
    }

    const exception = isCapturedException(error)
      ? coerceThrownValue(error.reason, context.budget, error.stackFrames)
      : coerceThrownValue(error, context.budget, context.callStack);

    return {
      kind: "throw",
      hasValue: true,
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
      continue;
    }

    const result = await evaluateNode(element, context);
    if (result.kind !== "normal") {
      return result;
    }

    values.push(result.value);
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

async function evaluateIdentifier(
  node: Identifier,
  context: EvaluationContext
): Promise<EvaluationResult> {
  const binding = context.scope.lookup(node.name);

  if (!binding.found) {
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
  for (const declarator of node.declarations) {
    if (declarator.id.type !== "Identifier") {
      throw new TypeError(`Unsupported variable declaration pattern '${declarator.id.type}'.`);
    }

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

    context.scope.declare(declarator.id.name, node.kind, value.value);
  }

  return {
    kind: "normal",
    hasValue: false,
    value: undefined
  };
}

async function evaluateBlockStatement(
  node: BlockStatement,
  context: EvaluationContext
): Promise<EvaluationResult> {
  for (const statement of node.body) {
    const result = await evaluateNode(statement, context);
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

async function evaluateExpressionStatement(
  node: ExpressionStatement,
  context: EvaluationContext
): Promise<EvaluationResult> {
  return evaluateNode(node.expression, context);
}

async function evaluateBreakStatement(
  _node: BreakStatement,
  _context: EvaluationContext
): Promise<EvaluationResult> {
  return {
    kind: "break",
    hasValue: false,
    value: undefined
  };
}

async function evaluateContinueStatement(
  _node: ContinueStatement,
  _context: EvaluationContext
): Promise<EvaluationResult> {
  return {
    kind: "continue",
    hasValue: false,
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
  const argument = await evaluateNode(node.argument, context);
  if (argument.kind !== "normal") {
    return argument;
  }

  if (node.operator !== "!" && typeof argument.value !== "number") {
    throw new TypeError(`Unary operator '${node.operator}' requires a numeric operand.`);
  }

  return {
    kind: "normal",
    hasValue: true,
    value: applyUnaryOperator(node.operator, argument.value)
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

function formatStackFrame(node: CallExpression, name: string | undefined): string {
  return `    at ${name ?? "<anonymous>"} (line ${node.span.start.line}, column ${node.span.start.column})`;
}

function createError(
  code: InterpreterErrorCode,
  node: ParseResult,
  message: string
): InterpreterError {
  return {
    code,
    message,
    nodeId: node.nodeId,
    nodeType: node.type,
    span: node.span
  };
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

  if (object.value === null || object.value === undefined) {
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
    case "+":
      return +(value as number);
    case "-":
      return -(value as number);
    case "~":
      return ~(value as number);
  }
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
      return Number(left) - Number(right);
    case "*":
      return Number(left) * Number(right);
    case "/":
      return Number(left) / Number(right);
    case "%":
      return Number(left) % Number(right);
    case "**":
      return Number(left) ** Number(right);
    case "<":
      return compareLessThan(left, right);
    case "<=":
      return compareLessThanOrEqual(left, right);
    case ">":
      return compareGreaterThan(left, right);
    case ">=":
      return compareGreaterThanOrEqual(left, right);
    case "===":
    case "==":
      return left === right;
    case "!==":
    case "!=":
      return left !== right;
    case "&":
      return Number(left) & Number(right);
    case "|":
      return Number(left) | Number(right);
    case "^":
      return Number(left) ^ Number(right);
    case "<<":
      return Number(left) << Number(right);
    case ">>":
      return Number(left) >> Number(right);
    case ">>>":
      return Number(left) >>> Number(right);
    case "in":
      throw createError("UNSUPPORTED_NODE", node, "Binary operator 'in' is not supported.");
  }
}

function applyAdditionOperator(
  left: InterpreterValue,
  right: InterpreterValue,
  context: EvaluationContext
): InterpreterValue {
  if (typeof left === "string" || typeof right === "string") {
    return context.budget.allocateString(String(left) + String(right));
  }

  return Number(left) + Number(right);
}

function compareLessThan(left: InterpreterValue, right: InterpreterValue): boolean {
  return typeof left === "string" && typeof right === "string"
    ? left < right
    : Number(left) < Number(right);
}

function compareLessThanOrEqual(left: InterpreterValue, right: InterpreterValue): boolean {
  return typeof left === "string" && typeof right === "string"
    ? left <= right
    : Number(left) <= Number(right);
}

function compareGreaterThan(left: InterpreterValue, right: InterpreterValue): boolean {
  return typeof left === "string" && typeof right === "string"
    ? left > right
    : Number(left) > Number(right);
}

function compareGreaterThanOrEqual(left: InterpreterValue, right: InterpreterValue): boolean {
  return typeof left === "string" && typeof right === "string"
    ? left >= right
    : Number(left) >= Number(right);
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
    return target[typeof property === "number" ? property : Number(property)];
  }

  return target[String(property)];
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
    value: await invokeSandboxClosure(callee, args.value, context, [
      ...context.callStack,
      formatStackFrame(node, callee.name)
    ])
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
  stack: readonly string[]
): Promise<SandboxValue> {
  const leaveCall = context.budget.enterCall();

  try {
    const result = callee.call(args, {
      stack
    });

    return callee.async === true
      ? normalizeClosureResult(wrapHostResult(result, stack))
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

  if (!Array.isArray(value.value)) {
    throw new TypeError("Spread arguments must evaluate to an array.");
  }

  return {
    ok: true,
    value: value.value
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

  if (!isIndexableSandboxValue(value.value)) {
    throw new TypeError("Spread properties must evaluate to an object or array.");
  }

  const spreadValue = value.value;

  return {
    ok: true,
    value: Object.keys(spreadValue).map((key) => [key, getMemberValue(spreadValue, key)] as const)
  };
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
    "code" in value &&
    "message" in value &&
    "nodeType" in value &&
    "span" in value &&
    ((value as { code: unknown }).code === "UNBOUND_IDENTIFIER" ||
      (value as { code: unknown }).code === "UNSUPPORTED_NODE")
  );
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

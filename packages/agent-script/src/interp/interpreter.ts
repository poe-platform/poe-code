import type {
  BlockStatement,
  BooleanLiteral,
  CallExpression,
  Expression,
  Identifier,
  MemberExpression,
  NullLiteral,
  NumericLiteral,
  ParseResult,
  ReturnStatement,
  SourceSpan,
  SpreadElement,
  StringLiteral,
  UnaryExpression,
  UndefinedLiteral,
  ExpressionStatement
} from "../parse.js";
import { Budget } from "./budget.js";
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
  scope?: Scope;
};

type EvaluationContext = {
  budget: Budget;
  callStack: string[];
  scope: Scope;
  stats: InterpreterStats;
};

type EvaluationResult =
  | {
      kind: "normal" | "return";
      hasValue: boolean;
      value: InterpreterValue;
    }
  | {
      kind: "error";
      error: InterpreterError;
    };

type HelperResult<TValue> =
  | {
      ok: true;
      value: TValue;
    }
  | {
      ok: false;
      error: InterpreterError;
    };

type NodeHandler<TNode extends ParseResult> = (
  node: TNode,
  context: EvaluationContext
) => Promise<EvaluationResult>;

type DispatchTable = Partial<{
  [K in ParseResult["type"]]: NodeHandler<Extract<ParseResult, { type: K }>>;
}>;

const dispatchTable: DispatchTable = {
  BlockStatement: evaluateBlockStatement,
  BooleanLiteral: evaluatePrimitiveLiteral,
  CallExpression: evaluateCallExpression,
  ExpressionStatement: evaluateExpressionStatement,
  Identifier: evaluateIdentifier,
  MemberExpression: evaluateMemberExpression,
  NullLiteral: evaluatePrimitiveLiteral,
  NumericLiteral: evaluatePrimitiveLiteral,
  ReturnStatement: evaluateReturnStatement,
  StringLiteral: evaluatePrimitiveLiteral,
  UnaryExpression: evaluateUnaryExpression,
  UndefinedLiteral: evaluatePrimitiveLiteral
};

export async function interpret(
  node: ParseResult,
  options: InterpretOptions = {}
): Promise<InterpreterResult> {
  const budget = options.budget ?? new Budget();
  const scope = options.scope?.child(options.bindings ?? {}) ?? new Scope(options.bindings);
  const stats: InterpreterStats = {
    nodeVisits: 0
  };
  const evaluation = await evaluateNode(node, {
    budget,
    callStack: [],
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

  return handler(node as never, context);
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

async function evaluateExpressionStatement(
  node: ExpressionStatement,
  context: EvaluationContext
): Promise<EvaluationResult> {
  return evaluateNode(node.expression, context);
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
  if (argument.kind === "error") {
    return argument;
  }

  return {
    kind: "return",
    hasValue: argument.hasValue,
    value: argument.value
  };
}

async function evaluateUnaryExpression(
  node: UnaryExpression,
  context: EvaluationContext
): Promise<EvaluationResult> {
  const argument = await evaluateNode(node.argument, context);
  if (argument.kind === "error") {
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
  if (callee.kind === "error") {
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
      kind: "nullish";
    }
  | {
      kind: "resolved";
      object: InterpreterValue;
      property: string | number;
    }
> {
  const object = await evaluateNode(node.object, context);
  if (object.kind === "error") {
    return object;
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
    return {
      kind: "error",
      error: property.error
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
  if (property.kind === "error") {
    return {
      ok: false,
      error: property.error
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

  if (typeof member.object === "string") {
    return evaluateResolvedCallExpression(
      node,
      getStringMember(member.object, member.property, context.budget),
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
    return {
      kind: "error",
      error: args.error
    };
  }

  const leaveCall = context.budget.enterCall();

  try {
    return {
      kind: "normal",
      hasValue: true,
      value: callStringMethod(target, methodName, args.value, context.budget)
    };
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
    return {
      kind: "error",
      error: args.error
    };
  }

  const leaveCall = context.budget.enterCall();
  const stack = [...context.callStack, formatStackFrame(node, callee.name)];

  try {
    const result = await callee.call(args.value, {
      stack
    });

    if (isSandboxPromise(result)) {
      return {
        kind: "normal",
        hasValue: true,
        value: await result.promise
      };
    }

    return {
      kind: "normal",
      hasValue: true,
      value: result
    };
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
    if (result.kind === "error") {
      return {
        ok: false,
        error: result.error
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
  if (value.kind === "error") {
    return {
      ok: false,
      error: value.error
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

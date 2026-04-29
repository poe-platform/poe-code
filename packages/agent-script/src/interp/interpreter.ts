import type {
  BlockStatement,
  BooleanLiteral,
  Identifier,
  NullLiteral,
  NumericLiteral,
  ParseResult,
  ReturnStatement,
  SourceSpan,
  StringLiteral,
  UndefinedLiteral,
  ExpressionStatement
} from "../parse.js";
import type { SandboxValue } from "./values.js";

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
  scope?: Scope;
};

type EvaluationContext = {
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

type NodeHandler<TNode extends ParseResult> = (node: TNode, context: EvaluationContext) => Promise<EvaluationResult>;

type DispatchTable = Partial<{
  [K in ParseResult["type"]]: NodeHandler<Extract<ParseResult, { type: K }>>;
}>;

export class Scope {
  readonly #bindings: Map<string, InterpreterValue>;

  constructor(bindings: Record<string, InterpreterValue> = {}, private readonly parent?: Scope) {
    this.#bindings = new Map(Object.entries(bindings));
  }

  child(bindings: Record<string, InterpreterValue> = {}): Scope {
    return new Scope(bindings, this);
  }

  lookup(name: string): { found: true; value: InterpreterValue } | { found: false } {
    if (this.#bindings.has(name)) {
      return {
        found: true,
        value: this.#bindings.get(name)
      };
    }

    if (this.parent !== undefined) {
      return this.parent.lookup(name);
    }

    return { found: false };
  }

  snapshot(): InterpreterSnapshot {
    const inheritedBindings = this.parent?.snapshot().bindings ?? {};
    return {
      bindings: {
        ...inheritedBindings,
        ...Object.fromEntries(this.#bindings)
      }
    };
  }
}

const dispatchTable: DispatchTable = {
  BlockStatement: evaluateBlockStatement,
  BooleanLiteral: evaluatePrimitiveLiteral,
  ExpressionStatement: evaluateExpressionStatement,
  Identifier: evaluateIdentifier,
  NullLiteral: evaluatePrimitiveLiteral,
  NumericLiteral: evaluatePrimitiveLiteral,
  ReturnStatement: evaluateReturnStatement,
  StringLiteral: evaluatePrimitiveLiteral,
  UndefinedLiteral: evaluatePrimitiveLiteral
};

export async function interpret(node: ParseResult, options: InterpretOptions = {}): Promise<InterpreterResult> {
  const scope = options.scope?.child(options.bindings ?? {}) ?? new Scope(options.bindings);
  const stats: InterpreterStats = {
    nodeVisits: 0
  };
  const evaluation = await evaluateNode(node, {
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

async function evaluateNode(node: ParseResult, context: EvaluationContext): Promise<EvaluationResult> {
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
  node: BooleanLiteral | NullLiteral | NumericLiteral | StringLiteral | UndefinedLiteral
): Promise<EvaluationResult> {
  return {
    kind: "normal",
    hasValue: true,
    value: node.value
  };
}

async function evaluateIdentifier(node: Identifier, context: EvaluationContext): Promise<EvaluationResult> {
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

async function evaluateBlockStatement(node: BlockStatement, context: EvaluationContext): Promise<EvaluationResult> {
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

async function evaluateReturnStatement(node: ReturnStatement, context: EvaluationContext): Promise<EvaluationResult> {
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

function createError(code: InterpreterErrorCode, node: ParseResult, message: string): InterpreterError {
  return {
    code,
    message,
    nodeId: node.nodeId,
    nodeType: node.type,
    span: node.span
  };
}

import type {
  ArrowFunctionExpression,
  AwaitExpression,
  Identifier,
  ParseResult,
  RestElement,
  SourceSpan
} from "../parse.js";
import { getBoundOtelSpan, type OtelSpan } from "../observability/otel.js";
import type { Budget } from "./budget.js";
import type { EvaluationResult } from "./exceptions.js";
import type { InterpreterSnapshot } from "./interpreter.js";
import type { Scope } from "./scope.js";
import {
  createSandboxClosure,
  createSandboxPromise,
  isSandboxPromise,
  type SandboxValue
} from "./values.js";

export type InterpreterYieldPoint = {
  kind: "await";
  nodeId?: number;
  otelSpan?: OtelSpan;
  snapshot: InterpreterSnapshot;
  span: SourceSpan;
};

export type AsyncInterpreterError = {
  code: "LABEL_NOT_FOUND" | "UNBOUND_IDENTIFIER" | "UNSUPPORTED_NODE";
  message: string;
  nodeId?: number;
  nodeType: ParseResult["type"];
  span: SourceSpan;
};

export type AsyncEvaluationResult = EvaluationResult<AsyncInterpreterError>;

export type AsyncEvaluationContext = {
  budget: Budget;
  callStack: string[];
  onYield?: (yieldPoint: InterpreterYieldPoint) => void;
  scope: Scope;
  stats: {
    nodeVisits: number;
  };
};

export type EvaluateAsyncNode = (
  node: ParseResult,
  context: AsyncEvaluationContext
) => Promise<AsyncEvaluationResult>;

export async function evaluateArrowFunctionExpression(
  node: ArrowFunctionExpression,
  context: AsyncEvaluationContext,
  evaluateNode: EvaluateAsyncNode
): Promise<AsyncEvaluationResult> {
  return {
    kind: "normal",
    hasValue: true,
    value: createSandboxClosure({
      ...(node.async ? { async: true } : {}),
      call: (args, callContext) =>
        node.async
          ? createSandboxPromise(
              executeArrow(
                node,
                args,
                {
                  ...context,
                  callStack: [...(callContext?.stack ?? context.callStack)]
                },
                evaluateNode
              )
            )
          : executeArrow(
              node,
              args,
              {
                ...context,
                callStack: [...(callContext?.stack ?? context.callStack)]
              },
              evaluateNode
            )
    })
  };
}

export async function evaluateAwaitExpression(
  node: AwaitExpression,
  context: AsyncEvaluationContext,
  evaluateNode: EvaluateAsyncNode
): Promise<AsyncEvaluationResult> {
  const argument = await evaluateNode(node.argument, context);
  if (argument.kind !== "normal") {
    return argument;
  }

  context.onYield?.({
    kind: "await",
    nodeId: node.nodeId,
    ...(getBoundOtelSpan(argument.value) === undefined
      ? {}
      : { otelSpan: getBoundOtelSpan(argument.value) }),
    snapshot: context.scope.snapshot(),
    span: node.span
  });

  const leaveAwait = context.budget.enterAwait();

  try {
    return {
      kind: "normal",
      hasValue: true,
      value: await (isSandboxPromise(argument.value)
        ? argument.value.promise
        : Promise.resolve(argument.value))
    };
  } finally {
    leaveAwait();
  }
}

async function executeArrow(
  node: ArrowFunctionExpression,
  args: readonly SandboxValue[],
  context: AsyncEvaluationContext,
  evaluateNode: EvaluateAsyncNode
): Promise<SandboxValue> {
  const scope = context.scope.child();
  bindIdentifierParameters(node.params, args, scope, context.budget);

  const result = await evaluateNode(node.body, {
    ...context,
    scope
  });

  if (result.kind === "error") {
    throw result.error;
  }

  if (result.kind === "throw") {
    throw result.value;
  }

  if (node.body.type === "BlockStatement") {
    return result.hasValue ? result.value : undefined;
  }

  return result.value;
}

function bindIdentifierParameters(
  params: ArrowFunctionExpression["params"],
  args: readonly SandboxValue[],
  scope: Scope,
  budget: Budget
): void {
  for (let index = 0; index < params.length; index += 1) {
    const param = params[index];
    if (param.type === "RestElement") {
      bindRestParameter(param, args, index, scope, budget);
      return;
    }

    if (param.type !== "Identifier") {
      throw new TypeError(`Unsupported async arrow parameter pattern '${param.type}'.`);
    }

    declareIdentifier(scope, param, args[index]);
  }
}

function bindRestParameter(
  param: RestElement,
  args: readonly SandboxValue[],
  index: number,
  scope: Scope,
  budget: Budget
): void {
  if (param.argument.type !== "Identifier") {
    throw new TypeError(`Unsupported async arrow rest parameter pattern '${param.argument.type}'.`);
  }

  const rest = args.slice(index);
  budget.allocateArrayLength(rest.length);
  declareIdentifier(scope, param.argument, rest);
}

function declareIdentifier(scope: Scope, param: Identifier, value: SandboxValue): void {
  scope.declare(param.name, "const", value);
}

export function normalizeClosureResult(
  result: SandboxValue | Promise<SandboxValue> | PromiseLike<SandboxValue>
): SandboxValue {
  if (isSandboxPromise(result)) {
    return result;
  }

  if (isPromiseLike(result)) {
    return createSandboxPromise(Promise.resolve(result));
  }

  return createSandboxPromise(Promise.resolve(result));
}

export async function resolveClosureResult(
  result: SandboxValue | Promise<SandboxValue> | PromiseLike<SandboxValue>
): Promise<SandboxValue> {
  if (isSandboxPromise(result)) {
    return result.promise;
  }

  if (isPromiseLike(result)) {
    const resolved = await result;
    return isSandboxPromise(resolved) ? resolved.promise : resolved;
  }

  return result;
}

function isPromiseLike(
  value: SandboxValue | Promise<SandboxValue> | PromiseLike<SandboxValue>
): value is PromiseLike<SandboxValue> {
  return typeof value === "object" && value !== null && "then" in value;
}

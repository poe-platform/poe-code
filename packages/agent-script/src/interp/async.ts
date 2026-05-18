import type {
  AssignmentPattern,
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
import type { InterpreterError, InterpreterSnapshot } from "./interpreter.js";
import { resolveSandboxValue } from "./promise.js";
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

export type AsyncInterpreterError = InterpreterError;

export type AsyncEvaluationResult = EvaluationResult<AsyncInterpreterError>;

export type AsyncEvaluationContext = {
  budget: Budget;
  callStack: string[];
  onYield?: (yieldPoint: InterpreterYieldPoint) => void;
  rootNode?: ParseResult;
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
              resolveSandboxValue(
                executeArrow(
                  node,
                  args,
                  {
                    ...context,
                    callStack: [...(callContext?.stack ?? context.callStack)]
                  },
                  evaluateNode
                ),
                { budget: context.budget }
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
      value: await resolveSandboxValue(argument.value)
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
  await bindArrowParameters(node.params, args, scope, context, evaluateNode);

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

async function bindArrowParameters(
  params: ArrowFunctionExpression["params"],
  args: readonly SandboxValue[],
  scope: Scope,
  context: AsyncEvaluationContext,
  evaluateNode: EvaluateAsyncNode
): Promise<void> {
  for (let index = 0; index < params.length; index += 1) {
    const param = params[index];
    if (param.type === "RestElement") {
      bindRestParameter(param, args, index, scope, context.budget);
      return;
    }

    await bindArrowParameter(param, args[index], scope, context, evaluateNode);
  }
}

async function bindArrowParameter(
  param: Exclude<ArrowFunctionExpression["params"][number], RestElement>,
  arg: SandboxValue,
  scope: Scope,
  context: AsyncEvaluationContext,
  evaluateNode: EvaluateAsyncNode
): Promise<void> {
  if (param.type === "AssignmentPattern") {
    await bindAssignmentParameter(param, arg, scope, context, evaluateNode);
    return;
  }

  if (param.type !== "Identifier") {
    throw new TypeError(`Unsupported async arrow parameter pattern '${param.type}'.`);
  }

  declareIdentifier(scope, param, arg);
}

async function bindAssignmentParameter(
  param: AssignmentPattern,
  arg: SandboxValue,
  scope: Scope,
  context: AsyncEvaluationContext,
  evaluateNode: EvaluateAsyncNode
): Promise<void> {
  const value =
    arg === undefined ? await evaluateParameterDefault(param, scope, context, evaluateNode) : arg;

  if (param.left.type !== "Identifier") {
    throw new TypeError(`Unsupported async arrow parameter pattern '${param.left.type}'.`);
  }

  declareIdentifier(scope, param.left, value);
}

async function evaluateParameterDefault(
  param: AssignmentPattern,
  scope: Scope,
  context: AsyncEvaluationContext,
  evaluateNode: EvaluateAsyncNode
): Promise<SandboxValue> {
  const result = await evaluateNode(param.right, {
    ...context,
    scope
  });

  if (result.kind === "error") {
    throw result.error;
  }

  if (result.kind === "throw") {
    throw result.value;
  }

  return result.hasValue ? result.value : undefined;
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
  result: SandboxValue | Promise<SandboxValue> | PromiseLike<SandboxValue>,
  budget?: Budget
): SandboxValue {
  if (isSandboxPromise(result)) {
    return result;
  }

  return createSandboxPromise(resolveSandboxValue(result, { budget }));
}

export async function resolveClosureResult(
  result: SandboxValue | Promise<SandboxValue> | PromiseLike<SandboxValue>
): Promise<SandboxValue> {
  return resolveSandboxValue(result);
}

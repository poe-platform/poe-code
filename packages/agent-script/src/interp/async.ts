import type {
  ArrowFunctionExpression,
  AwaitExpression,
  BlockStatement,
  FunctionDeclaration,
  FunctionExpression,
  ParseResult,
  SourceSpan
} from "../parse.js";
import { createGeneratorChannel, type GeneratorCompletion } from "./generator.js";
import { getBoundOtelSpan, type OtelSpan } from "../observability/otel.js";
import type { Budget } from "./budget.js";
import type { EvaluationResult } from "./exceptions.js";
import type { InterpreterError, InterpreterSnapshot } from "./interpreter.js";
import { bindPattern } from "./patterns.js";
import { resolveSandboxValue } from "./promise.js";
import type { Scope } from "./scope.js";
import { hoistVarDeclarations } from "./var-hoist.js";
import {
  createSandboxClosure,
  createSandboxGenerator,
  createSandboxPromise,
  isSandboxPromise,
  type SandboxCallContext,
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
  generatorYield?: (value?: SandboxValue) => Promise<GeneratorCompletion>;
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
    value: createInterpretedClosure(node, context, evaluateNode)
  };
}

export async function evaluateFunctionExpression(
  node: FunctionExpression,
  context: AsyncEvaluationContext,
  evaluateNode: EvaluateAsyncNode
): Promise<AsyncEvaluationResult> {
  if (node.id === undefined) {
    return {
      kind: "normal",
      hasValue: true,
      value: createInterpretedClosure(node, context, evaluateNode)
    };
  }

  const wrapperScope = context.scope.child();
  const closure = createInterpretedClosure(node, { ...context, scope: wrapperScope }, evaluateNode);
  wrapperScope.declare(node.id.name, "const", closure);

  return {
    kind: "normal",
    hasValue: true,
    value: closure
  };
}

export function createInterpretedClosure(
  node: ArrowFunctionExpression | FunctionDeclaration | FunctionExpression,
  context: AsyncEvaluationContext,
  evaluateNode: EvaluateAsyncNode
) {
  if (node.type !== "ArrowFunctionExpression" && node.generator) {
    return createGeneratorClosure(node, context, evaluateNode);
  }

  const construct =
    node.type !== "ArrowFunctionExpression" &&
    !(node.type === "FunctionExpression" && node.method === true) &&
    !node.async
      ? async (args: readonly SandboxValue[], callContext?: SandboxCallContext) => {
          const thisValue = {};
          const result = await executeClosure(
            node,
            args,
            thisValue,
            {
              ...context,
              callStack: [...(callContext?.stack ?? context.callStack)]
            },
            evaluateNode
          );
          return isConstructResult(result) ? result : thisValue;
        }
      : undefined;

  return createSandboxClosure({
    ...(node.async ? { async: true } : {}),
    ...(node.type === "FunctionDeclaration" || node.type === "FunctionExpression"
      ? node.id === undefined
        ? {}
        : { name: node.id.name }
      : {}),
    ...(construct === undefined ? {} : { construct }),
    call: (args, callContext) =>
      node.async
        ? createSandboxPromise(
            resolveSandboxValue(
              executeClosure(
                node,
                args,
                callContext?.thisValue,
                {
                  ...context,
                  callStack: [...(callContext?.stack ?? context.callStack)]
                },
                evaluateNode
              ),
              { budget: context.budget }
            )
          )
        : executeClosure(
            node,
            args,
            callContext?.thisValue,
            {
              ...context,
              callStack: [...(callContext?.stack ?? context.callStack)]
            },
            evaluateNode
          )
  });
}

function createGeneratorClosure(
  node: FunctionDeclaration | FunctionExpression,
  context: AsyncEvaluationContext,
  evaluateNode: EvaluateAsyncNode
) {
  return createSandboxClosure({
    ...(node.id === undefined ? {} : { name: node.id.name }),
    call: async (args, callContext) => {
      const closureContext = {
        ...context,
        callStack: [...(callContext?.stack ?? context.callStack)]
      };
      const scope = await createClosureScope(
        node,
        args,
        callContext?.thisValue,
        closureContext,
        evaluateNode
      );
      const channel = createGeneratorChannel(async (generatorYield) => {
        const result = await evaluateNode(node.body, {
          ...closureContext,
          generatorYield,
          scope
        });
        if (result.kind === "error") {
          throw result.error;
        }
        if (result.kind === "throw") {
          throw result.value;
        }
        return result.hasValue ? result.value : undefined;
      });
      return createSandboxGenerator(channel);
    }
  });
}

function isConstructResult(value: SandboxValue): boolean {
  return typeof value === "object" && value !== null;
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

async function executeClosure(
  node: ArrowFunctionExpression | FunctionDeclaration | FunctionExpression,
  args: readonly SandboxValue[],
  thisValue: SandboxValue,
  context: AsyncEvaluationContext,
  evaluateNode: EvaluateAsyncNode
): Promise<SandboxValue> {
  const scope = await createClosureScope(node, args, thisValue, context, evaluateNode);

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

  if (isBlockBody(node.body)) {
    return result.hasValue ? result.value : undefined;
  }

  return result.value;
}

async function createClosureScope(
  node: ArrowFunctionExpression | FunctionDeclaration | FunctionExpression,
  args: readonly SandboxValue[],
  thisValue: SandboxValue,
  context: AsyncEvaluationContext,
  evaluateNode: EvaluateAsyncNode
): Promise<Scope> {
  const scope = context.scope.child({}, { functionBoundary: true });
  if (node.type !== "ArrowFunctionExpression") {
    scope.declare("this", "const", thisValue);
  }
  await bindParameters(node.params, args, scope, context, evaluateNode);
  hoistVarDeclarations(node.body, scope);
  return scope;
}

function isBlockBody(
  body: BlockStatement | ArrowFunctionExpression["body"]
): body is BlockStatement {
  return body.type === "BlockStatement";
}

async function bindParameters(
  params: ArrowFunctionExpression["params"],
  args: readonly SandboxValue[],
  scope: Scope,
  context: AsyncEvaluationContext,
  evaluateNode: EvaluateAsyncNode
): Promise<void> {
  for (let index = 0; index < params.length; index += 1) {
    const param = params[index];
    if (param.type === "RestElement") {
      const rest = args.slice(index);
      context.budget.allocateArrayLength(rest.length);
      const binding = await bindPattern(param, rest, { kind: "let" }, scope, {
        evaluate: (defaultNode) => evaluateNode(defaultNode, { ...context, scope })
      });
      if (!binding.ok) {
        if (binding.result.kind === "error") {
          throw binding.result.error;
        }
        if (binding.result.kind === "throw") {
          throw binding.result.value;
        }
      }
      return;
    }

    const binding = await bindPattern(param, args[index], { kind: "let" }, scope, {
      evaluate: (defaultNode) => evaluateNode(defaultNode, { ...context, scope })
    });
    if (!binding.ok) {
      if (binding.result.kind === "error") {
        throw binding.result.error;
      }
      if (binding.result.kind === "throw") {
        throw binding.result.value;
      }
    }
  }
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

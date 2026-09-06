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
import type {
  InterpreterError,
  InterpreterSnapshot,
  LoopIterationSnapshot
} from "./interpreter.js";
import { bindPattern } from "./patterns.js";
import { requiresPromiseResolution, resolveSandboxValue } from "./promise.js";
import { runAsyncPrefix, suspendJob } from "./jobs.js";
import { CompileScope } from "./regex/compile-guard.js";
import { awaitSandboxValue } from "./cancel.js";
import type { Scope } from "./scope.js";
import { hoistVarDeclarations } from "./var-hoist.js";
import { createPatternContext } from "./interpreter.js";
import { getGuestFunctionProperty, setSandboxPrototype } from "./object-model.js";
import { functionSources } from "../parse/function-source.js";
import {
  boundIdentifiers,
  containsParameterExpression,
  getFunctionLength,
  hoistedVarDeclarations
} from "../parse/bindings.js";
import {
  createSandboxArguments,
  createSandboxClosure,
  createSandboxGenerator,
  createSandboxPromise,
  allocateProducedSandboxValue,
  reconcileCompiledValues,
  isSandboxPromise,
  type SandboxCallContext,
  type SandboxClosure,
  type SandboxObject,
  type SandboxValue
} from "./values.js";

export type InterpreterYieldPoint = {
  kind: "await" | "generator-yield" | "loop-iteration";
  nodeId?: number;
  otelSpan?: OtelSpan;
  replayState?: unknown;
  snapshot: () => InterpreterSnapshot;
  span: SourceSpan;
};

type ResumeBreakpoint = Omit<InterpreterYieldPoint, "snapshot">;

export type AsyncInterpreterError = InterpreterError;

export type AsyncEvaluationResult = EvaluationResult<AsyncInterpreterError>;

export type AsyncEvaluationContext = {
  inferredName?: string;
  functionEnvironment?: {
    newTarget?: SandboxClosure;
    homeObject?: SandboxObject | SandboxClosure;
    construction?: {
      derived: boolean;
      initialize(scope: Scope): Promise<void>;
      superCall(args: readonly SandboxValue[]): Promise<SandboxValue>;
    };
  };
  assertActive?: () => void;
  compilation?: CompileScope;
  activeLoopIterations: Map<number, LoopIterationSnapshot>;
  budget: Budget;
  callStack: string[];
  onYield?: (yieldPoint: InterpreterYieldPoint) => void;
  onSuspend?: () => void;
  captureReplayState?: () => unknown;
  rootNode?: ParseResult;
  functionBody?: BlockStatement;
  restoredLoopIterations: Map<number, LoopIterationSnapshot>;
  resumeTarget?: { nodeId?: number };
  scope: Scope;
  signal?: AbortSignal;
  snapshot?: (scope: Scope) => InterpreterSnapshot;
  stats: {
    currentDataSize: number;
    nodeVisits: number;
    peakDataSize: number;
  };
  generatorYield?: (value?: SandboxValue, yieldNodeId?: number) => Promise<GeneratorCompletion>;
  generatorResume?: {
    sent: GeneratorCompletion[];
    yieldNodeId: number;
  };
};

export type EvaluateAsyncNode = (
  node: ParseResult,
  context: AsyncEvaluationContext
) => Promise<AsyncEvaluationResult>;

export function emitResumeBreakpoint(
  context: AsyncEvaluationContext,
  breakpoint: ResumeBreakpoint
): void {
  context.onYield?.({
    ...breakpoint,
    snapshot: () => context.snapshot?.(context.scope) ?? context.scope.snapshot()
  });
}

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
      value: createInterpretedClosure(
        node,
        context,
        evaluateNode,
        node.method === true ? context.functionEnvironment?.homeObject : undefined
      )
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
  evaluateNode: EvaluateAsyncNode,
  homeObject?: SandboxObject | SandboxClosure
) {
  if (node.type !== "ArrowFunctionExpression") {
    context = { ...context, functionEnvironment: { homeObject } };
  }
  if (node.type !== "ArrowFunctionExpression" && node.generator) {
    return createGeneratorClosure(node, context, evaluateNode);
  }

  const construct =
    node.type !== "ArrowFunctionExpression" &&
    !(node.type === "FunctionExpression" && node.method === true) &&
    !node.async
      ? async (args: readonly SandboxValue[], callContext?: SandboxCallContext) => {
          const thisValue = {};
          const newTarget = callContext?.newTarget ?? closure;
          const prototype = getGuestFunctionProperty(newTarget, "prototype");
          if (typeof prototype === "object" && prototype !== null) {
            setSandboxPrototype(thisValue, prototype, context.budget);
          }
          const result = await executeClosure(
            node,
            args,
            thisValue,
            {
              ...context,
              functionEnvironment: { newTarget },
              compilation: callContext?.compilation ?? context.compilation,
              callStack: [...(callContext?.stack ?? context.callStack)]
            },
            evaluateNode
          );
          return isConstructResult(result) ? result : thisValue;
        }
      : undefined;

  const closure = createSandboxClosure({
    sourceRange: functionSources.get(node),
    guest: true,
    sandbox: true,
    length: getFunctionLength(node.params),
    ...(node.async ? { async: true } : {}),
    ...(node.type === "FunctionDeclaration" || node.type === "FunctionExpression"
      ? node.id === undefined
        ? { name: context.inferredName }
        : { name: node.id.name }
      : { name: context.inferredName }),
    ...(construct === undefined ? {} : { construct }),
    retainedValues: () => [...context.scope.retainedValues(), context.functionEnvironment?.homeObject, context.functionEnvironment?.newTarget],
    call: (args, callContext) => {
      const invocationContext = {
        ...context,
        compilation: callContext?.compilation ?? context.compilation,
        callStack: [...(callContext?.stack ?? context.callStack)]
      };
      if (!node.async)
        return executeClosure(node, args, callContext?.thisValue, invocationContext, evaluateNode);

      return executeAsyncFunction(
        (onSuspend) =>
          executeClosure(
            node,
            args,
            callContext?.thisValue,
            { ...invocationContext, onSuspend },
            evaluateNode
          ),
        context.budget,
        context.signal
      );
    }
  });
  return closure;
}

export function executeAsyncFunction(
  execute: (onSuspend: () => void) => Promise<SandboxValue>,
  budget: Budget,
  signal?: AbortSignal
) {
  let completePrefix!: () => void;
  const synchronousPrefix = new Promise<void>((resolve) => {
    completePrefix = resolve;
  });
  const promise = new Promise<SandboxValue>((resolve, reject) => {
    runAsyncPrefix(async () => {
      try {
        const value = await execute(completePrefix);
        resolve(
          requiresPromiseResolution(value, budget)
            ? awaitSandboxValue(
                createSandboxPromise(resolveSandboxValue(value, { budget }), {
                  trackReplay: false
                }),
                signal,
                budget
              )
            : allocateProducedSandboxValue(value, budget)
        );
      } catch (error) {
        reject(error);
      } finally {
        completePrefix();
      }
    }).catch((error: unknown) => {
      reject(error);
      completePrefix();
    });
  });
  return createSandboxPromise(promise, { synchronousPrefix });
}

function createGeneratorClosure(
  node: FunctionDeclaration | FunctionExpression,
  context: AsyncEvaluationContext,
  evaluateNode: EvaluateAsyncNode
) {
  return createSandboxClosure({
    sourceRange: functionSources.get(node),
    guest: true,
    generator: true,
    sandbox: true,
    length: getFunctionLength(node.params),
    ...(node.id === undefined ? { name: context.inferredName } : { name: node.id.name }),
    retainedValues: () => [...context.scope.retainedValues(), context.functionEnvironment?.homeObject, context.functionEnvironment?.newTarget],
    call: async (args, callContext) => {
      const closureContext = {
        ...context,
        compilation: callContext?.compilation ?? context.compilation,
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
          functionBody: node.body,
          generatorYield: (value, yieldNodeId) => {
            generator.state = "suspended";
            return generatorYield(value, yieldNodeId);
          },
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
      const generator = createSandboxGenerator(channel);
      return generator;
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
  const replayState = context.captureReplayState?.();
  const argument = await evaluateNode(node.argument, context);
  if (argument.kind !== "normal") {
    return argument;
  }

  context.onSuspend?.();

  emitResumeBreakpoint(context, {
    kind: "await",
    replayState,
    nodeId: node.nodeId,
    ...(getBoundOtelSpan(argument.value) === undefined
      ? {}
      : { otelSpan: getBoundOtelSpan(argument.value) }),
    span: node.span
  });

  const leaveAwait = context.budget.enterAwait();

  try {
    return {
      kind: "normal",
      hasValue: true,
      value: await suspendJob(awaitSandboxValue(argument.value, context.signal, context.budget))
    };
  } finally {
    leaveAwait();
  }
}

export async function executeClosure(
  node: ArrowFunctionExpression | FunctionDeclaration | FunctionExpression,
  args: readonly SandboxValue[],
  thisValue: SandboxValue,
  context: AsyncEvaluationContext,
  evaluateNode: EvaluateAsyncNode
): Promise<SandboxValue> {
  const parent = context.compilation;
  const operation = context.budget.acquireCompileOwner(false, parent?.owner);
  const compilation = new CompileScope(operation.owner, parent);
  context = { ...context, compilation };
  try {
    const scope = await createClosureScope(node, args, thisValue, context, evaluateNode);

    const result = await evaluateNode(node.body, {
      ...context,
      functionBody: node.body.type === "BlockStatement" ? node.body : undefined,
      scope
    });

    const value = "hasValue" in result && result.hasValue ? result.value : undefined;
    reconcileCompiledValues(
      context.budget,
      [...scope.retainedValues(), value],
      compilation,
      parent,
      [value]
    );

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
  } finally {
    compilation.dispose();
    operation.release();
  }
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
    const construction = context.functionEnvironment?.construction;
    if (construction?.derived === true) scope.predeclare("this", "const");
    else scope.declare("this", "const", thisValue);
    context.budget.allocateArrayLength(args.length);
    scope.declare("arguments", "let", createSandboxArguments(args));
    await construction?.initialize(scope);
  }
  await bindParameters(node.params, args, scope, context, evaluateNode);
  const bodyScope = node.params.some(containsParameterExpression)
    ? scope.child({}, { functionBoundary: true })
    : scope;
  hoistVarDeclarations(node.body, bodyScope);
  if (bodyScope !== scope) {
    for (const declaration of hoistedVarDeclarations([node.body])) {
      for (const declarator of declaration.declarations) {
        for (const identifier of boundIdentifiers(declarator.id)) {
          if (!scope.hasOwnBinding(identifier.name)) continue;
          const parameter = scope.lookup(identifier.name);
          if (parameter.found) bodyScope.assign(identifier.name, parameter.value);
        }
      }
    }
  }
  return bodyScope;
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
  for (const param of params) {
    for (const identifier of boundIdentifiers(param)) {
      scope.predeclare(identifier.name, "var");
    }
  }

  for (let index = 0; index < params.length; index += 1) {
    const param = params[index];
    if (param.type === "RestElement") {
      const rest = args.slice(index);
      context.budget.allocateArrayLength(rest.length);
      const binding = await bindPattern(param, rest, { kind: "var", initialize: true }, scope, createPatternContext(context, scope, evaluateNode));
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

    const binding = await bindPattern(
      param,
      args[index],
      { kind: "var", initialize: true },
      scope,
      createPatternContext(context, scope, evaluateNode)
    );
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
  if (
    isSandboxPromise(result) &&
    (result.synchronousPrefix !== undefined || result.hostCall !== undefined)
  ) {
    return result;
  }

  return createSandboxPromise(resolveSandboxValue(result, { budget }), {
    ...(isSandboxPromise(result) ? { synchronousPrefix: Promise.resolve() } : {})
  });
}

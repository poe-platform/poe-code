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
import { startAsyncFunction } from "./async-function-driver.js";
import { asyncGeneratorDrivers, bindAsyncGeneratorSignal } from "./async-generator-driver.js";
import { getBoundOtelSpan, type OtelSpan } from "../observability/otel.js";
import type { Budget } from "./budget.js";
import type { EvaluationResult } from "./exceptions.js";
import type {
  InterpreterError,
  InterpreterSnapshot,
  LoopIterationSnapshot
} from "./interpreter.js";
import { bindPattern } from "./patterns.js";
import { createPendingPromiseCapability, prepareAwaitedPromise, requiresPromiseResolution, resolveSandboxValue } from "./promise.js";
import { promiseReplayContext } from "./promise-replay.js";
import { runAsyncPrefix, suspendJob } from "./jobs.js";
import { CompileScope } from "./regex/compile-guard.js";
import { awaitSandboxValue, awaitWithSignal } from "./cancel.js";
import { observeSandboxPromise } from "./promise-tracker.js";
import type { Scope } from "./scope.js";
import { hoistVarDeclarations } from "./var-hoist.js";
import { prepareLegacyBlockFunctions } from "./legacy-block-functions.js";
import { createCoercionContext, createPatternContext } from "./interpreter.js";
import { getGuestFunctionProperty, getSandboxPrototype, markDescriptorObject, materializeFunctionProperties, setSandboxPrototype } from "./object-model.js";
import { getFunctionRealmPrototype } from "./function-realm.js";
import { generatorPrototypes } from "./generator-prototypes.js";
import { retainValues, runResources } from "./resources.js";
import { functionSources, functionStrictness } from "../parse/function-source.js";
import { getRealmGlobalObject } from "./intrinsics.js";
import { createSandboxBox } from "./boxed.js";
import { createMappedSandboxArguments } from "./arguments.js";
import { getGeneratorOrigin, registerClosureOrigin, registerGeneratorOrigin } from "./closure-origin.js";
import { constructionStates } from "./construction-state.js";
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
  type SandboxGenerator,
  type SandboxObject,
  type SandboxPromise,
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
  scriptScope?: Scope;
  evalCompletion?: boolean;
  callee?: SandboxClosure;
  strict?: boolean;
  inferredName?: string;
  functionEnvironment?: {
    classInitializer?: true;
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
  generatorYield?: (value?: SandboxValue, yieldNodeId?: number, yieldedResult?: SandboxValue) => Promise<GeneratorCompletion>;
  asyncGenerator?: boolean;
  asyncGeneratorFrame?: SandboxGenerator;
  asyncFunction?: boolean;
  captureGeneratorScope?: (scope: Scope, blocks?: ReadonlyMap<number, Scope>, completions?: ReadonlyMap<number, import("./exceptions.js").CompletionResult>, expressions?: ReadonlyMap<number, import("./generator-expression-state.js").GeneratorExpressionState>) => void;
  generatorExpressionStates?: ReadonlyMap<number, import("./generator-expression-state.js").GeneratorExpressionState>;
  restoredGeneratorExpressionStates?: ReadonlyMap<number, import("./generator-expression-state.js").GeneratorExpressionState>;
  finallyCompletions?: ReadonlyMap<number, import("./exceptions.js").CompletionResult>;
  restoredFinallyCompletions?: ReadonlyMap<number, import("./exceptions.js").CompletionResult>;
  generatorBlockScopes?: ReadonlyMap<number, Scope>;
  restoredGeneratorBlockScopes?: ReadonlyMap<number, Scope>;
  generatorResume?: {
    completed?: boolean;
    sent: GeneratorCompletion[];
    yieldNodeId: number;
  };
};

export type EvaluateAsyncNode = (
  node: ParseResult,
  context: AsyncEvaluationContext
) => Promise<AsyncEvaluationResult>;

export function emitResumeBreakpoint(
  context: Pick<AsyncEvaluationContext, "onYield" | "snapshot" | "scope">,
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
  wrapperScope.declare(node.id.name, "const", closure,
    functionStrictness.get(node) === false ? {silentImmutable: true} : undefined);

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
  homeObject?: SandboxObject | SandboxClosure,
  initializeGeneratorPrototype = true
) {
  if (context.evalCompletion) context = {...context, evalCompletion: undefined};
  if (node.type !== "ArrowFunctionExpression") {
    context = { ...context, functionEnvironment: { homeObject } };
  }
  if (node.type !== "ArrowFunctionExpression" && node.generator) {
    return createGeneratorClosure(node, context, evaluateNode, initializeGeneratorPrototype);
  }
  const construction = context.functionEnvironment?.construction;
  const constructionState = construction === undefined ? undefined : constructionStates.get(construction);

  const construct =
    node.type !== "ArrowFunctionExpression" &&
    !(node.type === "FunctionExpression" && node.method === true) &&
    !node.async
      ? async (args: readonly SandboxValue[], callContext?: SandboxCallContext) => {
          const thisValue = {};
          const newTarget = callContext?.newTarget ?? closure;
          const prototype = callContext?.getProperty === undefined
            ? getGuestFunctionProperty(newTarget, "prototype")
            : await callContext.getProperty(newTarget, "prototype");
          const selected = typeof prototype === "object" && prototype !== null ? prototype
            : getFunctionRealmPrototype(newTarget, "Object", getSandboxPrototype(thisValue, context.budget));
          if (selected !== null) setSandboxPrototype(thisValue, selected, context.budget);
          const result = await executeClosure(
            node,
            args,
            thisValue,
            {
              ...context,
              callee: closure,
              functionEnvironment: { newTarget },
              compilation: callContext?.compilation?.owner?.budget === context.budget ? callContext.compilation : context.compilation,
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
    retainedValues: () => {
      const values = [...context.scope.retainedDataRoots(), context.functionEnvironment?.homeObject, context.functionEnvironment?.newTarget];
      if (constructionState !== undefined) {
        values.push(constructionState.constructor, constructionState.newTarget,
          constructionState.prototype, constructionState.thisValue);
        if (constructionState.thisScope !== undefined) values.push(...constructionState.thisScope.retainedDataRoots());
      }
      return values;
    },
    call: (args, callContext) => {
      const invocationContext = {
        ...context,
        callee: closure,
        strict: functionStrictness.get(node) ?? true,
        compilation: callContext?.compilation?.owner?.budget === context.budget ? callContext.compilation : context.compilation,
        callStack: [...(callContext?.stack ?? context.callStack)]
      };
      if (!node.async)
        return executeClosure(node, args, callContext?.thisValue, invocationContext, evaluateNode);

      return startAsyncFunction(async onSuspend => {
        const parent = invocationContext.compilation;
        const operation = context.budget.acquireCompileOwner(false, parent?.owner);
        const compilation = new CompileScope(operation.owner, parent);
        const executionContext = {...invocationContext, compilation, onSuspend};
        let scope: Scope;
        try {scope = await createClosureScope(node, args, callContext?.thisValue, executionContext, evaluateNode);}
        catch (error) {compilation.dispose(); operation.release(); throw error;}
        const channel = createGeneratorChannel(async generatorYield => {
          try {
          const result = await evaluateNode(node.body, {
            ...executionContext, scope, asyncFunction: true, asyncGenerator: false, asyncGeneratorFrame: undefined,
            functionBody: node.body.type === "BlockStatement" ? node.body : undefined,
            generatorBlockScopes: new Map(), generatorExpressionStates: new Map(),
            captureGeneratorScope: (current, blocks, completions, expressions) => {
              origin.suspendedScope = current; origin.blockScopes = blocks;
              origin.finallyCompletions = completions; origin.expressionStates = expressions;
            },
            generatorYield: (value, nodeId, yieldedResult) => {
              generator.state = "suspended";
              return generatorYield(value, nodeId, yieldedResult);
            }
          });
          const value = "hasValue" in result && result.hasValue ? result.value : undefined;
          reconcileCompiledValues(context.budget, [...scope.retainedDataRoots(), value], compilation, parent, [value]);
          if (result.kind === "error") throw result.error;
          if (result.kind === "throw") throw result.value;
          return value;
          } finally {compilation.dispose(); operation.release();}
        });
        const generator = createSandboxGenerator(channel);
        const origin = registerGeneratorOrigin(generator, node, scope, invocationContext);
        origin.asyncFunction = true;
        return generator;
      }, context.budget, callContext, context.signal);
    }
  });
  registerClosureOrigin(closure, node, context);
  return closure;
}

export function executeAsyncFunction(
  execute: (onSuspend: () => void) => Promise<SandboxValue>,
  budget: Budget,
  signal?: AbortSignal,
  callContext?: SandboxCallContext
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
                createSandboxPromise(resolveSandboxValue(value, { budget, context: callContext }), {
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
  evaluateNode: EvaluateAsyncNode,
  initializePrototype: boolean
) {
  const prototypes = !initializePrototype || runResources.getStore()?.functionSourceText === false ? undefined
    : generatorPrototypes.get(context.budget)?.get(node.async === true);
  const closure = createSandboxClosure({
    sourceRange: functionSources.get(node),
    guest: true,
    generator: true,
    sandbox: true,
    length: getFunctionLength(node.params),
    ...(node.id === undefined ? { name: context.inferredName } : { name: node.id.name }),
    retainedValues: () => [...context.scope.retainedDataRoots(), context.functionEnvironment?.homeObject, context.functionEnvironment?.newTarget],
    call: async (args, callContext) => {
      // Native generators select their instance prototype before initializing parameters.
      const candidate = prototypes === undefined ? undefined : getGuestFunctionProperty(closure, "prototype");
      const prototype = typeof candidate === "object" && candidate !== null ? candidate : prototypes?.instancePrototype;
      const releasePrototype = prototype === undefined ? undefined : retainValues(context.budget, () => [prototype]);
      try {
        const closureContext = {
          ...context,
          callee: closure,
          strict: functionStrictness.get(node) ?? true,
          compilation: callContext?.compilation?.owner?.budget === context.budget ? callContext.compilation : context.compilation,
          callStack: [...(callContext?.stack ?? context.callStack)]
        };
        const scope = await createClosureScope(
          node,
          args,
          callContext?.thisValue,
          closureContext,
          evaluateNode
        );
        const channel = createGeneratorChannel((generatorYield) => {
          const execute = async () => {
            const result = await evaluateNode(node.body, {
              ...closureContext,
              asyncFunction: false,
              functionBody: node.body,
              asyncGenerator: node.async,
              asyncGeneratorFrame: node.async ? generator : undefined,
              onSuspend: undefined,
              generatorBlockScopes: new Map(),
              generatorExpressionStates: new Map(),
              captureGeneratorScope: (suspendedScope, blocks, completions, expressions) => {
                origin.suspendedScope = suspendedScope;
                origin.blockScopes = blocks;
                origin.finallyCompletions = completions;
                origin.expressionStates = expressions;
              },
              generatorYield: (value, yieldNodeId, yieldedResult) => {
                generator.state = "suspended";
                return generatorYield(value, yieldNodeId, yieldedResult);
              },
              scope
            });
            if (result.kind === "error") {
              throw result.error;
            }
            if (result.kind === "throw") {
              throw result.value;
            }
            const value = result.hasValue ? result.value : undefined;
            return value;
          };
          return execute();
        });
        const generator = createSandboxGenerator(channel, { async: node.async });
        if (node.async) bindAsyncGeneratorSignal(generator, context.signal, context.budget);
        if (prototype !== undefined) setSandboxPrototype(generator, prototype, context.budget);
        const origin = registerGeneratorOrigin(generator, node, scope, closureContext);
        return generator;
      } finally { releasePrototype?.(); }
    }
  });
  if (prototypes !== undefined) {
    const prototype: SandboxObject = Object.create(null);
    markDescriptorObject(prototype);
    setSandboxPrototype(prototype, prototypes.instancePrototype);
    Object.defineProperty(materializeFunctionProperties(closure), "prototype", { value: prototype, writable: true });
    setSandboxPrototype(closure, prototypes.functionPrototype);
  }
  registerClosureOrigin(closure, node, context);
  return closure;
}

function isConstructResult(value: SandboxValue): boolean {
  return typeof value === "object" && value !== null;
}

export async function evaluateAwaitExpression(
  node: AwaitExpression,
  context: AsyncEvaluationContext,
  evaluateNode: EvaluateAsyncNode
): Promise<AsyncEvaluationResult> {
  if ((context.asyncFunction || context.asyncGeneratorFrame !== undefined) && context.generatorResume?.completed !== true && context.generatorResume?.yieldNodeId === node.nodeId) {
    return {kind: "normal", hasValue: true, value: await suspendAsyncFunctionValue(undefined, node, context)};
  }
  const replayState = context.captureReplayState?.();
  const argument = await evaluateNode(node.argument, context);
  if (argument.kind !== "normal") {
    return argument;
  }

  if (context.asyncFunction || context.asyncGeneratorFrame !== undefined) {
    return {kind: "normal", hasValue: true, value: await suspendAsyncFunctionValue(argument.value, node, context, replayState, createCoercionContext(context))};
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
      value: await suspendJob(awaitSandboxValue(argument.value, context.signal, context.budget, createCoercionContext(context)))
    };
  } finally {
    leaveAwait();
  }
}

export type AsyncSuspensionContext = Pick<AsyncEvaluationContext, "scope" | "captureGeneratorScope" | "generatorBlockScopes" |
  "finallyCompletions" | "generatorExpressionStates" | "generatorYield" | "generatorResume" | "asyncFunction" | "asyncGeneratorFrame" |
  "budget" | "onYield" | "snapshot" | "onSuspend" | "captureReplayState" | "signal">;

export async function suspendAsyncFunctionValue(value: SandboxValue, node: ParseResult, context: AsyncSuspensionContext, replayState = context.captureReplayState?.(), callContext?: SandboxCallContext, phase: "await" | "yield" | "return" | "resume-return" = "await"): Promise<SandboxValue> {
  if (context.generatorYield === undefined || node.nodeId === undefined) throw new TypeError("Missing async function suspension identity.");
  let awaited: SandboxPromise;
  if (isSandboxPromise(value)) {
    const prepared = prepareAwaitedPromise(value, context.budget, callContext);
    awaited = prepared instanceof Promise ? await prepared : prepared;
  } else {
    const wrapper = promiseReplayContext.exit(() => createPendingPromiseCapability(context.budget, callContext));
    const prefix = wrapper.resolve.call([value], callContext);
    if (prefix instanceof Promise) await prefix;
    awaited = wrapper.promise;
  }
  if (context.signal?.aborted) {
    observeSandboxPromise(awaited, true);
    await awaitWithSignal(awaited.promise, context.signal);
  }
  context.captureGeneratorScope?.(context.scope, context.generatorBlockScopes, context.finallyCompletions, context.generatorExpressionStates);
  context.onSuspend?.();
  const otelSpan = getBoundOtelSpan(value);
  emitResumeBreakpoint(context, {kind: "await", nodeId: node.nodeId, span: node.span, replayState,
    ...(otelSpan === undefined ? {} : {otelSpan})});
  const leaveAwait = context.budget.enterAwait();
  const generator = context.asyncGeneratorFrame;
  const origin = generator === undefined ? undefined : getGeneratorOrigin(generator);
  if (generator !== undefined) {
    const driver = asyncGeneratorDrivers.get(generator);
    if (driver === undefined || origin === undefined) throw new TypeError("Missing async generator suspension owner.");
    driver.suspension = "await";
    origin.awaitPhase = phase;
  }
  try {
    const completion = await context.generatorYield(awaited, node.nodeId);
    if (context.generatorResume !== undefined) context.generatorResume.completed = true;
    if (completion.type === "throw") throw completion.value;
    return completion.value as SandboxValue;
  } finally {if (origin !== undefined) origin.awaitPhase = undefined; leaveAwait();}
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
  context = { ...context, compilation, strict: functionStrictness.get(node) ?? true };
  try {
    const scope = await createClosureScope(node, args, thisValue, context, evaluateNode);

    const result = await evaluateNode(node.body, {
      ...context,
      asyncGenerator: false,
      asyncFunction: false,
      asyncGeneratorFrame: undefined,
      functionBody: node.body.type === "BlockStatement" ? node.body : undefined,
      scope
    });

    const value = "hasValue" in result && result.hasValue ? result.value : undefined;
    reconcileCompiledValues(
      context.budget,
      [...scope.retainedDataRoots(), value],
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
  const functionScope = context.scope.child({}, { functionBoundary: true });
  const hasParameterExpressions = node.params.some(containsParameterExpression);
  const separateParameters = hasParameterExpressions && functionStrictness.get(node) === false;
  const scope = separateParameters ? functionScope.child() : functionScope;
  const needsArguments = node.type !== "ArrowFunctionExpression"
    && !node.params.some(param => [...boundIdentifiers(param)].some(identifier => identifier.name === "arguments"))
    && (hasParameterExpressions || !isBlockBody(node.body) || !node.body.body.some(statement => {
      if (statement.type === "FunctionDeclaration" || statement.type === "ClassDeclaration")
        return statement.id?.name === "arguments";
      return statement.type === "VariableDeclaration" && statement.kind !== "var"
        && statement.declarations.some(declaration => [...boundIdentifiers(declaration.id)].some(identifier => identifier.name === "arguments"));
    }));
  const mapped = needsArguments && functionStrictness.get(node) === false
    && node.params.every(param => param.type === "Identifier");
  if (node.type !== "ArrowFunctionExpression") {
    if (functionStrictness.get(node) === false) {
      if (thisValue === null || thisValue === undefined)
        thisValue = getRealmGlobalObject(context.budget);
      else if (typeof thisValue !== "object") thisValue = createSandboxBox(thisValue);
    }
    const construction = context.functionEnvironment?.construction;
    if (construction?.derived === true) scope.predeclare("this", "const");
    else scope.declare("this", "const", thisValue);
    if (needsArguments) {
      context.budget.allocateArrayLength(args.length);
      if (!mapped) scope.declare("arguments", functionStrictness.get(node) === false && !separateParameters ? "var" : "let", createSandboxArguments(args));
    }
    await construction?.initialize(scope);
  }
  await bindParameters(node.params, args, scope, context, evaluateNode, separateParameters ? "let" : "var");
  if (mapped) scope.declare("arguments", "var", createMappedSandboxArguments(
    args, node.params.map(param => {if (param.type !== "Identifier") throw new TypeError("Invalid mapped parameter."); return param.name;}),
    scope, context.callee
  ));
  const bodyScope = hasParameterExpressions
    ? scope.child({}, { functionBoundary: true })
    : scope;
  hoistVarDeclarations(node.body, bodyScope);
  prepareLegacyBlockFunctions(node, bodyScope);
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
  evaluateNode: EvaluateAsyncNode,
  kind: "let" | "var"
): Promise<void> {
  const names = new Set<string>();
  for (const param of params) {
    for (const identifier of boundIdentifiers(param)) {
      if (names.has(identifier.name)) continue;
      scope.predeclare(identifier.name, kind);
      names.add(identifier.name);
    }
  }

  names.clear();
  for (let index = 0; index < params.length; index += 1) {
    const param = params[index];
    if (param.type === "Identifier") {
      if (names.has(param.name)) {
        await scope.assign(param.name, args[index]);
        continue;
      }
      names.add(param.name);
    }
    if (param.type === "RestElement") {
      const rest = args.slice(index);
      const prototype = getSandboxPrototype(rest, context.budget);
      if (prototype !== null) setSandboxPrototype(rest, prototype, context.budget);
      context.budget.allocateArrayLength(rest.length);
      const binding = await bindPattern(param, rest, { kind, initialize: true }, scope, createPatternContext(context, scope, evaluateNode));
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
      { kind, initialize: true },
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

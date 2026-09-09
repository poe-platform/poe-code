import { Budget, SandboxError, type CompileOwner } from "../interp/budget.js";
import { createBoundFunction } from "../interp/bound-function.js";
import { invokeBuiltinClosure } from "../interp/builtin-call.js";
import { getGeneratorProperties } from "../interp/generator-properties.js";
import { restoreRegexProperties } from "./regexp-properties.js";
import { classOrigins, createClassConstructor, createConstructionEnvironment, type Field } from "../interp/classes.js";
import { constructionStates, type ConstructionState } from "../interp/construction-state.js";
import { mapIteratorSnapshot } from "../interp/iteration.js";
import { createInterpretedClosure, executeAsyncFunction, type AsyncEvaluationContext } from "../interp/async.js";
import { createBuiltinBindings } from "../interp/globals.js";
import { resolveIntrinsicIdentity } from "../interp/intrinsics.js";
import { allocateGuestScopes, hydrateGuestScopes } from "./scope-frames.js";
import { createMappedSandboxArguments, mappedArgumentStates } from "../interp/arguments.js";
import type { DynamicSource } from "../parse/dynamic-source.js";
import { functionStrictness } from "../parse/function-source.js";
import { createModuleEnvironment, resolveModuleFunction, type ModuleEnvironment } from "../modules/registry.js";
import { moduleFunctionOrigins } from "../interp/module-function-origin.js";
import { hostFunctionMetadata } from "../interp/host-function-metadata.js";
import { assertResourceScopeState } from "../interp/resource-management.js";
import { asyncFunctionDrivers, bindAsyncFunctionSignal, createAsyncFunctionHandler, type AsyncFunctionDriver } from "../interp/async-function-driver.js";
import { asyncGeneratorDrivers, asyncGeneratorRequestOwners, bindAsyncGeneratorSignal, createAsyncGeneratorHandler, type AsyncGeneratorDriver } from "../interp/async-generator-driver.js";
import { registerTemplateObject } from "../interp/template-objects.js";
import type { SandboxArray } from "../interp/values.js";
import { restorePropertyDescriptors } from "./property-descriptors.js";
import { getCollectionProperties } from "../interp/collection-properties.js";
import { registerGeneratorOrigin } from "../interp/closure-origin.js";
import type { CompletionResult } from "../interp/exceptions.js";
import { toPropertyKey } from "../interp/property-key.js";
import { CompileScope } from "../interp/regex/compile-guard.js";
import { decodeTypedArrayStorage, restoreTypedArrayProperties } from "./typed-array.js";
import { decodeArrayBufferStorage } from "./array-buffer.js";
import { decodeDataViewStorage } from "./data-view.js";
import { restoreDateTime } from "../interp/date.js";
import { createRawJson } from "../interp/raw-json.js";
import { createModuleNamespace } from "../interp/module-namespace.js";
import { createSandboxBox } from "../interp/boxed.js";
import { createSandboxDate } from "../interp/date.js";
import { createSandboxLocale } from "../interp/intl-locale.js";
import { createSandboxCollator, collatorState } from "../interp/intl-collator.js";
import { createSandboxListFormat } from "../interp/intl-listformat.js";
import { createSandboxRelativeTimeFormat } from "../interp/intl-relativetimeformat.js";
import { createGuestProxyCarrier, createGuestProxyRevoker, guestProxyStates, guestProxyRevokers } from "../interp/guest-proxy.js";
import { createSandboxDisplayNames } from "../interp/intl-displaynames.js";
import { createSandboxPluralRules } from "../interp/intl-pluralrules.js";
import { createSandboxDurationFormat } from "../interp/intl-durationformat.js";
import { createSandboxSegmenter, createSandboxSegments, isSandboxSegmenter } from "../interp/intl-segmenter.js";
import { createSandboxNumberFormat, numberFormatState } from "../interp/intl-numberformat.js";
import { createSandboxDateTimeFormat, dateTimeFormatState } from "../interp/intl-datetimeformat.js";
import { restoreBoxedProperties } from "./boxed.js";
import { sandboxErrorNames, sandboxErrorTypes } from "../error/shape.js";
import { SnapshotMismatchError } from "../restore.js";
import { evaluateNode, Scope, setSandboxProperty } from "../interp/interpreter.js";
import { getGuestFunctionProperties, getGuestFunctionProperty, getSandboxDataProperty, isGuestClosure, materializeFunctionProperties, registerGuestClosure, setSandboxPrototype } from "../interp/object-model.js";
import { functionSources } from "../parse/function-source.js";
import { wrapCallerInjectedBindings, type CallerInjectedBinding } from "../interp/host-bridge.js";
import { restoreSandboxCollectionIterator } from "../interp/collection-iterator.js";
import { restoreSandboxArrayIterator } from "../interp/array-iterator.js";
import { restoreSandboxStringIterator } from "../interp/string-iterator.js";
import { iteratorWrapperStates } from "../interp/iterator-wrapper.js";
import { disposableStackStates } from "../interp/disposable-stack.js";
import { asyncDisposableStackStates, asyncCleanupStates, createAsyncCleanupHandler, type AsyncCleanupState, type AsyncDisposableResource } from "../interp/async-disposable-stack.js";
import { iteratorHelperStates } from "../interp/iterator-helper.js";
import { privateElements, type PrivateName, type PrivateElement } from "../interp/private-state.js";
import { promiseStates } from "../interp/promise-state.js";
import { promiseResolvingFunctions } from "../interp/promise-resolvers.js";
import { createPendingPromiseCapability, attachPendingPromiseReaction, createPromiseAdoptionBridge, createPromiseAggregateHandler } from "../interp/promise.js";
import { promiseAggregateStates, promiseAggregateEntries, linkPromiseAggregateProducer, type PromiseAggregateState } from "../interp/promise-continuations.js";
import { createPromiseCapabilityExecutor } from "../interp/promise.js";
import { createThenableBridge } from "../interp/promise.js";
import { thenableContinuations } from "../interp/promise-continuations.js";
import type { PromiseCapabilityExecutorState } from "../interp/promise-continuations.js";
import { promiseAdoptionBridges, promiseContinuations, type PromiseContinuation } from "../interp/promise-continuations.js";
import { SandboxJobQueue } from "../interp/jobs.js";
import { symbolRegistryOrigins } from "../interp/symbol-registry.js";
import { isSandboxPromise, isSandboxGenerator, getPromiseProperties } from "../interp/values.js";
import type { PrivateElementData } from "./guest-heap.js";
import type { AsyncResourceData } from "./guest-heap.js";

function restoreAsyncResources(resources: AsyncResourceData<SerializedSnapshotValue>[], state: RestoreState): AsyncDisposableResource[] {
  return resources.map(resource => {
    const method = deserializeValue(resource.method, state);
    if (method !== undefined && !isSandboxClosure(method)) throw new TypeError("Invalid async disposer.");
    return {method, receiver: deserializeValue(resource.receiver, state) as SandboxValue,
      args: resource.args.map(arg => deserializeValue(arg, state) as SandboxValue), syncFallback: resource.syncFallback,
      ...(resource.synchronous === undefined ? {} : {synchronous: resource.synchronous})};
  });
}

function restorePrivateElements<T>(entries: PrivateElementData<T>[], decode: (entry: T) => SandboxValue): Map<PrivateName, PrivateElement> {
  const result = new Map<PrivateName, PrivateElement>();
  for (const entry of entries) {
    const name = decode(entry.name) as PrivateName;
    if (entry.kind === "accessor") {
      const get = decode(entry.get), set = decode(entry.set);
      if (get !== undefined && !isSandboxClosure(get) || set !== undefined && !isSandboxClosure(set)) throw new TypeError("Invalid private accessor.");
      result.set(name, { kind: "accessor", get, set });
    } else {
      const value = decode(entry.value);
      if (entry.kind === "method") {
        if (!isSandboxClosure(value)) throw new TypeError("Invalid private method.");
        result.set(name, { kind: "method", value });
      } else result.set(name, { kind: "field", value });
    }
  }
  return result;
}
import type { SandboxObject } from "../interp/values.js";
import { restoreSandboxRegExpIterator } from "../interp/regexp-iterator.js";
import { wellKnownSymbols } from "../interp/symbols.js";
import { restoreSymbolProperties } from "./symbols.js";
import { restoreDateProperties } from "./date-properties.js";
import { isSandboxClosure, isSandboxMap, isSandboxSet, isSandboxRegex, getRegexProperties } from "../interp/values.js";
import {
  createSandboxArguments,
  createSandboxClosure,
  createSandboxGenerator,
  createSandboxMap,
  createSandboxPromise,
  createSandboxRegex,
  createSandboxSet,
  reconcileCompiledValues,
  type SandboxCallContext,
  type SandboxClosure,
  type SandboxGenerator,
  type SandboxPromise,
  type SandboxValue
} from "../interp/values.js";
import {
  createGeneratorChannel,
  restoreGeneratorChannel,
  type GeneratorCompletion
} from "../interp/generator.js";
import { hashSource } from "../parse/hash.js";
import { getFunctionLength } from "../parse/bindings.js";
import {
  parseModule,
  type ArrowFunctionExpression,
  type FunctionDeclaration,
  type FunctionExpression,
  type Module,
  type ParseResult
} from "../parse/parser.js";
import {
  createUnknownModuleMessage,
  type ModuleExports,
  type ModuleRegistry
} from "../modules/registry.js";
import { interpret } from "../interp/interpreter.js";
import { bindPattern } from "../interp/patterns.js";
import { resolvePendingHostCallResumePolicy } from "./policy.js";
import { validateInterpreterSnapshot, validateSnapshotSourceHash } from "./validation.js";
import type {
  RuntimeCallFrame,
  RuntimePendingPromise,
  RuntimeScopeFrame,
  SerializedClosureValue,
  SerializedGeneratorValue,
  SerializedHeapValue,
  SerializedPromiseValue,
  SerializedReferenceValue,
  RuntimeSnapshotValue,
  SerializedPendingPromise,
  SerializedScopeFrame,
  SerializedSnapshot,
  SerializedSnapshotValue
} from "./serialize.js";

type SnapshotId = RuntimeScopeFrame["id"];

export type RestoreOptions = {
  source: string;
  modules?: ModuleRegistry;
  budget?: Budget;
  signal?: AbortSignal;
};

export type RestoredCallFrame = RuntimeCallFrame & {
  awaitingPromise?: RuntimePendingPromise;
  node: ParseResult;
  scope: Scope;
};

export type RestoredScopeFrame = RuntimeScopeFrame & {
  scope: Scope;
};

export type RestoredSnapshot = {
  ast: Module;
  budget: Budget;
  callStack: RestoredCallFrame[];
  currentAstNodeId: number;
  currentNode: ParseResult;
  currentScope: Scope;
  moduleBindings: Record<string, SandboxValue>;
  pendingPromises: RuntimePendingPromise[];
  scopeChain: RestoredScopeFrame[];
  signal?: AbortSignal;
  sourceHash: string;
};

type RestoreState = {
  moduleFunctions: ModuleEnvironment;
  thenableBridges: Map<number, ReturnType<typeof createThenableBridge>>;
  constructionEnvironments: Map<number, NonNullable<NonNullable<AsyncEvaluationContext["functionEnvironment"]>["construction"]>>;
  promiseReactionRecords: Map<SandboxPromise, {source: SandboxPromise; capability: ReturnType<typeof createPendingPromiseCapability>; onFulfilled: SandboxValue; onRejected: SandboxValue;
    aggregate?: SandboxPromise;
    reactionCapability?: Extract<PromiseContinuation, {kind: "reaction"}>["capability"]}>;
  promiseReactionOrders: Map<SandboxPromise, SandboxPromise[]>;
  pendingCapabilities: WeakMap<SandboxPromise, ReturnType<typeof createPendingPromiseCapability>>;
  symbolRegistry?: Map<string, symbol>;
  guestScopes: Map<number, Scope>;
  rootNode: ParseResult;
  signal?: AbortSignal;
  intrinsicsInitialized: boolean;
  initializeIterators: Array<() => void>;
  detachBuffers: Array<() => void>;
  budget: Budget;
  compilation: CompileScope;
  heap: Record<string, SerializedHeapValue>;
  heapValueById: Map<number, RuntimeSnapshotValue>;
  resolvingStorage: Set<number>;
  moduleBindings: Record<string, SandboxValue>;
  nodeById: Map<number, ParseResult>;
  dynamicSources: Map<number, DynamicSource>;
  pendingPromiseById: Map<SnapshotId, RuntimePendingPromise>;
  serializedScopeById: Map<SnapshotId, SerializedScopeFrame>;
  scopeById: Map<SnapshotId, Scope>;
  scopeFrameById: Map<SnapshotId, RuntimeScopeFrame>;
};

export function restore(
  snapshot: SerializedSnapshot,
  options: RestoreOptions,
  owner?: CompileOwner
): RestoredSnapshot {
  const budget = options.budget ?? new Budget();
  const operation = budget.acquireCompileOwner(false, owner);
  const compilation = new CompileScope(operation.owner);
  try {
    validateSnapshotSourceHash(snapshot);
    let currentSourceHash: string;
    try {
      currentSourceHash = hashSource(options.source, operation.owner);
    } catch (error) {
      if (error instanceof SandboxError) throw error;
      throw new Error(
        `source changed since snapshot was taken (hash ${snapshot.sourceHash} expected, but current source could not be hashed); pass --reset to discard`
      );
    }

    if (snapshot.sourceHash !== currentSourceHash) {
      throw new SnapshotMismatchError(snapshot.sourceHash, currentSourceHash);
    }

    const ast = parseModule(options.source, "<input>", operation.owner);
    const nodeById = indexAstNodes(ast);
    const dynamicSources = new Map<number, DynamicSource>();
    validateInterpreterSnapshot(snapshot, nodeById, budget, dynamicSources, operation.owner);
    const currentNode = nodeById.get(snapshot.currentAstNodeId);

    if (currentNode === undefined) {
      throw new Error(`Snapshot references unknown AST node ${snapshot.currentAstNodeId}.`);
    }

    const state: RestoreState = {
      moduleFunctions: createModuleEnvironment(options.modules, {budget,compileOwner:operation.owner,signal:options.signal}),
      promiseReactionRecords: new Map(),
      constructionEnvironments: new Map(),
      thenableBridges: new Map(),
      promiseReactionOrders: new Map(),
      pendingCapabilities: new WeakMap(),
      guestScopes: new Map(),
      rootNode: currentNode,
      signal: options.signal,
      intrinsicsInitialized: false,
      initializeIterators: [],
      detachBuffers: [],
      budget,
      compilation,
      heap: snapshot.heap ?? {},
      heapValueById: new Map(),
      resolvingStorage: new Set(),
      moduleBindings: restoreModuleBindings(snapshot.moduleBindings, options.modules, {
        budget,
        compileOwner: operation.owner,
        signal: options.signal
      }),
      nodeById,
      dynamicSources,
      pendingPromiseById: new Map(),
      serializedScopeById: new Map(snapshot.scopeChain.map((frame) => [frame.id, frame])),
      scopeById: new Map(),
      scopeFrameById: new Map()
    };

    const guestFrames = new Map<number, Extract<SerializedHeapValue, { kind: "scope-frame" }>>();
    for (const [id, node] of Object.entries(state.heap)) {
      if (node.kind === "scope-frame") guestFrames.set(Number(id), node);
    }
    state.guestScopes = allocateGuestScopes(guestFrames, budget);
    hydrateGuestScopes(guestFrames, state.guestScopes,
      value => deserializeValue(value as SerializedSnapshotValue, state) as SandboxValue, budget);
    for (const scope of state.guestScopes.values()) {
      if (scope.moduleEnvironment !== undefined) {
        scope.moduleEnvironment = createModuleEnvironment(options.modules,{
          budget,compileOwner:operation.owner,signal:options.signal
        },scope.moduleEnvironment);
      }
    }

    const pendingPromises = snapshot.pendingPromises.map((entry) =>
      restorePendingPromise(entry, state)
    );
    const scopeChain = snapshot.scopeChain.map((frame) => restoreScopeFrame(frame, state));
    const currentScopeId = snapshot.callStack.at(-1)?.scopeId ?? scopeChain.at(-1)?.id;

    if (currentScopeId === undefined) {
      throw new Error("Snapshot does not contain a scope to resume.");
    }

    const currentScope = state.scopeById.get(currentScopeId);
    if (currentScope === undefined) {
      throw new Error(`Snapshot references unknown scope ${String(currentScopeId)}.`);
    }

    const callStack = snapshot.callStack.map((frame) => restoreCallFrame(frame, state));
    for (const initialize of state.initializeIterators) initialize();
    for (const scope of state.guestScopes.values()) {
      if (scope.resourceState !== undefined) assertResourceScopeState(scope.resourceState);
    }
    new SandboxJobQueue().bind(() => {
      for (const value of state.heapValueById.values()) {
        const driver = value !== null && typeof value === "object" ? asyncFunctionDrivers.get(value) : undefined;
        if (driver !== undefined) bindAsyncFunctionSignal(driver, state.signal, budget);
        if (isSandboxGenerator(value) && value.async) bindAsyncGeneratorSignal(value, state.signal, budget);
      }
      for (const [source, reactions] of state.promiseReactionOrders) {
        for (const reaction of reactions) {
          const record = state.promiseReactionRecords.get(reaction);
          if (record === undefined || record.source !== source) throw new TypeError("Invalid restored promise reaction.");
          attachPendingPromiseReaction(source, record.capability, record.onFulfilled, record.onRejected, budget, undefined, record.reactionCapability);
          if (record.aggregate !== undefined) linkPromiseAggregateProducer(reaction, record.aggregate);
          state.promiseReactionRecords.delete(reaction);
        }
      }
      if (state.promiseReactionRecords.size !== 0) throw new TypeError("Unlisted restored promise reaction.");
    });
    for (const detach of state.detachBuffers) detach();
    reconcileCompiledValues(
      budget,
      [
        ...currentScope.retainedDataRoots(),
        ...pendingPromises.flatMap((pending) =>
          Object.values(pending).filter(isSandboxSnapshotValue)
        )
      ],
      compilation
    );

    return {
      ast,
      budget,
      callStack,
      currentAstNodeId: snapshot.currentAstNodeId,
      currentNode,
      currentScope,
      moduleBindings: state.moduleBindings,
      pendingPromises,
      scopeChain: scopeChain.map((frame) => ({
        ...frame,
        scope: state.scopeById.get(frame.id) ?? currentScope
      })),
      signal: options.signal,
      sourceHash: snapshot.sourceHash
    };
  } finally {
    compilation.dispose();
    operation.release();
  }
}

function isSandboxSnapshotValue(value: unknown): value is SandboxValue {
  return value !== undefined && !(value instanceof Promise);
}

function restoreCallFrame(frame: RuntimeCallFrame, state: RestoreState): RestoredCallFrame {
  const node = state.nodeById.get(frame.astNodeId);
  if (node === undefined) {
    throw new Error(`Snapshot references unknown AST node ${frame.astNodeId}.`);
  }

  const scope = state.scopeById.get(frame.scopeId);
  if (scope === undefined) {
    throw new Error(`Snapshot references unknown scope ${String(frame.scopeId)}.`);
  }

  const awaitingPromise =
    frame.awaitingPromiseId === undefined
      ? undefined
      : state.pendingPromiseById.get(frame.awaitingPromiseId);

  if (frame.awaitingPromiseId !== undefined && awaitingPromise === undefined) {
    throw new Error(
      `Snapshot references unknown pending promise ${String(frame.awaitingPromiseId)}.`
    );
  }

  return awaitingPromise === undefined
    ? {
        ...frame,
        node,
        scope
      }
    : {
        ...frame,
        awaitingPromise,
        node,
        scope
      };
}

function restorePendingPromise(
  entry: SerializedPendingPromise,
  state: RestoreState
): RuntimePendingPromise {
  const existing = state.pendingPromiseById.get(entry.id);
  if (existing !== undefined) {
    return existing;
  }

  const runtime = Object.assign(
    Object.create(createSandboxPromise(new Promise<SandboxValue>(() => undefined))),
    {
      id: entry.id
    }
  ) as RuntimePendingPromise;

  state.pendingPromiseById.set(entry.id, runtime);

  for (const [key, value] of Object.entries(entry)) {
    if (key === "id") {
      continue;
    }

    runtime[key] = deserializeValue(value as SerializedSnapshotValue, state);
  }

  runtime.resumePolicy = resolvePendingHostCallResumePolicy(runtime);

  return runtime;
}

function restoreScopeFrame(frame: SerializedScopeFrame, state: RestoreState): RuntimeScopeFrame {
  const existing = state.scopeFrameById.get(frame.id);
  if (existing !== undefined) {
    return existing;
  }

  const pending: SerializedScopeFrame[] = [];
  let current: SerializedScopeFrame | undefined = frame;
  while (current !== undefined && !state.scopeFrameById.has(current.id)) {
    pending.push(current);
    current =
      current.parentId === undefined ? undefined : state.serializedScopeById.get(current.parentId);
  }

  while (pending.length > 0) {
    createScopeFrame(pending.pop() as SerializedScopeFrame, state);
  }

  return state.scopeFrameById.get(frame.id) as RuntimeScopeFrame;
}

function createScopeFrame(frame: SerializedScopeFrame, state: RestoreState): void {
  const bindings = Object.create(null) as Record<string, RuntimeSnapshotValue>;

  const runtimeFrame =
    frame.parentId === undefined
      ? {
          id: frame.id,
          bindings
        }
      : {
          id: frame.id,
          parentId: frame.parentId,
          bindings
        };

  state.scopeFrameById.set(frame.id, runtimeFrame);

  for (const [name, value] of Object.entries(frame.bindings)) {
    bindings[name] = deserializeValue(value, state);
  }

  if (frame.parentId === undefined) {
    for (const [name, value] of Object.entries(state.moduleBindings)) {
      if (Object.hasOwn(bindings, name)) {
        throw new Error(`Snapshot tried to restore module binding '${name}' twice.`);
      }

      bindings[name] = value as RuntimeSnapshotValue;
    }
  }

  const parentScope =
    frame.parentId === undefined ? undefined : state.scopeById.get(frame.parentId);
  if (frame.parentId !== undefined && parentScope === undefined) {
    throw new Error(`Snapshot references unknown scope ${String(frame.parentId)}.`);
  }
  const scope =
    parentScope === undefined
      ? new Scope(bindings as Record<string, SandboxValue>)
      : parentScope.child(bindings as Record<string, SandboxValue>);

  state.scopeById.set(frame.id, scope);
}

function restoreParentScope(scopeId: SnapshotId, state: RestoreState): Scope {
  const existing = state.scopeById.get(scopeId);
  if (existing !== undefined) {
    return existing;
  }

  const frame = state.serializedScopeById.get(scopeId);
  if (frame !== undefined) {
    restoreScopeFrame(frame, state);
    const restored = state.scopeById.get(scopeId);
    if (restored !== undefined) {
      return restored;
    }
  }

  throw new Error(`Snapshot references unknown scope ${String(scopeId)}.`);
}

function restoreThenableBridge(value: SerializedSnapshotValue, state: RestoreState): ReturnType<typeof createThenableBridge> {
  const ref = value as SerializedReferenceValue;
  const serialized = ref?.kind === "ref" ? state.heap[String(ref.id)] : undefined;
  if (serialized?.kind !== "thenable-state") throw new TypeError("Invalid thenable state reference.");
  const existing = state.thenableBridges.get(ref.id);
  if (existing !== undefined) return existing;
  const bridge = createThenableBridge({source: undefined, owner: undefined, completed: serialized.completed,
    invocationPending: false, settlement: undefined}, {budget: state.budget});
  state.thenableBridges.set(ref.id, bridge);
  state.initializeIterators.push(() => {
    const source = deserializeValue(serialized.source, state) as SandboxValue;
    const owner = deserializeValue(serialized.owner, state);
    if (owner !== undefined && !isSandboxPromise(owner)) throw new TypeError("Invalid thenable owner.");
    Object.assign(bridge.state, {source, owner, settlement: serialized.settlement === undefined ? undefined : {
      state: serialized.settlement.state, value: deserializeValue(serialized.settlement.value, state)
    }});
    if (owner !== undefined && !bridge.state.completed) {
      const capability = state.pendingCapabilities.get(owner);
      const continuation = promiseContinuations.get(owner);
      if (capability === undefined || continuation?.kind !== "capability") throw new TypeError("Invalid thenable owner capability.");
      thenableContinuations.set(owner, bridge.state);
      continuation.state.settled = true;
      continuation.resolution = {status: "fulfilled", value: source};
      capability.fulfill(bridge.promise);
    }
  });
  return bridge;
}

function restoreConstructionEnvironment(value: SerializedSnapshotValue, state: RestoreState): NonNullable<NonNullable<AsyncEvaluationContext["functionEnvironment"]>["construction"]> {
  const reference = value as SerializedReferenceValue;
  if (reference?.kind !== "ref") throw new TypeError("Invalid construction environment reference.");
  const serialized = state.heap[String(reference.id)];
  if (serialized?.kind !== "construction-environment") throw new TypeError("Invalid construction environment record.");
  const existing = state.constructionEnvironments.get(reference.id);
  if (existing !== undefined) return existing;
  const environment = {} as NonNullable<NonNullable<AsyncEvaluationContext["functionEnvironment"]>["construction"]>;
  const construction = {} as ConstructionState;
  state.constructionEnvironments.set(reference.id, environment);
  constructionStates.set(environment, construction);
  state.initializeIterators.push(() => {
    const constructor = deserializeValue(serialized.constructor, state);
    const newTarget = deserializeValue(serialized.newTarget, state);
    const prototype = deserializeValue(serialized.prototype, state);
    const scopeRef = serialized.thisScope as SerializedReferenceValue;
    const scope = state.guestScopes.get(scopeRef.id);
    const origin = constructor !== null && typeof constructor === "object" ? classOrigins.get(constructor) : undefined;
    if (!isSandboxClosure(constructor) || origin === undefined || !isSandboxClosure(newTarget) || newTarget.construct === undefined ||
        prototype === null || typeof prototype !== "object" || scope === undefined)
      throw new TypeError("Invalid restored construction state.");
    Object.assign(construction, {constructor, newTarget, prototype, thisScope: scope,
      thisValue: deserializeValue(serialized.thisValue, state), initialized: serialized.initialized, activeCalls: 0});
    Object.assign(environment, createConstructionEnvironment(construction, {
      scope: origin.scope, budget: state.budget, compilation: state.compilation, rootNode: state.rootNode,
      signal: state.signal, callStack: [], activeLoopIterations: new Map(), restoredLoopIterations: new Map(),
      stats: {currentDataSize: 0, nodeVisits: 0, peakDataSize: 0}
    }, evaluateNode));
  });
  return environment;
}

function deserializeValue(
  value: SerializedSnapshotValue,
  state: RestoreState
): RuntimeSnapshotValue {
  if (
    value === null ||
    typeof value === "boolean" ||
    typeof value === "number" ||
    typeof value === "string"
  ) {
    return value;
  }

  if (Array.isArray(value)) {
    return value.map((entry) => deserializeValue(entry, state));
  }

  if (value.kind === "bigint" && typeof value.value === "string") return BigInt(value.value);

  if (isSerializedUndefinedValue(value)) {
    return undefined;
  }

  if (isSerializedNonFiniteNumberValue(value)) {
    switch (value.value) {
      case "-0":
        return -0;
      case "NaN":
        return Number.NaN;
      case "Infinity":
        return Number.POSITIVE_INFINITY;
      case "-Infinity":
        return Number.NEGATIVE_INFINITY;
    }
  }

  if (isSerializedReferenceValue(value)) {
    return restoreHeapValue(value.id, state);
  }

  if (isSerializedPromiseValue(value)) {
    return restorePromiseValue(value.id, state);
  }

  if (isSerializedClosureValue(value)) {
    return restoreClosureValue(value.astNodeId, value.capturedScopeId, state);
  }

  if (isSerializedGeneratorValue(value)) {
    return restoreGeneratorValue(value, state);
  }

  if (isSerializedRegexValue(value)) {
    return createSandboxRegex(value.source, value.flags, value.lastIndex, state.compilation);
  }

  const object = Object.create(null) as Record<string, RuntimeSnapshotValue>;
  for (const [key, entry] of Object.entries(value)) {
    object[key] = deserializeValue(entry, state);
  }

  return object;
}

function restoreGeneratorValue(
  value: SerializedGeneratorValue,
  state: RestoreState
): SandboxGenerator {
  if (value.state === "done") {
    const generator = createSandboxGenerator(createGeneratorChannel(async () => undefined), { async: value.async });
    generator.state = "done";
    return generator;
  }

  const node = state.nodeById.get(value.astNodeId);
  if (node?.type !== "FunctionDeclaration" && node?.type !== "FunctionExpression") {
    throw new Error(`Snapshot references unknown generator AST node ${value.astNodeId}.`);
  }
  if (!node.generator) {
    throw new Error(`Snapshot references non-generator AST node ${value.astNodeId}.`);
  }

  const createBody: Parameters<typeof createGeneratorChannel>[0] = async (generatorYield) => {
    const capturedScope =
      state.scopeById.get(value.capturedScopeId) ??
      restoreParentScope(value.capturedScopeId, state);
    const result = await interpret(node.body, {
      budget: state.budget,
      compileOwner: state.compilation.owner,
      ...(value.state === "suspended"
        ? {
            generatorResume: {
              sent: deserializeGeneratorCompletions(value.sent, state),
              yieldNodeId: value.yieldNodeId
            }
          }
        : {}),
      generatorYield,
      asyncGenerator: node.async,
      scope: capturedScope,
      useScopeDirectly: true
    });
    if (!result.ok) {
      throw new Error(result.error.message);
    }
    return result.returnValue;
  };
  const channel =
    value.state === "suspended"
      ? restoreGeneratorChannel(createBody, {
          yieldNodeId: value.yieldNodeId,
          sent: deserializeGeneratorCompletions(value.sent, state)
        })
      : createGeneratorChannel(createBody);

  const generator = createSandboxGenerator(channel, {
    astNodeId: value.astNodeId,
    capturedScopeId: value.capturedScopeId,
    async: node.async
  });
  generator.state = value.state;
  return generator;
}

function deserializeGeneratorCompletions(
  value: SerializedSnapshotValue,
  state: RestoreState
): GeneratorCompletion[] {
  const sent = deserializeValue(value, state);
  if (!Array.isArray(sent)) {
    throw new TypeError("Snapshot generator sent state must be an array.");
  }
  return sent.map((completion) => {
    const candidate = completion as { type?: unknown; value?: unknown };
    if (
      typeof completion !== "object" ||
      completion === null ||
      Array.isArray(completion) ||
      !Object.hasOwn(completion, "type") ||
      !["normal", "return", "throw"].includes(String(candidate.type)) ||
      !Object.hasOwn(completion, "value")
    ) {
      throw new TypeError("Snapshot generator sent state contains an invalid completion.");
    }
    return candidate as GeneratorCompletion;
  });
}

function isSerializedRegexValue(
  value: SerializedSnapshotValue
): value is { kind: "regex"; source: string; flags: string; lastIndex: number } {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    Object.hasOwn(value, "kind") &&
    value.kind === "regex" &&
    typeof value.source === "string" &&
    typeof value.flags === "string" &&
    typeof value.lastIndex === "number"
  );
}

function initializeIntrinsicRealm(state: RestoreState): void {
  if (state.intrinsicsInitialized) return;
  const prototype = Object.values(state.heap).find(node => node.kind === "intrinsic" && node.id === '["%FunctionPrototype%"]');
  // Older heaps could omit this property or contain a guest-defined hook.
  // Do not preinstall a nonconfigurable property over their captured state.
  const functionHasInstance = prototype?.kind !== "intrinsic" || prototype.state === undefined ||
    prototype.state.properties.properties.some(([key, descriptor]) => {
      if (key === null || typeof key !== "object" || !("kind" in key) || key.kind !== "ref") return false;
      const symbol = state.heap[String(key.id)];
      if (symbol?.kind !== "symbol" || symbol.wellKnown !== "hasInstance" || descriptor.kind !== "data" ||
          descriptor.writable || descriptor.enumerable || descriptor.configurable) return false;
      const value = descriptor.value;
      if (value === null || typeof value !== "object" || !("kind" in value) || value.kind !== "ref") return false;
      const method = state.heap[String(value.id)];
      return method?.kind === "intrinsic" && method.id === '["%FunctionPrototype%",{"symbol":"hasInstance"}]';
    });
  const errorConstructors = Object.values(state.heap).filter(node =>
    node.kind === "intrinsic" && sandboxErrorNames.some(name => node.id === JSON.stringify([name])));
  const errorPrototypes = errorConstructors.every(node => node.kind === "intrinsic" &&
    node.state?.properties.properties.some(([key, descriptor]) => {
      if (key !== "prototype" || descriptor.kind !== "data" || descriptor.writable ||
          descriptor.enumerable || descriptor.configurable) return false;
      const value = descriptor.value;
      if (value === null || typeof value !== "object" || !("kind" in value) || value.kind !== "ref") return false;
      const prototype = state.heap[String(value.id)];
      return prototype?.kind === "intrinsic" &&
        prototype.id === JSON.stringify([...JSON.parse(node.id) as string[], "prototype"]);
    }));
  const float32 = Object.values(state.heap).find(node => node.kind === "intrinsic" && node.id === '["Float32Array"]');
  const typedArrayPrototypes = float32?.kind !== "intrinsic" ||
    float32.state?.properties.properties.some(([key, descriptor]) => key === "prototype" && descriptor.kind === "data" &&
      !descriptor.writable && !descriptor.enumerable && !descriptor.configurable) === true;
  createBuiltinBindings({ budget: state.budget, compileOwner: state.compilation.owner, functionHasInstance, errorPrototypes, typedArrayPrototypes });
  state.intrinsicsInitialized = true;
}

function restoreHeapValue(id: number, state: RestoreState): RuntimeSnapshotValue {
  const existing = state.heapValueById.get(id);
  if (existing !== undefined) {
    return existing;
  }

  const serialized = state.heap[String(id)];
  if (serialized === undefined) {
    throw new Error(`Snapshot references unknown heap value ${id}.`);
  }

  if (serialized.kind === "guest-proxy") {
    const value = createGuestProxyCarrier(serialized.callable, serialized.constructible);
    state.heapValueById.set(id, value);
    state.initializeIterators.push(() => {
      const target = deserializeValue(serialized.target, state);
      const handler = deserializeValue(serialized.handler, state);
      if ((target === null) !== (handler === null)) throw new TypeError("Invalid revoked Proxy state.");
      if (target !== null && (typeof target !== "object" || typeof handler !== "object" || handler === null))
        throw new TypeError("Invalid Proxy target or handler.");
      if (target !== null && (isSandboxClosure(target) !== serialized.callable ||
          (isSandboxClosure(target) && target.construct !== undefined) !== serialized.constructible))
        throw new TypeError("Invalid Proxy callable identity.");
      const slots = guestProxyStates.get(value)!;
      slots.target = target as typeof slots.target;
      slots.handler = handler as typeof slots.handler;
      if (serialized.privateElements !== undefined) privateElements.set(value,
        restorePrivateElements(serialized.privateElements, entry => deserializeValue(entry, state) as SandboxValue));
    });
    return value;
  }
  if (serialized.kind === "guest-proxy-revoker") {
    const value = createGuestProxyRevoker(null);
    state.heapValueById.set(id, value);
    state.initializeIterators.push(() => {
      const proxy = deserializeValue(serialized.proxy, state);
      if (proxy !== null && (typeof proxy !== "object" || !guestProxyStates.has(proxy)))
        throw new TypeError("Invalid Proxy revoker target.");
      guestProxyRevokers.get(value)!.proxy = proxy as SandboxObject | SandboxClosure | null;
      const objectState = serialized.state;
      if (objectState.prototype !== undefined)
        setSandboxPrototype(value, deserializeValue(objectState.prototype, state) as object | null, state.budget);
      restorePropertyDescriptors(materializeFunctionProperties(value), objectState.properties,
        entry => deserializeValue(entry as SerializedSnapshotValue, state));
      if (objectState.privateElements !== undefined) privateElements.set(value,
        restorePrivateElements(objectState.privateElements, entry => deserializeValue(entry, state) as SandboxValue));
    });
    return value;
  }
  if (serialized.kind === "symbol") {
    const value = serialized.wellKnown === undefined ? Symbol(serialized.description) : wellKnownSymbols[serialized.wellKnown]!;
    state.heapValueById.set(id, value);
    return value;
  }
  if (serialized.kind === "boxed") {
    const value = createSandboxBox(deserializeValue(serialized.value, state));
    state.heapValueById.set(id, value);
    restoreBoxedProperties(value, serialized, entry => deserializeValue(entry, state));
    return value;
  }
  if (serialized.kind === "date") {
    const value = restoreDateTime(serialized.time);
    state.heapValueById.set(id, value);
    restoreDateProperties(value, serialized, entry => deserializeValue(entry, state));
    return value;
  }
  if (serialized.kind === "module-namespace") {
    return createModuleNamespace(namespace => {
      state.heapValueById.set(id,namespace as RuntimeSnapshotValue);
      return Object.fromEntries(serialized.entries.map(([key,entry]) => [key,deserializeValue(entry,state) as SandboxValue]));
    }) as RuntimeSnapshotValue;
  }
  if (serialized.kind === "raw-json") {
    const value = createRawJson(serialized.text);
    state.heapValueById.set(id, value);
    return value;
  }
  if (serialized.kind === "regex-object") {
    const value = createSandboxRegex(serialized.source, serialized.flags, 0, state.compilation);
    state.heapValueById.set(id, value);
    value.lastIndex = deserializeValue(serialized.lastIndex, state) as SandboxValue;
    restoreRegexProperties(value, serialized, entry => deserializeValue(entry, state));
    return value;
  }
  if (serialized.kind === "arraybuffer" || serialized.kind === "dataview") {
    initializeIntrinsicRealm(state);
    const resolve = (reference: unknown) => {
      if (state.resolvingStorage.has(id)) throw new TypeError("Cyclic backing storage reference.");
      state.resolvingStorage.add(id);
      try { return deserializeValue(reference as SerializedSnapshotValue, state); }
      finally { state.resolvingStorage.delete(id); }
    };
    const value = serialized.kind === "dataview" ? decodeDataViewStorage(serialized, resolve, state.budget)
      : decodeArrayBufferStorage(serialized, resolve, state.budget, state.detachBuffers);
    state.heapValueById.set(id, value);
    state.initializeIterators.push(() => {
      if (serialized.state.prototype !== undefined)
        setSandboxPrototype(value, deserializeValue(serialized.state.prototype, state) as object | null, state.budget);
      restorePropertyDescriptors(value, serialized.state.properties, entry => deserializeValue(entry as SerializedSnapshotValue, state));
      if (serialized.state.privateElements !== undefined) privateElements.set(value,
        restorePrivateElements(serialized.state.privateElements, entry => deserializeValue(entry, state) as SandboxValue));
    });
    return value;
  }
  if (serialized.kind === "float32array" || serialized.kind === "typedarray") {
    if (serialized.state !== undefined) initializeIntrinsicRealm(state);
    const value = decodeTypedArrayStorage(serialized, (reference) =>
      deserializeValue(reference as SerializedSnapshotValue, state), state.budget);
    state.heapValueById.set(id, value);
    if (serialized.state !== undefined) {
      const objectState = serialized.state;
      state.initializeIterators.push(() => {
        if (objectState.prototype !== undefined)
          setSandboxPrototype(value, deserializeValue(objectState.prototype, state) as object | null, state.budget);
        restoreTypedArrayProperties(value, objectState, entry => deserializeValue(entry, state));
        if (objectState.privateElements !== undefined) privateElements.set(value,
          restorePrivateElements(objectState.privateElements, entry => deserializeValue(entry, state) as SandboxValue));
      });
      return value;
    }
    for (const [key, entry] of Object.entries(serialized.entries)) {
      Object.defineProperty(value, key, {
        value: deserializeValue(entry, state),
        enumerable: true,
        configurable: true,
        writable: true
      });
    }
    return value;
  }

  if (serialized.kind === "array") {
    const array = new Array<RuntimeSnapshotValue>(
      "items" in serialized ? serialized.items.length : serialized.length
    );
    state.heapValueById.set(id, array);

    const entries =
      "items" in serialized ? Object.entries(serialized.items) : Object.entries(serialized.entries);
    for (const [key, entry] of entries) {
      Object.defineProperty(array, key, {
        value: deserializeValue(entry, state),
        configurable: true,
        enumerable: true,
        writable: true
      });
    }

    restoreSymbolProperties(array, serialized.symbolEntries, entry => deserializeValue(entry, state));
    return array;
  }

  if (serialized.kind === "mapped-arguments") {
    const scope = state.guestScopes.get((serialized.scope as SerializedReferenceValue).id);
    if (scope === undefined) throw new TypeError("Missing mapped arguments scope.");
    const args = createMappedSandboxArguments([], [], scope, undefined);
    state.heapValueById.set(id, args as RuntimeSnapshotValue);
    state.initializeIterators.push(() => {
      const nativeIterator = {};
      const properties = serialized.state.properties.properties.map(([key, descriptor]) =>
        serialized.nativeIterator && deserializeValue(key, state) === Symbol.iterator
          ? [key, {...descriptor, value: nativeIterator}] : [key, descriptor]);
      restorePropertyDescriptors(args, {...serialized.state.properties, properties}, entry =>
        entry === nativeIterator ? Array.prototype.values : deserializeValue(entry as SerializedSnapshotValue, state));
      if (serialized.state.prototype !== undefined)
        setSandboxPrototype(args, deserializeValue(serialized.state.prototype, state) as object | null, state.budget);
      if (serialized.state.privateElements !== undefined)
        privateElements.set(args, restorePrivateElements(serialized.state.privateElements, entry => deserializeValue(entry, state) as SandboxValue));
      const mapping = mappedArgumentStates.get(args)!;
      for (const [key, name] of serialized.parameters) mapping.parameters.set(key, name);
    });
    return args as RuntimeSnapshotValue;
  }

  if (serialized.kind === "arguments") {
    const args = createSandboxArguments([]);
    if (!serialized.lengthBeforeCallee) delete args.length;
    state.heapValueById.set(id, args as RuntimeSnapshotValue);
    for (const [key, descriptor] of Object.entries(serialized.properties)) {
      Object.defineProperty(args, key, {
        ...descriptor,
        value: deserializeValue(descriptor.value, state)
      });
    }
    if (serialized.iterator === null) {
      Reflect.deleteProperty(args, Symbol.iterator);
    } else {
      Object.defineProperty(args, Symbol.iterator, {
        ...serialized.iterator,
        value: Array.prototype.values
      });
    }
    if (!serialized.extensible) Object.preventExtensions(args);
    return args as RuntimeSnapshotValue;
  }

  if (serialized.kind === "regexp-iterator" || serialized.kind === "guest-regexp-iterator") {
    const iterator = restoreSandboxRegExpIterator({ matcher: undefined, input: undefined, exhausted: true });
    state.heapValueById.set(id, iterator);
    const matcher = deserializeValue(serialized.matcher, state);
    const input = deserializeValue(serialized.input, state);
    if (matcher !== undefined && (serialized.global === undefined ? !isSandboxRegex(matcher) : matcher === null || typeof matcher !== "object")) throw new TypeError("Invalid RegExp iterator matcher.");
    if (input !== undefined && typeof input !== "string") throw new TypeError("Invalid RegExp iterator input.");
    restoreSandboxRegExpIterator({ matcher: matcher as SandboxValue, input, exhausted: serialized.exhausted,
      ...(serialized.global === undefined ? {} : { global: serialized.global, unicode: serialized.unicode }) }, iterator);
    if (serialized.kind === "guest-regexp-iterator") {
      const objectState = serialized.state;
      state.initializeIterators.push(() => {
        if (objectState.prototype !== undefined)
          setSandboxPrototype(iterator, deserializeValue(objectState.prototype, state) as object | null, state.budget);
        restorePropertyDescriptors(iterator, objectState.properties, entry => deserializeValue(entry as SerializedSnapshotValue, state));
      });
    } else {
      for (const [key, entry] of Object.entries(serialized.entries)) Object.defineProperty(iterator, key, { value: deserializeValue(entry, state), enumerable: true, configurable: true, writable: true });
      restoreSymbolProperties(iterator, serialized.symbolEntries, entry => deserializeValue(entry, state));
    }
    return iterator;
  }

  if (serialized.kind === "collection-iterator" || serialized.kind === "guest-collection-iterator") {
    const iterator = restoreSandboxCollectionIterator({ collection: undefined, collectionKind: serialized.collectionKind, method: serialized.method, index: 0, exhausted: true });
    state.heapValueById.set(id, iterator);
    const collection = deserializeValue(serialized.collection, state);
    if (collection !== undefined && !isSandboxMap(collection) && !isSandboxSet(collection)) throw new TypeError("Invalid collection iterator source.");
    state.initializeIterators.push(() => { restoreSandboxCollectionIterator({ ...serialized, collection }, iterator); });
    if (serialized.kind === "guest-collection-iterator") {
      const objectState = serialized.state;
      state.initializeIterators.push(() => {
        if (objectState.prototype !== undefined)
          setSandboxPrototype(iterator, deserializeValue(objectState.prototype, state) as object | null, state.budget);
        restorePropertyDescriptors(iterator, objectState.properties, entry => deserializeValue(entry as SerializedSnapshotValue, state));
      });
    } else for (const [key, entry] of Object.entries(serialized.entries)) Object.defineProperty(iterator, key, { value: deserializeValue(entry, state), enumerable: true, configurable: true, writable: true });
    return iterator;
  }

  if (serialized.kind === "map") {
    const map = createSandboxMap();
    state.heapValueById.set(id, map);
    if (serialized.privateElements !== undefined) state.initializeIterators.push(() => privateElements.set(map,
      restorePrivateElements(serialized.privateElements!, entry => deserializeValue(entry, state) as SandboxValue)));
    if (Object.hasOwn(serialized, "prototype")) setSandboxPrototype(map, deserializeValue(serialized.prototype!, state) as object | null, state.budget);
    if (serialized.propertyState !== undefined) restorePropertyDescriptors(getCollectionProperties(map), serialized.propertyState, entry => deserializeValue(entry as SerializedSnapshotValue, state));
    for (const [key, entry] of serialized.entries) {
      map.entries.set(
        deserializeValue(key, state) as SandboxValue,
        deserializeValue(entry, state) as SandboxValue
      );
    }
    return map;
  }

  if (serialized.kind === "set") {
    const set = createSandboxSet();
    state.heapValueById.set(id, set);
    if (serialized.privateElements !== undefined) state.initializeIterators.push(() => privateElements.set(set,
      restorePrivateElements(serialized.privateElements!, entry => deserializeValue(entry, state) as SandboxValue)));
    if (Object.hasOwn(serialized, "prototype")) setSandboxPrototype(set, deserializeValue(serialized.prototype!, state) as object | null, state.budget);
    if (serialized.propertyState !== undefined) restorePropertyDescriptors(getCollectionProperties(set), serialized.propertyState, entry => deserializeValue(entry as SerializedSnapshotValue, state));
    for (const entry of serialized.values) {
      set.values.add(deserializeValue(entry, state) as SandboxValue);
    }
    return set;
  }

  if (serialized.kind === "scope-frame") throw new TypeError("Internal scopes cannot be guest data.");
  if (serialized.kind === "guest-source" || serialized.kind === "guest-script") throw new TypeError("Internal source records cannot be guest data.");
  if (serialized.kind === "construction-environment") throw new TypeError("Internal construction environments cannot be guest data.");
  if (serialized.kind === "thenable-state") throw new TypeError("Internal thenable states cannot be guest data.");
  if (serialized.kind === "guest-generator") {
    const generator = restoreGuestGenerator(serialized, state);
    state.heapValueById.set(id, generator);
    const objectState = serialized.objectState;
    if (objectState !== undefined) state.initializeIterators.push(() => {
      if (objectState.prototype !== undefined)
        setSandboxPrototype(generator, deserializeValue(objectState.prototype, state) as object | null, state.budget);
      restorePropertyDescriptors(getGeneratorProperties(generator), objectState.properties,
        entry => deserializeValue(entry as SerializedSnapshotValue, state));
      if (objectState.privateElements !== undefined) privateElements.set(generator,
        restorePrivateElements(objectState.privateElements, entry => deserializeValue(entry, state) as SandboxValue));
    });
    return generator;
  }
  if (serialized.kind === "async-generator-driver") {
    const driver = {} as AsyncGeneratorDriver;
    state.heapValueById.set(id, driver);
    asyncGeneratorDrivers.set(driver, driver);
    state.initializeIterators.push(() => {
      const generator = deserializeValue(serialized.generator, state);
      if (!isSandboxGenerator(generator) || generator.async !== true) throw new TypeError("Invalid async generator frame.");
      const requests = serialized.requests.map(request => {
        const promise = deserializeValue(request.capability.promise, state);
        const resolve = deserializeValue(request.capability.resolve, state);
        const reject = deserializeValue(request.capability.reject, state);
        if (!isSandboxPromise(promise) || !isSandboxClosure(resolve) || !isSandboxClosure(reject)) throw new TypeError("Invalid async generator capability.");
        asyncGeneratorRequestOwners.set(promise, driver);
        return {method: request.method, value: deserializeValue(request.value, state) as SandboxValue,
          ...(request.resultPrototype === undefined ? {} : {resultPrototype: deserializeValue(request.resultPrototype, state) as SandboxValue & (object | null)}),
          capability: {promise, resolve, reject}};
      });
      Object.assign(driver, {generator, requests, phase: serialized.phase, suspension: serialized.suspension, awaitKind: serialized.awaitKind, generation: serialized.generation});
      asyncGeneratorDrivers.set(generator, driver);
    });
    return driver;
  }
  if (serialized.kind === "async-generator-handler") {
    const value = deserializeValue(serialized.driver, state);
    const driver = value !== null && typeof value === "object" ? asyncGeneratorDrivers.get(value) : undefined;
    const owner = deserializeValue(serialized.owner, state);
    if (driver === undefined || !isSandboxPromise(owner)) throw new TypeError("Invalid async generator handler.");
    const handler = createAsyncGeneratorHandler(driver, serialized.action, serialized.generation, state.budget, undefined, owner);
    state.heapValueById.set(id, handler);
    state.initializeIterators.push(() => {
      const objectState = serialized.state;
      if (objectState.prototype !== undefined) setSandboxPrototype(handler, deserializeValue(objectState.prototype, state) as object | null, state.budget);
      restorePropertyDescriptors(materializeFunctionProperties(handler), objectState.properties, entry => deserializeValue(entry as SerializedSnapshotValue, state));
      if (objectState.privateElements !== undefined) privateElements.set(handler,
        restorePrivateElements(objectState.privateElements, entry => deserializeValue(entry, state) as SandboxValue));
    });
    return handler;
  }
  if (serialized.kind === "async-function-driver") {
    const driver = {} as AsyncFunctionDriver;
    state.heapValueById.set(id, driver);
    asyncFunctionDrivers.set(driver, driver);
    state.initializeIterators.push(() => {
      const generator = deserializeValue(serialized.generator, state);
      const promise = deserializeValue(serialized.capability.promise, state);
      const resolve = deserializeValue(serialized.capability.resolve, state);
      const reject = deserializeValue(serialized.capability.reject, state);
      if (!isSandboxGenerator(generator) || !isSandboxPromise(promise) || !isSandboxClosure(resolve) || !isSandboxClosure(reject)) throw new TypeError("Invalid async function capability.");
      Object.assign(driver, {generator, capability: {promise, resolve, reject}, phase: serialized.phase, generation: serialized.generation});
    });
    return driver;
  }
  if (serialized.kind === "async-function-handler") {
    const value = deserializeValue(serialized.driver, state);
    const driver = value !== null && typeof value === "object" ? asyncFunctionDrivers.get(value) : undefined;
    if (driver === undefined) throw new TypeError("Invalid async function handler.");
    const handler = createAsyncFunctionHandler(driver, serialized.action, serialized.generation, state.budget);
    state.heapValueById.set(id, handler);
    state.initializeIterators.push(() => {
      const objectState = serialized.state;
      if (objectState.prototype !== undefined) setSandboxPrototype(handler, deserializeValue(objectState.prototype, state) as object | null, state.budget);
      restorePropertyDescriptors(materializeFunctionProperties(handler), objectState.properties, entry => deserializeValue(entry as SerializedSnapshotValue, state));
      if (objectState.privateElements !== undefined) privateElements.set(handler,
        restorePrivateElements(objectState.privateElements, entry => deserializeValue(entry, state) as SandboxValue));
    });
    return handler;
  }
  if (serialized.kind === "async-cleanup") {
    const cleanup = {} as AsyncCleanupState;
    state.heapValueById.set(id, cleanup as unknown as RuntimeSnapshotValue);
    asyncCleanupStates.set(cleanup, cleanup);
    state.initializeIterators.push(() => {
      const promise = deserializeValue(serialized.capability.promise, state);
      const resolve = deserializeValue(serialized.capability.resolve, state);
      const reject = deserializeValue(serialized.capability.reject, state);
      if (!isSandboxPromise(promise) || !isSandboxClosure(resolve) || !isSandboxClosure(reject)) throw new TypeError("Invalid async cleanup capability.");
      Object.assign(cleanup, {resources: restoreAsyncResources(serialized.resources, state), capability: {promise, resolve, reject},
        phase: serialized.phase, failed: serialized.failed, failure: deserializeValue(serialized.failure, state),
        needsAwait: serialized.needsAwait, hasAwaited: serialized.hasAwaited, generation: serialized.generation});
    });
    return cleanup as unknown as RuntimeSnapshotValue;
  }
  if (serialized.kind === "async-cleanup-handler") {
    const value = deserializeValue(serialized.cleanup, state);
    const cleanup = value !== null && typeof value === "object" ? asyncCleanupStates.get(value) : undefined;
    if (cleanup === undefined) throw new TypeError("Invalid async cleanup handler.");
    const handler = createAsyncCleanupHandler(cleanup, serialized.action, state.budget, undefined, serialized.generation);
    state.heapValueById.set(id, handler);
    state.initializeIterators.push(() => {
      const objectState = serialized.state;
      if (objectState.prototype !== undefined) setSandboxPrototype(handler, deserializeValue(objectState.prototype, state) as object | null, state.budget);
      restorePropertyDescriptors(materializeFunctionProperties(handler), objectState.properties, entry => deserializeValue(entry as SerializedSnapshotValue, state));
      if (objectState.privateElements !== undefined) privateElements.set(handler,
        restorePrivateElements(objectState.privateElements, entry => deserializeValue(entry, state) as SandboxValue));
    });
    return handler;
  }
  if (serialized.kind === "promise-aggregate") {
    const aggregate = {} as PromiseAggregateState;
    state.heapValueById.set(id, aggregate as unknown as RuntimeSnapshotValue);
    promiseAggregateStates.set(aggregate, aggregate);
    state.initializeIterators.push(() => {
      const promise = deserializeValue(serialized.capability.promise, state) as SandboxValue;
      const resolve = deserializeValue(serialized.capability.resolve, state);
      const reject = deserializeValue(serialized.capability.reject, state);
      const values = deserializeValue(serialized.values, state);
      if (!isSandboxClosure(resolve) || !isSandboxClosure(reject) || !Array.isArray(values)) throw new TypeError("Invalid promise aggregate state.");
      Object.assign(aggregate, {method: serialized.method, remaining: serialized.remaining, size: serialized.size, iteration: serialized.iteration,
        values, capability: {promise, resolve, reject}});
    });
    return aggregate as unknown as RuntimeSnapshotValue;
  }
  if (serialized.kind === "aggregate-entry") {
    const value = deserializeValue(serialized.aggregate, state);
    const aggregate = value !== null && typeof value === "object" ? promiseAggregateStates.get(value) : undefined;
    if (aggregate === undefined) throw new TypeError("Invalid promise aggregate owner.");
    const entry = {aggregate, index: serialized.index, called: serialized.called};
    promiseAggregateEntries.set(entry, entry);
    state.heapValueById.set(id, entry as unknown as RuntimeSnapshotValue);
    return entry as unknown as RuntimeSnapshotValue;
  }
  if (serialized.kind === "aggregate-handler") {
    const value = deserializeValue(serialized.entry, state);
    const entry = value !== null && typeof value === "object" ? promiseAggregateEntries.get(value) : undefined;
    if (entry === undefined) throw new TypeError("Invalid promise aggregate handler entry.");
    const handler = createPromiseAggregateHandler(entry, serialized.action, state.budget);
    state.heapValueById.set(id, handler);
    state.initializeIterators.push(() => {
      const objectState = serialized.state;
      if (objectState.prototype !== undefined)
        setSandboxPrototype(handler, deserializeValue(objectState.prototype, state) as object | null, state.budget);
      restorePropertyDescriptors(materializeFunctionProperties(handler), objectState.properties,
        value => deserializeValue(value as SerializedSnapshotValue, state));
      if (objectState.privateElements !== undefined) privateElements.set(handler,
        restorePrivateElements(objectState.privateElements, value => deserializeValue(value, state) as SandboxValue));
    });
    return handler;
  }
  if (serialized.kind === "promise-adoption") {
    const owner = deserializeValue(serialized.owner, state);
    const source = deserializeValue(serialized.source, state);
    if (!isSandboxPromise(owner) || !isSandboxPromise(source)) throw new TypeError("Invalid promise adoption.");
    const {token, bridge} = createPromiseAdoptionBridge(source, state.budget, owner);
    state.heapValueById.set(id, token);
    const capability = state.pendingCapabilities.get(owner);
    const continuation = promiseContinuations.get(owner);
    if (capability === undefined || continuation?.kind !== "capability") throw new TypeError("Invalid promise adoption capability.");
    continuation.state.settled = true;
    continuation.resolution = {status: "fulfilled", value: source};
    capability.fulfill(bridge.promise);
    return token;
  }
  if (serialized.kind === "adoption-resolver") {
    const token = deserializeValue(serialized.bridge, state);
    const bridge = token !== null && typeof token === "object" ? promiseAdoptionBridges.get(token) : undefined;
    if (bridge === undefined) throw new TypeError("Invalid promise adoption bridge.");
    const resolver = serialized.action === "fulfilled" ? bridge.resolve : bridge.reject;
    state.heapValueById.set(id, resolver);
    return resolver;
  }
  if (serialized.kind === "guest-durationformat" || serialized.kind === "guest-segmenter" || serialized.kind === "guest-segments" || serialized.kind === "module-function" || serialized.kind === "thenable-resolver" || serialized.kind === "capability-executor" || serialized.kind === "intrinsic" || serialized.kind === "bound-function" || serialized.kind === "promise-resolver" || serialized.kind === "pending-promise" || serialized.kind === "promise-reaction" || serialized.kind === "guest-function" || serialized.kind === "guest-class" || serialized.kind === "guest-object" || serialized.kind === "guest-array" || serialized.kind === "guest-boxed" || serialized.kind === "guest-pluralrules" || serialized.kind === "guest-displaynames" || serialized.kind === "guest-relativetimeformat" || serialized.kind === "guest-listformat" || serialized.kind === "guest-datetimeformat" || serialized.kind === "guest-numberformat" || serialized.kind === "guest-collator" || serialized.kind === "guest-locale" || serialized.kind === "guest-date" || serialized.kind === "guest-regex" || serialized.kind === "guest-promise" || serialized.kind === "array-iterator" || serialized.kind === "string-iterator" || serialized.kind === "async-disposable-stack" || serialized.kind === "disposable-stack" || serialized.kind === "iterator-wrapper" || serialized.kind === "iterator-helper") {
    let value: RuntimeSnapshotValue;
    if (serialized.kind === "thenable-resolver") {
      const bridge = restoreThenableBridge(serialized.continuation, state);
      value = bridge.resolvers[serialized.action === "fulfilled" ? 0 : 1];
    } else if (serialized.kind === "capability-executor") {
      const executorState: PromiseCapabilityExecutorState = {resolve: undefined, reject: undefined};
      value = createPromiseCapabilityExecutor(executorState);
      state.initializeIterators.push(() => {
        executorState.resolve = deserializeValue(serialized.resolve, state) as SandboxValue;
        executorState.reject = deserializeValue(serialized.reject, state) as SandboxValue;
      });
    } else if (serialized.kind === "promise-resolver") {
      const promise = deserializeValue(serialized.promise, state);
      if (!isSandboxPromise(promise)) throw new TypeError("Invalid promise resolver target.");
      const capability = state.pendingCapabilities.get(promise);
      if (capability !== undefined) {
        if (serialized.action !== "fulfilled" && serialized.action !== "rejected") throw new TypeError("Invalid promise resolver action.");
        value = serialized.action === "fulfilled" ? capability.resolve : capability.reject;
      } else {
        const resolver = createSandboxClosure({
          guest: true, sandbox: true, name: "", length: 1,
          retainedValues: () => [promise], call: () => undefined
        });
        value = resolver;
        promiseResolvingFunctions.set(resolver, {promise, settled: true});
      }
    } else if (serialized.kind === "pending-promise" || serialized.kind === "promise-reaction") {
      initializeIntrinsicRealm(state);
      const capability = createPendingPromiseCapability(state.budget);
      value = capability.promise;
      state.pendingCapabilities.set(capability.promise, capability);
      state.initializeIterators.push(() => {
        if (serialized.kind === "pending-promise" && serialized.generatorOwner !== undefined)
          deserializeValue(serialized.generatorOwner, state);
        if (serialized.kind === "pending-promise" && serialized.adoption !== undefined)
          deserializeValue(serialized.adoption, state);
        if (serialized.kind === "pending-promise" && serialized.thenable !== undefined)
          restoreThenableBridge(serialized.thenable, state);
        if (serialized.kind === "promise-reaction") {
          const source = deserializeValue(serialized.source, state);
          if (!isSandboxPromise(source)) throw new TypeError("Invalid promise reaction source.");
          let reactionCapability: Extract<PromiseContinuation, {kind: "reaction"}>["capability"];
          if (serialized.capability !== undefined) {
            const promise = deserializeValue(serialized.capability.promise, state);
            const resolve = deserializeValue(serialized.capability.resolve, state);
            const reject = deserializeValue(serialized.capability.reject, state);
            if (!isSandboxPromise(promise) || !isSandboxClosure(resolve) || !isSandboxClosure(reject))
              throw new TypeError("Invalid promise reaction capability.");
            reactionCapability = {promise, resolve, reject};
          }
          const aggregate = serialized.aggregate === undefined ? undefined : deserializeValue(serialized.aggregate, state);
          if (aggregate !== undefined && !isSandboxPromise(aggregate)) throw new TypeError("Invalid promise aggregate result.");
          state.promiseReactionRecords.set(capability.promise, {source, capability,
            ...(aggregate === undefined ? {} : {aggregate}),
            ...(reactionCapability === undefined ? {} : {reactionCapability}),
            onFulfilled: deserializeValue(serialized.onFulfilled, state) as SandboxValue,
            onRejected: deserializeValue(serialized.onRejected, state) as SandboxValue});
        }
      });
    } else if (serialized.kind === "guest-promise") {
      let fulfill!: (value: SandboxValue) => void;
      let reject!: (value: SandboxValue) => void;
      const restored = createSandboxPromise(new Promise<SandboxValue>((resolve, rejectPromise) => {
        fulfill = resolve;
        reject = rejectPromise;
      }), {trackReplay: false});
      value = restored;
      state.initializeIterators.push(() => {
        if (serialized.generatorOwner !== undefined) deserializeValue(serialized.generatorOwner, state);
        const outcome = deserializeValue(serialized.value, state) as SandboxValue;
        promiseStates.set(restored, {status: serialized.status, value: outcome});
        if (serialized.status === "fulfilled") fulfill(outcome);
        else reject(outcome);
      });
    } else if (serialized.kind === "guest-regex") {
      value = createSandboxRegex(serialized.source, serialized.flags, 0, state.compilation);
    } else if (serialized.kind === "guest-boxed") {
      value = createSandboxBox(deserializeValue(serialized.value, state));
    } else if (serialized.kind === "guest-datetimeformat") {
      value = createSandboxDateTimeFormat(serialized.options.locale as string, serialized.options, true);
      if (serialized.format !== undefined) state.initializeIterators.push(() => {
        const format = deserializeValue(serialized.format!, state);
        if (!isSandboxClosure(format)) throw new TypeError("Invalid cached DateTimeFormat function.");
        dateTimeFormatState(value).format = format;
      });
    } else if (serialized.kind === "guest-numberformat") {
      value = createSandboxNumberFormat(serialized.options.locale as string, serialized.options);
      if (serialized.format !== undefined) state.initializeIterators.push(() => {
        const format = deserializeValue(serialized.format!, state);
        if (!isSandboxClosure(format)) throw new TypeError("Invalid cached NumberFormat function.");
        numberFormatState(value).format = format;
      });
    } else if (serialized.kind === "guest-pluralrules") {
      value = createSandboxPluralRules(serialized.options.locale as string, serialized.options);
    } else if (serialized.kind === "guest-durationformat") {
      value = createSandboxDurationFormat(serialized.settings);
    } else if (serialized.kind === "guest-segmenter") {
      value = createSandboxSegmenter(serialized.options.locale, serialized.options);
    } else if (serialized.kind === "guest-segments") {
      const segmenter = deserializeValue(serialized.segmenter, state);
      if (!isSandboxSegmenter(segmenter)) throw new TypeError("Invalid segments segmenter.");
      value = createSandboxSegments({ segmenter, input: serialized.input, ...(serialized.index === undefined ? {} : { index: serialized.index }) });
    } else if (serialized.kind === "guest-displaynames") {
      value = createSandboxDisplayNames(serialized.options.locale, serialized.options);
    } else if (serialized.kind === "guest-relativetimeformat") {
      value = createSandboxRelativeTimeFormat(serialized.options.locale, serialized.options);
    } else if (serialized.kind === "guest-listformat") {
      value = createSandboxListFormat(serialized.options.locale, serialized.options);
    } else if (serialized.kind === "guest-collator") {
      value = createSandboxCollator(serialized.options.locale, serialized.options);
      if (serialized.compare !== undefined) state.initializeIterators.push(() => {
        const compare = deserializeValue(serialized.compare!, state);
        if (!isSandboxClosure(compare)) throw new TypeError("Invalid cached Collator comparison.");
        collatorState(value).compare = compare;
      });
    } else if (serialized.kind === "guest-locale") {
      value = createSandboxLocale(serialized.tag);
    } else if (serialized.kind === "guest-date") {
      const time = deserializeValue(serialized.value, state);
      if (typeof time !== "number") throw new TypeError("Invalid guest date time.");
      value = createSandboxDate(time);
    } else if (serialized.kind === "bound-function") {
      initializeIntrinsicRealm(state);
      const target = deserializeValue(serialized.target, state);
      if (!isSandboxClosure(target)) throw new TypeError("Invalid bound function target.");
      const boundState = { target, thisValue: undefined as SandboxValue, args: [] as SandboxValue[] };
      const length = deserializeValue(serialized.length, state);
      if (length !== undefined && typeof length !== "number") throw new TypeError("Invalid bound function length.");
      value = createBoundFunction(boundState, serialized.name, length,
        (callee, args, stack, thisValue, construct, newTarget) =>
          invokeBuiltinClosure(callee, args, state.budget, { stack, thisValue, newTarget }, thisValue, construct));
      // Allocate every bound identity before decoding arguments and receivers:
      // either may point back to this function, including through another bind.
      state.initializeIterators.push(() => {
        boundState.thisValue = deserializeValue(serialized.thisValue, state) as SandboxValue;
        boundState.args = serialized.args.map(entry => deserializeValue(entry, state) as SandboxValue);
      });
    } else if (serialized.kind === "module-function") {
      const capability = resolveModuleFunction(state.moduleFunctions, serialized);
      value = createSandboxClosure({
        ...capability, name: serialized.name,
        properties: closure => {
          state.heapValueById.set(id, closure);
          const properties: Record<string, SandboxValue> = {};
          restorePropertyDescriptors(properties, serialized.state.properties,
            entry => deserializeValue(entry as SerializedSnapshotValue, state));
          const metadata = capability.properties === undefined ? undefined : hostFunctionMetadata.get(capability.properties);
          if (metadata !== undefined) hostFunctionMetadata.set(properties, metadata);
          return properties;
        }
      });
      moduleFunctionOrigins.set(value as SandboxClosure, { module: serialized.module, path: [...serialized.path] });
    } else if (serialized.kind === "intrinsic") {
      initializeIntrinsicRealm(state);
      value = resolveIntrinsicIdentity(state.budget, serialized.id) as RuntimeSnapshotValue;
      if (serialized.symbolRegistry !== undefined) state.initializeIterators.push(() => {
        const registry = isSandboxClosure(value) ? symbolRegistryOrigins.get(value) : undefined;
        if (registry === undefined) throw new TypeError("Invalid symbol registry owner.");
        const entries = new Map<string, symbol>();
        for (const [key, reference] of serialized.symbolRegistry!) {
          const symbol = deserializeValue(reference, state);
          if (typeof symbol !== "symbol") throw new TypeError("Invalid registered symbol.");
          entries.set(key, symbol);
        }
        if (state.symbolRegistry !== undefined && (entries.size !== state.symbolRegistry.size ||
          [...entries].some(([key, symbol]) => state.symbolRegistry!.get(key) !== symbol)))
          throw new TypeError("Conflicting symbol registries.");
        state.symbolRegistry = entries;
        registry.clear();
        for (const [key, symbol] of entries) registry.set(key, symbol);
      });
    } else if (serialized.kind === "guest-class") {
      const nodes = serialized.dynamicSource === undefined ? state.nodeById
        : state.dynamicSources.get((serialized.dynamicSource as SerializedReferenceValue).id)!.nodes;
      const node = nodes.get(serialized.astNodeId);
      if (node?.type !== "ClassDeclaration" && node?.type !== "ClassExpression") throw new TypeError("Invalid class origin.");
      const scope = state.guestScopes.get((serialized.scope as SerializedReferenceValue).id);
      if (scope === undefined) throw new TypeError("Missing class scope.");
      const fields: Field[] = [];
      const constructor = createClassConstructor(node, {
        scope, budget: state.budget, compilation: state.compilation, rootNode: state.rootNode,
        signal: state.signal, inferredName: serialized.name,
        callStack: [], activeLoopIterations: new Map(), restoredLoopIterations: new Map(),
        stats: { currentDataSize: 0, nodeVisits: 0, peakDataSize: 0 }
      }, evaluateNode, fields);
      value = constructor;
      state.initializeIterators.push(() => {
        for (const field of serialized.fields) {
          const element = node.body.body[field.index];
          const key = deserializeValue(field.key, state);
          if (element?.type !== "PropertyDefinition" || element.static || (typeof key !== "string" && typeof key !== "symbol"))
            throw new TypeError("Invalid restored class field.");
          fields.push({ element, key, ...(field.privateName === undefined ? {} : { privateName: deserializeValue(field.privateName, state) as PrivateName }) });
        }
        if (serialized.privateMethods !== undefined)
          classOrigins.get(constructor)!.privateMethods = restorePrivateElements(serialized.privateMethods, entry => deserializeValue(entry, state) as SandboxValue);
        classOrigins.get(constructor)!.initialized = true;
      });
    } else if (serialized.kind === "guest-function") {
      const nodes = serialized.dynamicSource === undefined ? state.nodeById
        : state.dynamicSources.get((serialized.dynamicSource as SerializedReferenceValue).id)!.nodes;
      const node = nodes.get(serialized.astNodeId);
      if (node?.type !== "ArrowFunctionExpression" && node?.type !== "FunctionDeclaration" && node?.type !== "FunctionExpression")
        throw new TypeError("Invalid guest function origin.");
      const scopeRef = serialized.scope as SerializedReferenceValue;
      const scope = state.guestScopes.get(scopeRef.id);
      if (scope === undefined) throw new TypeError("Missing guest function scope.");
      const environment: AsyncEvaluationContext["functionEnvironment"] = serialized.environment === undefined ? undefined : {
        classInitializer: serialized.environment.classInitializer,
        homeObject: serialized.environment.homeObject === undefined ? undefined : deserializeValue(serialized.environment.homeObject, state) as NonNullable<AsyncEvaluationContext["functionEnvironment"]>["homeObject"],
        newTarget: serialized.environment.newTarget === undefined ? undefined : deserializeValue(serialized.environment.newTarget, state) as SandboxClosure,
        construction: serialized.environment.construction === undefined ? undefined : restoreConstructionEnvironment(serialized.environment.construction, state)
      };
      // Current generator functions need their realm before creation, not only
      // when a later prototype reference is decoded. Earlier heaps can lack the
      // native nonconfigurable prototype property and retain that legacy shape.
      const initializeGeneratorPrototype = node.type !== "ArrowFunctionExpression" && node.generator &&
        serialized.state.properties.properties.some(([key, descriptor]) =>
          key === "prototype" && descriptor.kind === "data" && !descriptor.configurable);
      if (initializeGeneratorPrototype) initializeIntrinsicRealm(state);
      value = createInterpretedClosure(node, {
        scope, budget: state.budget, compilation: state.compilation, rootNode: state.rootNode,
        signal: state.signal, inferredName: serialized.name, functionEnvironment: environment,
        callStack: [], activeLoopIterations: new Map(), restoredLoopIterations: new Map(),
        stats: { currentDataSize: 0, nodeVisits: 0, peakDataSize: 0 }
      }, evaluateNode, environment?.homeObject, initializeGeneratorPrototype);
    } else value = serialized.kind === "guest-array" ? [] : Object.create(null) as Record<string, RuntimeSnapshotValue>;
    state.heapValueById.set(id, value);
    if (serialized.kind === "iterator-helper") {
      const cursor = (record: { iterator: SerializedSnapshotValue; next: SerializedSnapshotValue }) => ({
        iterator: deserializeValue(record.iterator, state) as SandboxValue,
        next: deserializeValue(record.next, state) as SandboxValue
      });
      iteratorHelperStates.set(value as object, {
        method: serialized.method, status: serialized.status,
        outer: serialized.outer === undefined ? undefined : cursor(serialized.outer),
        inner: serialized.inner === undefined ? undefined : cursor(serialized.inner),
        callback: deserializeValue(serialized.callback, state) as SandboxValue,
        remaining: serialized.remaining === "Infinity" ? Infinity : serialized.remaining,
        index: serialized.index
      });
    }
    if (serialized.kind === "iterator-wrapper") {
      const iterator=deserializeValue(serialized.iterator,state);
      if (iterator === null || typeof iterator !== "object") throw new TypeError("Invalid wrapped iterator.");
      iteratorWrapperStates.set(value as object,{iterator:iterator as SandboxValue,next:deserializeValue(serialized.next,state) as SandboxValue});
    }
    if (serialized.kind === "disposable-stack") {
      const resources = serialized.resources.map(resource => {
        const method = deserializeValue(resource.method, state);
        if (!isSandboxClosure(method)) throw new TypeError("Invalid disposer.");
        return {method, receiver: deserializeValue(resource.receiver, state) as SandboxValue,
          args: resource.args.map(arg => deserializeValue(arg, state) as SandboxValue)};
      });
      disposableStackStates.set(value as object, {disposed: serialized.disposed, active: false, resources});
    }
    if (serialized.kind === "async-disposable-stack") {
      asyncDisposableStackStates.set(value as object, {disposed: serialized.disposed, resources: restoreAsyncResources(serialized.resources, state)});
    }
    if (serialized.kind === "string-iterator") {
      const input = deserializeValue(serialized.input, state);
      if (input !== undefined && typeof input !== "string") throw new TypeError("Invalid String iterator input.");
      restoreSandboxStringIterator({ input, index: serialized.index }, value as SandboxObject);
    }
    if (serialized.kind === "array-iterator") {
      const source = deserializeValue(serialized.source, state);
      if (source !== undefined && (typeof source !== "object" || source === null)) throw new TypeError("Invalid Array iterator source.");
      restoreSandboxArrayIterator({ source: source as SandboxValue & object | undefined, index: serialized.index, method: serialized.method }, value as SandboxObject);
    }
    const objectState = serialized.state;
    if ("producers" in serialized && serialized.producers !== undefined) state.initializeIterators.push(() => {
      for (const producer of serialized.producers!) deserializeValue(producer, state);
    });
    if ("reactions" in serialized && serialized.reactions !== undefined) state.initializeIterators.push(() => {
      if (!isSandboxPromise(value)) throw new TypeError("Invalid promise reaction owner.");
      const reactions = serialized.reactions!.map(reference => {
        const reaction = deserializeValue(reference, state);
        if (!isSandboxPromise(reaction)) throw new TypeError("Invalid promise reaction result.");
        return reaction;
      });
      state.promiseReactionOrders.set(value, reactions);
    });
    if (serialized.kind === "guest-array" && serialized.templateOwner !== undefined)
      deserializeValue(serialized.templateOwner, state);
    if (objectState !== undefined) state.initializeIterators.push(() => {
      const intrinsicProperties = isSandboxClosure(value) ? value.properties : undefined;
      const target = isSandboxClosure(value)
        ? isGuestClosure(value) ? materializeFunctionProperties(value) : intrinsicProperties
        : isSandboxRegex(value) ? getRegexProperties(value) : isSandboxPromise(value) ? getPromiseProperties(value) : value as object;
      if (target === undefined) throw new TypeError(`Missing restored function properties for ${serialized.kind === "intrinsic" ? serialized.id : serialized.kind}.`);
      if (objectState.prototype !== undefined)
        setSandboxPrototype(value as object, deserializeValue(objectState.prototype, state) as object | null, state.budget);
      if (serialized.kind === "guest-object" && serialized.errorType !== undefined)
        sandboxErrorTypes.set(value as object, serialized.errorType);
      if (serialized.kind !== "module-function")
        restorePropertyDescriptors(target, objectState.properties, entry => deserializeValue(entry as SerializedSnapshotValue, state));
      if (objectState.privateElements !== undefined)
        privateElements.set(value as object, restorePrivateElements(objectState.privateElements, entry => deserializeValue(entry, state) as SandboxValue));
      if (serialized.kind === "guest-array" && serialized.templateNodeId !== undefined) {
        const nodes = serialized.dynamicSource === undefined ? state.nodeById
          : state.dynamicSources.get((serialized.dynamicSource as SerializedReferenceValue).id)!.nodes;
        const node = nodes.get(serialized.templateNodeId);
        if (node?.type !== "TemplateLiteral") throw new TypeError("Invalid template source identity.");
        state.initializeIterators.push(() => registerTemplateObject(node, value as SandboxArray, state.budget));
      }
    });
    return value;
  }

  const object = Object.create(null) as Record<string, RuntimeSnapshotValue>;
  state.heapValueById.set(id, object);
  if (Object.hasOwn(serialized, "sandboxNullPrototype")) {
    if (serialized.sandboxNullPrototype !== true) throw new TypeError("Invalid object prototype.");
    setSandboxPrototype(object, null);
  }
  if (serialized.errorType !== undefined) sandboxErrorTypes.set(object, serialized.errorType);

  state.initializeIterators.push(() => {
    for (const [key, entry] of Object.entries(serialized.entries)) {
      object[key] = deserializeValue(entry, state);
    }
    restoreSymbolProperties(object, serialized.symbolEntries, entry => deserializeValue(entry, state));
  });

  return object;
}

function restoreGuestGenerator(
  serialized: Extract<SerializedHeapValue, { kind: "guest-generator" }>,
  state: RestoreState
): SandboxGenerator {
  const nodes = serialized.dynamicSource === undefined ? state.nodeById
    : state.dynamicSources.get((serialized.dynamicSource as SerializedReferenceValue).id)!.nodes;
  const node = nodes.get(serialized.astNodeId);
  if ((node?.type !== "FunctionDeclaration" && node?.type !== "FunctionExpression" && !(serialized.asyncFunction && node?.type === "ArrowFunctionExpression")) ||
      (serialized.asyncFunction ? !node.async || ("generator" in node && node.generator) || serialized.async : !("generator" in node) || !node.generator || node.async !== serialized.async))
    throw new TypeError("Invalid generator AST identity.");
  if (serialized.state === "running") throw new TypeError("Cannot restore an actively running generator.");
  const scope = state.guestScopes.get((serialized.scope as SerializedReferenceValue).id);
  const closureScope = state.guestScopes.get((serialized.closureScope as SerializedReferenceValue).id);
  const suspendedScope = serialized.suspendedScope === undefined ? undefined
    : state.guestScopes.get((serialized.suspendedScope as SerializedReferenceValue).id);
  if (scope === undefined || closureScope === undefined) throw new TypeError("Missing generator scope.");
  const context: AsyncEvaluationContext = {
    scope: closureScope, budget: state.budget, compilation: state.compilation,
    strict: functionStrictness.get(node) ?? true,
    signal: state.signal, rootNode: state.rootNode,
    callStack: [], activeLoopIterations: new Map(), restoredLoopIterations: new Map(),
    stats: { currentDataSize: 0, nodeVisits: 0, peakDataSize: 0 }
  };
  const blockScopes = new Map<number, Scope>();
  for (const [id, ref] of Object.entries(serialized.blockScopes ?? {})) {
    const blockScope = state.guestScopes.get((ref as SerializedReferenceValue).id);
    if (blockScope === undefined || nodes.get(Number(id))?.type !== "BlockStatement")
      throw new TypeError("Invalid generator block scope.");
    blockScopes.set(Number(id), blockScope);
  }
  // Environment and history may point back to this generator. Decode them only
  // after the enclosing restorer has published its identity.
  const sent: GeneratorCompletion[] = [];
  const createBody: Parameters<typeof createGeneratorChannel>[0] = generatorYield => {
    const execute = async () => {
      const result = await evaluateNode(node.body, {
        ...context, scope: suspendedScope ?? scope, functionBody: node.body.type === "BlockStatement" ? node.body : undefined,
        asyncGenerator: node.async && !serialized.asyncFunction, asyncFunction: serialized.asyncFunction,
        asyncGeneratorFrame: serialized.async ? generator : undefined,
        restoredGeneratorBlockScopes: blockScopes, generatorBlockScopes: new Map(),
        generatorExpressionStates: new Map(),
        ...(serialized.state === "suspended" ? { generatorResume: { sent, yieldNodeId: serialized.yieldNodeId! } } : {}),
        captureGeneratorScope: (current, blocks, completions, expressions) => {
          origin.suspendedScope = current; origin.blockScopes = blocks; origin.finallyCompletions = completions;
          origin.expressionStates = expressions;
        },
        generatorYield: (value, yieldNodeId, yieldedResult) => {
          generator.state = "suspended";
          return generatorYield(value, yieldNodeId, yieldedResult);
        }
      });
      if (result.kind === "error") throw result.error;
      if (result.kind === "throw") throw result.value;
      const value = result.hasValue ? result.value : undefined;
      return value;
    };
    return execute();
  };
  const channel = createGeneratorChannel(createBody);
  const generator = createSandboxGenerator(channel, { async: serialized.async });
  generator.state = serialized.state;
  const origin = registerGeneratorOrigin(generator, node, scope, context);
  if (serialized.resultPrototype !== undefined)
    origin.resultPrototype = deserializeValue(serialized.resultPrototype, state) as object | null;
  origin.asyncFunction = serialized.asyncFunction;
  origin.awaitPhase = serialized.awaitPhase;
  origin.suspendedScope = suspendedScope;
  origin.blockScopes = blockScopes;
  if (serialized.state === "done") void channel.return();
  state.initializeIterators.push(() => {
    if (serialized.driver !== undefined) deserializeValue(serialized.driver, state);
    for (const completion of serialized.sent) sent.push({ type: completion.type, value: deserializeValue(completion.value, state) });
    const completions = new Map<number, CompletionResult>();
    for (const [id, completion] of Object.entries(serialized.finallyCompletions ?? {})) {
      const { nodeId, value, ...metadata } = completion;
      const node = nodeId === undefined ? undefined : nodes.get(nodeId);
      if (nodeId !== undefined && node?.type !== "BreakStatement" && node?.type !== "ContinueStatement")
        throw new TypeError("Invalid completion node identity.");
      completions.set(Number(id), { ...metadata, value: deserializeValue(value, state) as SandboxValue,
        ...(node?.type === "BreakStatement" || node?.type === "ContinueStatement" ? { node } : {}) });
    }
    context.restoredFinallyCompletions = completions;
    origin.finallyCompletions = completions;
    const expressions = new Map<number, import("../interp/generator-expression-state.js").GeneratorExpressionState>();
    for (const [id, expression] of Object.entries(serialized.expressionStates ?? {})) {
      expressions.set(Number(id), expression.kind === "binary"
        ? { kind: "binary", left: deserializeValue(expression.left, state) as SandboxValue }
        : expression.kind === "dynamic-import" ? {kind:"dynamic-import",source:deserializeValue(expression.source,state) as SandboxValue}
        : expression.kind === "declaration" ? { ...expression }
        : expression.kind === "switch" ? { ...expression, value: deserializeValue(expression.value, state) as SandboxValue,
          scope: state.guestScopes.get((expression.scope as SerializedReferenceValue).id)! }
        : expression.kind === "yield-delegate" ? { ...expression, value: deserializeValue(expression.value, state) as SandboxValue,
          current: deserializeValue(expression.current, state) as SandboxValue,
          ...(expression.completion === undefined ? {} : {completion: {...expression.completion, value: deserializeValue(expression.completion.value, state) as SandboxValue}}),
          iterator: mapIteratorSnapshot(expression.iterator, value => deserializeValue(value, state) as SandboxValue) }
        : expression.kind === "pattern-source" ? { kind: "pattern-source", value: deserializeValue(expression.value, state) as SandboxValue }
        : expression.kind === "object-pattern" ? { kind: "object-pattern", phase: expression.phase, index: expression.index,
          ...(expression.referenceScope === undefined ? {} : {referenceScope: state.guestScopes.get((expression.referenceScope as SerializedReferenceValue).id)!}),
          ...(expression.referenceUnresolvable === undefined ? {} : {referenceUnresolvable: true as const}),
          ...(expression.privateName === undefined ? {} : { privateName: expression.privateName }),
          excludedKeys: expression.excludedKeys.map(value => deserializeValue(value, state) as SandboxValue),
          key: deserializeValue(expression.key, state) as SandboxValue, current: deserializeValue(expression.current, state) as SandboxValue,
          ...(Object.hasOwn(expression, "referenceObject") ? { referenceObject: deserializeValue(expression.referenceObject!, state) as SandboxValue,
            referenceKey: deserializeValue(expression.referenceKey!, state) as SandboxValue } : {}) }
        : expression.kind === "array-pattern" ? { kind: "array-pattern", phase: expression.phase, index: expression.index, done: expression.done, current: deserializeValue(expression.current, state) as SandboxValue,
          ...(expression.referenceScope === undefined ? {} : {referenceScope: state.guestScopes.get((expression.referenceScope as SerializedReferenceValue).id)!}),
          ...(expression.referenceUnresolvable === undefined ? {} : {referenceUnresolvable: true as const}),
          ...(expression.privateName === undefined ? {} : { privateName: expression.privateName }),
          iterator: mapIteratorSnapshot(expression.iterator, value => deserializeValue(value, state) as SandboxValue),
          ...(Object.hasOwn(expression, "referenceObject") ? { referenceObject: deserializeValue(expression.referenceObject!, state) as SandboxValue,
            referenceKey: deserializeValue(expression.referenceKey!, state) as SandboxValue } : {}) }
        : expression.kind === "for-of-array" ? { ...expression, values: deserializeValue(expression.values, state) as SandboxValue,
          current: deserializeValue(expression.current, state) as SandboxValue, scope: state.guestScopes.get((expression.scope as SerializedReferenceValue).id)! }
        : expression.kind === "for-of-iterator" ? { ...expression, value: deserializeValue(expression.value, state) as SandboxValue,
          ...(expression.closeCompletion === undefined ? {} : {closeCompletion: {...expression.closeCompletion, value: deserializeValue(expression.closeCompletion.value, state) as SandboxValue}}),
          current: deserializeValue(expression.current, state) as SandboxValue, scope: state.guestScopes.get((expression.scope as SerializedReferenceValue).id)!,
          iterator: mapIteratorSnapshot(expression.iterator, value => deserializeValue(value, state) as SandboxValue) }
        : expression.kind === "for-in" ? { ...expression, keys: [...expression.keys], object: deserializeValue(expression.object, state) as SandboxValue,
          scope: state.guestScopes.get((expression.scope as SerializedReferenceValue).id)! }
        : expression.kind === "for" ? { kind: "for", phase: expression.phase,
          loopScope: state.guestScopes.get((expression.loopScope as SerializedReferenceValue).id)!,
          activeScope: state.guestScopes.get((expression.activeScope as SerializedReferenceValue).id)! }
        : expression.kind === "identifier-assignment" ? { kind: "identifier-assignment", current: deserializeValue(expression.current, state) as SandboxValue,
          ...(expression.referenceKind === undefined ? {} : {referenceKind: expression.referenceKind}),
          ...(expression.referenceScope === undefined ? {} : {referenceScope: state.guestScopes.get((expression.referenceScope as SerializedReferenceValue).id)!}),
          ...(expression.referenceKind !== "object" ? {} : {referenceObject: deserializeValue(expression.referenceObject!, state) as SandboxValue}) }
        : expression.kind === "member-assignment" ? { kind: "member-assignment", object: deserializeValue(expression.object, state) as SandboxValue,
          ...(expression.privateName === undefined ? {} : { privateName: expression.privateName }),
          property: deserializeValue(expression.property, state) as SandboxValue, current: deserializeValue(expression.current, state) as SandboxValue,
          ...(Object.hasOwn(expression, "key") ? { key: deserializeValue(expression.key!, state) as SandboxValue } : {}),
          ...(Object.hasOwn(expression, "superReceiver") ? { superReceiver: deserializeValue(expression.superReceiver!, state) as SandboxValue } : {}) }
        : expression.kind === "member" ? { kind: "member", object: deserializeValue(expression.object, state) as SandboxValue,
          ...(Object.hasOwn(expression, "superReceiver") ? { superReceiver: deserializeValue(expression.superReceiver!, state) as SandboxValue } : {}) }
        : expression.kind === "template" ? { ...expression }
        : expression.kind === "object" ? { kind: "object", value: deserializeValue(expression.value, state) as SandboxValue, index: expression.index,
          ...(Object.hasOwn(expression, "key") ? { key: deserializeValue(expression.key!, state) as SandboxValue } : {}) }
        : expression.kind === "array" ? { kind: "array", values: deserializeValue(expression.values, state) as SandboxValue, index: expression.index }
        : expression.kind === "array-call" ? { kind: "array-call", target: deserializeValue(expression.target, state) as SandboxValue,
          method: expression.method, args: deserializeValue(expression.args, state) as SandboxValue, index: expression.index }
        : { kind: expression.kind, callee: deserializeValue(expression.callee, state) as SandboxValue,
          thisValue: deserializeValue(expression.thisValue, state) as SandboxValue,
          args: deserializeValue(expression.args, state) as SandboxValue, index: expression.index });
    }
    context.restoredGeneratorExpressionStates = expressions;
    origin.expressionStates = expressions;
    if (serialized.state === "suspended")
      Object.defineProperty(generator, "channel", { value: restoreGeneratorChannel(createBody, { sent, yieldNodeId: serialized.yieldNodeId }) });
    if (serialized.environment !== undefined) {
      context.functionEnvironment = {
        classInitializer: serialized.environment.classInitializer,
        homeObject: serialized.environment.homeObject === undefined ? undefined : deserializeValue(serialized.environment.homeObject, state) as NonNullable<AsyncEvaluationContext["functionEnvironment"]>["homeObject"],
        newTarget: serialized.environment.newTarget === undefined ? undefined : deserializeValue(serialized.environment.newTarget, state) as SandboxClosure,
        construction: serialized.environment.construction === undefined ? undefined : restoreConstructionEnvironment(serialized.environment.construction, state)
      };
      origin.environment = context.functionEnvironment;
    }
  });
  return generator;
}

function restoreClosureValue(
  astNodeId: number,
  capturedScopeId: SnapshotId,
  state: RestoreState
): SandboxClosure & {
  astNodeId: number;
  capturedScopeId: SnapshotId;
} {
  const node = state.nodeById.get(astNodeId);
  if (
    node?.type !== "ArrowFunctionExpression" &&
    node?.type !== "FunctionDeclaration" &&
    node?.type !== "FunctionExpression"
  ) {
    throw new Error(`Snapshot references unknown closure AST node ${astNodeId}.`);
  }

  const baseClosure = createSandboxClosure({
    sourceRange: functionSources.get(node),
    async: node.async,
    sandbox: true,
    length: getFunctionLength(node.params),
    ...(node.type === "ArrowFunctionExpression" || node.id === undefined ? {} : { name: node.id.name }),
    ...(node.type !== "ArrowFunctionExpression" &&
    !(node.type === "FunctionExpression" && node.method === true) &&
    !node.generator &&
    !node.async
      ? {
          construct: async (args: readonly SandboxValue[], callContext?: SandboxCallContext) => {
            const thisValue = {};
            const prototype = getGuestFunctionProperty(restoredClosure, "prototype");
            if (typeof prototype === "object" && prototype !== null) {
              setSandboxPrototype(thisValue, prototype, state.budget);
            }
            const result = await executeRestoredClosure(
              node,
              capturedScopeId,
              restoredClosure,
              args,
              thisValue,
              state,
              callContext
            );
            return typeof result === "object" && result !== null ? result : thisValue;
          }
        }
      : {}),
    call: (args, callContext) => {
      if (node.async) {
        return executeAsyncFunction(
          (onSuspend) =>
            executeRestoredClosure(
              node,
              capturedScopeId,
              restoredClosure,
              args,
              callContext?.thisValue,
              state,
              callContext,
              onSuspend
            ),
          state.budget
        );
      }
      return executeRestoredClosure(
        node,
        capturedScopeId,
        restoredClosure,
        args,
        callContext?.thisValue,
        state,
        callContext
      );
    }
  });

  const restoredClosure: SandboxClosure & {
    astNodeId: number;
    capturedScopeId: SnapshotId;
  } = Object.defineProperties(Object.create(baseClosure), {
    astNodeId: {
      enumerable: true,
      value: astNodeId
    },
    capturedScopeId: {
      enumerable: true,
      value: capturedScopeId
    },
    kind: {
      enumerable: true,
      value: "fn"
    }
  }) as SandboxClosure & {
    astNodeId: number;
    capturedScopeId: SnapshotId;
  };
  registerGuestClosure(restoredClosure);
  Object.defineProperty(restoredClosure, "properties", { get: () => getGuestFunctionProperties(restoredClosure) });
  return restoredClosure;
}

async function executeRestoredClosure(
  node: ArrowFunctionExpression | FunctionDeclaration | FunctionExpression,
  capturedScopeId: SnapshotId,
  closure: SandboxClosure,
  args: readonly SandboxValue[],
  thisValue: SandboxValue,
  state: RestoreState,
  callContext?: SandboxCallContext,
  onSuspend?: () => void
): Promise<SandboxValue> {
  const parent = callContext?.compilation ?? state.compilation;
  const operation = state.budget.acquireCompileOwner(false, parent.owner);
  const compilation = new CompileScope(operation.owner, parent);
  state = { ...state, compilation };
  try {
    const capturedScope =
      state.scopeById.get(capturedScopeId) ?? restoreParentScope(capturedScopeId, state);
    const wrapperScope =
      node.type === "FunctionExpression" && node.id !== undefined
        ? capturedScope.child()
        : capturedScope;
    const scope = wrapperScope.child();

    if (node.type === "FunctionExpression" && node.id !== undefined) {
      wrapperScope.declare(node.id.name, "const", closure);
    }
    if (node.type !== "ArrowFunctionExpression") {
      scope.declare("this", "const", thisValue);
      state.budget.allocateArrayLength(args.length);
      scope.declare("arguments", "let", createSandboxArguments(args));
    }

    for (let index = 0; index < node.params.length; index += 1) {
      const param = node.params[index];
      if (param.type === "RestElement") {
        const rest = args.slice(index);
        state.budget.allocateArrayLength(rest.length);
        const binding = await bindPattern(param, rest, { kind: "let" }, scope, {
          toPropertyKey: value => toPropertyKey(value, state.budget, { ...callContext, stack: callContext?.stack ?? [], thisValue, compilation }),
          getProperty: (value, key) => getSandboxDataProperty(value, key, state.budget),
          setProperty: (target, key, value) => setSandboxProperty(target, key, value, state.budget),
          evaluate: async (defaultNode) => {
            const result = await interpret(defaultNode, {
              budget: state.budget,
              compilation,
              scope,
              nested: true,
              useScopeDirectly: true
            });
            return result.ok
              ? {
                  kind: "normal",
                  hasValue: "returnValue" in result,
                  value: result.returnValue
                }
              : { kind: "error", error: result.error };
          }
        });
        if (!binding.ok) {
          if (binding.result.kind === "error") {
            throw binding.result.error;
          }
          if (binding.result.kind === "throw") {
            throw binding.result.value;
          }
        }
        break;
      }
      const binding = await bindPattern(param, args[index], { kind: "let" }, scope, {
        toPropertyKey: value => toPropertyKey(value, state.budget, { ...callContext, stack: callContext?.stack ?? [], thisValue, compilation }),
        getProperty: (value, key) => getSandboxDataProperty(value, key, state.budget),
        setProperty: (target, key, value) => setSandboxProperty(target, key, value, state.budget),
        evaluate: async (defaultNode) => {
          const result = await interpret(defaultNode, {
            budget: state.budget,
            compilation,
            scope,
            nested: true,
            useScopeDirectly: true
          });
          return result.ok
            ? {
                kind: "normal",
                hasValue: "returnValue" in result,
                value: result.returnValue
              }
            : { kind: "error", error: result.error };
        }
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

    const result = await interpret(node.body, {
      budget: state.budget,
      compilation,
      nested: true,
      onSuspend,
      scope
    });

    if (!result.ok) {
      throw new Error(result.error.message);
    }

    reconcileCompiledValues(
      state.budget,
      [...scope.retainedDataRoots(), result.returnValue],
      compilation,
      parent,
      [result.returnValue]
    );
    return result.returnValue;
  } finally {
    compilation.dispose();
    operation.release();
  }
}

function restorePromiseValue(
  id: SnapshotId,
  state: RestoreState
): RuntimePendingPromise & SandboxPromise {
  return (state.pendingPromiseById.get(id) ??
    restorePendingPromise({ id }, state)) as RuntimePendingPromise & SandboxPromise;
}

function restoreModuleBindings(
  moduleBindings: SerializedSnapshot["moduleBindings"],
  modules: ModuleRegistry | undefined,
  options: { budget: Budget; compileOwner?: CompileOwner; signal?: AbortSignal }
): Record<string, SandboxValue> {
  const bindings = Object.create(null) as Record<string, SandboxValue>;
  const registry = normalizeModuleRegistry(modules);

  for (const [localName, moduleName] of Object.entries(moduleBindings)) {
    const moduleExports = registry.get(moduleName);
    if (moduleExports === undefined) {
      throw new Error(createUnknownModuleMessage(moduleName, [...registry.keys()]));
    }

    bindings[localName] = createModuleNamespace(
      wrapCallerInjectedBindings(Object.fromEntries(moduleExports), options)
    );
  }

  return bindings;
}

function normalizeModuleRegistry(
  modules: ModuleRegistry | undefined
): Map<string, Map<string, CallerInjectedBinding>> {
  if (modules === undefined) {
    return new Map();
  }

  const entries = modules instanceof Map ? [...modules.entries()] : Object.entries(modules);
  return new Map(
    entries
      .map(
        ([moduleName, moduleExports]) =>
          [moduleName, normalizeModuleExports(moduleExports)] as const
      )
      .sort(([left], [right]) => left.localeCompare(right))
  );
}

function normalizeModuleExports(moduleExports: ModuleExports): Map<string, CallerInjectedBinding> {
  const entries =
    moduleExports instanceof Map ? [...moduleExports.entries()] : Object.entries(moduleExports);

  return new Map(
    entries.sort(([left], [right]) => left.localeCompare(right))
  );
}

function indexAstNodes(root: Module): Map<number, ParseResult> {
  const nodeById = new Map<number, ParseResult>();
  visit(root);
  return nodeById;

  function visit(value: unknown): void {
    if (typeof value !== "object" || value === null) {
      return;
    }

    if (Array.isArray(value)) {
      for (const entry of value) {
        visit(entry);
      }

      return;
    }

    if (
      hasOwnProperty(value, "type") &&
      typeof value.type === "string" &&
      value.type !== "Module" &&
      hasOwnProperty(value, "nodeId") &&
      typeof value.nodeId === "number"
    ) {
      nodeById.set(value.nodeId, value as ParseResult);
    }

    for (const entry of Object.values(value)) {
      visit(entry);
    }
  }
}

function isSerializedUndefinedValue(
  value: SerializedSnapshotValue
): value is { kind: "undefined" } {
  return (
    typeof value === "object" &&
    value !== null &&
    hasOwnProperty(value, "kind") &&
    value.kind === "undefined"
  );
}

function isSerializedNonFiniteNumberValue(
  value: SerializedSnapshotValue
): value is { kind: "number"; value: "-Infinity" | "Infinity" | "NaN" | "-0" } {
  return (
    typeof value === "object" &&
    value !== null &&
    hasOwnProperty(value, "kind") &&
    value.kind === "number" &&
    hasOwnProperty(value, "value")
  );
}

function isSerializedReferenceValue(
  value: SerializedSnapshotValue
): value is SerializedReferenceValue {
  return (
    typeof value === "object" &&
    value !== null &&
    hasOwnProperty(value, "kind") &&
    value.kind === "ref" &&
    hasOwnProperty(value, "id")
  );
}

function isSerializedPromiseValue(value: SerializedSnapshotValue): value is SerializedPromiseValue {
  return (
    typeof value === "object" &&
    value !== null &&
    hasOwnProperty(value, "kind") &&
    value.kind === "promise" &&
    hasOwnProperty(value, "id")
  );
}

function isSerializedClosureValue(value: SerializedSnapshotValue): value is SerializedClosureValue {
  return (
    typeof value === "object" &&
    value !== null &&
    hasOwnProperty(value, "kind") &&
    value.kind === "fn" &&
    hasOwnProperty(value, "astNodeId") &&
    hasOwnProperty(value, "capturedScopeId")
  );
}

function isSerializedGeneratorValue(
  value: SerializedSnapshotValue
): value is SerializedGeneratorValue {
  return (
    typeof value === "object" &&
    value !== null &&
    hasOwnProperty(value, "kind") &&
    value.kind === "generator" &&
    hasOwnProperty(value, "state") &&
    (value.state === "done" ||
      (value.state === "start" &&
        hasOwnProperty(value, "astNodeId") &&
        typeof value.astNodeId === "number" &&
        hasOwnProperty(value, "capturedScopeId") &&
        (typeof value.capturedScopeId === "number" || typeof value.capturedScopeId === "string")) ||
      (value.state === "suspended" &&
        hasOwnProperty(value, "astNodeId") &&
        typeof value.astNodeId === "number" &&
        hasOwnProperty(value, "capturedScopeId") &&
        (typeof value.capturedScopeId === "number" || typeof value.capturedScopeId === "string") &&
        hasOwnProperty(value, "yieldNodeId") &&
        typeof value.yieldNodeId === "number" &&
        hasOwnProperty(value, "sent")))
  );
}

function hasOwnProperty<Name extends PropertyKey>(
  value: object,
  name: Name
): value is Record<Name, unknown> {
  return Object.prototype.hasOwnProperty.call(value, name);
}

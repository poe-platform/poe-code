import { getClosureOrigin, getGeneratorOrigin } from "../interp/closure-origin.js";
import { guestProxyStates, guestProxyRevokers } from "../interp/guest-proxy.js";
import { mappedArgumentStates } from "../interp/arguments.js";
import { dynamicNodeSources, dynamicSourceRecords, type DynamicSource, type EvalSourceContext } from "../parse/function-source.js";
import { moduleFunctionOrigins } from "../interp/module-function-origin.js";
import { isSandboxModuleNamespace } from "../interp/module-namespace.js";
import { boundFunctionStates } from "../interp/bound-function-state.js";
import { sandboxErrorTypes, type SandboxErrorName } from "../error/shape.js";
import { getGeneratorProperties } from "../interp/generator-properties.js";
import { getIntrinsicIdentity } from "../interp/intrinsics.js";
import { getSandboxPrototype, hasExplicitSandboxPrototype, hasGuestObjectState, isGuestClosure, materializeFunctionProperties } from "../interp/object-model.js";
import { isLiveCapability } from "../interp/host-capabilities.js";
import { retainedAccessorClosures } from "../interp/accessors.js";
import { templateOrigins, templateCookedArrays } from "../interp/template-objects.js";
import { isSandboxBox, boxedValue } from "../interp/boxed.js";
import { isRawJson } from "../interp/raw-json.js";
import { isSandboxDate, dateTime } from "../interp/date.js";
import { isSandboxLocale, localeTag } from "../interp/intl-locale.js";
import { isSandboxCollator, collatorState, type ResolvedCollatorOptions } from "../interp/intl-collator.js";
import { isSandboxListFormat, listFormatState, type ResolvedListFormatOptions } from "../interp/intl-listformat.js";
import { isSandboxRelativeTimeFormat, relativeTimeFormatState, type ResolvedRelativeTimeFormatOptions } from "../interp/intl-relativetimeformat.js";
import { isSandboxDisplayNames, displayNamesState, type ResolvedDisplayNamesOptions } from "../interp/intl-displaynames.js";
import { isSandboxPluralRules, pluralRulesState, type ResolvedPluralRulesOptions } from "../interp/intl-pluralrules.js";
import { isSandboxDurationFormat, durationFormatState, type DurationSettings } from "../interp/intl-durationformat.js";
import { isSandboxSegmenter, isSandboxSegments, segmenterState, segmentState, type SegmenterOptions } from "../interp/intl-segmenter.js";
import { isSandboxNumberFormat, numberFormatState, type NumberFormatOptions } from "../interp/intl-numberformat.js";
import { isSandboxDateTimeFormat, dateTimeFormatState, type DateTimeFormatOptions } from "../interp/intl-datetimeformat.js";
import { isSandboxCollectionIterator, snapshotCollectionIterator, type CollectionIterationMethod } from "../interp/collection-iterator.js";
import { isSandboxRegExpIterator, regexpIteratorState } from "../interp/regexp-iterator.js";
import { arrayIteratorState, isSandboxArrayIterator } from "../interp/array-iterator.js";
import { isSandboxStringIterator, stringIteratorState } from "../interp/string-iterator.js";
import { iteratorWrapperStates } from "../interp/iterator-wrapper.js";
import { disposableStackStates } from "../interp/disposable-stack.js";
import { asyncDisposableStackStates, asyncCleanupStates, asyncCleanupHandlers, type AsyncDisposableResource } from "../interp/async-disposable-stack.js";
import { iteratorHelperStates, type IteratorHelperState } from "../interp/iterator-helper.js";
import { Scope, type ScopeFrame } from "../interp/scope.js";
import { asyncFunctionDrivers, asyncFunctionHandlers } from "../interp/async-function-driver.js";
import { asyncGeneratorDrivers, asyncGeneratorHandlers, asyncGeneratorRequestOwners } from "../interp/async-generator-driver.js";
import { isSandboxClosure, isSandboxRegex, isSandboxMap, isSandboxSet, isSandboxPromise, isSandboxGenerator, isSandboxArguments, getRegexProperties, getPromiseProperties } from "../interp/values.js";
import { promiseStates } from "../interp/promise-state.js";
import { promiseResolvingFunctions, promiseResolverActions } from "../interp/promise-resolvers.js";
import { promiseContinuations, promiseReactionResults, promiseProducers, promiseAdoptions, promiseAdoptionBridges, promiseAdoptionResolvers } from "../interp/promise-continuations.js";
import { unrepresentedPromiseContinuations } from "../interp/promise-tracker.js";
import { thenableStates, thenableResolvers, thenableContinuations } from "../interp/promise-continuations.js";
import { SnapshotNotReadyError } from "./not-ready.js";
import { promiseCapabilityExecutors } from "../interp/promise-continuations.js";
import { promiseAggregateStates, promiseAggregateEntries, promiseAggregateHandlers, type PromiseAggregateState } from "../interp/promise-continuations.js";
import { symbolRegistryOrigins } from "../interp/symbol-registry.js";
import { serializePropertyDescriptors, type PropertyDescriptorData } from "./property-descriptors.js";
import { serializeCollectionProperties } from "./collection-properties.js";
import { classOrigins } from "../interp/classes.js";
import { constructionStates } from "../interp/construction-state.js";
import { privateElements, type PrivateName, type PrivateElement } from "../interp/private-state.js";
import type { CompletionResult } from "../interp/exceptions.js";
import type { GeneratorExpressionState } from "../interp/generator-expression-state.js";
import { mapIteratorSnapshot, type IteratorSnapshot } from "../interp/iteration.js";

export type GeneratorFinallyCompletion<T> = Omit<CompletionResult, "value" | "node" | "stackFrames"> & { value: T; nodeId?: number; stackFrames?: string[] };

export type AsyncResourceData<T> = {method: T; receiver: T; args: T[]; syncFallback: boolean; synchronous?: boolean};

function captureAsyncResources<T>(resources: AsyncDisposableResource[], encode: (value: unknown) => T): AsyncResourceData<T>[] {
  return resources.map(resource => ({method: encode(resource.method), receiver: encode(resource.receiver),
    args: resource.args.map(encode), syncFallback: resource.syncFallback,
    ...(resource.synchronous === undefined ? {} : {synchronous: resource.synchronous})}));
}

export type GuestObjectState<T> = {
  properties: PropertyDescriptorData<T>;
  prototype?: T;
  privateElements?: PrivateElementData<T>[];
};

export type PrivateElementData<T> = { name: T } & (
  { kind: "field" | "method"; value: T } | { kind: "accessor"; get: T; set: T }
);

export type GuestHeapNode<T> =
  | {kind: "guest-proxy"; target: T; handler: T; callable: boolean; constructible: boolean; privateElements?: PrivateElementData<T>[]}
  | {kind: "guest-proxy-revoker"; proxy: T; state: GuestObjectState<T>}
  | {kind: "guest-source"; functionKind: Exclude<DynamicSource["kind"], "eval">; parameters: string; body: string}
  | {kind: "guest-script"; context: EvalSourceContext; body: string}
  | {kind: "mapped-arguments"; scope: T; parameters: Array<[string, string]>; state: GuestObjectState<T>; nativeIterator: boolean}
  | {kind: "async-generator-driver"; generator: T; requests: Array<{method:"next"|"return"|"throw";value:T;resultPrototype?:T;capability:{promise:T;resolve:T;reject:T}}>;
      phase:"idle"|"waiting";suspension:"await"|"yield";awaitKind:"body"|"return";generation:number}
  | {kind: "async-generator-handler"; driver:T;owner:T;action:"fulfilled"|"rejected";generation:number;state:GuestObjectState<T>}
  | {kind: "async-function-driver"; generator: T; capability: {promise:T;resolve:T;reject:T}; phase:"waiting"|"done";generation:number}
  | {kind: "async-function-handler"; driver:T;action:"fulfilled"|"rejected";generation:number;state:GuestObjectState<T>}
  | {kind: "async-disposable-stack"; disposed: boolean; resources: AsyncResourceData<T>[]; state: GuestObjectState<T>}
  | {kind: "async-cleanup"; resources: AsyncResourceData<T>[]; capability: {promise: T; resolve: T; reject: T}; phase: "waiting" | "done"; failed: boolean; failure: T; needsAwait: boolean; hasAwaited: boolean; generation: number}
  | {kind: "async-cleanup-handler"; cleanup: T; action: "fulfilled" | "rejected"; generation: number; state: GuestObjectState<T>}
  | { kind: "disposable-stack"; disposed: boolean; resources: Array<{method: T; receiver: T; args: T[]}>; state: GuestObjectState<T> }
  | {kind: "thenable-state"; source: T; owner: T; completed: boolean; settlement?: {state: "fulfilled" | "rejected"; value: T}}
  | {kind: "thenable-resolver"; continuation: T; action: "fulfilled" | "rejected"; state: GuestObjectState<T>}
  | { kind: "construction-environment"; constructor: T; newTarget: T; prototype: T; thisValue: T; thisScope: T; initialized: boolean }
  | { kind: "capability-executor"; resolve: T; reject: T; state: GuestObjectState<T> }
  | { kind: "promise-aggregate"; method: PromiseAggregateState["method"]; capability: {promise: T; resolve: T; reject: T}; values: T; remaining: number; size: number; iteration: "complete" | "abrupt" }
  | { kind: "aggregate-entry"; aggregate: T; index: number; called: boolean }
  | { kind: "aggregate-handler"; entry: T; action: "fulfilled" | "rejected"; state: GuestObjectState<T> }
  | { kind: "guest-regex"; source: string; flags: string; state: GuestObjectState<T> }
  | { kind: "guest-promise"; status: "fulfilled" | "rejected"; value: T; reactions?: T[]; producers?: T[]; generatorOwner?: T; state: GuestObjectState<T> }
  | { kind: "promise-resolver"; promise: T; action?: "fulfilled" | "rejected"; state: GuestObjectState<T> }
  | { kind: "pending-promise"; adoption?: T; thenable?: T; reactions: T[]; producers?: T[]; generatorOwner?: T; state: GuestObjectState<T> }
  | { kind: "promise-adoption"; owner: T; source: T }
  | { kind: "adoption-resolver"; bridge: T; action: "fulfilled" | "rejected" }
  | { kind: "promise-reaction"; source: T; onFulfilled: T; onRejected: T; reactions: T[]; producers?: T[];
      aggregate?: T;
      capability?: {promise: T; resolve: T; reject: T}; state: GuestObjectState<T> }
  | { kind: "guest-boxed"; value: T; state: GuestObjectState<T> }
  | { kind: "guest-date"; value: T; state: GuestObjectState<T> }
  | { kind: "guest-locale"; tag: string; state: GuestObjectState<T> }
  | { kind: "guest-collator"; options: ResolvedCollatorOptions; compare?: T; state: GuestObjectState<T> }
  | { kind: "guest-numberformat"; options: NumberFormatOptions; format?: T; state: GuestObjectState<T> }
  | { kind: "guest-datetimeformat"; options: DateTimeFormatOptions; format?: T; state: GuestObjectState<T> }
  | { kind: "guest-listformat"; options: ResolvedListFormatOptions; state: GuestObjectState<T> }
  | { kind: "guest-relativetimeformat"; options: ResolvedRelativeTimeFormatOptions; state: GuestObjectState<T> }
  | { kind: "guest-displaynames"; options: ResolvedDisplayNamesOptions; state: GuestObjectState<T> }
  | { kind: "guest-pluralrules"; options: ResolvedPluralRulesOptions; state: GuestObjectState<T> }
  | { kind: "guest-durationformat"; settings: DurationSettings; state: GuestObjectState<T> }
  | { kind: "guest-segmenter"; options: SegmenterOptions; state: GuestObjectState<T> }
  | { kind: "guest-segments"; segmenter: T; input: string; index?: number; state: GuestObjectState<T> }
  | { kind: "iterator-helper"; method: IteratorHelperState["method"]; status: "start" | "yield" | "done";
      outer?: { iterator: T; next: T }; inner?: { iterator: T; next: T }; callback: T;
      remaining: number | "Infinity"; index: number; state: GuestObjectState<T> }
  | { kind: "iterator-wrapper"; iterator: T; next: T; state: GuestObjectState<T> }
  | { kind: "module-namespace"; entries: Array<[string,T]> }
  | { kind: "string-iterator"; input: T; index: number; state: GuestObjectState<T> }
  | { kind: "guest-collection-iterator"; collectionKind: "map" | "set"; method: CollectionIterationMethod;
      collection: T; index: number; exhausted: boolean; state: GuestObjectState<T> }
  | { kind: "guest-regexp-iterator"; matcher: T; input: T; exhausted: boolean; global?: boolean; unicode?: boolean; state: GuestObjectState<T> }
  | { kind: "bound-function"; target: T; thisValue: T; args: T[]; name?: string; length: T; state: GuestObjectState<T> }
  | { kind: "array-iterator"; source: T; index: number; method: "keys" | "values" | "entries"; state: GuestObjectState<T> }
  | { kind: "guest-class"; astNodeId: number; scope: T; name?: string; fields: Array<{ index: number; key: T; privateName?: T }>; privateMethods?: PrivateElementData<T>[]; state: GuestObjectState<T>; dynamicSource?: T }
  | { kind: "map"; entries: Array<[T,T]>; propertyState?: PropertyDescriptorData<T>; prototype?: T; privateElements?: PrivateElementData<T>[] }
  | { kind: "set"; values: T[]; propertyState?: PropertyDescriptorData<T>; prototype?: T; privateElements?: PrivateElementData<T>[] }
  | { kind: "raw-json"; text: string }
  | { kind: "guest-generator"; state: "start" | "running" | "suspended" | "done"; astNodeId: number;
      dynamicSource?: T;
      asyncFunction?: true;
      resultPrototype?: T;
      driver?: T;
      awaitPhase?: "await" | "yield" | "return" | "resume-return";
      async: boolean; scope: T; closureScope: T; suspendedScope?: T; yieldNodeId?: number;
      blockScopes?: Record<string, T>;
      finallyCompletions?: Record<string, GeneratorFinallyCompletion<T>>;
      expressionStates?: Record<string, GeneratorExpressionState<T, T, IteratorSnapshot<T>>>;
      sent: Array<{ type: "normal" | "return" | "throw"; value: T }>;
      environment?: { homeObject?: T; newTarget?: T; construction?: T; classInitializer?: true }; objectState?: GuestObjectState<T> }
  | { kind: "guest-object"; state: GuestObjectState<T>; errorType?: SandboxErrorName }
  | { kind: "guest-array"; state: GuestObjectState<T>; templateNodeId?: number; templateOwner?: T; dynamicSource?: T }
  | { kind: "intrinsic"; id: string; state?: GuestObjectState<T>; symbolRegistry?: Array<[string, T]> }
  | { kind: "module-function"; module: string; path: string[]; name?: string; state: GuestObjectState<T> }
  | { kind: "guest-function"; astNodeId: number; scope: T; name?: string; state: GuestObjectState<T>; dynamicSource?: T;
      environment?: { homeObject?: T; newTarget?: T; construction?: T; classInitializer?: true } }
  | { kind: "scope-frame"; parent: T; importMeta: T; functionBoundary: boolean; chargeData: boolean;
      simpleCatchParameter?: string;
      globalEnvironment?: boolean;
      moduleEnvironment?: {available: string[]; namespaces: T};
      objectEnvironment?: T;
      withObject?: T;
      resourceState?: T;
      privateNames?: Array<[string, T]>;
      bindings: Array<[string, number]>;
      cells: Array<{ kind: ScopeFrame["cells"][number]["kind"]; silentImmutable?: true; deletable?: true } & (
        { initialized: false } | { initialized: true; value: T }
      )>;
      restoredBindings?: Array<[string, T]> };

// The enclosing graph serializer allocates the reference before calling this
// function, so self-referential properties and captured environments can cycle.
export function captureGuestHeapNode<T>(value: object, encode: (value: unknown) => T): GuestHeapNode<T> | undefined {
  const proxy = guestProxyStates.get(value);
  if (proxy !== undefined) return {
    kind: "guest-proxy", target: encode(proxy.target), handler: encode(proxy.handler),
    callable: isSandboxClosure(value), constructible: isSandboxClosure(value) && value.construct !== undefined,
    ...(privateElements.has(value) ? {privateElements: capturePrivateElements(privateElements.get(value)!, encode)} : {})
  };
  const revoker = guestProxyRevokers.get(value);
  if (revoker !== undefined) return {kind: "guest-proxy-revoker", proxy: encode(revoker.proxy), state: captureObjectState(value, encode)!};
  if (dynamicSourceRecords.has(value)) {
    const source = value as DynamicSource;
    if (source.kind === "eval") return {kind: "guest-script", body: source.body,
      context: {...source.context, privateNames: [...source.context.privateNames]}};
    return {kind: "guest-source", functionKind: source.kind, parameters: source.parameters, body: source.body};
  }
  const mapped = isSandboxArguments(value) ? mappedArgumentStates.get(value) : undefined;
  if (mapped !== undefined) return {kind: "mapped-arguments", scope: encode(mapped.scope),
    parameters: [...mapped.parameters], nativeIterator: Object.getOwnPropertyDescriptor(value, Symbol.iterator)?.value === Array.prototype.values,
    state: captureObjectState(value, entry => encode(entry === Array.prototype.values ? undefined : entry))!};
  const generatorDriver = asyncGeneratorDrivers.get(value);
  if (generatorDriver === value) {
    if (generatorDriver.phase === "running") throw new SnapshotNotReadyError("Cannot snapshot an active async generator request.");
    return {kind: "async-generator-driver", generator: encode(generatorDriver.generator), phase: generatorDriver.phase,
      suspension: generatorDriver.suspension, awaitKind: generatorDriver.awaitKind, generation: generatorDriver.generation,
      requests: generatorDriver.requests.map(request => ({method: request.method, value: encode(request.value),
        capability: {promise: encode(request.capability.promise), resolve: encode(request.capability.resolve), reject: encode(request.capability.reject)}}))};
  }
  const generatorHandler = isSandboxClosure(value) ? asyncGeneratorHandlers.get(value) : undefined;
  if (generatorHandler !== undefined) return {kind: "async-generator-handler", driver: encode(generatorHandler.driver),
    owner: encode(generatorHandler.owner), action: generatorHandler.action, generation: generatorHandler.generation, state: captureObjectState(value, encode)!};
  const driver = asyncFunctionDrivers.get(value);
  if (driver !== undefined) {
    if (driver.phase === "running" || driver.generator === undefined) throw new SnapshotNotReadyError("Cannot snapshot an active async function.");
        ...(request.resultPrototype === undefined ? {} : {resultPrototype: encode(request.resultPrototype)}),
    return {kind: "async-function-driver", generator: encode(driver.generator), phase: driver.phase, generation: driver.generation,
      capability: {promise: encode(driver.capability.promise), resolve: encode(driver.capability.resolve), reject: encode(driver.capability.reject)}};
  }
  const asyncHandler = isSandboxClosure(value) ? asyncFunctionHandlers.get(value) : undefined;
  if (asyncHandler !== undefined) return {kind: "async-function-handler", driver: encode(asyncHandler.driver),
    action: asyncHandler.action, generation: asyncHandler.generation, state: captureObjectState(value, encode)!};
  const asyncStack = asyncDisposableStackStates.get(value);
  if (asyncStack !== undefined) return {kind: "async-disposable-stack", disposed: asyncStack.disposed,
    resources: captureAsyncResources(asyncStack.resources, encode), state: captureObjectState(value, encode)!};
  const cleanup = asyncCleanupStates.get(value);
  if (cleanup !== undefined) {
    if (cleanup.phase === "running") throw new SnapshotNotReadyError("Cannot snapshot an active async cleanup invocation.");
    return {kind: "async-cleanup", resources: captureAsyncResources(cleanup.resources, encode),
      capability: {promise: encode(cleanup.capability.promise), resolve: encode(cleanup.capability.resolve), reject: encode(cleanup.capability.reject)},
      phase: cleanup.phase, failed: cleanup.failed, failure: encode(cleanup.failure), needsAwait: cleanup.needsAwait,
      hasAwaited: cleanup.hasAwaited, generation: cleanup.generation};
  }
  const cleanupHandler = isSandboxClosure(value) ? asyncCleanupHandlers.get(value) : undefined;
  if (cleanupHandler !== undefined) return {kind: "async-cleanup-handler", cleanup: encode(cleanupHandler.cleanup),
    action: cleanupHandler.action, generation: cleanupHandler.generation, state: captureObjectState(value, encode)!};
  const disposable = disposableStackStates.get(value);
  if (disposable !== undefined) {
    if (disposable.active) throw new SnapshotNotReadyError("Cannot snapshot active synchronous resource cleanup.");
    return {kind: "disposable-stack", disposed: disposable.disposed,
      resources: disposable.resources.map(resource => ({method: encode(resource.method), receiver: encode(resource.receiver), args: resource.args.map(encode)})),
      state: captureObjectState(value, encode)!};
  }
  const construction = constructionStates.get(value);
  if (construction !== undefined) {
    if (construction.activeCalls !== 0 || construction.thisScope === undefined)
      throw new TypeError("Active class construction environments cannot yet be serialized.");
    return {kind: "construction-environment", constructor: encode(construction.constructor),
      newTarget: encode(construction.newTarget), prototype: encode(construction.prototype),
      thisValue: encode(construction.thisValue), thisScope: encode(construction.thisScope), initialized: construction.initialized};
  }
  const executor = isSandboxClosure(value) ? promiseCapabilityExecutors.get(value) : undefined;
  if (executor !== undefined)
    return {kind: "capability-executor", resolve: encode(executor.resolve), reject: encode(executor.reject), state: captureObjectState(value, encode)!};
  const aggregate = promiseAggregateStates.get(value);
  if (aggregate !== undefined) {
    if (aggregate.iteration === "active") throw new TypeError("Cannot snapshot an active promise aggregate iterator.");
    return {kind: "promise-aggregate", method: aggregate.method, remaining: aggregate.remaining,
      size: aggregate.size, iteration: aggregate.iteration,
      values: encode(aggregate.values), capability: {promise: encode(aggregate.capability.promise),
        resolve: encode(aggregate.capability.resolve), reject: encode(aggregate.capability.reject)}};
  }
  const aggregateEntry = promiseAggregateEntries.get(value);
  if (aggregateEntry !== undefined)
    return {kind: "aggregate-entry", aggregate: encode(aggregateEntry.aggregate), index: aggregateEntry.index, called: aggregateEntry.called};
  const aggregateHandler = isSandboxClosure(value) ? promiseAggregateHandlers.get(value) : undefined;
  if (aggregateHandler !== undefined)
    return {kind: "aggregate-handler", entry: encode(aggregateHandler.entry), action: aggregateHandler.action, state: captureObjectState(value, encode)!};
  const thenable = thenableStates.get(value);
  if (thenable !== undefined) {
    if (thenable.invocationPending || (!thenable.completed && thenable.settlement !== undefined))
      throw new SnapshotNotReadyError("Cannot serialize an active thenable invocation or settlement.");
    return {kind: "thenable-state", source: encode(thenable.source), owner: encode(thenable.owner), completed: thenable.completed,
      ...(thenable.settlement === undefined ? {} : {settlement: {state: thenable.settlement.state, value: encode(thenable.settlement.value)}})};
  }
  const thenableResolver = isSandboxClosure(value) ? thenableResolvers.get(value) : undefined;
  if (thenableResolver !== undefined) return {kind: "thenable-resolver", continuation: encode(thenableResolver.continuation),
    action: thenableResolver.action, state: captureObjectState(value, encode)!};
  const bridge = promiseAdoptionBridges.get(value);
  if (bridge !== undefined) {
    if (bridge.settled || bridge.owner === undefined) return undefined;
    return {kind: "promise-adoption", owner: encode(bridge.owner), source: encode(bridge.source)};
  }
  const adoptionResolver = isSandboxClosure(value) ? promiseAdoptionResolvers.get(value) : undefined;
  if (adoptionResolver !== undefined)
    return {kind: "adoption-resolver", bridge: encode(adoptionResolver.bridge), action: adoptionResolver.action};
  const resolver = isSandboxClosure(value) ? promiseResolvingFunctions.get(value) : undefined;
  if (resolver !== undefined) {
    const settlement = promiseStates.get(resolver.promise);
    if (settlement?.status === "pending") {
      const action = isSandboxClosure(value) ? promiseResolverActions.get(value) : undefined;
      if (action === undefined) return undefined;
      return {kind: "promise-resolver", promise: encode(resolver.promise), action, state: captureObjectState(value, encode)!};
    }
    if (!resolver.settled || settlement === undefined) return undefined;
    return {kind: "promise-resolver", promise: encode(resolver.promise), state: captureObjectState(value, encode)!};
  }
  if (isSandboxPromise(value)) {
    const generatorOwner = asyncGeneratorRequestOwners.get(value);
    const ownerState = generatorOwner === undefined ? {} : {generatorOwner: encode(generatorOwner)};
    const producerState = promiseProducers.has(value) ? {producers: [...promiseProducers.get(value)!].map(encode)} : {};
    const settlement = promiseStates.get(value);
    if (settlement !== undefined && settlement.status !== "pending")
      return {kind: "guest-promise", status: settlement.status, value: encode(settlement.value),
        ...ownerState,
        ...producerState,
        ...(promiseReactionResults.has(value) ? {reactions: [...promiseReactionResults.get(value)!].map(encode)} : {}),
        state: captureObjectState(value, encode)!};
    const continuation = promiseContinuations.get(value);
    if (unrepresentedPromiseContinuations.has(value))
      throw new TypeError("Cannot serialize host reference: unrepresented promise continuation.");
    if (continuation?.kind === "reaction" && continuation.phase === "running")
      throw new SnapshotNotReadyError("Cannot snapshot an active promise reaction.");
    if (continuation?.kind === "capability") {
      const thenable = thenableContinuations.get(value);
      if (continuation.state.settled && thenable !== undefined && !thenable.completed && thenable.owner === value)
        return {kind: "pending-promise", thenable: encode(thenable), ...producerState, ...ownerState,
          reactions: [...(promiseReactionResults.get(value) ?? [])].map(encode), state: captureObjectState(value, encode)!};
      const adoption = promiseAdoptions.get(value);
      const bridge = adoption === undefined ? undefined : promiseAdoptionBridges.get(adoption);
      if (continuation.state.settled && (bridge === undefined || bridge.settled || bridge.owner !== value ||
          continuation.resolution?.status !== "fulfilled" || continuation.resolution.value !== bridge.source)) return undefined;
      return {kind: "pending-promise", ...(continuation.state.settled ? {adoption: encode(adoption)} : {}),
        ...ownerState,
        ...producerState,
        reactions: [...(promiseReactionResults.get(value) ?? [])].map(encode), state: captureObjectState(value, encode)!};
    }
    if (continuation?.kind === "reaction" && continuation.phase === "waiting")
      return {kind: "promise-reaction", source: encode(continuation.source),
        ...producerState,
        ...(continuation.aggregate === undefined ? {} : {aggregate: encode(continuation.aggregate)}),
        ...(continuation.capability === undefined ? {} : {capability: {
          promise: encode(continuation.capability.promise), resolve: encode(continuation.capability.resolve), reject: encode(continuation.capability.reject)
        }}),
        onFulfilled: encode(continuation.onFulfilled), onRejected: encode(continuation.onRejected),
        reactions: [...(promiseReactionResults.get(value) ?? [])].map(encode), state: captureObjectState(value, encode)!};
    return undefined;
  }
  if (isSandboxLocale(value)) return { kind: "guest-locale", tag: localeTag(value), state: captureObjectState(value, encode)! };
  if (isSandboxListFormat(value)) return { kind: "guest-listformat", options: { ...listFormatState(value).options }, state: captureObjectState(value, encode)! };
  if (isSandboxSegmenter(value)) return { kind: "guest-segmenter", options: { ...segmenterState(value).options }, state: captureObjectState(value, encode)! };
  if (isSandboxSegments(value)) {
    const state = segmentState(value);
    return { kind: "guest-segments", segmenter: encode(state.segmenter), input: state.input,
      ...(state.index === undefined ? {} : { index: state.index }), state: captureObjectState(value, encode)! };
  }
  if (isSandboxRelativeTimeFormat(value)) return { kind: "guest-relativetimeformat", options: { ...relativeTimeFormatState(value).options }, state: captureObjectState(value, encode)! };
  if (isSandboxDisplayNames(value)) return { kind: "guest-displaynames", options: { ...displayNamesState(value).options }, state: captureObjectState(value, encode)! };
  if (isSandboxPluralRules(value)) {
    const options = pluralRulesState(value).options;
    return { kind: "guest-pluralrules", options: { ...options, pluralCategories: [...options.pluralCategories as string[]] }, state: captureObjectState(value, encode)! };
  }
  if (isSandboxDurationFormat(value)) {
    const { fractionalDigits, ...settings } = durationFormatState(value).settings;
    return { kind: "guest-durationformat", settings: { ...settings, ...(fractionalDigits === undefined ? {} : { fractionalDigits }),
      units: Object.fromEntries(Object.entries(settings.units).map(([unit, options]) => [unit, { ...options }])) }, state: captureObjectState(value, encode)! };
  }
  if (isSandboxDateTimeFormat(value)) {
    const { options, format } = dateTimeFormatState(value);
    return { kind: "guest-datetimeformat", options: { ...options }, ...(format === undefined ? {} : { format: encode(format) }), state: captureObjectState(value, encode)! };
  }
  if (isSandboxNumberFormat(value)) {
    const { options, format } = numberFormatState(value);
    return { kind: "guest-numberformat", options: { ...options }, ...(format === undefined ? {} : { format: encode(format) }), state: captureObjectState(value, encode)! };
  }
  if (isSandboxCollator(value)) {
    const { options, compare } = collatorState(value);
    return { kind: "guest-collator", options: { ...options }, ...(compare === undefined ? {} : { compare: encode(compare) }), state: captureObjectState(value, encode)! };
  }
  if (hasGuestObjectState(value) || privateElements.has(value)) {
    if (isSandboxRegex(value)) return { kind: "guest-regex", source: value.source, flags: value.flags, state: captureObjectState(value, encode)! };
    if (isSandboxBox(value)) return { kind: "guest-boxed", value: encode(boxedValue(value)), state: captureObjectState(value, encode)! };
    if (isSandboxDate(value)) return { kind: "guest-date", value: encode(dateTime(value)), state: captureObjectState(value, encode)! };
  }
  const helper = iteratorHelperStates.get(value);
  if (helper !== undefined) {
    if (helper.status === "executing") throw new TypeError("Cannot snapshot an executing iterator helper.");
    return { kind: "iterator-helper", method: helper.method, status: helper.status,
      ...(helper.outer === undefined ? {} : { outer: { iterator: encode(helper.outer.iterator), next: encode(helper.outer.next) } }),
      ...(helper.inner === undefined ? {} : { inner: { iterator: encode(helper.inner.iterator), next: encode(helper.inner.next) } }),
      callback: encode(helper.callback), remaining: helper.remaining === Infinity ? "Infinity" : helper.remaining,
      index: helper.index, state: captureObjectState(value, encode)! };
  }
  const wrapper = iteratorWrapperStates.get(value);
  if (wrapper !== undefined)
    return {kind:"iterator-wrapper",iterator:encode(wrapper.iterator),next:encode(wrapper.next),state:captureObjectState(value,encode)!};
  if (isSandboxModuleNamespace(value))
    return {kind:"module-namespace",entries:Object.keys(value).map(key => [key,encode(value[key])])};
  if (isSandboxStringIterator(value)) {
    const cursor = stringIteratorState(value);
    return { kind: "string-iterator", input: encode(cursor.input), index: cursor.index, state: captureObjectState(value, encode)! };
  }
  if (isSandboxCollectionIterator(value) && hasGuestObjectState(value)) {
    const cursor = snapshotCollectionIterator(value);
    return { kind: "guest-collection-iterator", collectionKind: cursor.collectionKind, method: cursor.method,
      collection: encode(cursor.collection), index: cursor.index, exhausted: cursor.exhausted, state: captureObjectState(value, encode)! };
  }
  if (isSandboxRegExpIterator(value) && hasGuestObjectState(value)) {
    const cursor = regexpIteratorState(value);
    return { kind: "guest-regexp-iterator", matcher: encode(cursor.matcher), input: encode(cursor.input), exhausted: cursor.exhausted,
      ...(cursor.global === undefined ? {} : { global: cursor.global, unicode: cursor.unicode }), state: captureObjectState(value, encode)! };
  }
  if (isRawJson(value)) return { kind: "raw-json", text: value.rawJSON };
  const intrinsic = getIntrinsicIdentity(value);
  if (intrinsic !== undefined) {
    const state = captureObjectState(value, encode);
    const registry = isSandboxClosure(value) ? symbolRegistryOrigins.get(value) : undefined;
    return { kind: "intrinsic", id: intrinsic, ...(state === undefined ? {} : { state }),
      ...(registry === undefined ? {} : {symbolRegistry: [...registry].map(([key, symbol]) => [key, encode(symbol)] as [string, T])}) };
  }
  const bound = boundFunctionStates.get(value);
  const moduleFunction = isSandboxClosure(value) ? moduleFunctionOrigins.get(value) : undefined;
  if (moduleFunction !== undefined) return {
    kind: "module-function", module: moduleFunction.module, path: [...moduleFunction.path],
    ...(isSandboxClosure(value) && value.name !== undefined ? { name: value.name } : {}),
    state: captureObjectState(value, encode)!
  };
  if (bound !== undefined && isSandboxClosure(value)) {
    return { kind: "bound-function", target: encode(bound.target), thisValue: encode(bound.thisValue),
      args: bound.args.map(encode), length: encode(value.length),
      ...(value.name === undefined ? {} : { name: value.name }), state: captureObjectState(value, encode)! };
  }
  if (isSandboxMap(value)) return { kind: "map", entries: [...value.entries].map(([key,entry]) => [encode(key),encode(entry)]), ...serializeCollectionProperties(value,encode),
    ...(privateElements.has(value) ? { privateElements: capturePrivateElements(privateElements.get(value)!, encode) } : {}) };
  if (isSandboxSet(value)) return { kind: "set", values: [...value.values].map(encode), ...serializeCollectionProperties(value,encode),
    ...(privateElements.has(value) ? { privateElements: capturePrivateElements(privateElements.get(value)!, encode) } : {}) };
  if (isSandboxArrayIterator(value)) {
    const cursor = arrayIteratorState(value);
    return { kind: "array-iterator", source: encode(cursor.source), index: cursor.index, method: cursor.method,
      state: captureObjectState(value, encode)! };
  }
  const classOrigin = classOrigins.get(value);
  if (classOrigin !== undefined) {
    if (!classOrigin.initialized || classOrigin.node.nodeId === undefined)
      throw new TypeError("Class definitions must finish before they can be snapshotted.");
    return { kind: "guest-class", astNodeId: classOrigin.node.nodeId, scope: encode(classOrigin.scope),
      ...(dynamicNodeSources.has(classOrigin.node) ? {dynamicSource: encode(dynamicNodeSources.get(classOrigin.node))} : {}),
      ...(isSandboxClosure(value) && value.name !== undefined ? { name: value.name } : {}),
      fields: classOrigin.fields.map(field => ({ index: classOrigin.node.body.body.indexOf(field.element), key: encode(field.key),
        ...(field.privateName === undefined ? {} : { privateName: encode(field.privateName) }) })),
      ...(classOrigin.privateMethods.size === 0 ? {} : { privateMethods: capturePrivateElements(classOrigin.privateMethods, encode) }),
      state: captureObjectState(value, encode)! };
  }
  if (value instanceof Scope) {
    const frame = value.captureFrame();
    return {
      kind: "scope-frame", parent: encode(frame.parent), importMeta: encode(frame.importMeta),
      functionBoundary: frame.functionBoundary, chargeData: frame.chargeData,
      ...(frame.simpleCatchParameter === undefined ? {} : {simpleCatchParameter: frame.simpleCatchParameter}),
      ...(frame.globalEnvironment === true ? {globalEnvironment: true} : {}),
      bindings: frame.bindings,
      ...(frame.moduleEnvironment === undefined ? {} : {moduleEnvironment: {
        available: [...frame.moduleEnvironment.available], namespaces: encode(frame.moduleEnvironment.namespaces)
      }}),
      ...(frame.objectEnvironment === undefined ? {} : {objectEnvironment: encode(frame.objectEnvironment)}),
      ...(frame.withObject === undefined ? {} : {withObject: encode(frame.withObject)}),
      ...(frame.resourceState === undefined ? {} : {resourceState: encode(frame.resourceState)}),
      ...(frame.privateNames === undefined ? {} : { privateNames: frame.privateNames.map(([name, identity]) => [name, encode(identity)] as [string, T]) }),
      cells: frame.cells.map(cell => cell.initialized ? { ...cell, value: encode(cell.value) } : cell),
      ...(frame.restoredBindings === undefined ? {} : {
        restoredBindings: frame.restoredBindings.map(([name, entry]) => [name, encode(entry)] as [string, T])
      })
    };
  }
  if (isSandboxGenerator(value)) {
    const origin = getGeneratorOrigin(value);
    if (origin?.node.nodeId === undefined) throw new TypeError("Generators require a captured origin for public dumps.");
    const channel = value.channel.snapshot();
    return {
      kind: "guest-generator", state: value.state, astNodeId: origin.node.nodeId, async: value.async === true,
      ...(dynamicNodeSources.has(origin.node) ? {dynamicSource: encode(dynamicNodeSources.get(origin.node))} : {}),
      ...(origin.asyncFunction ? {asyncFunction: true as const} : {}),
      ...(generatorDriver === undefined ? {} : {driver: encode(generatorDriver)}),
      ...(origin.awaitPhase === undefined ? {} : {awaitPhase: origin.awaitPhase}),
      objectState: captureObjectState(value, encode),
      scope: encode(origin.scope), closureScope: encode(origin.closureScope),
      ...(value.state !== "suspended" || origin.suspendedScope === undefined ? {} : { suspendedScope: encode(origin.suspendedScope) }),
      ...(value.state !== "suspended" || origin.blockScopes === undefined ? {} : {
      ...(origin.resultPrototype === undefined ? {} : {resultPrototype: encode(origin.resultPrototype)}),
        blockScopes: Object.fromEntries([...origin.blockScopes].map(([id, scope]) => [String(id), encode(scope)]))
      }),
      ...(value.state !== "suspended" || origin.finallyCompletions === undefined ? {} : {
        finallyCompletions: Object.fromEntries([...origin.finallyCompletions].map(([id, completion]) => {
          const { node, value, stackFrames, ...metadata } = completion;
          return [String(id), { ...metadata, value: encode(value), ...(node === undefined ? {} : { nodeId: node.nodeId }),
            ...(stackFrames === undefined ? {} : { stackFrames: [...stackFrames] }) }];
        }))
      }),
      ...(value.state !== "suspended" || channel.yieldNodeId === undefined ? {} : { yieldNodeId: channel.yieldNodeId }),
      ...(value.state !== "suspended" || origin.expressionStates === undefined ? {} : {
        expressionStates: Object.fromEntries([...origin.expressionStates].map(([id, expression]) => [String(id),
          expression.kind === "binary" ? { kind: "binary", left: encode(expression.left) }
            : expression.kind === "dynamic-import" ? {kind:"dynamic-import",source:encode(expression.source)}
            : expression.kind === "declaration" ? { ...expression }
            : expression.kind === "switch" ? { ...expression, value: encode(expression.value), scope: encode(expression.scope) }
            : expression.kind === "yield-delegate" ? { kind: expression.kind, async: expression.async, value: encode(expression.value), current: encode(expression.current),
              ...(expression.phase === undefined ? {} : {phase: expression.phase}),
              ...(expression.awaitState === undefined ? {} : {awaitState: expression.awaitState}),
              ...(expression.completion === undefined ? {} : {completion: {...expression.completion, value: encode(expression.completion.value)}}),
              iterator: mapIteratorSnapshot("kind" in expression.iterator ? expression.iterator : expression.iterator.snapshot?.() ?? { kind: "unsupported" }, encode) }
            : expression.kind === "pattern-source" ? { kind: "pattern-source", value: encode(expression.value) }
            : expression.kind === "object-pattern" ? { kind: "object-pattern", phase: expression.phase, index: expression.index,
              ...(expression.referenceScope === undefined ? {} : {referenceScope: encode(expression.referenceScope)}),
              ...(expression.referenceUnresolvable === undefined ? {} : {referenceUnresolvable: true as const}),
              ...(expression.privateName === undefined ? {} : { privateName: expression.privateName }),
              excludedKeys: expression.excludedKeys.map(encode), key: encode(expression.key), current: encode(expression.current),
              ...(Object.hasOwn(expression, "referenceObject") ? { referenceObject: encode(expression.referenceObject), referenceKey: encode(expression.referenceKey) } : {}) }
            : expression.kind === "array-pattern" ? { kind: "array-pattern", phase: expression.phase, index: expression.index, done: expression.done, current: encode(expression.current),
              ...(expression.referenceScope === undefined ? {} : {referenceScope: encode(expression.referenceScope)}),
              ...(expression.referenceUnresolvable === undefined ? {} : {referenceUnresolvable: true as const}),
              ...(expression.privateName === undefined ? {} : { privateName: expression.privateName }),
              iterator: mapIteratorSnapshot("kind" in expression.iterator ? expression.iterator : expression.iterator.snapshot?.() ?? { kind: "unsupported" }, encode),
              ...(Object.hasOwn(expression, "referenceObject") ? { referenceObject: encode(expression.referenceObject), referenceKey: encode(expression.referenceKey) } : {}) }
            : expression.kind === "for-of-array" ? { ...expression, values: encode(expression.values), current: encode(expression.current), scope: encode(expression.scope) }
            : expression.kind === "for-of-iterator" ? { kind: expression.kind, phase: expression.phase, async: expression.async, index: expression.index,
              ...(expression.awaitState === undefined ? {} : {awaitState: expression.awaitState}),
              value: encode(expression.value), current: encode(expression.current), scope: encode(expression.scope),
              ...(expression.closeCompletion === undefined ? {} : {closeCompletion: {...expression.closeCompletion, value: encode(expression.closeCompletion.value)}}),
              iterator: mapIteratorSnapshot("kind" in expression.iterator ? expression.iterator : expression.iterator.snapshot?.() ?? { kind: "unsupported" }, encode) }
            : expression.kind === "for-in" ? { ...expression, keys: [...expression.keys], object: encode(expression.object), scope: encode(expression.scope) }
            : expression.kind === "for" ? { kind: "for", phase: expression.phase, loopScope: encode(expression.loopScope), activeScope: encode(expression.activeScope) }
            : expression.kind === "identifier-assignment" ? { kind: "identifier-assignment", current: encode(expression.current),
              ...(expression.referenceKind === undefined ? {} : {referenceKind: expression.referenceKind}),
              ...(expression.referenceScope === undefined ? {} : {referenceScope: encode(expression.referenceScope)}),
              ...(expression.referenceKind !== "object" ? {} : {referenceObject: encode(expression.referenceObject)}) }
            : expression.kind === "member-assignment" ? { kind: "member-assignment", object: encode(expression.object), property: encode(expression.property), current: encode(expression.current),
              ...(expression.privateName === undefined ? {} : { privateName: expression.privateName }),
              ...(Object.hasOwn(expression, "key") ? { key: encode(expression.key) } : {}),
              ...(Object.hasOwn(expression, "superReceiver") ? { superReceiver: encode(expression.superReceiver) } : {}) }
            : expression.kind === "member" ? { kind: "member", object: encode(expression.object),
              ...(Object.hasOwn(expression, "superReceiver") ? { superReceiver: encode(expression.superReceiver) } : {}) }
            : expression.kind === "template" ? { ...expression }
            : expression.kind === "object" ? { kind: "object", value: encode(expression.value), index: expression.index,
              ...(Object.hasOwn(expression, "key") ? { key: encode(expression.key) } : {}) }
            : expression.kind === "array" ? { kind: "array", values: encode(expression.values), index: expression.index }
            : expression.kind === "array-call" ? { kind: "array-call", target: encode(expression.target), method: expression.method, args: encode(expression.args), index: expression.index }
            : { kind: expression.kind, callee: encode(expression.callee), thisValue: encode(expression.thisValue), args: encode(expression.args), index: expression.index }]))
      }),
      sent: channel.sent.map(completion => ({ type: completion.type, value: encode(completion.value) })),
      ...(origin.environment === undefined ? {} : { environment: {
        ...(origin.environment.classInitializer ? {classInitializer: true as const} : {}),
        ...(origin.environment.homeObject === undefined ? {} : { homeObject: encode(origin.environment.homeObject) }),
        ...(origin.environment.newTarget === undefined ? {} : { newTarget: encode(origin.environment.newTarget) }),
        ...(origin.environment.construction === undefined ? {} : {construction: encode(origin.environment.construction)})
      } })
    };
  }
  const origin = getClosureOrigin(value);
  if (origin === undefined) {
    // Host accessors stay on the existing host-exclusion path; only guest
    // accessor identities can be portably represented as descriptors.
    if (Array.isArray(value) && Object.values(Object.getOwnPropertyDescriptors(value)).some(descriptor =>
      !("value" in descriptor) && retainedAccessorClosures(descriptor).length !==
        Number(descriptor.get !== undefined) + Number(descriptor.set !== undefined))) return undefined;
    if (Array.isArray(value) && (!Object.isExtensible(value) || hasExplicitSandboxPrototype(value) ||
        Reflect.ownKeys(value).some(key => {
          const descriptor = Object.getOwnPropertyDescriptor(value, key)!;
          return key === "length" ? descriptor.writable !== true
            : !("value" in descriptor) || !descriptor.enumerable || !descriptor.configurable || !descriptor.writable;
        }))) {
      const templateNode = templateOrigins.get(value);
      const templateNodeId = templateNode?.nodeId;
      const dynamicSource = templateNode === undefined ? undefined : dynamicNodeSources.get(templateNode);
      const templateOwner = templateCookedArrays.get(value);
      return { kind: "guest-array", state: captureObjectState(value, encode)!,
        ...(templateNodeId === undefined ? {} : { templateNodeId }),
        ...(dynamicSource === undefined ? {} : {dynamicSource: encode(dynamicSource)}),
        ...(templateOwner === undefined ? {} : { templateOwner: encode(templateOwner) }) };
    }
    if (isLiveCapability(value) || isSandboxClosure(value) || isSandboxBox(value) || isSandboxDate(value) ||
        isSandboxRegex(value) || isSandboxMap(value) || isSandboxSet(value) || isSandboxPromise(value) ||
        isSandboxGenerator(value) || isSandboxArguments(value) || isSandboxCollectionIterator(value) ||
        isSandboxRegExpIterator(value)) return undefined;
    const prototype = Object.getPrototypeOf(value);
    if ((prototype === null || prototype === Object.prototype) && hasGuestObjectState(value)) {
      const errorType = sandboxErrorTypes.get(value);
      return { kind: "guest-object", state: captureObjectState(value, encode)!,
        ...(errorType === undefined ? {} : { errorType }) };
    }
    return undefined;
  }
  if (origin.node.nodeId === undefined) throw new TypeError("Guest closures require an AST node identity.");
  const state = captureObjectState(value, encode);
  if (state === undefined) throw new TypeError("Guest closures require a property state.");
  return {
    kind: "guest-function", astNodeId: origin.node.nodeId, scope: encode(origin.scope), state,
    ...(dynamicNodeSources.has(origin.node) ? {dynamicSource: encode(dynamicNodeSources.get(origin.node))} : {}),
    ...(isSandboxClosure(value) && value.name !== undefined ? { name: value.name } : {}),
    ...(origin.environment === undefined ? {} : { environment: {
      ...(origin.environment.classInitializer ? {classInitializer: true as const} : {}),
      ...(origin.environment.homeObject === undefined ? {} : { homeObject: encode(origin.environment.homeObject) }),
      ...(origin.environment.newTarget === undefined ? {} : { newTarget: encode(origin.environment.newTarget) }),
      ...(origin.environment.construction === undefined ? {} : {construction: encode(origin.environment.construction)})
    } })
  };
}

function captureObjectState<T>(value: object, encode: (value: unknown) => T): GuestObjectState<T> | undefined {
  let properties: object | undefined = value;
  if (isSandboxRegex(value)) properties = getRegexProperties(value);
  if (isSandboxPromise(value)) properties = getPromiseProperties(value);
  if (isSandboxGenerator(value)) properties = getGeneratorProperties(value);
  if (isSandboxClosure(value)) {
    properties = value.properties;
    if (isGuestClosure(value)) properties = materializeFunctionProperties(value);
  }
  if (properties === undefined) return undefined;
  return {
    properties: serializePropertyDescriptors(properties, encode),
    ...(privateElements.has(value) ? { privateElements: capturePrivateElements(privateElements.get(value)!, encode) } : {}),
    ...(hasExplicitSandboxPrototype(value) ? { prototype: encode(getSandboxPrototype(value)) } : {})
  };
}

export function capturePrivateElements<T>(elements: Map<PrivateName, PrivateElement>, encode: (value: unknown) => T): PrivateElementData<T>[] {
  return [...elements].map(([name, element]) => element.kind === "accessor"
    ? { name: encode(name), kind: "accessor", get: encode(element.get), set: encode(element.set) }
    : { name: encode(name), kind: element.kind, value: encode(element.value) });
}

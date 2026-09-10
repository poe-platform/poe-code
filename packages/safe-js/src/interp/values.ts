import { bindOtelSpan, getBoundOtelSpan } from "../observability/otel.js";
import { scopeDataRoots } from "./scope-data-roots.js";
import { getGeneratorOrigin } from "./closure-origin.js";
import { intrinsicDataRoots } from "./intrinsic-data-roots.js";
import { guestProxyStates } from "./guest-proxy.js";
import { weakReferenceStates } from "./weak-reference.js";
import { finalizationRegistryStates } from "./finalization-registry-state.js";
import { weakCollectionStates } from "./weak-collection.js";
import { hostFunctionMetadata } from "./host-function-metadata.js";
import { NativeSuppressedError } from "../error/native-suppressed-error.js";
import { isSandboxModuleNamespace } from "./module-namespace.js";
import { arrayBufferDataProperties, arrayBufferLength, arrayBufferOptions, copyArrayBufferStorage, isSandboxArrayBuffer } from "./array-buffer.js";
import { isSandboxSharedArrayBuffer, sharedArrayBufferStorage } from "./shared-array-buffer.js";
import { copyDataViewStorage, dataViewBuffer, dataViewDataProperties, dataViewGetters, isSandboxDataView } from "./data-view.js";
import { internalSymbols } from "./internal-symbols.js";
import { getIntrinsicIdentity } from "./intrinsics.js";
import { getGeneratorProperties } from "./generator-properties.js";
import { getRegexProperties, regexGuestProperties } from "./regexp-properties.js";
import { getCollectionProperties, collectionGuestProperties, copyCollectionProperties } from "./collection-properties.js";
export { getCollectionProperties } from "./collection-properties.js";
export { getRegexProperties } from "./regexp-properties.js";
import { retainedAccessorClosures } from "./accessors.js";
import { retainValues } from "./resources.js";
import { errorPrototypes } from "./error-prototypes.js";
import { isSandboxMap, isSandboxSet, sandboxMapBrand, sandboxSetBrand } from "./collection-brands.js";
import { collectionIteratorState, isSandboxCollectionIterator, restoreSandboxCollectionIterator, snapshotCollectionIterator, type SandboxCollectionIterator } from "./collection-iterator.js";
import { arrayIteratorState, isSandboxArrayIterator } from "./array-iterator.js";
import { isSandboxStringIterator, stringIteratorState } from "./string-iterator.js";
import { isSandboxSegmenter, isSandboxSegments, segmenterState, segmentState } from "./intl-segmenter.js";
import { iteratorWrapperStates } from "./iterator-wrapper.js";
import { disposableStackStates } from "./disposable-stack.js";
import { asyncDisposableStackStates } from "./async-disposable-stack.js";
import { iteratorHelperStates } from "./iterator-helper.js";
import { privateElements } from "./private-state.js";
import { regexpIteratorState, isSandboxRegExpIterator, restoreSandboxRegExpIterator, type SandboxRegExpIterator } from "./regexp-iterator.js";
import { copyNativeDate, dateDataProperties, exportDate, isSandboxDate } from "./date.js";
import { isSandboxLocale, localeTag } from "./intl-locale.js";
import { isSandboxCollator, collatorState } from "./intl-collator.js";
import { isSandboxNumberFormat, numberFormatState } from "./intl-numberformat.js";
import { isSandboxDateTimeFormat, dateTimeFormatState } from "./intl-datetimeformat.js";
import { isSandboxListFormat, listFormatState } from "./intl-listformat.js";
import { isSandboxRelativeTimeFormat, relativeTimeFormatState } from "./intl-relativetimeformat.js";
import { isSandboxDisplayNames, displayNamesState } from "./intl-displaynames.js";
import { isSandboxPluralRules, pluralRulesState } from "./intl-pluralrules.js";
import { isSandboxDurationFormat, durationFormatState } from "./intl-durationformat.js";
import { createRawJson, isRawJson } from "./raw-json.js";
import { boxedDataProperties, boxedValue, createSandboxBox, isSandboxBox, nativeBoxedValue } from "./boxed.js";
import { getHostObjectKeys, getHostObjectMember, hasHostObjectMember, measureHostObjectData, isGuestHostObject, isLiveCapability } from "./host-capabilities.js";
import type { Budget, CompileTicket } from "./budget.js";
import { types as nodeTypes } from "node:util";
import { CompileScope, RegexCompileGuard, regexCompiledData } from "./regex/compile-guard.js";
import {
  type NumericTypedArray,
  copyTypedArrayStorage,
  typedArrayDataProperties,
  typedArrayProperties,
  typedArrayStorage,
  isNumericTypedArray
} from "./typed-array.js";
import type { GeneratorChannel } from "./generator.js";
import { SandboxError } from "./budget.js";
import { observeSandboxPromise, trackSandboxPromise } from "./promise-tracker.js";
import { promiseStates } from "./promise-state.js";
import { promiseContinuations, promiseReactionResults, promiseProducers } from "./promise-continuations.js";
import { atomicWaitStates } from "./atomic-wait-state.js";
import { asyncGeneratorDrivers, asyncGeneratorRequestOwners } from "./async-generator-driver.js";
import { promiseReplayContext } from "./promise-replay.js";
import {
  invokeCancelableClosure,
  readPromiseCancellation,
  registerPromiseCancellation
} from "./cancel.js";
import { parseRegex, type RegexPattern } from "./regex/parse.js";
import { assertSandboxDataDepth } from "../graph-depth.js";
import { sandboxErrorTypes } from "../error/shape.js";
import { getGuestFunctionProperties, materializeFunctionProperties, getSandboxPropertyDescriptor, getSandboxPrototype, hasExplicitSandboxPrototype, hasGuestObjectState, hasManagedDescriptors, hasNullObjectPrototype, intrinsicFunctionDataDescriptors, isIntrinsicFunction, isTrackedIntrinsicObject, registerGuestClosure, setSandboxPrototype } from "./object-model.js";
import type { FunctionSource } from "../parse/function-source.js";
import { dynamicSourceRecords, dynamicValueSources, type DynamicSource } from "../parse/function-source.js";
import {
  copySandboxArgumentProperties,
  createSandboxArguments,
  getSandboxArgumentEntries,
  mappedArgumentStates,
  unrestrictedArgumentObjects,
  isSandboxArguments
} from "./arguments.js";

export { createSandboxArguments, isSandboxArguments } from "./arguments.js";
export { isSandboxMap, isSandboxSet } from "./collection-brands.js";

const sandboxClosureBrand = Symbol("SandboxClosure");
const sandboxGeneratorBrand = Symbol("SandboxGenerator");
const sandboxPromiseBrand = Symbol("SandboxPromise");
const sandboxRegexBrand = Symbol("SandboxRegex");
const sandboxRegexPattern = Symbol("SandboxRegexPattern");
const sandboxRetainedValues = Symbol("SandboxRetainedValues");
for (const marker of [sandboxClosureBrand, sandboxGeneratorBrand, sandboxPromiseBrand, sandboxRegexBrand, sandboxRegexPattern, sandboxRetainedValues]) internalSymbols.add(marker);

export type SandboxPrimitive = string | number | bigint | boolean | symbol | null | undefined;

export type SandboxValue =
  | SandboxPrimitive
  | Date
  | NumericTypedArray
  | ArrayBuffer
  | SharedArrayBuffer
  | DataView<ArrayBufferLike>
  | SandboxObject
  | SandboxArray
  | SandboxClosure
  | SandboxGenerator
  | SandboxCollectionIterator
  | SandboxRegExpIterator
  | SandboxMap
  | SandboxSet
  | SandboxPromise
  | SandboxRegex;

export type SandboxObject = {
  [key: string]: SandboxValue;
  [key: symbol]: SandboxValue;
};

export type SandboxArray = SandboxValue[];

export type SandboxMap = {
  readonly kind: "map";
  readonly entries: Map<SandboxValue, SandboxValue>;
  readonly [sandboxMapBrand]: true;
};

export type SandboxSet = {
  readonly kind: "set";
  readonly values: Set<SandboxValue>;
  readonly [sandboxSetBrand]: true;
};

export type SandboxRegex = {
  readonly kind: "regex";
  readonly source: string;
  readonly flags: string;
  lastIndex: SandboxValue;
  readonly [sandboxRegexBrand]: true;
  readonly [sandboxRegexPattern]: RegexPattern;
};

export type SandboxCallContext = {
  readonly evaluateEval?: (source: string, intrinsic?: SandboxClosure) => Promise<SandboxValue>;
  readonly createDynamicFunction?: (kind: import("../parse/parser.js").DynamicFunctionKind, parameters: string, body: string, intrinsic?: SandboxClosure) => SandboxClosure;
  readonly newTarget?: SandboxClosure;
  readonly compilation?: CompileScope;
  readonly span?: {
    readonly end: {
      readonly column: number;
      readonly line: number;
      readonly offset: number;
    };
    readonly start: {
      readonly column: number;
      readonly line: number;
      readonly offset: number;
    };
  };
  readonly stack: readonly string[];
  readonly thisValue: SandboxValue;
  readonly getProperty?: (value: SandboxValue, property: PropertyKey) => SandboxValue | Promise<SandboxValue>;
  readonly reconcileData?: (value: SandboxValue) => void;
  readonly invokeClosure?: (
    closure: SandboxClosure,
    args: readonly SandboxValue[],
    thisValue: SandboxValue,
    construct?: boolean,
    newTarget?: SandboxClosure
  ) => Promise<SandboxValue>;
};

export type SandboxClosure = {
  readonly sourceRange?: FunctionSource;
  readonly async?: true;
  readonly generator?: true;
  readonly sandbox?: true;
  readonly boundTarget?: SandboxClosure;
  readonly cancellationSignal?: AbortSignal;
  readonly kind: "fn";
  readonly length?: number;
  readonly name?: string;
  readonly properties?: SandboxObject;
  readonly call: (
    args: readonly SandboxValue[],
    context?: SandboxCallContext
  ) => SandboxValue | Promise<SandboxValue>;
  readonly construct?: (
    args: readonly SandboxValue[],
    context?: SandboxCallContext
  ) => SandboxValue | Promise<SandboxValue>;
  readonly [sandboxClosureBrand]: true;
  readonly [sandboxRetainedValues]?: () => Iterable<SandboxValue>;
};

export type SandboxPromise = {
  readonly kind: "promise";
  readonly synchronousPrefix?: Promise<void>;
  readonly promise: Promise<SandboxValue>;
  readonly hostCall?: import("./host-call.js").HostCallRecord;
  readonly hostCallJournal?: import("./host-call.js").HostCallJournal;
  readonly span?: SandboxCallContext["span"];
  readonly [sandboxPromiseBrand]: true;
};

const promiseProperties = new WeakMap<SandboxPromise, SandboxObject>();

export function getPromiseProperties(value: SandboxPromise): SandboxObject {
  let properties = promiseProperties.get(value);
  if (properties === undefined) {
    properties = Object.create(null) as SandboxObject;
    promiseProperties.set(value, properties);
  }
  return properties;
}

export type SandboxGenerator = {
  readonly kind: "generator";
  readonly async?: boolean;
  state: "start" | "running" | "suspended" | "done";
  readonly channel: GeneratorChannel;
  readonly astNodeId?: number;
  readonly capturedScopeId?: number | string;
  readonly [sandboxGeneratorBrand]: true;
};

type CopyFromSandboxOptions = {
  wrapClosure?: (value: SandboxClosure) => unknown;
  unwrapHostObject?: (value: SandboxObject) => unknown;
  compilation?: CompileScope;
};

type CopyState<TValue> = {
  float32Buffers?: WeakMap<ArrayBufferLike, ArrayBufferLike>;
  sharedBufferSnapshots?: WeakMap<object, SharedArrayBuffer>;
  seen: WeakMap<object, TValue>;
  initializeIterators?: Array<() => void>;
  compilation?: CompileScope;
  resetRegexLastIndex?: boolean;
  structuredClone?: boolean;
};

export function createSandboxClosure(input: {
  sourceRange?: FunctionSource;
  guest?: boolean;
  async?: boolean;
  generator?: boolean;
  sandbox?: boolean;
  boundTarget?: SandboxClosure;
  cancellationSignal?: AbortSignal;
  call: (
    args: readonly SandboxValue[],
    context?: SandboxCallContext
  ) => SandboxValue | Promise<SandboxValue>;
  construct?: (
    args: readonly SandboxValue[],
    context?: SandboxCallContext
  ) => SandboxValue | Promise<SandboxValue>;
  name?: string;
  length?: number;
  properties?: SandboxObject | ((closure: SandboxClosure) => SandboxObject);
  retainedValues?: () => Iterable<SandboxValue>;
}): SandboxClosure {
  const closure = {
    kind: "fn" as const,
    call: (args: readonly SandboxValue[], context?: SandboxCallContext) =>
      invokeCancelableClosure(closure, input.call, args, context),
    name: input.name,
    ...(input.construct === undefined
      ? {}
      : {
          construct: (args: readonly SandboxValue[], context?: SandboxCallContext) =>
            invokeCancelableClosure(closure, input.construct!, args, context, true)
        }),
    ...(input.async === true ? { async: true as const } : {})
  } as SandboxClosure;

  Object.defineProperty(closure, sandboxClosureBrand, {
    enumerable: false,
    value: true
  });

  if (input.sourceRange !== undefined) {
    Object.defineProperty(closure, "sourceRange", { value: input.sourceRange });
  }

  if (input.sandbox === true) {
    Object.defineProperty(closure, "sandbox", { value: true });
  }
  if (input.generator === true) Object.defineProperty(closure, "generator", { value: true });

  if (input.length !== undefined) {
    Object.defineProperty(closure, "length", { value: input.length });
  }

  if (input.boundTarget !== undefined) {
    Object.defineProperty(closure, "boundTarget", { value: input.boundTarget });
  }

  if (input.cancellationSignal !== undefined) {
    Object.defineProperty(closure, "cancellationSignal", {
      value: input.cancellationSignal
    });
  }

  if (input.guest === true) registerGuestClosure(closure);
  Object.defineProperty(closure, "properties", {
    get: () => getGuestFunctionProperties(closure)
  });
  if (input.guest !== true && input.properties !== undefined) {
    const properties = typeof input.properties === "function" ? input.properties(closure) : input.properties;
    const target = materializeFunctionProperties(closure, properties);
    if (!Object.isExtensible(properties)) Object.preventExtensions(target);
  }

  if (input.retainedValues !== undefined) {
    Object.defineProperty(closure, sandboxRetainedValues, {
      value: input.retainedValues
    });
  }

  return Object.freeze(closure);
}

export function ownEnumerableSandboxEntries(
  value: SandboxValue,
  excludedKeys?: ReadonlySet<string>
): Array<[string, SandboxValue]> {
  if (isGuestHostObject(value)) {
    const entries: Array<[string, SandboxValue]> = [];
    for (const key of getHostObjectKeys(value)) {
      if (excludedKeys?.has(key)) continue;
      if (hasHostObjectMember(value, key, true)) entries.push([key, getHostObjectMember(value, key)]);
    }
    return entries;
  }
  if (value === null || value === undefined) throw new TypeError("Cannot convert undefined or null to object.");
  let entries: Array<[string, SandboxValue]>;
  if (isSandboxClosure(value)) entries = Object.entries(value.properties ?? {});
  else if (isSandboxRegex(value)) entries = Object.entries(getRegexProperties(value));
  else if (isSandboxPromise(value)) entries = Object.entries(getPromiseProperties(value));
  else if (isSandboxGenerator(value)) entries = Object.entries(getGeneratorProperties(value));
  else if (isSandboxMap(value) || isSandboxSet(value)) entries = Object.entries(getCollectionProperties(value));
  else entries = Object.entries(Object(value)) as Array<[string, SandboxValue]>;
  return excludedKeys === undefined ? entries : entries.filter(([key]) => !excludedKeys.has(key));
}

export function ownSandboxSymbolKeys(value: SandboxValue): symbol[] {
  if (value === null || value === undefined) throw new TypeError("Cannot convert undefined or null to object.");
  if (isGuestHostObject(value)) return [];
  if (isSandboxClosure(value)) value = value.properties ?? {};
  else if (isSandboxRegex(value)) value = getRegexProperties(value);
  else if (isSandboxPromise(value)) value = getPromiseProperties(value);
  else if (isSandboxGenerator(value)) value = getGeneratorProperties(value);
  else if (isSandboxMap(value) || isSandboxSet(value)) value = getCollectionProperties(value);
  return Object.getOwnPropertySymbols(Object(value)).filter(key => !internalSymbols.has(key));
}

export function ownEnumerableSandboxKeys(value: SandboxValue): string[];
export function ownEnumerableSandboxKeys(value: SandboxValue, includeSymbols: true): PropertyKey[];
export function ownEnumerableSandboxKeys(value: SandboxValue, includeSymbols = false): PropertyKey[] {
  if (includeSymbols) {
    const properties = isSandboxClosure(value) ? value.properties ?? {} : isSandboxGenerator(value) ? getGeneratorProperties(value) : isSandboxPromise(value) ? getPromiseProperties(value) : isSandboxRegex(value) ? getRegexProperties(value)
      : isSandboxMap(value) || isSandboxSet(value) ? getCollectionProperties(value) : Object(value);
    return [...ownEnumerableSandboxKeys(value), ...ownSandboxSymbolKeys(value).filter(key =>
      Object.getOwnPropertyDescriptor(properties, key)?.enumerable === true)];
  }
  if (isGuestHostObject(value)) return getHostObjectKeys(value);
  if (value === null || value === undefined) throw new TypeError("Cannot convert undefined or null to object.");
  if (isSandboxClosure(value)) return Object.keys(value.properties ?? {});
  if (isSandboxPromise(value)) return Object.keys(getPromiseProperties(value));
  if (isSandboxGenerator(value)) return Object.keys(getGeneratorProperties(value));
  if (isSandboxRegex(value)) return Object.keys(getRegexProperties(value));
  if (isSandboxMap(value) || isSandboxSet(value)) return Object.keys(getCollectionProperties(value));
  return Object.keys(Object(value));
}

export function createSandboxPromise(
  promise: Promise<SandboxValue>,
  metadata: {
    trackReplay?: boolean;
    synchronousPrefix?: Promise<void>;
    hostCall?: import("./host-call.js").HostCallRecord;
    hostCallJournal?: import("./host-call.js").HostCallJournal;
    replaySettlement?: (value:SandboxValue)=>SandboxValue;
    span?: SandboxCallContext["span"];
  } = {}
): SandboxPromise {
  const original =
    metadata.trackReplay === false
      ? promise
      : (promiseReplayContext.getStore()?.track(promise,metadata.replaySettlement) ??
        (metadata.replaySettlement===undefined?promise:promise.then(metadata.replaySettlement,
          reason=>{throw metadata.replaySettlement!(reason);} )));
  const sandboxPromise = {
    kind: "promise" as const,
    get promise() {
      return readPromiseCancellation(sandboxPromise, original);
    }
  } as SandboxPromise;

  Object.defineProperty(sandboxPromise, sandboxPromiseBrand, {
    enumerable: false,
    value: true
  });

  Object.defineProperty(sandboxPromise, Symbol.toStringTag, { value: "Promise" });

  if (metadata.span !== undefined) {
    Object.defineProperty(sandboxPromise, "span", {
      value: metadata.span
    });
  }

  if (metadata.synchronousPrefix !== undefined) {
    Object.defineProperty(sandboxPromise, "synchronousPrefix", {
      value: metadata.synchronousPrefix
    });
  }

  if (metadata.hostCall !== undefined) {
    Object.defineProperty(sandboxPromise, "hostCall", { value: metadata.hostCall });
  }
  if (metadata.hostCallJournal !== undefined) {
    Object.defineProperty(sandboxPromise, "hostCallJournal", {
      value: metadata.hostCallJournal
    });
  }

  promiseStates.set(sandboxPromise, {status: "pending"});
  original.then(
    value => { promiseStates.set(sandboxPromise, {status: "fulfilled", value}); },
    value => { promiseStates.set(sandboxPromise, {status: "rejected", value}); }
  );
  trackSandboxPromise(sandboxPromise);
  registerPromiseCancellation(sandboxPromise);

  return Object.freeze(sandboxPromise);
}

export function createSandboxGenerator(
  channel: GeneratorChannel,
  metadata: { astNodeId?: number; capturedScopeId?: number | string; async?: boolean } | undefined = undefined
): SandboxGenerator {
  const generator = {
    kind: "generator" as const,
    state: "start" as const,
    channel,
    ...metadata
  } as SandboxGenerator;

  Object.defineProperty(generator, sandboxGeneratorBrand, {
    enumerable: false,
    value: true
  });

  getGeneratorProperties(generator);

  return generator;
}

export function createSandboxMap(
  entries: Iterable<readonly [SandboxValue, SandboxValue]> = []
): SandboxMap {
  const map = {} as SandboxMap;
  collectionGuestProperties.set(map, Object.create(null) as SandboxObject);

  Object.defineProperties(map, {
    kind: {
      value: "map"
    },
    entries: {
      value: new Map(entries)
    }
  });

  Object.defineProperty(map, sandboxMapBrand, {
    enumerable: false,
    value: true
  });

  return Object.freeze(map);
}

export function createSandboxSet(values: Iterable<SandboxValue> = []): SandboxSet {
  const set = {} as SandboxSet;
  collectionGuestProperties.set(set, Object.create(null) as SandboxObject);

  Object.defineProperties(set, {
    kind: {
      value: "set"
    },
    values: {
      value: new Set(values)
    }
  });

  Object.defineProperty(set, sandboxSetBrand, {
    enumerable: false,
    value: true
  });

  return Object.freeze(set);
}

export function createSandboxRegex(
  source: string,
  flags = "",
  lastIndex: SandboxValue = 0,
  compilation?: CompileScope
): SandboxRegex {
  if (typeof source !== "string" || typeof flags !== "string") {
    throw new TypeError(
      "Invalid sandbox RegExp source or flags: expected own string data properties."
    );
  }
  const pattern = parseRegex(source, flags, compilation, 7 + source.length + flags.length);
  const regex = { kind: "regex", source, flags, lastIndex } as SandboxRegex;
  const storage = Object.create(null) as SandboxObject;
  Object.defineProperty(storage, "lastIndex", { value: lastIndex, writable: true });
  const syncCursor = () => {
    const descriptor = Object.getOwnPropertyDescriptor(regex, "lastIndex")!;
    Object.defineProperty(storage, "lastIndex", { value: descriptor.value, writable: descriptor.writable });
  };
  const properties = new Proxy(storage, {
    get: (target, key, receiver) => key === "lastIndex" ? regex.lastIndex : Reflect.get(target, key, receiver),
    set: (target, key, value, receiver) => key === "lastIndex"
      ? Reflect.set(regex, key, value) : Reflect.set(target, key, value, receiver),
    getOwnPropertyDescriptor(target, key) {
      if (key === "lastIndex") syncCursor();
      return Object.getOwnPropertyDescriptor(target, key);
    },
    defineProperty(target, key, descriptor) {
      if (key !== "lastIndex") return Reflect.defineProperty(target, key, descriptor);
      syncCursor();
      if (!Reflect.defineProperty(target, key, descriptor)) return false;
      const cursor = Object.getOwnPropertyDescriptor(target, key)!;
      return Reflect.defineProperty(regex, key, { value: cursor.value, writable: cursor.writable });
    }
  });
  regexGuestProperties.set(regex, properties);
  Object.defineProperties(regex, {
    [sandboxRegexBrand]: { value: true },
    [sandboxRegexPattern]: { value: pattern, writable: true }
  });
  return Object.seal(regex);
}

export function getSandboxRegexPattern(regex: SandboxRegex): RegexPattern {
  return regex[sandboxRegexPattern];
}

export function recompileSandboxRegex(regex: SandboxRegex, source: string, flags: string, compilation: CompileScope): void {
  const pattern = parseRegex(source, flags, compilation, 7 + source.length + flags.length);
  Object.defineProperties(regex, {
    source: { value: source },
    flags: { value: flags },
    [sandboxRegexPattern]: { value: pattern }
  });
  // RegExpInitialize installs the new matcher before its throwing lastIndex Set.
  regex.lastIndex = 0;
}

export function isSandboxClosure(value: unknown): value is SandboxClosure {
  return typeof value === "object" && value !== null && sandboxClosureBrand in value;
}

export function isSandboxPromise(value: unknown): value is SandboxPromise {
  return typeof value === "object" && value !== null && sandboxPromiseBrand in value;
}

export function isSandboxGenerator(value: unknown): value is SandboxGenerator {
  return typeof value === "object" && value !== null && sandboxGeneratorBrand in value;
}

export function isSandboxRegex(value: unknown): value is SandboxRegex {
  return typeof value === "object" && value !== null && sandboxRegexBrand in value;
}

export function deepCopyToSandbox(value: unknown): SandboxValue {
  return copyToSandbox(value, {
    seen: new WeakMap()
  });
}

export function cloneSandboxValue(value: SandboxValue, options: { compilation?: CompileScope; resetRegexLastIndex?: boolean; structuredClone?: boolean; float32Buffers?: WeakMap<ArrayBufferLike, ArrayBufferLike>; sharedBufferSnapshots?: WeakMap<object, SharedArrayBuffer> } = {}): SandboxValue {
  const initializeIterators: Array<() => void> = [];
  const copy = copyToSandbox(
    value,
    {
      seen: new WeakMap(),
      initializeIterators,
      ...options
    },
    "<root>",
    true
  );
  for (const initialize of initializeIterators) initialize();
  return copy;
}

export function allocateProducedSandboxValue(value: SandboxValue, budget: Budget): SandboxValue {
  allocateSandboxValue(value, budget, new WeakSet());
  return value;
}

export type StructuredCloneRequest = { descriptor: PropertyDescriptor; receiver: SandboxValue } | { stringValue: SandboxValue };
const structuredCloneErrorNames = ["Error", "EvalError", "RangeError", "ReferenceError", "SyntaxError", "TypeError", "URIError"] as const;

/** Serialization pauses for guest reads/coercion; ordinary data stays synchronous. */
export function* cloneStructuredGraph(
  value: SandboxValue, state: CopyState<SandboxValue>, budget: Budget, depth = 0
): Generator<StructuredCloneRequest, SandboxValue, SandboxValue> {
  assertSandboxDataDepth(depth);
  budget.visitNode();
  if (typeof value === "object" && value !== null && guestProxyStates.has(value))
    throw new DOMException("Proxies cannot be structured cloned.", "DataCloneError");
  if (typeof value === "symbol" || isSandboxModuleNamespace(value) || isSandboxClosure(value) || isSandboxPromise(value) ||
      isSandboxGenerator(value) || isSandboxCollectionIterator(value) || isSandboxRegExpIterator(value) ||
      isSandboxArrayIterator(value) || isSandboxStringIterator(value) || isSandboxArguments(value) ||
      isSandboxSegmenter(value) || isSandboxSegments(value) || isSandboxLocale(value) ||
      isSandboxCollator(value) || isSandboxDateTimeFormat(value) || isSandboxDisplayNames(value) ||
      isSandboxDurationFormat(value) || isSandboxListFormat(value) || isSandboxNumberFormat(value) || isSandboxPluralRules(value) || isSandboxRelativeTimeFormat(value))
    throw new DOMException("Value cannot be structured cloned.", "DataCloneError");
  if (typeof value !== "object" || value === null) return allocateProducedSandboxValue(value, budget);
  if (iteratorHelperStates.has(value) || iteratorWrapperStates.has(value))
    throw new DOMException("Iterator objects cannot be structured cloned.", "DataCloneError");
  if (disposableStackStates.has(value) || asyncDisposableStackStates.has(value))
    throw new DOMException("Disposable stacks cannot be structured cloned.", "DataCloneError");
  if (isLiveCapability(value)) throw new DOMException("Capabilities cannot be structured cloned.", "DataCloneError");
  const existing = state.seen.get(value);
  if (existing !== undefined) return existing;
  const map = isSandboxMap(value);
  const set = isSandboxSet(value);
  const array = isPlainArray(value);
  const plain = isPlainObject(value) && !isSandboxRegex(value) && !isRawJson(value) && nativeBoxedValue(value) === undefined;
  if (!map && !set && !array && !plain) {
    const copy = copyToSandbox(value, state, "<root>", true, depth);
    allocateProducedSandboxValue(copy, budget);
    return copy;
  }
  if (array) budget.allocateArrayLength(value.length);
  budget.provisionDataUsage(1)();
  const copy = map ? createSandboxMap() : set ? createSandboxSet() : array ? new Array(value.length) as SandboxArray : createPlainObject(Object.getPrototypeOf(value) === null);
  state.seen.set(value, copy);
  const errorType = sandboxErrorTypes.get(value);
  let pending: unknown;
  let current: SandboxValue;
  const release = retainValues(budget, () => [value, copy, pending, current]);
  try {
    if (errorType !== undefined) {
      const nameDescriptor = getSandboxPropertyDescriptor(value, "name", budget);
      current = nameDescriptor === undefined ? undefined : "value" in nameDescriptor ? nameDescriptor.value : yield {descriptor:nameDescriptor,receiver:value};
      const name = structuredCloneErrorNames.find(name => name === current) ?? "Error";
      const prototype = errorPrototypes.get(budget)?.get(name);
      if (prototype !== undefined) setSandboxPrototype(copy, prototype, budget);
      sandboxErrorTypes.set(copy, name);
      const message = Object.getOwnPropertyDescriptor(value, "message");
      if (message !== undefined && "value" in message) {
        current = message.value;
        current = yield {stringValue:current};
        Object.defineProperty(copy, "message", {value:current,writable:true,configurable:true});
      }
      const stack = Object.getOwnPropertyDescriptor(value, "stack");
      if (stack !== undefined && "value" in stack && typeof stack.value === "string")
        Object.defineProperty(copy, "stack", {value:budget.allocateString(stack.value),writable:true,configurable:true});
      const cause = Object.getOwnPropertyDescriptor(value, "cause");
      if (cause !== undefined && "value" in cause) {
        current = cause.value;
        Object.defineProperty(copy, "cause", {value:yield* cloneStructuredGraph(current,state,budget,depth+1),writable:true,configurable:true});
      }
    } else if (map && isSandboxMap(copy)) {
      budget.allocateArrayLength(value.entries.size);
      budget.provisionDataUsage(value.entries.size * 3 + 1)();
      const entries = [...value.entries];
      pending = entries;
      for (const [key, entry] of entries) {
        current = yield* cloneStructuredGraph(key, state, budget, depth + 1);
        copy.entries.set(current, yield* cloneStructuredGraph(entry, state, budget, depth + 1));
      }
    } else if (set && isSandboxSet(copy)) {
      budget.allocateArrayLength(value.values.size);
      budget.provisionDataUsage(value.values.size + 1)();
      const entries = [...value.values];
      pending = entries;
      for (const entry of entries) copy.values.add(yield* cloneStructuredGraph(entry, state, budget, depth + 1));
    } else {
      const keys = Object.keys(value);
      budget.allocateArrayLength(keys.length);
      budget.provisionDataUsage(keys.length + 1)();
      pending = keys;
      for (const key of keys) {
        const descriptor = Object.getOwnPropertyDescriptor(value, key);
        if (descriptor === undefined) continue;
        current = "value" in descriptor ? descriptor.value : yield { descriptor, receiver: value };
        defineOwnDataProperty(copy, key, yield* cloneStructuredGraph(current, state, budget, depth + 1));
      }
    }
    return copy;
  } finally { release(); }
}

export function measureSandboxData(
  values: Iterable<unknown>,
  options: {
    ignoreClosures?: boolean;
    ignoreClosureCaptures?: boolean;
    compileTickets?: Set<CompileTicket>;
  } = {}
): number {
  const seen = new WeakSet<object>();
  const seenSymbols = new Set<symbol>();
  let usage = 0;
  const projectedPrimitives: Array<{ target: object; values: readonly unknown[]; depth: number }> = [];

  const visit = (value: unknown, depth = 0): void => {
    if (typeof value === "bigint") {
      usage += value.toString(16).length;
      return;
    }
    if (typeof value === "symbol") {
      if (!seenSymbols.has(value)) {
        seenSymbols.add(value);
        usage += 1 + (value.description?.length ?? 0);
      }
      return;
    }
    if (typeof value === "string") {
      usage += value.length;
      return;
    }
    if (typeof value !== "object" || value === null) return;
    if (seen.has(value)) return;
    const intrinsicRoot = intrinsicDataRoots.get(value);
    if (intrinsicRoot !== undefined) {
      seen.add(value);
      if (seen.has(intrinsicRoot.target)) return;
      projectedPrimitives.push({ ...intrinsicRoot, depth });
      // Traverse references now, so another projection can expose an owner
      // before its otherwise duplicated primitive property data is charged.
      for (const item of intrinsicRoot.values)
        if ((typeof item === "object" && item !== null) || typeof item === "symbol") visit(item, depth);
      return;
    }
    const bindingRoot = scopeDataRoots.get(value);
    if (bindingRoot !== undefined) {
      seen.add(value);
      if ("value" in bindingRoot) visit(bindingRoot.value, depth);
      else for (const entry of bindingRoot.values) visit(entry, depth);
      return;
    }
    assertSandboxDataDepth(depth);
    seen.add(value);

    usage += 1;
    const proxyState = guestProxyStates.get(value);
    if (proxyState !== undefined) {
      if (proxyState.target !== null) visit(proxyState.target, depth + 1);
      if (proxyState.handler !== null) visit(proxyState.handler, depth + 1);
      return;
    }
    if (dynamicSourceRecords.has(value)) {
      const source = value as DynamicSource;
      usage += source.body.length + source.nodes.size + (source.kind === "eval"
        ? 6 + source.context.privateNames.reduce((total, name) => total + name.length + 1, 0)
        : source.parameters.length);
      return;
    }
    const dynamicSource = dynamicValueSources.get(value);
    if (dynamicSource !== undefined) visit(dynamicSource, depth + 1);
    const disposableResources = disposableStackStates.get(value)?.resources.map(resource =>
      [resource.method, resource.receiver, ...resource.args]);
    const asyncDisposableResources = asyncDisposableStackStates.get(value)?.resources.map(resource =>
      [resource.method, resource.receiver, ...resource.args]);
    const arrayLength = Array.isArray(value) ? value.length : undefined;
    const managedArray = arrayLength !== undefined && hasManagedDescriptors(value);
    let arrayDescriptors: Array<readonly [string, PropertyDescriptor]> | undefined;
    let arrayElements: unknown[] | undefined;
    if (arrayLength !== undefined) {
      if (managedArray) arrayDescriptors = [];
      else arrayElements = [];
      if (!managedArray && nodeTypes.isProxy(value)) {
        // ownKeys traps can omit indices that descriptor lookup still exposes.
        for (let index = 0; index < arrayLength; index += 1) {
          const descriptor = Object.getOwnPropertyDescriptor(value, index);
          if (descriptor !== undefined && "value" in descriptor) arrayElements!.push(descriptor.value);
        }
      } else {
        let keys = managedArray ? Object.getOwnPropertyNames(value) : Object.keys(value);
        // Native index keys are unique and ascending. An index equal to
        // length - 1 at that ordinal proves every index is enumerable and own.
        const denseIndices = !managedArray &&
          (arrayLength === 0 || keys[arrayLength - 1] === String(arrayLength - 1));
        if (!managedArray && !denseIndices) keys = Object.getOwnPropertyNames(value);
        const keyCount = denseIndices ? arrayLength : keys.length;
        for (let index = 0; index < keyCount; index += 1) {
          const key = keys[index]!;
          // Native array indices precede length, its first non-index own key.
          // Proxy arrays use index lookup above; managed arrays retain all keys.
          if (key === "length") {
            if (!managedArray) break;
            continue;
          }
          const descriptor = Object.getOwnPropertyDescriptor(value, key);
          if (descriptor !== undefined) {
            if (arrayDescriptors !== undefined) arrayDescriptors.push([key, descriptor]);
            else if ("value" in descriptor && typeof descriptor.value !== "number") arrayElements!.push(descriptor.value);
          }
        }
      }
    }
    const privateSlots = privateElements.get(value);
    if (privateSlots !== undefined) {
      for (const [name, element] of privateSlots) {
        visit(name, depth + 1);
        if (element.kind === "accessor") {
          visit(element.get, depth + 1);
          visit(element.set, depth + 1);
        } else visit(element.value, depth + 1);
      }
    }
    if (!isGuestHostObject(value)) {
      const symbols = Object.getOwnPropertySymbols(value);
      const descriptors = symbols.length === 0 ? [] : symbols
        .filter(key => !internalSymbols.has(key))
        .map(key => [key, Object.getOwnPropertyDescriptor(value, key)!] as const);
      for (const [key, descriptor] of descriptors) {
        usage += 1;
        visit(key, depth + 1);
        if ("value" in descriptor) visit(descriptor.value, depth + 1);
        else for (const closure of retainedAccessorClosures(descriptor)) visit(closure, depth + 1);
      }
    }
    if (isSandboxClosure(value)) {
      const prototype = getSandboxPrototype(value);
      if (prototype !== null) visit(prototype, depth + 1);
      if (options.ignoreClosures) return;
      if (value.properties !== undefined) {
        if (isIntrinsicFunction(value)) {
          for (const [key, descriptor] of intrinsicFunctionDataDescriptors(value.properties)) {
            usage += key.length + 1;
            if ("value" in descriptor) visit(descriptor.value, depth + 1);
            else for (const closure of retainedAccessorClosures(descriptor)) visit(closure, depth + 1);
          }
        } else visit(value.properties, depth + 1);
      }
      if (!options.ignoreClosureCaptures)
        for (const retained of value[sandboxRetainedValues]?.() ?? []) visit(retained, depth + 1);
      return;
    }
    if (isSandboxBox(value)) {
      const primitive = boxedValue(value);
      if (typeof primitive === "symbol") visit(primitive, depth + 1);
      else usage += typeof primitive === "string" ? primitive.length : 8;
      const prototype = getSandboxPrototype(value);
      if (prototype !== null) visit(prototype, depth + 1);
      for (const [key, descriptor] of boxedDataProperties(value)) {
        usage += key.length + 1;
        if ("value" in descriptor) visit(descriptor.value, depth + 1);
        else for (const closure of retainedAccessorClosures(descriptor)) visit(closure, depth + 1);
      }
      return;
    }
    const wrapperState = iteratorWrapperStates.get(value);
    if (disposableResources !== undefined) {
      usage += disposableResources.length;
      for (const resource of disposableResources) for (const retained of resource) visit(retained, depth + 1);
    }
    if (asyncDisposableResources !== undefined) {
      usage += asyncDisposableResources.length;
      for (const resource of asyncDisposableResources) for (const retained of resource) visit(retained, depth + 1);
    }
    if (wrapperState !== undefined) {
      visit(wrapperState.iterator, depth + 1);
      visit(wrapperState.next, depth + 1);
    }
    const helperState = iteratorHelperStates.get(value);
    if (helperState !== undefined) {
      if (helperState.joint !== undefined) {
        for (const record of helperState.joint.cursors) {
          usage += 1;
          if (record !== null) {
            visit(record.iterator, depth + 1);
            visit(record.next, depth + 1);
          }
        }
        visit(helperState.joint.padding, depth + 1);
        visit(helperState.joint.arrayPrototype, depth + 1);
        if (helperState.joint.keys !== undefined) visit(helperState.joint.keys, depth + 1);
      }
      for (const input of helperState.iterables ?? []) {
        usage += 1;
        visit(input.iterable, depth + 1);
        visit(input.open, depth + 1);
      }
      for (const record of [helperState.outer, helperState.inner]) {
        if (record !== undefined) {
          visit(record.iterator, depth + 1);
          visit(record.next, depth + 1);
        }
      }
      visit(helperState.callback, depth + 1);
    }
    if (isSandboxDate(value)) usage += 8;
    if (isSandboxLocale(value)) usage += localeTag(value).length;
    if (isSandboxListFormat(value)) visit(listFormatState(value).options, depth + 1);
    if (isSandboxRelativeTimeFormat(value)) visit(relativeTimeFormatState(value).options, depth + 1);
    if (isSandboxDisplayNames(value)) visit(displayNamesState(value).options, depth + 1);
    if (isSandboxPluralRules(value)) visit(pluralRulesState(value).options, depth + 1);
    if (isSandboxDurationFormat(value)) {
      const state = durationFormatState(value);
      visit(state.settings, depth + 1);
      visit(state.options, depth + 1);
    }
    if (isSandboxNumberFormat(value)) {
      const state = numberFormatState(value);
      visit(state.options, depth + 1);
      visit(state.format, depth + 1);
    }
    if (isSandboxDateTimeFormat(value)) {
      const state = dateTimeFormatState(value);
      visit(state.options, depth + 1);
      visit(state.format, depth + 1);
    }
    if (isSandboxCollator(value)) {
      const state = collatorState(value);
      visit(state.options, depth + 1);
      visit(state.compare, depth + 1);
    }
    if (isGuestHostObject(value)) {
      usage += measureHostObjectData(value);
      return;
    }
    const prototype = getSandboxPrototype(value);
    if (prototype !== null) visit(prototype, depth + 1);
    if (isSandboxArrayBuffer(value)) usage += arrayBufferLength(value);
    if (isSandboxSharedArrayBuffer(value)) {
      const storage = sharedArrayBufferStorage(value);
      if (!seen.has(storage.block)) {
        seen.add(storage.block);
        usage += storage.byteLength;
      }
    }
    if (isSandboxDataView(value)) visit(dataViewBuffer(value), depth + 1);
    if (isNumericTypedArray(value)) {
      const storage = typedArrayStorage(value);
      visit(storage.buffer, depth + 1);
      for (const [key, descriptor] of typedArrayProperties(value)) {
        // Symbol properties were captured by the common object traversal above.
        if (typeof key !== "string") continue;
        usage += 1 + key.length;
        if ("value" in descriptor) visit(descriptor.value, depth + 1);
        else for (const closure of retainedAccessorClosures(descriptor)) visit(closure, depth + 1);
      }
      return;
    }
    if (arrayLength !== undefined) {
      usage += arrayLength;
      if (arrayDescriptors !== undefined) {
        for (const [key, descriptor] of arrayDescriptors) {
          usage += key.length + 1;
          if ("value" in descriptor) visit(descriptor.value, depth + 1);
          else for (const closure of retainedAccessorClosures(descriptor)) visit(closure, depth + 1);
        }
      } else {
        for (const element of arrayElements!) visit(element, depth + 1);
      }
      return;
    }
    if (isSandboxMap(value) || isSandboxSet(value)) {
      const properties = getCollectionProperties(value);
      for (const key of Reflect.ownKeys(properties)) {
        const descriptor = Object.getOwnPropertyDescriptor(properties, key)!;
        usage += 1 + (typeof key === "string" ? key.length : 0);
        if (typeof key === "symbol") visit(key, depth + 1);
        if ("value" in descriptor) visit(descriptor.value, depth + 1);
        else for (const closure of retainedAccessorClosures(descriptor)) visit(closure, depth + 1);
      }
    }
    if (isSandboxMap(value)) {
      usage += value.entries.size;
      for (const [key, entry] of value.entries) {
        visit(key, depth + 1);
        visit(entry, depth + 1);
      }
      return;
    }
    if (isSandboxArrayIterator(value)) visit(arrayIteratorState(value).source, depth + 1);
    if (isSandboxStringIterator(value)) visit(stringIteratorState(value).input, depth + 1);
    if (isSandboxSegmenter(value)) visit(segmenterState(value).options, depth + 1);
    if (isSandboxSegments(value)) {
      const state = segmentState(value);
      visit(state.segmenter, depth + 1);
      visit(state.input, depth + 1);
    }
    if (isSandboxRegExpIterator(value)) {
      const state = regexpIteratorState(value);
      visit(state.matcher, depth + 1);
      visit(state.input, depth + 1);
      for (const [key, descriptor] of Object.entries(Object.getOwnPropertyDescriptors(value))) {
        usage += key.length + 1;
        if ("value" in descriptor) visit(descriptor.value, depth + 1);
        else for (const closure of retainedAccessorClosures(descriptor)) visit(closure, depth + 1);
      }
      return;
    }
    if (isSandboxCollectionIterator(value)) {
      visit(collectionIteratorState(value).collection, depth + 1);
      for (const [key, descriptor] of Object.entries(Object.getOwnPropertyDescriptors(value))) {
        usage += key.length + 1;
        if ("value" in descriptor) visit(descriptor.value, depth + 1);
        else for (const closure of retainedAccessorClosures(descriptor)) visit(closure, depth + 1);
      }
      return;
    }
    if (isSandboxSet(value)) {
      usage += value.values.size;
      for (const entry of value.values) visit(entry, depth + 1);
      return;
    }
    if (isSandboxGenerator(value)) {
      visit(getGeneratorOrigin(value)?.resultPrototype, depth + 1);
      visit(asyncGeneratorDrivers.get(value), depth + 1);
      const descriptors = Object.getOwnPropertyDescriptors(getGeneratorProperties(value));
      for (const key of Reflect.ownKeys(descriptors)) {
        const descriptor = descriptors[key as keyof typeof descriptors]!;
        usage += typeof key === "string" ? key.length + 1 : 1;
        if (typeof key === "symbol") visit(key, depth + 1);
        if ("value" in descriptor) visit(descriptor.value, depth + 1);
        else for (const closure of retainedAccessorClosures(descriptor)) visit(closure, depth + 1);
      }
      const snapshot = value.channel.snapshot();
      usage += snapshot.sent.length;
      for (const completion of snapshot.sent) visit(completion.value, depth + 1);
      return;
    }
    if (isSandboxPromise(value)) {
      const atomicWait = atomicWaitStates.get(value);
      if (atomicWait !== undefined) {
        usage += 4;
        visit(atomicWait.view, depth + 1);
      }
      visit(asyncGeneratorRequestOwners.get(value), depth + 1);
      const settlement = promiseStates.get(value);
      if (settlement !== undefined && settlement.status !== "pending") visit(settlement.value, depth + 1);
      const continuation = promiseContinuations.get(value);
      if (continuation?.kind === "capability" && continuation.resolution !== undefined)
        visit(continuation.resolution.value, depth + 1);
      else if (continuation?.kind === "reaction") {
        visit(continuation.source, depth + 1);
        visit(continuation.onFulfilled, depth + 1);
        visit(continuation.onRejected, depth + 1);
        if (continuation.capability !== undefined) {
          visit(continuation.capability.promise, depth + 1);
          visit(continuation.capability.resolve, depth + 1);
          visit(continuation.capability.reject, depth + 1);
        }
        if (continuation.aggregate !== undefined) visit(continuation.aggregate, depth + 1);
      }
      for (const reaction of promiseReactionResults.get(value) ?? []) visit(reaction, depth + 1);
      for (const producer of promiseProducers.get(value) ?? []) visit(producer, depth + 1);
      for (const key of Reflect.ownKeys(getPromiseProperties(value))) {
        const descriptor = Object.getOwnPropertyDescriptor(getPromiseProperties(value), key)!;
        usage += typeof key === "string" ? key.length + 1 : 1;
        if ("value" in descriptor) visit(descriptor.value, depth + 1);
        else for (const closure of retainedAccessorClosures(descriptor)) visit(closure, depth + 1);
      }
      return;
    }
    if (isSandboxRegex(value)) {
      const { source, flags, lastIndex } = captureRegexData(value);
      const compiled = regexCompiledData(getSandboxRegexPattern(value));
      const staged =
        compiled.ticket === undefined
          ? 0
          : compiled.ticket.owner.budget.compileTicketUsage(compiled.ticket);
      usage += Math.max(6 + source.length + flags.length + compiled.units, staged - 1);
      if (compiled.ticket !== undefined) options.compileTickets?.add(compiled.ticket);
      visit(lastIndex, depth + 1);
      for (const key of Reflect.ownKeys(getRegexProperties(value))) {
        if (key === "lastIndex") continue;
        const descriptor = Object.getOwnPropertyDescriptor(getRegexProperties(value), key)!;
        usage += 1 + (typeof key === "string" ? key.length : 0);
        if (typeof key === "symbol") visit(key, depth + 1);
        if ("value" in descriptor) visit(descriptor.value, depth + 1);
        else for (const closure of retainedAccessorClosures(descriptor)) visit(closure, depth + 1);
      }
      return;
    }

    if (isSandboxArguments(value)) {
      const mapped = mappedArgumentStates.get(value);
      if (mapped !== undefined) {
        for (const retained of mapped.scope.retainedDataRoots()) visit(retained, depth + 1);
      }
      const entries: Array<[string, unknown[]]> = [];
      for (const key of Object.getOwnPropertyNames(value)) {
        const descriptor = Object.getOwnPropertyDescriptor(value, key)!;
        const retained = "value" in descriptor ? [descriptor.value] : retainedAccessorClosures(descriptor);
        // The native restricted callee accessor retains no sandbox data.
        if (retained.length > 0) entries.push([key, retained]);
      }
      for (const [key, retained] of entries) {
        usage += 1 + key.length;
        for (const entry of retained) visit(entry, depth + 1);
      }
      return;
    }

    // Capture values before any retained callback can mutate later properties.
    // Plain transport records do not charge hidden fields. Preserve proxy trap
    // ordering, including managed-state changes during descriptor capture.
    const proxyKeys = nodeTypes.isProxy(value) ? Object.getOwnPropertyNames(value) : undefined;
    const proxyDescriptors = proxyKeys?.map(key => Object.getOwnPropertyDescriptor(value,key));
    const includeNonEnumerable = isSandboxDate(value) || isSandboxArrayBuffer(value) || isSandboxSharedArrayBuffer(value) || isSandboxDataView(value) || sandboxErrorTypes.has(value) || hasManagedDescriptors(value);
    const keys = proxyKeys ?? (includeNonEnumerable ? Object.getOwnPropertyNames(value) : Object.keys(value));
    const metadata = hostFunctionMetadata.get(value);
    const retained: unknown[] = [];
    for (let index = 0; index < keys.length; index++) {
      const key = keys[index]!;
      const descriptor = proxyDescriptors === undefined
        ? Object.getOwnPropertyDescriptor(value,key) : proxyDescriptors[index];
      if (descriptor === undefined) continue;
      if (!descriptor.enumerable && !includeNonEnumerable) continue;
      const initial = metadata?.get(key);
      if (initial !== undefined && "value" in descriptor && Object.is(initial.value, descriptor.value) &&
          initial.enumerable === descriptor.enumerable && initial.configurable === descriptor.configurable &&
          initial.writable === descriptor.writable) continue;
      usage += 1 + key.length;
      if ("value" in descriptor) retained.push(descriptor.value);
      else for (const closure of retainedAccessorClosures(descriptor)) retained.push(closure);
    }
    for (const entry of retained) visit(entry, depth + 1);
  };

  for (const value of values) visit(value);
  for (const projection of projectedPrimitives) {
    if (seen.has(projection.target)) continue;
    for (const item of projection.values)
      if ((typeof item !== "object" || item === null) && typeof item !== "symbol") visit(item, projection.depth);
  }
  return usage;
}

export function reconcileCompiledValues(
  budget: Budget,
  values: Iterable<unknown>,
  compilation?: CompileScope,
  parent?: CompileScope,
  escaping: Iterable<unknown> = []
): void {
  while (parent?.closed) parent = parent.parent;
  const included = new Set<CompileTicket>();
  const usage = measureSandboxData([...values, ...budget.retainedValues()], { compileTickets: included });
  const kept = new Set<CompileTicket>();
  if (parent !== undefined && included.size > 0) measureSandboxData(escaping, { compileTickets: kept });
  const transferred = new Set<CompileTicket>();
  for (const ticket of included) {
    if (!kept.has(ticket)) {
      transferred.add(ticket);
    }
  }
  const retained = budget.reconcileCompileData(
    usage,
    included,
    transferred,
    undefined,
    parent === undefined
  );
  for (const ticket of retained) compilation?.tickets.delete(ticket);
  if (compilation !== undefined && parent !== undefined) compilation.forward(included, parent);
}

function captureRegexData(value: object): { source: string; flags: string; lastIndex: SandboxValue } {
  const source = Object.getOwnPropertyDescriptor(value, "source");
  const flags = Object.getOwnPropertyDescriptor(value, "flags");
  if (
    source === undefined ||
    !("value" in source) ||
    typeof source.value !== "string" ||
    flags === undefined ||
    !("value" in flags) ||
    typeof flags.value !== "string"
  ) {
    throw new TypeError(
      "Invalid sandbox RegExp source or flags: expected own string data properties."
    );
  }
  const cursor = Object.getOwnPropertyDescriptor(regexGuestProperties.get(value) ?? value, "lastIndex");
  if (cursor === undefined || !("value" in cursor)) {
    throw new TypeError("Invalid sandbox RegExp lastIndex: expected an own data property.");
  }
  return { source: source.value, flags: flags.value, lastIndex: cursor.value as SandboxValue };
}

export function deepCopyFromSandbox(
  value: SandboxPromise,
  options?: CopyFromSandboxOptions
): Promise<unknown>;
export function deepCopyFromSandbox(value: SandboxValue, options?: CopyFromSandboxOptions): unknown;
export function deepCopyFromSandbox(
  value: SandboxValue,
  options: CopyFromSandboxOptions = {}
): unknown {
  return copyFromSandbox(
    value,
    {
      seen: new WeakMap()
    },
    "<root>",
    options
  );
}

function copyToSandbox(
  value: unknown,
  state: CopyState<SandboxValue>,
  path = "<root>",
  cloneSandboxCollections = false,
  depth = 0
): SandboxValue {
  assertSandboxDataDepth(depth);
  if (state.structuredClone && (isSandboxPromise(value) || nodeTypes.isPromise(value)))
    throw new DOMException("Promises cannot be structured cloned.", "DataCloneError");
  if (state.structuredClone && typeof value === "symbol")
    throw new DOMException("Symbols cannot be structured cloned.", "DataCloneError");
  if (state.structuredClone && (isSandboxClosure(value) || isSandboxGenerator(value)))
    throw new DOMException("Executable values cannot be structured cloned.", "DataCloneError");
  if (state.structuredClone && typeof value === "object" && value !== null &&
      (weakReferenceStates.has(value) || weakCollectionStates.has(value) || finalizationRegistryStates.has(value)))
    throw new DOMException("Weak state cannot be structured cloned.", "DataCloneError");
  if (state.structuredClone && typeof value === "object" && value !== null &&
      (isSandboxArguments(value) || iteratorHelperStates.has(value) || iteratorWrapperStates.has(value) ||
       disposableStackStates.has(value) || asyncDisposableStackStates.has(value)))
    throw new DOMException("Runtime state cannot be structured cloned.", "DataCloneError");
  if (state.structuredClone && (isSandboxArrayIterator(value) || isSandboxStringIterator(value) ||
      isSandboxCollectionIterator(value) || isSandboxRegExpIterator(value)))
    throw new DOMException("Iterators cannot be structured cloned.", "DataCloneError");
  if (state.structuredClone && (isSandboxSegmenter(value) || isSandboxSegments(value) || isSandboxLocale(value) ||
      isSandboxCollator(value) || isSandboxDateTimeFormat(value) || isSandboxDisplayNames(value) ||
      isSandboxDurationFormat(value) || isSandboxListFormat(value) || isSandboxNumberFormat(value) ||
      isSandboxPluralRules(value) || isSandboxRelativeTimeFormat(value)))
    throw new DOMException("Intl values cannot be structured cloned.", "DataCloneError");
  if (isSandboxPrimitive(value)) {
    return value;
  }

  if (state.structuredClone && typeof value === "object" && value !== null && guestProxyStates.has(value))
    throw new DOMException("Proxies cannot be structured cloned.", "DataCloneError");
  if (state.structuredClone && nodeTypes.isSymbolObject(value))
    throw new DOMException("Cannot clone a boxed symbol.", "DataCloneError");
  if (state.structuredClone && isSandboxModuleNamespace(value))
    throw new DOMException("Cannot clone a module namespace.", "DataCloneError");

  if (isLiveCapability(value)) {
    if (state.structuredClone) throw new DOMException("Capabilities cannot be structured cloned.", "DataCloneError");
    throw new TypeError("Live capabilities require their owning realm bridge.");
  }

  if (isRawJson(value)) {
    const existing = state.seen.get(value);
    if (existing !== undefined) return existing;
    const copy = createRawJson(value.rawJSON);
    state.seen.set(value, copy);
    return copy;
  }

  if (isSandboxRegex(value)) {
    if (!cloneSandboxCollections) return value;
    const existing = state.seen.get(value);
    if (existing !== undefined) return existing;
    const copy = createSandboxRegex(value.source, value.flags, 0, state.compilation);
    state.seen.set(value, copy);
    if (!state.resetRegexLastIndex) copy.lastIndex = copyToSandbox(value.lastIndex, state, `${path}.lastIndex`, true, depth + 1);
    if (!state.structuredClone) {
      const properties = getRegexProperties(value);
      for (const key of Reflect.ownKeys(properties)) {
        const descriptor = Object.getOwnPropertyDescriptor(properties, key)!;
        if (!("value" in descriptor)) throw new TypeError("RegExp accessor properties cannot be copied as data.");
        Object.defineProperty(getRegexProperties(copy), key, {
          ...descriptor,
          value: key === "lastIndex" && state.resetRegexLastIndex ? 0
            : copyToSandbox(descriptor.value, state, `${path}.${String(key)}`, true, depth + 1)
        });
      }
      if (!Object.isExtensible(properties)) Object.preventExtensions(getRegexProperties(copy));
    }
    return copy;
  }

  if (
    isSandboxClosure(value) ||
    isSandboxGenerator(value) ||
    isSandboxPromise(value)
  ) {
    return value;
  }

  if (isSandboxArrayIterator(value) || isSandboxStringIterator(value)) {
    if (!cloneSandboxCollections) return value;
    throw new TypeError("Array iterators require a portable guest snapshot, not a data copy.");
  }
  if (isSandboxRegExpIterator(value)) {
    if (!cloneSandboxCollections) return value;
    if (hasGuestObjectState(value)) throw new TypeError("Guest prototype links and custom descriptors cannot be copied as data.");
    const existing = state.seen.get(value);
    if (existing !== undefined) return existing;
    const snapshot = regexpIteratorState(value);
    const copy = restoreSandboxRegExpIterator({ matcher: undefined, input: undefined, exhausted: true });
    state.seen.set(value, copy);
    const matcher = copyToSandbox(snapshot.matcher, state, `${path}.<matcher>`, true, depth + 1);
    if (matcher !== undefined && (snapshot.global === undefined ? !isSandboxRegex(matcher) : matcher === null || typeof matcher !== "object")) throw new TypeError("Invalid RegExp iterator matcher.");
    restoreSandboxRegExpIterator({ ...snapshot, matcher }, copy);
    for (const entry of getEnumerableObjectEntries(value, path)) {
      defineOwnDataProperty(copy, entry.key, copyToSandbox(entry.value, state, joinPath(path, entry.key), true, depth + 1));
    }
    return copy;
  }

  if (isSandboxCollectionIterator(value)) {
    if (!cloneSandboxCollections) return value;
    if (hasGuestObjectState(value)) throw new TypeError("Guest prototype links and custom descriptors cannot be copied as data.");
    const existing = state.seen.get(value);
    if (existing !== undefined) return existing;
    const snapshot = snapshotCollectionIterator(value);
    const copy = restoreSandboxCollectionIterator({ ...snapshot, collection: undefined, index: 0, exhausted: true });
    state.seen.set(value, copy);
    const collection = copyToSandbox(snapshot.collection, state, `${path}.<collection>`, true, depth + 1);
    if (collection !== undefined && !isSandboxMap(collection) && !isSandboxSet(collection)) throw new TypeError("Invalid cloned collection iterator source.");
    state.initializeIterators!.push(() => { restoreSandboxCollectionIterator({ ...snapshot, collection }, copy); });
    for (const entry of getEnumerableObjectEntries(value, path)) {
      defineOwnDataProperty(copy, entry.key, copyToSandbox(entry.value, state, joinPath(path, entry.key), true, depth + 1));
    }
    return copy;
  }

  if (typeof value === "object" && value !== null && hasGuestObjectState(value) &&
      !(state.structuredClone && (isPlainObject(value) || isPlainArray(value) || isSandboxDate(value) || isSandboxArrayBuffer(value) || isSandboxSharedArrayBuffer(value) || isSandboxDataView(value) || isNumericTypedArray(value)))) {
    throw new TypeError("Guest prototype links and custom descriptors cannot be copied as data.");
  }

  const primitive = nativeBoxedValue(value);
  if (primitive !== undefined) {
    const original = value as object;
    const existing = state.seen.get(original);
    if (existing !== undefined) return existing;
    const copy = createSandboxBox(primitive);
    state.seen.set(original, copy);
    if (!state.structuredClone) {
      for (const [key, descriptor] of boxedDataProperties(original, true)) {
        if (!("value" in descriptor)) throw new TypeError("Boxed data cannot contain accessors.");
        Object.defineProperty(copy, key, {
          ...descriptor,
          value: copyToSandbox(descriptor.value, state, joinPath(path, key), cloneSandboxCollections, depth + 1)
        });
      }
    }
    return copy;
  }

  if (isSandboxMap(value)) {
    if (!cloneSandboxCollections) return value;
    const existing = state.seen.get(value);
    if (existing !== undefined) return existing;
    const copy = createSandboxMap();
    state.seen.set(value, copy);
    if (!state.structuredClone) copyCollectionProperties(value, getCollectionProperties(copy), entry => copyToSandbox(entry, state, `${path}.<property>`, true, depth + 1));
    for (const [key, entry] of value.entries) {
      copy.entries.set(
        copyToSandbox(key, state, `${path}.<key>`, true, depth + 1),
        copyToSandbox(entry, state, `${path}.<value>`, true, depth + 1)
      );
    }
    return copy;
  }

  if (isSandboxSet(value)) {
    if (!cloneSandboxCollections) return value;
    const existing = state.seen.get(value);
    if (existing !== undefined) return existing;
    const copy = createSandboxSet();
    state.seen.set(value, copy);
    if (!state.structuredClone) copyCollectionProperties(value, getCollectionProperties(copy), entry => copyToSandbox(entry, state, `${path}.<property>`, true, depth + 1));
    for (const entry of value.values) {
      copy.values.add(copyToSandbox(entry, state, `${path}.<value>`, true, depth + 1));
    }
    return copy;
  }

  if (nodeTypes.isPromise(value)) {
    const existing = state.seen.get(value);
    if (existing !== undefined) return existing;
    const promise = Promise.resolve(value).then(
      (resolved) => copyToSandbox(resolved, { seen: new WeakMap() }),
      (reason) => Promise.reject(copyToSandbox(reason, { seen: new WeakMap() }))
    );
    const sandboxPromise = createSandboxPromise(promise);
    state.seen.set(value, sandboxPromise);
    const span = getBoundOtelSpan(value);
    if (span !== undefined) {
      bindOtelSpan(promise, span);
      bindOtelSpan(sandboxPromise, span);
    }
    return sandboxPromise;
  }

  if (isSandboxArrayBuffer(value) || isSandboxSharedArrayBuffer(value)) {
    const existing = state.seen.get(value);
    if (existing !== undefined) return existing;
    const copy = copyArrayBufferStorage(value, state);
    state.seen.set(value, copy);
    if (state.structuredClone) return copy;
    for (const [key, descriptor] of arrayBufferDataProperties(value)) {
      Object.defineProperty(copy, key, { ...descriptor,
        value: copyToSandbox(descriptor.value, state, joinPath(path, key), cloneSandboxCollections, depth + 1) });
    }
    if (!Object.isExtensible(value)) Object.preventExtensions(copy);
    return copy;
  }

  if (nodeTypes.isDate(value)) {
    const existing = state.seen.get(value);
    if (existing !== undefined) return existing;
    const copy = copyNativeDate(value)!;
    state.seen.set(value, copy);
    if (state.structuredClone) return copy;
    if (!state.structuredClone && hasNullObjectPrototype(value)) setSandboxPrototype(copy, null);
    for (const [key, descriptor] of dateDataProperties(value)) {
      Object.defineProperty(copy, key, { ...descriptor, value: copyToSandbox(descriptor.value, state, joinPath(path, key), cloneSandboxCollections, depth + 1) });
    }
    if (!state.structuredClone && !Object.isExtensible(value)) Object.preventExtensions(copy);
    return copy;
  }

  if (isSandboxDataView(value)) {
    const existing = state.seen.get(value);
    if (existing !== undefined) return existing;
    if (state.structuredClone) {
      try { Reflect.apply(dataViewGetters.byteLength, value, []); }
      catch (error) {
        if (!(error instanceof TypeError)) throw error;
        throw new DOMException("Cannot clone an out-of-bounds DataView.", "DataCloneError");
      }
    }
    const copy = copyDataViewStorage(value, state);
    state.seen.set(value, copy);
    if (state.structuredClone) return copy;
    copyToSandbox(dataViewBuffer(value), state, `${path}.buffer`, cloneSandboxCollections, depth + 1);
    for (const [key, descriptor] of dataViewDataProperties(value)) {
      Object.defineProperty(copy, key, { ...descriptor,
        value: copyToSandbox(descriptor.value, state, joinPath(path, key), cloneSandboxCollections, depth + 1) });
    }
    if (!Object.isExtensible(value)) Object.preventExtensions(copy);
    return copy;
  }

  if (isNumericTypedArray(value)) {
    const existing = state.seen.get(value);
    if (existing !== undefined) return existing;
    if (state.structuredClone) {
      try {
        typedArrayStorage(value, true);
      } catch (error) {
        if (!(error instanceof TypeError)) throw error;
        throw new DOMException("Cannot clone an out-of-bounds typed array.", "DataCloneError");
      }
    }
    const copy = copyTypedArrayStorage(value, state);
    state.seen.set(value, copy);
    if (state.structuredClone) return copy;
    copyToSandbox(typedArrayStorage(value).buffer, state, `${path}.buffer`, cloneSandboxCollections, depth + 1);
    for (const [key, descriptor] of typedArrayDataProperties(value)) {
      Object.defineProperty(copy, key, {
        ...descriptor,
        value: copyToSandbox(
          descriptor.value,
          state,
          joinPath(path, key),
          cloneSandboxCollections,
          depth + 1
        )
      });
    }
    if (!Object.isExtensible(value)) Object.preventExtensions(copy);
    return copy;
  }

  if (value instanceof Map) {
    const existing = state.seen.get(value);
    if (existing !== undefined) {
      return existing;
    }

    const copy = createSandboxMap();
    state.seen.set(value, copy);
    if (!state.structuredClone) copyCollectionProperties(value, getCollectionProperties(copy), entry => copyToSandbox(entry, state, `${path}.<property>`, cloneSandboxCollections, depth + 1));
    for (const [key, entry] of value) {
      copy.entries.set(
        copyToSandbox(key, state, `${path}.<key>`, cloneSandboxCollections, depth + 1),
        copyToSandbox(entry, state, `${path}.<value>`, cloneSandboxCollections, depth + 1)
      );
    }
    return copy;
  }

  if (value instanceof Set) {
    const existing = state.seen.get(value);
    if (existing !== undefined) {
      return existing;
    }

    const copy = createSandboxSet();
    state.seen.set(value, copy);
    if (!state.structuredClone) copyCollectionProperties(value, getCollectionProperties(copy), entry => copyToSandbox(entry, state, `${path}.<property>`, cloneSandboxCollections, depth + 1));
    for (const entry of value) {
      copy.values.add(
        copyToSandbox(entry, state, `${path}.<value>`, cloneSandboxCollections, depth + 1)
      );
    }
    return copy;
  }

  if (isPlainArray(value)) {
    const existing = state.seen.get(value);
    if (existing !== undefined) {
      return existing;
    }

    const copy = new Array(value.length) as SandboxArray;
    state.seen.set(value, copy);

    for (const entry of getEnumerableArrayEntries(value, path, !state.structuredClone)) {
      defineOwnDataProperty(
        copy,
        entry.key,
        copyToSandbox(
          entry.value,
          state,
          joinArrayPath(path, entry.key),
          cloneSandboxCollections,
          depth + 1
        )
      );
    }

    return copy;
  }

  if (isSandboxArguments(value)) {
    const existing = state.seen.get(value);
    if (existing !== undefined) return existing;
    const copy = createSandboxArguments([], unrestrictedArgumentObjects.has(value) ? {callee: undefined} : undefined);
    state.seen.set(value, copy);
    copySandboxArgumentProperties(value, copy, (entry, key) =>
      copyToSandbox(entry, state, joinPath(path, key), cloneSandboxCollections, depth + 1)
    );
    return copy;
  }

  if (isPlainObject(value)) {
    const existing = state.seen.get(value);
    if (existing !== undefined) {
      return existing;
    }

    const copy = createPlainObject(
      !state.structuredClone && (!cloneSandboxCollections || Object.getPrototypeOf(value) === null)
    );
    if (!state.structuredClone && hasNullObjectPrototype(value)) setSandboxPrototype(copy, null);
    state.seen.set(value, copy);
    const errorType = sandboxErrorTypes.get(value);
    if (errorType !== undefined) sandboxErrorTypes.set(copy, errorType);

    for (const entry of getEnumerableObjectEntries(value, path, !state.structuredClone)) {
      defineOwnDataProperty(
        copy,
        entry.key,
        copyToSandbox(
          entry.value,
          state,
          joinPath(path, entry.key),
          cloneSandboxCollections,
          depth + 1
        )
      );
    }

    return copy;
  }

  throw new TypeError(`Unsupported sandbox value at ${path}: ${describeValue(value)}`);
}

function copyFromSandbox(
  value: SandboxValue,
  state: CopyState<unknown>,
  path = "<root>",
  options: CopyFromSandboxOptions,
  depth = 0
): unknown {
  assertSandboxDataDepth(depth);
  if (isSandboxPrimitive(value)) {
    return value;
  }

  if (guestProxyStates.has(value) && (!isSandboxClosure(value) || options.wrapClosure === undefined))
    throw new TypeError("Proxy values require their owning realm bridge; they cannot be copied as data.");

  if (isGuestHostObject(value)) {
    if (options.unwrapHostObject === undefined) throw new TypeError("Live capabilities require their owning realm bridge.");
    return options.unwrapHostObject(value);
  }

  if (nodeTypes.isProxy(value) && !isNumericTypedArray(value) && !isTrackedIntrinsicObject(value) && !mappedArgumentStates.has(value as import("./arguments.js").SandboxArguments)) throw new TypeError("Unsupported proxy sandbox value.");
  if (sandboxErrorTypes.has(value) && hasExplicitSandboxPrototype(value)) {
    const prototype = getSandboxPrototype(value);
    let nativePrototype: object | null = null;
    if (prototype !== null) {
      const identity = getIntrinsicIdentity(prototype);
      const nativePrototypes: Record<string, object> = {
        Error: Error.prototype, TypeError: TypeError.prototype, RangeError: RangeError.prototype,
        ReferenceError: ReferenceError.prototype, SyntaxError: SyntaxError.prototype,
        URIError: URIError.prototype, EvalError: EvalError.prototype, AggregateError: AggregateError.prototype,
        SuppressedError: NativeSuppressedError.prototype
      };
      const path = identity === undefined ? [] : JSON.parse(identity) as unknown[];
      if (path.length !== 2 || typeof path[0] !== "string" || path[1] !== "prototype" || !Object.hasOwn(nativePrototypes, path[0]))
        throw new TypeError("Custom Error prototype links cannot be copied as data.");
      nativePrototype = nativePrototypes[path[0]];
      let current: object | null = prototype;
      let prototypeDepth = 0;
      while (current !== null) {
        assertSandboxDataDepth(++prototypeDepth);
        const objectPrototype = getIntrinsicIdentity(current) === '["Object","prototype"]';
        const owner = objectPrototype ? Object.getOwnPropertyDescriptor(current, "constructor")?.value : current;
        if (owner === null || typeof owner !== "object" ||
            (objectPrototype && getIntrinsicIdentity(owner) !== '["Object"]') || hasGuestObjectState(owner))
          throw new TypeError("Modified Error prototype links cannot be copied as data.");
        current = getSandboxPrototype(current);
      }
    }
    const existing = state.seen.get(value);
    if (existing !== undefined) return existing;
    const descriptors = Reflect.ownKeys(value).filter(key => typeof key !== "symbol" || !internalSymbols.has(key))
      .map(key => [key, Object.getOwnPropertyDescriptor(value, key)!] as const);
    if (descriptors.some(([,descriptor]) => !("value" in descriptor)))
      throw new TypeError("Error accessor properties cannot be copied as data.");
    const copy = new Error();
    delete copy.stack;
    Object.setPrototypeOf(copy, nativePrototype);
    state.seen.set(value, copy);
    for (const [key, descriptor] of descriptors)
      Object.defineProperty(copy, key, { ...descriptor,
        value: copyFromSandbox(descriptor.value, state, joinPath(path, key), options, depth + 1) });
    if (!Object.isExtensible(value)) Object.preventExtensions(copy);
    return copy;
  }
  if (!isSandboxClosure(value) && hasGuestObjectState(value)) {
    throw new TypeError("Guest prototype links and custom descriptors cannot be copied as data.");
  }

  if (isSandboxBox(value)) {
    const existing = state.seen.get(value);
    if (existing !== undefined) return existing;
    const copy = Object(boxedValue(value));
    state.seen.set(value, copy);
    for (const [key, descriptor] of boxedDataProperties(value, true)) {
      if (!("value" in descriptor)) throw new TypeError("Boxed data cannot contain accessors.");
      Object.defineProperty(copy, key, {
        ...descriptor,
        value: copyFromSandbox(descriptor.value, state, joinPath(path, key), options, depth + 1)
      });
    }
    return copy;
  }

  const regexBrand = Object.getOwnPropertyDescriptor(value, sandboxRegexBrand);
  if (regexBrand !== undefined) {
    if (!("value" in regexBrand) || regexBrand.value !== true) {
      throw new TypeError("Invalid sandbox RegExp brand.");
    }
    const { source, flags, lastIndex } = captureRegexData(value);
    const guard = new RegexCompileGuard(options.compilation);
    try {
      guard.preflight(source, flags);
      const existing = state.seen.get(value);
      if (existing !== undefined) return existing;
      guard.allocate(1 + source.length + flags.length);
      const regex = new RegExp(source, flags);
      state.seen.set(value, regex);
      Reflect.set(regex, "lastIndex", copyFromSandbox(lastIndex, state, `${path}.lastIndex`, options, depth + 1));
      const properties = regexGuestProperties.get(value);
      if (properties !== undefined) {
        for (const key of Reflect.ownKeys(properties)) {
          const descriptor = Object.getOwnPropertyDescriptor(properties, key)!;
          if (!("value" in descriptor)) throw new TypeError("RegExp accessor properties cannot be copied as data.");
          Object.defineProperty(regex, key, { ...descriptor,
            value: copyFromSandbox(descriptor.value, state, `${path}.${String(key)}`, options, depth + 1) });
        }
        if (!Object.isExtensible(properties)) Object.preventExtensions(regex);
      }
      guard.retainScratch();
      return regex;
    } finally {
      guard.close();
    }
  }

  if (isNumericTypedArray(value)) {
    const existing = state.seen.get(value);
    if (existing !== undefined) return existing;
    const copy = copyTypedArrayStorage(value, state);
    state.seen.set(value, copy);
    copyFromSandbox(typedArrayStorage(value).buffer, state, `${path}.buffer`, options, depth + 1);
    for (const [key, descriptor] of typedArrayDataProperties(value)) {
      Object.defineProperty(copy, key, {
        ...descriptor,
        value: copyFromSandbox(descriptor.value, state, joinPath(path, key), options, depth + 1)
      });
    }
    if (!Object.isExtensible(value)) Object.preventExtensions(copy);
    return copy;
  }

  if (isSandboxArrayBuffer(value) || isSandboxSharedArrayBuffer(value) || isSandboxDataView(value)) {
    const existing = state.seen.get(value);
    if (existing !== undefined) return existing;
    const copy = isSandboxDataView(value) ? copyDataViewStorage(value, state) : copyArrayBufferStorage(value, state);
    state.seen.set(value, copy);
    if (isSandboxDataView(value)) copyFromSandbox(dataViewBuffer(value), state, `${path}.buffer`, options, depth + 1);
    for (const [key, descriptor] of isSandboxDataView(value) ? dataViewDataProperties(value) : arrayBufferDataProperties(value)) {
      Object.defineProperty(copy, key, { ...descriptor,
        value: copyFromSandbox(descriptor.value, state, joinPath(path, key), options, depth + 1) });
    }
    if (!Object.isExtensible(value)) Object.preventExtensions(copy);
    return copy;
  }

  if (isSandboxDate(value)) {
    const existing = state.seen.get(value);
    if (existing !== undefined) return existing;
    const copy = exportDate(value);
    if (hasNullObjectPrototype(value)) Object.setPrototypeOf(copy, null);
    state.seen.set(value, copy);
    for (const [key, descriptor] of dateDataProperties(value)) {
      Object.defineProperty(copy, key, { ...descriptor, value: copyFromSandbox(descriptor.value, state, joinPath(path, key), options, depth + 1) });
    }
    if (!Object.isExtensible(value)) Object.preventExtensions(copy);
    return copy;
  }

  if (isSandboxClosure(value)) {
    if (options.wrapClosure === undefined) {
      throw new TypeError(
        "Sandbox closures cannot cross into host values without an explicit wrapper."
      );
    }

    const existing = state.seen.get(value);
    if (existing !== undefined) {
      return existing;
    }

    const wrapped = options.wrapClosure(value);
    state.seen.set(value, wrapped);
    return wrapped;
  }

  if (isSandboxPromise(value)) {
    const existing = state.seen.get(value);
    if (existing !== undefined) return existing;
    observeSandboxPromise(value);
    const copySettlement = (settled: SandboxValue): unknown => {
      const owner = options.compilation?.owner;
      const operation = owner?.budget.acquireCompileOwner(false, owner);
      const compilation = new CompileScope(operation?.owner);
      try {
        return copyFromSandbox(settled, { seen: new WeakMap() }, "<root>", {
          ...options,
          compilation
        });
      } finally {
        compilation.dispose();
        operation?.release();
      }
    };
    const copy = value.promise.then(copySettlement, (reason: SandboxValue) =>
      Promise.reject(reason instanceof SandboxError ? reason : copySettlement(reason))
    );
    state.seen.set(value, copy);
    const properties = getPromiseProperties(value);
    for (const key of Reflect.ownKeys(properties)) {
      const descriptor = Object.getOwnPropertyDescriptor(properties, key)!;
      if (!("value" in descriptor)) throw new TypeError("Promise accessor properties cannot be copied as data.");
      Object.defineProperty(copy, key, {
        ...descriptor,
        value: copyFromSandbox(descriptor.value, state, `${path}.<property>`, options, depth + 1)
      });
    }
    if (hasNullObjectPrototype(value)) Object.setPrototypeOf(copy, null);
    if (!Object.isExtensible(properties)) Object.preventExtensions(copy);
    return copy;
  }

  if (isSandboxGenerator(value)) {
    throw new TypeError("Sandbox generators cannot cross into host values.");
  }
  if (isSandboxArrayIterator(value) || isSandboxStringIterator(value)) throw new TypeError("Sandbox iterators cannot cross into host values.");

  if (isSandboxCollectionIterator(value)) {
    throw new TypeError("Sandbox collection iterators cannot cross into host values.");
  }
  if (isSandboxRegExpIterator(value)) {
    throw new TypeError("Sandbox RegExp iterators cannot cross into host values.");
  }

  if (isSandboxRegex(value)) {
    throw new TypeError("Invalid sandbox RegExp brand.");
  }

  if (isSandboxMap(value)) {
    const existing = state.seen.get(value);
    if (existing !== undefined) {
      return existing;
    }

    const copy = new Map<unknown, unknown>();
    state.seen.set(value, copy);
    copyCollectionProperties(value, copy, entry => copyFromSandbox(entry as SandboxValue, state, `${path}.<property>`, options, depth + 1));
    for (const [key, entry] of value.entries) {
      copy.set(
        copyFromSandbox(key, state, `${path}.<key>`, options, depth + 1),
        copyFromSandbox(entry, state, `${path}.<value>`, options, depth + 1)
      );
    }
    return copy;
  }

  if (isSandboxSet(value)) {
    const existing = state.seen.get(value);
    if (existing !== undefined) {
      return existing;
    }

    const copy = new Set<unknown>();
    state.seen.set(value, copy);
    copyCollectionProperties(value, copy, entry => copyFromSandbox(entry as SandboxValue, state, `${path}.<property>`, options, depth + 1));
    for (const entry of value.values) {
      copy.add(copyFromSandbox(entry, state, `${path}.<value>`, options, depth + 1));
    }
    return copy;
  }

  if (isPlainArray(value)) {
    const existing = state.seen.get(value);
    if (existing !== undefined) {
      return existing;
    }

    const copy = new Array(value.length);
    state.seen.set(value, copy);

    for (const entry of getEnumerableArrayEntries(value, path)) {
      defineOwnDataProperty(
        copy,
        entry.key,
        copyFromSandbox(entry.value, state, joinArrayPath(path, entry.key), options, depth + 1)
      );
    }

    return copy;
  }

  if (isSandboxArguments(value)) {
    const existing = state.seen.get(value);
    if (existing !== undefined) return existing;
    const copy = createSandboxArguments([], unrestrictedArgumentObjects.has(value) ? {callee: undefined} : undefined);
    state.seen.set(value, copy);
    copySandboxArgumentProperties(value, copy, (entry, key) =>
      copyFromSandbox(entry, state, joinPath(path, key), options, depth + 1)
    );
    return copy;
  }

  if (isPlainObject(value)) {
    const existing = state.seen.get(value);
    if (existing !== undefined) {
      return existing;
    }

    const copy = createPlainObject(hasNullObjectPrototype(value) || Object.getPrototypeOf(value) === null) as Record<
      string,
      unknown
    >;
    state.seen.set(value, copy);

    for (const entry of getEnumerableObjectEntries(value, path)) {
      defineOwnDataProperty(
        copy,
        entry.key,
        copyFromSandbox(entry.value, state, joinPath(path, entry.key), options, depth + 1)
      );
    }

    return copy;
  }

  throw new TypeError(`Unsupported sandbox value at ${path}: ${describeValue(value)}`);
}

function isSandboxPrimitive(value: unknown): value is SandboxPrimitive {
  return (
    value === null ||
    value === undefined ||
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "bigint" ||
    typeof value === "boolean" ||
    typeof value === "symbol"
  );
}

function allocateSandboxValue(value: SandboxValue, budget: Budget, seen: WeakSet<object>): void {
  if (isSandboxSharedArrayBuffer(value)) {
    if (seen.has(value)) return;
    seen.add(value);
    budget.allocateArrayLength(sharedArrayBufferStorage(value).maxByteLength);
    for (const [key,descriptor] of arrayBufferDataProperties(value)) {
      if (typeof key==="string") budget.allocateString(key);
      allocateSandboxValue(descriptor.value,budget,seen);
    }
    return;
  }
  if (typeof value === "string") {
    budget.allocateString(value);
    return;
  }

  if (isSandboxDataView(value)) {
    if (seen.has(value)) return;
    seen.add(value);
    allocateSandboxValue(dataViewBuffer(value), budget, seen);
    for (const [key, descriptor] of dataViewDataProperties(value)) {
      if (typeof key === "string") budget.allocateString(key);
      allocateSandboxValue(descriptor.value, budget, seen);
    }
    return;
  }

  if (isSandboxArrayBuffer(value)) {
    if (seen.has(value)) return;
    seen.add(value);
    budget.allocateArrayLength(arrayBufferOptions(value)?.maxByteLength ?? arrayBufferLength(value));
    for (const [key, descriptor] of arrayBufferDataProperties(value)) {
      if (typeof key === "string") budget.allocateString(key);
      allocateSandboxValue(descriptor.value, budget, seen);
    }
    return;
  }

  if (isSandboxBox(value)) {
    if (seen.has(value)) return;
    seen.add(value);
    const primitive = boxedValue(value);
    if (typeof primitive === "string") budget.allocateString(primitive);
    for (const [key, descriptor] of boxedDataProperties(value)) {
      budget.allocateString(key);
      if ("value" in descriptor) allocateSandboxValue(descriptor.value, budget, seen);
    }
    return;
  }

  if (isNumericTypedArray(value)) {
    if (seen.has(value)) return;
    seen.add(value);
    const storage = typedArrayStorage(value);
    budget.allocateArrayLength(Math.ceil(storage.byteLength / storage.elementSize));
    const capacity = arrayBufferOptions(typedArrayStorage(value).buffer)?.maxByteLength;
    if (capacity !== undefined) budget.allocateArrayLength(capacity);
    for (const [key, descriptor] of typedArrayDataProperties(value)) {
      budget.allocateString(key);
      allocateSandboxValue(descriptor.value, budget, seen);
    }
    return;
  }

  if (Array.isArray(value)) {
    if (seen.has(value)) {
      return;
    }

    seen.add(value);
    budget.allocateArrayLength(value.length);
    for (let index = 0; index < value.length; index++) {
      allocateSandboxValue(value[index], budget, seen);
    }

    return;
  }

  if (isSandboxMap(value)) {
    if (seen.has(value)) {
      return;
    }

    seen.add(value);
    budget.allocateCollectionEntries(value.entries.size);
    for (const [key, entry] of value.entries) {
      allocateSandboxValue(key, budget, seen);
      allocateSandboxValue(entry, budget, seen);
    }
    return;
  }

  if (isSandboxSet(value)) {
    if (seen.has(value)) {
      return;
    }

    seen.add(value);
    budget.allocateCollectionEntries(value.values.size);
    for (const entry of value.values) {
      allocateSandboxValue(entry, budget, seen);
    }
    return;
  }

  if (
    typeof value !== "object" ||
    value === null ||
    isSandboxClosure(value) ||
    isSandboxMap(value) ||
    isSandboxSet(value) ||
    isSandboxPromise(value)
  ) {
    return;
  }

  if (seen.has(value)) {
    return;
  }

  seen.add(value);
  const entries = isSandboxArguments(value)
    ? getSandboxArgumentEntries(value).map(([, entry]) => entry)
    : Object.values(value);
  for (const entry of entries) {
    allocateSandboxValue(entry, budget, seen);
  }
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }

  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function isPlainArray(value: unknown): value is unknown[] {
  return Array.isArray(value) && Object.getPrototypeOf(value) === Array.prototype;
}

function createPlainObject(useNullPrototype: boolean): SandboxObject {
  return (useNullPrototype ? Object.create(null) : {}) as SandboxObject;
}

export function defineOwnDataProperty(target: object, key: PropertyKey, value: unknown): void {
  Object.defineProperty(target, key, {
    enumerable: true,
    configurable: true,
    writable: true,
    value
  });
}

function getEnumerableObjectEntries<TValue>(
  value: Record<string, TValue>,
  path: string,
  includeSymbols = true
): Array<{ key: string | symbol; value: TValue }> {
  const descriptors = Object.getOwnPropertyDescriptors(value);
  const entries: Array<{ key: string | symbol; value: TValue }> = [];

  for (const key of Reflect.ownKeys(descriptors)) {
    if (typeof key === "symbol" && (!includeSymbols || internalSymbols.has(key))) continue;
    const descriptor = Object.getOwnPropertyDescriptor(descriptors, key)!.value as PropertyDescriptor;
    if (!descriptor.enumerable) {
      continue;
    }

    if ("get" in descriptor || "set" in descriptor) {
      throw new TypeError(`Unsupported sandbox value at ${joinPath(path, key)}: accessor property`);
    }

    entries.push({
      key,
      value: descriptor.value as TValue
    });
  }

  return entries;
}

function getEnumerableArrayEntries<TValue>(
  value: TValue[],
  path: string,
  includeSymbols = true
): Array<{ key: string | symbol; value: TValue }> {
  const descriptors = Object.getOwnPropertyDescriptors(value);
  const entries: Array<{ key: string | symbol; value: TValue }> = [];

  for (const key of Reflect.ownKeys(descriptors)) {
    if (typeof key === "symbol" && (!includeSymbols || internalSymbols.has(key))) continue;
    const descriptor = Object.getOwnPropertyDescriptor(descriptors, key)!.value as PropertyDescriptor;
    if (key === "length" || !descriptor.enumerable) {
      continue;
    }

    if ("get" in descriptor || "set" in descriptor) {
      throw new TypeError(
        `Unsupported sandbox value at ${joinArrayPath(path, key)}: accessor property`
      );
    }

    entries.push({
      key,
      value: descriptor.value as TValue
    });
  }

  return entries;
}

export function isArrayIndexKey(value: string): boolean {
  if (value === "") {
    return false;
  }

  const index = Number(value);
  return Number.isInteger(index) && index >= 0 && index < 4_294_967_295 && String(index) === value;
}

function describeValue(value: unknown): string {
  if (typeof value === "function") {
    return "function";
  }

  if (typeof value === "bigint" || typeof value === "symbol") {
    return typeof value;
  }

  if (typeof value === "object" && value !== null) {
    return value.constructor?.name ?? "Object";
  }

  return typeof value;
}

function joinPath(path: string, key: string | symbol): string {
  if (typeof key === "symbol") return `${path}[${String(key)}]`;
  return path === "<root>" ? `<root>.${key}` : `${path}.${key}`;
}

function joinArrayPath(path: string, key: string | symbol): string {
  if (typeof key === "symbol") return `${path}[${String(key)}]`;
  return isArrayIndexKey(key) ? `${path}[${key}]` : joinPath(path, key);
}

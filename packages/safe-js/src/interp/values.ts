import { bindOtelSpan, getBoundOtelSpan } from "../observability/otel.js";
import { internalSymbols } from "./internal-symbols.js";
import { getRegexProperties, regexGuestProperties } from "./regexp-properties.js";
export { getRegexProperties } from "./regexp-properties.js";
import { retainedAccessorClosures } from "./accessors.js";
import { isSandboxMap, isSandboxSet, sandboxMapBrand, sandboxSetBrand } from "./collection-brands.js";
import { collectionIteratorState, isSandboxCollectionIterator, restoreSandboxCollectionIterator, snapshotCollectionIterator, type SandboxCollectionIterator } from "./collection-iterator.js";
import { regexpIteratorState, isSandboxRegExpIterator, restoreSandboxRegExpIterator, type SandboxRegExpIterator } from "./regexp-iterator.js";
import { copyNativeDate, dateDataProperties, exportDate, isSandboxDate } from "./date.js";
import { boxedDataProperties, boxedValue, createSandboxBox, isSandboxBox, nativeBoxedValue } from "./boxed.js";
import { getHostObjectKeys, getHostObjectMember, hasHostObjectMember, measureHostObjectData, isGuestHostObject, isLiveCapability } from "./host-capabilities.js";
import type { Budget, CompileTicket } from "./budget.js";
import { types as nodeTypes } from "node:util";
import { CompileScope, RegexCompileGuard, regexCompiledData } from "./regex/compile-guard.js";
import {
  copyFloat32Storage,
  float32DataProperties,
  float32Storage,
  isFloat32Array
} from "./float32.js";
import type { GeneratorChannel } from "./generator.js";
import { SandboxError } from "./budget.js";
import { observeSandboxPromise, trackSandboxPromise } from "./promise-tracker.js";
import { promiseReplayContext } from "./promise-replay.js";
import {
  invokeCancelableClosure,
  readPromiseCancellation,
  registerPromiseCancellation
} from "./cancel.js";
import { parseRegex, type RegexPattern } from "./regex/parse.js";
import { assertSandboxDataDepth } from "../graph-depth.js";
import { sandboxErrorTypes } from "../error/shape.js";
import { getGuestFunctionProperties, getSandboxPrototype, hasGuestObjectState, hasManagedDescriptors, isGuestClosure, isIntrinsicConstructor, registerGuestClosure } from "./object-model.js";
import type { FunctionSource } from "../parse/function-source.js";
import {
  copySandboxArgumentProperties,
  createSandboxArguments,
  getSandboxArgumentEntries,
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

export type SandboxPrimitive = string | number | boolean | symbol | null | undefined;

export type SandboxValue =
  | SandboxPrimitive
  | Date
  | Float32Array
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

  if (input.guest === true) {
    registerGuestClosure(closure);
    Object.defineProperty(closure, "properties", {
      get: () => getGuestFunctionProperties(closure)
    });
  } else if (input.properties !== undefined) {
    Object.defineProperty(closure, "properties", {
      enumerable: false,
      value: Object.freeze(
        typeof input.properties === "function" ? input.properties(closure) : input.properties
      )
    });
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
  if (isGuestClosure(value)) entries = Object.entries(value.properties ?? {});
  else if (isSandboxRegex(value)) entries = Object.entries(getRegexProperties(value));
  else if (isSandboxClosure(value) || isSandboxGenerator(value) || isSandboxMap(value) || isSandboxSet(value) || isSandboxPromise(value) || isSandboxRegex(value)) return [];
  else entries = Object.entries(Object(value)) as Array<[string, SandboxValue]>;
  return excludedKeys === undefined ? entries : entries.filter(([key]) => !excludedKeys.has(key));
}

export function ownSandboxSymbolKeys(value: SandboxValue): symbol[] {
  if (value === null || value === undefined) throw new TypeError("Cannot convert undefined or null to object.");
  if (isGuestHostObject(value)) return [];
  if (isSandboxClosure(value)) value = value.properties ?? {};
  else if (isSandboxRegex(value)) value = getRegexProperties(value);
  else if (isSandboxGenerator(value) || isSandboxMap(value) || isSandboxSet(value) || isSandboxPromise(value) || isSandboxRegex(value)) return [];
  return Object.getOwnPropertySymbols(Object(value)).filter(key => !internalSymbols.has(key));
}

export function ownEnumerableSandboxKeys(value: SandboxValue): string[];
export function ownEnumerableSandboxKeys(value: SandboxValue, includeSymbols: true): PropertyKey[];
export function ownEnumerableSandboxKeys(value: SandboxValue, includeSymbols = false): PropertyKey[] {
  if (includeSymbols) {
    const properties = isSandboxClosure(value) ? value.properties ?? {} : isSandboxRegex(value) ? getRegexProperties(value) : Object(value);
    return [...ownEnumerableSandboxKeys(value), ...ownSandboxSymbolKeys(value).filter(key =>
      Object.getOwnPropertyDescriptor(properties, key)?.enumerable === true)];
  }
  if (isGuestHostObject(value)) return getHostObjectKeys(value);
  if (value === null || value === undefined) throw new TypeError("Cannot convert undefined or null to object.");
  if (isGuestClosure(value)) return Object.keys(value.properties ?? {});
  if (isSandboxRegex(value)) return Object.keys(getRegexProperties(value));
  if (isSandboxClosure(value) || isSandboxGenerator(value) || isSandboxMap(value) || isSandboxSet(value) || isSandboxPromise(value) || isSandboxRegex(value)) return [];
  return Object.keys(Object(value));
}

export function createSandboxPromise(
  promise: Promise<SandboxValue>,
  metadata: {
    trackReplay?: boolean;
    synchronousPrefix?: Promise<void>;
    hostCall?: import("./host-call.js").HostCallRecord;
    hostCallJournal?: import("./host-call.js").HostCallJournal;
    span?: SandboxCallContext["span"];
  } = {}
): SandboxPromise {
  const original =
    metadata.trackReplay === false
      ? promise
      : (promiseReplayContext.getStore()?.track(promise) ?? promise);
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

  return generator;
}

export function createSandboxMap(
  entries: Iterable<readonly [SandboxValue, SandboxValue]> = []
): SandboxMap {
  const map = {} as SandboxMap;

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
    [sandboxRegexPattern]: { value: pattern }
  });
  return Object.seal(regex);
}

export function getSandboxRegexPattern(regex: SandboxRegex): RegexPattern {
  return regex[sandboxRegexPattern];
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

export function cloneSandboxValue(value: SandboxValue, options: { compilation?: CompileScope; resetRegexLastIndex?: boolean; structuredClone?: boolean } = {}): SandboxValue {
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

  const visit = (value: unknown, depth = 0): void => {
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
    assertSandboxDataDepth(depth);
    seen.add(value);

    usage += 1;
    if (!isGuestHostObject(value)) {
      const descriptors = Object.getOwnPropertySymbols(value)
        .filter(key => !internalSymbols.has(key))
        .map(key => [key, Object.getOwnPropertyDescriptor(value, key)!] as const);
      for (const [key, descriptor] of descriptors) {
        usage += 1;
        visit(key, depth + 1);
        if ("value" in descriptor) visit(descriptor.value, depth + 1);
        else for (const closure of retainedAccessorClosures(descriptor)) visit(closure, depth + 1);
      }
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
    if (isSandboxDate(value)) usage += 8;
    if (isGuestHostObject(value)) {
      usage += measureHostObjectData(value);
      return;
    }
    const prototype = getSandboxPrototype(value);
    if (prototype !== null) visit(prototype, depth + 1);
    if (isFloat32Array(value)) {
      const storage = float32Storage(value);
      if (!seen.has(storage.buffer)) {
        seen.add(storage.buffer);
        usage += storage.byteLength;
      }
      for (const [key, descriptor] of float32DataProperties(value)) {
        usage += key.length + 1;
        visit(descriptor.value, depth + 1);
      }
      return;
    }
    if (Array.isArray(value)) {
      usage += value.length;
      if (hasManagedDescriptors(value)) {
        for (const [key, descriptor] of Object.entries(Object.getOwnPropertyDescriptors(value))) {
          if (key === "length") continue;
          usage += key.length + 1;
          if ("value" in descriptor) visit(descriptor.value, depth + 1);
          else for (const closure of retainedAccessorClosures(descriptor)) visit(closure, depth + 1);
        }
        return;
      }
      for (let index = 0; index < value.length; index += 1) {
        const descriptor = Object.getOwnPropertyDescriptor(value, index);
        if (descriptor !== undefined && "value" in descriptor) visit(descriptor.value, depth + 1);
      }
      return;
    }
    if (isSandboxMap(value)) {
      usage += value.entries.size;
      for (const [key, entry] of value.entries) {
        visit(key, depth + 1);
        visit(entry, depth + 1);
      }
      return;
    }
    if (isSandboxRegExpIterator(value)) {
      const state = regexpIteratorState(value);
      visit(state.matcher, depth + 1);
      visit(state.input, depth + 1);
      for (const [key, descriptor] of Object.entries(Object.getOwnPropertyDescriptors(value))) {
        usage += key.length + 1;
        if ("value" in descriptor) visit(descriptor.value, depth + 1);
      }
      return;
    }
    if (isSandboxCollectionIterator(value)) {
      visit(collectionIteratorState(value).collection, depth + 1);
      for (const [key, descriptor] of Object.entries(Object.getOwnPropertyDescriptors(value))) {
        usage += key.length + 1;
        if ("value" in descriptor) visit(descriptor.value, depth + 1);
      }
      return;
    }
    if (isSandboxSet(value)) {
      usage += value.values.size;
      for (const entry of value.values) visit(entry, depth + 1);
      return;
    }
    if (isSandboxClosure(value)) {
      if (options.ignoreClosures) return;
      if (value.properties !== undefined) {
        if (isIntrinsicConstructor(value)) {
          for (const [key, descriptor] of Object.entries(Object.getOwnPropertyDescriptors(value.properties))) {
            if (key === "prototype" || key === "name" || key === "length") continue;
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
    if (isSandboxGenerator(value)) {
      const snapshot = value.channel.snapshot();
      usage += snapshot.sent.length;
      for (const completion of snapshot.sent) visit(completion.value, depth + 1);
      return;
    }
    if (isSandboxPromise(value)) return;
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
      const entries = getSandboxArgumentEntries(value);
      usage += entries.length;
      for (const [key, entry] of entries) {
        usage += key.length;
        visit(entry, depth + 1);
      }
      return;
    }

    const descriptors = Object.getOwnPropertyDescriptors(value);
    const keys = Object.keys(descriptors);
    const includeNonEnumerable = isSandboxDate(value) || hasManagedDescriptors(value);
    let entryCount = 0;
    for (const key of keys) {
      if (descriptors[key].enumerable || includeNonEnumerable) entryCount += 1;
    }
    usage += entryCount;
    for (const key of keys) {
      const descriptor = descriptors[key];
      if (!descriptor.enumerable && !includeNonEnumerable) continue;
      usage += key.length;
      if ("value" in descriptor) visit(descriptor.value, depth + 1);
      else for (const closure of retainedAccessorClosures(descriptor)) visit(closure, depth + 1);
    }
  };

  for (const value of values) visit(value);
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
  if (parent !== undefined) measureSandboxData(escaping, { compileTickets: kept });
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
  if (isSandboxPrimitive(value)) {
    return value;
  }

  if (isLiveCapability(value)) throw new TypeError("Live capabilities require their owning realm bridge.");

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

  if (isSandboxRegExpIterator(value)) {
    if (hasGuestObjectState(value)) throw new TypeError("Guest prototype links and custom descriptors cannot be copied as data.");
    if (!cloneSandboxCollections) return value;
    const existing = state.seen.get(value);
    if (existing !== undefined) return existing;
    const snapshot = regexpIteratorState(value);
    const copy = restoreSandboxRegExpIterator({ matcher: undefined, input: undefined, exhausted: true });
    state.seen.set(value, copy);
    const matcher = copyToSandbox(snapshot.matcher, state, `${path}.<matcher>`, true, depth + 1);
    if (matcher !== undefined && !isSandboxRegex(matcher)) throw new TypeError("Invalid RegExp iterator matcher.");
    restoreSandboxRegExpIterator({ ...snapshot, matcher }, copy);
    for (const entry of getEnumerableObjectEntries(value, path)) {
      defineOwnDataProperty(copy, entry.key, copyToSandbox(entry.value, state, joinPath(path, entry.key), true, depth + 1));
    }
    return copy;
  }

  if (isSandboxCollectionIterator(value)) {
    if (hasGuestObjectState(value)) throw new TypeError("Guest prototype links and custom descriptors cannot be copied as data.");
    if (!cloneSandboxCollections) return value;
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

  if (typeof value === "object" && value !== null && hasGuestObjectState(value)) {
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
    for (const entry of value.values) {
      copy.values.add(copyToSandbox(entry, state, `${path}.<value>`, true, depth + 1));
    }
    return copy;
  }

  if (isHostPromise(value)) {
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

  if (nodeTypes.isDate(value)) {
    const existing = state.seen.get(value);
    if (existing !== undefined) return existing;
    const copy = copyNativeDate(value)!;
    state.seen.set(value, copy);
    for (const [key, descriptor] of dateDataProperties(value)) {
      Object.defineProperty(copy, key, { ...descriptor, value: copyToSandbox(descriptor.value, state, joinPath(path, key), cloneSandboxCollections, depth + 1) });
    }
    return copy;
  }

  if (isFloat32Array(value)) {
    const existing = state.seen.get(value);
    if (existing !== undefined) return existing;
    const copy = copyFloat32Storage(value, state);
    state.seen.set(value, copy);
    for (const [key, descriptor] of float32DataProperties(value)) {
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

    for (const entry of getEnumerableArrayEntries(value, path)) {
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
    const copy = createSandboxArguments([]);
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
      !cloneSandboxCollections || Object.getPrototypeOf(value) === null
    );
    state.seen.set(value, copy);
    const errorType = sandboxErrorTypes.get(value);
    if (errorType !== undefined) sandboxErrorTypes.set(copy, errorType);

    for (const entry of getEnumerableObjectEntries(value, path)) {
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

  if (isGuestHostObject(value)) {
    if (options.unwrapHostObject === undefined) throw new TypeError("Live capabilities require their owning realm bridge.");
    return options.unwrapHostObject(value);
  }

  if (nodeTypes.isProxy(value)) throw new TypeError("Unsupported proxy sandbox value.");
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

  if (isFloat32Array(value)) {
    const existing = state.seen.get(value);
    if (existing !== undefined) return existing;
    const copy = copyFloat32Storage(value, state);
    state.seen.set(value, copy);
    for (const [key, descriptor] of float32DataProperties(value)) {
      Object.defineProperty(copy, key, {
        ...descriptor,
        value: copyFromSandbox(descriptor.value, state, joinPath(path, key), options, depth + 1)
      });
    }
    if (!Object.isExtensible(value)) Object.preventExtensions(copy);
    return copy;
  }

  if (isSandboxDate(value)) {
    const existing = state.seen.get(value);
    if (existing !== undefined) return existing;
    const copy = exportDate(value);
    state.seen.set(value, copy);
    for (const [key, descriptor] of dateDataProperties(value)) {
      Object.defineProperty(copy, key, { ...descriptor, value: copyFromSandbox(descriptor.value, state, joinPath(path, key), options, depth + 1) });
    }
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
    return value.promise.then(copySettlement, (reason: SandboxValue) =>
      Promise.reject(reason instanceof SandboxError ? reason : copySettlement(reason))
    );
  }

  if (isSandboxGenerator(value)) {
    throw new TypeError("Sandbox generators cannot cross into host values.");
  }

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
    const copy = createSandboxArguments([]);
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

    const copy = createPlainObject(Object.getPrototypeOf(value) === null) as Record<
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
    typeof value === "boolean" ||
    typeof value === "symbol"
  );
}

function isHostPromise(value: unknown): value is Promise<unknown> {
  return value instanceof Promise;
}

function allocateSandboxValue(value: SandboxValue, budget: Budget, seen: WeakSet<object>): void {
  if (typeof value === "string") {
    budget.allocateString(value);
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

  if (isFloat32Array(value)) {
    if (seen.has(value)) return;
    seen.add(value);
    budget.allocateArrayLength(Math.ceil(float32Storage(value).byteLength / 4));
    for (const [key, descriptor] of float32DataProperties(value)) {
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
    for (const entry of value) {
      allocateSandboxValue(entry, budget, seen);
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
  path: string
): Array<{ key: string | symbol; value: TValue }> {
  const descriptors = Object.getOwnPropertyDescriptors(value);
  const entries: Array<{ key: string | symbol; value: TValue }> = [];

  for (const key of Reflect.ownKeys(descriptors)) {
    if (typeof key === "symbol" && internalSymbols.has(key)) continue;
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
  path: string
): Array<{ key: string | symbol; value: TValue }> {
  const descriptors = Object.getOwnPropertyDescriptors(value);
  const entries: Array<{ key: string | symbol; value: TValue }> = [];

  for (const key of Reflect.ownKeys(descriptors)) {
    if (typeof key === "symbol" && internalSymbols.has(key)) continue;
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

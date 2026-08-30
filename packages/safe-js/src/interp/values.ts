import { bindOtelSpan, getBoundOtelSpan } from "../observability/otel.js";
import type { Budget } from "./budget.js";
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
import {
  copySandboxArgumentProperties,
  createSandboxArguments,
  getSandboxArgumentEntries,
  isSandboxArguments
} from "./arguments.js";

export { createSandboxArguments, isSandboxArguments } from "./arguments.js";

const sandboxClosureBrand = Symbol("SandboxClosure");
const sandboxGeneratorBrand = Symbol("SandboxGenerator");
const sandboxMapBrand = Symbol("SandboxMap");
const sandboxPromiseBrand = Symbol("SandboxPromise");
const sandboxRegexBrand = Symbol("SandboxRegex");
const sandboxRegexPattern = Symbol("SandboxRegexPattern");
const sandboxSetBrand = Symbol("SandboxSet");
const sandboxRetainedValues = Symbol("SandboxRetainedValues");

export type SandboxPrimitive = string | number | boolean | null | undefined;

export type SandboxValue =
  | SandboxPrimitive
  | Float32Array
  | SandboxObject
  | SandboxArray
  | SandboxClosure
  | SandboxGenerator
  | SandboxMap
  | SandboxSet
  | SandboxPromise
  | SandboxRegex;

export type SandboxObject = {
  [key: string]: SandboxValue;
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
  lastIndex: number;
  readonly [sandboxRegexBrand]: true;
  readonly [sandboxRegexPattern]: RegexPattern;
};

export type SandboxCallContext = {
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
};

export type SandboxClosure = {
  readonly async?: true;
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
  state: "start" | "running" | "suspended" | "done";
  readonly channel: GeneratorChannel;
  readonly astNodeId?: number;
  readonly capturedScopeId?: number | string;
  readonly [sandboxGeneratorBrand]: true;
};

type CopyFromSandboxOptions = {
  wrapClosure?: (value: SandboxClosure) => unknown;
};

type CopyState<TValue> = {
  seen: WeakMap<object, TValue>;
};

export function createSandboxClosure(input: {
  async?: boolean;
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

  if (input.sandbox === true) {
    Object.defineProperty(closure, "sandbox", { value: true });
  }

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

  if (input.properties !== undefined) {
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
  metadata: { astNodeId: number; capturedScopeId: number | string } | undefined = undefined
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

export function createSandboxRegex(source: string, flags = "", lastIndex = 0): SandboxRegex {
  const regex = { kind: "regex", source, flags, lastIndex } as SandboxRegex;
  Object.defineProperties(regex, {
    [sandboxRegexBrand]: { value: true },
    [sandboxRegexPattern]: { value: parseRegex(source, flags) }
  });
  return Object.seal(regex);
}

export function getSandboxRegexPattern(regex: SandboxRegex): RegexPattern {
  return regex[sandboxRegexPattern];
}

export function isSandboxClosure(value: unknown): value is SandboxClosure {
  return typeof value === "object" && value !== null && sandboxClosureBrand in value;
}

export function isSandboxMap(value: unknown): value is SandboxMap {
  return typeof value === "object" && value !== null && sandboxMapBrand in value;
}

export function isSandboxPromise(value: unknown): value is SandboxPromise {
  return typeof value === "object" && value !== null && sandboxPromiseBrand in value;
}

export function isSandboxSet(value: unknown): value is SandboxSet {
  return typeof value === "object" && value !== null && sandboxSetBrand in value;
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

export function cloneSandboxValue(value: SandboxValue): SandboxValue {
  return copyToSandbox(
    value,
    {
      seen: new WeakMap()
    },
    "<root>",
    true
  );
}

export function allocateProducedSandboxValue(value: SandboxValue, budget: Budget): SandboxValue {
  allocateSandboxValue(value, budget, new WeakSet());
  return value;
}

export function measureSandboxData(
  values: Iterable<unknown>,
  options: { ignoreClosures?: boolean; ignoreClosureCaptures?: boolean } = {}
): number {
  const seen = new WeakSet<object>();
  let usage = 0;

  const visit = (value: unknown): void => {
    if (typeof value === "string") {
      usage += value.length;
      return;
    }
    if (typeof value !== "object" || value === null) return;
    if (seen.has(value)) return;
    seen.add(value);

    usage += 1;
    if (isFloat32Array(value)) {
      const storage = float32Storage(value);
      if (!seen.has(storage.buffer)) {
        seen.add(storage.buffer);
        usage += storage.byteLength;
      }
      for (const [key, descriptor] of float32DataProperties(value)) {
        usage += key.length + 1;
        visit(descriptor.value);
      }
      return;
    }
    if (Array.isArray(value)) {
      usage += value.length;
      for (let index = 0; index < value.length; index += 1) {
        const descriptor = Object.getOwnPropertyDescriptor(value, index);
        if (descriptor !== undefined && "value" in descriptor) visit(descriptor.value);
      }
      return;
    }
    if (isSandboxMap(value)) {
      usage += value.entries.size;
      for (const [key, entry] of value.entries) {
        visit(key);
        visit(entry);
      }
      return;
    }
    if (isSandboxSet(value)) {
      usage += value.values.size;
      for (const entry of value.values) visit(entry);
      return;
    }
    if (isSandboxClosure(value)) {
      if (options.ignoreClosures) return;
      if (value.properties !== undefined) visit(value.properties);
      if (!options.ignoreClosureCaptures)
        for (const retained of value[sandboxRetainedValues]?.() ?? []) visit(retained);
      return;
    }
    if (isSandboxGenerator(value)) {
      const snapshot = value.channel.snapshot();
      usage += snapshot.sent.length;
      for (const completion of snapshot.sent) visit(completion.value);
      return;
    }
    if (isSandboxPromise(value)) return;
    if (isSandboxRegex(value)) {
      usage += value.source.length + value.flags.length;
      return;
    }

    const entries = isSandboxArguments(value)
      ? getSandboxArgumentEntries(value)
      : Object.entries(Object.getOwnPropertyDescriptors(value))
          .filter(([, descriptor]) => descriptor.enumerable)
          .map(([key, descriptor]) => [key, "value" in descriptor ? descriptor.value : undefined]);
    usage += entries.length;
    for (const [key, entry] of entries) {
      usage += key.length;
      visit(entry);
    }
  };

  for (const value of values) visit(value);
  return usage;
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

  if (
    isSandboxClosure(value) ||
    isSandboxGenerator(value) ||
    isSandboxRegex(value) ||
    isSandboxPromise(value)
  ) {
    return value;
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
    return value.promise.then(
      (resolved) => copyFromSandbox(resolved, { seen: new WeakMap() }, "<root>", options),
      (reason: SandboxValue) =>
        Promise.reject(
          reason instanceof SandboxError
            ? reason
            : copyFromSandbox(reason, { seen: new WeakMap() }, "<root>", options)
        )
    );
  }

  if (isSandboxGenerator(value)) {
    throw new TypeError("Sandbox generators cannot cross into host values.");
  }

  if (isSandboxRegex(value)) {
    const regex = new RegExp(value.source, value.flags);
    regex.lastIndex = value.lastIndex;
    return regex;
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
    typeof value === "boolean"
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

export function defineOwnDataProperty(target: object, key: string, value: unknown): void {
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
): Array<{ key: string; value: TValue }> {
  const descriptors = Object.getOwnPropertyDescriptors(value);
  const entries: Array<{ key: string; value: TValue }> = [];

  for (const [key, descriptor] of Object.entries(descriptors)) {
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
): Array<{ key: string; value: TValue }> {
  const descriptors = Object.getOwnPropertyDescriptors(value);
  const entries: Array<{ key: string; value: TValue }> = [];

  for (const [key, descriptor] of Object.entries(descriptors)) {
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

function joinPath(path: string, key: string): string {
  return path === "<root>" ? `<root>.${key}` : `${path}.${key}`;
}

function joinArrayPath(path: string, key: string): string {
  return isArrayIndexKey(key) ? `${path}[${key}]` : joinPath(path, key);
}

import { hashSource } from "../parse/hash.js";
import { collectionIteratorState, isSandboxCollectionIterator, snapshotCollectionIterator, type CollectionIterationMethod, type SandboxCollectionIterator } from "../interp/collection-iterator.js";
import { hasGuestObjectState } from "../interp/object-model.js";
import { sandboxErrorTypes, type SandboxErrorName } from "../error/shape.js";
import { assertSnapshotGraphDepth } from "../graph-depth.js";
import { serializeArguments, type SerializedArguments } from "./arguments.js";
import { requiresArrayEntries, serializeArray, type SerializedArray } from "./arrays.js";
import { float32DataProperties, isFloat32Array } from "../interp/float32.js";
import { encodeFloat32Storage, type Float32Data } from "./float32array.js";
import { isSandboxDate, serializedDateTime } from "../interp/date.js";
import {
  isSandboxArguments,
  isSandboxGenerator,
  isSandboxMap,
  isSandboxRegex,
  isSandboxSet,
  type SandboxMap,
  type SandboxGenerator,
  type SandboxRegex,
  type SandboxSet
} from "../interp/values.js";

type SnapshotId = number | string;

type SerializedUndefinedValue = {
  kind: "undefined";
};

type SerializedNonFiniteNumber = {
  kind: "number";
  value: "-Infinity" | "Infinity" | "NaN" | "-0";
};

export type SerializedClosureValue = {
  kind: "fn";
  astNodeId: number;
  capturedScopeId: SnapshotId;
};

export type SerializedGeneratorValue =
  | {
      kind: "generator";
      state: "start";
      astNodeId: number;
      capturedScopeId: SnapshotId;
    }
  | {
      kind: "generator";
      state: "suspended";
      astNodeId: number;
      capturedScopeId: SnapshotId;
      yieldNodeId: number;
      sent: SerializedSnapshotValue;
    }
  | {
      kind: "generator";
      state: "done";
    };

export type SerializedPromiseValue = {
  kind: "promise";
  id: SnapshotId;
};

export type SerializedReferenceValue = {
  kind: "ref";
  id: number;
};

export type SerializedHeapValue =
  | { kind: "regex-object"; source: string; flags: string; lastIndex: SerializedSnapshotValue }
  | { kind: "collection-iterator"; collectionKind: "map" | "set"; method: CollectionIterationMethod; collection: SerializedSnapshotValue; index: number; exhausted: boolean; entries: Record<string, SerializedSnapshotValue> }
  | { kind: "date"; time: number | null }
  | (Float32Data<SerializedReferenceValue> & { entries: Record<string, SerializedSnapshotValue> })
  | SerializedArguments<SerializedSnapshotValue>
  | SerializedArray<SerializedSnapshotValue>
  | {
      kind: "object";
      entries: Record<string, SerializedSnapshotValue>;
      errorType?: SandboxErrorName;
    }
  | {
      kind: "map";
      entries: Array<[SerializedSnapshotValue, SerializedSnapshotValue]>;
    }
  | {
      kind: "set";
      values: SerializedSnapshotValue[];
    };

export type SerializedSnapshotValue =
  | boolean
  | null
  | number
  | string
  | SerializedClosureValue
  | SerializedGeneratorValue
  | SerializedNonFiniteNumber
  | SerializedPromiseValue
  | SerializedReferenceValue
  | SerializedUndefinedValue
  | { kind: "regex"; source: string; flags: string; lastIndex: number }
  | SerializedSnapshotValue[]
  | {
      [key: string]: SerializedSnapshotValue;
    };

export type RuntimeClosureValue = {
  kind: "fn";
  astNodeId: number;
  capturedScopeId: SnapshotId;
  call?: unknown;
};

export type RuntimePromiseValue = {
  kind: "promise";
  id: SnapshotId;
  promise?: Promise<unknown>;
};

export type RuntimeSnapshotValue =
  | Date
  | Float32Array
  | boolean
  | null
  | number
  | string
  | undefined
  | RuntimeClosureValue
  | SandboxGenerator
  | SandboxCollectionIterator
  | RuntimePromiseValue
  | SandboxMap
  | SandboxRegex
  | SandboxSet
  | RuntimeSnapshotValue[]
  | {
      [key: string]: RuntimeSnapshotValue;
    };

export type RuntimeScopeFrame = {
  id: SnapshotId;
  parentId?: SnapshotId;
  bindings: Record<string, RuntimeSnapshotValue>;
};

export type SerializedScopeFrame = {
  id: SnapshotId;
  parentId?: SnapshotId;
  bindings: Record<string, SerializedSnapshotValue>;
};

export type RuntimeCallFrame = {
  astNodeId: number;
  scopeId: SnapshotId;
  awaitingPromiseId?: SnapshotId;
};

export type SerializedCallFrame = RuntimeCallFrame;

export type RuntimePendingPromise = {
  id: SnapshotId;
  promise?: Promise<unknown>;
  [key: string]: RuntimeSnapshotValue | Promise<unknown> | SnapshotId | undefined;
};

export type SerializedPendingPromise = {
  id: SnapshotId;
  [key: string]: SerializedSnapshotValue | SnapshotId;
};

export type SerializeInput = {
  source: string;
  currentAstNodeId: number;
  scopeChain: RuntimeScopeFrame[];
  callStack: RuntimeCallFrame[];
  pendingPromises: RuntimePendingPromise[];
  moduleBindings: Record<string, string>;
};

export type SerializedSnapshot = {
  sourceHash: string;
  currentAstNodeId: number;
  scopeChain: SerializedScopeFrame[];
  callStack: SerializedCallFrame[];
  pendingPromises: SerializedPendingPromise[];
  moduleBindings: Record<string, string>;
  heap?: Record<string, SerializedHeapValue>;
};

type SerializationState = {
  float32Buffers: WeakMap<ArrayBuffer, number>;
  ancestors: WeakMap<object, string>;
  heap: Record<string, SerializedHeapValue>;
  heapIds: WeakMap<object, number>;
  serializedHeapIds: Set<number>;
};

export class UnsnapshotableValueError extends Error {
  readonly path: string;

  constructor(path: string) {
    super(
      "Cannot snapshot a generator suspended mid-iteration; drain or discard it before the await boundary."
    );
    this.name = "UnsnapshotableValueError";
    this.path = path;
  }
}

export function serialize(input: SerializeInput): SerializedSnapshot {
  for (const [scopeIndex, scope] of input.scopeChain.entries()) {
    for (const [name, value] of Object.entries(scope.bindings)) {
      assertSnapshotGraphDepth(value, `scopeChain[${scopeIndex}].bindings.${name}`);
    }
  }
  for (const [promiseIndex, promise] of input.pendingPromises.entries()) {
    for (const [key, value] of Object.entries(promise)) {
      if (key !== "id" && key !== "promise") {
        assertSnapshotGraphDepth(value, `pendingPromises[${promiseIndex}].${key}`);
      }
    }
  }
  const state: SerializationState = {
    float32Buffers: new WeakMap(),
    ancestors: new WeakMap(),
    heap: Object.create(null) as Record<string, SerializedHeapValue>,
    heapIds: indexHeapContainers(input),
    serializedHeapIds: new Set()
  };

  const snapshot: SerializedSnapshot = {
    sourceHash: hashSource(input.source),
    currentAstNodeId: input.currentAstNodeId,
    scopeChain: input.scopeChain.map((scope, index) =>
      serializeScopeFrame(scope, `scopeChain[${index}]`, state)
    ),
    callStack: input.callStack.map((frame) => ({ ...frame })),
    pendingPromises: input.pendingPromises.map((promise, index) =>
      serializePendingPromise(promise, `pendingPromises[${index}]`, state)
    ),
    moduleBindings: { ...input.moduleBindings }
  };

  if (Object.keys(state.heap).length === 0) {
    return snapshot;
  }

  return {
    ...snapshot,
    heap: state.heap
  };
}

function serializeScopeFrame(
  scope: RuntimeScopeFrame,
  path: string,
  state: SerializationState
): SerializedScopeFrame {
  const bindings = Object.create(null) as Record<string, SerializedSnapshotValue>;

  for (const [name, value] of Object.entries(scope.bindings)) {
    bindings[name] = serializeValue(value, `${path}.bindings.${name}`, state);
  }

  return scope.parentId === undefined
    ? {
        id: scope.id,
        bindings
      }
    : {
        id: scope.id,
        parentId: scope.parentId,
        bindings
      };
}

function serializePendingPromise(
  pendingPromise: RuntimePendingPromise,
  path: string,
  state: SerializationState
): SerializedPendingPromise {
  const serialized: SerializedPendingPromise = {
    id: pendingPromise.id
  };

  for (const [key, value] of Object.entries(pendingPromise)) {
    if (key === "id" || key === "promise") {
      continue;
    }

    serialized[key] = serializeValue(value as RuntimeSnapshotValue, `${path}.${key}`, state);
  }

  return serialized;
}

function serializeValue(
  value: RuntimeSnapshotValue,
  path: string,
  state: SerializationState
): SerializedSnapshotValue {
  if (typeof value === "object" && value !== null && hasGuestObjectState(value)) {
    throw new TypeError("Guest function properties and prototype links cannot be serialized.");
  }
  if (value === null || typeof value === "string" || typeof value === "boolean") {
    return value;
  }

  if (value === undefined) {
    return {
      kind: "undefined"
    };
  }

  if (typeof value === "number") {
    if (Object.is(value, -0)) return { kind: "number", value: "-0" };
    if (Number.isFinite(value)) {
      return value;
    }

    return {
      kind: "number",
      value: Number.isNaN(value)
        ? "NaN"
        : value === Number.POSITIVE_INFINITY
          ? "Infinity"
          : "-Infinity"
    };
  }

  if (Array.isArray(value)) {
    const reference = serializeHeapReference(value, path, state);
    if (reference !== undefined) {
      return reference;
    }

    return withSerializableContainer(value, path, state, () =>
      value.map((entry, index) => serializeValue(entry, `${path}[${index}]`, state))
    );
  }

  if (isRuntimeClosureValue(value)) {
    return {
      kind: "fn",
      astNodeId: value.astNodeId,
      capturedScopeId: value.capturedScopeId
    };
  }

  if (isSandboxGenerator(value)) {
    if (value.state === "done") {
      return {
        kind: "generator",
        state: "done"
      };
    }

    if (value.state === "suspended" || value.state === "running") {
      const continuation = value.channel.snapshot();
      if (continuation.yieldNodeId === undefined) {
        throw new UnsnapshotableValueError(path);
      }
      if (value.astNodeId === undefined || value.capturedScopeId === undefined) {
        throw new TypeError(`Cannot serialize generator without origin metadata at ${path}.`);
      }
      return {
        kind: "generator",
        state: "suspended",
        astNodeId: value.astNodeId,
        capturedScopeId: value.capturedScopeId,
        yieldNodeId: continuation.yieldNodeId,
        sent: serializeValue(continuation.sent as RuntimeSnapshotValue, `${path}.sent`, state)
      };
    }

    if (value.astNodeId === undefined || value.capturedScopeId === undefined) {
      throw new TypeError(`Cannot serialize generator without origin metadata at ${path}.`);
    }

    return {
      kind: "generator",
      state: "start",
      astNodeId: value.astNodeId,
      capturedScopeId: value.capturedScopeId
    };
  }

  if (isRuntimePromiseValue(value)) {
    return {
      kind: "promise",
      id: value.id
    };
  }

  if (isSandboxRegex(value)) {
    const reference = serializeHeapReference(value, path, state);
    if (reference !== undefined) return reference;
    if (typeof value.lastIndex !== "number") throw new TypeError(`Missing regex heap reference at ${path}.`);
    return { kind: "regex", source: value.source, flags: value.flags, lastIndex: value.lastIndex };
  }

  if (isSandboxDate(value) || isSandboxMap(value) || isSandboxSet(value) || isSandboxCollectionIterator(value) || isFloat32Array(value)) {
    const reference = serializeHeapReference(value, path, state);
    if (reference === undefined) {
      throw new TypeError(`Cannot serialize collection without a heap reference at ${path}.`);
    }
    return reference;
  }

  if (!isPlainObject(value)) {
    throw new TypeError(`Cannot serialize host reference at ${path}.`);
  }

  const reference = serializeHeapReference(value, path, state);
  if (reference !== undefined) {
    return reference;
  }

  const serialized = Object.create(null) as Record<string, SerializedSnapshotValue>;

  return withSerializableContainer(value, path, state, () => {
    for (const [key, entry] of Object.entries(value)) {
      serialized[key] = serializeValue(entry, `${path}.${key}`, state);
    }

    return serialized;
  });
}

function serializeHeapReference(
  value:
    | RuntimeSnapshotValue[]
    | Record<string, RuntimeSnapshotValue>
    | SandboxMap
    | SandboxSet
    | SandboxRegex
    | SandboxCollectionIterator
    | Date
    | Float32Array,
  path: string,
  state: SerializationState
): SerializedReferenceValue | undefined {
  const id = state.heapIds.get(value);
  if (id === undefined) {
    return undefined;
  }

  if (!state.serializedHeapIds.has(id)) {
    state.serializedHeapIds.add(id);

    if (isSandboxRegex(value)) {
      state.heap[String(id)] = { kind: "regex-object", source: value.source, flags: value.flags,
        lastIndex: serializeValue(value.lastIndex as RuntimeSnapshotValue, `${path}.lastIndex`, state) };
    } else if (isSandboxCollectionIterator(value)) {
      const snapshot = snapshotCollectionIterator(value);
      const entries: Record<string, SerializedSnapshotValue> = Object.create(null);
      state.heap[String(id)] = {
        kind: "collection-iterator", collectionKind: snapshot.collectionKind, method: snapshot.method,
        collection: serializeValue(snapshot.collection, `${path}.<collection>`, state),
        index: snapshot.index, exhausted: snapshot.exhausted, entries
      };
      for (const [key, entry] of Object.entries(value)) entries[key] = serializeValue(entry as RuntimeSnapshotValue, `${path}.${key}`, state);
    } else if (isSandboxDate(value)) {
      state.heap[String(id)] = { kind: "date", time: serializedDateTime(value) };
    } else if (isFloat32Array(value)) {
      const storage = encodeFloat32Storage(value, id, state.float32Buffers, (id) => ({
        kind: "ref" as const,
        id
      }));
      const entries: Record<string, SerializedSnapshotValue> = Object.create(null);
      state.heap[String(id)] = { ...storage, entries };
      for (const [key, descriptor] of float32DataProperties(value))
        entries[key] = serializeValue(descriptor.value, `${path}.${key}`, state);
    } else if (isSandboxArguments(value)) {
      state.heap[String(id)] = serializeArguments(value, (entry, key) =>
        serializeValue(entry as RuntimeSnapshotValue, `${path}.${key}`, state)
      );
    } else if (isSandboxMap(value)) {
      state.heap[String(id)] = {
        kind: "map",
        entries: [...value.entries].map(([key, entry], index) => [
          serializeValue(key as RuntimeSnapshotValue, `${path}.entries[${index}][0]`, state),
          serializeValue(entry as RuntimeSnapshotValue, `${path}.entries[${index}][1]`, state)
        ])
      };
    } else if (isSandboxSet(value)) {
      state.heap[String(id)] = {
        kind: "set",
        values: [...value.values].map((entry, index) =>
          serializeValue(entry as RuntimeSnapshotValue, `${path}.values[${index}]`, state)
        )
      };
    } else if (Array.isArray(value)) {
      state.heap[String(id)] = serializeArray(value, (entry, key) =>
        serializeValue(entry as RuntimeSnapshotValue, `${path}[${key}]`, state)
      );
    } else {
      const entries = Object.create(null) as Record<string, SerializedSnapshotValue>;
      const errorType = sandboxErrorTypes.get(value);
      state.heap[String(id)] = {
        kind: "object",
        entries,
        ...(errorType === undefined ? {} : { errorType })
      };

      for (const [key, entry] of Object.entries(value)) {
        entries[key] = serializeValue(entry, `${path}.${key}`, state);
      }
    }
  }

  return {
    kind: "ref",
    id
  };
}

function isRuntimeClosureValue(value: unknown): value is RuntimeClosureValue {
  return (
    typeof value === "object" &&
    value !== null &&
    hasOwnProperty(value, "kind") &&
    value.kind === "fn" &&
    hasOwnProperty(value, "astNodeId") &&
    typeof value.astNodeId === "number" &&
    hasOwnProperty(value, "capturedScopeId") &&
    (typeof value.capturedScopeId === "number" || typeof value.capturedScopeId === "string")
  );
}

function isRuntimePromiseValue(value: unknown): value is RuntimePromiseValue {
  return (
    typeof value === "object" &&
    value !== null &&
    hasOwnProperty(value, "kind") &&
    value.kind === "promise" &&
    hasOwnProperty(value, "id")
  );
}

function isPlainObject(value: object): value is Record<string, RuntimeSnapshotValue> {
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function hasOwnProperty<Name extends PropertyKey>(
  value: object,
  name: Name
): value is Record<Name, unknown> {
  return Object.prototype.hasOwnProperty.call(value, name);
}

function withSerializableContainer<TValue>(
  value: object,
  path: string,
  state: SerializationState,
  serializeContainer: () => TValue
): TValue {
  const ancestorPath = state.ancestors.get(value);
  if (ancestorPath !== undefined) {
    throw new TypeError(`Cannot serialize cyclic value at ${path}.`);
  }

  state.ancestors.set(value, path);

  try {
    return serializeContainer();
  } finally {
    state.ancestors.delete(value);
  }
}

function indexHeapContainers(input: SerializeInput): WeakMap<object, number> {
  const stats = new Map<
    object,
    {
      count: number;
      cyclic: boolean;
      expanded: boolean;
    }
  >();
  const ancestors = new WeakSet<object>();

  for (const scope of input.scopeChain) {
    for (const value of Object.values(scope.bindings)) {
      collectContainerStats(value, stats, ancestors);
    }
  }

  for (const promise of input.pendingPromises) {
    for (const [key, value] of Object.entries(promise)) {
      if (key === "id" || key === "promise") {
        continue;
      }

      collectContainerStats(value as RuntimeSnapshotValue, stats, ancestors);
    }
  }

  const heapIds = new WeakMap<object, number>();
  let nextId = 1;
  for (const [value, stat] of stats.entries()) {
    if (
      stat.count > 1 ||
      stat.cyclic ||
      (isSandboxRegex(value) && (!Number.isSafeInteger(value.lastIndex) ||
        (typeof value.lastIndex === "number" && value.lastIndex < 0) || Object.is(value.lastIndex, -0))) ||
      isSandboxDate(value) ||
      isFloat32Array(value) ||
      (Array.isArray(value) && requiresArrayEntries(value)) ||
      sandboxErrorTypes.has(value) ||
      isSandboxArguments(value) ||
      isSandboxCollectionIterator(value) ||
      isSandboxMap(value) ||
      isSandboxSet(value)
    ) {
      heapIds.set(value, nextId);
      nextId += 1;
    }
  }

  return heapIds;
}

function collectContainerStats(
  value: RuntimeSnapshotValue,
  stats: Map<object, { count: number; cyclic: boolean; expanded: boolean }>,
  ancestors: WeakSet<object>
): void {
  if (
    value === null ||
    typeof value !== "object" ||
    isRuntimeClosureValue(value) ||
    isRuntimePromiseValue(value) ||
    isSandboxGenerator(value)
  ) {
    return;
  }

  if (
    !Array.isArray(value) &&
    !isPlainObject(value) &&
    !isSandboxDate(value) &&
    !isFloat32Array(value) &&
    !isSandboxMap(value) &&
    !isSandboxCollectionIterator(value) &&
    !isSandboxSet(value)
  ) {
    return;
  }

  let stat = stats.get(value);
  if (stat === undefined) {
    stat = {
      count: 0,
      cyclic: false,
      expanded: false
    };
    stats.set(value, stat);
  }

  stat.count += 1;

  if (ancestors.has(value)) {
    stat.cyclic = true;
    return;
  }

  if (stat.expanded) {
    return;
  }

  stat.expanded = true;
  ancestors.add(value);

  const entries = isSandboxCollectionIterator(value)
    ? [collectionIteratorState(value).collection, ...Object.values(value)]
    : isSandboxArguments(value)
    ? Object.values(Object.getOwnPropertyDescriptors(value)).flatMap((descriptor) =>
        "value" in descriptor ? [descriptor.value] : []
      )
    : isSandboxMap(value)
      ? [...value.entries].flatMap(([key, entry]) => [key, entry])
      : isSandboxSet(value)
        ? [...value.values]
        : Object.values(value);
  for (const entry of entries) {
    collectContainerStats(entry as RuntimeSnapshotValue, stats, ancestors);
  }

  ancestors.delete(value);
}

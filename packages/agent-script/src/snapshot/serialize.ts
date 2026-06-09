import { hashSource } from "../parse/hash.js";

type SnapshotId = number | string;

type SerializedUndefinedValue = {
  kind: "undefined";
};

type SerializedNonFiniteNumber = {
  kind: "number";
  value: "-Infinity" | "Infinity" | "NaN";
};

export type SerializedClosureValue = {
  kind: "fn";
  astNodeId: number;
  capturedScopeId: SnapshotId;
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
  | {
      kind: "array";
      items: SerializedSnapshotValue[];
    }
  | {
      kind: "object";
      entries: Record<string, SerializedSnapshotValue>;
    };

export type SerializedSnapshotValue =
  | boolean
  | null
  | number
  | string
  | SerializedClosureValue
  | SerializedNonFiniteNumber
  | SerializedPromiseValue
  | SerializedReferenceValue
  | SerializedUndefinedValue
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
  | boolean
  | null
  | number
  | string
  | undefined
  | RuntimeClosureValue
  | RuntimePromiseValue
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
  ancestors: WeakMap<object, string>;
  heap: Record<string, SerializedHeapValue>;
  heapIds: WeakMap<object, number>;
  serializedHeapIds: Set<number>;
};

export function serialize(input: SerializeInput): SerializedSnapshot {
  const state: SerializationState = {
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
  if (value === null || typeof value === "string" || typeof value === "boolean") {
    return value;
  }

  if (value === undefined) {
    return {
      kind: "undefined"
    };
  }

  if (typeof value === "number") {
    if (Number.isFinite(value)) {
      return value;
    }

    return {
      kind: "number",
      value:
        Number.isNaN(value) ? "NaN" : value === Number.POSITIVE_INFINITY ? "Infinity" : "-Infinity"
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

  if (isRuntimePromiseValue(value)) {
    return {
      kind: "promise",
      id: value.id
    };
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
  value: RuntimeSnapshotValue[] | Record<string, RuntimeSnapshotValue>,
  path: string,
  state: SerializationState
): SerializedReferenceValue | undefined {
  const id = state.heapIds.get(value);
  if (id === undefined) {
    return undefined;
  }

  if (!state.serializedHeapIds.has(id)) {
    state.serializedHeapIds.add(id);

    if (Array.isArray(value)) {
      state.heap[String(id)] = {
        kind: "array",
        items: value.map((entry, index) => serializeValue(entry, `${path}[${index}]`, state))
      };
    } else {
      const entries = Object.create(null) as Record<string, SerializedSnapshotValue>;
      state.heap[String(id)] = {
        kind: "object",
        entries
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
    if (stat.count > 1 || stat.cyclic) {
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
    isRuntimePromiseValue(value)
  ) {
    return;
  }

  if (!Array.isArray(value) && !isPlainObject(value)) {
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

  const entries = Array.isArray(value) ? value : Object.values(value);
  for (const entry of entries) {
    collectContainerStats(entry, stats, ancestors);
  }

  ancestors.delete(value);
}

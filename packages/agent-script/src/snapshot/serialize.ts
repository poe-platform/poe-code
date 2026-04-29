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

export type SerializedSnapshotValue =
  | boolean
  | null
  | number
  | string
  | SerializedClosureValue
  | SerializedNonFiniteNumber
  | SerializedPromiseValue
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
};

type SerializationState = {
  ancestors: WeakMap<object, string>;
};

export function serialize(input: SerializeInput): SerializedSnapshot {
  const state: SerializationState = {
    ancestors: new WeakMap()
  };

  return {
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
}

function serializeScopeFrame(
  scope: RuntimeScopeFrame,
  path: string,
  state: SerializationState
): SerializedScopeFrame {
  const bindings: Record<string, SerializedSnapshotValue> = {};

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

  const serialized: Record<string, SerializedSnapshotValue> = {};

  return withSerializableContainer(value, path, state, () => {
    for (const [key, entry] of Object.entries(value)) {
      serialized[key] = serializeValue(entry, `${path}.${key}`, state);
    }

    return serialized;
  });
}

function isRuntimeClosureValue(value: unknown): value is RuntimeClosureValue {
  return (
    typeof value === "object" &&
    value !== null &&
    "kind" in value &&
    value.kind === "fn" &&
    "astNodeId" in value &&
    typeof value.astNodeId === "number" &&
    "capturedScopeId" in value &&
    (typeof value.capturedScopeId === "number" || typeof value.capturedScopeId === "string")
  );
}

function isRuntimePromiseValue(value: unknown): value is RuntimePromiseValue {
  return typeof value === "object" && value !== null && "kind" in value && value.kind === "promise" && "id" in value;
}

function isPlainObject(value: object): value is Record<string, RuntimeSnapshotValue> {
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
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

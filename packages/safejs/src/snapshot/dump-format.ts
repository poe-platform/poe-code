export const DUMP_FORMAT_VERSION = 1;
export const EXECUTION_SEMANTICS = "jobs-v5";
import { assertSnapshotGraphDepth } from "../graph-depth.js";
import { sandboxErrorTypes, type SandboxErrorName } from "../error/shape.js";
import { getSandboxArgumentEntries, isSandboxArguments } from "../interp/arguments.js";
import { serializeArguments, type SerializedArguments } from "./arguments.js";

const SKIP_VALUE = Symbol("SafeJS.skip-dump-value");

type DumpPrimitive = boolean | null | number | string;

type DumpValue =
  | DumpPrimitive
  | DumpValue[]
  | {
      [key: string]: DumpValue;
    };

type DumpHeapValue =
  | SerializedArguments<DumpValue>
  | {
      kind: "array";
      items: DumpValue[];
    }
  | {
      kind: "object";
      entries: Record<string, DumpValue>;
      errorType?: SandboxErrorName;
    };

type DumpState = {
  heap: Record<string, DumpHeapValue>;
  heapIds: WeakMap<object, number>;
  serializedHeapIds: Set<number>;
};

type ContainerStat = {
  count: number;
  cyclic: boolean;
  expanded: boolean;
};

export type DumpableSnapshot = {
  sourceHash: string;
  [key: string]: unknown;
};

export function serializeSafeJSSnapshot(snapshot: DumpableSnapshot): string {
  const replayError = Object.getOwnPropertyDescriptor(snapshot, "replayError");
  if (replayError !== undefined) {
    const reason =
      "value" in replayError && typeof replayError.value === "string"
        ? replayError.value
        : "missing resume capability";
    throw new TypeError(`Snapshot is not replayable: ${reason}`);
  }
  for (const [key, value] of getEnumerableDataEntries(snapshot)) {
    if (key !== "version" && key !== "sourceHash" && key !== "heap") {
      assertSnapshotGraphDepth(value, key);
    }
  }
  return JSON.stringify(createDumpFile(snapshot), null, 2);
}

function createDumpFile(snapshot: DumpableSnapshot): Record<string, DumpValue> {
  const state: DumpState = {
    heap: {},
    heapIds: indexHeapContainers(snapshot),
    serializedHeapIds: new Set()
  };
  const dumped: Record<string, DumpValue> = {
    version: DUMP_FORMAT_VERSION,
    sourceHash: snapshot.sourceHash
  };

  for (const [key, value] of getEnumerableDataEntries(snapshot)) {
    if (key === "version" || key === "sourceHash" || key === "heap") {
      continue;
    }

    const serialized = serializeDumpValue(value, key, state);
    if (serialized !== SKIP_VALUE) {
      dumped[key] = serialized;
    }
  }

  if (Object.keys(state.heap).length > 0) {
    dumped.heap = state.heap;
  }

  return dumped;
}

function serializeDumpValue(
  value: unknown,
  path: string,
  state: DumpState
): DumpValue | typeof SKIP_VALUE {
  if (value === null || typeof value === "string" || typeof value === "boolean") {
    return value;
  }

  if (typeof value === "number") {
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

  if (typeof value !== "object") {
    return SKIP_VALUE;
  }

  if (Array.isArray(value)) {
    const reference = serializeHeapReference(value, path, state);
    if (reference !== undefined) {
      return reference;
    }

    return serializeArrayItems(value, path, state);
  }

  if (!isPlainObject(value)) {
    return SKIP_VALUE;
  }

  const reference = serializeHeapReference(value, path, state);
  if (reference !== undefined) {
    return reference;
  }

  return serializeObjectEntries(value, path, state);
}

function serializeHeapReference(
  value: unknown[] | Record<string, unknown>,
  path: string,
  state: DumpState
):
  | {
      kind: "ref";
      id: number;
    }
  | undefined {
  const id = state.heapIds.get(value);
  if (id === undefined) {
    return undefined;
  }

  if (!state.serializedHeapIds.has(id)) {
    state.serializedHeapIds.add(id);

    if (isSandboxArguments(value)) {
      state.heap[String(id)] = serializeArguments(value, (entry, key) => {
        const serialized = serializeDumpValue(entry, `${path}.${key}`, state);
        return serialized === SKIP_VALUE ? { kind: "undefined" } : serialized;
      });
    } else if (Array.isArray(value)) {
      state.heap[String(id)] = {
        kind: "array",
        items: serializeArrayItems(value, path, state)
      };
    } else {
      const errorType = sandboxErrorTypes.get(value);
      state.heap[String(id)] = {
        kind: "object",
        entries: serializeObjectEntries(value, path, state),
        ...(errorType === undefined ? {} : { errorType })
      };
    }
  }

  return {
    kind: "ref",
    id
  };
}

function serializeObjectEntries(
  value: Record<string, unknown>,
  path: string,
  state: DumpState
): Record<string, DumpValue> {
  const serialized: Record<string, DumpValue> = {};

  for (const [key, entry] of getEnumerableDataEntries(value)) {
    const dumped = serializeDumpValue(entry, `${path}.${key}`, state);
    if (dumped !== SKIP_VALUE) {
      serialized[key] = dumped;
    }
  }

  return serialized;
}

function indexHeapContainers(snapshot: DumpableSnapshot): WeakMap<object, number> {
  const stats = new Map<object, ContainerStat>();
  const ancestors = new WeakSet<object>();

  for (const [key, value] of getEnumerableDataEntries(snapshot)) {
    if (key === "version" || key === "sourceHash" || key === "heap") {
      continue;
    }

    collectContainerStats(value, stats, ancestors);
  }

  const heapIds = new WeakMap<object, number>();
  let nextId = 1;
  for (const [value, stat] of stats.entries()) {
    if (
      stat.count > 1 ||
      stat.cyclic ||
      isSandboxArguments(value) ||
      sandboxErrorTypes.has(value)
    ) {
      heapIds.set(value, nextId);
      nextId += 1;
    }
  }

  return heapIds;
}

function collectContainerStats(
  value: unknown,
  stats: Map<object, ContainerStat>,
  ancestors: WeakSet<object>
): void {
  if (value === null || typeof value !== "object") {
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

  const entries = isSandboxArguments(value)
    ? getSandboxArgumentEntries(value).map(([, entry]) => entry)
    : Array.isArray(value)
      ? getArrayDataItems(value)
      : getEnumerableDataValues(value);
  for (const entry of entries) {
    collectContainerStats(entry, stats, ancestors);
  }

  ancestors.delete(value);
}

function isPlainObject(value: object): value is Record<string, unknown> {
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function serializeArrayItems(value: unknown[], path: string, state: DumpState): DumpValue[] {
  return getArrayDataItems(value).map((entry, index) => {
    const serialized = serializeDumpValue(entry, `${path}[${index}]`, state);
    return serialized === SKIP_VALUE ? { kind: "undefined" } : serialized;
  });
}

function getArrayDataItems(value: unknown[]): unknown[] {
  const items: unknown[] = [];

  for (let index = 0; index < value.length; index += 1) {
    const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
    items.push(descriptor !== undefined && "value" in descriptor ? descriptor.value : undefined);
  }

  return items;
}

function getEnumerableDataEntries(value: Record<string, unknown>): Array<[string, unknown]> {
  const entries: Array<[string, unknown]> = [];

  for (const [key, descriptor] of Object.entries(Object.getOwnPropertyDescriptors(value))) {
    if (!descriptor.enumerable || !("value" in descriptor)) {
      continue;
    }

    entries.push([key, descriptor.value]);
  }

  return entries;
}

function getEnumerableDataValues(value: Record<string, unknown>): unknown[] {
  return getEnumerableDataEntries(value).map(([, entry]) => entry);
}

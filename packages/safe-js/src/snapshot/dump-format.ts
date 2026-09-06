export const DUMP_FORMAT_VERSION = 2;
export const inMemoryRunSnapshots = new WeakSet<object>();
import { getRegexProperties, isSandboxPromise, isSandboxRegex } from "../interp/values.js";
import { isPromiseResolvingFunction } from "../interp/promise.js";
import { isSandboxRegExpIterator, regexpIteratorState } from "../interp/regexp-iterator.js";
import { hasCustomRegexProperties, serializeRegexProperties, type RegexPropertyData } from "./regexp-properties.js";
export const EXECUTION_SEMANTICS = "jobs-v8";
import { assertSnapshotGraphDepth, assertSnapshotDataDepth } from "../graph-depth.js";
import { captureGuestHeapNode, type GuestHeapNode } from "./guest-heap.js";
import { hasGuestObjectState, hasNullObjectPrototype } from "../interp/object-model.js";
import { sandboxErrorTypes, type SandboxErrorName } from "../error/shape.js";
import { getSandboxArgumentEntries, isSandboxArguments } from "../interp/arguments.js";
import { serializeArguments, type SerializedArguments } from "./arguments.js";
import { requiresArrayEntries, serializeArray, type SerializedArray } from "./arrays.js";
import { float32DataProperties, isFloat32Array } from "../interp/float32.js";
import { encodeFloat32Storage, type Float32Data } from "./float32array.js";
import { dateDataProperties, isSandboxDate } from "../interp/date.js";
import { serializeDate, type SerializedDate } from "./date-properties.js";
import { boxedDataProperties, isSandboxBox } from "../interp/boxed.js";
import { encodeBoxedData, type BoxedData } from "./boxed.js";
import { ownSerializableSymbolKeys, serializeSymbol, serializeSymbolProperties, type SerializedSymbol, type SerializedSymbolProperty } from "./symbols.js";

const SKIP_VALUE = Symbol("SafeJS.skip-dump-value");

type DumpPrimitive = boolean | null | number | string;

type DumpValue =
  | DumpPrimitive
  | DumpValue[]
  | {
      [key: string]: DumpValue;
    };

type DumpHeapValue =
  | GuestHeapNode<DumpValue>
  | { kind: "regexp-iterator"; matcher: DumpValue; input: DumpValue; exhausted: boolean; global?: boolean; unicode?: boolean; entries: Record<string, DumpValue>; symbolEntries?: Array<SerializedSymbolProperty<DumpValue>> }
  | ({ kind: "regex-object"; source: string; flags: string; lastIndex: DumpValue } & RegexPropertyData<DumpValue>)
  | SerializedSymbol
  | BoxedData<DumpValue>
  | SerializedDate<DumpValue>
  | (Float32Data<DumpValue> & { entries: Record<string, DumpValue> })
  | SerializedArguments<DumpValue>
  | SerializedArray<DumpValue>
  | {
      kind: "object";
      sandboxNullPrototype?: true;
      entries: Record<string, DumpValue>;
      symbolEntries?: Array<SerializedSymbolProperty<DumpValue>>;
      errorType?: SandboxErrorName;
    };

type DumpState = {
  trustedRunReplay: boolean;
  float32Buffers: WeakMap<ArrayBuffer, number>;
  heap: Record<string, DumpHeapValue>;
  heapIds: Map<object | symbol, number>;
  serializedHeapIds: Set<number>;
  guestValues: Set<object>;
};

type ContainerStat = {
  count: number;
  cyclic: boolean;
  expanded: boolean;
  forceHeap?: boolean;
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
    trustedRunReplay: inMemoryRunSnapshots.has(snapshot),
    float32Buffers: new WeakMap(),
    heap: {},
    ...indexHeapContainers(snapshot),
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
  if (typeof value === "bigint") return { kind: "bigint", value: String(value) };
  if (typeof value === "symbol") return serializeSymbol(value, state.heapIds, state.heap);
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

  if (state.guestValues.has(value)) {
    const id = state.heapIds.get(value)!;
    if (!state.serializedHeapIds.has(id)) {
      state.serializedHeapIds.add(id);
      const node = captureGuestHeapNode(value, entry => {
        if (entry === undefined) return { kind: "undefined" };
        const serialized = serializeDumpValue(entry, `${path}.<guest>`, state);
        if (serialized === SKIP_VALUE) throw new TypeError(`Unsupported guest graph value at ${path}.`);
        return serialized;
      });
      if (node === undefined) throw new TypeError(`Missing guest heap node at ${path}.`);
      state.heap[String(id)] = node;
    }
    return { kind: "ref", id };
  }

  // Trusted run snapshots rebuild Date, promise and resolver properties by replay;
  // retain their ordinary runtime metadata below. Arbitrary snapshot inputs
  // still cannot serialize their managed state through this path.
  if (hasGuestObjectState(value) && !(state.trustedRunReplay && (isSandboxDate(value) || isSandboxPromise(value) || isPromiseResolvingFunction(value)))) {
    throw new TypeError("Guest function properties and prototype links cannot be serialized.");
  }

  if (isSandboxRegExpIterator(value) || (isSandboxRegex(value) && hasCustomRegexProperties(value)) || isSandboxBox(value) || isSandboxDate(value) || isFloat32Array(value)) return serializeHeapReference(value, path, state)!;

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
  value: unknown[] | Record<string, unknown> | Float32Array | Date,
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

    if (isSandboxRegExpIterator(value)) {
      const snapshot = regexpIteratorState(value);
      const matcher = snapshot.matcher;
      const serializedMatcher: DumpValue | typeof SKIP_VALUE = snapshot.global === undefined && isSandboxRegex(matcher)
        ? { kind: "regex", source: matcher.source, flags: matcher.flags, lastIndex: Number(matcher.lastIndex) }
        : serializeDumpValue(matcher, `${path}.<matcher>`, state);
      if (serializedMatcher === SKIP_VALUE) throw new TypeError("Unsupported RegExp iterator matcher in public dump.");
      const entries: Record<string, DumpValue> = Object.create(null);
      state.heap[String(id)] = {
        kind: "regexp-iterator", exhausted: snapshot.exhausted,
        matcher: serializedMatcher,
        ...(snapshot.global === undefined ? {} : { global: snapshot.global, unicode: snapshot.unicode }),
        input: snapshot.input ?? { kind: "undefined" }, entries,
        symbolEntries: serializeSymbolProperties(value, entry => {
          const serialized = serializeDumpValue(entry, `${path}.[symbol]`, state);
          if (serialized === SKIP_VALUE) throw new TypeError("Unsupported RegExp iterator symbol property in public dump.");
          return serialized;
        })
      };
      for (const [key, entry] of getEnumerableDataEntries(value)) {
        const serialized = serializeDumpValue(entry, `${path}.${key}`, state);
        if (serialized === SKIP_VALUE) throw new TypeError("Unsupported RegExp iterator property in public dump.");
        entries[key] = serialized;
      }
    } else if (isSandboxRegex(value) && hasCustomRegexProperties(value)) {
      const encode = (entry: unknown): DumpValue => {
        const serialized = serializeDumpValue(entry, `${path}.<regex-property>`, state);
        if (serialized === SKIP_VALUE) throw new TypeError("Unsupported RegExp property in public dump.");
        return serialized;
      };
      state.heap[String(id)] = { kind: "regex-object", source: value.source, flags: value.flags,
        lastIndex: encode(value.lastIndex), ...serializeRegexProperties(value, encode) };
    } else if (isSandboxBox(value)) {
      state.heap[String(id)] = encodeBoxedData(value, (entry, key) => {
        if (Object.is(entry, -0)) return { kind: "number", value: "-0" };
        const serialized = serializeDumpValue(entry, `${path}.${key}`, state);
        return serialized === SKIP_VALUE ? { kind: "undefined" } : serialized;
      });
    } else if (isSandboxDate(value)) {
      state.heap[String(id)] = serializeDate(value, entry => {
        const serialized = serializeDumpValue(entry, `${path}.<date-property>`, state);
        return serialized === SKIP_VALUE ? { kind: "undefined" } : serialized;
      });
    } else if (isFloat32Array(value)) {
      const storage = encodeFloat32Storage(value, id, state.float32Buffers, (id) => ({
        kind: "ref",
        id
      }));
      const entries: Record<string, DumpValue> = Object.create(null);
      state.heap[String(id)] = { ...storage, entries };
      for (const [key, descriptor] of float32DataProperties(value)) {
        const serialized = serializeDumpValue(descriptor.value, `${path}.${key}`, state);
        entries[key] = serialized === SKIP_VALUE ? { kind: "undefined" } : serialized;
      }
    } else if (isSandboxArguments(value)) {
      state.heap[String(id)] = serializeArguments(value, (entry, key) => {
        const serialized = serializeDumpValue(entry, `${path}.${key}`, state);
        return serialized === SKIP_VALUE ? { kind: "undefined" } : serialized;
      });
    } else if (Array.isArray(value)) {
      const array = serializeArray(value, (entry, key) => {
        const serialized = serializeDumpValue(entry, `${path}[${key}]`, state);
        return serialized === SKIP_VALUE ? { kind: "undefined" } : serialized;
      });
      state.heap[String(id)] = array;
      const symbols = serializeSymbolProperties(value, entry => {
        const serialized = serializeDumpValue(entry, `${path}.[symbol]`, state);
        return serialized === SKIP_VALUE ? { kind: "undefined" } : serialized;
      });
      if (symbols.length > 0) array.symbolEntries = symbols;
    } else {
      const errorType = sandboxErrorTypes.get(value);
      const symbolEntries = serializeSymbolProperties(value, entry => {
        const serialized = serializeDumpValue(entry, `${path}.[symbol]`, state);
        return serialized === SKIP_VALUE ? { kind: "undefined" } : serialized;
      });
      state.heap[String(id)] = {
        kind: "object",
        ...(hasNullObjectPrototype(value) ? { sandboxNullPrototype: true as const } : {}),
        entries: serializeObjectEntries(value, path, state),
        ...(symbolEntries.length === 0 ? {} : { symbolEntries }),
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

function indexHeapContainers(snapshot: DumpableSnapshot): Pick<DumpState, "heapIds" | "guestValues"> {
  const stats = new Map<object, ContainerStat>();
  const ancestors = new WeakSet<object>();
  const guestValues = new Set<object>();

  for (const [key, value] of getEnumerableDataEntries(snapshot)) {
    if (key === "version" || key === "sourceHash" || key === "heap") {
      continue;
    }

    collectContainerStats(value, stats, ancestors, guestValues);
  }

  const heapIds = new Map<object | symbol, number>();
  let nextId = 1;
  for (const [value, stat] of stats.entries()) {
    if (
      stat.count > 1 ||
      stat.forceHeap === true ||
      guestValues.has(value) ||
      stat.cyclic ||
      hasNullObjectPrototype(value) ||
      ownSerializableSymbolKeys(value).length > 0 ||
      isSandboxBox(value) ||
      isSandboxRegExpIterator(value) ||
      (isSandboxRegex(value) && hasCustomRegexProperties(value)) ||
      isSandboxDate(value) ||
      isFloat32Array(value) ||
      (Array.isArray(value) && requiresArrayEntries(value)) ||
      isSandboxArguments(value) ||
      sandboxErrorTypes.has(value)
    ) {
      heapIds.set(value, nextId);
      nextId += 1;
    }
  }

  return { heapIds, guestValues };
}

function collectContainerStats(
  value: unknown,
  stats: Map<object, ContainerStat>,
  ancestors: WeakSet<object>,
  guestValues: Set<object>,
  depth = 0
): void {
  if (value === null || typeof value !== "object") {
    return;
  }

  assertSnapshotDataDepth(depth, "<snapshot-heap>");

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

  const guestEntries: unknown[] = [];
  const guest = captureGuestHeapNode(value, entry => { guestEntries.push(entry); return null; });
  if (guest !== undefined) {
    guestValues.add(value);
    for (const entry of guestEntries) {
      collectContainerStats(entry, stats, ancestors, guestValues, depth + 1);
      if (entry !== null && typeof entry === "object") stats.get(entry)!.forceHeap = true;
    }
    ancestors.delete(value);
    return;
  }
  if (!Array.isArray(value) && !isPlainObject(value) && !isFloat32Array(value) && !isSandboxDate(value)) {
    ancestors.delete(value);
    return;
  }

  const entries = isSandboxRegex(value)
    ? Reflect.ownKeys(getRegexProperties(value)).flatMap(key => {
      const descriptor = Object.getOwnPropertyDescriptor(getRegexProperties(value), key)!;
      return "value" in descriptor ? [descriptor.value] : [];
    })
    : isSandboxDate(value)
    ? dateDataProperties(value).flatMap(([key, descriptor]) => typeof key === "string" ? [descriptor.value] : [])
    : isSandboxBox(value)
    ? boxedDataProperties(value).map(([, descriptor]) => descriptor.value)
    : isSandboxArguments(value)
    ? getSandboxArgumentEntries(value).map(([, entry]) => entry)
    : getEnumerableDataValues(value);
  for (const entry of entries) {
    collectContainerStats(entry, stats, ancestors, guestValues, depth + 1);
  }
  for (const key of ownSerializableSymbolKeys(value)) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key)!;
    if ("value" in descriptor)
      collectContainerStats(descriptor.value, stats, ancestors, guestValues, depth + 1);
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

function getEnumerableDataEntries(value: object): Array<[string, unknown]> {
  const entries: Array<[string, unknown]> = [];

  for (const [key, descriptor] of Object.entries(Object.getOwnPropertyDescriptors(value))) {
    if (!descriptor.enumerable || !("value" in descriptor)) {
      continue;
    }

    entries.push([key, descriptor.value]);
  }

  return entries;
}

function getEnumerableDataValues(value: object): unknown[] {
  return getEnumerableDataEntries(value).map(([, entry]) => entry);
}

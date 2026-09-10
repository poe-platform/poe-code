import { MAX_DATA_DEPTH } from "../graph-depth.js";
import { importedPromises, importedPromiseSnapshots, promiseStates } from "../interp/promise-state.js";
import { Budget } from "../interp/budget.js";
import { isSandboxSharedArrayBuffer } from "../interp/shared-array-buffer.js";
import { decodeSharedArrayBufferStorage, encodeSharedArrayBufferStorage, type SharedArrayBufferData } from "./shared-array-buffer.js";
import { moduleFunctionOrigins } from "../interp/module-function-origin.js";
import { hostFunctionMetadata } from "../interp/host-function-metadata.js";
import { createModuleNamespace, isSandboxModuleNamespace } from "../interp/module-namespace.js";
import { serializeCollectionProperties } from "./collection-properties.js";
import { restorePropertyDescriptors, type PropertyDescriptorData } from "./property-descriptors.js";
import { getCollectionProperties } from "../interp/collection-properties.js";
import { validateBigIntData } from "./bigint.js";
import { serializeRegexProperties, restoreRegexProperties, type RegexPropertyData } from "./regexp-properties.js";
import { wellKnownSymbols } from "../interp/symbols.js";
import { symbolData, serializeSymbolProperties, type SerializedSymbol, type SerializedSymbolProperty } from "./symbols.js";
import { isSandboxCollectionIterator, restoreSandboxCollectionIterator, snapshotCollectionIterator, type CollectionIterationMethod } from "../interp/collection-iterator.js";
import { isSandboxRegExpIterator, regexpIteratorState, restoreSandboxRegExpIterator } from "../interp/regexp-iterator.js";
import { hasExplicitSandboxPrototype, hasGuestObjectState, hasNullObjectPrototype, hostFunctionPropertyTables, isGuestClosure, setSandboxPrototype } from "../interp/object-model.js";
import { CompileScope } from "../interp/regex/compile-guard.js";
import { typedArrayDataProperties, typedArrayStorage, isNumericTypedArray } from "../interp/typed-array.js";
import { decodeTypedArrayStorage, encodeTypedArrayLayout, type TypedArrayData } from "./typed-array.js";
import { arrayBufferDataProperties, isSandboxArrayBuffer } from "../interp/array-buffer.js";
import { dataViewBuffer, dataViewDataProperties, isSandboxDataView } from "../interp/data-view.js";
import { decodeDataViewStorage, encodeDataViewLayout, type DataViewData } from "./data-view.js";
import { decodeArrayBufferStorage, encodeArrayBufferStorage, type ArrayBufferData } from "./array-buffer.js";
import { dateDataProperties, isSandboxDate, restoreDateTime, serializedDateTime } from "../interp/date.js";
import { createSandboxTemporalInstant, isSandboxTemporalInstant, temporalInstantEpoch } from "../interp/temporal-instant.js";
import { createSandboxTemporalZonedDateTime, isSandboxTemporalZonedDateTime, temporalZonedDateTimeFields } from "../interp/temporal-zoned-date-time.js";
import { createSandboxTemporalDuration, isSandboxTemporalDuration, temporalDurationFieldNames, temporalDurationFields, type TemporalDurationFields } from "../interp/temporal-duration.js";
import { createSandboxTemporalPlainTime, isSandboxTemporalPlainTime, temporalPlainTimeFieldNames, temporalPlainTimeFields, type TemporalPlainTimeFields } from "../interp/temporal-plain-time.js";
import { createSandboxTemporalPlainDateTime, isSandboxTemporalPlainDateTime, temporalPlainDateTimeNumericFields, temporalPlainDateTimeFields, type TemporalPlainDateTimeFields } from "../interp/temporal-plain-date-time.js";
import { createSandboxTemporalPlainDate, isSandboxTemporalPlainDate, temporalPlainDateNumericFields, temporalPlainDateFields, type TemporalPlainDateFields } from "../interp/temporal-plain-date.js";
import { createSandboxTemporalPlainMonthDay, isSandboxTemporalPlainMonthDay, temporalPlainMonthDayFields, type TemporalPlainMonthDayFields } from "../interp/temporal-plain-month-day.js";
import { createSandboxTemporalPlainYearMonth, isSandboxTemporalPlainYearMonth, temporalPlainYearMonthFields, type TemporalPlainYearMonthFields } from "../interp/temporal-plain-year-month.js";
import { createRawJson, isRawJson } from "../interp/raw-json.js";
import { boxedDataProperties, createSandboxBox, nativeBoxedValue } from "../interp/boxed.js";
import { validateBoxedProperties } from "./boxed.js";
import { sandboxErrorNames, sandboxErrorTypes, type SandboxErrorName } from "../error/shape.js";
import {
  cloneSandboxValue,
  createSandboxArguments,
  createSandboxClosure,
  createSandboxPromise,
  getPromiseProperties,
  createSandboxMap,
  createSandboxRegex,
  createSandboxSet,
  isSandboxArguments,
  isSandboxClosure,
  isSandboxGenerator,
  isSandboxMap,
  isSandboxPromise,
  isSandboxRegex,
  isSandboxSet,
  type SandboxClosure,
  type SandboxMap,
  type SandboxSet,
  type SandboxPromise,
  type SandboxValue
} from "../interp/values.js";
import { serializeArguments, type SerializedArguments } from "./arguments.js";
import { validateArgumentsProperties, validateSnapshotData } from "./validation.js";

type Atom =
  | boolean
  | null
  | number
  | string
  | { tag: "undefined" }
  | { tag: "bigint"; value: string }
  | { tag: "number"; value: "NaN" | "Infinity" | "-Infinity" | "-0" }
  | { tag: "capability"; id: string }
  | { tag: "promise-capability"; id: string }
  | { tag: "imported-promise-reference"; callId: string; node: number }
  | { tag: "ref"; id: number };
type Properties = Record<
  string,
  { value: Atom; configurable: boolean; enumerable: boolean; writable: boolean }
>;
type DataNode =
  | { kind: "settled-imported-promise"; status: "fulfilled" | "rejected"; outcome: Atom }
  | { kind: "module-namespace"; entries: Array<[string, Atom]> }
  | { kind: "raw-json"; text: string }
  | { kind: "regexp-iterator"; matcher: Atom; input: Atom; exhausted: boolean; global?: boolean; unicode?: boolean; properties: Properties; extensible: boolean; symbolEntries?: Array<SerializedSymbolProperty<Atom>> }
  | SerializedSymbol
  | { kind: "boxed"; value: Atom; properties: Properties; extensible: boolean; symbolEntries?: Array<SerializedSymbolProperty<Atom>> }
  | { kind: "collection-iterator"; collectionKind: "map" | "set"; method: CollectionIterationMethod; collection: Atom; index: number; exhausted: boolean; properties: Properties; extensible: boolean }
  | { kind: "date"; time: number | null; properties?: Properties; symbolProperties?: Array<SerializedSymbolProperty<Atom>>; extensible?: boolean; nullPrototype?: true }
  | { kind: "temporal-instant"; epochNanoseconds: string; properties?: Properties; symbolProperties?: Array<SerializedSymbolProperty<Atom>>; extensible?: boolean; nullPrototype?: true }
  | { kind: "temporal-zoned-date-time"; slots: { epochNanoseconds: string; timeZone: string; calendar: string }; properties?: Properties; symbolProperties?: Array<SerializedSymbolProperty<Atom>>; extensible?: boolean; nullPrototype?: true }
  | { kind: "temporal-duration"; slots: TemporalDurationFields; properties?: Properties; symbolProperties?: Array<SerializedSymbolProperty<Atom>>; extensible?: boolean; nullPrototype?: true }
  | { kind: "temporal-plain-time"; slots: TemporalPlainTimeFields; properties?: Properties; symbolProperties?: Array<SerializedSymbolProperty<Atom>>; extensible?: boolean; nullPrototype?: true }
  | { kind: "temporal-plain-date-time"; slots: TemporalPlainDateTimeFields; properties?: Properties; symbolProperties?: Array<SerializedSymbolProperty<Atom>>; extensible?: boolean; nullPrototype?: true }
  | { kind: "temporal-plain-date"; slots: TemporalPlainDateFields; properties?: Properties; symbolProperties?: Array<SerializedSymbolProperty<Atom>>; extensible?: boolean; nullPrototype?: true }
  | { kind: "temporal-plain-month-day"; slots: TemporalPlainMonthDayFields; properties?: Properties; symbolProperties?: Array<SerializedSymbolProperty<Atom>>; extensible?: boolean; nullPrototype?: true }
  | { kind: "temporal-plain-year-month"; slots: TemporalPlainYearMonthFields; properties?: Properties; symbolProperties?: Array<SerializedSymbolProperty<Atom>>; extensible?: boolean; nullPrototype?: true }
  | (TypedArrayData<Atom> & { properties: Properties; extensible: boolean })
  | (ArrayBufferData<Atom> & { properties: Properties; extensible: boolean; symbolEntries?: Array<SerializedSymbolProperty<Atom>> })
  | (SharedArrayBufferData<Atom> & { properties: Properties; extensible: boolean; symbolEntries?: Array<SerializedSymbolProperty<Atom>> })
  | (DataViewData<Atom> & { properties: Properties; extensible: boolean; symbolEntries?: Array<SerializedSymbolProperty<Atom>> })
  | { kind: "capability"; id: string; properties: Atom }
  | {
      kind: "array" | "object";
      properties: Properties;
      symbolProperties?: Array<SerializedSymbolProperty<Atom>>;
      extensible: boolean;
      nullPrototype: boolean;
      sandboxNullPrototype?: true;
      errorType?: SandboxErrorName;
    }
  | { kind: "arguments"; data: SerializedArguments<Atom> }
  | { kind: "map"; entries: Array<[Atom, Atom]>; propertyState?: PropertyDescriptorData<Atom> }
  | { kind: "set"; values: Atom[]; propertyState?: PropertyDescriptorData<Atom> }
  | ({ kind: "regex"; source: string; flags: string; lastIndex: Atom } & RegexPropertyData<Atom>);
export type ReplayData = { root: Atom; nodes: DataNode[]; namespaceRoots?: Record<string, Atom> };
export type ReplayPathSegment = string | { symbol: number };

export class MissingReplayCapabilityError extends TypeError {}

export function createReplayEncodingContext() {
  return {
    nodes: [] as DataNode[],
    seen: new WeakMap<object, number>(),
    symbols: new Map<symbol, number>(),
    float32Buffers: new WeakMap<ArrayBuffer, number>(),
    sharedBlocks: new WeakMap<object, number>(),
    failed: false
  };
}

export function encodeReplayData(
  value: SandboxValue,
  options: {
    identifyCapability?: (value: SandboxClosure, path: readonly ReplayPathSegment[]) => string | undefined;
    captureCapabilityProperties?: boolean;
    captureSettledImportedPromises?: boolean;
    identifyImportedPromise?: (value: SandboxPromise) => { callId: string; node: number } | undefined;
    identifyPromise?: (value: SandboxPromise, path: readonly ReplayPathSegment[]) => string | undefined;
    context?: ReturnType<typeof createReplayEncodingContext>;
    path?: readonly ReplayPathSegment[];
    onValueEncoded?: (id: number, value: SandboxValue) => void;
  } = {}
): ReplayData {
  const context = options.context ?? createReplayEncodingContext();
  if (context.failed) throw new TypeError("Cannot extend an incomplete graph.");
  const { nodes, seen, symbols, float32Buffers, sharedBlocks } = context;
  const initialNodeCount = nodes.length;
  const encode = (entry: SandboxValue, depth: number, path: readonly ReplayPathSegment[], capabilityProperties = false): Atom => {
    if (depth > MAX_DATA_DEPTH) throw new TypeError("Replay data exceeds the nesting limit.");
    if (entry === null || typeof entry === "boolean" || typeof entry === "string") return entry;
    if (entry === undefined) return { tag: "undefined" };
    if (typeof entry === "bigint") return { tag: "bigint", value: String(entry) };
    if (typeof entry === "symbol") {
      let id = symbols.get(entry);
      if (id === undefined) {
        id = nodes.length;
        symbols.set(entry, id);
        nodes.push(symbolData(entry));
        options.onValueEncoded?.(id, entry);
      }
      return { tag: "ref", id };
    }
    if (typeof entry === "number") {
      if (Object.is(entry, -0)) return { tag: "number", value: "-0" };
      if (Number.isFinite(entry)) return entry;
      return {
        tag: "number",
        value: Number.isNaN(entry) ? "NaN" : entry > 0 ? "Infinity" : "-Infinity"
      };
    }
    if (isSandboxPromise(entry)) {
      const id = options.identifyPromise?.(entry, path);
      if (typeof id === "string" && id.length > 0) return { tag: "promise-capability", id };
      const snapshot = importedPromiseSnapshots.get(entry);
      if (options.captureSettledImportedPromises && snapshot?.ok === false) throw snapshot.error;
      const state = snapshot?.ok ? snapshot.state : undefined;
      if (options.captureSettledImportedPromises && importedPromises.has(entry) &&
          state !== undefined &&
          !hasGuestObjectState(entry) && Reflect.ownKeys(getPromiseProperties(entry)).length === 0) {
        const existing = seen.get(entry);
        if (existing !== undefined) return { tag: "ref", id: existing };
        const reference = options.identifyImportedPromise?.(entry);
        if (reference !== undefined) return { tag: "imported-promise-reference", ...reference };
        const index = nodes.length;
        seen.set(entry, index);
        nodes.push(undefined as unknown as DataNode);
        options.onValueEncoded?.(index, entry);
        nodes[index] = { kind: "settled-imported-promise", status: state.status,
          outcome: encode(state.value, depth + 1, [...path, "<settlement>"]) };
        return { tag: "ref", id: index };
      }
    }
    if (typeof entry === "object" && entry !== null && hasGuestObjectState(entry) && !isSandboxModuleNamespace(entry) &&
        !(!hasExplicitSandboxPrototype(entry) && (capabilityProperties || hostFunctionPropertyTables.has(entry) || (isSandboxClosure(entry) && !isGuestClosure(entry))))) {
      throw new MissingReplayCapabilityError("Guest function properties and prototype links cannot be serialized.");
    }
    let capabilityId: string | undefined;
    if (isSandboxClosure(entry)) {
      capabilityId = options.identifyCapability?.(entry, path);
      if (typeof capabilityId !== "string" || capabilityId.length === 0)
        throw new MissingReplayCapabilityError("A callable needs an explicit resume capability.");
      if (!options.captureCapabilityProperties) return { tag: "capability", id: capabilityId };
    }
    if (typeof entry !== "object" || isSandboxPromise(entry) || isSandboxGenerator(entry)) {
      throw new MissingReplayCapabilityError(
        "A host result containing a callable or live execution state needs an explicit resume capability."
      );
    }
    const existing = seen.get(entry);
    if (existing !== undefined) return { tag: "ref", id: existing };
    const id = nodes.length;
    seen.set(entry, id);
    nodes.push(undefined as unknown as DataNode);
    options.onValueEncoded?.(id, entry);
    const child = (value: SandboxValue, key: string) => encode(value, depth + 1, [...path, key]);
    if (isSandboxModuleNamespace(entry)) {
      nodes[id] = {kind:"module-namespace",entries:Object.keys(entry).map(key => [key,child((entry as Record<string,SandboxValue>)[key],key)])};
    } else if (isSandboxClosure(entry)) {
      nodes[id] = {
        kind: "capability",
        id: capabilityId!,
        properties: encode(entry.properties, depth + 1, [...path, "properties"], true)
      };
    } else if (isRawJson(entry)) {
      nodes[id] = { kind: "raw-json", text: entry.rawJSON };
    } else if (nativeBoxedValue(entry) !== undefined) {
      const properties: Properties = Object.create(null);
      let symbolIndex = 0;
      const symbolEntries = serializeSymbolProperties(entry, value => encode(value as SandboxValue, depth + 1, [...path, { symbol: Math.floor(symbolIndex++ / 2) }]));
      nodes[id] = { kind: "boxed", value: child(nativeBoxedValue(entry)!, "<payload>"), properties, extensible: Object.isExtensible(entry), ...(symbolEntries.length === 0 ? {} : { symbolEntries }) };
      for (const [key, descriptor] of boxedDataProperties(entry)) {
        if (!("value" in descriptor)) throw new TypeError(`Cannot record replay data accessor '${key}'.`);
        properties[key] = { value: child(descriptor.value, JSON.stringify(["property", key])), configurable: descriptor.configurable === true, enumerable: descriptor.enumerable === true, writable: descriptor.writable === true };
      }
    } else if (isSandboxTemporalPlainYearMonth(entry) || isSandboxTemporalPlainMonthDay(entry) || isSandboxTemporalInstant(entry) || isSandboxTemporalDuration(entry) || isSandboxTemporalPlainTime(entry) || isSandboxTemporalPlainDateTime(entry) || isSandboxTemporalPlainDate(entry) || isSandboxTemporalZonedDateTime(entry)) {
      const properties: Properties = Object.create(null);
      for (const key of Object.getOwnPropertyNames(entry)) {
        const descriptor = Object.getOwnPropertyDescriptor(entry, key)!;
        if (!("value" in descriptor)) throw new TypeError(`Cannot record replay data accessor '${key}'.`);
        properties[key] = { value: child(descriptor.value, key), enumerable: descriptor.enumerable === true, writable: descriptor.writable === true, configurable: descriptor.configurable === true };
      }
      let symbolIndex = 0;
      const symbolProperties = serializeSymbolProperties(entry, value => encode(value as SandboxValue, depth + 1, [...path, { symbol: Math.floor(symbolIndex++ / 2) }]));
      nodes[id] = {
        ...(isSandboxTemporalZonedDateTime(entry)
          ? { kind: "temporal-zoned-date-time" as const, slots: {
              ...temporalZonedDateTimeFields(entry), epochNanoseconds: temporalZonedDateTimeFields(entry).epochNanoseconds.toString()
            } }
          : isSandboxTemporalInstant(entry)
          ? { kind: "temporal-instant" as const, epochNanoseconds: temporalInstantEpoch(entry).toString() }
          : isSandboxTemporalDuration(entry)
            ? { kind: "temporal-duration" as const, slots: { ...temporalDurationFields(entry) } }
            : isSandboxTemporalPlainTime(entry)
              ? { kind: "temporal-plain-time" as const, slots: { ...temporalPlainTimeFields(entry) } }
              : isSandboxTemporalPlainDateTime(entry)
                ? { kind: "temporal-plain-date-time" as const, slots: { ...temporalPlainDateTimeFields(entry) } }
                : isSandboxTemporalPlainYearMonth(entry)
                  ? { kind: "temporal-plain-year-month" as const, slots: { ...temporalPlainYearMonthFields(entry) } }
                  : isSandboxTemporalPlainMonthDay(entry)
                    ? { kind: "temporal-plain-month-day" as const, slots: { ...temporalPlainMonthDayFields(entry) } }
                    : { kind: "temporal-plain-date" as const, slots: { ...temporalPlainDateFields(entry) } }),
        ...(hasNullObjectPrototype(entry) ? { nullPrototype: true as const } : {}),
        ...(Object.keys(properties).length === 0 ? {} : { properties }),
        ...(symbolProperties.length === 0 ? {} : { symbolProperties }),
        ...(Object.isExtensible(entry) ? {} : { extensible: false })
      };
    } else if (isSandboxDate(entry)) {
      const properties: Properties = Object.create(null);
      for (const [key, descriptor] of dateDataProperties(entry)) {
        if (typeof key === "symbol") continue;
        properties[key] = { value: child(descriptor.value, key), enumerable: descriptor.enumerable === true, writable: descriptor.writable === true, configurable: descriptor.configurable === true };
      }
      let symbolIndex = 0;
      const symbolProperties = serializeSymbolProperties(entry, value => encode(value as SandboxValue, depth + 1, [...path, { symbol: Math.floor(symbolIndex++ / 2) }]));
      nodes[id] = {
        kind: "date", time: serializedDateTime(entry),
        ...(hasNullObjectPrototype(entry) ? { nullPrototype: true as const } : {}),
        ...(Object.keys(properties).length === 0 ? {} : { properties }),
        ...(symbolProperties.length === 0 ? {} : { symbolProperties }),
        ...(Object.isExtensible(entry) ? {} : { extensible: false })
      };
    } else if (isSandboxArrayBuffer(entry) || isSandboxSharedArrayBuffer(entry) || isSandboxDataView(entry)) {
      const storage = isSandboxDataView(entry) ? { ...encodeDataViewLayout(entry), buffer: child(dataViewBuffer(entry), "<buffer>") }
        : isSandboxSharedArrayBuffer(entry) ? encodeSharedArrayBufferStorage(entry, id, sharedBlocks, id => ({ tag: "ref" as const, id }))
        : encodeArrayBufferStorage(entry, id, float32Buffers, id => ({ tag: "ref" as const, id }));
      const properties: Properties = Object.create(null);
      for (const [key, descriptor] of isSandboxDataView(entry) ? dataViewDataProperties(entry) : arrayBufferDataProperties(entry)) {
        if (typeof key === "symbol") continue;
        properties[key] = { value: child(descriptor.value, key), configurable: descriptor.configurable === true,
          enumerable: descriptor.enumerable === true, writable: descriptor.writable === true };
      }
      let symbolIndex = 0;
      const symbolEntries = serializeSymbolProperties(entry, value => encode(value as SandboxValue, depth + 1, [...path, { symbol: Math.floor(symbolIndex++ / 2) }]));
      nodes[id] = { ...storage, properties, extensible: Object.isExtensible(entry), symbolEntries };
    } else if (isNumericTypedArray(entry)) {
      const backing = typedArrayStorage(entry);
      const storage: TypedArrayData<Atom> = { ...encodeTypedArrayLayout(entry), buffer: child(backing.buffer, "<buffer>") };
      const properties: Properties = Object.create(null);
      for (const [key, descriptor] of typedArrayDataProperties(entry)) {
        properties[key] = {
          value: child(descriptor.value, key),
          configurable: descriptor.configurable === true,
          enumerable: descriptor.enumerable === true,
          writable: descriptor.writable === true
        };
      }
      nodes[id] = { ...storage, properties, extensible: Object.isExtensible(entry) };
    } else if (isSandboxRegExpIterator(entry)) {
      const snapshot = regexpIteratorState(entry);
      const properties: Properties = Object.create(null);
      for (const [key, descriptor] of Object.entries(Object.getOwnPropertyDescriptors(entry))) {
        if (!("value" in descriptor)) throw new TypeError(`Cannot record replay data accessor '${key}'.`);
        properties[key] = { value: child(descriptor.value, JSON.stringify(["property", key])), configurable: descriptor.configurable === true, enumerable: descriptor.enumerable === true, writable: descriptor.writable === true };
      }
      let symbolIndex = 0;
      const symbolEntries = serializeSymbolProperties(entry, value => encode(value as SandboxValue, depth + 1, [...path, { symbol: Math.floor(symbolIndex++ / 2) }]));
      nodes[id] = { kind: "regexp-iterator", matcher: child(snapshot.matcher, "<matcher>"), input: child(snapshot.input, "<input>"), exhausted: snapshot.exhausted, properties, extensible: Object.isExtensible(entry), symbolEntries,
        ...(snapshot.global === undefined ? {} : { global: snapshot.global, unicode: snapshot.unicode }) };
    } else if (isSandboxCollectionIterator(entry)) {
      const snapshot = snapshotCollectionIterator(entry);
      const properties: Properties = Object.create(null);
      for (const [key, descriptor] of Object.entries(Object.getOwnPropertyDescriptors(entry))) {
        if (!("value" in descriptor)) throw new TypeError(`Cannot record replay data accessor '${key}'.`);
        properties[key] = { value: child(descriptor.value, JSON.stringify(["property", key])), configurable: descriptor.configurable === true, enumerable: descriptor.enumerable === true, writable: descriptor.writable === true };
      }
      nodes[id] = { kind: "collection-iterator", collectionKind: snapshot.collectionKind, method: snapshot.method, collection: child(snapshot.collection, "<collection>"), index: snapshot.index, exhausted: snapshot.exhausted, properties, extensible: Object.isExtensible(entry) };
    } else if (isSandboxMap(entry)) {
      nodes[id] = {
        kind: "map",
        ...serializeCollectionProperties(entry, value => child(value as SandboxValue, "<collection-property>"), true),
        entries: [...entry.entries].map(([key, value], index) => [
          child(key, `key:${index}`),
          child(value, `value:${index}`)
        ])
      };
    } else if (isSandboxSet(entry)) {
      nodes[id] = {
        kind: "set",
        ...serializeCollectionProperties(entry, value => child(value as SandboxValue, "<collection-property>"), true),
        values: [...entry.values].map((value, index) => child(value, String(index)))
      };
    } else if (isSandboxRegex(entry)) {
      nodes[id] = {
        kind: "regex",
        source: entry.source,
        flags: entry.flags,
        lastIndex: child(entry.lastIndex, "lastIndex"),
        ...serializeRegexProperties(entry, value => child(value as SandboxValue, "<regex-property>"))
      };
    } else if (isSandboxArguments(entry)) {
      nodes[id] = { kind: "arguments", data: serializeArguments(entry, child) };
    } else {
      const prototype = Object.getPrototypeOf(entry);
      if (
        !Array.isArray(entry) && prototype !== null && prototype !== Object.prototype
      ) {
        throw new TypeError("Replay data contains an unsupported host object or symbol property.");
      }
      const properties: Properties = Object.create(null);
      let symbolIndex = 0;
      const symbolProperties = serializeSymbolProperties(entry, value => encode(value as SandboxValue, depth + 1, [...path, { symbol: Math.floor(symbolIndex++ / 2) }]));
      const errorType = sandboxErrorTypes.get(entry);
      for (const [key, descriptor] of Object.entries(Object.getOwnPropertyDescriptors(entry))) {
        if (!("value" in descriptor))
          throw new TypeError(`Cannot record replay data accessor '${key}'.`);
        properties[key] = {
          value: child(descriptor.value, key),
          configurable: descriptor.configurable === true,
          enumerable: descriptor.enumerable === true,
          writable: descriptor.writable === true
        };
      }
      nodes[id] = {
        kind: Array.isArray(entry) ? "array" : "object",
        nullPrototype: prototype === null,
        ...(hasNullObjectPrototype(entry) ? { sandboxNullPrototype: true as const } : {}),
        ...(errorType === undefined ? {} : { errorType }),
        extensible: Object.isExtensible(entry),
        properties,
        ...(symbolProperties.length === 0 ? {} : { symbolProperties })
      };
    }
    return { tag: "ref", id };
  };
  try {
    return { root: encode(value, 0, options.path ?? []), nodes };
  } catch (error) {
    context.failed = true;
    nodes.length = initialNodeCount;
    throw error;
  }
}

type ReplayDecodingWork = {
  initialize: Array<() => void>;
  capture: Array<() => void>;
  settle: Array<() => void>;
  detach: Array<() => void>;
  rollback: Array<() => void>;
  scopes: Array<{ scope: CompileScope; parent?: CompileScope }>;
};

export function decodeReplayData(
  input: unknown,
  options: {
    resolveCapability?: (id: string) => SandboxClosure | undefined;
    resolvePromise?: (id: string) => SandboxPromise | undefined;
    onCapabilityRestored?: (original: SandboxClosure, restored: SandboxClosure) => void;
    onImportedPromiseRestored?: (promise: SandboxPromise) => void;
    graphId?: string;
    importedPromiseMemo?: Map<string, Map<number, SandboxPromise>>;
    resolvePromiseGraph?: (id: string) => unknown;
    memo?: { nodes: ReplayData["nodes"]; values: Map<number, SandboxValue> };
  } = {},
  parent?: CompileScope,
  pendingWork?: ReplayDecodingWork,
  initialDepth = 0
): SandboxValue {
  const ownsWork = pendingWork === undefined;
  const work = pendingWork ?? { initialize: [], capture: [], settle: [], detach: [], rollback: [], scopes: [] };
  const compilation = new CompileScope(parent?.owner);
  work.scopes.push({ scope: compilation, parent });
  const sharedStorageBudget = compilation.owner?.budget ?? new Budget();
  try {
    validateSnapshotData(input);
    const graph = record(input);
    const nodes = list(own(graph, "nodes"));
    if (options.memo !== undefined && options.memo.nodes !== nodes)
      throw new TypeError("Replay memo belongs to a different graph.");
    const restored = new Map<number, SandboxValue>(options.memo?.values);
    const initializeValues = work.initialize;
    const captureImportedSettlements = work.capture;
    const detachBuffers = work.detach;
    const decode = (entry: unknown, depth = initialDepth): SandboxValue => {
      if (depth > MAX_DATA_DEPTH) throw new TypeError("Replay data exceeds the nesting limit.");
      if (entry === null || typeof entry === "boolean" || typeof entry === "string") return entry;
      if (typeof entry === "number" && Number.isFinite(entry)) return entry;
      const atom = record(entry);
      if (own(atom, "tag") === "imported-promise-reference") {
        const callId = own(atom, "callId");
        const nodeId = own(atom, "node");
        if (typeof callId !== "string" || callId.length === 0 ||
            typeof nodeId !== "number" || !Number.isSafeInteger(nodeId) || nodeId < 0)
          throw new TypeError("Invalid imported Promise reference.");
        const target = options.resolvePromiseGraph?.(callId);
        if (target === undefined || options.importedPromiseMemo === undefined)
          throw new TypeError("Missing imported Promise declaration.");
        validateSnapshotData(target);
        const targetNodes = list(own(record(target), "nodes"));
        if (nodeId >= targetNodes.length || own(record(targetNodes[nodeId]), "kind") !== "settled-imported-promise")
          throw new TypeError("Invalid imported Promise declaration.");
        const existing = options.importedPromiseMemo.get(callId)?.get(nodeId);
        if (existing !== undefined) return existing;
        return decodeReplayData({ root: { tag: "ref", id: nodeId }, nodes: targetNodes },
          { ...options, graphId: callId, memo: undefined }, compilation, work, depth);
      }
      if (own(atom, "tag") === "promise-capability") {
        const id = own(atom, "id");
        if (typeof id !== "string" || id.length === 0)
          throw new TypeError("Invalid replay promise capability reference.");
        const promise = options.resolvePromise?.(id);
        if (!isSandboxPromise(promise))
          throw new TypeError(`Missing replay promise capability '${id}'.`);
        return promise;
      }
      if (own(atom, "tag") === "capability") {
        const id = own(atom, "id");
        if (typeof id !== "string" || id.length === 0)
          throw new TypeError("Invalid replay capability reference.");
        const capability = options.resolveCapability?.(id);
        if (!isSandboxClosure(capability))
          throw new TypeError(`Missing replay capability '${id}'.`);
        return capability;
      }
      if (own(atom, "tag") === "undefined") return undefined;
      if (own(atom, "tag") === "bigint") {
        const value = own(atom, "value");
        validateBigIntData(value);
        return BigInt(value);
      }
      if (atom.tag === "number") {
        switch (own(atom, "value")) {
          case "NaN":
            return NaN;
          case "Infinity":
            return Infinity;
          case "-Infinity":
            return -Infinity;
          case "-0":
            return -0;
          default:
            throw new TypeError("Invalid replay number.");
        }
      }
      if (
        atom.tag !== "ref" ||
        !Number.isSafeInteger(atom.id) ||
        Number(atom.id) < 0 ||
        Number(atom.id) >= nodes.length
      ) {
        throw new TypeError("Invalid replay data reference.");
      }
      const id = Number(atom.id);
      if (restored.has(id)) return restored.get(id);
      const node = record(nodes[id]);
      const kind = own(node, "kind");
      if (
        Object.hasOwn(node, "errorType") &&
        (kind !== "object" || !sandboxErrorNames.includes(node.errorType as SandboxErrorName))
      ) {
        throw new TypeError("Invalid replay error metadata.");
      }
      const child = (value: unknown) => decode(value, depth + 1);
      if (kind === "settled-imported-promise") {
        const status = own(node, "status");
        if (status !== "fulfilled" && status !== "rejected")
          throw new TypeError("Invalid imported Promise settlement.");
        const globalMemo = options.importedPromiseMemo;
        const graphId = options.graphId;
        const existing = graphId === undefined ? undefined : globalMemo?.get(graphId)?.get(id);
        if (existing !== undefined) {
          restored.set(id, existing);
          return existing;
        }
        let resolve!: (value: SandboxValue) => void;
        let reject!: (value: SandboxValue) => void;
        const native = new Promise<SandboxValue>((yes, no) => { resolve = yes; reject = no; });
        void native.catch(() => undefined);
        const promise = createSandboxPromise(native, { trackReplay: false });
        importedPromises.add(promise);
        restored.set(id, promise);
        if (globalMemo !== undefined && graphId !== undefined) {
          let entries = globalMemo.get(graphId);
          if (entries === undefined) globalMemo.set(graphId, entries = new Map());
          entries.set(id, promise);
          const registered = entries;
          work.rollback.push(() => {
            if (registered.get(id) === promise) registered.delete(id);
            if (registered.size === 0 && globalMemo.get(graphId) === registered) globalMemo.delete(graphId);
          });
        }
        options.onImportedPromiseRestored?.(promise);
        initializeValues.push(() => {
          const value = child(own(node, "outcome"));
          if (status === "fulfilled" && isSandboxPromise(value))
            throw new TypeError("A fulfilled Promise cannot directly contain a Promise.");
          captureImportedSettlements.push(() => {
            importedPromiseSnapshots.set(promise, { ok: true,
              state: { status, value: cloneSandboxValue(value, { compilation, sharedBufferSnapshots: new WeakMap() }) }
            });
          });
          work.settle.push(() => {
            promiseStates.set(promise, { status, value });
            if (status === "fulfilled") resolve(value); else reject(value);
          });
        });
        return promise;
      }
      if (kind === "module-namespace") {
        const entries = list(own(node,"entries"));
        const names = new Set<string>();
        return createModuleNamespace(namespace => {
          restored.set(id,namespace);
          return Object.fromEntries(entries.map(raw => {
            const entry = list(raw);
            if (entry.length !== 2 || typeof entry[0] !== "string" || names.has(entry[0]))
              throw new TypeError("Invalid module namespace export.");
            names.add(entry[0]);
            return [entry[0],child(entry[1])];
          }));
        });
      }
      if (kind === "symbol") {
        if (node.description !== undefined && typeof node.description !== "string") throw new TypeError("Invalid replay symbol description.");
        let symbol: symbol;
        if (node.wellKnown !== undefined) {
          if (typeof node.wellKnown !== "string" || !Object.hasOwn(wellKnownSymbols, node.wellKnown) || Object.hasOwn(node, "description"))
            throw new TypeError("Invalid replay well-known symbol.");
          symbol = wellKnownSymbols[node.wellKnown]!;
        } else symbol = Symbol(node.description);
        restored.set(id, symbol);
        return symbol;
      }
      if (kind === "capability") {
        const capabilityId = own(node, "id");
        if (typeof capabilityId !== "string" || capabilityId.length === 0)
          throw new TypeError("Invalid replay capability reference.");
        const capability = options.resolveCapability?.(capabilityId);
        if (!isSandboxClosure(capability))
          throw new TypeError(`Missing replay capability '${capabilityId}'.`);
        if (record(own(node, "properties")).tag === "undefined") {
          restored.set(id, capability);
          return capability;
        }
        const copy = createSandboxClosure({
          ...capability,
          boundTarget: capability.boundTarget,
          cancellationSignal: capability.cancellationSignal,
          sandbox: capability.sandbox,
          retainedValues: () => [capability],
          properties: (closure) => {
            restored.set(id, closure);
            const properties = child(own(node, "properties"));
            if (
              properties === null ||
              typeof properties !== "object" ||
              Array.isArray(properties) ||
              isSandboxClosure(properties)
            )
              throw new TypeError("Invalid replay capability properties.");
            return properties as Record<string, SandboxValue>;
          }
        });
        const metadata = capability.properties === undefined ? undefined : hostFunctionMetadata.get(capability.properties);
        if (copy.properties !== undefined && metadata !== undefined) hostFunctionMetadata.set(copy.properties, metadata);
        options.onCapabilityRestored?.(capability, copy);
        const moduleFunction = moduleFunctionOrigins.get(capability);
        if (moduleFunction !== undefined) moduleFunctionOrigins.set(copy, moduleFunction);
        return copy;
      }
      if (kind === "boxed") {
        validateBoxedProperties(node);
        const payload = own(node, "value");
        const payloadRecord = payload !== null && typeof payload === "object" ? record(payload) : undefined;
        const symbolReference = payloadRecord !== undefined &&
          own(payloadRecord, "tag") === "ref" && Number.isSafeInteger(payloadRecord.id) &&
          Number(payloadRecord.id) >= 0 && Number(payloadRecord.id) < nodes.length &&
          own(record(nodes[Number(payloadRecord.id)]), "kind") === "symbol";
        if (typeof payload !== "number" && typeof payload !== "string" && typeof payload !== "boolean" &&
          !symbolReference &&
          (payload === null || typeof payload !== "object" || !["number", "bigint"].includes(String(own(record(payload), "tag")))))
          throw new TypeError("Invalid boxed primitive payload.");
        const result = createSandboxBox(child(payload));
        restored.set(id, result);
        defineProperties(result, record(own(node, "properties")), child, node.symbolEntries);
        if (!node.extensible) Object.preventExtensions(result);
        return result;
      }
      if (kind === "raw-json") {
        if (Object.keys(node).some(key => !["kind", "text"].includes(key)) || typeof own(node, "text") !== "string")
          throw new TypeError("Invalid replay raw JSON fields.");
        const result = createRawJson(own(node, "text") as string);
        restored.set(id, result);
        return result;
      }
      if (kind === "temporal-zoned-date-time") {
        if (Object.keys(node).some(key => !["kind", "slots", "properties", "symbolProperties", "extensible", "nullPrototype"].includes(key))) throw new TypeError("Invalid serialized ZonedDateTime fields.");
        if (node.nullPrototype !== undefined && node.nullPrototype !== true) throw new TypeError("Invalid replay ZonedDateTime prototype.");
        if (node.extensible !== undefined && typeof node.extensible !== "boolean") throw new TypeError("Invalid replay ZonedDateTime extensibility.");
        const slots = record(own(node, "slots"));
        if (Reflect.ownKeys(slots).length !== 3) throw new TypeError("Invalid ZonedDateTime slot encoding.");
        const epoch = own(slots, "epochNanoseconds");
        const timeZone = own(slots, "timeZone");
        const calendar = own(slots, "calendar");
        if (typeof epoch !== "string" || epoch.length === 0 || epoch.length > 23 ||
            typeof timeZone !== "string" || typeof calendar !== "string")
          throw new TypeError("Invalid ZonedDateTime slot types.");
        const epochNanoseconds = BigInt(epoch);
        if (epochNanoseconds.toString() !== epoch) throw new TypeError("Noncanonical ZonedDateTime epoch.");
        const result = createSandboxTemporalZonedDateTime({ epochNanoseconds, timeZone, calendar });
        const canonical = temporalZonedDateTimeFields(result);
        if (canonical.timeZone !== timeZone || canonical.calendar !== calendar)
          throw new TypeError("Noncanonical ZonedDateTime identifiers.");
        if (node.nullPrototype === true) setSandboxPrototype(result, null);
        restored.set(id, result);
        defineProperties(result, node.properties === undefined ? {} : record(node.properties), child, node.symbolProperties);
        if (node.extensible === false) Object.preventExtensions(result);
        return result;
      }
      if (kind === "temporal-plain-date") {
        if (Object.keys(node).some(key => !["kind", "slots", "properties", "symbolProperties", "extensible", "nullPrototype"].includes(key))) throw new TypeError("Invalid serialized PlainDate fields.");
        if (node.nullPrototype !== undefined && node.nullPrototype !== true) throw new TypeError("Invalid replay PlainDate prototype.");
        if (node.extensible !== undefined && typeof node.extensible !== "boolean") throw new TypeError("Invalid replay PlainDate extensibility.");
        const slots = record(own(node, "slots"));
        if (Reflect.ownKeys(slots).length !== temporalPlainDateNumericFields.length + 1)
          throw new TypeError("Invalid PlainDate slot encoding.");
        for (const name of temporalPlainDateNumericFields) {
          const value = own(slots, name);
          if (typeof value !== "number" || Object.is(value, -0)) throw new TypeError("Invalid canonical PlainDate field.");
        }
        const result = createSandboxTemporalPlainDate(slots as TemporalPlainDateFields);
        if (temporalPlainDateFields(result).calendar !== own(slots, "calendar"))
          throw new TypeError("Invalid canonical PlainDate calendar.");
        if (node.nullPrototype === true) setSandboxPrototype(result, null);
        restored.set(id, result);
        defineProperties(result, node.properties === undefined ? {} : record(node.properties), child, node.symbolProperties);
        if (node.extensible === false) Object.preventExtensions(result);
        return result;
      }
      if (kind === "temporal-plain-year-month") {
        if (Object.keys(node).some(key => !["kind", "slots", "properties", "symbolProperties", "extensible", "nullPrototype"].includes(key))) throw new TypeError("Invalid serialized PlainYearMonth fields.");
        if (node.nullPrototype !== undefined && node.nullPrototype !== true) throw new TypeError("Invalid replay PlainYearMonth prototype.");
        if (node.extensible !== undefined && typeof node.extensible !== "boolean") throw new TypeError("Invalid replay PlainYearMonth extensibility.");
        const slots = record(own(node, "slots"));
        if (Reflect.ownKeys(slots).length !== temporalPlainDateNumericFields.length + 1)
          throw new TypeError("Invalid PlainYearMonth slot encoding.");
        for (const name of temporalPlainDateNumericFields) {
          const value = own(slots, name);
          if (typeof value !== "number" || Object.is(value, -0)) throw new TypeError("Invalid canonical PlainYearMonth field.");
        }
        const result = createSandboxTemporalPlainYearMonth(slots as TemporalPlainYearMonthFields);
        if (temporalPlainYearMonthFields(result).calendar !== own(slots, "calendar"))
          throw new TypeError("Invalid canonical PlainYearMonth calendar.");
        if (node.nullPrototype === true) setSandboxPrototype(result, null);
        restored.set(id, result);
        defineProperties(result, node.properties === undefined ? {} : record(node.properties), child, node.symbolProperties);
        if (node.extensible === false) Object.preventExtensions(result);
        return result;
      }
      if (kind === "temporal-plain-month-day") {
        if (Object.keys(node).some(key => !["kind", "slots", "properties", "symbolProperties", "extensible", "nullPrototype"].includes(key))) throw new TypeError("Invalid serialized PlainMonthDay fields.");
        if (node.nullPrototype !== undefined && node.nullPrototype !== true) throw new TypeError("Invalid replay PlainMonthDay prototype.");
        if (node.extensible !== undefined && typeof node.extensible !== "boolean") throw new TypeError("Invalid replay PlainMonthDay extensibility.");
        const slots = record(own(node, "slots"));
        if (Reflect.ownKeys(slots).length !== temporalPlainDateNumericFields.length + 1)
          throw new TypeError("Invalid PlainMonthDay slot encoding.");
        for (const name of temporalPlainDateNumericFields) {
          const value = own(slots, name);
          if (typeof value !== "number" || Object.is(value, -0)) throw new TypeError("Invalid canonical PlainMonthDay field.");
        }
        const result = createSandboxTemporalPlainMonthDay(slots as TemporalPlainMonthDayFields);
        if (temporalPlainMonthDayFields(result).calendar !== own(slots, "calendar"))
          throw new TypeError("Invalid canonical PlainMonthDay calendar.");
        if (node.nullPrototype === true) setSandboxPrototype(result, null);
        restored.set(id, result);
        defineProperties(result, node.properties === undefined ? {} : record(node.properties), child, node.symbolProperties);
        if (node.extensible === false) Object.preventExtensions(result);
        return result;
      }
      if (kind === "temporal-plain-date-time") {
        if (Object.keys(node).some(key => !["kind", "slots", "properties", "symbolProperties", "extensible", "nullPrototype"].includes(key))) throw new TypeError("Invalid serialized PlainDateTime fields.");
        if (node.nullPrototype !== undefined && node.nullPrototype !== true) throw new TypeError("Invalid replay PlainDateTime prototype.");
        if (node.extensible !== undefined && typeof node.extensible !== "boolean") throw new TypeError("Invalid replay PlainDateTime extensibility.");
        const slots = record(own(node, "slots"));
        if (Reflect.ownKeys(slots).length !== temporalPlainDateTimeNumericFields.length + 1)
          throw new TypeError("Invalid PlainDateTime slot encoding.");
        for (const name of temporalPlainDateTimeNumericFields) {
          const value = own(slots, name);
          if (typeof value !== "number" || Object.is(value, -0)) throw new TypeError("Invalid canonical PlainDateTime field.");
        }
        const result = createSandboxTemporalPlainDateTime(slots as TemporalPlainDateTimeFields);
        if (temporalPlainDateTimeFields(result).calendar !== own(slots, "calendar"))
          throw new TypeError("Invalid canonical PlainDateTime calendar.");
        if (node.nullPrototype === true) setSandboxPrototype(result, null);
        restored.set(id, result);
        defineProperties(result, node.properties === undefined ? {} : record(node.properties), child, node.symbolProperties);
        if (node.extensible === false) Object.preventExtensions(result);
        return result;
      }
      if (kind === "temporal-plain-time") {
        if (Object.keys(node).some(key => !["kind", "slots", "properties", "symbolProperties", "extensible", "nullPrototype"].includes(key))) throw new TypeError("Invalid serialized PlainTime fields.");
        if (node.nullPrototype !== undefined && node.nullPrototype !== true) throw new TypeError("Invalid replay PlainTime prototype.");
        if (node.extensible !== undefined && typeof node.extensible !== "boolean") throw new TypeError("Invalid replay PlainTime extensibility.");
        const slots = record(own(node, "slots"));
        if (Reflect.ownKeys(slots).length !== temporalPlainTimeFieldNames.length)
          throw new TypeError("Invalid PlainTime slot encoding.");
        for (const name of temporalPlainTimeFieldNames) {
          const value = own(slots, name);
          if (typeof value !== "number" || Object.is(value, -0)) throw new TypeError("Invalid canonical PlainTime field.");
        }
        const result = createSandboxTemporalPlainTime(slots as TemporalPlainTimeFields);
        if (node.nullPrototype === true) setSandboxPrototype(result, null);
        restored.set(id, result);
        defineProperties(result, node.properties === undefined ? {} : record(node.properties), child, node.symbolProperties);
        if (node.extensible === false) Object.preventExtensions(result);
        return result;
      }
      if (kind === "temporal-duration") {
        if (Object.keys(node).some(key => !["kind", "slots", "properties", "symbolProperties", "extensible", "nullPrototype"].includes(key))) throw new TypeError("Invalid serialized Duration fields.");
        if (node.nullPrototype !== undefined && node.nullPrototype !== true) throw new TypeError("Invalid replay Duration prototype.");
        if (node.extensible !== undefined && typeof node.extensible !== "boolean") throw new TypeError("Invalid replay Duration extensibility.");
        const slots = record(own(node, "slots"));
        if (Reflect.ownKeys(slots).length !== temporalDurationFieldNames.length)
          throw new TypeError("Invalid Duration slot encoding.");
        for (const name of temporalDurationFieldNames) {
          const value = own(slots, name);
          if (typeof value !== "number" || Object.is(value, -0)) throw new TypeError("Invalid canonical Duration field.");
        }
        const result = createSandboxTemporalDuration(slots as TemporalDurationFields);
        if (node.nullPrototype === true) setSandboxPrototype(result, null);
        restored.set(id, result);
        defineProperties(result, node.properties === undefined ? {} : record(node.properties), child, node.symbolProperties);
        if (node.extensible === false) Object.preventExtensions(result);
        return result;
      }
      if (kind === "temporal-instant") {
        if (Object.keys(node).some(key => !["kind", "epochNanoseconds", "properties", "symbolProperties", "extensible", "nullPrototype"].includes(key))) throw new TypeError("Invalid serialized Instant fields.");
        if (node.nullPrototype !== undefined && node.nullPrototype !== true) throw new TypeError("Invalid replay Instant prototype.");
        if (node.extensible !== undefined && typeof node.extensible !== "boolean") throw new TypeError("Invalid replay Instant extensibility.");
        const text = own(node, "epochNanoseconds");
        if (typeof text !== "string" || text.length === 0 || text.length > 23) throw new TypeError("Invalid Instant epoch encoding.");
        const epoch = BigInt(text);
        if (epoch.toString() !== text) throw new TypeError("Noncanonical Instant epoch encoding.");
        const result = createSandboxTemporalInstant(epoch);
        if (node.nullPrototype === true) setSandboxPrototype(result, null);
        restored.set(id, result);
        defineProperties(result, node.properties === undefined ? {} : record(node.properties), child, node.symbolProperties);
        if (node.extensible === false) Object.preventExtensions(result);
        return result;
      }
      if (kind === "date") {
        if (Object.keys(node).some(key => !["kind", "time", "properties", "symbolProperties", "extensible", "nullPrototype"].includes(key))) throw new TypeError("Invalid serialized Date fields.");
        if (node.nullPrototype !== undefined && node.nullPrototype !== true) throw new TypeError("Invalid replay Date prototype.");
        if (node.extensible !== undefined && typeof node.extensible !== "boolean") throw new TypeError("Invalid replay Date extensibility.");
        const result = restoreDateTime(own(node, "time"));
        if (node.nullPrototype === true) setSandboxPrototype(result, null);
        restored.set(id, result);
        defineProperties(result, node.properties === undefined ? {} : record(node.properties), child, node.symbolProperties);
        if (node.extensible === false) Object.preventExtensions(result);
        return result;
      }
      if (kind === "arraybuffer" || kind === "sharedarraybuffer" || kind === "dataview") {
        if (typeof node.extensible !== "boolean") throw new TypeError("Invalid ArrayBuffer extensibility.");
        const result = kind === "dataview" ? decodeDataViewStorage(node, child, compilation.owner?.budget)
          : kind === "sharedarraybuffer" ? decodeSharedArrayBufferStorage(node, child, sharedStorageBudget)
          : decodeArrayBufferStorage(node, child, compilation.owner?.budget, detachBuffers);
        restored.set(id, result);
        initializeValues.push(() => {
          defineProperties(result, record(own(node, "properties")), child, node.symbolEntries);
          if (!node.extensible) Object.preventExtensions(result);
        });
        return result;
      }
      if (kind === "float32array" || kind === "typedarray") {
        if (typeof node.extensible !== "boolean")
          throw new TypeError("Invalid Float32Array extensibility.");
        const result = decodeTypedArrayStorage(node, child, compilation.owner?.budget);
        restored.set(id, result);
        defineProperties(result, record(own(node, "properties")), child);
        if (!node.extensible) Object.preventExtensions(result);
        return result;
      }
      if (kind === "regexp-iterator") {
        const exhausted = own(node, "exhausted");
        if (typeof exhausted !== "boolean" || typeof node.extensible !== "boolean") throw new TypeError("Invalid replay RegExp iterator.");
        const result = restoreSandboxRegExpIterator({ matcher: undefined, input: undefined, exhausted: true });
        restored.set(id, result);
        const matcher = child(own(node, "matcher"));
        const input = child(own(node, "input"));
        if ((node.global !== undefined || node.unicode !== undefined) && (typeof node.global !== "boolean" || typeof node.unicode !== "boolean")) throw new TypeError("Invalid replay RegExp iterator modes.");
        if (matcher !== undefined && (node.global === undefined ? !isSandboxRegex(matcher) : matcher === null || typeof matcher !== "object")) throw new TypeError("Invalid replay RegExp iterator matcher.");
        if (input !== undefined && typeof input !== "string") throw new TypeError("Invalid replay RegExp iterator input.");
        restoreSandboxRegExpIterator({ matcher, input, exhausted,
          ...(node.global === undefined ? {} : { global: node.global as boolean, unicode: node.unicode as boolean }) }, result);
        defineProperties(result, record(own(node, "properties")), child, node.symbolEntries);
        if (!node.extensible) Object.preventExtensions(result);
        return result;
      }
      if (kind === "collection-iterator") {
        const collectionKind = own(node, "collectionKind");
        const method = own(node, "method");
        const index = own(node, "index");
        const exhausted = own(node, "exhausted");
        if ((collectionKind !== "map" && collectionKind !== "set") || (method !== "keys" && method !== "values" && method !== "entries") || typeof index !== "number" || !Number.isSafeInteger(index) || index < 0 || typeof exhausted !== "boolean" || typeof node.extensible !== "boolean") throw new TypeError("Invalid replay collection iterator.");
        const result = restoreSandboxCollectionIterator({ collection: undefined, collectionKind, method, index: 0, exhausted: true });
        restored.set(id, result);
        const collection = child(own(node, "collection"));
        if (collection !== undefined && !isSandboxMap(collection) && !isSandboxSet(collection)) throw new TypeError("Invalid replay collection iterator source.");
        initializeValues.push(() => { restoreSandboxCollectionIterator({ collection, collectionKind, method, index, exhausted }, result); });
        defineProperties(result, record(own(node, "properties")), child);
        if (!node.extensible) Object.preventExtensions(result);
        return result;
      }
      if (kind === "map") {
        const result = createSandboxMap();
        restored.set(id, result);
        restoreCollectionDataProperties(result, node, child);
        for (const pair of list(own(node, "entries"))) {
          const entries = list(pair);
          if (entries.length !== 2) throw new TypeError("Invalid replay map entry.");
          result.entries.set(child(entries[0]), child(entries[1]));
        }
        return result;
      }
      if (kind === "set") {
        const result = createSandboxSet();
        restored.set(id, result);
        restoreCollectionDataProperties(result, node, child);
        for (const value of list(own(node, "values"))) result.values.add(child(value));
        return result;
      }
      if (kind === "regex") {
        if (
          typeof node.source !== "string" ||
          typeof node.flags !== "string" ||
          !Object.hasOwn(node, "lastIndex")
        ) {
          throw new TypeError("Invalid replay regular expression.");
        }
        const result = createSandboxRegex(node.source, node.flags, 0, compilation);
        restored.set(id, result);
        result.lastIndex = child(own(node, "lastIndex"));
        restoreRegexProperties(result, node as RegexPropertyData<Atom>, child);
        return result;
      }
      if (kind === "arguments") {
        const data = record(own(node, "data"));
        validateArgumentsProperties(data, "arguments");
        if (data.kind !== "arguments") throw new TypeError("Invalid replay arguments.");
        const args = createSandboxArguments([]);
        restored.set(id, args);
        if (!data.lengthBeforeCallee) delete args.length;
        defineProperties(args, record(data.properties), child);
        if (data.iterator === null) Reflect.deleteProperty(args, Symbol.iterator);
        else
          Object.defineProperty(args, Symbol.iterator, {
            ...record(data.iterator),
            value: Array.prototype.values
          });
        if (!data.extensible) Object.preventExtensions(args);
        return args;
      }
      if (kind !== "array" && kind !== "object") throw new TypeError("Invalid replay data node.");
      if (typeof node.extensible !== "boolean" || typeof node.nullPrototype !== "boolean") {
        throw new TypeError("Invalid replay object metadata.");
      }
      const result =
        kind === "array" ? [] : Object.create(node.nullPrototype ? null : Object.prototype);
      if (Object.hasOwn(node, "sandboxNullPrototype")) {
        if (kind !== "object" || node.sandboxNullPrototype !== true) throw new TypeError("Invalid replay object prototype.");
        setSandboxPrototype(result, null);
      }
      if (Object.hasOwn(node, "errorType")) {
        sandboxErrorTypes.set(result, node.errorType as SandboxErrorName);
      }
      if (kind === "array" && node.nullPrototype) Object.setPrototypeOf(result, null);
      restored.set(id, result);
      defineProperties(result, record(own(node, "properties")), child, node.symbolProperties);
      if (!node.extensible) Object.preventExtensions(result);
      return result;
    };
    const result = decode(own(graph, "root"));
    if (ownsWork) {
      for (const initialize of work.initialize) initialize();
      for (const capture of work.capture) capture();
      for (const detach of work.detach) detach();
      for (let index = work.scopes.length - 1; index >= 0; index--) {
        const { scope, parent: owner } = work.scopes[index]!;
        if (owner !== undefined) scope.forward(scope.tickets, owner);
      }
      for (const settle of work.settle) settle();
    }
    if (options.memo !== undefined)
      for (const [id, value] of restored) options.memo.values.set(id, value);
    return result;
  } catch (error) {
    if (ownsWork) for (let index = work.rollback.length - 1; index >= 0; index--) work.rollback[index]!();
    throw error;
  } finally {
    if (ownsWork) for (let index = work.scopes.length - 1; index >= 0; index--) work.scopes[index]!.scope.dispose();
  }
}

function defineProperties(
  target: object,
  properties: Record<string, unknown>,
  decode: (value: unknown) => SandboxValue,
  symbolProperties?: unknown
): void {
  const entries: Array<[PropertyKey, unknown]> = Object.entries(properties);
  if (symbolProperties !== undefined) {
    const symbols = new Set<symbol>();
    for (const entry of list(symbolProperties)) {
      const pair = list(entry);
      if (pair.length !== 2) throw new TypeError("Invalid replay symbol property entry.");
      const key = decode(pair[0]);
      if (typeof key !== "symbol" || symbols.has(key)) throw new TypeError("Invalid or duplicate replay symbol property key.");
      symbols.add(key);
      entries.push([key, pair[1]]);
    }
  }
  for (const [key, value] of entries) {
    const descriptor = record(value);
    for (const field of Object.keys(descriptor)) {
      if (!["value", "writable", "enumerable", "configurable"].includes(field))
        throw new TypeError("Invalid replay property descriptor.");
    }
    if (
      typeof descriptor.configurable !== "boolean" ||
      typeof descriptor.enumerable !== "boolean" ||
      typeof descriptor.writable !== "boolean"
    ) {
      throw new TypeError("Invalid replay property flags.");
    }
    Object.defineProperty(target, key, {
      value: decode(own(descriptor, "value")),
      configurable: descriptor.configurable,
      enumerable: descriptor.enumerable,
      writable: descriptor.writable
    });
  }
}

function restoreCollectionDataProperties(value: SandboxMap | SandboxSet, node: Record<string, unknown>, decode: (value: unknown) => SandboxValue): void {
  if (Object.hasOwn(node, "prototype")) {
    if (node.prototype !== null) throw new TypeError("Replay collection prototypes must be null.");
    setSandboxPrototype(value, null);
  }
  if (!Object.hasOwn(node, "propertyState")) return;
  const properties = record(node.propertyState);
  for (const entry of list(own(properties, "properties"))) {
    const descriptor = record(list(entry)[1]);
    if (own(descriptor, "kind") !== "data") throw new TypeError("Replay collection properties must be data descriptors.");
  }
  restorePropertyDescriptors(getCollectionProperties(value), properties, decode);
}

function record(value: unknown): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value))
    throw new TypeError("Expected replay data object.");
  return value as Record<string, unknown>;
}

function list(value: unknown): unknown[] {
  if (!Array.isArray(value)) throw new TypeError("Expected replay data array.");
  return value;
}

function own(value: Record<string, unknown>, key: string): unknown {
  if (!Object.hasOwn(value, key)) throw new TypeError(`Missing replay data field '${key}'.`);
  return value[key];
}

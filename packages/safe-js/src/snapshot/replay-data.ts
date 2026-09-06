import { MAX_DATA_DEPTH } from "../graph-depth.js";
import { validateBigIntData } from "./bigint.js";
import { serializeRegexProperties, restoreRegexProperties, type RegexPropertyData } from "./regexp-properties.js";
import { wellKnownSymbols } from "../interp/symbols.js";
import { symbolData, serializeSymbolProperties, type SerializedSymbol, type SerializedSymbolProperty } from "./symbols.js";
import { isSandboxCollectionIterator, restoreSandboxCollectionIterator, snapshotCollectionIterator, type CollectionIterationMethod } from "../interp/collection-iterator.js";
import { isSandboxRegExpIterator, regexpIteratorState, restoreSandboxRegExpIterator } from "../interp/regexp-iterator.js";
import { hasGuestObjectState, hasNullObjectPrototype, setSandboxPrototype } from "../interp/object-model.js";
import { CompileScope } from "../interp/regex/compile-guard.js";
import { float32DataProperties, isFloat32Array } from "../interp/float32.js";
import { decodeFloat32Storage, encodeFloat32Storage, type Float32Data } from "./float32array.js";
import { dateDataProperties, isSandboxDate, restoreDateTime, serializedDateTime } from "../interp/date.js";
import { createRawJson, isRawJson } from "../interp/raw-json.js";
import { boxedDataProperties, createSandboxBox, nativeBoxedValue } from "../interp/boxed.js";
import { validateBoxedProperties } from "./boxed.js";
import { sandboxErrorNames, sandboxErrorTypes, type SandboxErrorName } from "../error/shape.js";
import {
  createSandboxArguments,
  createSandboxClosure,
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
  | { tag: "ref"; id: number };
type Properties = Record<
  string,
  { value: Atom; configurable: boolean; enumerable: boolean; writable: boolean }
>;
type DataNode =
  | { kind: "raw-json"; text: string }
  | { kind: "regexp-iterator"; matcher: Atom; input: Atom; exhausted: boolean; global?: boolean; unicode?: boolean; properties: Properties; extensible: boolean; symbolEntries?: Array<SerializedSymbolProperty<Atom>> }
  | SerializedSymbol
  | { kind: "boxed"; value: Atom; properties: Properties; extensible: boolean; symbolEntries?: Array<SerializedSymbolProperty<Atom>> }
  | { kind: "collection-iterator"; collectionKind: "map" | "set"; method: CollectionIterationMethod; collection: Atom; index: number; exhausted: boolean; properties: Properties; extensible: boolean }
  | { kind: "date"; time: number | null; properties?: Properties; symbolProperties?: Array<SerializedSymbolProperty<Atom>>; extensible?: boolean }
  | (Float32Data<Atom> & { properties: Properties; extensible: boolean })
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
  | { kind: "map"; entries: Array<[Atom, Atom]> }
  | { kind: "set"; values: Atom[] }
  | ({ kind: "regex"; source: string; flags: string; lastIndex: Atom } & RegexPropertyData<Atom>);
export type ReplayData = { root: Atom; nodes: DataNode[] };
export type ReplayPathSegment = string | { symbol: number };

export class MissingReplayCapabilityError extends TypeError {}

export function encodeReplayData(
  value: SandboxValue,
  options: {
    identifyCapability?: (value: SandboxClosure, path: readonly ReplayPathSegment[]) => string | undefined;
    captureCapabilityProperties?: boolean;
    identifyPromise?: (value: SandboxPromise, path: readonly ReplayPathSegment[]) => string | undefined;
  } = {}
): ReplayData {
  const nodes: DataNode[] = [];
  const seen = new WeakMap<object, number>();
  const symbols = new Map<symbol, number>();
  const float32Buffers = new WeakMap<ArrayBuffer, number>();
  const encode = (entry: SandboxValue, depth: number, path: readonly ReplayPathSegment[]): Atom => {
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
    }
    if (typeof entry === "object" && entry !== null && hasGuestObjectState(entry)) {
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
    const child = (value: SandboxValue, key: string) => encode(value, depth + 1, [...path, key]);
    if (isSandboxClosure(entry)) {
      nodes[id] = {
        kind: "capability",
        id: capabilityId!,
        properties: child(entry.properties, "properties")
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
        ...(Object.keys(properties).length === 0 ? {} : { properties }),
        ...(symbolProperties.length === 0 ? {} : { symbolProperties }),
        ...(Object.isExtensible(entry) ? {} : { extensible: false })
      };
    } else if (isFloat32Array(entry)) {
      const storage = encodeFloat32Storage(entry, id, float32Buffers, (id) => ({
        tag: "ref" as const,
        id
      }));
      const properties: Properties = Object.create(null);
      for (const [key, descriptor] of float32DataProperties(entry)) {
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
        entries: [...entry.entries].map(([key, value], index) => [
          child(key, `key:${index}`),
          child(value, `value:${index}`)
        ])
      };
    } else if (isSandboxSet(entry)) {
      nodes[id] = {
        kind: "set",
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
  return { root: encode(value, 0, []), nodes };
}

export function decodeReplayData(
  input: unknown,
  options: {
    resolveCapability?: (id: string) => SandboxClosure | undefined;
    resolvePromise?: (id: string) => SandboxPromise | undefined;
    onCapabilityRestored?: (original: SandboxClosure, restored: SandboxClosure) => void;
  } = {},
  parent?: CompileScope
): SandboxValue {
  const compilation = new CompileScope(parent?.owner);
  try {
    validateSnapshotData(input);
    const graph = record(input);
    const nodes = list(own(graph, "nodes"));
    const restored = new Map<number, SandboxValue>();
    const initializeIterators: Array<() => void> = [];
    const decode = (entry: unknown, depth = 0): SandboxValue => {
      if (depth > MAX_DATA_DEPTH) throw new TypeError("Replay data exceeds the nesting limit.");
      if (entry === null || typeof entry === "boolean" || typeof entry === "string") return entry;
      if (typeof entry === "number" && Number.isFinite(entry)) return entry;
      const atom = record(entry);
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
        options.onCapabilityRestored?.(capability, copy);
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
      if (kind === "date") {
        if (Object.keys(node).some(key => !["kind", "time", "properties", "symbolProperties", "extensible"].includes(key))) throw new TypeError("Invalid serialized Date fields.");
        if (node.extensible !== undefined && typeof node.extensible !== "boolean") throw new TypeError("Invalid replay Date extensibility.");
        const result = restoreDateTime(own(node, "time"));
        restored.set(id, result);
        defineProperties(result, node.properties === undefined ? {} : record(node.properties), child, node.symbolProperties);
        if (node.extensible === false) Object.preventExtensions(result);
        return result;
      }
      if (kind === "float32array") {
        if (typeof node.extensible !== "boolean")
          throw new TypeError("Invalid Float32Array extensibility.");
        const result = decodeFloat32Storage(node, child);
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
        initializeIterators.push(() => { restoreSandboxCollectionIterator({ collection, collectionKind, method, index, exhausted }, result); });
        defineProperties(result, record(own(node, "properties")), child);
        if (!node.extensible) Object.preventExtensions(result);
        return result;
      }
      if (kind === "map") {
        const result = createSandboxMap();
        restored.set(id, result);
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
    for (const initialize of initializeIterators) initialize();
    if (parent !== undefined) compilation.forward(compilation.tickets, parent);
    return result;
  } finally {
    compilation.dispose();
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

import { collectionIteratorState, isSandboxCollectionIterator } from "../interp/collection-iterator.js";
import { regexpIteratorState, isSandboxRegExpIterator } from "../interp/regexp-iterator.js";
import {
  createSandboxPromise,
  createSandboxClosure,
  isSandboxClosure,
  isSandboxMap,
  isSandboxSet,
  isSandboxPromise,
  getPromiseProperties,
  type SandboxClosure,
  type SandboxPromise,
  type SandboxValue
} from "../interp/values.js";
import { createReplayEncodingContext, decodeReplayData, encodeReplayData, type ReplayData, type ReplayPathSegment } from "./replay-data.js";
import { CompileScope } from "../interp/regex/compile-guard.js";
import { ownSerializableSymbolKeys } from "./symbols.js";
import { isSandboxModuleNamespace } from "../interp/module-namespace.js";
import { validateSnapshotData } from "./validation.js";


export type ReplayInputs = {
  bindings: Record<string, SandboxValue>;
  imports: Record<string, SandboxValue>;
  entryPointArgs: SandboxValue[] | undefined;
  importMeta: SandboxValue;
  moduleNamespaces?: Record<string,SandboxValue>;
};

type ModuleReplayInputs = {namespace: Record<string,SandboxValue>};

export function prepareReplayInputs<T extends ReplayInputs | ModuleReplayInputs>(
  current: T,
  saved?: unknown,
  preparePromise?: (promise: SandboxPromise | undefined, id: string) => SandboxPromise,
  onCapabilityRestored?: (original: SandboxClosure, restored: SandboxClosure) => void,
  compilation?: CompileScope,
  onInputSymbols?: (symbols: ReadonlyMap<number, symbol>) => void
): {
  values: T;
  snapshot: ReplayData;
  captureNamespace: (namespace: Record<string, SandboxValue>, name: string) => void;
  prepareNamespace: (namespace: Record<string, SandboxValue>, name: string) => Record<string, SandboxValue>;
} {
  const identities = new WeakMap<object, string>();
  const capabilities = new Map<string, SandboxClosure>();
  const promises = new Map<string, SandboxPromise>();
  const namespaces: Record<string, SandboxValue> = Object.create(null);
  if ("moduleNamespaces" in current) Object.assign(namespaces, current.moduleNamespaces);
  const context = createReplayEncodingContext();
  const identifyCapability = (closure: SandboxClosure, path: readonly ReplayPathSegment[]) => {
    const id = identities.get(closure) ?? JSON.stringify(path);
    identities.set(closure, id);
    capabilities.set(id, closure);
    return id;
  };
  const inputPromises = new Map<string, SandboxPromise>();
  const identifyPromise = (promise: SandboxPromise, path: readonly ReplayPathSegment[]) => {
    if (preparePromise === undefined) return undefined;
    const id = identities.get(promise) ?? JSON.stringify(path);
    identities.set(promise, id);
    inputPromises.set(id, promise);
    return id;
  };
  const readCapability = (id: string): SandboxValue => {
    const path: unknown = JSON.parse(id);
    if (!Array.isArray(path) || path.length === 0)
      throw new TypeError("Invalid replay input capability path.");
    let value: SandboxValue = { ...current, moduleNamespaces: namespaces };
    for (const key of path) {
      if (typeof key !== "string") {
        if (key === null || typeof key !== "object" || Array.isArray(key) ||
            Object.keys(key).length !== 1 || !Object.hasOwn(key, "symbol") ||
            !Number.isSafeInteger(key.symbol) || key.symbol < 0)
          throw new TypeError("Invalid replay input symbol capability path.");
        if (value === null || typeof value !== "object") return undefined;
        const symbol = ownSerializableSymbolKeys(value)[key.symbol];
        if (symbol === undefined) return undefined;
        const descriptor = Object.getOwnPropertyDescriptor(value, symbol);
        if (descriptor === undefined || !("value" in descriptor)) return undefined;
        value = descriptor.value;
        continue;
      }
      if (isSandboxRegExpIterator(value)) {
        if (key === "<matcher>") value = regexpIteratorState(value).matcher;
        else if (key === "<input>") value = regexpIteratorState(value).input;
        else {
          const property: unknown = JSON.parse(key);
          if (!Array.isArray(property) || property.length !== 2 || property[0] !== "property" || typeof property[1] !== "string") throw new TypeError("Invalid replay input iterator capability path.");
          const descriptor = Object.getOwnPropertyDescriptor(value, property[1]);
          value = descriptor !== undefined && "value" in descriptor ? descriptor.value : undefined;
        }
        continue;
      }
      if (isSandboxCollectionIterator(value)) {
        if (key === "<collection>") value = collectionIteratorState(value).collection;
        else {
          const property: unknown = JSON.parse(key);
          if (!Array.isArray(property) || property.length !== 2 || property[0] !== "property" || typeof property[1] !== "string") throw new TypeError("Invalid replay input iterator capability path.");
          const descriptor = Object.getOwnPropertyDescriptor(value, property[1]);
          value = descriptor !== undefined && "value" in descriptor ? descriptor.value : undefined;
        }
        continue;
      }
      if (isSandboxMap(value)) {
        const [kind, ordinal] = key.split(":");
        const index = Number(ordinal);
        if (
          !["key", "value"].includes(kind) ||
          String(index) !== ordinal ||
          !Number.isSafeInteger(index) ||
          index < 0
        )
          throw new TypeError("Invalid replay input map capability path.");
        value = [...value.entries][index]?.[kind === "key" ? 0 : 1];
        continue;
      }
      if (isSandboxSet(value)) {
        const index = Number(key);
        if (String(index) !== key || !Number.isSafeInteger(index) || index < 0)
          throw new TypeError("Invalid replay input set capability path.");
        value = [...value.values][index];
        continue;
      }
      if (key === "properties" && isSandboxClosure(value)) {
        value = value.properties;
        continue;
      }
      if (key === "properties" && isSandboxPromise(value)) {
        value = getPromiseProperties(value);
        continue;
      }
      if (value === null || typeof value !== "object") return undefined;
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (descriptor === undefined || !("value" in descriptor)) return undefined;
      value = descriptor.value;
    }
    return value;
  };
  const resolveCapability = (id: string) => {
    const value = saved === undefined ? capabilities.get(id) : readCapability(id);
    return isSandboxClosure(value) ? value : undefined;
  };
  const memo = { nodes: context.nodes, values: new Map<number, SandboxValue>() };
  if (saved !== undefined) validateSnapshotData(saved);
  const snapshot = saved === undefined ? encodeReplayData(current, {
    context, captureCapabilityProperties: true, identifyCapability, identifyPromise,
    onValueEncoded: (id, value) => { memo.values.set(id, value); }
  }) : structuredClone(saved) as ReplayData;
  if (saved !== undefined) {
    const validationScope = new CompileScope(compilation?.owner);
    try {
      const validated = decodeReplayData(snapshot, {
        resolveCapability,
        resolvePromise: id => { readCapability(id); return createSandboxPromise(Promise.resolve(undefined), { trackReplay: false }); }
      }, validationScope);
      assertReplayInputShape(validated, "namespace" in current);
      if (snapshot.namespaceRoots !== undefined) {
        if (snapshot.namespaceRoots === null || typeof snapshot.namespaceRoots !== "object" || Array.isArray(snapshot.namespaceRoots))
          throw new TypeError("Invalid replay namespace roots.");
        const validationCapability = createSandboxClosure({ call: () => undefined });
        for (const root of Object.values(snapshot.namespaceRoots)) {
          const namespace = decodeReplayData({ root, nodes: snapshot.nodes }, {
            resolveCapability: id => { readCapability(id); return validationCapability; },
            resolvePromise: id => { readCapability(id); return createSandboxPromise(Promise.resolve(undefined), { trackReplay: false }); }
          }, validationScope);
          if (!isSandboxModuleNamespace(namespace)) throw new TypeError("Invalid replay module namespace.");
        }
      }
    } finally {
      validationScope.dispose();
    }
    context.nodes = snapshot.nodes;
    memo.nodes = snapshot.nodes;
  }
  const inputSymbols = new Map<number, symbol>();
  for (let id = 0; id < snapshot.nodes.length; id++) {
    if (snapshot.nodes[id]?.kind !== "symbol") continue;
    const symbol = decodeReplayData({ root: { tag: "ref", id }, nodes: snapshot.nodes }, { memo }, compilation);
    if (typeof symbol !== "symbol") throw new TypeError("Invalid input symbol.");
    inputSymbols.set(id, symbol);
  }
  onInputSymbols?.(inputSymbols);
  const resolvePromise = (id: string) => {
    const value = saved === undefined ? inputPromises.get(id) : readCapability(id);
    if (!promises.has(id) && preparePromise !== undefined)
      promises.set(id, preparePromise(isSandboxPromise(value) ? value : undefined, id));
    return promises.get(id);
  };
  if (inputPromises.size > 0) {
    memo.values.clear();
    for (const [id, symbol] of inputSymbols) memo.values.set(id, symbol);
  }
  const values = saved === undefined && inputPromises.size === 0 ? current
    : decodeReplayData(snapshot, { memo, resolveCapability, resolvePromise, onCapabilityRestored }, compilation) as T;
  const captureNamespace = (namespace: Record<string, SandboxValue>, name: string) => {
    if (!Object.hasOwn(namespaces, name)) namespaces[name] = namespace;
    if (snapshot.namespaceRoots !== undefined && Object.hasOwn(snapshot.namespaceRoots, name)) return;
    if (!isSandboxModuleNamespace(namespace)) throw new TypeError("Invalid replay module namespace.");
    const encoded = encodeReplayData(namespace, {
      context, path: ["moduleNamespaces", name], captureCapabilityProperties: true,
      identifyCapability, identifyPromise
    });
    snapshot.namespaceRoots ??= Object.create(null) as NonNullable<ReplayData["namespaceRoots"]>;
    Object.defineProperty(snapshot.namespaceRoots, name, {
      value: encoded.root, enumerable: true, configurable: true, writable: true
    });
  };
  return {
    values, snapshot, captureNamespace,
    prepareNamespace: (namespace, name) => {
      captureNamespace(namespace, name);
      return decodeReplayData({ root: snapshot.namespaceRoots![name], nodes: snapshot.nodes },
        { memo, resolveCapability, resolvePromise, onCapabilityRestored }, compilation) as Record<string, SandboxValue>;
    }
  };
}

function assertReplayInputShape(restored: SandboxValue, moduleInput: boolean): void {
  if (
    restored === null ||
    typeof restored !== "object" ||
    Array.isArray(restored) ||
    isSandboxClosure(restored) ||
    isSandboxPromise(restored) ||
    isSandboxCollectionIterator(restored) ||
    isSandboxRegExpIterator(restored) ||
    isSandboxMap(restored) ||
    isSandboxSet(restored)
  )
    throw new TypeError("Invalid replay inputs.");
  const values = restored as Record<string,SandboxValue>;
  for (const key of moduleInput ? ["namespace"] : ["bindings", "imports", ...(values.moduleNamespaces===undefined ? [] : ["moduleNamespaces"])]) {
    if (
      values[key] === null ||
      typeof values[key] !== "object" ||
      Array.isArray(values[key]) ||
      isSandboxClosure(values[key]) ||
      isSandboxPromise(values[key]) ||
      isSandboxCollectionIterator(values[key]) ||
      isSandboxRegExpIterator(values[key]) ||
      isSandboxMap(values[key]) ||
      isSandboxSet(values[key])
    )
      throw new TypeError(`Invalid replay input ${key}.`);
  }
  if (values.entryPointArgs !== undefined && !Array.isArray(values.entryPointArgs))
    throw new TypeError("Invalid replay entry point arguments.");
  const namespaces = moduleInput ? [values.namespace]
    : Object.values((values.moduleNamespaces ?? {}) as Record<string,SandboxValue>);
  if (namespaces.some(namespace=>!isSandboxModuleNamespace(namespace)))
    throw new TypeError("Invalid replay module namespace.");
}

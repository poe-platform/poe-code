import {
  createSandboxPromise,
  isSandboxClosure,
  isSandboxMap,
  isSandboxSet,
  isSandboxPromise,
  type SandboxClosure,
  type SandboxPromise,
  type SandboxValue
} from "../interp/values.js";
import { decodeReplayData, encodeReplayData, type ReplayData } from "./replay-data.js";
import { CompileScope } from "../interp/regex/compile-guard.js";

const validationPromise = createSandboxPromise(Promise.resolve(undefined));

export type ReplayInputs = {
  bindings: Record<string, SandboxValue>;
  imports: Record<string, SandboxValue>;
  entryPointArgs: SandboxValue[] | undefined;
  importMeta: SandboxValue;
};

export function prepareReplayInputs(
  current: ReplayInputs,
  saved?: unknown,
  preparePromise?: (promise: SandboxPromise | undefined, id: string) => SandboxPromise,
  onCapabilityRestored?: (original: SandboxClosure, restored: SandboxClosure) => void,
  compilation?: CompileScope
): {
  values: ReplayInputs;
  snapshot: ReplayData;
} {
  const identities = new WeakMap<object, string>();
  const capabilities = new Map<string, SandboxClosure>();
  const promises = new Map<string, SandboxPromise>();
  if (saved === undefined) {
    const snapshot = encodeReplayData(current, {
      captureCapabilityProperties: true,
      identifyCapability: (closure, path) => {
        const id = identities.get(closure) ?? JSON.stringify(path);
        identities.set(closure, id);
        capabilities.set(id, closure);
        return id;
      },
      identifyPromise: (promise, path) => {
        if (preparePromise === undefined) return undefined;
        const id = identities.get(promise) ?? JSON.stringify(path);
        identities.set(promise, id);
        if (!promises.has(id)) promises.set(id, preparePromise(promise, id));
        return id;
      }
    });
    return {
      values:
        promises.size === 0
          ? current
          : (decodeReplayData(
              snapshot,
              {
                resolveCapability: (id) => capabilities.get(id),
                resolvePromise: (id) => promises.get(id)
              },
              compilation
            ) as ReplayInputs),
      snapshot
    };
  }
  const readCapability = (id: string): SandboxValue => {
    const path: unknown = JSON.parse(id);
    if (!Array.isArray(path) || path.length === 0 || path.some((key) => typeof key !== "string"))
      throw new TypeError("Invalid replay input capability path.");
    let value: SandboxValue = current;
    for (const key of path) {
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
      if (value === null || typeof value !== "object") return undefined;
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (descriptor === undefined || !("value" in descriptor)) return undefined;
      value = descriptor.value;
    }
    return value;
  };
  const resolveCapability = (id: string) => {
    const value = readCapability(id);
    return isSandboxClosure(value) ? value : undefined;
  };
  const validationScope = new CompileScope(compilation?.owner);
  try {
    const validated = decodeReplayData(
      saved,
      {
        resolveCapability,
        resolvePromise: (id) => {
          readCapability(id);
          return validationPromise;
        }
      },
      validationScope
    );
    assertReplayInputShape(validated);
  } finally {
    validationScope.dispose();
  }
  const restored = decodeReplayData(
    saved,
    {
      resolveCapability,
      onCapabilityRestored,
      resolvePromise: (id) => {
        const value = readCapability(id);
        if (!promises.has(id) && preparePromise !== undefined)
          promises.set(id, preparePromise(isSandboxPromise(value) ? value : undefined, id));
        return promises.get(id);
      }
    },
    compilation
  );
  return { values: restored as ReplayInputs, snapshot: structuredClone(saved) as ReplayData };
}

function assertReplayInputShape(restored: SandboxValue): asserts restored is ReplayInputs {
  if (
    restored === null ||
    typeof restored !== "object" ||
    Array.isArray(restored) ||
    isSandboxClosure(restored) ||
    isSandboxPromise(restored) ||
    isSandboxMap(restored) ||
    isSandboxSet(restored)
  )
    throw new TypeError("Invalid replay inputs.");
  const values = restored as ReplayInputs;
  for (const key of ["bindings", "imports"] as const) {
    if (
      values[key] === null ||
      typeof values[key] !== "object" ||
      Array.isArray(values[key]) ||
      isSandboxClosure(values[key]) ||
      isSandboxPromise(values[key]) ||
      isSandboxMap(values[key]) ||
      isSandboxSet(values[key])
    )
      throw new TypeError(`Invalid replay input ${key}.`);
  }
  if (values.entryPointArgs !== undefined && !Array.isArray(values.entryPointArgs))
    throw new TypeError("Invalid replay entry point arguments.");
}

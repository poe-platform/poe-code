import type { DataLayer } from "./types.js";

export interface MergeLayersResult {
  data: Record<string, unknown>;
  sources: Record<string, string>;
}

export function mergeLayers(layers: DataLayer[]): MergeLayersResult {
  for (const layer of layers) {
    assertAcyclic(layer.data, new Set<object>());
  }

  return mergeObjectLayers(layers, []);
}

function mergeObjectLayers(layers: DataLayer[], path: string[]): MergeLayersResult {
  const data: Record<string, unknown> = {};
  const sources: Record<string, string> = {};

  for (const key of collectKeys(layers)) {
    const resolved = resolveKey(layers, key, path);

    if (resolved === undefined) {
      continue;
    }

    defineDataProperty(data, key, resolved.value);
    for (const [sourcePath, source] of Object.entries(resolved.sources)) {
      defineDataProperty(sources, sourcePath, source);
    }
  }

  return { data, sources };
}

function collectKeys(layers: DataLayer[]): string[] {
  const keys = new Set<string>();

  for (const layer of layers) {
    for (const key of Object.keys(layer.data)) {
      keys.add(key);
    }
  }

  return [...keys];
}

function resolveKey(
  layers: DataLayer[],
  key: string,
  path: string[]
): { value: unknown; sources: Record<string, string> } | undefined {
  let winningSource: string | undefined;
  let winningValue: unknown;
  const objectLayers: DataLayer[] = [];

  for (const layer of layers) {
    const candidate = getOwnEntry(layer.data, key);

    if (!isWinningCandidate(key, candidate)) {
      continue;
    }

    if (winningSource === undefined) {
      winningSource = layer.source;
      winningValue = candidate;

      if (isPlainObject(candidate)) {
        objectLayers.push({
          source: layer.source,
          data: candidate
        });
      }

      continue;
    }

    if (isPlainObject(winningValue) && isPlainObject(candidate)) {
      objectLayers.push({
        source: layer.source,
        data: candidate
      });
    }
  }

  if (winningSource === undefined) {
    return undefined;
  }

  if (winningValue === null) {
    return undefined;
  }

  const fullPath = buildPath(path, key);

  if (isPlainObject(winningValue)) {
    const merged = mergeObjectLayers(objectLayers, [...path, key]);

    return {
      value: merged.data,
      sources: {
        [fullPath]: winningSource,
        ...merged.sources
      }
    };
  }

  return {
    value: cloneValue(winningValue),
    sources: {
      [fullPath]: winningSource
    }
  };
}

function isWinningCandidate(key: string, value: unknown): boolean {
  if (value === undefined) {
    return false;
  }

  if (key === "prompt" && value === "") {
    return false;
  }

  return true;
}

function getOwnEntry(record: Record<string, unknown>, key: string): unknown {
  return Object.prototype.hasOwnProperty.call(record, key) ? record[key] : undefined;
}

function buildPath(path: string[], key: string): string {
  return [...path, key].map(escapePathSegment).join(".");
}

function escapePathSegment(segment: string): string {
  return segment.replaceAll("\\", "\\\\").replaceAll(".", "\\.");
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (value === null || Array.isArray(value) || typeof value !== "object") {
    return false;
  }

  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function cloneValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((entry) => cloneValue(entry));
  }

  if (!isPlainObject(value)) {
    return value;
  }

  const clone = Object.create(Object.getPrototypeOf(value)) as Record<string, unknown>;

  for (const [key, entry] of Object.entries(value)) {
    defineDataProperty(clone, key, cloneValue(entry));
  }

  return clone;
}

function assertAcyclic(value: unknown, ancestors: Set<object>): void {
  if (!Array.isArray(value) && !isPlainObject(value)) {
    return;
  }

  if (ancestors.has(value)) {
    throw new Error("Cyclic config data is not supported.");
  }

  const nextAncestors = new Set(ancestors);
  nextAncestors.add(value);

  for (const entry of Array.isArray(value) ? value : Object.values(value)) {
    assertAcyclic(entry, nextAncestors);
  }
}

function defineDataProperty(object: Record<string, unknown>, key: string, value: unknown): void {
  Object.defineProperty(object, key, {
    configurable: true,
    enumerable: true,
    value,
    writable: true
  });
}

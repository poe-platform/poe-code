import type { ConfigDocument } from "./types.js";

export function deepMergeDocuments(base: ConfigDocument, override: ConfigDocument): ConfigDocument {
  const merged: ConfigDocument = {};
  const scopes = new Set([...Object.keys(base), ...Object.keys(override)]);

  for (const scope of scopes) {
    const baseScope = getOwnRecordEntry(base, scope);
    const overrideScope = getOwnRecordEntry(override, scope);
    const nextScope = mergeScope(scope, baseScope, overrideScope);

    if (Object.keys(nextScope).length > 0) {
      setOwnEntry(merged, scope, nextScope);
    }
  }

  return merged;
}

function mergeScope(
  scope: string,
  baseScope: Record<string, unknown>,
  overrideScope: Record<string, unknown>
): Record<string, unknown> {
  if (scope === "runtime") {
    return mergeRuntimeScope(baseScope, overrideScope);
  }

  const scopeEntries = Object.entries(overrideScope).filter(([, value]) => value !== undefined);
  const merged: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(baseScope)) {
    setOwnEntry(merged, key, value);
  }

  for (const [key, value] of scopeEntries) {
    setOwnEntry(merged, key, value);
  }

  return merged;
}

function mergeRuntimeScope(
  baseScope: Record<string, unknown>,
  overrideScope: Record<string, unknown>,
  path: string[] = []
): Record<string, unknown> {
  const merged: Record<string, unknown> = {};
  const keys = new Set([...Object.keys(baseScope), ...Object.keys(overrideScope)]);

  for (const key of keys) {
    const baseValue = getOwnEntry(baseScope, key);
    const overrideValue = getOwnEntry(overrideScope, key);
    if (overrideValue === undefined) {
      if (baseValue !== undefined) {
        setOwnEntry(merged, key, baseValue);
      }
      continue;
    }

    if (
      isRuntimeConcatenativeArray([...path, key]) &&
      Array.isArray(baseValue) &&
      Array.isArray(overrideValue)
    ) {
      setOwnEntry(merged, key, [...baseValue, ...overrideValue]);
      continue;
    }

    if (isRecord(baseValue) && isRecord(overrideValue)) {
      setOwnEntry(merged, key, mergeRuntimeScope(baseValue, overrideValue, [...path, key]));
      continue;
    }

    setOwnEntry(merged, key, overrideValue);
  }

  return merged;
}

function isRuntimeConcatenativeArray(path: string[]): boolean {
  return path.join(".") === "mounts" || path.join(".") === "runner.workspace.exclude";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function getOwnEntry(record: Record<string, unknown>, key: string): unknown {
  return Object.prototype.hasOwnProperty.call(record, key) ? record[key] : undefined;
}

function getOwnRecordEntry(record: Record<string, unknown>, key: string): Record<string, unknown> {
  const value = getOwnEntry(record, key);
  return isRecord(value) ? value : {};
}

function setOwnEntry(target: Record<string, unknown>, key: string, value: unknown): void {
  Object.defineProperty(target, key, {
    value,
    enumerable: true,
    writable: true,
    configurable: true
  });
}

import type { ConfigDocument } from "./types.js";

export function deepMergeDocuments(base: ConfigDocument, override: ConfigDocument): ConfigDocument {
  const merged: ConfigDocument = {};
  const scopes = new Set([...Object.keys(base), ...Object.keys(override)]);

  for (const scope of scopes) {
    const baseScope = base[scope] ?? {};
    const overrideScope = override[scope] ?? {};
    const nextScope = mergeScope(scope, baseScope, overrideScope);

    if (Object.keys(nextScope).length > 0) {
      merged[scope] = nextScope;
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
  return {
    ...baseScope,
    ...Object.fromEntries(scopeEntries)
  };
}

function mergeRuntimeScope(
  baseScope: Record<string, unknown>,
  overrideScope: Record<string, unknown>
): Record<string, unknown> {
  const merged: Record<string, unknown> = {};
  const keys = new Set([...Object.keys(baseScope), ...Object.keys(overrideScope)]);

  for (const key of keys) {
    const baseValue = baseScope[key];
    const overrideValue = overrideScope[key];
    if (overrideValue === undefined) {
      if (baseValue !== undefined) {
        merged[key] = baseValue;
      }
      continue;
    }

    if (key === "mounts" && Array.isArray(baseValue) && Array.isArray(overrideValue)) {
      merged[key] = [...baseValue, ...overrideValue];
      continue;
    }

    if (isRecord(baseValue) && isRecord(overrideValue)) {
      merged[key] = mergeRuntimeScope(baseValue, overrideValue);
      continue;
    }

    merged[key] = overrideValue;
  }

  return merged;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

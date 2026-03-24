import type { ConfigDocument } from "./types.js";

export function deepMergeDocuments(base: ConfigDocument, override: ConfigDocument): ConfigDocument {
  const merged: ConfigDocument = {};
  const scopes = new Set([...Object.keys(base), ...Object.keys(override)]);

  for (const scope of scopes) {
    const baseScope = base[scope] ?? {};
    const overrideScope = override[scope] ?? {};
    const scopeEntries = Object.entries(overrideScope).filter(([, value]) => value !== undefined);
    const nextScope = {
      ...baseScope,
      ...Object.fromEntries(scopeEntries)
    };

    if (Object.keys(nextScope).length > 0) {
      merged[scope] = nextScope;
    }
  }

  return merged;
}

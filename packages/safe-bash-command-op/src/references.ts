import type { OpBackend, OpBackendContext, OpItem, OpSecretReference } from "./types.js";

export function parseSecretReference(reference: string): OpSecretReference {
  if (reference.slice(0, 5).toLowerCase() !== "op://") throw new Error("Invalid secret reference scheme");
  const queryStart = reference.indexOf("?");
  const path = reference.slice(5, queryStart < 0 ? undefined : queryStart);
  const parts = path.split("/");
  const allowed = "abcdefghijklmnopqrstuvwxyz0123456789-_. \t\n\r\v\f";
  if ((parts.length !== 3 && parts.length !== 4) || parts.some(part => !part || [...part.toLowerCase()].some(character => !allowed.includes(character)))) {
    throw new Error("Invalid secret reference path; use IDs for unsupported names");
  }
  const result: OpSecretReference = { vault: parts[0]!, item: parts[1]!, field: parts[parts.length - 1]! };
  if (parts.length === 4) result.section = parts[2]!;
  if (queryStart >= 0) {
    const query: Record<string, string> = {};
    for (const entry of reference.slice(queryStart + 1).split("&")) {
      const separator = entry.indexOf("=");
      const key = entry.slice(0, separator);
      const value = entry.slice(separator + 1);
      if (separator < 1 || !value || !["attribute", "attr", "ssh-format"].includes(key) || Object.hasOwn(query, key)) throw new Error("Invalid secret reference query");
      query[key] = value;
    }
    if (query.attribute && query.attr) throw new Error("Conflicting attribute parameters");
    result.query = query;
  }
  return result;
}

export function deriveItemFieldReferences(item: OpItem): OpItem {
  const result = structuredClone(item);
  if (result.fields === undefined) return result;
  result.fields = result.fields.map(field => {
    try {
      const parts = [result.vault.id, result.id, ...(field.section === undefined ? [] : [field.section.id]), field.id];
      if (parts.some(part => typeof part !== "string" || !part)) throw new Error();
      const reference = `op://${parts.join("/")}`;
      const parsed = parseSecretReference(reference);
      if (parsed.vault !== result.vault.id || parsed.item !== result.id || parsed.section !== field.section?.id || parsed.field !== field.id || parsed.query !== undefined) throw new Error();
      return { ...field, reference };
    } catch {
      throw new Error("Cannot derive field reference from item IDs");
    }
  });
  return result;
}

export async function resolveSecretReference(reference: string, backend: OpBackend, context: OpBackendContext): Promise<unknown> {
  context.signal.throwIfAborted();
  parseSecretReference(reference);
  const value = await backend.execute({ resource: "secret", action: "read", args: [reference], flags: {} }, context);
  context.signal.throwIfAborted();
  return value;
}

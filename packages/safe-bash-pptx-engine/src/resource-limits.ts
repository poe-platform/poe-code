import type { ByteLimits } from "./contracts.js";
import type { ZipLimits } from "@poe-code/office-package/zip";
import type { XmlLimits } from "./xml.js";
import type { RelationshipLimits } from "./relationships.js";
import type { SelectionContext } from "./selectors.js";
import { OfficeError } from "./errors.js";

export interface ResourceContext {
  readonly limits?: Partial<ByteLimits>;
  readonly archiveLimits?: Partial<ZipLimits>;
  readonly xmlLimits?: Partial<XmlLimits>;
  readonly relationshipLimits?: Partial<RelationshipLimits>;
  readonly signal?: AbortSignal;
}

/** Resolve absent resource ceilings to unlimited; chunk sizes only control I/O. */
export function resourceContext(context: ResourceContext = {}): SelectionContext {
  if (!context || typeof context !== "object" || Array.isArray(context))
    throw new OfficeError("invalid-type", "Expected a resource context.", "usage");
  for (const key of Reflect.ownKeys(context)) {
    if (!("value" in Object.getOwnPropertyDescriptor(context, key)!))
      throw new OfficeError("invalid-value", "Resource context requires stored data.", "usage");
  }
  for (const limits of [context.limits, context.archiveLimits, context.xmlLimits, context.relationshipLimits]) {
    if (limits === undefined) continue;
    if (!limits || typeof limits !== "object" || Array.isArray(limits) ||
      Reflect.ownKeys(limits).some(key => !("value" in Object.getOwnPropertyDescriptor(limits, key)!)))
      throw new OfficeError("invalid-value", "Limits require stored data.", "usage");
  }
  const resolved = {
    ...context,
    limits: { maxBytes: Infinity, maxReads: Infinity, chunkBytes: 65536, ...context.limits },
    archiveLimits: {
      maxArchiveBytes: Infinity, maxEntryBytes: Infinity, maxTotalBytes: Infinity,
      maxMembers: Infinity, maxPathBytes: Infinity, maxDepth: Infinity,
      maxPaxBytes: Infinity, maxTextBytes: Infinity, chunkSize: 65536, ...context.archiveLimits
    },
    xmlLimits: { maxBytes: Infinity, maxNodes: Infinity, maxDepth: Infinity, ...context.xmlLimits },
    relationshipLimits: { maxBytes: Infinity, maxParts: Infinity, maxRelationships: Infinity, ...context.relationshipLimits }
  };
  for (const limits of [resolved.limits, resolved.archiveLimits, resolved.xmlLimits, resolved.relationshipLimits]) {
    for (const [key, value] of Object.entries(limits)) {
      if ((value !== Infinity && !Number.isSafeInteger(value)) || value < 1 ||
        ((key === "chunkSize" || key === "chunkBytes") && !Number.isSafeInteger(value)))
        throw new OfficeError("invalid-value", "Limits must be positive safe integers or unlimited.", "usage");
    }
  }
  return resolved;
}

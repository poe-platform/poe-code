import type { FileSystem } from "@poe-code/safe-fs/core";
import type { ByteSource } from "@poe-code/office-package";
import {
  archiveSettings,
  InputTypeError,
  type ArchiveContext,
  type ArchiveLimits
} from "./archive.js";
import { documentLimitDefaults } from "./budget.js";

/** Explicit admitted metrics; no host font lookup is performed. */
export interface DocumentFontMetrics {
  measure(text: string, font: string, points: number): number;
}

export interface DocumentModelContext extends Partial<ArchiveContext> {
  readonly timestamp?: Date;
  readonly author?: string;
  readonly initials?: string | null;
  readonly metrics?: DocumentFontMetrics;
  readonly vfs?: { readonly capability: string; readonly filesystem: FileSystem };
  readonly binaryResolver?: {
    readonly capability: string;
    open(
      path: string,
      options: { readonly signal: AbortSignal; readonly maxBytes: number }
    ): ByteSource | Promise<ByteSource>;
  };
  readonly registerCleanup?: (cleanup: () => Promise<void>) => void;
}

export type AdmittedModelContext = ReturnType<typeof archiveSettings> &
  Required<Pick<DocumentModelContext, "timestamp" | "author" | "initials">> &
  Pick<DocumentModelContext, "metrics" | "vfs" | "binaryResolver" | "registerCleanup">;

function ownModelData<Value extends object>(value: Value): Value {
  if (
    !value ||
    typeof value !== "object" ||
    ![Object.prototype, null].includes(Object.getPrototypeOf(value))
  )
    throw new InputTypeError("Expected finite model context data.");
  const owned = Object.create(null) as Value;
  for (const key of Reflect.ownKeys(value)) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key)!;
    if (!Object.hasOwn(descriptor, "value"))
      throw new InputTypeError("Expected finite model context data.");
    Object.defineProperty(owned, key, {
      value: descriptor.value,
      enumerable: true,
      writable: true,
      configurable: true
    });
  }
  return owned;
}

/** Captures deterministic metadata and shared resource ceilings before admission. */
export function modelContext(
  context: DocumentModelContext = {},
  defaultLimits: Partial<ArchiveLimits> = {}
): AdmittedModelContext {
  context = ownModelData(context);
  const resolver = context.binaryResolver,
    metrics = context.metrics;
  if (context.signal !== undefined && !(context.signal instanceof AbortSignal))
    throw new InputTypeError("Expected a cancellation signal.");
  const defaults = documentLimitDefaults;
  let limits: ArchiveLimits = context.limits ?? {
    maxArchiveBytes: defaults.compressedInput,
    maxEntryBytes: defaults.xmlPartBytes,
    maxTotalBytes: defaults.expandedPackage,
    maxMembers: defaults.zipEntries,
    maxPathBytes: 4096,
    maxDepth: defaults.xmlDepth,
    maxExtraBytes: 65535,
    maxCommentBytes: 65535,
    maxRetainedBytes: defaults.retainedBytes,
    chunkSize: 65536,
    ...defaultLimits
  };
  for (const key of ["limits", "binaryResolver", "metrics", "vfs"] as const) {
    const value = context[key];
    if (value !== undefined) Object.defineProperty(context, key, { value: ownModelData(value) });
  }
  if (context.limits) limits = context.limits;
  const timestamp =
    context.timestamp === undefined ? new Date("1980-01-01T00:00:00Z") : context.timestamp;
  if (!(timestamp instanceof Date) || !Number.isFinite(Date.prototype.getTime.call(timestamp)))
    throw new InputTypeError("Expected a valid UTC Date.");
  const author = context.author === undefined ? "" : context.author,
    initials = context.initials === undefined ? "" : context.initials;
  if (
    typeof author !== "string" ||
    author.length > 510 ||
    [...author].length > 255 ||
    (initials !== null && typeof initials !== "string")
  )
    throw new InputTypeError("Expected bounded model identity strings.");
  if (
    context.metrics !== undefined &&
    (!context.metrics || typeof context.metrics.measure !== "function")
  )
    throw new InputTypeError("Expected explicit font metrics.");
  if (
    context.binaryResolver !== undefined &&
    (!context.binaryResolver ||
      typeof context.binaryResolver.capability !== "string" ||
      !context.binaryResolver.capability ||
      typeof context.binaryResolver.open !== "function")
  )
    throw new InputTypeError("Expected an explicit binary resolver capability.");
  if (
    context.vfs !== undefined &&
    (typeof context.vfs.capability !== "string" ||
      !context.vfs.capability ||
      !context.vfs.filesystem ||
      typeof context.vfs.filesystem !== "object")
  )
    throw new InputTypeError("Expected an explicit VFS capability.");
  if (context.registerCleanup !== undefined && typeof context.registerCleanup !== "function")
    throw new InputTypeError("Expected a cleanup registrar.");
  const settings = archiveSettings({
    ...context,
    limits,
    signal: context.signal ?? new AbortController().signal
  });
  settings.budget.check("work", 0);
  return ownModelData({
    ...settings,
    timestamp: new Date(Math.floor(Date.prototype.getTime.call(timestamp) / 1000) * 1000),
    author,
    initials,
    ...(context.vfs
      ? { vfs: { capability: context.vfs.capability, filesystem: context.vfs.filesystem } }
      : {}),
    ...(context.metrics ? { metrics: { measure: context.metrics.measure.bind(metrics) } } : {}),
    ...(context.binaryResolver
      ? {
          binaryResolver: {
            capability: context.binaryResolver.capability,
            open: context.binaryResolver.open.bind(resolver)
          }
        }
      : {}),
    ...(context.registerCleanup ? { registerCleanup: context.registerCleanup } : {})
  });
}

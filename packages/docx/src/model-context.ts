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
  Pick<DocumentModelContext, "metrics" | "binaryResolver" | "registerCleanup">;

/** Captures deterministic metadata and shared resource ceilings before admission. */
export function modelContext(
  context: DocumentModelContext = {},
  defaultLimits: Partial<ArchiveLimits> = {}
): AdmittedModelContext {
  if (
    !context ||
    typeof context !== "object" ||
    ![Object.prototype, null].includes(Object.getPrototypeOf(context))
  )
    throw new InputTypeError("Expected a model context.");
  for (const key of Reflect.ownKeys(context)) {
    const descriptor = Object.getOwnPropertyDescriptor(context, key)!;
    if (!("value" in descriptor)) throw new InputTypeError("Expected finite model context data.");
  }
  if (context.signal !== undefined && !(context.signal instanceof AbortSignal))
    throw new InputTypeError("Expected a cancellation signal.");
  const defaults = documentLimitDefaults;
  const limits: ArchiveLimits = context.limits ?? {
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
  for (const value of [context.limits, context.binaryResolver, context.metrics]) {
    if (value === undefined) continue;
    if (
      !value ||
      typeof value !== "object" ||
      ![Object.prototype, null].includes(Object.getPrototypeOf(value)) ||
      Reflect.ownKeys(value).some(
        (key) => !("value" in Object.getOwnPropertyDescriptor(value, key)!)
      )
    )
      throw new InputTypeError("Expected finite model capability data.");
  }
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
  if (context.registerCleanup !== undefined && typeof context.registerCleanup !== "function")
    throw new InputTypeError("Expected a cleanup registrar.");
  const settings = archiveSettings({
    ...context,
    limits,
    signal: context.signal ?? new AbortController().signal
  });
  settings.budget.check("work", 0);
  return {
    ...settings,
    timestamp: new Date(Math.floor(Date.prototype.getTime.call(timestamp) / 1000) * 1000),
    author,
    initials,
    ...(context.metrics ? { metrics: context.metrics } : {}),
    ...(context.binaryResolver
      ? {
          binaryResolver: {
            capability: context.binaryResolver.capability,
            open: context.binaryResolver.open.bind(context.binaryResolver)
          }
        }
      : {}),
    ...(context.registerCleanup ? { registerCleanup: context.registerCleanup } : {})
  };
}

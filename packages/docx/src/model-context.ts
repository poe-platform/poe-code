import type { ByteSource } from "@poe-code/office-package";
import {
  archiveSettings,
  InputTypeError,
  InvalidValueError,
  ResourceLimitError,
  type ArchiveContext,
  type ArchiveLimits
} from "./archive.js";
import { DocumentBudget, documentLimitDefaults, type DocumentLimits } from "./budget.js";

/** Explicit deterministic widths in points; never discovers or loads fonts. */
export interface DocumentFontMetrics {
  measure(text: string, font: string, points: number): number;
}

/** A caller-granted virtual read capability. Object identity is its authority. */
export interface DocumentVfsCapability {
  open(
    path: string,
    options: { readonly signal: AbortSignal; readonly maxBytes: number }
  ): ByteSource | Promise<ByteSource>;
}

export interface DocumentModelContext extends Partial<Omit<ArchiveContext, "limits">> {
  readonly limits?: Partial<ArchiveLimits> | Partial<DocumentLimits>;
  readonly timestamp?: Date;
  readonly author?: string;
  readonly initials?: string | null;
  readonly vfs?: DocumentVfsCapability;
  readonly fonts?: DocumentFontMetrics;
  readonly template?: Uint8Array;
  /** Existing host metric adapter; cannot be combined with fonts. */
  readonly metrics?: DocumentFontMetrics;
  /** Explicit trusted mapping for JSON/string tokens; tokens grant no authority. */
  readonly binaryResolver?: DocumentVfsCapability & { readonly capability: string };
  readonly fontResolver?: { readonly capability: string; readonly fonts: DocumentFontMetrics };
  readonly registerCleanup?: (cleanup: () => Promise<void>) => void;
}

export type AdmittedModelContext = ReturnType<typeof archiveSettings> &
  Required<Pick<DocumentModelContext, "author" | "initials">> &
  Pick<DocumentModelContext, "timestamp"> &
  Pick<
    DocumentModelContext,
    "fonts" | "metrics" | "vfs" | "template" | "binaryResolver" | "fontResolver" | "registerCleanup"
  >;

const admitted = new WeakSet<object>();
const vfsOrigins = new WeakMap<DocumentVfsCapability, DocumentVfsCapability>();
const fontMeasurements = new WeakMap<DocumentFontMetrics, DocumentFontMetrics["measure"]>();

/** Snapshot all own data without executing accessors or accepting inherited authority. */
export function contextData(value: unknown, keys?: readonly string[]): Record<string, unknown> {
  if (
    !value ||
    typeof value !== "object" ||
    ![Object.prototype, null].includes(Object.getPrototypeOf(value))
  )
    throw new InputTypeError("Expected finite context capability data.");
  const result: Record<string, unknown> = {};
  for (const key of Reflect.ownKeys(value)) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key)!;
    if (!("value" in descriptor) || (keys && (typeof key !== "string" || !keys.includes(key))))
      throw new InputTypeError("Expected finite context capability data.");
    Object.defineProperty(result, key, { value: descriptor.value, enumerable: true });
  }
  return result;
}

export function matchesModelVfs(capability: unknown, context: AdmittedModelContext): boolean {
  return (
    context.vfs !== undefined &&
    (vfsOrigins.get(capability as DocumentVfsCapability) ?? capability) ===
      (vfsOrigins.get(context.vfs) ?? context.vfs)
  );
}

function captureVfs(value: DocumentVfsCapability): DocumentVfsCapability {
  contextData(value, ["open"]);
  if (typeof value.open !== "function")
    throw new InputTypeError("Expected an explicit virtual read capability.");
  const result = Object.freeze({ open: value.open.bind(value) });
  vfsOrigins.set(result, vfsOrigins.get(value) ?? value);
  return result;
}

function captureFonts(value: DocumentFontMetrics, budget: DocumentBudget): DocumentFontMetrics {
  contextData(value, ["measure"]);
  if (typeof value.measure !== "function")
    throw new InputTypeError("Expected explicit font metrics.");
  const measure = fontMeasurements.get(value) ?? value.measure.bind(value);
  const captured = Object.freeze({
    measure(text: string, font: string, points: number) {
      budget.check("work", 0);
      if (
        typeof text !== "string" ||
        typeof font !== "string" ||
        !font ||
        typeof points !== "number" ||
        !Number.isFinite(points) ||
        points <= 0 ||
        points > Number.MAX_SAFE_INTEGER
      )
        throw new InputTypeError("Expected text, an explicit font and positive finite points.");
      budget.charge("work", text.length + font.length + 1);
      const width = measure(text, font, points);
      budget.check("work", 0);
      if (
        typeof width !== "number" ||
        !Number.isFinite(width) ||
        width < 0 ||
        width > Number.MAX_SAFE_INTEGER
      )
        throw new InvalidValueError(
          "Font metrics must return a finite nonnegative width in points."
        );
      return width;
    }
  });
  fontMeasurements.set(captured, measure);
  return captured;
}

/** Snapshots authority, deterministic metadata and ceilings before any external await. */
export function modelContext(
  context: DocumentModelContext = {},
  defaultLimits: Partial<ArchiveLimits> = {}
): AdmittedModelContext {
  if (context && admitted.has(context)) return context as AdmittedModelContext;
  contextData(context);
  if (context.signal !== undefined && !(context.signal instanceof AbortSignal))
    throw new InputTypeError("Expected a cancellation signal.");
  if (context.budget !== undefined && !(context.budget instanceof DocumentBudget))
    throw new InputTypeError("Expected an explicit document budget.");
  const signal = context.signal ?? new AbortController().signal;
  const defaults = documentLimitDefaults;
  if (context.limits !== undefined) contextData(context.limits);
  const namedLimits =
    context.limits !== undefined &&
    Object.keys(context.limits).every((key) => Object.hasOwn(defaults, key));
  const budget = namedLimits
    ? (context.budget ?? new DocumentBudget({}, signal)).lower(
        context.limits as Partial<DocumentLimits>,
        signal
      )
    : context.budget;
  const limits: Partial<ArchiveLimits> = {
    ...defaultLimits,
    ...(!namedLimits ? context.limits as Partial<ArchiveLimits> : {})
  };
  const timestamp = context.timestamp;
  if (
    timestamp !== undefined &&
    (!(timestamp instanceof Date) || !Number.isFinite(Date.prototype.getTime.call(timestamp)))
  )
    throw new InputTypeError("Expected a valid UTC Date.");
  const time =
    timestamp === undefined
      ? undefined
      : Math.floor(Date.prototype.getTime.call(timestamp) / 1000) * 1000;
  const author = context.author === undefined ? "" : context.author,
    initials = context.initials === undefined ? "" : context.initials;
  if (
    typeof author !== "string" ||
    author.length > 510 ||
    [...author].length > 255 ||
    (initials !== null &&
      (typeof initials !== "string" || initials.length > 510 || [...initials].length > 255))
  )
    throw new InputTypeError("Expected bounded model identity strings.");
  if (context.fonts !== undefined && context.metrics !== undefined)
    throw new InputTypeError("Supply fonts or the legacy metrics adapter, not both.");
  if (context.registerCleanup !== undefined && typeof context.registerCleanup !== "function")
    throw new InputTypeError("Expected a cleanup registrar.");
  const settings = archiveSettings({ ...context, limits, signal, ...(budget ? { budget } : {}) });
  settings.budget.check("work", 0);
  const selectedFonts = context.fonts !== undefined ? context.fonts : context.metrics;
  const fonts =
    selectedFonts === undefined ? undefined : captureFonts(selectedFonts, settings.budget);
  let binaryResolver: DocumentModelContext["binaryResolver"],
    fontResolver: DocumentModelContext["fontResolver"];
  if (context.binaryResolver !== undefined) {
    contextData(context.binaryResolver, ["capability", "open"]);
    if (
      typeof context.binaryResolver.capability !== "string" ||
      !context.binaryResolver.capability ||
      typeof context.binaryResolver.open !== "function"
    )
      throw new InputTypeError("Expected an explicit binary resolver capability.");
    binaryResolver = Object.freeze({
      capability: context.binaryResolver.capability,
      open: context.binaryResolver.open.bind(context.binaryResolver)
    });
  }
  if (context.fontResolver !== undefined) {
    contextData(context.fontResolver, ["capability", "fonts"]);
    if (typeof context.fontResolver.capability !== "string" || !context.fontResolver.capability)
      throw new InputTypeError("Expected an explicit font resolver token.");
    fontResolver = Object.freeze({
      capability: context.fontResolver.capability,
      fonts: captureFonts(context.fontResolver.fonts, settings.budget)
    });
  }
  let template: Uint8Array | undefined;
  if (context.template !== undefined) {
    if (!(context.template instanceof Uint8Array))
      throw new InputTypeError("Expected owned template bytes.");
    if (context.template.length > settings.limits.maxArchiveBytes)
      throw new ResourceLimitError("Template input byte limit exceeded.");
    settings.budget.charge("retainedBytes", context.template.length);
    settings.budget.charge("work", context.template.length);
    template = new Uint8Array(context.template);
  }
  const result: AdmittedModelContext = {
    ...settings,
    limits: Object.freeze(settings.limits),
    codecLimits: Object.freeze(settings.codecLimits),
    author,
    initials,
    ...(fonts ? { fonts } : {}),
    ...(context.vfs === undefined ? {} : { vfs: captureVfs(context.vfs) }),
    ...(binaryResolver ? { binaryResolver } : {}),
    ...(fontResolver ? { fontResolver } : {}),
    ...(context.registerCleanup ? { registerCleanup: context.registerCleanup } : {})
  };
  if (time !== undefined)
    Object.defineProperty(result, "timestamp", {
      enumerable: true,
      get() {
        return new Date(time);
      }
    });
  if (template !== undefined)
    Object.defineProperty(result, "template", {
      enumerable: true,
      get() {
        settings.budget.charge("retainedBytes", template.length);
        settings.budget.charge("work", template.length);
        return new Uint8Array(template);
      }
    });
  Object.freeze(result);
  admitted.add(result);
  return result;
}

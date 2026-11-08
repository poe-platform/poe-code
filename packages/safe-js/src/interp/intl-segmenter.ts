import type { Budget } from "./budget.js";
import type { SandboxObject } from "./values.js";

const NativeSegmenter = Intl.Segmenter;
const nativeSegment = NativeSegmenter.prototype.segment;
const nativeResolvedOptions = NativeSegmenter.prototype.resolvedOptions;
const emptySegments = new NativeSegmenter("en").segment("");
const nativeIterator = Object.getPrototypeOf(emptySegments)[Symbol.iterator];
const nativeNext = Object.getPrototypeOf(Reflect.apply(nativeIterator, emptySegments, [])).next;
export type SegmenterOptions = { locale: string; granularity: "grapheme" | "word" | "sentence" };
const segmenters = new WeakMap<object, { native: Intl.Segmenter; options: SegmenterOptions }>();
export type SegmentState = { segmenter: SandboxObject; input: string; index?: number };
const segments = new WeakMap<object, SegmentState & { native: Intl.Segments }>();

export function createSandboxSegmenter(locales: string | string[], options: Intl.SegmenterOptions): SandboxObject {
  const native = new NativeSegmenter(locales, options);
  const value = Object.create(null) as SandboxObject;
  segmenters.set(value, { native, options: Reflect.apply(nativeResolvedOptions, native, []) });
  return value;
}

export function isSandboxSegmenter(value: unknown): value is SandboxObject {
  return typeof value === "object" && value !== null && segmenters.has(value);
}

export function segmenterState(value: unknown) {
  if (!isSandboxSegmenter(value)) throw new TypeError("Intl.Segmenter requires a Segmenter receiver.");
  return segmenters.get(value)!;
}

export function createSandboxSegments(state: SegmentState): SandboxObject {
  const native = Reflect.apply(nativeSegment, segmenterState(state.segmenter).native, [state.input]);
  const value = Object.create(null) as SandboxObject;
  segments.set(value, { ...state, native });
  return value;
}

export function isSandboxSegments(value: unknown): value is SandboxObject {
  return typeof value === "object" && value !== null && segments.has(value);
}

export function segmentState(value: unknown, iterator?: boolean) {
  if (!isSandboxSegments(value) || iterator !== undefined && (segments.get(value)!.index !== undefined) !== iterator)
    throw new TypeError(iterator ? "Segment iterator requires a segment iterator receiver." : "Segments method requires a Segments receiver.");
  return segments.get(value)!;
}

export function containingSegment(value: unknown, index: number, iterator: boolean, budget: Budget): { segment: string; index: number; input: string; isWordLike?: boolean } | undefined {
  const state = segmentState(value, iterator);
  // Native boundary search can inspect the input on either side of the offset.
  budget.visitNode(state.input.length + 1);
  const result = findContainingSegment(state.native, state.input.length, index);
  if (iterator && result !== undefined) state.index = result.index + result.segment.length;
  return result === undefined ? undefined : { ...result };
}

export function findContainingSegment(native: Intl.Segments, length: number, index: number): Intl.SegmentData | undefined {
  if (index < 0 || index >= length) return undefined;
  // Some backends' containing() includes the previous segment at a leading
  // surrogate. Use one boundary source for lookup, iteration and snapshot
  // validation. The caller charges a full-input scan; no native cursor escapes.
  const iterator = Reflect.apply(nativeIterator, native, []);
  for (;;) {
    const next = Reflect.apply(nativeNext, iterator, []) as IteratorResult<Intl.SegmentData>;
    if (next.done) return undefined;
    if (index < next.value.index + next.value.segment.length) return next.value;
  }
}

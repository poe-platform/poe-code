import { WkhtmltopdfError } from "./errors.js";

/** Independently admitted renderer features; a declaration is not qualification evidence. */
export type RendererFeature = "html5" | "computed-css" | "selectors" | "css-units" |
  "block-inline" | "font-shaping" | "lists" | "images" | "table-spans" |
  "pagination" | "break-rules" | "widows-orphans" | "positioning" | "page-furniture" |
  "flex" | "grid";

export interface RendererProfile {
  /** Explicit first-party static profile, separate from patched-Qt compatibility. */
  readonly id: string;
  readonly features: readonly RendererFeature[];
}

const rendererFeatures: readonly RendererFeature[] = [
  "html5", "computed-css", "selectors", "css-units", "block-inline", "font-shaping",
  "lists", "images", "table-spans", "pagination", "break-rules", "widows-orphans",
  "positioning", "page-furniture", "flex", "grid",
];

/** Admission only. Never substitutes another layout mode for an absent feature. */
export function requireRendererFeatures(profile: RendererProfile, required: readonly RendererFeature[]): void {
  if (typeof profile.id !== "string" || !profile.id || profile.id.length > 128 ||
      profile.features.length > rendererFeatures.length || required.length > rendererFeatures.length) {
    throw new WkhtmltopdfError("INVALID_VALUE", "Expected a bounded renderer profile and feature requirements");
  }
  for (const feature of [...profile.features, ...required]) {
    if (!rendererFeatures.includes(feature)) {
      throw new WkhtmltopdfError("INVALID_VALUE", "Unknown renderer feature");
    }
  }
  for (const feature of required) {
    if (!profile.features.includes(feature)) {
      throw new WkhtmltopdfError("UNSUPPORTED_CAPABILITY", `Renderer profile ${profile.id} does not support ${feature}`);
    }
  }
}

export interface LaidOutObject {
  /** Actual final printer/layout pages, not an outline placeholder or DOM estimate. */
  readonly physicalPages: number;
  readonly pagesCount: boolean;
}

export interface PageSequenceOptions {
  readonly copies: number;
  readonly collate: boolean;
  readonly pageOffset: number;
  readonly limits: {
    readonly maxObjects: number;
    readonly maxPhysicalPages: number;
    /** One unit per admission object, emission object visit and retained output record. */
    readonly maxWork: number;
  };
  readonly signal?: AbortSignal;
}

export interface OutputPage {
  readonly objectIndex: number;
  readonly pageIndex: number;
  readonly copyIndex: number;
  /** One-based position in the actual output, including copies. */
  readonly outputPage: number;
  /** Counted-object numbering plus explicit offset; uncounted pages do not advance it. */
  readonly logicalPage: number;
  /** One-based actual layout-page prefix, independent of copies and pagesCount. */
  readonly outlinePage: number;
}

export interface PageSequence {
  readonly pages: readonly OutputPage[];
  /** Counted pages, excluding copies and offset; not a native header topage assertion. */
  readonly logicalTotal: number;
  /** Actual page prefix used by final outline replacement, not preprocessing placeholders. */
  readonly outlineTotal: number;
}

/**
 * Pure final-layout accounting, not HTML layout or PDF emission. Admission completes
 * before retaining output records. No resources are acquired or cleanup hooks needed.
 */
export function planPageSequence(objects: readonly LaidOutObject[], options: PageSequenceOptions): PageSequence {
  const checkCancellation = () => { if (options.signal?.aborted) throw options.signal.reason; };
  checkCancellation();
  const { maxObjects, maxPhysicalPages, maxWork } = options.limits;
  for (const value of [maxObjects, maxPhysicalPages, maxWork, options.copies]) {
    if (!Number.isSafeInteger(value) || value < 1) {
      throw new WkhtmltopdfError("INVALID_VALUE", "Page sequence limits and copies must be positive safe integers");
    }
  }
  if (typeof options.collate !== "boolean" || !Number.isInteger(options.pageOffset) ||
      options.pageOffset < -2147483648 || options.pageOffset > 2147483647) {
    throw new WkhtmltopdfError("INVALID_VALUE", "Expected boolean collate and int32 page offset");
  }
  if (objects.length > maxObjects || objects.length > maxWork) {
    throw new WkhtmltopdfError("LIMIT_EXCEEDED", "Page sequence object/work limit exceeded");
  }
  let outlineTotal = 0;
  let logicalTotal = 0;
  // Division prevents multiplication overflow during copies admission.
  const sourcePageLimit = Math.floor(Math.min(maxPhysicalPages, maxWork - objects.length) / options.copies);
  for (const object of objects) {
    checkCancellation();
    if (!Number.isSafeInteger(object.physicalPages) || object.physicalPages < 0 || typeof object.pagesCount !== "boolean") {
      throw new WkhtmltopdfError("INVALID_VALUE", "Expected a nonnegative safe page count and boolean pagesCount");
    }
    if (object.physicalPages > sourcePageLimit - outlineTotal) {
      throw new WkhtmltopdfError("LIMIT_EXCEEDED", "Page sequence physical-page/work limit exceeded");
    }
    outlineTotal += object.physicalPages;
    if (object.pagesCount) logicalTotal += object.physicalPages;
  }
  if (!Number.isSafeInteger(logicalTotal + Math.abs(options.pageOffset) + 1)) {
    throw new WkhtmltopdfError("LIMIT_EXCEEDED", "Logical page number exceeds checked precision");
  }
  const passes = options.collate ? options.copies : 1;
  if (outlineTotal > 0) {
    const remainingWork = maxWork - objects.length - outlineTotal * options.copies;
    if (objects.length > Math.floor(remainingWork / passes)) {
      throw new WkhtmltopdfError("LIMIT_EXCEEDED", "Page sequence repeated traversal work limit exceeded");
    }
  }
  const pages: OutputPage[] = [];
  const emit = (objectIndex: number, pageIndex: number, copyIndex: number, logicalPage: number, outlinePage: number) => {
    checkCancellation();
    pages.push({ objectIndex, pageIndex, copyIndex, outputPage: pages.length + 1, logicalPage, outlinePage });
  };
  // Empty documents must not loop copies times without charging output work.
  if (outlineTotal === 0) return { pages, logicalTotal, outlineTotal };
  for (let pass = 0; pass < passes; pass++) {
    let logicalPage = 1 + options.pageOffset;
    let outlinePage = 1;
    for (let objectIndex = 0; objectIndex < objects.length; objectIndex++) {
      checkCancellation();
      const object = objects[objectIndex]!;
      for (let pageIndex = 0; pageIndex < object.physicalPages; pageIndex++) {
        if (options.collate) emit(objectIndex, pageIndex, pass, logicalPage, outlinePage);
        else for (let copyIndex = 0; copyIndex < options.copies; copyIndex++) {
          emit(objectIndex, pageIndex, copyIndex, logicalPage, outlinePage);
        }
        if (object.pagesCount) logicalPage++;
        outlinePage++;
      }
    }
  }
  return { pages, logicalTotal, outlineTotal };
}

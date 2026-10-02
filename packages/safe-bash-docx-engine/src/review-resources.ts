import { InvalidValueError } from "./archive.js";
import type { Location } from "./location-token.js";
import { normalizePropertyDate, type PropertyValue } from "./property-values.js";
import { parseStoredDateTime } from "./stored-date-time.js";

export interface ReviewResourceReference { readonly owner: string; readonly id: string; readonly type: string; readonly target: string; readonly external: boolean }
export interface CommentResourceDetails {
  readonly kind: "comments";
  readonly commentId: number;
  readonly author: string;
  readonly timestamp: string | null;
  readonly initials: string | null;
  readonly modern: boolean;
  readonly anchors: readonly Location[];
}
export interface RevisionResourceDetails {
  readonly kind: "revisions";
  readonly revisionId: number;
  readonly author: string;
  readonly timestamp: string | null;
  readonly type: "insert" | "delete" | "format" | "move" | "table" | "section" | "unsupported";
}
export interface ReviewResourceRecord {
  readonly kind: "comments" | "revisions";
  readonly location: Location;
  readonly name?: string;
  readonly text?: string;
  readonly properties: readonly PropertyValue[];
  readonly references: readonly ReviewResourceReference[];
  readonly support: "read" | "preserve";
  readonly details: CommentResourceDetails | RevisionResourceDetails;
}
export interface ReviewResourceListData { readonly items: readonly ReviewResourceRecord[] }
export interface ReviewResourceData { readonly item: ReviewResourceRecord }

/** Snapshot dates use the native review datatype and the shared scalar precision. */
export function reviewResourceDate(raw: string | null): string | null {
  if (raw === null) return null;
  try { return normalizePropertyDate(parseStoredDateTime(raw, "xsd").toISOString()); }
  catch (error) { if (error instanceof InvalidValueError) return null; throw error; }
}


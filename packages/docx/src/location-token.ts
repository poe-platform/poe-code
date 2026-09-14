import { InvalidValueError } from "./archive.js";
import { normalizePartName } from "./part-uri.js";

export interface LocationPayload {
  readonly version: 1;
  readonly sourceSha256: string;
  readonly generation: number;
  readonly part: string;
  readonly story: string;
  readonly path: readonly number[];
  readonly range: Readonly<{ start: number; end: number }> | null;
}
export type LocationKind = "section" | "part" | "story" | "paragraph" | "run" | "table" | "cell" | "image" | "link" | "annotation";
export interface LocationPositions {
  readonly section?: number;
  readonly paragraph?: number;
  readonly run?: number;
  readonly table?: number;
  readonly cell?: string;
  readonly image?: number;
  readonly link?: number;
  readonly comment?: number;
  readonly note?: number;
}
export type Location<K extends LocationKind = LocationKind> = K extends LocationKind ? Readonly<{
  kind: K;
  token: string;
  value: LocationPayload;
  positions: LocationPositions;
}> : never;
export type PartLocation = Location<"part">;
export type StoryLocation = Location<"story">;
export type ParagraphLocation = Location<"paragraph">;
export type RunLocation = Location<"run">;
export type TableLocation = Location<"table">;
export type CellLocation = Location<"cell">;
export type ImageLocation = Location<"image">;
export type AnnotationLocation = Location<"annotation">;

export class SelectionError extends Error {
  readonly candidates: readonly string[];
  constructor(readonly code: "stale-selection" | "missing-selection" | "ambiguous-selection", candidates: readonly string[] = []) {
    super(code === "stale-selection" ? "The document location is stale."
      : code === "missing-selection" ? "The selection has no valid target." : "The selection has multiple possible targets.");
    this.candidates = Object.freeze([...candidates]);
  }
}

export function closedRecord(value: unknown, keys: readonly string[]): void {
  if (!value || typeof value !== "object" || Array.isArray(value) ||
    keys.some(key => key in value && !Object.hasOwn(value, key)) ||
    Reflect.ownKeys(value).some(key => typeof key !== "string" || !keys.includes(key) ||
      !Object.hasOwn(Object.getOwnPropertyDescriptor(value, key)!, "value")))
    throw new InvalidValueError("Expected a closed data object.");
}
export function safeOrdinal(value: unknown): asserts value is number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 1)
    throw new InvalidValueError("Expected a positive one-based position.");
}
function nonnegative(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function checked(value: unknown): LocationPayload {
  closedRecord(value, ["version", "sourceSha256", "generation", "part", "story", "path", "range"]);
  if (Object.keys(value as object).length !== 7) throw new InvalidValueError("Location payload fields are required.");
  const { version, sourceSha256, generation, part, story, path, range } = value as Record<string, unknown>;
  if (version !== 1 || typeof sourceSha256 !== "string" || sourceSha256.length !== 64 ||
    [...sourceSha256].some(c => !"0123456789abcdef".includes(c)) || !nonnegative(generation) ||
    typeof part !== "string" || part.length > 4096 || typeof story !== "string" || !story || story.length > 8192 ||
    !Array.isArray(path) || path.length > 256 || Reflect.ownKeys(path).length !== path.length + 1 ||
    Array.from({ length: path.length }, (_, i) => Object.getOwnPropertyDescriptor(path, String(i))).some(d => !d || !("value" in d)) ||
    Array.from(path).some(n => !nonnegative(n))) throw new InvalidValueError("Invalid document location payload.");
  try {
    if (part !== "/[Content_Types].xml" && normalizePartName(part) !== part) throw new Error();
  } catch { throw new InvalidValueError("Expected a canonical location part name."); }
  if (range !== null) {
    closedRecord(range, ["start", "end"]);
    if (Object.keys(range as object).length !== 2) throw new InvalidValueError("Range fields are required.");
    const pair = range as Record<string, unknown>;
    if (!nonnegative(pair.start) || !nonnegative(pair.end) || pair.end < pair.start)
      throw new InvalidValueError("Invalid document location range.");
  }
  return Object.freeze({ version, sourceSha256, generation, part, story, path: Object.freeze([...path] as number[]),
    range: range === null ? null : Object.freeze({ start: (range as { start: number }).start, end: (range as { end: number }).end }) });
}

export function encodeLocation(value: LocationPayload): string {
  const bytes = new TextEncoder().encode(JSON.stringify(checked(value)));
  if (bytes.length > 24576) throw new InvalidValueError("Document location token is too large.");
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return "docx-loc-v1." + btoa(binary).split("+").join("-").split("/").join("_").split("=")[0]!;
}

export function decodeLocation(token: string): LocationPayload {
  if (typeof token !== "string" || token.length > 32779 || !token.startsWith("docx-loc-v1."))
    throw new InvalidValueError("Invalid document location token.");
  const data = token.slice(12);
  if (!data || [...data].some(c => !(c >= "A" && c <= "Z") && !(c >= "a" && c <= "z") &&
    !(c >= "0" && c <= "9") && c !== "-" && c !== "_")) throw new InvalidValueError("Invalid document location encoding.");
  try {
    const binary = atob(data.split("-").join("+").split("_").join("/"));
    const bytes = Uint8Array.from(binary, c => c.charCodeAt(0));
    const value = checked(JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)));
    if (encodeLocation(value) !== token) throw new Error();
    return value;
  } catch { throw new InvalidValueError("Invalid document location token."); }
}

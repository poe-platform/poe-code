import { OfficeError } from "./errors.js";

export interface FontIdentity {
  readonly family: string;
  readonly bold: boolean;
  readonly italic: boolean;
}
export interface FontMetrics extends FontIdentity {
  readonly unitsPerEm: number;
  readonly lineHeight: number;
  readonly advances: Readonly<Record<string, number>>;
}
export interface MetricLimits {
  readonly maxGlyphs: number;
  readonly maxTextLength: number;
  readonly maxWork: number;
}
interface LayoutOptions {
  readonly wrap?: boolean;
  readonly lineSpacing?: number;
  readonly preserveBreaks?: boolean;
  readonly preserveSpaces?: boolean;
}
export interface MeasureTextOptions extends FontIdentity, LayoutOptions {
  readonly fontSize: number;
  readonly width: number;
  readonly missingGlyph?: string;
}
export interface FitTextOptions extends FontIdentity, LayoutOptions {
  readonly minSize?: number;
  readonly maxSize: number;
  readonly width: number;
  readonly height: number;
  readonly missingGlyph?: string;
}
declare const admitted: unique symbol;
export interface FontMetricsHandle extends FontIdentity {
  readonly [admitted]: true;
}
export interface TextMeasurement {
  readonly lines: readonly { readonly text: string; readonly width: number }[];
  readonly height: number;
  readonly overflow: boolean;
  readonly replacements: number;
}
interface MetricTable {
  unitsPerEm: number;
  lineHeight: number;
  advances: Map<string, number>;
}
const tables = new WeakMap<FontMetricsHandle, MetricTable>();
const ceilings: MetricLimits = { maxGlyphs: 65536, maxTextLength: 65536, maxWork: 4000000 };

function invalid(): never {
  throw new OfficeError("invalid-value", "Invalid font metric or measurement input.", "usage");
}
function limited(): never {
  throw new OfficeError("resource-limit", "Font measurement limit exceeded.", "validate-intent");
}
function unsupported(): never {
  throw new OfficeError(
    "unsupported-edit",
    "Matching font or glyph metrics are unavailable.",
    "validate-intent"
  );
}
function record(value: unknown): asserts value is Record<string, unknown> {
  if (
    !value ||
    typeof value !== "object" ||
    ![Object.prototype, null].includes(Object.getPrototypeOf(value))
  )
    invalid();
}
function fields(value: unknown, allowed: readonly string[]): void {
  record(value);
  for (const key of Reflect.ownKeys(value)) {
    if (
      typeof key !== "string" ||
      !allowed.includes(key) ||
      !Object.hasOwn(Object.getOwnPropertyDescriptor(value, key)!, "value")
    )
      invalid();
  }
}
function bounded(value: number, min: number, max: number, integer = false): void {
  if (
    typeof value !== "number" ||
    !Number.isFinite(value) ||
    value < min ||
    value > max ||
    (integer && !Number.isInteger(value))
  )
    invalid();
}
function identity(value: FontIdentity): void {
  if (
    typeof value.family !== "string" ||
    value.family.length === 0 ||
    value.family.length > 256 ||
    typeof value.bold !== "boolean" ||
    typeof value.italic !== "boolean"
  )
    invalid();
}
function limits(options: Partial<MetricLimits>): MetricLimits {
  fields(options, ["maxGlyphs", "maxTextLength", "maxWork"]);
  const resolved = { ...ceilings, ...options };
  for (const key of Object.keys(ceilings) as (keyof MetricLimits)[])
    bounded(resolved[key], 1, ceilings[key], true);
  return resolved;
}
function scalar(value: string): boolean {
  if (typeof value !== "string" || value.length === 0 || value.length > 2) return false;
  const code = value.codePointAt(0)!;
  return !(code >= 0xd800 && code <= 0xdfff) && value.length === (code > 0xffff ? 2 : 1);
}
function whitespace(glyph: string): boolean {
  const code = glyph.codePointAt(0)!;
  return (
    (code >= 9 && code <= 13) ||
    (code >= 28 && code <= 32) ||
    code === 0x85 ||
    code === 0xa0 ||
    code === 0x1680 ||
    (code >= 0x2000 && code <= 0x200a) ||
    code === 0x2028 ||
    code === 0x2029 ||
    code === 0x202f ||
    code === 0x205f ||
    code === 0x3000
  );
}

export function admitFontMetrics(
  input: FontMetrics,
  options: Partial<MetricLimits> = {}
): FontMetricsHandle {
  const budget = limits(options);
  fields(input, ["family", "bold", "italic", "unitsPerEm", "lineHeight", "advances"]);
  identity(input);
  bounded(input.unitsPerEm, 1, 1000000, true);
  bounded(input.lineHeight, 1, 1000000, true);
  record(input.advances);
  const advances = new Map<string, number>();
  for (const glyph in input.advances) {
    if (!Object.hasOwn(input.advances, glyph)) continue;
    if (advances.size >= budget.maxGlyphs) limited();
    const descriptor = Object.getOwnPropertyDescriptor(input.advances, glyph)!;
    if (!Object.hasOwn(descriptor, "value") || !scalar(glyph)) invalid();
    const advance = descriptor.value as number;
    bounded(advance, 0, 1000000, true);
    advances.set(glyph, advance);
  }
  if (!advances.size) invalid();
  const handle = Object.freeze({
    family: input.family,
    bold: input.bold,
    italic: input.italic
  }) as FontMetricsHandle;
  tables.set(handle, { unitsPerEm: input.unitsPerEm, lineHeight: input.lineHeight, advances });
  return handle;
}

interface PreparedText {
  table: MetricTable;
  words: {
    text: string;
    advance: number;
    hardBreak?: boolean;
    separator?: string;
    separatorAdvance?: number;
  }[];
  space: number;
  replacements: number;
  spend(): void;
}
function prepare(
  handle: FontMetricsHandle,
  text: string,
  options: FontIdentity & LayoutOptions & { missingGlyph?: string },
  budget: MetricLimits
): PreparedText {
  const table = tables.get(handle);
  if (!table) invalid();
  identity(options);
  if (
    handle.family !== options.family ||
    handle.bold !== options.bold ||
    handle.italic !== options.italic
  )
    unsupported();
  if (typeof text !== "string") invalid();
  if (text.length > budget.maxTextLength) limited();
  let work = 0;
  const spend = () => {
    if (++work > budget.maxWork) limited();
  };
  let replacement: number | undefined;
  if (options.missingGlyph !== undefined) {
    if (!scalar(options.missingGlyph)) invalid();
    replacement = table.advances.get(options.missingGlyph);
    if (replacement === undefined) unsupported();
  }
  let replacements = 0;
  const advance = (glyph: string) => {
    const value = table.advances.get(glyph);
    if (value !== undefined) return value;
    if (replacement === undefined) unsupported();
    replacements++;
    return replacement;
  };
  const words: PreparedText["words"] = [];
  let chars: string[] = [];
  let width = 0;
  let separators: string[] = [];
  let separatorAdvance = 0;
  const flush = () => {
    if (chars.length)
      words.push({
        text: chars.join(""),
        advance: width,
        ...(options.preserveSpaces ? { separator: separators.join(""), separatorAdvance } : {})
      });
    chars = [];
    width = 0;
    separators = [];
    separatorAdvance = 0;
  };
  for (const glyph of text) {
    spend();
    if (!scalar(glyph)) invalid();
    if (options.preserveBreaks && ["\n", "\v"].includes(glyph)) {
      if (!chars.length && separators.length) chars = separators.splice(0);
      flush();
      words.push({ text: "", advance: 0, hardBreak: true });
    } else if (options.preserveSpaces ? glyph === " " : whitespace(glyph)) {
      if (chars.length) flush();
      if (options.preserveSpaces) {
        separators.push(glyph);
        separatorAdvance += advance(glyph);
      }
    } else {
      width += advance(glyph);
      chars.push(glyph);
    }
  }
  if (chars.length) flush();
  else if (separators.length) {
    words.push({ text: "", advance: 0, separator: separators.join(""), separatorAdvance });
  }
  let space = 0;
  const separatorCount = words.filter(
    (w, i) => i > 0 && !w.hardBreak && !words[i - 1]!.hardBreak
  ).length;
  if (!options.preserveSpaces && separatorCount > 0) {
    const before = replacements;
    space = advance(" ");
    if (replacements !== before) replacements = before + separatorCount;
  }
  return { table, words, space, replacements, spend };
}
function layout(
  prepared: PreparedText,
  fontSize: number,
  width: number,
  options: LayoutOptions
): TextMeasurement {
  const { table, words, space, spend } = prepared;
  const lines: { text: string; width: number }[] = [];
  let current: string[] = [];
  let units = 0;
  let overflow = false;
  const points = (value: number) => (value * fontSize) / table.unitsPerEm;
  for (const word of words) {
    spend();
    if (word.hardBreak) {
      lines.push({ text: current.join(""), width: points(units) });
      current = [];
      units = 0;
      continue;
    }
    let separator = word.separator ?? (current.length ? " " : "");
    let separatorWidth = word.separatorAdvance ?? (current.length ? space : 0);
    if (
      word.text.length > 0 &&
      options.wrap !== false &&
      current.length &&
      points(units + separatorWidth + word.advance) > width
    ) {
      lines.push({ text: current.join(""), width: points(units) });
      current = [];
      units = 0;
      separator = "";
      separatorWidth = 0;
    }
    units += separatorWidth;
    units += word.advance;
    current.push(separator + word.text);
    if (points(units) > width) overflow = true;
  }
  if (current.length || words.at(-1)?.hardBreak)
    lines.push({ text: current.join(""), width: points(units) });
  return {
    lines,
    height: points(table.lineHeight) * lines.length * (options.lineSpacing ?? 1),
    overflow,
    replacements: prepared.replacements
  };
}

export function measureText(
  handle: FontMetricsHandle,
  text: string,
  options: MeasureTextOptions,
  budget: Partial<MetricLimits> = {}
): TextMeasurement {
  fields(options, [
    "family",
    "bold",
    "italic",
    "fontSize",
    "width",
    "missingGlyph",
    "wrap",
    "lineSpacing",
    "preserveBreaks",
    "preserveSpaces"
  ]);
  validateLayout(options);
  bounded(options.fontSize, 1, 4096, true);
  bounded(options.width, 0, 1000000000);
  return layout(
    prepare(handle, text, options, limits(budget)),
    options.fontSize,
    options.width,
    options
  );
}

export function bestFitText(
  handle: FontMetricsHandle,
  text: string,
  options: FitTextOptions,
  budget: Partial<MetricLimits> = {}
): number | null {
  fields(options, [
    "family",
    "bold",
    "italic",
    "maxSize",
    "width",
    "height",
    "missingGlyph",
    "minSize",
    "wrap",
    "lineSpacing",
    "preserveBreaks",
    "preserveSpaces"
  ]);
  validateLayout(options);
  bounded(options.maxSize, 1, 4096, true);
  bounded(options.width, 0, 1000000000);
  bounded(options.height, 0, 1000000000);
  const prepared = prepare(handle, text, options, limits(budget));
  bounded(options.minSize ?? 1, 1, options.maxSize, true);
  let lower = options.minSize ?? 1;
  let upper = options.maxSize;
  let best: number | null = null;
  while (lower <= upper) {
    prepared.spend();
    const size = Math.floor((lower + upper) / 2);
    const result = layout(prepared, size, options.width, options);
    if (!result.overflow && result.height <= options.height) {
      best = size;
      lower = size + 1;
    } else upper = size - 1;
  }
  return best;
}

function validateLayout(options: LayoutOptions): void {
  for (const key of ["wrap", "preserveBreaks", "preserveSpaces"] as const)
    if (options[key] !== undefined && typeof options[key] !== "boolean") invalid();
  bounded(options.lineSpacing ?? 1, 0.01, 100);
}

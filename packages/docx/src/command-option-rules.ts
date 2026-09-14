import { DocxUsageError } from "./argument-json.js";

const lengthUnits: Readonly<Record<string, number>> = { emu: 1, in: 914400, cm: 360000, mm: 36000, pt: 12700, twip: 635 };
const formattingFields: Readonly<Record<string, readonly string[]>> = {
  "paragraphs.format.set": ["borders", "shading"],
  "runs.fonts.set": ["ascii", "eastAsia", "complexScript", "highAnsi", "theme", "language"],
  "lists.levels.set": ["levels", "numberingStyle"],
  "sections.columns.set": ["equalWidth", "gap", "columns", "separator"],
  "styles.links.set": ["linkedStyle", "defaultForType"]
};

function magnitude(value: unknown): number | undefined {
  if (!value || typeof value !== "object" || !("value" in value) || !("unit" in value)) return undefined;
  if (typeof value.value !== "number" || !Number.isFinite(value.value) || Math.abs(value.value) > Number.MAX_SAFE_INTEGER)
    throw new DocxUsageError("Length values must be finite and safely bounded.");
  const emus = value.value * (lengthUnits[String(value.unit)] ?? NaN);
  const rounded = Math.sign(emus) * Math.round(Math.abs(emus));
  if (!Number.isFinite(emus) || Math.abs(emus) > Number.MAX_SAFE_INTEGER || !Number.isSafeInteger(rounded))
    throw new DocxUsageError("Converted lengths must fit safe integer EMUs.");
  return rounded;
}

function checkLengths(value: unknown): void {
  if (!value || typeof value !== "object") return;
  if (magnitude(value) !== undefined) return;
  for (const item of Object.values(value)) checkLengths(item);
}

const grandfatheredLanguages = new Set("en-gb-oed i-ami i-bnn i-default i-enochian i-hak i-klingon i-lux i-mingo i-navajo i-pwn i-tao i-tay i-tsu sgn-be-fr sgn-be-nl sgn-ch-de art-lojban cel-gaulish no-bok no-nyn zh-guoyu zh-hakka zh-min zh-min-nan zh-xiang".split(" "));
function languageTag(value: unknown): boolean {
  if (typeof value !== "string" || !value) return false;
  if ([...value].some(c => c.charCodeAt(0) > 127)) return false;
  const lower = value.toLowerCase();
  if (grandfatheredLanguages.has(lower)) return true;
  const parts = lower.split("-");
  const letters = (part: string) => [...part].every(c => c >= "a" && c <= "z");
  const digits = (part: string) => [...part].every(c => c >= "0" && c <= "9");
  if (parts.some(part => !part || part.length > 8 || [...part].some(c => !(c >= "a" && c <= "z") && !(c >= "0" && c <= "9")))) return false;
  if (parts[0] === "x") return parts.length > 1;
  const language = parts[0]!;
  if (language.length < 2 || !letters(language)) return false;
  let index = 1;
  if (language.length <= 3) {
    let extended = 0;
    while (parts[index]?.length === 3 && letters(parts[index]!) && extended < 3) { index++; extended++; }
  }
  if (parts[index]?.length === 4 && letters(parts[index]!)) index++;
  if (parts[index]?.length === 2 && letters(parts[index]!) || parts[index]?.length === 3 && digits(parts[index]!)) index++;
  const variants = new Set<string>();
  while (parts[index] && (parts[index]!.length >= 5 || parts[index]!.length === 4 && digits(parts[index]![0]!))) {
    if (variants.has(parts[index]!)) return false;
    variants.add(parts[index++]!);
  }
  const extensions = new Set<string>();
  while (parts[index]?.length === 1 && parts[index] !== "x") {
    if (extensions.has(parts[index]!)) return false;
    extensions.add(parts[index++]!);
    const start = index;
    while (parts[index] && parts[index]!.length >= 2) index++;
    if (index === start) return false;
  }
  if (parts[index] === "x") return index + 1 < parts.length;
  return index === parts.length;
}

export function validateDocxOptionRules(operation: string, options: Readonly<Record<string, unknown>>): void {
  if (operation.startsWith("model.")) return;
  checkLengths(options);
  const has = (name: string) => options[name] !== undefined;
  const reject = (message: string): never => { throw new DocxUsageError(message); };
  if (operation === "sanitize") {
    const revisions = Array.isArray(options.remove) && options.remove.includes("revisions");
    if (revisions !== has("revisionPolicy")) reject("Revision policy is required only when removing revisions.");
  }
  if (operation === "comments.add" || operation === "revisions.add") {
    if (!has("author") || !has("timestamp")) reject("Review insertion requires explicit author and timestamp.");
  }
  if (operation === "revisions.add") {
    if (options.kind === "insert" && (!has("text") || options.text === "" && options.allowEmpty !== true))
      reject("Inserted revision text is required; empty text requires allow-empty.");
    if (options.kind === "delete" && has("text")) reject("Delete revisions do not accept text.");
  }
  if (operation === "fields.add") {
    const requiresTarget = ["REF", "PAGEREF", "SEQ"].includes(String(options.kind));
    if (requiresTarget !== has("target")) reject("Field target does not match its kind.");
    if (requiresTarget && options.target === "") reject("Field target must not be empty.");
  }
  if (["bookmarks.add", "bookmarks.set"].includes(operation) && has("name")) {
    const name = options.name;
    const letters = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";
    if (typeof name !== "string" || !name || [...name].length > 40 || !letters.includes(name[0]!) ||
      [...name].some(character => !(letters + "0123456789_").includes(character))) reject("Invalid bookmark name.");
  }
  if (["links.add", "links.set"].includes(operation) && has("target")) {
    let url: URL;
    try { url = new URL(String(options.target)); } catch { return reject("Link targets require absolute HTTP, HTTPS or mailto URLs."); }
    if (!["http:", "https:", "mailto:"].includes(url.protocol)) reject("Unsupported link scheme.");
  }
  if (["lists.add", "lists.set"].includes(operation) && has("start") && Number(options.start) < 0)
    reject("List starts must be nonnegative.");
  for (const name of ["width", "height", "pageWidth", "pageHeight", "size"]) {
    const value = magnitude(options[name]);
    if (value !== undefined && !(value > 0)) reject("Dimensions and font sizes must be positive.");
  }
  for (const name of ["spaceBefore", "spaceAfter", "topMargin", "bottomMargin", "leftMargin", "rightMargin", "gap", "cellMargin"]) {
    const value = magnitude(options[name]);
    if (value !== undefined && (!(value >= 0) || Number((options[name] as { value: number }).value) < 0)) reject("Spacing and margins must be nonnegative.");
  }
  if (["runs.set", "runs.fonts.set"].includes(operation) && has("language") && !languageTag(options.language)) reject("Font language must be a nonempty BCP-47 tag.");
  if (has("lineSpacing") && options.lineSpacing !== null) {
    const value = options.lineSpacing;
    if (typeof value === "number" ? !(value > 0) : !(Number(magnitude(value)) >= 0)) reject("Invalid line spacing.");
  }
  if (operation === "sections.set") {
    for (const [dimension, before, after] of [["pageWidth", "leftMargin", "rightMargin"], ["pageHeight", "topMargin", "bottomMargin"]] as const) {
      const extent = magnitude(options[dimension]);
      const leading = magnitude(options[before]);
      const trailing = magnitude(options[after]);
      if (extent !== undefined && leading !== undefined && trailing !== undefined && leading + trailing >= extent)
        reject("Margins must leave positive content extent.");
    }
  }
  const effects = formattingFields[operation];
  if (effects && !effects.some(has)) reject("Formatting set requires an effect field.");
  if (operation === "sections.columns.set" && Array.isArray(options.columns)) {
    if (options.columns.length === 0) reject("Columns must not be empty.");
    for (const column of options.columns as Record<string, unknown>[]) {
      if (!(Number(magnitude(column.width)) > 0) || column.gapAfter !== undefined && (!(Number(magnitude(column.gapAfter)) >= 0) || Number((column.gapAfter as { value: number }).value) < 0))
        reject("Column widths must be positive and gaps nonnegative.");
    }
    const columns = options.columns as Record<string, unknown>[];
    const finalGap = columns.at(-1)!.gapAfter ?? options.gap;
    if (finalGap !== undefined && magnitude(finalGap) !== 0) reject("The final column gap must be zero.");
    if (options.equalWidth === true && columns.some(column => magnitude(column.width) !== magnitude(columns[0]!.width))) reject("Equal-width columns cannot declare unequal widths.");
  }
  if (operation === "lists.levels.set" && Array.isArray(options.levels)) {
    const seen = new Set<unknown>();
    if (options.levels.length === 0) reject("List levels must not be empty.");
    for (const level of options.levels as Record<string, unknown>[]) {
      if (seen.has(level.level) || Number(level.start) < 0) reject("List levels must be distinct and starts nonnegative.");
      seen.add(level.level);
    }
    const links = new Map((options.levels as Record<string, unknown>[]).map(level => [level.level, level.restartAfter]));
    for (const start of links.keys()) {
      const visited = new Set<unknown>();
      let current = start;
      while (current !== undefined && current !== null && links.has(current)) {
        if (visited.has(current)) reject("List restart dependencies cannot contain cycles.");
        visited.add(current);
        current = links.get(current);
      }
    }
  }
}

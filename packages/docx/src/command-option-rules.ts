import { DocxUsageError } from "./argument-json.js";
import { paragraphLineMultiples, paragraphUnits } from "./paragraph-properties.js";
import type { DocxOperationArguments } from "./operation-types.js";

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
  if (["headers.set", "footers.set"].includes(operation)) {
    if (!has("text") && !has("linkToPrevious")) reject("Story set requires text or link-to-previous intent.");
    if (options.shared === true && has("linkToPrevious")) reject("Shared editing and binding changes conflict.");
  }
  if (operation.startsWith("styles.")) {
    for (const key of ["name", "base", "next", "linkedStyle"]) {
      const value = options[key];
      if (value !== undefined && value !== null && (typeof value !== "string" || !value || [...value].some(c => c.charCodeAt(0) < 32))) reject("Style references require nonempty names without control characters.");
    }
    if (has("priority") && Number(options.priority) < 0) reject("Style priority must be nonnegative.");
    if (has("color") && options.color !== null && (typeof options.color !== "string" || options.color.length !== 6 || [...options.color].some(c => !"0123456789abcdefABCDEF".includes(c)))) reject("Style color requires six hexadecimal digits.");
  }
  if (operation === "paragraphs.set" || ["styles.add", "styles.set", "styles.defaults.set"].includes(operation)) {
    if (["tabStops", "tabStopAdd", "tabStopDelete", "tabStopsClear"].filter(has).length > 1) reject("Tab replacement, insertion, deletion and clear are mutually exclusive.");
    if (options.tabStopsClear === false) reject("Tab clear requires true.");
    const paragraph = options as DocxOperationArguments<"paragraphs.set">;
    if (paragraph.lineSpacing !== undefined && paragraph.lineSpacingRule !== undefined && !(paragraph.lineSpacing === null && paragraph.lineSpacingRule === null)) {
      const rule = paragraph.lineSpacingRule?.name;
      if (paragraph.lineSpacing === null || rule === undefined || (typeof paragraph.lineSpacing === "number" ? !["SINGLE", "ONE_POINT_FIVE", "DOUBLE", "MULTIPLE"].includes(rule) : !["EXACTLY", "AT_LEAST"].includes(rule)))
        reject("Line spacing and its rule require compatible units and reset intent.");
      const fixed = rule === undefined ? undefined : paragraphLineMultiples[rule];
      if (fixed !== undefined && paragraph.lineSpacing !== fixed) reject("Fixed line spacing rules conflict with the supplied multiple.");
    }
    for (const key of ["leftIndent", "rightIndent", "firstLineIndent", "spaceBefore", "spaceAfter"] as const) {
      const value = paragraph[key]; if (value) paragraphUnits(value);
    }
    if (paragraph.lineSpacing != null) {
      const value = paragraph.lineSpacing;
      if (typeof value === "number" ? Math.round(value * 240) < 1 || !Number.isSafeInteger(Math.round(value * 240)) : value.value < 0)
        reject("Line spacing must fit the nonnegative schema range; multiples must round positive.");
      if (typeof value !== "number") paragraphUnits(value);
    }
    const positions = new Set<number>();
    for (const tab of [...paragraph.tabStops ?? [], ...paragraph.tabStopAdd ? [paragraph.tabStopAdd] : []]) {
      const position = paragraphUnits(tab.position);
      if (positions.has(position)) reject("Tab stops require unique rounded positions.");
      positions.add(position);
    }
    for (const border of Object.values(paragraph.borders ?? {})) {
      const size = paragraphUnits(border.width, 12700 / 8);
      if (size < (border.style === "none" ? 0 : 2) || size > 96) reject("Border width must round to 2 through 96 eighth-points, or zero for none.");
      if (border.space && paragraphUnits(border.space, 12700) > 31) reject("Border spacing must round to 0 through 31 points.");
    }
  }
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
    if (typeof name !== "string" || !name || [...name].length > 40 || !(letters + "_").includes(name[0]!) ||
      [...name].some(character => !(letters + "0123456789_").includes(character))) reject("Invalid bookmark name.");
  }
  if (["links.add", "links.set"].includes(operation) && has("target")) {
    const target = options.target as string;
    if (!target || [...target].some(c => c.charCodeAt(0) <= 32 || c.charCodeAt(0) >= 127 && c.charCodeAt(0) <= 159 || c.trim() === "" || c === "\\")) reject("Link targets cannot contain whitespace, controls or backslashes.");
    for (let i = 0; i < target.length; i++) if (target[i] === "%") {
      if (target.slice(i + 1, i + 3).length !== 2 || [...target.slice(i + 1, i + 3)].some(c => !"0123456789abcdefABCDEF".includes(c))) reject("Malformed link percent escape.");
      i += 2;
    }
    let url: URL;
    try { url = new URL(target); } catch { return reject("Link targets require absolute HTTP, HTTPS or mailto URLs."); }
    if (!["http:", "https:", "mailto:"].includes(url.protocol)) reject("Unsupported link scheme.");
    if (url.protocol === "mailto:" ? !url.pathname || target.slice(7).startsWith("//") : !target.toLowerCase().startsWith(url.protocol + "//") || !target.slice(url.protocol.length + 2).split("/")[0] || !url.hostname || !!url.username || !!url.password)
      reject("Malformed absolute link target.");
  }
  if (["links.add", "links.set"].includes(operation) && has("bookmark")) {
    const name = options.bookmark as string;
    const letters = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz_";
    if (!name || name.length > 40 || !letters.includes(name[0]!) || [...name].some(c => !(letters + "0123456789").includes(c))) reject("Invalid internal link anchor.");
  }
  if (operation.startsWith("links.")) {
    if (["run", "image", "control", "revision", "shape", "field", "shared"].some(has) || operation === "links.add" && (has("link") || has("all"))) reject("Unsupported link selection.");
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
  if (["runs.set", "runs.fonts.set"].includes(operation) && has("language") && options.language !== null && !languageTag(options.language)) reject("Font language must be a nonempty BCP-47 tag.");
  if (operation === "runs.set" || ["styles.add", "styles.set", "styles.defaults.set"].includes(operation)) {
    for (const key of ["underline", "highlight"]) if ((options[key] as { name?: string } | null)?.name === "INHERITED") reject("Use null for inherited formatting.");
    const size = magnitude(options.size);
    if (size !== undefined && (Math.round(size / 6350) < 1 || Math.round(size / 6350) > 3276)) reject("Font size must round to 1 through 3276 half-points.");
    for (const key of ["font", "ascii", "highAnsi", "eastAsia", "complexScript"]) {
      if (options[key] !== undefined && options[key] !== null && (typeof options[key] !== "string" || !options[key] || [...options[key] as string].some(c => c.charCodeAt(0) < 32))) reject("Font references must be nonempty names without control characters.");
    }
    if (has("font") && (has("ascii") || has("highAnsi"))) reject("Font shorthand conflicts with explicit Latin font slots.");
    if (has("baseline") && (has("superscript") || has("subscript"))) reject("Choose one baseline spelling.");
    if (has("superscript") && has("subscript") && options.superscript !== options.subscript && options.superscript !== true && options.subscript !== true) reject("Conflicting baseline resets.");
    if (has("themeColor") && has("color")) reject("Choose RGB or theme color.");
    if ((options.themeColor as { name?: string } | null)?.name === "NOT_THEME_COLOR") reject("Use null to remove a theme reference.");
  }
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

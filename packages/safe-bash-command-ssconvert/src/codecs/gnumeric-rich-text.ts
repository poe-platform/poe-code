import { SsconvertError } from "../contracts.js";
import type { RichTextRun } from "../workbook.js";

const richAttributes = new Set(["family", "size", "rise", "scale", "italic", "bold", "strikethrough", "underline", "color", "subscript", "superscript"]);
export function readGnumericRichText(format: string | undefined, charge?: (amount?: number) => void): RichTextRun[] | undefined {
  if (!format?.startsWith("@[")) return undefined;
  charge?.(format.length);
  const runs: RichTextRun[] = []; let offset = 1;
  while (offset < format.length) {
    charge?.();
    if (format[offset] !== "[") return undefined;
    const equal = format.indexOf("=", offset), range = format.indexOf(":", equal + 1);
    if (equal < offset || range < equal) return undefined;
    // Native markup permits ] in the value; only the bracket after its
    // range delimiter closes the attribute (go_format_parse_markup).
    const close = format.indexOf("]", range);
    if (close < 0) return undefined;
    const key = format.slice(offset + 1, equal), parts = format.slice(equal + 1, close).split(":");
    if (parts.length !== 3) return undefined;
    const start = Number(parts[1]), end = Number(parts[2]);
    if (richAttributes.has(key) && Number.isSafeInteger(start) && Number.isSafeInteger(end) && start >= 0 && start < end && end <= 4294967295) {
      const raw = parts[0]!; const numeric = Number(raw);
      runs.push({ start, end, attributes: { [key]: ["family", "underline", "color"].includes(key) ? raw : Number.isFinite(numeric) ? numeric : 0 } });
    }
    offset = close + 1;
  }
  return runs;
}
export function writeGnumericRichText(runs: readonly RichTextRun[]): string {
  let result = "@";
  for (const run of runs) for (const [key, val] of Object.entries(run.attributes)) {
    if (!richAttributes.has(key) || typeof val !== "string" && typeof val !== "number")
      throw new SsconvertError("io", "E Invalid Gnumeric XML: unsupported rich text attribute");
    if (String(val).includes(":"))
      throw new SsconvertError("io", "E Invalid Gnumeric XML: invalid rich text attribute value");
    result += `[${key}=${val}:${run.start}:${run.end}]`;
  }
  return result;
}

import { formatText, type FormatHost } from "@poe-code/spreadsheet-engine/formatting/number-format";
import { parseFormatSections, selectFormatSection } from "@poe-code/spreadsheet-engine/formatting/sections";
import { scanFormat } from "@poe-code/spreadsheet-engine/formatting/numeric";

const dateFormats: Readonly<Record<number, string>> = {
  14: "m/d/yy", 15: "d-mmm-yy", 16: "d-mmm", 17: "mmm-yy", 18: "h:mm AM/PM",
  19: "h:mm:ss AM/PM", 20: "h:mm", 21: "h:mm:ss", 22: "m/d/yy h:mm",
  45: "mm:ss", 46: "[h]:mm:ss", 47: "mmss.0"
};

/** Only date/time formats change exported text; other numeric cells stay raw. */
export function xlsxDateText(raw: string, format: string | number | undefined, date1904: boolean): string {
  const pattern = typeof format === "number" ? dateFormats[format] : format;
  if (!pattern || !raw.trim() || !Number.isFinite(Number(raw))) return raw;
  const host: FormatHost = {
    book: { dateSystem: date1904 ? "1904" : "1900" },
    context: {
      signal: new AbortController().signal, environment: { env: {}, locale: "C", timezone: "UTC" },
      limits: { inputBytes: Infinity, outputBytes: Infinity, cells: Infinity, sheets: Infinity, operations: Infinity }, own() {}
    }, tick() {}
  };
  const value = Number(raw);
  const section = selectFormatSection(parseFormatSections(pattern, host), value).section;
  const tokens = scanFormat(section.pattern, host).filter(token => !token.literal).map(token => token.text.toLowerCase());
  if (!tokens.some(token => "ymdhs".includes(token))) return raw;
  const result = formatText({ kind: "number", value }, pattern, host);
  return result.kind === "string" ? result.value : raw;
}

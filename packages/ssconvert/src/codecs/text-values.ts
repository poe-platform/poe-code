import type { Cell, CellValue, Workbook } from "../workbook.js";
import { SsconvertError, type CapabilityContext } from "../contracts.js";
import { formattingLocale } from "../formatting/locale.js";
import { inferText } from "../workbook/updates/inference.js";

type DateOrder = "dmy" | "mdy" | "ymd";
type ColumnFormat = { decimal?: string; format?: string; date?: DateOrder };

function decimalNumber(text: string, decimal: string): number | undefined {
  const thousand = decimal === "." ? "," : ".";
  let source = text.trim(), negative = false, percent = false;
  if (source.startsWith("(") && source.endsWith(")")) { negative = true; source = source.slice(1, -1).trim(); }
  if (source.startsWith("$")) source = source.slice(1).trim();
  if (source.endsWith("$")) source = source.slice(0, -1).trim();
  if (source.endsWith("%")) { percent = true; source = source.slice(0, -1).trim(); }
  // Accounting parentheses already establish a sign. Native's decimal matcher
  // refuses a second leading/trailing sign and percent accounting combinations.
  if (negative && (percent || source.startsWith("+") || source.startsWith("-") ||
    source.endsWith("+") || source.endsWith("-"))) return undefined;
  if ((source.endsWith("+") || source.endsWith("-")) && !source.includes("e") && !source.includes("E"))
    source = source.slice(-1) + source.slice(0, -1).trim();
  let normalized = "", seenDecimal = false, exponent = false, previousDigit = false;
  for (let index = 0; index < source.length; index++) {
    const c = source[index]!;
    if (c === thousand && previousDigit && !seenDecimal && !exponent &&
      source.slice(index + 1, index + 4).length === 3 && [...source.slice(index + 1, index + 4)].every(d => d >= "0" && d <= "9")) continue;
    if (c === decimal && !seenDecimal && !exponent) { seenDecimal = true; normalized += "."; previousDigit = false; continue; }
    if (c === "e" || c === "E") { if (exponent) return undefined; exponent = true; }
    else if (!(c >= "0" && c <= "9") && c !== "+" && c !== "-") return undefined;
    normalized += c; previousDigit = c >= "0" && c <= "9";
  }
  // Number accepts empty, hex and incomplete exponent forms that iconv's numeric matcher rejects.
  if (!normalized || ![...normalized].some(c => c >= "0" && c <= "9")) return undefined;
  const value = Number(normalized);
  return Number.isFinite(value) ? value * (negative ? -1 : 1) / (percent ? 100 : 1) : undefined;
}

function dateValue(text: string, order: DateOrder, book: Workbook): number | undefined {
  const source = text.trim();
  const separator = source.includes("/") ? "/" : source.includes("-") ? "-" : ".";
  let parts = source.split(separator);
  const months = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];
  const words = source.split(",").join("").split(" ").filter(Boolean);
  if (words.length === 3 && months.some(m => m === words[0]!.toLowerCase() || m.slice(0, 3) === words[0]!.toLowerCase())) parts = words;
  if (parts.length !== 3) return undefined;
  const monthIndex = order === "mdy" ? 0 : 1;
  const namedMonth = months.findIndex(m => m === parts[monthIndex]!.toLowerCase() || m.slice(0, 3) === parts[monthIndex]!.toLowerCase());
  if (namedMonth >= 0) parts = parts.map((part, index) => index === monthIndex ? String(namedMonth + 1) : part);
  if (parts.some(p => !p || ![...p].every(c => c >= "0" && c <= "9"))) return undefined;
  const numbers = parts.map(Number);
  const yearIndex = order === "ymd" ? 0 : 2;
  if (parts[yearIndex]!.length > 4 || order === "ymd" && parts[0]!.length !== 4) return undefined;
  let year = numbers[yearIndex]!;
  if (year < 100) year += year < 30 ? 2000 : 1900;
  const month = numbers[monthIndex]!, day = numbers[order === "dmy" ? 0 : order === "mdy" ? 1 : 2]!;
  const date = new Date(0); date.setUTCFullYear(year, month - 1, day); date.setUTCHours(0, 0, 0, 0);
  if (year < 1900 || date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return undefined;
  const value = (date.getTime() - Date.UTC(book.dateSystem === "1904" ? 1904 : 1899, book.dateSystem === "1904" ? 0 : 11, book.dateSystem === "1904" ? 1 : 31)) / 86400000;
  return value + (book.dateSystem !== "1904" && (year > 1900 || month > 2) ? 1 : 0);
}

function generalValue(text: string, book: Workbook, decimal: string, context: CapabilityContext): { value: CellValue; format?: string } {
  const original = inferText(text, book);
  if (text.startsWith("'") || text.startsWith("=")) return original;
  if (["#NULL!", "#DIV/0!", "#VALUE!", "#REF!", "#NAME?", "#NUM!", "#N/A"].includes(text))
    return { value: { kind: "error", value: text } };
  let normalized = "";
  for (const c of text) {
    if (c === "−") normalized += "-";
    else if (/\p{Nd}/u.test(c)) {
      const code = c.codePointAt(0)!;
      let start = code;
      while (/\p{Nd}/u.test(String.fromCodePoint(start - 1))) start--;
      normalized += String((code - start) % 10);
    } else normalized += c;
  }
  const number = decimalNumber(normalized, decimal);
  if (number !== undefined) return { ...original, value: { kind: "number", value: number } };
  for (const order of ["ymd", "mdy", "dmy"] as const) {
    const value = dateValue(text, order, book);
    if (value !== undefined) return { value: { kind: "number", value }, format: order === "ymd" ? "yyyy-mm-dd" : order === "mdy" ? "m/d/yyyy" : "d-mmm-yyyy" };
  }
  const partialDate = text.trim().split("/");
  if (partialDate.length === 2 && partialDate.every(p => p.length > 0 && p.length <= 2 && [...p].every(c => c >= "0" && c <= "9"))) {
    if (!context.clock) throw new SsconvertError("capability-denied", "ssconvert text dates require an explicit clock");
    const now = context.clock.now();
    if (!Number.isFinite(now)) throw new SsconvertError("invalid-request", "Invalid ssconvert clock result");
    const year = context.environment.timezone === "UTC" ? new Date(now).getUTCFullYear() :
      Number(new Intl.DateTimeFormat("en-US", { timeZone: context.environment.timezone, year: "numeric" }).format(new Date(now)));
    const order = decimal === "." ? "mdy" : "dmy";
    const value = dateValue(text.trim() + "/" + year, order, book);
    if (value !== undefined) return { value: { kind: "number", value }, format: order === "mdy" ? "m/d/yyyy" : "d-mmm-yyyy" };
  }
  const time = text.trim().split(":");
  if (time.length === 2 || time.length === 3) {
    const valid = time.every(p => p && [...p].every(c => c >= "0" && c <= "9" || c === "."));
    const [hour, minute, second = 0] = time.map(Number);
    if (valid && hour! >= 0 && minute! >= 0 && minute! < 60 && second >= 0 && second < 60)
      return { value: { kind: "number", value: (hour! * 3600 + minute! * 60 + second) / 86400 },
        format: (hour! >= 24 ? "[h]" : "h") + (time.length === 3 ? ":mm:ss" : ":mm") };
  }
  const mixed = text.trim().split(" ").filter(Boolean);
  if (mixed.length === 2) {
    const fraction = mixed[1]!.split("/"), whole = Number(mixed[0]);
    if (fraction.length === 2 && [...mixed[0]!.split("-").join("") + fraction.join("")].every(c => c >= "0" && c <= "9") && Number(fraction[1]) > 0) {
      const value = Math.abs(whole) + Number(fraction[0]) / Number(fraction[1]);
      const places = "?".repeat(Math.min(5, fraction[1]!.length));
      return { value: { kind: "number", value: whole < 0 ? -value : value }, format: "# " + places + "/" + places };
    }
  }
  return original;
}

function guess(values: readonly string[], book: Workbook): ColumnFormat {
  const dates = new Set<DateOrder>(["dmy", "mdy", "ymd"]);
  const decimals = new Set([".", ","]);
  const precision = new Map<string, number>();
  let seenDot = false, seenComma = false;
  for (const value of values) {
    if (!value || value.startsWith("'") || value.startsWith("=")) continue;
    for (const order of dates) if (dateValue(value, order, book) === undefined) dates.delete(order);
    const dot = value.indexOf("."), comma = value.indexOf(",");
    if (decimals.size === 2) {
      if (dot >= 0 && comma >= 0) decimals.delete(dot > comma ? "," : ".");
      else if (dot >= 0 && value.indexOf(".", dot + 1) >= 0) decimals.delete(".");
      else if (comma >= 0 && value.indexOf(",", comma + 1) >= 0) decimals.delete(",");
      seenDot ||= dot >= 0; seenComma ||= comma >= 0;
    }
    for (const decimal of decimals) {
      const thousand = decimal === "." ? "," : ".", index = value.indexOf(thousand);
      const prefixDigits = index >= 0 ? [...value.slice(0, index)].filter(c => c >= "0" && c <= "9") : [];
      if (decimalNumber(value, decimal) === undefined || index >= 0 && (!prefixDigits.some(c => c !== "0") || prefixDigits.length > 3)) { decimals.delete(decimal); continue; }
      let count = 0, offset = value.indexOf(decimal);
      if (offset >= 0) { offset++; while (value[offset]! >= "0" && value[offset]! <= "9") { offset++; count++; } }
      const previous = precision.get(decimal);
      precision.set(decimal, previous === undefined ? count : previous === count ? count : -2);
    }
  }
  if (decimals.size === 2) {
    if (!seenComma) decimals.delete(",");
    else if (seenComma && !seenDot) decimals.clear();
  }
  if (dates.size === 1 && !decimals.size) {
    const date = [...dates][0]!;
    return { date, format: date === "dmy" ? "d-mmm-yyyy" : date === "mdy" ? "m/d/yyyy" : "yyyy-mm-dd" };
  }
  if (!dates.size && decimals.size === 1) {
    const decimal = [...decimals][0]!, count = precision.get(decimal) ?? 0;
    return { decimal, ...(count > 0 ? { format: (decimal === "." ? seenComma : seenDot) ? "#,##0." + "0".repeat(count) : "0." + "0".repeat(count) } : {}) };
  }
  return {};
}

/** Guess once per column, ignoring the first physical row when others exist. */
export function inferTextColumns(cells: readonly Cell[], book: Workbook, context: CapabilityContext, rowCount: number): Cell[] {
  const locale = formattingLocale(context.environment.locale);
  const columns = new Map<number, string[]>();
  for (const cell of cells) {
    if (cell.value.kind !== "string") continue;
    let values = columns.get(cell.column);
    if (!values) { values = []; columns.set(cell.column, values); }
    if (rowCount <= 1 || cell.row > 0) values.push(cell.value.value);
  }
  const formats = new Map([...columns].map(([column, values]) => [column, guess(values, book)]));
  return cells.map(cell => {
    context.signal.throwIfAborted();
    if (cell.formula || cell.value.kind !== "string") return cell;
    const text = cell.value.value, format = formats.get(cell.column)!;
    let inferred: { value: CellValue; format?: string };
    if (format.decimal && !text.startsWith("'") && !text.startsWith("=")) {
      const number = decimalNumber(text, format.decimal);
      inferred = { value: number === undefined ? cell.value : { kind: "number", value: number } };
    } else if (format.date && !text.startsWith("'")) {
      const number = dateValue(text, format.date, book);
      inferred = number === undefined ? generalValue(text, book, locale.decimal, context) : { value: { kind: "number", value: number } };
    } else {
      inferred = generalValue(text, book, locale.decimal, context);
      if (text.toUpperCase() === locale.trueText || text.toUpperCase() === locale.falseText)
        inferred = { value: { kind: "boolean", value: text.toUpperCase() === locale.trueText } };
    }
    return { ...cell, ...inferred,
      ...(format.format === undefined && inferred.format !== undefined ? { inferredValueFormat: inferred.format } : {}),
      ...(format.format === undefined ? {} : { format: format.format }) };
  });
}

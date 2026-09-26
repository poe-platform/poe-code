import type { CellValue, Workbook } from "../../workbook.js";

/** C-locale text entry, independent of JavaScript's permissive Date.parse. */
export function inferText(text: string, book: Workbook, format?: string): { value: CellValue; format?: string } {
  if (!text) return { value: { kind: "blank" } };
  if (text.startsWith("'")) return { value: { kind: "string", value: text.slice(1) } };
  if (format === "@") return { value: { kind: "string", value: text } };
  const trimmed = text.trim();
  if (text.toUpperCase() === "TRUE" || text.toUpperCase() === "FALSE")
    return { value: { kind: "boolean", value: text.toUpperCase() === "TRUE" } };
  const slashDate = trimmed.includes("/");
  const dateParts = trimmed.split(slashDate ? "/" : "-");
  if (slashDate && dateParts.length === 3) dateParts.unshift(dateParts.pop()!);
  if (dateParts.length === 3 && dateParts[0]!.length === 4 &&
    dateParts.every(part => part.length > 0 && [...part].every(c => c >= "0" && c <= "9"))) {
    const [year, month, day] = dateParts.map(Number) as [number, number, number];
    const date = new Date(0); date.setUTCFullYear(year, month - 1, day); date.setUTCHours(0, 0, 0, 0);
    if (year >= 1900 && date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day) {
      let value = (date.getTime() - Date.UTC(book.dateSystem === "1904" ? 1904 : 1899, book.dateSystem === "1904" ? 0 : 11, book.dateSystem === "1904" ? 1 : 31)) / 86400000;
      if (book.dateSystem !== "1904" && month > 2 || book.dateSystem !== "1904" && year > 1900) value++;
      return { value: { kind: "number", value }, format: slashDate ? "m/d/yyyy" : "yyyy-mm-dd" };
    }
  }
  let numeric = trimmed, percent = false;
  const currency = numeric.startsWith("$");
  if (currency) numeric = numeric.slice(1);
  if (numeric.endsWith("%")) { percent = true; numeric = numeric.slice(0, -1).trim(); }
  if (numeric.includes(",")) {
    const sign = numeric.startsWith("+") || numeric.startsWith("-") ? numeric[0]! : "";
    const unsigned = numeric.slice(sign.length);
    let end = 0;
    while (end < unsigned.length && (unsigned[end]! >= "0" && unsigned[end]! <= "9" || unsigned[end] === ",")) end++;
    const groups = unsigned.slice(0, end).split(",");
    if (groups[0]!.length > 0 && groups[0]!.length <= 3 && groups.slice(1).every(group => group.length === 3))
      numeric = sign + groups.join("") + unsigned.slice(end);
  }
  let offset = numeric[0] === "+" || numeric[0] === "-" ? 1 : 0, digits = 0;
  while (numeric[offset]! >= "0" && numeric[offset]! <= "9") { offset++; digits++; }
  if (numeric[offset] === ".") {
    offset++; while (numeric[offset]! >= "0" && numeric[offset]! <= "9") { offset++; digits++; }
  }
  if (digits && numeric[offset]?.toLowerCase() === "e") {
    offset++; if (numeric[offset] === "+" || numeric[offset] === "-") offset++;
    const start = offset; while (numeric[offset]! >= "0" && numeric[offset]! <= "9") offset++;
    if (start === offset) digits = 0;
  }
  if (digits && offset === numeric.length && Number.isFinite(Number(numeric)))
    return { value: { kind: "number", value: Number(numeric) / (percent ? 100 : 1) },
      ...(currency ? { format: "$#,##0_);[Red]($#,##0)" } : percent ? { format: "0%" } : {}) };
  return { value: { kind: "string", value: text } };
}

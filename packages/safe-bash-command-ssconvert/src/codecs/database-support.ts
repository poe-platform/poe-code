import { SsconvertError, type CapabilityContext } from "../contracts.js";
import { singleByteTables } from "../encoding/tables.js";
import { encodingName } from "../encoding/names.js";
import { biffDbcsTables } from "../encoding/biff-dbcs-tables.js";
import { databaseCodepages } from "./database-encoding-tables.js";
import type { Cell, CellValue } from "../workbook.js";

export function databaseInput(bytes: Uint8Array, context: CapabilityContext) {
  context.signal.throwIfAborted();
  if (bytes.length > context.limits.inputBytes) throw new SsconvertError("resource-limit", "ssconvert input bytes limit exceeded");
  let work = 0;
  return {
    view: new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength),
    async tick() {
      context.signal.throwIfAborted();
      if (++work % 128 === 0) { await new Promise<void>(resolve => setTimeout(resolve, 0)); context.signal.throwIfAborted(); }
    },
    add(cells: Cell[], row: number, column: number, value: CellValue | undefined, extra: Partial<Cell> = {}) {
      if (!value) return;
      if (cells.length >= context.limits.cells) throw new SsconvertError("resource-limit", "ssconvert database cells limit exceeded");
      cells.push({ row, column, value, ...extra });
    }
  };
}

/** Database converters are forced encodings: text importer guessing is inappropriate. */
export function databaseText(bytes: Uint8Array, codepage: number): string {
  const nul = bytes.indexOf(0); if (nul >= 0) bytes = bytes.subarray(0, nul);
  if (codepage === 28591) return Array.from(bytes, b => String.fromCharCode(b)).join("");
  if (codepage === 0) codepage = 1252;
  const dbcs = biffDbcsTables[codepage];
  if (dbcs) {
    let text = "";
    for (let i = 0; i < bytes.length; i++) {
      const lead = bytes[i]!, single = dbcs.single[lead]!;
      if (single !== "\uffff") { text += single; continue; }
      const trail = bytes[++i], character = trail === undefined ? undefined : dbcs.double[lead]?.[trail];
      if (character === undefined || character === "\uffff") throw new RangeError("Invalid encoded byte");
      text += character;
    }
    return text;
  }
  const mac: Readonly<Record<number, string>> = { 10000: "macintosh", 10007: "mac-cyrillic", 10029: "mac-centraleurope", 10006: "mac-greek" };
  const name = mac[codepage] ?? encodingName(`CP${codepage}`), table = databaseCodepages[codepage] ?? singleByteTables[name];
  if (!table) {
    if (bytes.every(b => b < 128)) return String.fromCharCode(...bytes);
    throw new SsconvertError("unsupported-feature", `Unsupported ssconvert feature: uncaptured database codepage ${codepage}`);
  }
  let text = "";
  for (const byte of bytes) {
    const character = table[byte]!;
    if (character === "\uffff") throw new RangeError("Invalid encoded byte");
    text += character;
  }
  return text;
}

export function databaseNumber(value: number): CellValue {
  return Number.isFinite(value) ? { kind: "number", value } : { kind: "error", value: "#NUM!" };
}

/** GOffice go_strtod: C-locale prefixes, with C99 hexadecimal notation disabled. */
export function databaseNumeric(text: string): number {
  let at = 0;
  while (at < text.length && " \t\r\n\v\f".includes(text[at]!)) at++;
  const start = at;
  let sign = 1;
  if (text[at] === "+" || text[at] === "-") { if (text[at] === "-") sign = -1; at++; }
  if (text[at] === "0" && text[at + 1]?.toLowerCase() === "x") return 0;
  const special = text.slice(at, at + 3).toLowerCase();
  if (special === "inf") return sign * Infinity;
  if (special === "nan") return NaN;
  if (text[at] !== "." && !(text[at] !== undefined && text[at]! >= "0" && text[at]! <= "9")) return 0;
  const number = Number.parseFloat(text.slice(start));
  return Number.isNaN(number) ? 0 : number;
}

export function databaseDate(year: number, month: number, day: number): number | undefined {
  const date = new Date(0); date.setUTCFullYear(year, month - 1, day); date.setUTCHours(0, 0, 0, 0);
  if (year < 1 || year > 65535 || date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return undefined;
  const serial = (date.getTime() - Date.UTC(1899, 11, 31)) / 86400000;
  return serial >= 60 ? serial + 1 : serial;
}

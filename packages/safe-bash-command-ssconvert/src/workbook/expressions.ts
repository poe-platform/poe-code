import { SsconvertError } from "../contracts.js";
import { DEFAULT_SHEET_SIZE, type CellRange, type Sheet, type Workbook } from "../workbook.js";
import { foldSheetName } from "./case-fold.js";
import { isUnicodeAlphanumeric } from "../cli/unicode-alphanumeric.js";
import { isUnicodeAlpha, isUnicodeDigit } from "./unicode-sheet-name.js";
import { resourceUri } from "../resource-uri.js";

function invalid(): never {
  throw new SsconvertError("invalid-request", "Invalid range specified.");
}

/** rangeref_parse's A1 dialect, with an end pointer for --set. */
export function parseRangePrefix(text: string, book: Workbook, sourceUri?: string, normalizeRelativeToActive = false): {
  range: CellRange; end: number; qualified: boolean;
  relative: { startRow: boolean; endRow: boolean; startColumn: boolean; endColumn: boolean };
} {
  const terminator = text.indexOf("\0");
  if (terminator >= 0) text = text.slice(0, terminator);
  let offset = 0;
  let workbookQualified = false;
  if (text[offset] === "[") {
    workbookQualified = true;
    offset++;
    let name = "";
    if (text[offset] === "'" || text[offset] === '"') {
      const quote = text[offset++]!;
      while (offset < text.length && text[offset] !== quote) {
        if (text[offset] === "\\") offset++;
        if (offset === text.length) invalid();
        name += text[offset++]!;
      }
      if (text[offset++] !== quote) invalid();
    } else {
      while (offset < text.length && text[offset] !== "]") name += text[offset++]!;
    }
    if (text[offset++] !== "]" || !name || !sourceUri) invalid();
    if (name !== sourceUri) {
      let resolved: string;
      try {
        resolved = name.startsWith("/") ? resourceUri(name, "/") :
          new URL(name.split("/").map(part => encodeURIComponent(part)).join("/"), sourceUri).href;
      } catch { invalid(); }
      if (resolved !== sourceUri) invalid();
    }
  }
  const active = book.sheets.find(sheet => sheet.id === book.activeSheet) ?? book.sheets[0];
  let first = book.sheets[0], last: Sheet | undefined;
  let qualified = false;
  const sheetReference = (allowSpan: boolean): Sheet | undefined => {
    const start = offset;
    let name = "";
    if (text[offset] === "'" || text[offset] === '"') {
      const quote = text[offset++]!;
      let closed = false;
      while (offset < text.length) {
        const character = text[offset++]!;
        if (character === quote) { closed = true; break; }
        if (character === "\\") {
          if (offset === text.length) invalid();
          name += text[offset++]!;
        } else name += character;
      }
      if (!closed) invalid();
    } else {
      let onlyDigits = true;
      while (offset < text.length) {
        const code = text.codePointAt(offset)!;
        const character = String.fromCodePoint(code);
        if (isUnicodeAlpha(code) || character === "_") {
          if (onlyDigits && offset !== start && (character === "e" || character === "E")) {
            offset = start; return undefined;
          }
          onlyDigits = false;
        } else if (isUnicodeDigit(code)) { /* Decimal digits only. */ }
        else if (character === "." && !onlyDigits) { /* Not after only digits. */ }
        else break;
        name += character;
        offset += character.length;
      }
      if (text[offset] !== "!" && (!allowSpan || text[offset] !== ":")) {
        offset = start; return undefined;
      }
    }
    const sheet = book.sheets.find(candidate => foldSheetName(candidate.name) === foldSheetName(name));
    if (!sheet) { offset = start; return undefined; }
    return sheet;
  };
  const reference = sheetReference(true);
  if (workbookQualified && !reference) invalid();
  if (reference) {
    qualified = true;
    first = reference;
    if (text[offset] === ":") { offset++; last = sheetReference(false); if (!last) invalid(); }
    if (text[offset++] !== "!") invalid();
  }
  if (!first || !active) invalid();
  last ??= first;
  const firstSize = first.size ?? DEFAULT_SHEET_SIZE, lastSize = last.size ?? DEFAULT_SHEET_SIZE;
  const normalizationSize = normalizeRelativeToActive && !qualified ? active.size ?? DEFAULT_SHEET_SIZE : undefined;
  let columnRelative = true, rowRelative = true;
  const column = (maximum: number): number | undefined => {
    const start = offset;
    const relative = text[offset] !== "$";
    columnRelative = relative;
    if (text[offset] === "$") offset++;
    let value = 0, letters = 0;
    while (offset < text.length) {
      const code = text.charCodeAt(offset);
      const digit = code >= 65 && code <= 90 ? code - 64 : code >= 97 && code <= 122 ? code - 96 : 0;
      if (!digit) break;
      value = value * 26 + digit;
      if (value > maximum) { offset = start; return undefined; }
      offset++; letters++;
    }
    if (!letters) { offset = start; return undefined; }
    return relative && normalizationSize ? (value - 1) % normalizationSize.columns : value - 1;
  };
  const row = (maximum: number): number | undefined => {
    const start = offset;
    const relative = text[offset] !== "$";
    rowRelative = relative;
    if (text[offset] === "$") offset++;
    if (!(text[offset]! >= "1" && text[offset]! <= "9")) { offset = start; return undefined; }
    let value = 0;
    while (text[offset]! >= "0" && text[offset]! <= "9") {
      value = value * 10 + Number(text[offset++]);
      if (value > maximum) { offset = start; return undefined; }
    }
    if (text[offset] === "_" || (offset < text.length && isUnicodeAlphanumeric(text.codePointAt(offset)!))) {
      offset = start; return undefined;
    }
    return relative && normalizationSize ? (value - 1) % normalizationSize.rows : value - 1;
  };
  let startColumn = column(firstSize.columns), endColumn: number;
  let startColumnRelative = columnRelative, endColumnRelative = columnRelative;
  let startRowRelative = true, endRowRelative = true;
  let startRow: number | undefined, endRow: number;
  if (startColumn === undefined) {
    startRow = row(firstSize.rows);
    startRowRelative = rowRelative;
    if (startRow === undefined || text[offset++] !== ":") invalid();
    const second = row(lastSize.rows);
    endRowRelative = rowRelative;
    if (second === undefined) invalid();
    endRow = second; startColumn = 0; endColumn = lastSize.columns - 1;
    startColumnRelative = endColumnRelative = false;
  } else {
    startRow = row(firstSize.rows);
    startRowRelative = endRowRelative = rowRelative;
    if (startRow === undefined) {
      if (text[offset++] !== ":") invalid();
      // Released Gnumeric uses the first sheet's column limit here.
      const second = column(firstSize.columns);
      endColumnRelative = columnRelative;
      if (second === undefined) invalid();
      endColumn = second; startRow = 0; endRow = lastSize.rows - 1;
      startRowRelative = endRowRelative = false;
    } else {
      endColumn = startColumn; endRow = startRow;
      if (text[offset] === ":") {
        const singletonEnd = offset;
        offset++;
        const secondColumn = column(lastSize.columns);
        const secondRow = secondColumn === undefined ? undefined : row(lastSize.rows);
        if (secondColumn === undefined || secondRow === undefined) offset = singletonEnd;
        else { endColumn = secondColumn; endRow = secondRow;
          endColumnRelative = columnRelative; endRowRelative = rowRelative; }
      }
    }
  }
  if (qualified) {
    // gnm_rangeref_normalize_pp evaluates each endpoint on its own sheet.
    // Singleton and whole-column parsing may copy coordinates beyond b's size.
    if (startRowRelative) startRow %= firstSize.rows;
    if (endRowRelative) endRow %= lastSize.rows;
    if (startColumnRelative) startColumn %= firstSize.columns;
    if (endColumnRelative) endColumn %= lastSize.columns;
  }
  return { end: offset, qualified, relative: {
    startRow: startRow <= endRow ? startRowRelative : endRowRelative,
    endRow: startRow <= endRow ? endRowRelative : startRowRelative,
    startColumn: startColumn <= endColumn ? startColumnRelative : endColumnRelative,
    endColumn: startColumn <= endColumn ? endColumnRelative : startColumnRelative
  }, range: {
    sheet: qualified ? first.id : active.id,
    ...(qualified && last.id !== first.id ? { endSheet: last.id } : {}),
    startRow: Math.min(startRow, endRow), endRow: Math.max(startRow, endRow),
    startColumn: Math.min(startColumn, endColumn), endColumn: Math.max(startColumn, endColumn)
  } };
}

export function parseRangeExpression(text: string, book: Workbook, relativeSheets = false, sourceUri?: string): CellRange {
  const parsed = parseRangePrefix(text, book, sourceUri);
  const terminator = text.indexOf("\0");
  if (parsed.end !== (terminator < 0 ? text.length : terminator)) invalid();
  return relativeSheets && !parsed.qualified ? { ...parsed.range, sheetRelative: true,
    ...(parsed.relative.startRow ? {} : { startRowRelative: false }),
    ...(parsed.relative.endRow ? {} : { endRowRelative: false }),
    ...(parsed.relative.startColumn ? {} : { startColumnRelative: false }),
    ...(parsed.relative.endColumn ? {} : { endColumnRelative: false })
  } : parsed.range;
}

/** gnm_export_range_for_sheet: unqualified references cover every split sheet. */
export function exportRangeForSheet(range: CellRange, book: Workbook, sheet: string): CellRange | undefined {
  if (range.sheetRelative) {
    const target = book.sheets.find(candidate => candidate.id === sheet);
    if (!target) return undefined;
    const size = target.size ?? DEFAULT_SHEET_SIZE;
    const startRow = range.startRowRelative === false ? range.startRow : range.startRow % size.rows;
    const endRow = range.endRowRelative === false ? range.endRow : range.endRow % size.rows;
    const startColumn = range.startColumnRelative === false ? range.startColumn : range.startColumn % size.columns;
    const endColumn = range.endColumnRelative === false ? range.endColumn : range.endColumn % size.columns;
    const { startRowRelative, endRowRelative, startColumnRelative, endColumnRelative, ...coordinates } = range;
    return { ...coordinates, sheet,
      startRow: Math.min(startRow, endRow), endRow: Math.max(startRow, endRow),
      startColumn: Math.min(startColumn, endColumn), endColumn: Math.max(startColumn, endColumn),
      ...((startRow <= endRow ? startRowRelative : endRowRelative) === false ? { startRowRelative: false } : {}),
      ...((startRow <= endRow ? endRowRelative : startRowRelative) === false ? { endRowRelative: false } : {}),
      ...((startColumn <= endColumn ? startColumnRelative : endColumnRelative) === false ? { startColumnRelative: false } : {}),
      ...((startColumn <= endColumn ? endColumnRelative : startColumnRelative) === false ? { endColumnRelative: false } : {}) };
  }
  const start = book.sheets.findIndex(candidate => candidate.id === range.sheet);
  const end = book.sheets.findIndex(candidate => candidate.id === (range.endSheet ?? range.sheet));
  const index = book.sheets.findIndex(candidate => candidate.id === sheet);
  return start >= 0 && end >= 0 && index >= start && index <= end ? { ...range, sheet } : undefined;
}

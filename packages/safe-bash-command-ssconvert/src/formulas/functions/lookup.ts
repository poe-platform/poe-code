import { SsconvertError } from "../../contracts.js";
import { DEFAULT_SHEET_SIZE, MAX_SHEET_SIZE, formatA1, type CellValue } from "../../workbook.js";
import { foldSheetName } from "../../workbook/case-fold.js";
import { isUnicodeAlpha } from "../../workbook/unicode-sheet-name.js";
import { comparison, error, numeric, numericResult } from "../values.js";
import { admitMatrix, asBoolean, collect, numberArg, scalarArg, str, textArg, wildcard } from "./common.js";
import type { FunctionHost, FunctionImplementation, SpecialForm, Value } from "./types.js";

function dimensions(value: Value): { height: number; width: number } {
  return value.kind === "range" ? { height: value.lastRow - value.firstRow + 1, width: value.lastColumn - value.firstColumn + 1 }
    : value.kind === "matrix" ? { height: value.rows.length, width: value.rows[0]?.length ?? 0 } : { height: 1, width: 1 };
}
function entry(value: Value, row: number, column: number, host: FunctionHost): CellValue {
  host.tick();
  return value.kind === "range" ? host.read(value.sheets[0]!, value.firstRow + row, value.firstColumn + column)
    : value.kind === "matrix" ? value.rows[row]?.[column] ?? error("#N/A") : host.scalar(value);
}
function lookupData(value: Value, vertical: boolean, seek: CellValue, host: FunctionHost) {
  if (value.kind === "range" && value.sheets.length !== 1) return undefined;
  const { height, width } = dimensions(value), length = vertical ? height : width;
  if (length > host.context.limits.cells) throw new SsconvertError("resource-limit", "ssconvert lookup limit exceeded");
  const values: { value: CellValue; index: number }[] = [];
  for (let index = 0; index < length; index++) {
    const item = entry(value, vertical ? index : 0, vertical ? 0 : index, host);
    if (item.kind === seek.kind) values.push({ value: item, index });
  }
  return values;
}
function find(value: Value, seek: CellValue, vertical: boolean, mode: number, searchMode: number, host: FunctionHost, legacy = false): number {
  const data = lookupData(value, vertical, seek, host);
  if (!data) return -2;
  if (seek.kind !== "number" && seek.kind !== "string" && seek.kind !== "boolean") return -1;
  if (searchMode === 2 || searchMode === -2 || legacy && mode !== 0) {
    let low = 0, high = data.length - 1, last = -1;
    const direction = legacy ? mode < 0 ? -1 : 1 : searchMode === -2 ? -1 : 1;
    while (low <= high) {
      host.tick(); let mid = Math.floor((low + high) / 2), order = comparison(seek, data[mid]!.value);
      if (!order) {
        if (legacy) {
          const step = mode > 0 ? 1 : -1;
          while (mid + step > 0 && mid + step < data.length && comparison(seek, data[mid + step]!.value) === 0) { host.tick(); mid += step; }
        }
        return data[mid]!.index;
      }
      order *= direction;
      if (order > 0) { last = mid; low = mid + 1; } else high = mid - 1;
    }
    if (legacy) return last < 0 ? -1 : data[last]!.index;
    const selected = mode === -1 ? last : mode === 1 && last + 1 < data.length ? last + 1 : -1;
    return selected < 0 ? -1 : data[selected]!.index;
  }
  const ordered = searchMode === -1 ? [...data].reverse() : data;
  for (const item of ordered) {
    host.tick();
    if (mode === 2 && seek.kind === "string" ? item.value.kind === "string" && wildcard(seek.value, item.value.value, host) : comparison(seek, item.value) === 0) return item.index;
  }
  if (mode !== -1 && mode !== 1) return -1;
  let best: typeof data[number] | undefined;
  for (const item of ordered) {
    host.tick(); const order = comparison(seek, item.value);
    if ((mode === -1 ? order > 0 : order < 0) && (!best || (mode === -1 ? comparison(item.value, best.value) > 0 : comparison(item.value, best.value) < 0))) best = item;
  }
  return best?.index ?? -1;
}
function validSeek(value: CellValue) { return value.kind === "number" || value.kind === "string" || value.kind === "boolean"; }
function quoteSheet(name: string): string {
  if (!name) return "";
  const chars = Array.from(name);
  const asciiLetter = (c: string) => c >= "A" && c <= "Z" || c >= "a" && c <= "z";
  const asciiDigit = (c: string) => c >= "0" && c <= "9";
  const simple = chars.every((c, index) => isUnicodeAlpha(c.codePointAt(0)!) || c === "_" || index > 0 && (asciiDigit(c) || c === "."));
  let offset = 0, column = 0;
  while (offset < chars.length && asciiLetter(chars[offset]!)) {
    column = column * 26 + chars[offset]!.toUpperCase().charCodeAt(0) - 64; offset++;
  }
  const digits = chars.slice(offset);
  const row = Number(digits.join(""));
  // std_sheet_name_quote uses maximum supported dimensions, not current sheet size.
  const cellName = offset > 0 && digits.length > 0 && digits.every(asciiDigit) && column <= MAX_SHEET_SIZE.columns && row > 0 && row <= MAX_SHEET_SIZE.rows;
  return simple && !cellName ? name : "'" + name.split("\\").join("\\\\").split("'").join("\\'") + "'";
}
export const lookupFunctions: Readonly<Record<string, FunctionImplementation>> = {
  ADDRESS: (args, host) => {
    const row = Math.trunc(numberArg(args, 0, host)), column = Math.trunc(numberArg(args, 1, host)), mode = Math.trunc(numberArg(args, 2, host, 1));
    if (mode < 1 || mode > 8) return error("#VALUE!");
    const relativeRow = [3, 4, 7, 8].includes(mode), relativeColumn = [2, 4, 6, 8].includes(mode), a1 = args[3] === undefined || asBoolean(scalarArg(args, 3, host));
    const name = args[4] === undefined ? undefined : textArg(args, 4, host), current = host.book.sheets.find(sheet => sheet.id === host.position.sheet)!;
    const target = name === undefined ? current : host.book.sheets.find(sheet => foldSheetName(sheet.name) === foldSheetName(name)) ?? current;
    const size = target.size ?? DEFAULT_SHEET_SIZE;
    const absoluteRow = !a1 && relativeRow ? host.position.row + row : row - 1, absoluteColumn = !a1 && relativeColumn ? host.position.column + column : column - 1;
    if (absoluteRow < 0 || absoluteColumn < 0 || absoluteRow >= size.rows || absoluteColumn >= size.columns) return error("#VALUE!");
    const address = a1 ? formatA1(row - 1, column - 1) : "", split = address.split("").findIndex(c => c >= "0" && c <= "9");
    const ref = a1 ? (relativeColumn ? "" : "$") + address.slice(0, split) + (relativeRow ? "" : "$") + address.slice(split)
      : "R" + (relativeRow ? row === 0 ? "" : `[${row}]` : row) + "C" + (relativeColumn ? column === 0 ? "" : `[${column}]` : column);
    return str((name === undefined ? "" : quoteSheet(name) + "!") + ref);
  },
  ...Object.fromEntries(["ROW", "COLUMN"].map(name => [name, ((args, host) => {
    const value = args[0], vertical = name === "ROW";
    let first = (vertical ? host.position.row : host.position.column) + 1, count = 1;
    if (value !== undefined) {
      if (value.kind !== "range") return error("#VALUE!");
      first = (vertical ? value.firstRow : value.firstColumn) + 1;
      count = vertical ? value.lastRow - value.firstRow + 1 : value.lastColumn - value.firstColumn + 1;
    } else if (host.array) {
      const group = host.book.sheets.find(sheet => sheet.id === host.position.sheet)?.formulaGroups?.find(group => group.kind === "array" && group.range.startRow === host.position.row && group.range.startColumn === host.position.column);
      if (group) count = vertical ? group.range.endRow - group.range.startRow + 1 : group.range.endColumn - group.range.startColumn + 1;
    }
    if (count === 1) return numericResult(first);
    if (count > host.context.limits.cells) throw new SsconvertError("resource-limit", "ssconvert calculation array limit exceeded");
    return admitMatrix(vertical ? Array.from({ length: count }, (_, index) => { host.tick(); return [numericResult(first + index)]; }) : [Array.from({ length: count }, (_, index) => { host.tick(); return numericResult(first + index); })], host);
  }) satisfies FunctionImplementation])),
  COLUMNS: args => numericResult(dimensions(args[0]!).width),
  ROWS: args => numericResult(dimensions(args[0]!).height),
  COLUMNNUMBER: (args, host) => {
    const name = textArg(args, 0, host).toUpperCase(); let n = 0;
    for (const c of name.startsWith("$") ? name.slice(1) : name) { host.tick(); if (c < "A" || c > "Z") return error("#VALUE!"); n = n * 26 + c.charCodeAt(0) - 64; }
    const size = host.book.sheets.find(sheet => sheet.id === host.position.sheet)?.size ?? DEFAULT_SHEET_SIZE;
    return n > 0 && n <= size.columns ? numericResult(n) : error("#VALUE!");
  },
  HYPERLINK: args => args[1] ?? args[0]!,
  INDIRECT: (args, host) => host.indirect(textArg(args, 0, host), args[1] === undefined || asBoolean(scalarArg(args, 1, host)) === true),
  OFFSET: (args, host) => {
    const range = args[0]; if (range?.kind !== "range") return error("#VALUE!");
    const row = Math.trunc(numberArg(args, 1, host)), column = Math.trunc(numberArg(args, 2, host));
    const height = Math.trunc(numberArg(args, 3, host, range.lastRow - range.firstRow + 1)), width = Math.trunc(numberArg(args, 4, host, range.lastColumn - range.firstColumn + 1));
    const firstRow = range.firstRow + row, firstColumn = range.firstColumn + column;
    const size = host.book.sheets.find(sheet => sheet.id === host.position.sheet)?.size ?? DEFAULT_SHEET_SIZE;
    if (firstRow < 0 || firstColumn < 0 || firstRow >= size.rows || firstColumn >= size.columns) return error("#REF!");
    if (height < 1 || width < 1) return error("#VALUE!");
    const lastRow = firstRow + height - 1, lastColumn = firstColumn + width - 1;
    if (lastRow >= size.rows || lastColumn >= size.columns) return error("#REF!");
    return { ...range, firstRow, lastRow, firstColumn, lastColumn };
  },
  SHEETS: (args, host) => numericResult(args[0] === undefined ? host.book.sheets.length : args[0].kind === "range" ? args[0].sheets.length : 1),
  SHEET: (args, host) => {
    const value = args[0];
    if (value?.kind === "range" && value.sheets.length !== 1) return error("#NUM!");
    const sheet = value === undefined ? host.book.sheets.find(sheet => sheet.id === host.position.sheet) : value.kind === "range" ? value.sheets[0] : value.kind === "string" ? host.book.sheets.find(sheet => foldSheetName(sheet.name) === foldSheetName(value.value)) : undefined;
    return sheet ? numericResult(host.book.sheets.indexOf(sheet) + 1) : error(value?.kind === "string" || value?.kind === "range" ? "#NUM!" : "#VALUE!");
  },
  ...Object.fromEntries(["HLOOKUP", "VLOOKUP"].map(name => [name, ((args, host) => {
    const seek = scalarArg(args, 0, host), table = args[1]!, offset = Math.trunc(numberArg(args, 2, host)), vertical = name === "VLOOKUP", dims = dimensions(table);
    if (!validSeek(seek)) return error("#N/A");
    if (offset <= 0) return error("#VALUE!");
    if (offset > (vertical ? dims.width : dims.height)) return error("#REF!");
    const approx = args[3] === undefined || asBoolean(scalarArg(args, 3, host)), mode = approx ? 1 : seek.kind === "string" && [...seek.value].some(c => "*?~".includes(c)) ? 2 : 0;
    const index = find(table, seek, vertical, mode, 1, host, !!approx);
    if (index === -2) return error("#VALUE!");
    if (asBoolean(scalarArg(args, 4, host))) return numericResult(index);
    return index < 0 ? error("#N/A") : entry(table, vertical ? index : offset - 1, vertical ? offset - 1 : index, host);
  }) satisfies FunctionImplementation])),
  MATCH: (args, host) => {
    const seek = scalarArg(args, 0, host), area = args[1]!, dims = dimensions(area), mode = Math.trunc(numberArg(args, 2, host, 1));
    if (!validSeek(seek) || dims.width > 1 && dims.height > 1) return error("#N/A");
    const wildcardMode = mode === 0 && seek.kind === "string" && [...seek.value].some(c => "*?~".includes(c));
    const index = find(area, seek, dims.width <= 1, wildcardMode ? 2 : mode, 1, host, mode !== 0);
    return index === -2 ? error("#VALUE!") : index < 0 ? error("#N/A") : numericResult(index + 1);
  },
  LOOKUP: (args, host) => {
    const seek = scalarArg(args, 0, host), area = args[1]!, dims = dimensions(area), vertical = dims.width < dims.height;
    if (!validSeek(seek)) return error("#N/A");
    const result = args[2] ?? area, resultDims = dimensions(result), resultVertical = args[2] ? resultDims.width < resultDims.height : vertical;
    if (args[2] && resultDims.width > 1 && resultDims.height > 1) return error("#N/A");
    const index = find(area, seek, vertical, 1, 1, host, true);
    if (index < 0) return error("#N/A");
    const row = resultVertical ? index : resultDims.height - 1, column = resultVertical ? resultDims.width - 1 : index;
    if (row >= resultDims.height || column >= resultDims.width) return result.kind === "range" ? numericResult(0) : error("#N/A");
    return entry(result, row, column, host);
  },
  ...Object.fromEntries(["XMATCH", "XLOOKUP"].map(name => [name, ((args, host) => {
    const seek = scalarArg(args, 0, host), area = args[1]!, dims = dimensions(area), vertical = dims.width <= dims.height, lookup = name === "XLOOKUP";
    if (!validSeek(seek)) return lookup ? args[3] ?? error("#N/A") : error("#N/A");
    const index = find(area, seek, vertical, Math.trunc(numberArg(args, lookup ? 4 : 2, host)), Math.trunc(numberArg(args, lookup ? 5 : 3, host, 1)), host);
    if (index === -2) return error("#VALUE!");
    if (index < 0) return lookup ? args[3] ?? error("#N/A") : error("#N/A");
    if (!lookup) return numericResult(index + 1);
    const result = args[2]!, resultDims = dimensions(result);
    if (index >= (vertical ? resultDims.height : resultDims.width)) return error("#REF!");
    if ((vertical ? resultDims.width : resultDims.height) === 1) return entry(result, vertical ? index : 0, vertical ? 0 : index, host);
    return admitMatrix(vertical ? [Array.from({ length: resultDims.width }, (_, column) => entry(result, index, column, host))] : Array.from({ length: resultDims.height }, (_, row) => [entry(result, row, index, host)]), host);
  }) satisfies FunctionImplementation])),
  TRANSPOSE: (args, host) => { const rows = host.matrix(args[0]!).rows; return admitMatrix(Array.from({ length: rows[0]?.length ?? 0 }, (_, column) => rows.map(row => { host.tick(); return row[column]!; })), host); },
  FLIP: (args, host) => {
    const rows = host.matrix(args[0]!).rows, vertical = args[1] === undefined || asBoolean(scalarArg(args, 1, host));
    if (rows.length === 1 && rows[0]?.length === 1) return rows[0][0]!;
    return admitMatrix(vertical ? [...rows].reverse() : rows.map(row => [...row].reverse()), host);
  },
  SORT: (args, host) => {
    const values = collect(args[0]!, host), failure = values.find(value => value.kind === "error"); if (failure) return failure;
    const order = Math.trunc(numberArg(args, 1, host)); if (order !== 0 && order !== 1) return error("#VALUE!");
    const numbers = values.filter(value => value.kind === "number").map(value => value.value);
    numbers.sort((a, b) => { host.tick(); return order ? a - b : b - a; });
    return admitMatrix(numbers.map(number => [numericResult(number)]), host);
  },
  UNIQUE: (args, host) => {
    const rows = host.matrix(args[0]!).rows, byColumn = asBoolean(scalarArg(args, 1, host)), once = asBoolean(scalarArg(args, 2, host));
    const groups = byColumn ? Array.from({ length: rows[0]?.length ?? 0 }, (_, column) => rows.map(row => row[column]!)) : rows;
    const kept: CellValue[][] = [], counts: number[] = [];
    for (const group of groups) {
      let match = -1;
      for (let index = 0; index < kept.length; index++) if (group.every((value, column) => { host.tick(); const previous = kept[index]![column]!; return value.kind === previous.kind && comparison(value, previous) === 0; })) { match = index; break; }
      if (match < 0) { kept.push([...group]); counts.push(1); } else counts[match] = counts[match]! + 1;
    }
    const result = kept.filter((_, index) => !once || counts[index] === 1);
    if (!result.length) return error("#VALUE!");
    return admitMatrix(byColumn ? Array.from({ length: rows.length }, (_, row) => result.map(column => column[row]!)) : result, host);
  }
};
export const lookupSpecialForms: Readonly<Record<string, SpecialForm>> = {
  CHOOSE: (args, host) => {
    if (!args.length) return error("#VALUE!");
    const index = host.scalar(host.evaluate(args[0]!, false));
    if (index.kind !== "number") return error("#VALUE!");
    const choice = Math.trunc(index.value); return choice >= 1 && choice < args.length ? host.evaluate(args[choice]!, false) : error("#VALUE!");
  },
  AREAS: (args, host) => {
    if (args.length !== 1) return error("#VALUE!");
    let source = args[0]!; while (source.kind === "parentheses") source = source.child;
    if (source.kind === "binary" && source.op === "union") {
      const count = (node: typeof source): number => {
        const child = (value: Parameters<SpecialForm>[0][number]): number => value.kind === "binary" && value.op === "union" ? count(value) : 1;
        return child(node.left) + child(node.right);
      };
      return numericResult(count(source));
    }
    const value = host.evaluate(source, true);
    return value.kind === "range" ? numericResult(1) : source.kind === "literal" && value.kind === "error" ? value : error("#VALUE!");
  },
  INDEX: (args, host) => {
    if (!args.length || args.length > 4) return error("#VALUE!");
    let source = args[0]!; while (source.kind === "parentheses") source = source.child;
    // gnumeric_index permits arrays but does not request direct-cell references.
    let value = host.evaluate(source, false); if (value.kind === "error") return value;
    const offsets: number[] = [0, 0, 0];
    for (let index = 1; index < args.length; index++) {
      const cell = host.scalar(host.evaluate(args[index]!, false)); if (cell.kind === "error") return cell;
      const n = numeric(cell); if (n === undefined) return error("#VALUE!"); offsets[index - 1] = Math.trunc(n) - 1;
    }
    // Only a syntactic SET selects by area; a named SET remains a column array.
    if (source.kind === "binary" && source.op === "union") {
      if (value.kind === "matrix") {
        if (offsets[2]! < 0 || offsets[2]! >= value.rows.length) return error("#REF!");
        value = value.rows[offsets[2]!]![0]!;
      } else return error("#REF!");
    } else if (offsets[2] !== 0) return error("#REF!");
    const row = offsets[0]!, column = offsets[1]!, dims = dimensions(value);
    if (row < 0 || column < 0 || row >= dims.height || column >= dims.width) return error("#REF!");
    if (value.kind === "range") return { ...value, firstRow: value.firstRow + row, lastRow: value.firstRow + row, firstColumn: value.firstColumn + column, lastColumn: value.firstColumn + column };
    return value.kind === "matrix" ? entry(value, row, column, host) : error("#REF!");
  },
  ARRAY: (args, host) => {
    const values: CellValue[] = [];
    for (const arg of args) collect(host.evaluate(arg), host, values);
    return !values.length ? error("#VALUE!") : values.length === 1 ? values[0]! : admitMatrix(values.map(value => [value]), host);
  }
};

import { DEFAULT_SHEET_SIZE, type CellValue } from "../../workbook.js";
import { error, numeric, numericResult, product, rendered, sum } from "../values.js";
import { scalarArg, unsupported, wildcard } from "./common.js";
import { matchNumber } from "./text.js";
import type { FunctionHost, FunctionImplementation, Reference, Value } from "./types.js";

function asciiFold(text: string): string {
  return Array.from(text, c => c >= "A" && c <= "Z" ? c.toLowerCase() : c).join("");
}
interface Quad { readonly high: number; readonly low: number }

// GOffice go_quad_mul12/SPLIT1: retain the product's rounding residual.
function quadProduct(x: number, y: number): Quad {
  const split = (value: number): Quad => {
    let scaled = value, product = scaled * 134217729;
    const rescale = !Number.isFinite(product) && Number.isFinite(value);
    if (rescale) { scaled *= Number.EPSILON; product = scaled * 134217729; }
    const high = scaled - product + product, low = scaled - high;
    return rescale ? { high: high / Number.EPSILON, low: low / Number.EPSILON } : { high, low };
  };
  const a = split(x), b = split(y), product = a.high * b.high;
  const cross = a.high * b.low + a.low * b.high, high = product + cross;
  return { high, low: product - high + cross + a.low * b.low };
}

// go_range_devsq computes a GOQuad mean, GOQuad deviations and squared
// deviations, accumulating both components rather than rounding the mean.
export function squaredDeviations(values: readonly number[], host: FunctionHost): number {
  const partials: number[] = [];
  const add = (value: number): void => {
    host.tick(); let used = 0, x = value;
    for (let index = 0; index < partials.length; index++) {
      host.tick(); let y = partials[index]!;
      if (Math.abs(x) < Math.abs(y)) { const swap = x; x = y; y = swap; }
      const high = x + y;
      if (!Number.isFinite(high)) { x = high; used = 0; break; }
      const low = y - (high - x);
      if (low !== 0) partials[used++] = low;
      x = high;
    }
    partials.length = used + 1; partials[used] = x;
  };
  const value = (): number => {
    let result = 0;
    for (const partial of partials) { host.tick(); result += partial; }
    return result;
  };
  for (let index = values.length - 1; index >= 0; index--) add(values[index]!);
  const sumHigh = value(); add(-sumHigh); const sumLow = value();
  const totalHigh = sumHigh + sumLow;
  const totalLow = Math.abs(sumHigh) > Math.abs(sumLow)
    ? sumHigh - totalHigh + sumLow : sumLow - totalHigh + sumHigh;
  const normalizedHigh = totalHigh + totalLow, normalizedLow = totalHigh - normalizedHigh + totalLow;
  const quotient = normalizedHigh / values.length, multiplied = quadProduct(quotient, values.length);
  const correction = (normalizedHigh - multiplied.high - multiplied.low + normalizedLow) / values.length;
  const meanHigh = quotient + correction, meanLow = quotient - meanHigh + correction;
  partials.length = 0;
  for (let index = values.length - 1; index >= 0; index--) {
    host.tick(); const x = values[index]!, difference = x - meanHigh;
    const correction = Math.abs(x) > Math.abs(meanHigh)
      ? x - difference - meanHigh - meanLow : -meanHigh - difference + x - meanLow;
    const high = difference + correction, low = difference - high + correction;
    const square = quadProduct(high, high), squareLow = high * low + low * high + square.low;
    const squareHigh = square.high + squareLow;
    add(squareHigh); add(square.high - squareHigh + squareLow);
  }
  return value();
}
function fieldColumn(database: Reference, field: CellValue, host: FunctionHost): number {
  if (field.kind === "number") return database.firstColumn + Math.trunc(field.value) - 1;
  if (field.kind !== "string") return -1;
  const sheet = database.sheets[0]!;
  for (let column = database.firstColumn; column <= database.lastColumn; column++) {
    host.tick(); const cell = host.cell(sheet, database.firstRow, column);
    if (cell && asciiFold(rendered(host.read(sheet, database.firstRow, column))) === asciiFold(field.value)) return column;
  }
  return -1;
}
export function criterion(value: CellValue, condition: CellValue, host: Pick<FunctionHost, "context" | "book" | "tick">, whole = false): boolean {
  if (condition.kind === "blank") return !whole;
  if (condition.kind === "number" || condition.kind === "boolean") {
    if (value.kind === "number" || value.kind === "boolean") return value.kind === condition.kind && numeric(value) === numeric(condition);
    return value.kind === "string" && condition.kind === "number" && matchNumber(value.value, host) === condition.value;
  }
  const text = rendered(condition);
  if (text === "") return value.kind === "blank" || value.kind === "string" && value.value === "";
  if (text === "=") return value.kind === "blank";
  if (text === "<>") return value.kind !== "blank";
  const op = ["<=", ">=", "<>", "<", ">", "="].find(op => text.startsWith(op));
  const source = op ? text.slice(op.length) : text, number = matchNumber(source, host);
  if (!op && number === undefined) return value.kind === "string" && wildcard(source, value.value, host, whole);
  let order: number | undefined;
  if (typeof number === "boolean") {
    if (value.kind === "boolean") order = value.value === number ? 0 : value.value ? 1 : -1;
  } else if (number !== undefined) {
    const matched = (op === undefined || op === "=") && value.kind === "string" ? matchNumber(value.value, host) : undefined;
    const actual = value.kind === "number" ? value.value : typeof matched === "number" ? matched : undefined;
    if (actual !== undefined) order = actual === number ? 0 : actual < number ? -1 : 1;
  } else if (value.kind === "string") {
    const actual = asciiFold(value.value), target = asciiFold(source);
    order = actual === target ? 0 : actual < target ? -1 : 1;
  }
  if (order === undefined) return op === "<>";
  return op === "<>" ? order !== 0 : op === "<" ? order < 0 : op === ">" ? order > 0 : op === "<=" ? order <= 0 : op === ">=" ? order >= 0 : order === 0;
}
function aggregate(name: string, args: readonly (Value | undefined)[], host: FunctionHost): CellValue {
  const database = args[0], criteria = args[2], field = scalarArg(args, 1, host);
  if (database?.kind !== "range" || criteria?.kind !== "range") return error("#NUM!");
  if (database.sheets.length !== 1 || criteria.sheets.length !== 1) unsupported("database sheet span");
  const missingField = ["DCOUNT", "DCOUNTA"].includes(name) && field.kind === "blank";
  const column = missingField ? -1 : fieldColumn(database, field, host), sheet = database.sheets[0]!;
  if (!missingField && column < 0) return error("#NUM!");
  const size = sheet.size ?? DEFAULT_SHEET_SIZE;
  if (column >= size.columns) unsupported("database field outside sheet");
  if (criteria.firstRow === criteria.lastRow) return error("#NUM!");
  const criteriaSheet = criteria.sheets[0]!, columns: number[] = [];
  for (let col = criteria.firstColumn; col <= criteria.lastColumn; col++) {
    const header = host.read(criteriaSheet, criteria.firstRow, col);
    if (header.kind === "blank") unsupported("uninitialized released database criteria header");
    const mapped = fieldColumn(database, header, host); if (mapped < 0) return error("#NUM!"); columns.push(mapped);
  }
  const conditions: { column: number; value: CellValue }[][] = [];
  for (let row = criteria.firstRow + 1; row <= criteria.lastRow; row++) {
    host.tick(); const list: { column: number; value: CellValue }[] = [];
    for (let col = criteria.firstColumn; col <= criteria.lastColumn; col++) {
      const value = host.read(criteriaSheet, row, col); if (value.kind !== "blank") list.push({ column: columns[col - criteria.firstColumn]!, value });
    }
    conditions.push(list);
  }
  const values: CellValue[] = [];
  for (let row = database.firstRow + 1; row <= database.lastRow; row++) {
    if (missingField) host.fetchCell(sheet, row, database.firstColumn);
    host.tick(); const value = missingField ? host.read(sheet, row, database.firstColumn) : host.read(sheet, row, column);
    if (!missingField && value.kind === "blank") continue;
    const matches = conditions.some(list => list.every(condition => {
      host.tick();
      // Released database matching skips conditions for an absent sparse cell.
      return !host.cell(sheet, row, condition.column) || criterion(host.read(sheet, row, condition.column), condition.value, host);
    }));
    if (!matches) continue;
    if (missingField) { values.push(value); continue; }
    if (name === "DCOUNT" && value.kind !== "number") continue;
    if (value.kind === "error" && name !== "DCOUNTA" && name !== "DGET") return value;
    if (["DCOUNTA", "DGET"].includes(name) || value.kind === "number") values.push(value);
  }
  if (["DCOUNT", "DCOUNTA"].includes(name)) return numericResult(values.length);
  // The release's range_first returns the first match, including multiple matches.
  if (name === "DGET") return values[0] ?? error("#VALUE!");
  const numbers = values.map(value => numeric(value)!);
  if (name === "DSUM") return numericResult(sum(numbers, host.tick));
  if (name === "DPRODUCT") return numericResult(numbers.length ? product(numbers) : 1);
  if (!numbers.length) return error("#NUM!");
  if (name === "DMAX") return numericResult(numbers.reduce((maximum, value) => Math.max(maximum, value), -Infinity));
  if (name === "DMIN") return numericResult(numbers.reduce((minimum, value) => Math.min(minimum, value), Infinity));
  const constant = numbers.every(value => { host.tick(); return value === numbers[0]; });
  const average = constant ? numbers[0]! : sum(numbers, host.tick) / numbers.length;
  if (name === "DAVERAGE") return numericResult(average);
  const population = name.endsWith("P"), denominator = numbers.length - (population ? 0 : 1);
  if (denominator <= 0) return error("#NUM!");
  if (constant) return numericResult(0);
  const variance = squaredDeviations(numbers, host) / denominator;
  return numericResult(name.startsWith("DSTDEV") ? Math.sqrt(variance) : variance);
}
export const databaseFunctions: Readonly<Record<string, FunctionImplementation>> = {
  ...Object.fromEntries(["DAVERAGE", "DCOUNT", "DCOUNTA", "DGET", "DMAX", "DMIN", "DPRODUCT", "DSTDEV", "DSTDEVP", "DSUM", "DVAR", "DVARP"].map(name => [name, ((args, host) => aggregate(name, args, host)) satisfies FunctionImplementation])),
  GETPIVOTDATA: (args, host) => {
    const database = args[0]; if (database?.kind !== "range") return error("#REF!");
    const column = fieldColumn(database, scalarArg(args, 1, host), host); if (column < 0) return error("#REF!");
    const sheet = host.book.sheets.find(sheet => sheet.id === host.position.sheet)!;
    const value = host.read(sheet, database.lastRow, column); return value.kind === "number" ? value : error("#REF!");
  }
};

import { integer, repr } from "../cli/parser.js";
import { CsvkitDiagnostic } from "../errors.js";
import { decimalZeroes } from "../unicode-profile.js";

// Unicode 16.0.0 Numeric_Type=Digit; Decimal ranges are pinned separately.
const digitRanges: readonly (readonly [number, number])[] = [[178,179],[185,185],[4969,4977],[6618,6618],[8304,8304],[8308,8313],[8320,8329],[9312,9320],[9332,9340],[9352,9360],[9450,9450],[9461,9469],[9471,9471],[10102,10110],[10112,10120],[10122,10130],[68160,68163],[69216,69224],[69714,69722],[127232,127242]];

function isDigit(token: string): boolean {
  return token.length > 0 && Array.from(token).every(char => {
    const point = char.codePointAt(0)!;
    return decimalZeroes.some(zero => point >= zero && point <= zero + 9) ||
      digitRanges.some(([first, last]) => point >= first && point <= last);
  });
}

/** namesAreTuple preserves Agate's singleton tuple punctuation in diagnostics. */
export function match(names: readonly string[], token: string | bigint, offset = 1, namesAreTuple = false): number {
  if (typeof token === "string" && !isDigit(token) && names.includes(token)) return names.indexOf(token);
  const value = typeof token === "bigint" ? token : integer(token);
  if (value === undefined) throw new CsvkitDiagnostic(`ColumnIdentifierError: Column '${token}' is invalid. It is neither an integer nor a column name. Column names are: ${names.map(repr).join(", ")}${namesAreTuple && names.length === 1 ? "," : ""}`);
  const index = Number(value) - offset;
  if (index < 0) throw new CsvkitDiagnostic(`ColumnIdentifierError: Column ${value} is invalid. Columns are 1-based.`);
  if (index >= names.length) throw new CsvkitDiagnostic(`ColumnIdentifierError: Column ${value} is invalid. The last column is '${names.at(-1)}' at index ${names.length - 1 + offset}.`);
  return index;
}

export function parseColumnIdentifiers(
  ids: string | null | undefined,
  names: readonly string[],
  offset = 1,
  excludedColumns?: string | null,
  step: () => void = () => {},
  namesAreTuple = false,
): number[] {
  if (!names.length) return [];
  const columns: number[] = [];
  if (ids) {
    for (const token of ids.split(",")) {
      step();
      try { columns.push(match(names, token, offset, namesAreTuple)); }
      catch (failure) {
        if (!(failure instanceof CsvkitDiagnostic)) throw failure;
        const separator = token.includes(":") ? ":" : token.includes("-") ? "-" : undefined;
        if (!separator) throw failure;
        const index = token.indexOf(separator);
        const first = token.slice(0, index); const last = token.slice(index + 1);
        const start = first ? integer(first) : 1;
        const end = last ? integer(last) : names.length;
        if (start === undefined || end === undefined) throw new CsvkitDiagnostic("ColumnIdentifierError: Invalid range %s. Ranges must be two integers separated by a - or : character.");
        for (let value = BigInt(start); value <= BigInt(end); value++) {
          step(); columns.push(match(names, value, offset));
        }
      }
    }
  } else {
    for (let index = 0; index < names.length; index++) { step(); columns.push(index); }
  }

  // Source exclusions deliberately have a different open-end default.
  const excludes = new Set<number>();
  if (excludedColumns) {
    for (const token of excludedColumns.split(",")) {
      step();
      try { excludes.add(match(names, token, offset, namesAreTuple)); }
      catch (failure) {
        if (!(failure instanceof CsvkitDiagnostic)) throw failure;
        const separator = token.includes(":") ? ":" : token.includes("-") ? "-" : undefined;
        if (!separator) continue;
        const index = token.indexOf(separator);
        const first = token.slice(0, index); const last = token.slice(index + 1);
        const start = first ? integer(first) : 1;
        const end = last ? integer(last) : names.length - 1;
        if (start === undefined || end === undefined) throw new CsvkitDiagnostic("ColumnIdentifierError: Invalid range %s. Ranges must be two integers separated by a - or : character.");
        for (let value = BigInt(start); value <= BigInt(end); value++) {
          step(); excludes.add(match(names, value, offset));
        }
      }
    }
  }
  return columns.filter(index => { step(); return !excludes.has(index); });
}

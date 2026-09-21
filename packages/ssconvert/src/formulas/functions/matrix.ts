import { SsconvertError } from "../../contracts.js";
import type { CellValue } from "../../workbook.js";
import { error, numeric, numericResult, product, sum } from "../values.js";
import { admitMatrix, numberArg } from "./common.js";
import type { FunctionHost, FunctionImplementation, Value } from "./types.js";
import { qrInverse } from "./matrix-qr.js";

function zeros(rows: number, columns: number, host: FunctionHost): number[][] {
  if (rows * columns > host.context.limits.cells) throw new SsconvertError("resource-limit", "ssconvert calculation array limit exceeded");
  return Array.from({ length: rows }, () => Array.from({ length: columns }, () => { host.tick(); return 0; }));
}
function numbers(value: Value, host: FunctionHost): number[][] | CellValue {
  const rows = host.matrix(value).rows, result = zeros(rows.length, rows[0]?.length ?? 0, host);
  for (let row = 0; row < rows.length; row++) for (let column = 0; column < rows[row]!.length; column++) {
    host.tick(); const cell = rows[row]![column]!;
    if (cell.kind === "error") return cell;
    // Native matrix coercion uses strtod's decimal prefix, not format matching.
    if (cell.kind === "string") {
      const text = cell.value.trimStart().toLowerCase(), unsigned = text[0] === "+" || text[0] === "-" ? text.slice(1) : text;
      result[row]![column] = unsigned.startsWith("nan") ? NaN : unsigned.startsWith("inf")
        ? text[0] === "-" ? -Infinity : Infinity : Number.parseFloat(text) || 0;
    } else result[row]![column] = numeric(cell) ?? 0;
  }
  return result;
}
function output(rows: readonly (readonly number[])[], host: FunctionHost): Value {
  if (rows.length * (rows[0]?.length ?? 0) > host.context.limits.cells)
    throw new SsconvertError("resource-limit", "ssconvert calculation array limit exceeded");
  return admitMatrix(rows.map(row => row.map(numericResult)), host);
}
function identity(n: number, host: FunctionHost): number[][] {
  const rows = zeros(n, n, host); for (let i = 0; i < n; i++) { host.tick(); rows[i]![i] = 1; } return rows;
}
/** Partial pivoting; every elimination and retained allocation is budgeted. */
function eliminate(a: number[][], b: number[][] | undefined, host: FunctionHost): number | undefined {
  const n = a.length, pivots: number[] = []; let sign = 1;
  for (let column = 0; column < n; column++) {
    let pivot = column;
    for (let row = column + 1; row < n; row++) { host.tick(); if (Math.abs(a[row]![column]!) > Math.abs(a[pivot]![column]!)) pivot = row; }
    if (a[pivot]![column] === 0) return b ? undefined : 0;
    if (pivot !== column) {
      [a[column], a[pivot]] = [a[pivot]!, a[column]!];
      if (b) [b[column], b[pivot]] = [b[pivot]!, b[column]!]; sign = -sign;
    }
    const divisor = a[column]![column]!; pivots.push(divisor);
    for (let row = column + 1; row < n; row++) {
      host.tick(); const multiplier = a[row]![column]! / divisor; a[row]![column] = 0;
      for (let j = column + 1; j < n; j++) { host.tick(); a[row]![j] = a[row]![j]! - multiplier * a[column]![j]!; }
      if (b) for (let j = 0; j < b[row]!.length; j++) { host.tick(); b[row]![j] = b[row]![j]! - multiplier * b[column]![j]!; }
    }
  }
  if (b) for (let row = n - 1; row >= 0; row--) for (let column = 0; column < b[row]!.length; column++) {
    host.tick(); const terms = [b[row]![column]!];
    for (let j = row + 1; j < n; j++) { host.tick(); terms.push(-a[row]![j]! * b[j]![column]!); }
    b[row]![column] = sum(terms, host.tick) / a[row]![row]!;
  }
  return sign * product(pivots);
}
function symmetric(a: number[][], host: FunctionHost): void {
  for (let i = 0; i < a.length; i++) for (let j = i + 1; j < a.length; j++) { host.tick(); a[i]![j] = a[j]![i] = (a[i]![j]! + a[j]![i]!) / 2; }
}
export const matrixFunctions: Readonly<Record<string, FunctionImplementation>> = {
  MUNIT: (args, host) => {
    const n = numberArg(args, 0, host);
    return n < 1 || n > 5000 ? error("#NUM!") : output(identity(Math.trunc(n), host), host);
  },
  ...Object.fromEntries(["MDETERM", "MINVERSE", "LINSOLVE", "CHOLESKY", "EIGEN", "MMULT", "MPSEUDOINVERSE"].map(name => [name, ((args, host) => {
    const a = numbers(args[0]!, host); if (!Array.isArray(a)) return a;
    const n = a.length, columns = a[0]?.length ?? 0;
    if (!n || !columns || !["MMULT", "MPSEUDOINVERSE"].includes(name) && n !== columns) return error("#VALUE!");
    if (name === "MMULT") {
      const b = numbers(args[1]!, host); if (!Array.isArray(b)) return b;
      if (columns !== b.length || !b[0]?.length) return error("#VALUE!");
      const result = zeros(n, b[0].length, host);
      for (let i = 0; i < n; i++) for (let j = 0; j < b[0].length; j++) {
        const terms: number[] = []; for (let k = 0; k < columns; k++) { host.tick(); terms.push(a[i]![k]! * b[k]![j]!); }
        result[i]![j] = sum(terms, host.tick);
      }
      return output(result, host);
    }
    if (name === "MDETERM") return numericResult(eliminate(a, undefined, host)!);
    if (name === "MINVERSE" || name === "MPSEUDOINVERSE") {
      const result = qrInverse(a, numberArg(args, 1, host, 256 * Number.EPSILON), name === "MPSEUDOINVERSE", host);
      return result ? output(result, host) : error("#NUM!");
    }
    if (name === "LINSOLVE") {
      const b = numbers(args[1]!, host);
      if (!Array.isArray(b)) return b;
      if (b.length !== n || !b[0]?.length) return error("#VALUE!");
      return eliminate(a, b, host) === undefined ? error("#NUM!") : output(b, host);
    }
    if (name === "CHOLESKY") {
      symmetric(a, host); const result = zeros(n, n, host);
      for (let i = 0; i < n; i++) for (let j = 0; j <= i; j++) {
        let retained = 0;
        for (let k = 0; k < j; k++) { host.tick(); retained += result[i]![k]! * result[j]![k]!; }
        const value = a[i]![j]! - retained;
        result[i]![j] = i === j ? Math.sqrt(value) : value / result[j]![j]!;
      }
      return output(result, host);
    }
    if (name === "EIGEN") {
      if (n * (n + 1) > host.context.limits.cells)
        throw new SsconvertError("resource-limit", "ssconvert calculation array limit exceeded");
      const vectors = identity(columns, host);
      symmetric(a, host);
      // Jacobi rotations on symmetric input avoid a characteristic polynomial.
      for (let sweep = 0; sweep < 64; sweep++) {
        let changed = false;
        for (let p = 0; p < n; p++) for (let q = p + 1; q < n; q++) {
          host.tick(); const off = a[p]![q]!;
          if (off === 0 || Math.abs(off) <= Number.EPSILON * Math.sqrt(Math.abs(a[p]![p]!)) * Math.sqrt(Math.abs(a[q]![q]!))) continue;
          changed = true; const tau = (a[q]![q]! - a[p]![p]!) / (2 * off), t = (tau < 0 ? -1 : 1) / (Math.abs(tau) + Math.hypot(1, tau));
          const c = 1 / Math.hypot(1, t), s = t * c;
          a[p]![p] = a[p]![p]! - t * off; a[q]![q] = a[q]![q]! + t * off; a[p]![q] = a[q]![p] = 0;
          for (let k = 0; k < n; k++) {
            host.tick(); if (k !== p && k !== q) { const x = a[k]![p]!, y = a[k]![q]!; a[k]![p] = a[p]![k] = c * x - s * y; a[k]![q] = a[q]![k] = s * x + c * y; }
            const x = vectors[k]![p]!, y = vectors[k]![q]!; vectors[k]![p] = c * x - s * y; vectors[k]![q] = s * x + c * y;
          }
        }
        if (!changed) {
          const order = Array.from({ length: n }, (_, i) => i).sort((i, j) => Math.abs(a[j]![j]!) - Math.abs(a[i]![i]!) || a[j]![j]! - a[i]![i]!);
          return output([order.map(i => a[i]![i]!), ...vectors.map(row => order.map(i => row[i]!))], host);
        }
      }
      return error("#NUM!");
    }
    return error("#VALUE!");
  }) satisfies FunctionImplementation]))
};

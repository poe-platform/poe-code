import type { LinearRow, SolverBudget } from './linear.js';
export interface SensitivityEntry { readonly low: number; readonly high: number; readonly shadow: number }
export interface Sensitivity { readonly variables: readonly SensitivityEntry[]; readonly constraints: readonly SensitivityEntry[] }
/** Active-basis sensitivity for continuous linear programs, with shared bounded arithmetic. */
export function linearSensitivity(rows: readonly LinearRow[], objective: readonly number[], solution: readonly number[], budget: SolverBudget): Sensitivity {
  const n = objective.length;
  budget.tick(n * n + rows.length * n);
  const basis: number[] = [], echelon: number[][] = [];
  for (let i = 0; i < rows.length && basis.length < n; i++) {
    const row = rows[i]!;
    const activity = row.coefficients.reduce((sum, v, j) => sum + v * solution[j]!, 0);
    if (Math.abs(activity - row.upper) > 1e-7 * Math.max(1, Math.abs(row.upper))) continue;
    const vector = [...row.coefficients];
    for (const b of echelon) {
      const pivot = b.findIndex(v => Math.abs(v) > 1e-10), multiplier = vector[pivot]!;
      for (let j = 0; j < n; j++) { budget.tick(); vector[j] = vector[j]! - multiplier * b[j]!; }
    }
    const pivot = vector.findIndex(v => Math.abs(v) > 1e-10);
    if (pivot === -1) continue;
    const scale = vector[pivot]!;
    echelon.push(vector.map(v => v / scale)); basis.push(i);
  }
  const missing = (): SensitivityEntry => ({ low: NaN, high: NaN, shadow: NaN });
  if (basis.length !== n) return { variables: objective.map(missing), constraints: rows.map(missing) };
  const inverse = basis.map((i, j) => [...rows[i]!.coefficients, ...objective.map((_, k) => Number(j === k))]);
  for (let j = 0; j < n; j++) {
    let pivot = j;
    for (let i = j + 1; i < n; i++) if (Math.abs(inverse[i]![j]!) > Math.abs(inverse[pivot]![j]!)) pivot = i;
    [inverse[j], inverse[pivot]] = [inverse[pivot]!, inverse[j]!];
    const divisor = inverse[j]![j]!;
    for (let k = 0; k < n * 2; k++) { budget.tick(); inverse[j]![k] = inverse[j]![k]! / divisor; }
    for (let i = 0; i < n; i++) if (i !== j) {
      const multiplier = inverse[i]![j]!;
      for (let k = 0; k < n * 2; k++) { budget.tick(); inverse[i]![k] = inverse[i]![k]! - multiplier * inverse[j]![k]!; }
    }
  }
  const dual = basis.map((_, i) => objective.reduce((sum, c, j) => sum + c * inverse[j]![n + i]!, 0));
  const variables = objective.map((c, j) => {
    let low = -Infinity, high = Infinity;
    for (let i = 0; i < n; i++) {
      budget.tick(); const slope = inverse[j]![n + i]!;
      if (slope > 1e-10) low = Math.max(low, -dual[i]! / slope);
      else if (slope < -1e-10) high = Math.min(high, -dual[i]! / slope);
    }
    return { low: c + low, high: c + high, shadow: c - dual.reduce((sum, d, i) => sum + d * rows[basis[i]!]!.coefficients[j]!, 0) };
  });
  const constraints = rows.map((r, rowIndex) => {
    const index = basis.indexOf(rowIndex);
    if (index === -1) return { low: r.coefficients.reduce((sum, c, j) => sum + c * solution[j]!, 0), high: Infinity, shadow: 0 };
    const direction = objective.map((_, j) => inverse[j]![n + index]!);
    let low = -Infinity, high = Infinity;
    for (let i = 0; i < rows.length; i++) if (i !== rowIndex) {
      const other = rows[i]!, slope = other.coefficients.reduce((sum, c, j) => sum + c * direction[j]!, 0);
      const slack = other.upper - other.coefficients.reduce((sum, c, j) => sum + c * solution[j]!, 0);
      budget.tick(n * 2);
      if (slope > 1e-10) high = Math.min(high, slack / slope);
      else if (slope < -1e-10) low = Math.max(low, slack / slope);
    }
    return { low: r.upper + low, high: r.upper + high, shadow: dual[index]! };
  });
  return { variables, constraints };
}

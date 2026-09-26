import type { CapabilityContext } from '../contracts.js';
import { SsconvertError } from '../contracts.js';
export interface LinearRow { readonly coefficients: readonly number[]; readonly upper: number }
export interface LinearResult { readonly quality: 'optimal' | 'infeasible' | 'unbounded' | 'limit'; readonly solution?: readonly number[]; readonly value?: number }
/** Invocation-owned arithmetic budget, shared by all relaxations and evaluations. */
export class SolverBudget {
  private work = 0;
  private iterations = 0;
  private readonly start: number | undefined;
  constructor(private readonly context: CapabilityContext, private readonly maximumIterations: number, private readonly maximumSeconds: number) { this.start = context.clock?.now(); }
  tick(amount = 1): void {
    this.context.signal.throwIfAborted();
    this.work += amount;
    if (this.work > (this.context.limits.workbookWork ?? this.context.limits.inputBytes + this.context.limits.cells * 32)) throw new SsconvertError('resource-limit', 'ssconvert workbook work limit exceeded');
  }
  step(): boolean {
    this.tick();
    return this.iterations++ < this.maximumIterations && !(this.start !== undefined && this.context.clock && (this.context.clock.now() - this.start) / 1000 >= this.maximumSeconds);
  }
}
const tolerance = 1e-9;
/** Two-phase simplex: maximize c*x subject to A*x<=b, x>=0. Bland ties avoid cycling. */
export function simplex(rows: readonly LinearRow[], objective: readonly number[], budget: SolverBudget): LinearResult {
  const m = rows.length, n = objective.length;
  budget.tick((m + 2) * (n + 2));
  const table = Array.from({ length: m + 2 }, () => Array<number>(n + 2).fill(0));
  const basic = rows.map((_, i) => n + i), nonbasic = Array.from({ length: n + 1 }, (_, i) => i);
  for (let i = 0; i < m; i++) { for (let j = 0; j < n; j++) table[i]![j] = rows[i]!.coefficients[j]!; table[i]![n] = -1; table[i]![n + 1] = rows[i]!.upper; }
  for (let j = 0; j < n; j++) table[m]![j] = -objective[j]!;
  nonbasic[n] = -1; table[m + 1]![n] = 1;
  const pivot = (r: number, s: number) => {
    const inv = 1 / table[r]![s]!;
    budget.tick((m + 2) * (n + 2));
    for (let i = 0; i < m + 2; i++) if (i !== r) for (let j = 0; j < n + 2; j++) if (j !== s) table[i]![j] = table[i]![j]! - table[r]![j]! * table[i]![s]! * inv;
    for (let j = 0; j < n + 2; j++) if (j !== s) table[r]![j] = table[r]![j]! * inv;
    for (let i = 0; i < m + 2; i++) if (i !== r) table[i]![s] = -table[i]![s]! * inv;
    table[r]![s] = inv;
    [basic[r], nonbasic[s]] = [nonbasic[s]!, basic[r]!];
  };
  const phase = (index: number): 'optimal' | 'unbounded' | 'limit' => {
    for (;;) {
      budget.tick((m + 1) * (n + 1));
      let s = -1;
      for (let j = 0; j <= n; j++) if (!(index === m && nonbasic[j] === -1) && table[index]![j]! < -tolerance && (s === -1 || nonbasic[j]! < nonbasic[s]!)) s = j;
      if (s === -1) return 'optimal';
      let r = -1;
      for (let i = 0; i < m; i++) if (table[i]![s]! > tolerance) {
        const ratio = table[i]![n + 1]! / table[i]![s]!, old = r === -1 ? Infinity : table[r]![n + 1]! / table[r]![s]!;
        if (ratio < old - tolerance || Math.abs(ratio - old) <= tolerance && basic[i]! < basic[r]!) r = i;
      }
      if (r === -1) return 'unbounded';
      if (!budget.step()) return 'limit';
      pivot(r, s);
    }
  };
  let r = -1;
  for (let i = 0; i < m; i++) if (r === -1 || table[i]![n + 1]! < table[r]![n + 1]!) r = i;
  if (r !== -1 && table[r]![n + 1]! < -tolerance) {
    if (!budget.step()) return { quality: 'limit' };
    pivot(r, n);
    const status = phase(m + 1);
    if (status === 'limit') return { quality: 'limit' };
    if (status !== 'optimal' || Math.abs(table[m + 1]![n + 1]!) > tolerance) return { quality: 'infeasible' };
    const artificial = basic.indexOf(-1);
    if (artificial !== -1) {
      const s = nonbasic.findIndex((_, j) => Math.abs(table[artificial]![j]!) > tolerance);
      if (s !== -1) pivot(artificial, s);
    }
  }
  const quality = phase(m);
  const solution = Array<number>(n).fill(0);
  for (let i = 0; i < m; i++) if (basic[i]! >= 0 && basic[i]! < n) solution[basic[i]!] = table[i]![n + 1]!;
  return { quality, solution, value: table[m]![n + 1]! };
}
/** Free variables are split into positive/negative columns; integer nodes share the same budget. */
export function solveLinear(rows: readonly LinearRow[], objective: readonly number[], domains: readonly string[], budget: SolverBudget): LinearResult {
  const split = (a: readonly number[]) => a.flatMap(v => [v, -v]);
  const expanded = rows.map(r => ({ coefficients: split(r.coefficients), upper: r.upper }));
  const queue: LinearRow[][] = [expanded];
  let incumbent: LinearResult | undefined;
  while (queue.length) {
    budget.tick();
    const node = queue.pop()!, relaxation = simplex(node, split(objective), budget);
    if (relaxation.quality === 'infeasible') continue;
    if (!relaxation.solution) return incumbent ? { ...incumbent, quality: 'limit' } : relaxation;
    const solution = objective.map((_, i) => relaxation.solution![i * 2]! - relaxation.solution![i * 2 + 1]!);
    if (relaxation.quality === 'limit') return incumbent ? { ...incumbent, quality: 'limit' } : domains.every(d => d === 'continuous') ? { ...relaxation, solution } : { quality: 'limit' };
    if (relaxation.quality !== 'unbounded' && incumbent && relaxation.value! <= incumbent.value! + tolerance) continue;
    const fractional = domains.findIndex((d, i) => d !== 'continuous' && Math.abs(solution[i]! - Math.round(solution[i]!)) > 1e-7);
    if (fractional === -1) {
      if (relaxation.quality === 'unbounded') return { quality: 'unbounded' };
      incumbent = { ...relaxation, solution: solution.map((v, i) => domains[i] === 'continuous' ? v : Math.round(v)) }; continue;
    }
    if (!budget.step()) return incumbent ? { ...incumbent, quality: 'limit' } : { quality: 'limit' };
    const coefficients = objective.map((_, i) => i === fractional ? 1 : 0), value = solution[fractional]!;
    budget.tick(node.length * 2 + objective.length * 4);
    queue.push([...node, { coefficients: split(coefficients.map(v => -v)), upper: -Math.ceil(value) }]);
    queue.push([...node, { coefficients: split(coefficients), upper: Math.floor(value) }]);
  }
  return incumbent ?? { quality: 'infeasible' };
}

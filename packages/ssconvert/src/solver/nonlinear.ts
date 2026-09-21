// Rosenbrock direction search adapted from Gnumeric 1.12.61
// plugins/nlsolve/gnm-nlsolve.c (GPL-2.0-or-later).
import type { SolverProgram } from './program.js';
import { newtonImprove, polishObjective } from './newton.js';
export interface NonlinearResult { readonly solution: readonly number[]; readonly limited: boolean }
export function solveNonlinear(program: SolverProgram): NonlinearResult | string {
  const { model, budget } = program, n = model.variables.length;
  if (program.parts.some(p => p.relation === 4)) return 'This solver does not handle equality constraints.';
  for (let i = 0; i < n; i++) {
    if (model.domains[i] !== 'continuous') return 'This solver does not handle discrete variables.';
    if (program.lower[i] === program.upper[i]) return 'This solver does not handle equality constraints.';
  }
  let x = model.variables.map(v => program.value(program.book, v));
  let book = program.apply(x);
  if (!program.feasible(book, x)) return 'The initial values do not satisfy the constraints.';
  const sign = model.objective === 'maximize' ? -1 : 1;
  let y = sign * program.value(book, model.target);
  budget.tick(n * n);
  let directions = Array.from({ length: n }, (_, i) => Array.from({ length: n }, (_, j) => Number(i === j)));
  let iteration = 0;
  let phase: 'search' | 'polish' | 'complete' = 'search';
  for (;;) {
    if (!budget.step()) return { solution: x, limited: true };
    // A released compound iterator reports progress while it still has a child
    // to try, including a stationary search and the following polish attempt.
    if (phase === 'complete') return { solution: x, limited: false };
    if (phase === 'polish') {
      const improved = polishObjective(program, x, y);
      iteration++;
      if (improved) { x = improved.solution; y = improved.value; phase = 'search'; }
      else phase = 'complete';
      continue;
    }
    if (iteration < 20 || iteration % 100 === 0) {
      const improved = newtonImprove(program, x, y);
      if (improved) { x = improved.solution; y = improved.value; iteration++; continue; }
    }
    if (iteration++ % 20 === 0) { budget.tick(n * n); directions = directions.map((_, i) => directions.map((_, j) => Number(i === j))); }
    budget.tick(n * 3);
    const distances = x.map(v => (v === 0 ? 1 : Math.abs(v)) * 2 ** -16), displacement = x.map(() => 0), state = x.map(() => 0);
    let done = 0, progress = false;
    for (let safety = 0; done < n && safety <= n * 53; safety++) {
      for (let i = 0; i < n; i++) {
        budget.tick(n);
        if (state[i] === 2) continue;
        const candidate = x.map((v, j) => v + distances[i]! * directions[i]![j]!);
        book = program.apply(candidate);
        const value = sign * program.value(book, model.target);
        if (Number.isFinite(value) && value <= y && program.feasible(book, candidate)) {
          if (value < y) { x = candidate; y = value; displacement[i] = displacement[i]! + distances[i]!; progress = true; }
          state[i] = 1; distances[i] = distances[i]! * 3;
        } else {
          if (state[i] === 1) { state[i] = 2; done++; }
          distances[i] = distances[i]! * -0.5;
        }
      }
    }
    // Polish numerically close box boundaries with the shared evaluator. This
    // avoids asymptotically approaching zero until the work budget is exhausted.
    for (let i = 0; i < n; i++) for (const boundary of [program.lower[i]!, program.upper[i]!]) {
      budget.tick();
      if (!Number.isFinite(boundary) || x[i] === boundary || Math.abs(x[i]! - boundary) > 2 ** -16 * Math.max(1, Math.abs(x[i]!), Math.abs(boundary))) continue;
      const candidate = [...x]; candidate[i] = boundary;
      book = program.apply(candidate);
      const value = sign * program.value(book, model.target);
      if (Number.isFinite(value) && value < y && program.feasible(book, candidate)) { x = candidate; y = value; progress = true; }
    }
    if (!progress) { phase = 'polish'; continue; }
    budget.tick(n * n * 2 + n);
    const accumulated = directions.map(() => Array<number>(n).fill(0)), squares = Array<number>(n).fill(0);
    for (let i = n - 1; i >= 0; i--) {
      squares[i] = displacement[i]! ** 2 + (squares[i + 1] ?? 0);
      for (let j = 0; j < n; j++) accumulated[i]![j] = (accumulated[i + 1]?.[j] ?? 0) + displacement[i]! * directions[i]![j]!;
    }
    for (let i = n - 1; i > 0; i--) {
      const div = Math.sqrt(squares[i - 1]! * squares[i]!);
      if (div !== 0 && Number.isFinite(div)) directions[i] = directions[i]!.map((_, j) => (displacement[i - 1]! * accumulated[i]![j]! - directions[i - 1]![j]! * squares[i]!) / div);
    }
    const norm = Math.sqrt(squares[0]!);
    if (norm !== 0 && Number.isFinite(norm)) directions[0] = accumulated[0]!.map(v => v / norm);
  }
}

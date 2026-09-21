// Analytic Newton improvement and line search from Gnumeric 1.12.61
// plugins/nlsolve/gnm-nlsolve.c and src/tools/gnm-solver.c (GPL-2.0-or-later).
import type { FormulaNode } from '../formulas/ast.js';
import { parseExpression } from '../formulas/parser.js';
import { localReferenceRange } from '../formulas/local-references.js';
import type { SolverAddress } from './model.js';
import { addressKey, type SolverProgram } from './program.js';

interface Jet { value: number; gradient: number[]; hessian: number[] }
/** Second-order differentiation of the supported arithmetic formula graph.
 * Unsupported expressions disable Newton; ordinary direction search remains. */
export function analyticObjective(program: SolverProgram, coordinates: readonly number[]): Jet | undefined {
  const n = coordinates.length, { budget } = program;
  budget.tick(n);
  const variables = new Map(program.model.variables.map((v, i) => [addressKey(v), i]));
  const visiting = new Set<string>();
  const constant = (value: number): Jet => {
    budget.tick(n * n + n);
    return { value, gradient: Array<number>(n).fill(0), hessian: Array<number>(n * n).fill(0) };
  };
  const compose = (a: Jet, value: number, first: number, second: number): Jet => {
    budget.tick(n * n + n);
    return { value, gradient: a.gradient.map(g => first * g), hessian: a.hessian.map((h, k) => first * h + second * a.gradient[Math.floor(k / n)]! * a.gradient[k % n]!) };
  };
  const multiply = (a: Jet, b: Jet): Jet => {
    budget.tick(n * n + n);
    return { value: a.value * b.value, gradient: a.gradient.map((g, i) => g * b.value + a.value * b.gradient[i]!), hessian: a.hessian.map((h, k) => {
      const i = Math.floor(k / n), j = k % n;
      return h * b.value + a.value * b.hessian[k]! + a.gradient[i]! * b.gradient[j]! + b.gradient[i]! * a.gradient[j]!;
    }) };
  };
  const cell = (address: SolverAddress, depth: number): Jet | undefined => {
    budget.tick();
    if (depth > 128) return undefined;
    const key = addressKey(address), index = variables.get(key);
    if (index !== undefined) { const result = constant(coordinates[index]!); result.gradient[index] = 1; return result; }
    if (visiting.has(key)) return undefined;
    const source = program.cell(program.book, address);
    if (!source?.formula) return !source || source.value.kind === 'blank' ? constant(0) : source.value.kind === 'number' ? constant(source.value.value) : undefined;
    visiting.add(key);
    budget.tick(source.formula.length);
    const parsed = parseExpression(source.formula, { workbook: program.book, position: address, signal: program.context.signal, maximumLength: program.context.limits.inputBytes, maximumNodes: source.formula.length + 1 });
    const result = parsed.ok ? expression(parsed.document.root, address, depth + 1) : undefined;
    visiting.delete(key);
    return result;
  };
  const expression = (node: FormulaNode, position: SolverAddress, depth: number): Jet | undefined => {
    budget.tick();
    if (depth > 128) return undefined;
    if (node.kind === 'literal') return node.value.kind === 'number' ? constant(node.value.value) : undefined;
    if (node.kind === 'reference') {
      const range = localReferenceRange(program.book, node, position);
      return range?.sheets.length === 1 && range.firstRow === range.lastRow && range.firstColumn === range.lastColumn ? cell({ sheet: range.sheets[0]!.id, row: range.firstRow, column: range.firstColumn }, depth + 1) : undefined;
    }
    if (node.kind === 'parentheses' || node.kind === 'unary') {
      const child = expression(node.child, position, depth + 1);
      if (!child) return undefined;
      const scale = node.kind === 'parentheses' || node.op === '+' ? 1 : node.op === '-' ? -1 : 0.01;
      return compose(child, child.value * scale, scale, 0);
    }
    if (node.kind !== 'binary') return undefined;
    const a = expression(node.left, position, depth + 1), b = expression(node.right, position, depth + 1);
    if (!a || !b) return undefined;
    if (node.op === '+' || node.op === '-') {
      budget.tick(n * n + n);
      const sign = node.op === '+' ? 1 : -1;
      return { value: a.value + sign * b.value, gradient: a.gradient.map((g, i) => g + sign * b.gradient[i]!), hessian: a.hessian.map((h, i) => h + sign * b.hessian[i]!) };
    }
    if (node.op === '*') return multiply(a, b);
    if (node.op === '/') return multiply(a, compose(b, 1 / b.value, -1 / b.value ** 2, 2 / b.value ** 3));
    if (node.op === '^' && b.gradient.every(g => g === 0) && b.hessian.every(h => h === 0)) {
      const exponent = b.value;
      return compose(a, a.value ** exponent, exponent === 0 ? 0 : exponent * a.value ** (exponent - 1), exponent === 0 || exponent === 1 ? 0 : exponent * (exponent - 1) * a.value ** (exponent - 2));
    }
    return undefined;
  };
  const result = cell(program.model.target!, 0);
  if (!result || !Number.isFinite(result.value) || result.gradient.some(g => !Number.isFinite(g)) || result.hessian.some(h => !Number.isFinite(h))) return undefined;
  return program.model.objective === 'maximize' ? compose(result, -result.value, -1, 0) : result;
}

export function newtonImprove(program: SolverProgram, x: readonly number[], value: number): { solution: number[]; value: number } | undefined {
  const jet = analyticObjective(program, x);
  if (!jet) return undefined;
  const n = x.length, { budget } = program;
  // Released gnm_linear_solve_posdef regularizes even indefinite Hessians.
  // Admit both dense working matrices and cubic arithmetic before allocation.
  budget.tick(2 * n * n + 2 * n * n * n + n * 5);
  const lower = [...jet.hessian], diagonal = Array<number>(n).fill(0), correction = Array<number>(n).fill(0);
  const permutation = Array.from({ length: n }, (_, i) => i);
  let gam = 0, xsi = 0;
  for (let i = 0; i < n; i++) {
    gam = Math.max(gam, Math.abs(lower[i * n + i]!));
    for (let j = i + 1; j < n; j++) xsi = Math.max(xsi, Math.abs(lower[i * n + j]!));
  }
  const bsqr = Math.max(gam, xsi / (n === 1 ? 1 : Math.sqrt(n * n - 1)), Number.EPSILON);
  const delta = Math.max(gam + xsi, 1) * Number.EPSILON;
  for (let j = 0; j < n; j++) {
    budget.tick();
    let q = j;
    for (let i = j + 1; i < n; i++) if (Math.abs(lower[i * n + i]!) > Math.abs(lower[q * n + q]!)) q = i;
    if (q !== j) {
      for (let i = 0; i < n; i++) {
        [lower[j * n + i], lower[q * n + i]] = [lower[q * n + i]!, lower[j * n + i]!];
      }
      for (let i = 0; i < n; i++) [lower[i * n + j], lower[i * n + q]] = [lower[i * n + q]!, lower[i * n + j]!];
      [permutation[j], permutation[q]] = [permutation[q]!, permutation[j]!];
      [diagonal[j], diagonal[q]] = [diagonal[q]!, diagonal[j]!];
      [correction[j], correction[q]] = [correction[q]!, correction[j]!];
    }
    for (let s = 0; s < j; s++) lower[j * n + s] = lower[j * n + s]! / diagonal[s]!;
    let theta = 0;
    for (let i = j + 1; i < n; i++) {
      let d = lower[i * n + j]!;
      for (let s = 0; s < j; s++) d -= lower[j * n + s]! * lower[i * n + s]!;
      lower[i * n + j] = d;
      theta = Math.max(theta, Math.abs(d));
    }
    diagonal[j] = Math.max(theta * theta / bsqr, delta, Math.abs(lower[j * n + j]!));
    correction[j] = diagonal[j]! - lower[j * n + j]!;
    for (let i = j + 1; i < n; i++) lower[i * n + i] = lower[i * n + i]! - lower[i * n + j]! ** 2 / diagonal[j]!;
  }
  const matrix = [...jet.hessian], direction = jet.gradient.map(g => -g);
  for (let i = 0; i < n; i++) matrix[i * n + i] = matrix[i * n + i]! + correction[permutation[i]!]!;
  for (let k = 0; k < n; k++) {
    budget.tick();
    let pivot = k;
    for (let i = k + 1; i < n; i++) if (Math.abs(matrix[i * n + k]!) > Math.abs(matrix[pivot * n + k]!)) pivot = i;
    if (pivot !== k) {
      for (let j = k; j < n; j++) [matrix[k * n + j], matrix[pivot * n + j]] = [matrix[pivot * n + j]!, matrix[k * n + j]!];
      [direction[k], direction[pivot]] = [direction[pivot]!, direction[k]!];
    }
    const divisor = matrix[k * n + k]!;
    if (divisor === 0 || !Number.isFinite(divisor)) return undefined;
    for (let i = k + 1; i < n; i++) {
      const factor = matrix[i * n + k]! / divisor;
      for (let j = k + 1; j < n; j++) matrix[i * n + j] = matrix[i * n + j]! - factor * matrix[k * n + j]!;
      direction[i] = direction[i]! - factor * direction[k]!;
    }
  }
  for (let i = n - 1; i >= 0; i--) {
    let sum = direction[i]!;
    for (let j = i + 1; j < n; j++) sum -= matrix[i * n + j]! * direction[j]!;
    direction[i] = sum / matrix[i * n + i]!;
  }
  const full = evaluateStep(program, x, direction, 1);
  if (full?.feasible && full.value < value) return full;
  // Released Newton line-search parameters: step .75, max 1, eps .01.
  return lineSearch(program, x, direction, value, { tryReverse: false, initialStep: 0.75, maximumStep: 1, epsilon: 0.01 });
}

function evaluateStep(program: SolverProgram, x: readonly number[], direction: readonly number[], step: number, includeOutsideBox = false) {
  program.budget.tick(x.length);
  const solution = x.map((v, i) => v + step * direction[i]!);
  if (solution.some(v => !Number.isFinite(v))) return undefined;
  // A derived box violation cannot be accepted by any search phase. Avoid
  // recalculating unless its raw objective is needed for native flat accounting.
  if (!includeOutsideBox && solution.some((v, i) => v < program.lower[i]! || v > program.upper[i]!)) return { solution, value: NaN, feasible: false, boxSkipped: true };
  const sign = program.model.objective === 'maximize' ? -1 : 1;
  const book = program.apply(solution), value = sign * program.value(book, program.model.target);
  return { solution, value, feasible: Number.isFinite(value) && program.feasible(book, solution), boxSkipped: false };
}

export interface LineSearchOptions {
  readonly tryReverse: boolean;
  readonly initialStep: number;
  readonly maximumStep: number;
  readonly epsilon: number;
}

/** Released three-phase search; returns undefined without mutating x if flat. */
export function lineSearch(program: SolverProgram, x: readonly number[], direction: readonly number[], value: number, options: LineSearchOptions): { solution: number[]; value: number } | undefined {
  program.budget.tick();
  if (!(options.epsilon >= 0) || !(options.initialStep > 0) || !(options.maximumStep >= options.initialStep)) return undefined;
  const phi = (Math.sqrt(5) + 1) / 2;
  let step = options.initialStep, best: ReturnType<typeof evaluateStep>;
  for (;; step /= 32) {
    program.budget.tick();
    let trial = evaluateStep(program, x, direction, step);
    if (trial?.feasible && trial.value < value) { best = trial; break; }
    let flat = trial?.value === value;
    if (options.tryReverse) {
      let reverse = evaluateStep(program, x, direction, -step);
      if (reverse?.feasible && reverse.value < value) { best = reverse; step = -step; break; }
      if (trial?.boxSkipped && reverse?.value === value) trial = evaluateStep(program, x, direction, step, true);
      if (reverse?.boxSkipped && trial?.value === value) reverse = evaluateStep(program, x, direction, -step, true);
      flat = trial?.value === value && reverse?.value === value;
    } else if (trial?.boxSkipped) flat = evaluateStep(program, x, direction, step, true)?.value === value;
    if (flat || step === 0) return undefined;
  }
  if (!best) return undefined;
  let s0 = 0, s1 = step, s2 = 0, y0 = value, y1 = best.value, y2 = 0;
  for (;;) {
    program.budget.tick();
    s2 = s1 * (phi + 1);
    if (Math.abs(s2) >= options.maximumStep) return best;
    const far = evaluateStep(program, x, direction, s2);
    if (!far?.feasible) return best;
    if (far.value < y1) { s1 = s2; y1 = far.value; best = far; continue; }
    y2 = far.value;
    break;
  }
  let rightBig = true;
  for (;;) {
    program.budget.tick();
    const s = rightBig ? s1 + (s1 - s0) * (phi - 1) : s1 - (s2 - s1) * (phi - 1);
    // Keep the native ordered comparisons, including a reverse/negative bracket.
    if (s <= s0 || s >= s2 || Math.abs(s - s1) <= options.epsilon) break;
    const trial = evaluateStep(program, x, direction, s);
    if (!trial?.feasible) break;
    if (trial.value < y1) {
      if (rightBig) { s0 = s1; y0 = y1; } else { s2 = s1; y2 = y1; }
      s1 = s; y1 = trial.value; best = trial;
    } else {
      if (rightBig) { s2 = s; y2 = trial.value; } else { s0 = s; y0 = trial.value; }
      rightBig = !rightBig;
      if (y0 === y1 && y1 === y2) break;
    }
  }
  return best;
}

/** One native compound-polish pass: optimize each coordinate in sequence. */
export function polishObjective(program: SolverProgram, x: readonly number[], value: number): { solution: number[]; value: number } | undefined {
  program.budget.tick(x.length * 2 + 8);
  let solution = [...x], current = value, improved = false;
  const direction = Array<number>(x.length).fill(0), bits = new DataView(new ArrayBuffer(8));
  for (let i = 0; i < x.length; i++) {
    program.budget.tick();
    const coordinate = solution[i]!, magnitude = Math.abs(coordinate);
    let initialStep = 0.5, maximumStep = 1;
    if (coordinate !== 0) {
      if (!Number.isFinite(coordinate)) continue;
      bits.setFloat64(0, magnitude);
      let exponent = (bits.getUint32(0) >>> 20) & 0x7ff;
      let adjustment = 0;
      if (exponent === 0) {
        bits.setFloat64(0, magnitude * 2 ** 1022);
        exponent = (bits.getUint32(0) >>> 20) & 0x7ff;
        adjustment = -1022;
      }
      // frexp has mantissa in [.5,1), hence biased exponent minus 1022.
      initialStep = 2 ** (exponent - 1022 + adjustment - 10);
      if (initialStep === 0) initialStep = 2 ** -1022; // Released GNM_MIN.
      maximumStep = magnitude;
    }
    direction[i] = 1;
    const next = lineSearch(program, solution, direction, current, { tryReverse: true, initialStep, maximumStep, epsilon: 0 });
    direction[i] = 0;
    if (next) { solution = next.solution; current = next.value; improved = true; }
  }
  return improved ? { solution, value: current } : undefined;
}

import { SsconvertError, type CapabilityContext } from '../contracts.js';
import { snapshotWorkbook, type Workbook, type CellValue } from '../workbook.js';
import { recalculateWorkbook } from '../formulas/evaluator.js';
import { parseExpression } from '../formulas/parser.js';
import { localReferenceRange } from '../formulas/local-references.js';
import type { SolverAddress, SolverParameters, SolverRelation } from './model.js';
import { SolverBudget, type LinearRow } from './linear.js';
export interface ConstraintPart { readonly relation: SolverRelation; readonly lhs: SolverAddress; readonly rhs?: SolverAddress | number | undefined }
export const addressKey = (v: SolverAddress): string => `${v.sheet}:${v.row}:${v.column}`;
export class SolverProgram {
  readonly book: Workbook;
  readonly parts: ConstraintPart[] = [];
  readonly lower: number[];
  readonly upper: number[];
  constructor(book: Workbook, readonly model: SolverParameters, readonly context: CapabilityContext, readonly budget: SolverBudget) {
    budget.tick(model.variables.length * 3 + model.constraints.length);
    this.book = snapshotWorkbook(book, context.limits);
    this.lower = model.variables.map(() => model.options.nonnegative ? 0 : -Infinity);
    this.upper = model.variables.map(() => Infinity);
    const indexes = new Map(model.variables.map((v, i) => [addressKey(v), i]));
    for (const c of model.constraints) if (c.lhs) for (let row = c.lhs.firstRow; row <= c.lhs.lastRow; row++) for (let column = c.lhs.firstColumn; column <= c.lhs.lastColumn; column++) {
      budget.tick();
      const lhs = { sheet: c.lhs.sheets[0]!.id, row, column };
      const rhs = typeof c.rhs === 'object' ? { sheet: c.rhs.sheets[0]!.id, row: c.rhs.firstRow + row - c.lhs.firstRow, column: c.rhs.firstColumn + column - c.lhs.firstColumn } : c.rhs;
      this.parts.push({ relation: c.relation, lhs, rhs });
      let index = indexes.get(addressKey(lhs));
      const cell = this.cell(this.book, lhs);
      if (index === undefined && cell?.formula) {
        const parsed = parseExpression(cell.formula, { position: lhs, workbook: this.book, signal: context.signal, maximumLength: context.limits.inputBytes });
        if (parsed.ok && parsed.document.root.kind === 'reference') {
          const r = localReferenceRange(this.book, parsed.document.root, lhs);
          if (r?.sheets.length === 1 && r.firstRow === r.lastRow && r.firstColumn === r.lastColumn) index = indexes.get(addressKey({ sheet: r.sheets[0]!.id, row: r.firstRow, column: r.firstColumn }));
        }
      }
      if (index === undefined) continue;
      const right = typeof rhs === 'object' ? this.cell(this.book, rhs) : undefined;
      if (right?.formula) continue;
      // Released cell_is_constant(NULL,&cr) replaces numeric RHS with zero.
      const limit = right?.value.kind === 'number' ? right.value.value : 0;
      if (c.relation === 16) { this.lower[index] = Math.max(this.lower[index]!, 0); this.upper[index] = Math.min(this.upper[index]!, 1); }
      if (c.relation === 1 || c.relation === 4) this.upper[index] = Math.min(this.upper[index]!, limit);
      if (c.relation === 2 || c.relation === 4) this.lower[index] = Math.max(this.lower[index]!, limit);
    }
    for (let i = 0; i < model.variables.length; i++) if (model.domains[i] !== 'continuous') { this.lower[i] = Math.ceil(this.lower[i]!); this.upper[i] = Math.floor(this.upper[i]!); }
  }
  cell(book: Workbook, address: SolverAddress) { return book.sheets.find(s => s.id === address.sheet)?.cells.find(c => c.row === address.row && c.column === address.column); }
  apply(solution: readonly number[] | undefined): Workbook {
    this.budget.tick(this.book.sheets.reduce((n, s) => n + s.cells.length, 0) + this.model.variables.length);
    const values = new Map(this.model.variables.map((v, i) => [addressKey(v), solution?.[i]]));
    const changed: Workbook = { ...this.book, sheets: this.book.sheets.map(s => {
      const cells = new Map(s.cells.map(c => [`${c.row}:${c.column}`, c]));
      for (const v of this.model.variables) if (v.sheet === s.id) {
        const old = cells.get(`${v.row}:${v.column}`), number = values.get(addressKey(v));
        const value: CellValue = number === undefined ? { kind: 'error', value: '#N/A' } : { kind: 'number', value: number };
        cells.set(`${v.row}:${v.column}`, { ...old, row: v.row, column: v.column, value });
      }
      return { ...s, cells: [...cells.values()] };
    }) };
    return recalculateWorkbook(changed, this.context, true);
  }
  value(book: Workbook, address: SolverAddress | number | undefined): number {
    this.budget.tick();
    if (typeof address === 'number' || address === undefined) return address ?? 0;
    const v = this.cell(book, address)?.value;
    return !v || v.kind === 'blank' ? 0 : v.kind === 'number' ? v.value : NaN;
  }
  feasible(book: Workbook, solution: readonly number[]): boolean {
    for (let i = 0; i < solution.length; i++) { this.budget.tick(); if (solution[i]! < this.lower[i]! || solution[i]! > this.upper[i]!) return false; }
    for (const p of this.parts) {
      const l = this.value(book, p.lhs), r = this.value(book, p.rhs);
      if (!Number.isFinite(l) || (p.relation < 8 && !Number.isFinite(r))) return false;
      if (p.relation === 1 && l > r || p.relation === 2 && l < r || p.relation === 4 && l !== r) return false;
    }
    return true;
  }
  linearize(): { rows: LinearRow[]; objective: number[] } {
    const n = this.model.variables.length;
    this.budget.tick(this.parts.length + n);
    let addressCount = 1, rowCount = 0;
    for (const part of this.parts) if (part.relation < 8) { addressCount += 2; rowCount += part.relation === 4 ? 2 : 1; }
    for (const domain of this.model.domains) { if (domain === 'binary') rowCount++; if (this.model.options.nonnegative || domain === 'binary') rowCount++; }
    // Admit columns, affine rows and output coefficients before any evaluation.
    this.budget.tick(n * (addressCount * 2 + rowCount) + addressCount * 2 + n);
    const origin = this.lower.map((lo, i) => lo === this.upper[i] ? lo : lo <= 0 && this.upper[i]! >= 0 ? 0 : Number.isFinite(lo) ? lo : this.upper[i]!);
    if (origin.some(v => !Number.isFinite(v))) throw new SsconvertError('invalid-request', 'Target cell did not evaluate to a number.');
    const baseline = this.apply(origin);
    const addresses = [this.model.target!, ...this.parts.filter(p => p.relation < 8).flatMap(p => [p.lhs, p.rhs])];
    const constants = addresses.map(a => this.value(baseline, a));
    const columns: number[][] = [];
    for (let i = 0; i < n; i++) {
      const lo = this.lower[i]!, hi = this.upper[i]!, start = origin[i]!;
      const end = lo === hi ? start : this.model.domains[i] !== 'continuous' && hi - lo === 1 ? hi : start + 1 <= hi ? start + 1 : start - 1 >= hi ? start - 1 : start !== hi ? (start + hi) / 2 : (start + lo) / 2;
      const dx = end - start;
      if (!(dx > 0)) { columns.push(addresses.map(() => 0)); continue; }
      const coords = [...origin]; coords[i] = end;
      const evaluated = this.apply(coords);
      columns.push(addresses.map((a, j) => (this.value(evaluated, a) - constants[j]!) / dx));
    }
    const affine = addresses.map((_, j) => ({ coefficients: columns.map(c => c[j]!), constant: constants[j]! - columns.reduce((sum, c, i) => sum + c[j]! * origin[i]!, 0) }));
    if (affine.some(a => !Number.isFinite(a.constant) || a.coefficients.some(c => !Number.isFinite(c)))) throw new SsconvertError('invalid-request', 'Target cell did not evaluate to a number.');
    const rows: LinearRow[] = [];
    let j = 1;
    for (const p of this.parts) if (p.relation < 8) {
      const l = affine[j++]!, r = affine[j++]!;
      const coefficients = l.coefficients.map((v, i) => v - r.coefficients[i]!), upper = r.constant - l.constant;
      if (p.relation === 1 || p.relation === 4) rows.push({ coefficients, upper });
      if (p.relation === 2 || p.relation === 4) rows.push({ coefficients: coefficients.map(v => -v), upper: -upper });
    }
    for (let i = 0; i < n; i++) {
      const coefficients = Array.from({ length: n }, (_, j) => i === j ? 1 : 0);
      if (this.model.domains[i] === 'binary') rows.push({ coefficients, upper: 1 });
      if (this.model.options.nonnegative || this.model.domains[i] === 'binary') rows.push({ coefficients: coefficients.map(v => -v), upper: 0 });
    }
    return { rows, objective: affine[0]!.coefficients.map(v => this.model.objective === 'minimize' ? -v : v) };
  }
}

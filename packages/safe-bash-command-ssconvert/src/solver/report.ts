// Gnumeric 1.12.61 src/tools/gnm-solver.c program report, GPL-2.0-or-later.
import { formatA1, snapshotWorkbook, type Cell, type ImportedValue, type Workbook } from '../workbook.js';
import { quoteNativeSheet } from '../formulas/serialization.js';
import type { SolverAddress } from './model.js';
import type { SolverProgram } from './program.js';
import type { Sensitivity } from './sensitivity.js';
export function createProgramReport(program: SolverProgram, book: Workbook, solution: readonly number[], quality: 'Optimal' | 'Feasible' | undefined, reportedValue?: number): Workbook {
  const { model, budget } = program;
  const cells: Cell[] = [];
  let row = 0;
  const put = (column: number, value: string | number, style?: Record<string, ImportedValue>) => {
    budget.tick();
    const special = typeof value === 'number' && !Number.isFinite(value);
    cells.push({ row, column, value: typeof value === 'number' && !special ? { kind: 'number', value } : { kind: 'string', value: special ? '-' : String(value) }, ...(style || special ? { style: { ...(special ? { horizontalAlignment: 'center', verticalAlignment: 'top' } : {}), ...style } } : {}) });
  };
  const name = (v: SolverAddress) => `${v.sheet === model.sheet ? '' : `${quoteNativeSheet(book.sheets.find(s => s.id === v.sheet)!.name)}!`}${formatA1(v.row, v.column)}`;
  const header = (text: string) => { put(0, text, { bold: true }); row++; };
  header('Target');
  ['Cell', 'Value', 'Type', 'Status'].forEach((v, i) => put(i + 1, v)); row++;
  put(1, name(model.target!)); put(2, reportedValue ?? program.value(book, model.target)); put(3, model.objective === 'minimize' ? 'Minimize' : 'Maximize'); if (quality) put(4, quality); row += 2;
  if (model.variables.length) {
    header('Variables'); ['Cell', 'Value', 'Lower', 'Upper', 'Slack'].forEach((v, i) => put(i + 1, v)); row++;
    model.variables.forEach((v, i) => {
      const s = solution[i]!, l = program.lower[i]!, h = program.upper[i]!, slack = Math.min(s - l, h - s);
      put(1, name(v)); put(2, s); put(3, l); put(4, h); put(5, slack, slack < 0 ? { fontColor: '#FF0000' } : undefined);
      const at = (limit: number) => Number.isFinite(limit) ? Math.abs(s - limit) <= (Math.abs(s) + Math.abs(limit)) / 1e10 : s === limit;
      if (at(l) || at(h)) put(6, 'At limit');
      if (s < l || s > h) put(7, 'Outside bounds', { fontColor: '#FF0000' });
      row++;
    }); row++;
  }
  header('Constraints');
  if (program.parts.length) ['Condition', 'Value', 'Limit', 'Slack'].forEach((v, i) => put(i + 1, v)); else put(1, 'No constraints'); row++;
  for (const p of program.parts) {
    const l = program.value(book, p.lhs), r = program.value(book, p.rhs);
    const operator = p.relation === 1 ? '≤' : p.relation === 2 ? '≥' : '=';
    const rhs = p.relation === 8 ? 'Int' : p.relation === 16 ? 'Bool' : typeof p.rhs === 'object' ? name(p.rhs) : String(p.rhs ?? 0);
    put(1, p.relation >= 8 ? `${formatA1(p.lhs.row, p.lhs.column)} ${rhs}` : `${formatA1(p.lhs.row, p.lhs.column)} ${operator} ${typeof p.rhs === 'object' ? formatA1(p.rhs.row, p.rhs.column) : 'ERROR'}`); put(2, l);
    if (typeof p.rhs === 'object') put(3, r);
    const slack = p.relation === 1 ? r - l : p.relation === 2 ? l - r : p.relation === 4 ? -Math.abs(l - r) : -Math.abs(l - (p.relation === 16 ? Number(l > 0.5) : Math.round(l)));
    put(4, slack, slack < 0 ? { fontColor: '#FF0000' } : undefined); row++;
  }
  // dao_prepare_output allocates a unique report title and focuses it.
  let serial = 1;
  while (book.sheets.some(s => s.name.toLowerCase() === `Solver (${serial})`.toLowerCase() || s.id === `solver-report-${serial}`)) { budget.tick(); serial++; }
  const report = { id: `solver-report-${serial}`, name: `Solver (${serial})`, cells, ...(book.sheets.find(s => s.id === model.sheet)?.size ? { size: book.sheets.find(s => s.id === model.sheet)!.size! } : {}) };
  return snapshotWorkbook({ ...book, sheets: [...book.sheets, report], activeSheet: report.id }, program.context.limits);
}

export function createSensitivityReport(program: SolverProgram, book: Workbook, solution: readonly number[], sensitivity: Sensitivity, algorithm: 'glpk' | 'lpsolve' = 'glpk'): Workbook {
  const objectiveSign = program.model.objective === 'minimize' ? -1 : 1;
  const cells: Cell[] = [];
  let row = 0;
  const put = (column: number, value: string | number, style?: Record<string, ImportedValue>) => {
    program.budget.tick();
    const special = typeof value === 'number' && !Number.isFinite(value);
    cells.push({ row, column, value: typeof value === 'number' && !special ? { kind: 'number', value } : { kind: 'string', value: special ? '-' : String(value) }, ...(style || special ? { style: { ...(special ? { horizontalAlignment: 'center', verticalAlignment: 'top' } : {}), ...style } } : {}) });
  };
  const header = (title: string) => { put(0, title, { bold: true }); row++; };
  const headingStyle = { horizontalAlignment: 'center', verticalAlignment: 'bottom' };
  if (solution.length) {
    header('Variables');
    ['Cell', 'Final\nValue', 'Reduced\nCost', 'Lower\nLimit', 'Upper\nLimit'].forEach((v, i) => put(i + 1, v, headingStyle)); row++;
    program.model.variables.forEach((v, i) => {
      const normalized = sensitivity.variables[i]!;
      const entry = objectiveSign === 1 ? normalized : { low: -normalized.high, high: -normalized.low, shadow: -normalized.shadow };
      put(1, formatA1(v.row, v.column)); put(2, solution[i]!); put(3, algorithm === 'glpk' ? NaN : entry.shadow);
      // GLPK human-report parser accepts only lines with both finite break points.
      put(4, algorithm === 'lpsolve' || Number.isFinite(entry.low) && Number.isFinite(entry.high) ? entry.low : NaN);
      put(5, algorithm === 'lpsolve' || Number.isFinite(entry.low) && Number.isFinite(entry.high) ? entry.high : NaN); row++;
    }); row++;
  }
  header('Constraints');
  if (program.parts.length) ['Constraint', 'Shadow\nPrice', 'Constraint\nLHS', 'Constraint\nRHS', 'Lower\nLimit', 'Upper\nLimit'].forEach((v, i) => put(i + 1, v, headingStyle)); else put(1, 'No constraints'); row++;
  let partIndex = 0;
  program.budget.tick(program.parts.length);
  const ordinaryParts = program.parts.filter(p => p.relation < 8);
  for (const constraint of program.model.constraints) {
    const count = constraint.lhs ? (constraint.lhs.lastRow - constraint.lhs.firstRow + 1) * (constraint.lhs.lastColumn - constraint.lhs.firstColumn + 1) : 0;
    for (let i = 0; i < count; i++) {
      const part = program.parts[partIndex++]!;
      if (part.relation >= 8) continue;
      // Released create_sensitivity_report resets cidx for each constraint.
      const normalized = sensitivity.constraints[i] ?? { shadow: NaN, low: NaN, high: NaN };
      const direction = ordinaryParts[i]?.relation === 2 ? -1 : 1;
      const entry = { low: direction === 1 ? normalized.low : -normalized.high, high: direction === 1 ? normalized.high : -normalized.low, shadow: normalized.shadow * objectiveSign * direction };
      const lhs = formatA1(part.lhs.row, part.lhs.column), rhs = typeof part.rhs === 'object' ? formatA1(part.rhs.row, part.rhs.column) : 'ERROR';
      put(1, `${lhs} ${part.relation === 1 ? '≤' : part.relation === 2 ? '≥' : '='} ${rhs}`);
      put(2, entry.shadow); put(3, program.value(book, part.lhs)); put(4, program.value(book, part.rhs));
      put(5, algorithm === 'lpsolve' || Number.isFinite(entry.low) && Number.isFinite(entry.high) ? entry.low : NaN);
      put(6, algorithm === 'lpsolve' || Number.isFinite(entry.low) && Number.isFinite(entry.high) ? entry.high : NaN); row++;
    }
  }
  let serial = 1;
  while (book.sheets.some(s => s.name.toLowerCase() === `Solver (${serial})`.toLowerCase() || s.id === `solver-report-${serial}`)) { program.budget.tick(); serial++; }
  const report = { id: `solver-report-${serial}`, name: `Solver (${serial})`, cells, ...(book.sheets.find(s => s.id === program.model.sheet)?.size ? { size: book.sheets.find(s => s.id === program.model.sheet)!.size! } : {}) };
  return snapshotWorkbook({ ...book, sheets: [...book.sheets, report], activeSheet: report.id }, program.context.limits);
}

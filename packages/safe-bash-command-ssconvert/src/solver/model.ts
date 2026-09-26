// Gnumeric 1.12.61 src/tools/gnm-solver.c and src/xml-sax-read.c,
// GPL-2.0-or-later. Geometry and validation only; no native solver fallback.
import { SsconvertError, type CapabilityContext } from '../contracts.js';
import { DEFAULT_SHEET_SIZE, formatA1, snapshotWorkbook, type Workbook, type ImportedValue } from '../workbook.js';
import { matchNumber } from '../formulas/functions/text.js';
import { quoteNativeSheet } from '../formulas/serialization.js';
import { parseExpression } from '../formulas/parser.js';
import { localReferenceRange } from '../formulas/local-references.js';
import type { CalculationRange } from '../formulas/dependencies.js';
import { recalculateWorkbook } from '../formulas/evaluator.js';
export type SolverModelType = 'linear' | 'quadratic' | 'nonlinear' | 'unknown';
export interface SolverAddress { readonly sheet: string; readonly row: number; readonly column: number }
export type SolverRelation = 1 | 2 | 4 | 8 | 16;
export interface SolverConstraint { readonly relation: SolverRelation; readonly lhs?: CalculationRange | undefined; readonly rhs?: CalculationRange | number | undefined }
export interface SolverParameters {
  readonly sheet: string;
  readonly objective: 'minimize' | 'maximize' | 'unknown';
  readonly target?: SolverAddress | undefined;
  readonly inputs?: CalculationRange | undefined;
  readonly variables: readonly SolverAddress[];
  readonly domains: readonly ('continuous' | 'integer' | 'binary')[];
  readonly constraints: readonly SolverConstraint[];
  readonly modelType: SolverModelType;
  readonly options: { readonly maximumIterations: number; readonly maximumTimeSeconds: number;
    readonly nonnegative: boolean; readonly discrete: boolean; readonly automaticScaling: boolean;
    readonly programReport: boolean; readonly sensitivityReport: boolean; readonly gradientOrder: number; readonly scenarioName: string; readonly addScenario: boolean };
}
export interface SolverAlgorithm { readonly id: string; readonly modelType: SolverModelType; readonly available: boolean }
interface RecordNode { readonly attributes?: readonly { readonly name: string; readonly value: string }[]; readonly children?: readonly ImportedValue[] }
function record(value?: ImportedValue): RecordNode {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as RecordNode : {};
}
export function loadSolverParameters(book: Workbook, context: CapabilityContext): SolverParameters {
  context.signal.throwIfAborted();
  book = snapshotWorkbook(book, context.limits);
  const sheet = book.sheets.find(s => s.id === book.activeSheet) ?? book.sheets[0];
  if (!sheet) throw new SsconvertError('invalid-request', 'Invalid solver target');
  const raw = record(sheet.unsupportedRecords?.find(r => r.kind === 'Solver' && r.disposition === 'retained')?.data);
  const attrs = (n: RecordNode) => Object.fromEntries(n.attributes?.map(a => [a.name, a.value]) ?? []);
  const a = attrs(raw), maximum = context.limits.workbookWork ?? context.limits.inputBytes + context.limits.cells * 32;
  let work = 0;
  const tick = () => { context.signal.throwIfAborted(); if (++work > maximum) throw new SsconvertError('resource-limit', 'ssconvert workbook work limit exceeded'); };
  // Captured Linux ARM64 profile: strtol is signed 64-bit, then assigned to int.
  // Failed attributes leave the constructor value intact; empty text is zero.
  const integer = (text: string | undefined): number | undefined => {
    if (text === undefined) return undefined;
    if (text.length > context.limits.inputBytes) throw new SsconvertError('resource-limit', 'ssconvert formula length limit exceeded');
    if (text === '') return 0;
    let i = 0;
    while (i < text.length && ' \t\n\r\v\f'.includes(text[i]!)) { tick(); i++; }
    const negative = text[i] === '-';
    if (text[i] === '+' || negative) { tick(); i++; }
    if (i === text.length) return undefined;
    let value = 0n;
    const bound = negative ? 9223372036854775808n : 9223372036854775807n;
    for (; i < text.length; i++) {
      tick();
      if (text[i]! < '0' || text[i]! > '9') return undefined;
      value = value * 10n + BigInt(text.charCodeAt(i) - 48);
      if (value > bound) return undefined;
    }
    return Number(BigInt.asIntN(32, negative ? -value : value));
  };
  const side = (text?: string, numeric = false): CalculationRange | number | undefined => {
    while (text !== undefined) {
      tick();
      if (text.length > context.limits.inputBytes) throw new SsconvertError('resource-limit', 'ssconvert formula length limit exceeded');
      if (numeric) {
        for (let i = 0; i < text.length; i++) tick();
        const matched = matchNumber(text, { context, book, tick });
        if (typeof matched === 'number') return matched;
      }
      const parsed = parseExpression(text, { position: { sheet: sheet.id, row: 0, column: 0 }, workbook: book, signal: context.signal, maximumNodes: maximum - work, maximumLength: context.limits.inputBytes });
      if (!parsed.ok) return undefined;
      let root = parsed.document.root;
      while (root.kind === 'parentheses') { tick(); root = root.child; }
      if (root.kind === 'reference') {
        const range = localReferenceRange(book, root, { sheet: sheet.id, row: 0, column: 0 });
        return range?.sheets.length === 1 ? range : undefined;
      }
      // Native XML names have empty placeholders until handle_delayed_names.
      return undefined;
    }
    return undefined;
  };
  const range = (text?: string, numeric = false) => { const v = side(text, numeric); return typeof v === 'object' ? v : undefined; };
  const inputs = range(a.Inputs), variables: SolverAddress[] = [];
  if (inputs) for (let row = inputs.firstRow; row <= inputs.lastRow; row++) for (let column = inputs.firstColumn; column <= inputs.lastColumn; column++) {
    tick(); if (variables.length >= context.limits.cells) throw new SsconvertError('resource-limit', 'ssconvert cells limit exceeded');
    variables.push({ sheet: inputs.sheets[0]!.id, row, column });
  }
  const size = sheet.size ?? DEFAULT_SHEET_SIZE, row = integer(a.TargetRow) ?? -1, column = integer(a.TargetCol) ?? -1;
  const targetRange = range(a.Target), legacy = a.TargetCol !== undefined && a.TargetRow !== undefined && Number.isInteger(row) && Number.isInteger(column) && row >= 0 && row < size.rows && column >= 0 && column < size.columns ? range(formatA1(row, column, size)) : undefined;
  const t = legacy ?? targetRange;
  const target = t && t.firstRow === t.lastRow && t.firstColumn === t.lastColumn ? { sheet: t.sheets[0]!.id, row: t.firstRow, column: t.firstColumn } : undefined;
  const constraints = (raw.children ?? []).map(value => {
    tick(); const c = attrs(record(value)), type = integer(c.Type), relation: SolverRelation = type === 2 || type === 4 || type === 8 || type === 16 ? type : 1;
    const old = Object.fromEntries(['Lcol', 'Lrow', 'Rcol', 'Rrow', 'Cols', 'Rows'].map(key => [key, integer(c[key])]));
    if (Object.values(old).some(value => value !== undefined)) {
      const columns = old.Cols ?? 1, rows = old.Rows ?? 1;
      const rectangle = (col: number, row: number): CalculationRange | undefined => {
        const lastColumn = col + columns - 1, lastRow = row + rows - 1;
        if (![col, row, lastColumn, lastRow].every(Number.isInteger) || Math.min(col, lastColumn, row, lastRow) < 0 || Math.max(col, lastColumn) >= size.columns || Math.max(row, lastRow) >= size.rows) return undefined;
        return { sheets: [sheet], firstColumn: Math.min(col, lastColumn), lastColumn: Math.max(col, lastColumn), firstRow: Math.min(row, lastRow), lastRow: Math.max(row, lastRow) };
      };
      return { relation, lhs: rectangle(old.Lcol ?? 0, old.Lrow ?? 0), rhs: [1, 2, 4].includes(relation) ? rectangle(old.Rcol ?? 0, old.Rrow ?? 0) : undefined };
    }
    return { relation, lhs: range(c.lhs, true), rhs: side(c.rhs, true) };
  });
  const booleanOption = (value: string | undefined, fallback = false) => value === undefined ? fallback : value !== '0' && value.toLowerCase() !== 'false';
  const discrete = booleanOption(a.Discr), maximumIterations = (integer(a.MaxIter) ?? 1000) >>> 0;
  const domains = variables.map(v => {
    const contained = (c: SolverConstraint) => { return c.lhs?.sheets[0]?.id === v.sheet && v.row >= c.lhs.firstRow && v.row <= c.lhs.lastRow && v.column >= c.lhs.firstColumn && v.column <= c.lhs.lastColumn; };
    return constraints.some(c => { tick(); return c.relation === 16 && contained(c); }) ? 'binary' as const : discrete || constraints.some(c => { tick(); return c.relation === 8 && contained(c); }) ? 'integer' as const : 'continuous' as const;
  });
  const problemType = integer(a.ProblemType) ?? 0, modelType = integer(a.ModelType) ?? 0;
  return { sheet: sheet.id, target, inputs, variables, domains, constraints,
    objective: problemType === 0 ? 'minimize' : problemType === 1 ? 'maximize' : 'unknown',
    modelType: modelType === 0 ? 'linear' : modelType === 1 ? 'quadratic' : modelType === 2 ? 'nonlinear' : 'unknown',
    options: { maximumIterations, maximumTimeSeconds: integer(a.MaxTime) ?? 60, nonnegative: booleanOption(a.NonNeg, true), discrete, automaticScaling: booleanOption(a.AutoScale), programReport: booleanOption(a.ProgramR), sensitivityReport: booleanOption(a.SensitivityR), gradientOrder: 10, scenarioName: 'Optimal', addScenario: false } };
}
export function validateSolverParameters(book: Workbook, model: SolverParameters, context: CapabilityContext): string | undefined {
  context.signal.throwIfAborted();
  const cell = (b: Workbook, v: SolverAddress) => b.sheets.find(s => s.id === v.sheet)?.cells.find(c => c.row === v.row && c.column === v.column);
  const name = (v: SolverAddress) => `${v.sheet === model.sheet ? '' : `${quoteNativeSheet(book.sheets.find(s => s.id === v.sheet)!.name)}!`}${formatA1(v.row, v.column)}`;
  if (!model.target || !cell(book, model.target)) return 'Invalid solver target';
  const target = cell(book, model.target), address = model.target;
  const targetExpression = target?.formula ?? book.sheets.find(s => s.id === address.sheet)?.formulaGroups?.find(g =>
    address.row >= g.range.startRow && address.row <= g.range.endRow && address.column >= g.range.startColumn && address.column <= g.range.endColumn)?.expression;
  if (!targetExpression) return `Target cell, ${name(model.target)}, must contain a formula that evaluates to a number`;
  const calculated = recalculateWorkbook(book, context, true);
  if (cell(calculated, model.target)?.value.kind !== 'number') return `Target cell, ${name(model.target)}, must contain a formula that evaluates to a number`;
  if (!model.inputs) return 'Invalid solver input range';
  for (const v of model.variables) { context.signal.throwIfAborted(); if (cell(calculated, v)?.formula) return `Input cell ${name(v)} contains a formula`; }
  for (const [i, c] of model.constraints.entries()) {
    context.signal.throwIfAborted();
    const l = c.lhs, r = c.rhs, input = model.inputs;
    const rhsValid = typeof r === 'number' || r && l && r.lastRow - r.firstRow === l.lastRow - l.firstRow && r.lastColumn - r.firstColumn === l.lastColumn - l.firstColumn;
    const domainValid = l && l.sheets[0]!.id === input.sheets[0]!.id && l.firstRow >= input.firstRow && l.lastRow <= input.lastRow && l.firstColumn >= input.firstColumn && l.lastColumn <= input.lastColumn;
    if (!l || [1, 2, 4].includes(c.relation) && !rhsValid || [8, 16].includes(c.relation) && !domainValid) return `Solver constraint #${i + 1} is invalid`;
  }
  return undefined;
}
/** Registry order is explicit; functional saved choices need not match model type. */
export function selectSolverAlgorithm(model: SolverParameters, registry: readonly SolverAlgorithm[], savedId?: string): SolverAlgorithm | undefined {
  return registry.find(a => a.id === savedId && a.available) ?? registry.find(a => a.available && a.modelType === model.modelType);
}

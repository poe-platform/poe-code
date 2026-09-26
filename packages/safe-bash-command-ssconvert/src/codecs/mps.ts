// Gnumeric 1.12.61 plugins/mps/mps.c, Copyright 2009 Morten Welinder.
// Adapted under GPL-2.0-or-later; native MPS quirks are intentional.
import { SsconvertError, type CapabilityContext } from '../contracts.js';
import { type Cell, type ImportedValue, type Workbook } from '../workbook.js';
import { recalculateWorkbook } from '../formulas/evaluator.js';

export function solverRecord(attributes: Record<string, string>, children: readonly ImportedValue[] = []): ImportedValue {
  return { name: 'Solver', namespace: 'http://www.gnumeric.org/v10.dtd', text: '',
    attributes: Object.entries(attributes).map(([name, value]) => ({ name, namespace: '', value })), children };
}
export function constraintRecord(type: number, lhs: string, rhs?: string): ImportedValue {
  return { name: 'Constr', namespace: 'http://www.gnumeric.org/v10.dtd', text: '', attributes:
    Object.entries({ Type: String(type), lhs, ...(rhs === undefined ? {} : { rhs }) }).map(([name, value]) => ({ name, namespace: '', value })), children: [] };
}
const white = (c: string) => ' \t\r\n\v\f'.includes(c);
function tokens(line: string): string[] {
  const result: string[] = []; let start = 0;
  while (start < line.length) {
    while (start < line.length && white(line[start]!)) start++;
    let end = start; while (end < line.length && !white(line[end]!)) end++;
    if (end > start) result.push(line.slice(start, end)); start = end;
  }
  return result;
}
function* lines(text: string): Generator<string> {
  let start = 0;
  for (let end = 0; end < text.length; end++) {
    if (text[end] !== '\r' && text[end] !== '\n') continue;
    yield text.slice(start, end);
    if (text[end] === '\r' && text[end + 1] === '\n') end++;
    start = end + 1;
  }
  if (start < text.length) yield text.slice(start);
}
interface Row { name: string; type: number; expr: string; rhs: number; range: number; previous?: boolean }
export async function readMps(bytes: Uint8Array, context: CapabilityContext): Promise<Workbook> {
  context.signal.throwIfAborted();
  if (bytes.length > context.limits.inputBytes) throw new SsconvertError('resource-limit', 'ssconvert input bytes limit exceeded');
  const cells = new Map<string, Cell>(), rows: Row[] = [], rowNames = new Map<string, Row>(), columns = new Map<string, number>();
  let objective: Row | undefined, section = '', seenRows = false, integer = false, current: number | undefined, work = 0;
  const maximum = context.limits.workbookWork ?? context.limits.inputBytes + context.limits.cells * 32;
  const tick = () => { context.signal.throwIfAborted(); if (++work > maximum) throw new SsconvertError('resource-limit', 'ssconvert workbook work limit exceeded'); };
  const fail = (message: string): never => { throw new SsconvertError('io', `E Error while reading MPS file.\n  E ${message}`); };
  const put = (row: number, column: number, value: string | number, formula?: string) => {
    tick(); const key = `${row}:${column}`;
    if (!cells.has(key) && cells.size >= context.limits.cells) throw new SsconvertError('resource-limit', 'ssconvert cells limit exceeded');
    cells.set(key, { row, column, ...(row === 8 || column === 0 && [0, 4].includes(row) ? { style: { bold: true, italic: false, underline: 0 } } : {}), value: typeof value === 'number' ? { kind: 'number', value } : { kind: 'string', value }, ...(formula ? { formula } : {}) });
  };
  for (const line of lines(new TextDecoder().decode(bytes))) {
    tick(); if (!line || line[0] === '*') continue;
    if (!white(line[0]!)) {
      if (section === 'ROWS' && !objective) fail('Missing objective row');
      section = tokens(line)[0] ?? ''; if (section === 'ROWS') seenRows = true; if (section === 'ENDATA') break;
      if (section === 'NAME') { put(0, 0, 'Program Name'); const name = line.slice(4).trimStart().split('\r')[0]!; if (name) put(1, 0, name); }
      continue;
    }
    const t = tokens(line);
    if (section === 'ROWS') {
      if (t.length < 2) fail('Invalid line in ROWS section');
      const type = t[0]!, name = t[1]!;
      if (rowNames.has(name)) fail(`Duplicate row name ${name}`);
      if (!['E', 'L', 'G', 'N'].includes(type)) fail(`Invalid row type ${type}`);
      const row: Row = { name, type: { E: 4, L: 1, G: 2, N: 0 }[type]!, expr: '', rhs: 0, range: 0 };
      rowNames.set(name, row);
      if (type === 'N') { if (objective) fail('Duplicate objective row'); objective = row; } else rows.push(row);
    } else if (section === 'COLUMNS') {
      if (t.length === 3 && t[1] === "'MARKER'") {
        if (!["'INTORG'", "'INTEND'"].includes(t[2]!)) fail('Invalid marker'); integer = t[2] === "'INTORG'"; continue;
      }
      if (t.length % 2) {
        const name = t[0]!; current = columns.get(name);
        if (current === undefined) { current = 9 + columns.size; columns.set(name, current); put(current, 0, name);
          if (integer) rows.push({ name, type: 8, expr: `$B$${current + 1}`, rhs: 0, range: 0 }); }
      }
      if (current === undefined) current = 9 + columns.size;
      for (let i = t.length % 2; i < t.length; i += 2) {
        tick(); const row = rowNames.get(t[i]!) ?? fail(`Invalid row name, ${t[i]}, in columns`);
        const v = Number.parseFloat(t[i + 1]!) || 0; if (!v) continue;
        const ref = `$B$${current + 1}`, magnitude = row.expr ? Math.abs(v) : v;
        const expr = Math.abs(magnitude) === 1 ? (magnitude < 0 ? '-' : '') + ref : `${magnitude}*${ref}`;
        row.expr += row.expr ? (v < 0 ? '-' : '+') + expr : expr;
      }
    } else if (section === 'RHS' || section === 'RANGES') {
      for (let i = t.length % 2; i < t.length; i += 2) {
        tick(); const row = rowNames.get(t[i]!) ?? fail(`Invalid row name, ${t[i]}, in rhs/ranges section`);
        const v = Number.parseFloat(t[i + 1]!) || 0; if (section === 'RHS') row.rhs += v; else row.range += v;
      }
    } else if (section === 'BOUNDS') {
      const bt = t[0] ?? '?'; if (['FR', 'PL', 'MI'].includes(bt)) continue;
      const type = { UP: 1, UI: 1, LO: 2, LI: 2, FX: 4, BV: 16 }[bt] ?? fail(`Invalid bounds type ${bt}`);
      for (let i = 2 - t.length % 2; i + 1 < t.length; i += 2) {
        tick(); const name = t[i]!, row = columns.get(name) ?? fail(`Invalid column name, ${name}, in bounds`);
        const expr = `$B$${row + 1}`;
        rows.push({ name, type, expr, rhs: Number.parseFloat(t[i + 1]!) || 0, range: 0 });
        if (['UI', 'LI', 'BV'].includes(bt)) rows.push({ name, type: 8, expr, rhs: 0, range: 0 });
      }
    }
    if (rows.length > context.limits.cells || columns.size > context.limits.cells) throw new SsconvertError('resource-limit', 'ssconvert cells limit exceeded');
  }
  if (seenRows && !objective) fail('Missing objective row');
  const constraints: ImportedValue[] = [];
  let y = 8;
  const make = (row: Row, type: number, rhs: number) => {
    const lhs = row.previous ? `E${y}` : row.expr;
    put(y, 3, row.name); put(y, 4, 0, lhs ? '=' + lhs : undefined); put(y, 5, { 1: '≤', 2: '≥', 4: '=', 8: 'Int', 16: 'Bool' }[type]!);
    if (type === 8 || type === 16) constraints.push(constraintRecord(type, lhs));
    else { put(y, 6, rhs); constraints.push(constraintRecord(type, `$E$${y + 1}`, `$G$${y + 1}`)); }
    row.previous = true; // Next make_constraint uses relative row -1.
  };
  for (const row of rows) {
    tick(); y++;
    if (row.type === 1 && row.range) { make(row, 2, row.rhs - Math.abs(row.range)); y++; }
    if (row.type === 4 && row.range) {
      make(row, 2, row.range > 0 ? row.rhs : row.rhs - Math.abs(row.range));
      make(row, 1, row.range > 0 ? row.rhs + Math.abs(row.range) : row.rhs);
    } else {
      make(row, row.type, row.rhs);
      if (row.type === 2 && row.range) { y++; make(row, 1, row.rhs + Math.abs(row.range)); }
    }
  }
  for (const [column, label] of [[0, 'Variable'], [1, 'Value'], [3, 'Constraint'], [4, 'Value'], [5, 'Type'], [6, 'Limit']] as const) put(8, column, label);
  if (objective) { put(4, 0, 'Objective function'); put(4, 1, 0, objective.expr ? '=' + objective.expr : undefined); }
  const data = solverRecord({ ...(objective ? { Target: '$B$5' } : {}), ModelType: '0', ProblemType: '0', Inputs: columns.size ? `B10:B${9 + columns.size}` : 'B9:B10',
    MaxTime: '60', MaxIter: '1000', NonNeg: '1', Discr: '0', AutoScale: '0', ProgramR: '0', SensitivityR: '0' }, constraints);
  return recalculateWorkbook({ sheets: [{ id: 's1', name: 'Sheet1', cells: [...cells.values()], unsupportedRecords:
    [{ source: 'Gnumeric_XmlIO:sax', kind: 'Solver', disposition: 'retained', data }] }], activeSheet: 's1', names: [
    { name: 'Print_Area', expression: '#REF!', sheet: 's1', position: { sheet: 's1', row: 0, column: 0 } },
    { name: 'Sheet_Title', expression: '"Sheet1"', sheet: 's1', position: { sheet: 's1', row: 0, column: 0 } }
  ] }, context, true);
}

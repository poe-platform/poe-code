// Adapted from Gnumeric 1.12.61 plugins/{glpk,lpsolve}/*-write.c and
// src/tools/gnm-solver.c, Copyright 2009 Morten Welinder, GPL-2.0-or-later.
import { SsconvertError, type CapabilityContext } from '../contracts.js';
import { formatA1, type ImportedValue, type Workbook } from '../workbook.js';
import { CodecWriteFailure } from './write-failure.js';
import { parseExpression } from '../formulas/parser.js';
import { localReferenceRange } from '../formulas/local-references.js';
import { recalculateWorkbook } from '../formulas/evaluator.js';

function modelNumber(value: number): string {
  if (value === 0) return '0';
  const [mantissa, exponentText] = value.toExponential().split('e');
  const exponent = Number(exponentText);
  return exponent < -4 || exponent >= 17 ? `${mantissa}e${exponent < 0 ? '-' : '+'}${String(Math.abs(exponent)).padStart(2, '0')}` : String(value);
}

type RecordNode = { name: string; attributes: readonly { name: string; value: string }[]; children: readonly RecordNode[] };
function node(value: ImportedValue | undefined): RecordNode | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  return value as unknown as RecordNode;
}
function attributes(n?: RecordNode): Record<string, string> {
  return Object.fromEntries(n?.attributes?.map(a => [a.name, a.value]) ?? []);
}
interface Address { sheet: string; row: number; column: number }
interface Part { type: number; lhs: Address | number; rhs: Address | number | undefined; index: number }
export async function writeModelProgram(book: Workbook, context: CapabilityContext, dialect: 'glpk' | 'lpsolve'): Promise<Uint8Array> {
  context.signal.throwIfAborted();
  const sheet = book.sheets.find(s => s.id === book.activeSheet) ?? book.sheets[0];
  if (!sheet) throw new SsconvertError('io', 'Invalid solver input range');
  const model = node(sheet.unsupportedRecords?.find(r => r.kind === 'Solver' && r.disposition === 'retained')?.data);
  const a = attributes(model), glpk = dialect === 'glpk';
  const fail = (message: string): never => { throw new SsconvertError('io', message); };
  if (Number(a.ModelType ?? 0) !== 0) throw new CodecWriteFailure(new Uint8Array(), 'E Only linear programs are handled.');
  const maximum = context.limits.workbookWork ?? context.limits.inputBytes + context.limits.cells * 32;
  let work = 0;
  const tick = (amount = 1) => { context.signal.throwIfAborted(); if ((work += amount) > maximum) throw new SsconvertError('resource-limit', 'ssconvert workbook work limit exceeded'); };
  const side = (text: string | undefined, resolveNames = true): (Address | number)[] => {
    if (text === undefined) return [];
    const parsed = parseExpression(text, { position: { sheet: sheet.id, row: 0, column: 0 }, workbook: book, signal: context.signal, maximumNodes: maximum - work, maximumLength: context.limits.inputBytes });
    if (!parsed.ok) return [];
    let root = parsed.document.root;
    if (root.kind === 'name') {
      if (!resolveNames) return [];
      const nameText = root.name;
      const name = book.names?.find(n => n.name.toLowerCase() === nameText.toLowerCase() && (!n.sheet || n.sheet === sheet.id));
      if (!name) return [];
      const resolved = parseExpression(name.expression, { position: { sheet: sheet.id, row: 0, column: 0 }, workbook: book, signal: context.signal, maximumNodes: maximum - work });
      if (!resolved.ok) return []; root = resolved.document.root;
    }
    if (root.kind === 'literal' && root.value.kind === 'number') return [root.value.value];
    if (root.kind === 'unary' && root.child.kind === 'literal' && root.child.value.kind === 'number') return [root.op === '-' ? -root.child.value.value : root.child.value.value];
    if (root.kind !== 'reference') return [];
    const range = localReferenceRange(book, root, { sheet: sheet.id, row: 0, column: 0 }); if (!range) return [];
    const count = range.sheets.length * (range.lastRow - range.firstRow + 1) * (range.lastColumn - range.firstColumn + 1);
    if (count > context.limits.cells) throw new SsconvertError('resource-limit', 'ssconvert cells limit exceeded');
    const result: Address[] = [];
    for (const s of range.sheets) for (let row = range.firstRow; row <= range.lastRow; row++) for (let column = range.firstColumn; column <= range.lastColumn; column++) {
      tick(); result.push({ sheet: s.id, row, column });
    }
    return result;
  };
  const variables = side(a.Inputs);
  const vars = variables.filter((v): v is Address => typeof v !== 'number');
  const key = (v: Address) => `${v.sheet}:${v.row}:${v.column}`;
  const indexes = new Map(vars.map((v, i) => [key(v), i]));
  if (indexes.size !== vars.length) fail('Invalid solver input range');
  const targets = side(a.Target, false);
  const candidate = targets.length === 1 && typeof targets[0] === 'object' ? targets[0] : undefined;
  // Native XML targets resolve immediately to singleton cell references,
  // before deferred names are registered. Input allocation can create a cell.
  const target = candidate && (indexes.has(key(candidate)) || book.sheets.find(s => s.id === candidate.sheet)?.cells.some(c => c.row === candidate.row && c.column === candidate.column)) ? candidate : undefined;
  const parts: Part[] = [];
  for (const c of model?.children ?? []) {
    tick(); const ca = attributes(c), type = Number(ca.Type), lhs = side(ca.lhs), rhs = side(ca.rhs);
    if (![1, 2, 4, 8, 16].includes(type) || !lhs.length || lhs.some(v => typeof v === 'number')) continue;
    if (type < 8 && (!rhs.length || (typeof rhs[0] !== 'number' && rhs.length !== lhs.length))) continue;
    if (type < 8 && typeof rhs[0] !== 'number') {
      const leftFirst = lhs[0] as Address, leftLast = lhs.at(-1) as Address;
      const rightFirst = rhs[0] as Address, rightLast = rhs.at(-1) as Address;
      if (leftLast.row - leftFirst.row !== rightLast.row - rightFirst.row ||
        leftLast.column - leftFirst.column !== rightLast.column - rightFirst.column) continue;
    }
    if (type >= 8 && lhs.some(v => !indexes.has(key(v as Address)))) continue;
    for (let i = 0; i < lhs.length; i++) {
      tick();
      parts.push({ type, lhs: lhs[i]!, rhs: rhs[rhs.length === 1 ? 0 : i], index: i });
    }
  }
  const nonnegative = a.NonNeg !== '0', discrete = vars.map(() => a.Discr === '1');
  const low = vars.map(() => nonnegative ? 0 : -Infinity), high = vars.map(() => Infinity);
  const cell = (address: Address) => book.sheets.find(s => s.id === address.sheet)?.cells.find(c => c.row === address.row && c.column === address.column);
  const variableIndex = (address: Address): number | undefined => {
    const direct = indexes.get(key(address)); if (direct !== undefined) return direct;
    const formula = cell(address)?.formula; if (!formula) return undefined;
    const parsed = parseExpression(formula, { position: address, workbook: book, signal: context.signal, maximumNodes: maximum - work });
    if (!parsed.ok || parsed.document.root.kind !== 'reference') return undefined;
    const range = localReferenceRange(book, parsed.document.root, address);
    if (!range || range.sheets.length !== 1 || range.firstRow !== range.lastRow || range.firstColumn !== range.lastColumn) return undefined;
    return indexes.get(key({ sheet: range.sheets[0]!.id, row: range.firstRow, column: range.firstColumn }));
  };
  for (const p of parts) {
    if (typeof p.lhs === 'number') continue;
    const i = variableIndex(p.lhs); if (i === undefined) continue;
    const rhsCell = typeof p.rhs === 'object' ? cell(p.rhs) : undefined;
    if (rhsCell?.formula) continue;
    // Native cell_is_constant resets a numeric RHS to zero when no RHS cell
    // exists. Preserve that coordinate-selection quirk without changing text.
    const rhs = !rhsCell || rhsCell.value.kind === 'blank' ? 0 : rhsCell.value.kind === 'number' ? rhsCell.value.value : NaN;
    if (!Number.isFinite(rhs)) continue;
    if (p.type >= 8) { discrete[i] = true; if (p.type === 16) { low[i] = Math.max(low[i]!, 0); high[i] = Math.min(high[i]!, 1); } }
    if (p.type === 1 || p.type === 4) high[i] = Math.min(high[i]!, rhs);
    if (p.type === 2 || p.type === 4) low[i] = Math.max(low[i]!, rhs);
  }
  for (let i = 0; i < vars.length; i++) if (discrete[i]) { low[i] = Math.ceil(low[i]!); high[i] = Math.floor(high[i]!); }
  const x1 = vars.map((_, i) => low[i] === high[i] || discrete[i] && high[i]! - low[i]! === 1 ? low[i]! : low[i]! <= 0 && high[i]! >= 0 ? 0 : Number.isFinite(low[i]) ? low[i]! : high[i]!);
  const x2 = x1.map((x, i) => low[i] === high[i] ? x : discrete[i] && high[i]! - low[i]! === 1 ? high[i]! : x + 1 <= high[i]! ? x + 1 : x - 1 >= high[i]! ? x - 1 : x !== high[i] ? (x + high[i]!) / 2 : (x + low[i]!) / 2);
  const name = (v: Address) => glpk ? `X_${(indexes.get(key(v)) ?? -1) + 1}` : formatA1(v.row, v.column);
  const evaluate = (address: Address, coords: readonly number[]): number => {
    tick(book.sheets.reduce((n, s) => n + s.cells.length, 0) + vars.length);
    const changed: Workbook = { ...book, sheets: book.sheets.map(s => {
      const cells = new Map(s.cells.map(c => [`${c.row}:${c.column}`, c]));
      vars.forEach((v, i) => { if (v.sheet === s.id) cells.set(`${v.row}:${v.column}`, { row: v.row, column: v.column, value: { kind: 'number', value: coords[i]! } }); });
      return { ...s, cells: [...cells.values()] };
    }) };
    const calculated = recalculateWorkbook(changed, { ...context, limits: { ...context.limits, workbookWork: maximum - work } }, true);
    const value = calculated.sheets.find(s => s.id === address.sheet)?.cells.find(c => c.row === address.row && c.column === address.column)?.value;
    const number = !value || value.kind === 'blank' ? 0 : value.kind === 'number' ? value.value : NaN;
    if (!Number.isFinite(number)) fail('Target cell did not evaluate to a number.'); return number;
  };
  const affine = (address: Address | number | undefined, zeros = false): string => {
    try {
    if (address === undefined || typeof address === 'number') return modelNumber(address ?? 0);
    // Native g_new(..., 0) yields NULL, so an empty coefficient vector emits
    // an empty expression even for an otherwise constant numeric target.
    if (!vars.length) return '';
    let constant = evaluate(address, x1); const initial = constant; let text = '';
    for (let i = 0; i < vars.length; i++) {
      tick(); const dx = x2[i]! - x1[i]!; let coefficient = 0;
      if (dx > 0) {
        const coords = [...x1]; coords[i] = x2[i]!;
        const dy = evaluate(address, coords) - initial; coefficient = dy / dx;
        if (!discrete[i] || dx !== 1) {
          coords[i] = (x1[i]! + x2[i]!) / 2; if (discrete[i]) coords[i] = Math.floor(coords[i]!);
          const e = dy - 2 * (evaluate(address, coords) - initial);
          if (Math.abs(e) > (dy === 0 ? 1e-10 : Math.abs(dy) / 1e-10)) fail('Target cell does not appear to depend linearly on input cells.');
        }
      }
      constant -= x1[i]! * coefficient;
      if (coefficient === 0 && !zeros) continue;
      text += text ? coefficient < 0 ? ' - ' : ' + ' : coefficient < 0 ? '-' : '';
      const magnitude = Math.abs(coefficient); text += (magnitude === 1 ? '' : modelNumber(magnitude) + ' ') + name(vars[i]!);
    }
    if (!text || constant) text += (text ? ' ' + (constant > 0 ? '+' : '') : '') + modelNumber(constant);
    return text;
    } catch (error) {
      // Both native writers keep ok=TRUE after coefficient extraction fails:
      // the expression stays empty, while the rest of the file is emitted.
      if (error instanceof SsconvertError && error.code === 'io') return '';
      throw error;
    }
  };
  let constraints = '', integers = '', binaries = '', declarations = '', bounds = '', index = 0;
  for (const v of vars) {
    tick(); bounds += ` ${name(v)}${nonnegative ? ' >= 0' : ' free'}\n`;
    if (!glpk && nonnegative) constraints += `${name(v)} >= 0;\n`;
    if (a.Discr === '1') { integers += ` ${name(v)}\n`; declarations += `int ${name(v)};\n`; }
  }
  const objective = affine(target, glpk);
  for (const p of parts) {
    tick(); if (p.type >= 8) {
      const n = name(p.lhs as Address); if (p.type === 8) integers += ` ${n}\n`; else binaries += ` ${n}\n`;
      declarations += `${p.type === 8 ? 'int' : 'binary'} ${n};\n`;
    } else constraints += `${glpk ? ' C_' + index : 'CONSTR_' + p.index}: ${affine(p.lhs)} ${{ 1: '<=', 2: '>=', 4: '=' }[p.type]} ${affine(p.rhs)}${glpk ? '' : ';'}\n`;
    index++;
  }
  const text = glpk ? `\\ Created by Gnumeric 1.12.61\n\n${a.ProblemType === '1' ? 'Maximize' : 'Minimize'}\n obj: ${objective}\n\nSubject to\n${constraints}\nBounds\n${bounds}${integers ? '\nGeneral\n' + integers : ''}${binaries ? '\nBinary\n' + binaries : ''}\nEnd\n` :
    `/* Created by Gnumeric 1.12.61 */\n\n/* Object function */\n${a.ProblemType === '1' ? 'max' : 'min'}: ${objective};\n\n/* Constraints */\n${constraints}\n/* Declarations */\n${declarations}\n/* The End */\n`;
  const bytes = new TextEncoder().encode(text);
  if (bytes.length > context.limits.outputBytes) throw new SsconvertError('resource-limit', 'ssconvert output bytes limit exceeded');
  return bytes;
}

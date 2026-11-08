import type { ByteSource } from 'safe-bash-contracts/io';
import { resolvePath } from 'safe-bash-contracts/path';
import type { Arguments } from './argv.js';
import { unsigned } from './argv.js';
import { Budget, XanError } from './budget.js';
import { cellText, decimalNumber, emitted, textRow } from './cells.js';
import type { RecordRow } from './csv.js';
import { InputScope, observe, outputOperation, preflight, publish } from './io.js';
import { parseSelection, resolveSelection } from './selector.js';
import { Writer } from './writer.js';

async function select(text: string, header: RecordRow | undefined, args: Arguments, budget: Budget): Promise<number[]> {
  budget.hold((header?.width ?? 0) * 32);
  try { return await resolveSelection(await parseSelection(text, budget), header?.cells.map(cell => cell.decoded.view()) ?? [], args.noHeaders, budget); }
  finally { budget.release((header?.width ?? 0) * 32); }
}
async function key(row: RecordRow, selected: number[], budget: Budget): Promise<{ identity: string; size: number }> {
  const size = selected.reduce((n, i) => n + row.cells[i]!.decoded.length * 2 + 32, 0);
  budget.hold(size);
  let result = '';
  for (const index of selected) {
    const bytes = row.cells[index]!.decoded.view();
    result += `${bytes.length}:`;
    for (const byte of bytes) { budget.work(); result += String.fromCharCode(byte); const cp = budget.checkpoint(); if (cp) await cp; }
  }
  return { identity: result, size };
}

interface Aggregate { name: string; field?: number; label: string }
async function aggregates(text: string, header: RecordRow | undefined, args: Arguments, budget: Budget): Promise<Aggregate[]> {
  const result: Aggregate[] = [];
  let at = 0;
  const whitespace = (): void => { while (at < text.length && ' \n\r\t'.includes(text[at]!)) at++; };
  while (at < text.length) {
    whitespace(); const begin = at;
    while (at < text.length && text[at] !== '(') at++;
    const name = text.slice(begin, at).trim().toLowerCase();
    if (!['count', 'sum', 'mean', 'avg', 'min', 'max', 'median', 'first', 'last'].includes(name) || at === text.length) throw new XanError('expected an aggregate call');
    const start = ++at;
    let quote = '';
    while (at < text.length) {
      const ch = text[at]!;
      if (quote) { if (ch === quote) quote = ''; }
      else if (ch === '"' || ch === "'") quote = ch;
      else if (ch === ')') break;
      at++;
    }
    if (at === text.length) throw new XanError('unterminated aggregate call');
    const column = text.slice(start, at).trim();
    at++; let label = text.slice(begin, at).trim(); whitespace();
    if (text.slice(at, at + 2).toLowerCase() === 'as' && ' \t\n'.includes(text[at + 2] ?? '')) {
      at += 2; whitespace(); const quote = text[at] === '"' || text[at] === "'" ? text[at++] : undefined;
      const start = at;
      while (at < text.length && (quote ? text[at] !== quote : text[at] !== ',')) at++;
      label = text.slice(start, at).trim();
      if (quote) { if (text[at++] !== quote) throw new XanError('unterminated aggregate alias'); whitespace(); }
    }
    if (at < text.length && text[at++] !== ',') throw new XanError('expected comma between aggregate calls');
    let field: number | undefined;
    if (column && column !== '*') {
      const fields = await select(column, header, args, budget);
      try { if (fields.length !== 1) throw new XanError('aggregate requires one column'); field = fields[0]!; }
      finally { budget.release(fields.length * 8); }
    } else if (name !== 'count') throw new XanError(`${name} requires a column`);
    budget.hold(128 + label.length * 2); result.push({ name, label, ...(field === undefined ? {} : { field }) });
  }
  if (!result.length) throw new XanError('expected an aggregate call');
  return result;
}

export async function* extendedRows(args: Arguments, scope: InputScope, budget: Budget, writer: Writer): ByteSource {
  if (args.command === 'from') { yield* from(args, scope, budget, writer); return; }
  if (args.command === 'cat') { yield* concatenate(args, scope, budget, writer); return; }
  const scanner = scope.open(args.inputs[0]!, args);
  const header = await scanner.next();
  if (header) scope.own(header.free);
  const retained: RecordRow[] = [];
  scope.own(() => { for (const row of retained) row.free(); budget.release(retained.length * 32); });
  async function* rows(): AsyncGenerator<RecordRow> {
    let row = args.noHeaders ? header : await scanner.next();
    try {
      while (row) {
        if (row.width !== header?.width) throw new XanError('CSV error: inconsistent field count');
        yield row; row = await scanner.next();
      }
    } finally { row?.free(); }
  }
  if (args.command === 'enum') {
    if (!args.noHeaders && header) yield* textRow([args.options!.get('column-name') ?? 'index', ...header.cells.map(cell => cell.decoded.view())], writer, budget);
    let index = args.start;
    for await (const row of rows()) { try { yield* textRow([String(index++), ...row.cells.map(cell => cell.decoded.view())], writer, budget); } finally { row.free(); } }
    return;
  }
  if (args.command === 'dedup') {
    const selected = await select(args.selection, header, args, budget);
    const seen = new Map<string, { row: RecordRow; count: number }>();
    scope.own(() => { for (const entry of seen.values()) entry.row.free(); });
    if (!args.noHeaders && header) yield* emitted(await writer.row(header.cells), budget);
    for await (const row of rows()) {
      const { identity, size } = await key(row, selected, budget), existing = seen.get(identity);
      if (existing) {
        budget.release(size);
        existing.count++;
        if (args.options!.has('keep-last')) { existing.row.free(); existing.row = row; } else row.free();
      } else { budget.hold(96); seen.set(identity, { row, count: 1 }); }
    }
    for (const entry of seen.values()) if (!args.options!.has('keep-duplicates') || entry.count > 1) yield* emitted(await writer.row(entry.row.cells), budget);
    return;
  }
  if (args.command === 'agg' || args.command === 'groupby') {
    const selected = args.command === 'groupby' ? await select(args.rightSelection ?? '', header, args, budget) : [];
    const specs = await aggregates(args.operand!, header, args, budget);
    interface State { count: number; sum: number; min: number; max: number; values: number[]; first?: Uint8Array; last?: Uint8Array }
    const groups = new Map<string, { keys: Uint8Array[]; states: State[] }>();
    const make = (row?: RecordRow): { keys: Uint8Array[]; states: State[] } => {
      budget.hold(specs.length * 128 + selected.length * 32 + 64);
      return { keys: selected.map(index => { const bytes = row!.cells[index]!.decoded.view(); budget.hold(bytes.length); return bytes.slice(); }), states: specs.map(() => ({ count: 0, sum: 0, min: Infinity, max: -Infinity, values: [] })) };
    };
    if (args.command === 'agg') groups.set('', make());
    yield* textRow([...selected.map(index => args.noHeaders ? String(index) : header!.cells[index]!.decoded.view()), ...specs.map(spec => spec.label)], writer, budget);
    for await (const row of rows()) {
      try {
        const { identity, size } = selected.length ? await key(row, selected, budget) : { identity: '', size: 0 };
        let group = groups.get(identity);
        if (!group) { group = make(row); groups.set(identity, group); }
        else budget.release(size);
        for (let i = 0; i < specs.length; i++) {
          budget.work(); const spec = specs[i]!, state = group.states[i]!;
          const bytes = spec.field === undefined ? undefined : row.cells[spec.field]!.decoded.view();
          if (spec.name === 'count') { if (!bytes || bytes.length) state.count++; continue; }
          if (!bytes?.length) continue;
          state.count++;
          if (spec.name === 'first' || spec.name === 'last') {
            if (spec.name === 'first' && state.first) continue;
            const previous = spec.name === 'first' ? state.first : state.last;
            if (previous) budget.release(previous.length);
            budget.hold(bytes.length); if (spec.name === 'first') state.first = bytes.slice(); else state.last = bytes.slice();
          } else {
            budget.hold(bytes.length * 4);
            let value: number | undefined;
            try { value = decimalNumber(cellText(bytes, budget), budget); } finally { budget.release(bytes.length * 4); }
            if (value === undefined) throw new XanError(`${spec.name} requires numeric values`);
            state.sum += value; state.min = Math.min(state.min, value); state.max = Math.max(state.max, value);
            if (spec.name === 'median') { budget.hold(8); state.values.push(value); }
          }
        }
      } finally { row.free(); }
    }
    for (const group of groups.values()) yield* textRow([...group.keys, ...specs.map((spec, i) => {
      const state = group.states[i]!;
      if (spec.name === 'first') return state.first ?? '';
      if (spec.name === 'last') return state.last ?? '';
      if (spec.name === 'count') return String(state.count);
      if (spec.name === 'sum') return String(state.sum);
      if (!state.count) return '';
      if (spec.name === 'median') {
        const sorted = [...state.values].sort((a, b) => a - b);
        const mid = Math.floor(sorted.length / 2);
        return String(sorted.length % 2 === 1 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2);
      }
      return String(spec.name === 'min' ? state.min : spec.name === 'max' ? state.max : state.sum / state.count);
    })], writer, budget);
    return;
  }
  if (args.command === 'transpose' && !args.noHeaders && header) { budget.hold(32); retained.push(header); }
  for await (const row of rows()) { budget.hold(32); retained.push(row); }
  if (args.command === 'transpose') {
    for (let i = 0; i < (header?.width ?? 0); i++) yield* textRow(retained.map(row => row.cells[i]!.decoded.view()), writer, budget);
  } else if (args.command === 'split') {
    const options = args.options!;
    let size = Number(await unsigned(options.get('size') ?? '4096', '--size', budget));
    if (options.has('chunks')) { const chunks = Number(await unsigned(options.get('chunks')!, '--chunks', budget)); if (!chunks) throw new XanError('chunks must be positive'); size = Math.max(1, Math.ceil(retained.length / chunks)); }
    if (!Number.isSafeInteger(size) || size <= 0) throw new XanError('size must be positive');
    const directory = resolvePath(scope.context.cwd, options.get('out-dir') ?? '.');
    const template = options.get('filename') ?? '{}.csv';
    if (template.split('{}').length !== 2 || template.includes('/') || template.includes('\\') || template.includes('\0')) throw new XanError('filename must contain one {} and no path separators');
    await observe(() => scope.context.fs.mkdir(directory, { recursive: true, signal: budget.signal }), budget.signal);
    for (let start = 0; start < Math.max(1, retained.length); start += size) {
      budget.work();
      const output = resolvePath(directory, template.replace('{}', String(options.has('chunks') ? start / size : start)));
      const destination = await preflight(scope.context, { ...args, output }, budget);
      const operation = outputOperation(scope.context, true);
      const chunks = async function* (): ByteSource {
        const chunkWriter = new Writer(writer.delimiter, budget);
        if (!args.noHeaders && header) yield* emitted(await chunkWriter.row(header.cells), budget);
        for (let i = start; i < Math.min(start + size, retained.length); i++) yield* emitted(await chunkWriter.row(retained[i]!.cells), budget);
      };
      try { await publish(scope.context, destination, chunks(), operation, budget); } finally { await operation.close(); }
    }
  } else if (args.command === 'to') {
    const format = args.operand!;
    if (!['json', 'jsonl', 'ndjson', 'txt'].includes(format)) throw new XanError(`unsupported output format: ${format}`);
    const names = header?.cells.map((cell, index) => args.noHeaders ? String(index) : cellText(cell.decoded.view(), budget)) ?? [];
    const numeric = names.map((_, column) => retained.every(row => { const text = cellText(row.cells[column]!.decoded.view(), budget); return !text || decimalNumber(text, budget) !== undefined; }));
    if (format === 'json') yield* emitted(await writer.text('['), budget);
    for (let i = 0; i < retained.length; i++) {
      const row = retained[i]!;
      const temporary = row.cells.reduce((n, cell) => n + cell.decoded.length * 12 + 64, 0);
      budget.hold(temporary);
      try {
        const values = row.cells.map(cell => cellText(cell.decoded.view(), budget));
        if (format === 'txt') { yield* emitted(await writer.text(values.join('\n') + '\n'), budget); continue; }
        const record = Object.fromEntries(values.flatMap((value, column) => !value && args.options!.has('omit') ? [] : [[names[column]!, !value ? args.options!.has('nulls') ? null : '' : numeric[column] ? Number(value) : value]]));
        yield* emitted(await writer.text((format === 'json' && i ? ',' : '') + JSON.stringify(record) + (format === 'json' ? '' : '\n')), budget);
      } finally { budget.release(temporary); }
    }
    if (format === 'json') yield* emitted(await writer.text(']\n'), budget);
  }
}

async function* from(args: Arguments, scope: InputScope, budget: Budget, writer: Writer): ByteSource {
  const path = args.inputs[0]!, format = args.options!.get('format') ?? path.slice(path.lastIndexOf('.') + 1);
  if (!['json', 'jsonl', 'ndjson', 'txt', 'text', 'lines', 'raw'].includes(format)) throw new XanError(`unsupported input format: ${format}`);
  const scanner = scope.open(path, args), chunks: Uint8Array[] = [];
  let size = 0;
  for await (const chunk of scanner.raw(false)) { budget.hold(chunk.length + 32); chunks.push(chunk.slice()); size += chunk.length; }
  // Admit decoded text and the JSON object graph before parsing.
  budget.hold(size * 64);
  const bytes = new Uint8Array(size); let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; budget.work(chunk.length); const cp = budget.checkpoint(); if (cp) await cp; }
  const text = cellText(bytes, budget);
  if (['raw', 'txt', 'text', 'lines'].includes(format)) {
    yield* textRow([args.options!.get('column-name') ?? 'text'], writer, budget);
    const lines = format === 'raw' ? [text] : text.split('\n');
    if (format !== 'raw' && lines.at(-1) === '') lines.pop();
    for (const line of lines) {
      budget.add('maxRecords', 1);
      const value = line.endsWith('\r') && format !== 'raw' ? line.slice(0, -1) : line;
      const bytes = await budget.textSize(value);
      budget.bound('maxCellBytes', bytes); budget.bound('maxRecordBytes', bytes);
      yield* textRow([value], writer, budget);
    }
    return;
  }
  let data: unknown;
  try { data = format === 'json' ? JSON.parse(text) : text.split('\n').filter(line => line.trim()).map(line => JSON.parse(line)); }
  catch { throw new XanError('invalid JSON input'); }
  const rows = Array.isArray(data) ? data : args.options!.has('single-object') ? [data] : typeof data === 'object' && data !== null ? Object.entries(data).map(([key, value]) => ({ key, value })) : [];
  const names = new Set<string>();
  for (const row of rows) {
    budget.add('maxRecords', 1);
    if (!row || typeof row !== 'object' || Array.isArray(row)) throw new XanError('JSON records must be objects');
    for (const name of Object.keys(row)) { budget.work(); names.add(name); budget.bound('maxColumns', names.size); }
  }
  const columns = [...names]; if (args.options!.has('sort-keys')) columns.sort();
  if (columns.length) yield* textRow(columns, writer, budget);
  for (const row of rows) {
    const values: string[] = [];
    let recordBytes = 0;
    for (const name of columns) {
      const value = (row as Record<string, unknown>)[name];
      const text = value === null || value === undefined ? '' : typeof value === 'object' ? JSON.stringify(value) : String(value);
      const bytes = await budget.textSize(text);
      budget.bound('maxCellBytes', bytes); recordBytes += bytes; budget.bound('maxRecordBytes', recordBytes);
      values.push(text);
    }
    yield* textRow(values, writer, budget);
  }
}

async function* concatenate(args: Arguments, scope: InputScope, budget: Budget, writer: Writer): ByteSource {
  if (!['rows', 'cols', 'columns'].includes(args.operand!)) throw new XanError('cat requires rows or columns');
  if (args.operand === 'rows') {
    let width: number | undefined;
    let headerEmitted = false;
    for (let input = 0; input < args.inputs.length; input++) {
      const scanner = scope.open(args.inputs[input]!, args);
      let first = true;
      for (;;) {
        const row = await scanner.next(); if (!row) break;
        try {
          width ??= row.width;
          if (row.width !== width) throw new XanError('CSV error: inconsistent field count');
          if (!(first && headerEmitted && !args.noHeaders)) yield* emitted(await writer.row(row.cells), budget);
          headerEmitted = true;
        } finally { row.free(); }
        first = false;
      }
      await scanner.close();
    }
  } else {
    const scanners = args.inputs.map(path => scope.open(path, args)), widths: number[] = [];
    for (;;) {
      const rows: (RecordRow | undefined)[] = [];
      try {
        for (const scanner of scanners) rows.push(await scanner.next());
        if (rows.every(row => !row) || (!args.options!.has('pad') && rows.some(row => !row))) break;
        const values: (string | Uint8Array)[] = [];
        for (let i = 0; i < rows.length; i++) {
          const row = rows[i]; widths[i] ??= row?.width ?? 0;
          if (row && row.width !== widths[i]) throw new XanError('CSV error: inconsistent field count');
          values.push(...(row ? row.cells.map(cell => cell.decoded.view()) : Array<string>(widths[i]!).fill('')));
        }
        yield* textRow(values, writer, budget);
      } finally { for (const row of rows) row?.free(); }
    }
  }
}

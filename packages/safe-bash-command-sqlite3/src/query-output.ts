import {JsonText, toSqlString, type QueryResultSet, type SqlValue} from './engine.js';
import {sqlQuoteParts} from './stream-output.js';

export interface QueryOutputOptions {
  mode: 'list' | 'csv' | 'column' | 'line' | 'json' | 'tabs' | 'html' | 'markdown' | 'box' | 'table' | 'quote' | 'ascii' | 'insert';
  insertTable: string;
  showHeaders: boolean;
  colSeparator: string;
  rowSeparator: string;
  nullValue: string;
  widths: number[];
}

function* textParts(text: string): Generator<string> {
  for (let offset = 0; offset < text.length;) {
    let end = Math.min(text.length, offset + 4096);
    const last = text.charCodeAt(end - 1);
    if (end < text.length && last >= 0xd800 && last <= 0xdbff) end--;
    yield text.slice(offset, end); offset = end;
  }
}

/** Match SQLite's text rendering of blobs: strip the initial BOM and stop at NUL. */
function* cellParts(value: SqlValue, nullValue: string): Generator<string> {
  if (value instanceof Uint8Array) {
    const decoder = new TextDecoder(), zero = value.indexOf(0), end = zero < 0 ? value.length : zero;
    for (let offset = 0; offset < end; offset += 4096) yield decoder.decode(value.subarray(offset, Math.min(end, offset + 4096)), {stream: true});
    yield decoder.decode();
  } else yield* textParts(value === null || value === undefined ? nullValue : toSqlString(value));
}

function* cellLength(value: SqlValue, nullValue: string): Generator<string, number> {
  let length = 0;
  for (const part of cellParts(value, nullValue)) { length += part.length; yield ""; }
  return length;
}

function* repeat(character: string, count: number): Generator<string> {
  while (count > 0) { const size = Math.min(4096, count); yield character.repeat(size); count -= size; }
}

function* csvParts(value: SqlValue, state: QueryOutputOptions): Generator<string> {
  let quoted = state.colSeparator === '', tail = '';
  for (const part of cellParts(value, state.nullValue)) {
    yield "";
    const text = tail + part;
    if (text.includes('"') || text.includes(state.colSeparator) || text.includes('\n') || text.includes('\r')) { quoted = true; break; }
    tail = state.colSeparator.length > 1 ? text.slice(1 - state.colSeparator.length) : '';
  }
  if (quoted) yield '"';
  for (const part of cellParts(value, state.nullValue)) yield quoted ? part.replaceAll('"', '""') : part;
  if (quoted) yield '"';
}

function* htmlParts(value: SqlValue, nullValue: string): Generator<string> {
  for (const part of cellParts(value, nullValue)) {
    for (let offset = 0; offset < part.length; offset += 1024) yield part.slice(offset, offset + 1024).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');
  }
}

function* jsonString(parts: Iterable<string>): Generator<string> {
  yield '"';
  let high = '';
  for (const part of parts) {
    let text = high + part; high = '';
    const last = text.charCodeAt(text.length - 1);
    if (last >= 0xd800 && last <= 0xdbff) { high = text.at(-1)!; text = text.slice(0, -1); }
    // Escaped control characters can expand sixfold. Bound the escaped output too.
    for (const chunk of textParts(text)) {
      const encoded = JSON.stringify(chunk);
      yield* textParts(encoded.slice(1, -1));
    }
  }
  if (high) yield JSON.stringify(high).slice(1, -1);
  yield '"';
}

function* jsonValue(value: SqlValue | undefined): Generator<string> {
  if (value instanceof JsonText) yield* textParts(value.valueOf());
  else if (typeof value === 'string' || value instanceof String || value instanceof Uint8Array) yield* jsonString(cellParts(value, ''));
  else if (value instanceof Number) yield Number.isFinite(value.valueOf()) ? toSqlString(value) : 'null';
  else if (typeof value === 'bigint') yield value.toString();
  else yield JSON.stringify(value ?? null);
}

/** Replay result rows for widths; never retain a second formatted row set or full output. */
export function* formatQueryParts({columns, rows}: QueryResultSet, state: QueryOutputOptions): Generator<string> {
  if (!columns.length) return;
  const {mode} = state;
  if (mode === 'json') {
    yield '[';
    for (let row = 0; row < rows.length; row++) {
      if (row) yield ',\n';
      yield '{';
      for (let col = 0; col < columns.length; col++) {
        if (col) yield ',';
        yield* jsonString(textParts(columns[col]!)); yield ':'; yield* jsonValue(rows[row]![col]);
      }
      yield '}';
    }
    yield ']\n'; return;
  }
  if (mode === 'line') {
    let width = 5;
    for (const column of columns) width = Math.max(width, column.length);
    for (let row = 0; row < rows.length; row++) {
      if (row) yield '\n';
      for (let col = 0; col < columns.length; col++) {
        yield* repeat(' ', width - columns[col]!.length); yield* textParts(columns[col]!); yield ' = ';
        yield* cellParts(rows[row]![col] ?? null, state.nullValue); yield '\n';
      }
    }
    return;
  }
  if (mode === 'column' || mode === 'table' || mode === 'markdown' || mode === 'box') {
    if (!state.showHeaders && !rows.length) return;
    const widths: number[] = [];
    for (let col = 0; col < columns.length; col++) {
      let width = state.widths[col];
      if (!(width! > 0)) {
        width = Math.max(columns[col]!.length, 1);
        for (const row of rows) {
          width = Math.max(width, yield* cellLength(col < row.length ? row[col]! : '', state.nullValue));
          yield '';
        }
      }
      widths.push(width!);
    }
    function* border(left: string, middle: string, right: string, line: string, padding: number): Generator<string> {
      yield left;
      for (let col = 0; col < widths.length; col++) { if (col) yield middle; yield* repeat(line, widths[col]! + padding); }
      yield right + '\n';
    }
    function* rowParts(values: SqlValue[], header = false): Generator<string> {
      const framed = mode !== 'column', bar = mode === 'box' ? '│' : '|';
      if (framed) yield bar + ' ';
      for (let col = 0; col < values.length; col++) {
        if (col) yield framed ? ' ' + bar + ' ' : '  ';
        const width = widths[col], length = yield* cellLength(values[col]!, state.nullValue);
        // padEnd(undefined) leaves extra cells unchanged, matching the convenience formatter.
        const padding = Math.max(0, (width ?? 0) - length), left = header && (mode === 'table' || mode === 'markdown') ? Math.floor(padding / 2) : 0;
        yield* repeat(' ', left); yield* cellParts(values[col]!, state.nullValue); yield* repeat(' ', padding - left);
      }
      yield framed ? ' ' + bar + '\n' : '\n';
    }
    if (mode === 'table') yield* border('+', '+', '+', '-', 2);
    if (mode === 'box') yield* border('┌', '┬', '┐', '─', 2);
    if (state.showHeaders || mode === 'markdown') {
      yield* rowParts(columns, true);
      if (mode === 'column') yield* border('', '  ', '', '-', 0);
      if (mode === 'markdown') yield* border('|-', '-|-', '-|', '-', 0);
      if (mode === 'table') yield* border('+', '+', '+', '-', 2);
      if (mode === 'box') yield* border('├', '┼', '┤', '─', 2);
    }
    for (const row of rows) yield* rowParts(row);
    if (mode === 'table') yield* border('+', '+', '+', '-', 2);
    if (mode === 'box') yield* border('└', '┴', '┘', '─', 2);
    return;
  }
  function* rowParts(row: SqlValue[], header = false): Generator<string> {
    if (mode === 'html') yield '<TR>';
    if (mode === 'insert') { yield 'INSERT INTO '; yield* textParts(state.insertTable || 'table'); yield ' VALUES('; }
    for (let col = 0; col < row.length; col++) {
      if (col && mode !== 'html') yield* textParts(mode === 'quote' || mode === 'insert' ? ',' : state.colSeparator);
      if (mode === 'quote' || mode === 'insert') yield* sqlQuoteParts(row[col]!);
      else if (mode === 'csv') yield* csvParts(row[col]!, state);
      else if (mode === 'html') {
        yield header ? '<TH>' : '<TD>'; yield* htmlParts(row[col]!, state.nullValue); yield header ? '</TH>\n' : '</TD>\n';
      } else yield* cellParts(row[col]!, state.nullValue);
    }
    if (mode === 'html') yield '</TR>\n';
    else if (mode === 'insert') yield ');\n';
    else if (mode === 'quote') yield '\n';
    else yield* textParts(state.rowSeparator);
  }
  if (state.showHeaders && mode !== 'insert') yield* rowParts(columns, true);
  for (const row of rows) yield* rowParts(row);
}

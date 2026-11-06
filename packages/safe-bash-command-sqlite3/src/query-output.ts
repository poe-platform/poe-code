import {JsonText, toSqlString, type QueryResultSet, type SqlValue} from './engine.js';
import {sqlQuoteParts} from './stream-output.js';
import {formatReal} from './real-output.js';

// SQLite's keyword list: https://www.sqlite.org/lang_keywords.html
const sqlKeywords = new Set((
  'ABORT ACTION ADD AFTER ALL ALTER ANALYZE AND AS ASC ATTACH AUTOINCREMENT BEFORE BEGIN BETWEEN BY ' +
  'CASCADE CASE CAST CHECK COLLATE COLUMN COMMIT CONFLICT CONSTRAINT CREATE CROSS CURRENT CURRENT_DATE ' +
  'CURRENT_TIME CURRENT_TIMESTAMP DATABASE DEFAULT DEFERRABLE DEFERRED DELETE DESC DETACH DISTINCT DO DROP ' +
  'EACH ELSE END ESCAPE EXCEPT EXCLUDE EXCLUSIVE EXISTS EXPLAIN FAIL FILTER FIRST FOLLOWING FOR FOREIGN FROM ' +
  'FULL GENERATED GLOB GROUP GROUPS HAVING IF IGNORE IMMEDIATE IN INDEX INDEXED INITIALLY INNER INSERT INSTEAD ' +
  'INTERSECT INTO IS ISNULL JOIN KEY LAST LEFT LIKE LIMIT MATCH MATERIALIZED NATURAL NO NOT NOTHING NOTNULL ' +
  'NULL NULLS OF OFFSET ON OR ORDER OTHERS OUTER OVER PARTITION PLAN PRAGMA PRECEDING PRIMARY QUERY RAISE ' +
  'RANGE RECURSIVE REFERENCES REGEXP REINDEX RELEASE RENAME REPLACE RESTRICT RETURNING RIGHT ROLLBACK ROW ' +
  'ROWS SAVEPOINT SELECT SET TABLE TEMP TEMPORARY THEN TIES TO TRANSACTION TRIGGER UNBOUNDED UNION UNIQUE ' +
  'UPDATE USING VACUUM VALUES VIEW VIRTUAL WHEN WHERE WINDOW WITH WITHOUT'
).split(' '));

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
  } else {
    const text = value === null || value === undefined ? nullValue : toSqlString(value);
    const zero = text.indexOf("\0");
    yield* textParts(zero < 0 ? text : text.slice(0, zero));
  }
}

/** Null marks a physical line boundary; text fragments remain bounded. */
function* cellSegments(value: SqlValue, nullValue: string): Generator<string | null> {
  for (const part of cellParts(value, nullValue)) {
    let start = 0;
    for (let end = part.indexOf('\n'); end >= 0; end = part.indexOf('\n', start)) {
      if (end > start) yield part.slice(start, end);
      yield null;
      start = end + 1;
    }
    if (start < part.length) yield part.slice(start);
  }
}

function* repeat(character: string, count: number): Generator<string> {
  while (count > 0) { const size = Math.min(4096, count); yield character.repeat(size); count -= size; }
}

function* csvParts(value: SqlValue, state: QueryOutputOptions): Generator<string> {
  if (value === null || value === undefined) {
    yield* cellParts(value, state.nullValue);
    return;
  }
  let quoted = state.colSeparator === '', tail = '', empty = true;
  for (const part of cellParts(value, state.nullValue)) {
    yield "";
    if (part.length) empty = false;
    const text = tail + part;
    for (let i = 0; i < part.length; i++) {
      if (part.charCodeAt(i) <= 32) { quoted = true; break; }
    }
    if (quoted || text.includes('"') || text.includes(state.colSeparator)) { quoted = true; break; }
    tail = state.colSeparator.length > 1 ? text.slice(1 - state.colSeparator.length) : '';
  }
  quoted ||= empty;
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
  else if (value instanceof Uint8Array) {
    yield '"';
    // SQLite renders BLOBs byte by byte, without UTF-8 decoding or NUL termination.
    for (let offset = 0; offset < value.length; offset += 512) {
      let part = '';
      for (const byte of value.subarray(offset, offset + 512)) part += '\\u00' + byte.toString(16).padStart(2, '0');
      yield part;
    }
    yield '"';
  }
  else if (typeof value === 'string' || value instanceof String) yield* jsonString(cellParts(value, ''));
  else if (value instanceof Number || (typeof value === 'number' && !Number.isInteger(value))) {
    const number = value.valueOf();
    yield Number.isFinite(number) ? formatReal(number, 20) : 'null';
  }
  else if (typeof value === 'bigint') yield value.toString();
  else yield JSON.stringify(value ?? null);
}

/** Replay result rows for widths; never retain a second formatted row set or full output. */
export function* formatQueryParts({columns, rows}: QueryResultSet, state: QueryOutputOptions): Generator<string> {
  if (!columns.length || !rows.length) return;
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
    const widths: number[] = [];
    let multiline = false;
    for (let col = 0; col < columns.length; col++) {
      let width = 1;
      for (let row = -1; row < rows.length; row++) {
        const value = row < 0 ? columns[col]! : (col < rows[row]!.length ? rows[row]![col]! : '');
        let length = 0, lines = 0;
        for (const part of cellSegments(value, state.nullValue)) {
          if (part === null) { width = Math.max(width, length); length = 0; lines++; }
          else { length += part.length; }
          if (lines > 1 || (lines > 0 && length > 0)) multiline = true;
          yield '';
        }
        width = Math.max(width, length);
      }
      widths.push(state.widths[col]! > 0 ? state.widths[col]! : width);
    }
    function* border(left: string, middle: string, right: string, line: string, padding: number): Generator<string> {
      yield left;
      for (let col = 0; col < widths.length; col++) { if (col) yield middle; yield* repeat(line, widths[col]! + padding); }
      yield right + '\n';
    }
    function* rowParts(values: SqlValue[], header = false): Generator<string> {
      const framed = mode !== 'column', bar = mode === 'box' ? '│' : '|';
      const cells = values.map(value => {
        const parts = cellSegments(value, state.nullValue);
        return {parts, lengths: cellSegments(value, state.nullValue), next: parts.next()};
      });
      do {
        if (framed) yield bar + ' ';
        for (let col = 0; col < cells.length; col++) {
          if (col) yield framed ? ' ' + bar + ' ' : '  ';
          const cell = cells[col]!;
          let length = 0;
          for (let part = cell.lengths.next(); !part.done && part.value !== null; part = cell.lengths.next()) {
            length += part.value.length;
            yield '';
          }
          const padding = Math.max(0, (widths[col] ?? 0) - length);
          const left = header && (mode === 'table' || mode === 'markdown') ? Math.floor(padding / 2) : 0;
          yield* repeat(' ', left);
          while (!cell.next.done && cell.next.value !== null) {
            yield cell.next.value;
            cell.next = cell.parts.next();
          }
          if (!cell.next.done) cell.next = cell.parts.next();
          yield* repeat(' ', padding - left);
        }
        yield framed ? ' ' + bar + '\n' : '\n';
      } while (cells.some(cell => !cell.next.done));
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
    for (let row = 0; row < rows.length; row++) {
      if (row && multiline) {
        if (mode === 'column') yield '\n';
        if (mode === 'table') yield* border('+', '+', '+', '-', 2);
        if (mode === 'box') yield* border('├', '┼', '┤', '─', 2);
      }
      yield* rowParts(rows[row]!);
    }
    if (mode === 'table') yield* border('+', '+', '+', '-', 2);
    if (mode === 'box') yield* border('└', '┴', '┘', '─', 2);
    return;
  }
  function* rowParts(row: SqlValue[], header = false): Generator<string> {
    if (mode === 'html') yield '<TR>';
    if (mode === 'insert') {
      const table = state.insertTable || 'table';
      const quote = sqlKeywords.has(table.toUpperCase()) || [...table].some((char, index) =>
        !((char >= 'a' && char <= 'z') || (char >= 'A' && char <= 'Z') || char === '_' ||
          (index > 0 && char >= '0' && char <= '9')));
      yield 'INSERT INTO ';
      if (quote) yield '"';
      for (const part of textParts(table)) yield quote ? part.replaceAll('"', '""') : part;
      if (quote) yield '"';
      if (state.showHeaders) {
        yield '(';
        for (let col = 0; col < columns.length; col++) {
          if (col) yield ',';
          yield '"';
          for (const part of cellParts(columns[col]!, '')) yield part.replaceAll('"', '""');
          yield '"';
        }
        yield ')';
      }
      yield ' VALUES(';
    }
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

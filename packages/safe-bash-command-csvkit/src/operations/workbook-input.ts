import { read, utils, CFB, SSF, set_cptable, type WorkBook } from '@e965/xlsx';
import type { CsvkitWorkbook, CsvkitWorkbookCell } from '../workbook.js';
import * as codepages from '@e965/xlsx/dist/cpexcel';
import { createZipCodec, CodecError } from '@poe-code/office-package';
import type { Runtime } from '../runtime.js';
import { CsvkitBlocked, CsvkitDiagnostic } from '../errors.js';
import { repr, integer } from '../cli/parser.js';
import { decimalZeroes } from '../unicode-profile.js';
import { nondecimalDigits } from './workbook-digit-profile.js';
import { readWorkbookIsoDates } from './workbook-iso.js';
import { inputTable, csvifiedRow } from './input-table.js';
import { defaultHeaders, normalizeHeaders } from '../table/headers.js';
import type { TypedTable } from '../table/index.js';
import { castValue } from '../table/types.js';
import { writeCsvRow } from '../csv.js';
import { pathExtension } from '../io/index.js';

// ESM workbook readers require the pinned library's codepage tables explicitly.
set_cptable(codepages);

/** Buffer only workbook input, which the reference library also requires. */
export class WorkbookInput {
  #stdin: Uint8Array | undefined;
  #date1904 = false;
  #isoDates: ReadonlyMap<string, ReadonlyMap<string, string>> = new Map();
  constructor(readonly runtime: Runtime, readonly format: 'xls' | 'xlsx') {}
  async open(namesOnly = false): Promise<CsvkitWorkbook> {
    const r = this.runtime;
    const streamed = !r.options.input_path || r.options.input_path === '-';
    let bytes = streamed ? this.#stdin : undefined;
    if (!bytes) {
      const chunks: Uint8Array[] = []; let size = 0;
      for await (const chunk of r.bytes()) { size += chunk.length; chunks.push(chunk); }
      r.retain(size); bytes = new Uint8Array(size); let offset = 0;
      for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
      if (streamed) this.#stdin = bytes;
    }
    r.step();
    if (this.format === 'xlsx') {
      if (bytes[0] !== 80 || bytes[1] !== 75) throw new CsvkitDiagnostic('BadZipFile: File is not a zip file');
      const l = r.context.limits;
      try {
        const codec = createZipCodec(undefined, { zip64: true });
        const limits = {
          maxArchiveBytes: l.maxInputBytes, maxEntryBytes: l.maxInflatedBytes, maxTotalBytes: l.maxInflatedBytes,
          maxMembers: l.maxArchiveMembers, maxPathBytes: l.maxInputBytes, maxDepth: l.maxNestingDepth,
          maxPaxBytes: l.maxInputBytes, maxTextBytes: l.maxInflatedBytes, chunkSize: 65536
        };
        const zip = await codec.readZipArchive(bytes, limits, r.context.signal);
        for (const entry of zip.entries) for await (const ignoredChunk of codec.decodeZipEntry(entry, limits, r.context.signal)) { r.step(); }
        r.retain(zip.entries.reduce((sum, entry) => sum + entry.size, 0));
        const isoDates = await readWorkbookIsoDates(r, zip, codec, limits, namesOnly);
        if (!namesOnly) this.#isoDates = isoDates;
      } catch (failure) {
        if (failure instanceof CodecError) throw new CsvkitBlocked(`XLSX ZIP validation: ${failure.message}`);
        throw failure;
      }
    } else if (!((bytes[0] === 208 && bytes[1] === 207) || (bytes[0] === 9 && [0, 2, 4, 8].includes(bytes[1]!)))) {
      throw new CsvkitBlocked('XLS non-OLE/non-BIFF input');
    }
    // SheetJS never receives paths, file handles, or network capabilities.
    let book: WorkBook;
    try {
      let readerBytes = bytes;
      let codepage: number | undefined;
      if (this.format === 'xls' && !namesOnly && r.options.encoding_xls && !unicodeBiff(bytes)) {
        codepage = xlsCodepage(String(r.options.encoding_xls));
        const stream = workbookBiffStream(bytes);
        r.retain(stream.length);
        readerBytes = Uint8Array.from(stream);
        // Unlike xlrd's encoding_override, SheetJS's option loses to CODEPAGE.
        // Rewrite that parsed BIFF record in an owned raw stream before reading.
        for (let offset = 0; offset + 4 <= readerBytes.length;) {
          r.step();
          const type = readerBytes[offset]! | readerBytes[offset + 1]! << 8;
          const length = readerBytes[offset + 2]! | readerBytes[offset + 3]! << 8;
          if (offset + 4 + length > readerBytes.length) throw new CsvkitBlocked('truncated XLS BIFF record');
          if (type === 0x0042 && length === 2) { readerBytes[offset + 4] = codepage & 255; readerBytes[offset + 5] = codepage >> 8; }
          offset += 4 + length;
        }
      }
      book = read(readerBytes, { type: 'array', cellDates: false, cellNF: true, cellFormula: false, sheetStubs: true,
        ...(namesOnly ? { bookSheets: true } : {}),
        ...(codepage === undefined ? {} : { codepage }),
        ...(this.format === 'xlsx' && r.options.reset_dimensions ? { nodim: true } : {}) });
      if (!namesOnly && this.format === 'xlsx' && r.options.reset_dimensions === null && Object.values(book.Sheets).some(sheet => sheet['!ref'] === 'A1')) {
        const expanded = read(bytes, { type: 'array', cellDates: false, cellNF: true, cellFormula: false, sheetStubs: true, nodim: true });
        for (const name of book.SheetNames) if (book.Sheets[name]?.['!ref'] === 'A1') book.Sheets[name] = expanded.Sheets[name]!;
      }
    } catch (failure) {
      if (failure instanceof CsvkitDiagnostic) throw failure;
      throw new CsvkitBlocked(`in2csv ${this.format} parser: ${failure instanceof Error ? failure.message : String(failure)}`);
    }
    r.step();
    if (book.SheetNames.length > r.context.limits.maxArchiveMembers) throw new CsvkitBlocked('workbook sheet budget exceeded');
    return book;
  }
  async table(book: CsvkitWorkbook, selection: string | number | null): Promise<readonly [string, TypedTable]> {
    const r = this.runtime;
    this.#date1904 = Boolean(book.Workbook?.WBProps?.date1904);
    const active = this.format === 'xls' ? 0 : Number(book.Workbook?.WBView?.[0]?.activeTab ?? 0);
    const name = typeof selection === 'string' ? selection : book.SheetNames[selection ?? active];
    if (name === undefined || !book.Sheets[name]) {
      if (typeof selection === 'number') throw new CsvkitDiagnostic('IndexError: list index out of range');
      if (this.format === 'xls') throw new CsvkitDiagnostic(`XLRDError: No sheet named <${repr(String(selection))}>`);
      throw new CsvkitDiagnostic(`KeyError: ${repr(`Worksheet ${selection} does not exist.`)}`);
    }
    const sheet = book.Sheets[name]!;
    const isoDates = this.#isoDates.get(name);
    const range = sheet['!ref'] ? utils.decode_range(sheet['!ref']) : undefined;
    const width = range ? range.e.c + 1 : 0;
    const end = range ? range.e.r + 1 : 0;
    if (width > r.context.limits.maxColumns || end > r.context.limits.maxRows) throw new CsvkitBlocked('workbook dimensions exceed row/column budget');
    const start = Math.max(0, Number(r.options.skip_lines));
    const headers = r.options.no_header_row ? defaultHeaders(width) : await normalizeHeaders(Array.from({ length: width }, (_, column) => {
      const cell = sheet[utils.encode_cell({ r: start, c: column })] as CsvkitWorkbookCell | undefined;
      return this.cell(cell, true, false, isoDates?.get(utils.encode_cell({ r: start, c: column }))) ?? '';
    }), r);
    const mixedColumns = new Set<number>();
    if (this.format === 'xls') {
      for (let column = 0; column < width; column++) {
        const types = new Set<string>();
        for (let row = start + (r.options.no_header_row ? 0 : 1); row < end; row++) {
          r.step();
          const cell = sheet[utils.encode_cell({ r: row, c: column })] as CsvkitWorkbookCell | undefined;
          if (cell && cell.v !== undefined && cell.v !== null && cell.t !== 'z') {
            types.add(cell.t === 'n' && cell.z && SSF.is_date(cell.z) ? 'date' : cell.t);
          }
        }
        if (types.size > 1) mixedColumns.add(column);
      }
    }
    const rows: (string | null)[][] = [];
    const timeColumns = new Set<number>();
    for (let row = start + (r.options.no_header_row ? 0 : 1); row < end; row++) {
      r.step(); r.retain(64 + width * 64);
      const cells = Array.from({ length: width }, (_, column) => {
        const address = utils.encode_cell({ r: row, c: column });
        r.step();
        const cell = sheet[address] as CsvkitWorkbookCell | undefined;
        const value = this.cell(cell, false, mixedColumns.has(column), isoDates?.get(address));
        const format = typeof cell?.z === 'number' ? SSF.get_table()[cell.z] : cell?.z;
        // Python time objects fall through Agate's inference to Text. Their
        // string representations would instead be inferred as TimeDelta.
        if (this.format === 'xlsx' && value?.[2] === ':' &&
          (isoDates?.has(address) || (cell?.t === 'n' && !xlsxElapsedFormat(format ?? 'General')))) timeColumns.add(column);
        return value;
      });
      r.admitRecord({ cells: cells.map(value => value ?? ''), line: row + 1 }); rows.push(cells);
    }
    const table = inputTable(r, headers, rows);
    if (!timeColumns.size || r.options.no_inference) return [name, table];
    const textOptions = { blanks: Boolean(r.options.blanks), nullValues: (r.options.null_values ?? []) as readonly string[] };
    return [name, {
      ...table,
      columns: table.columns.map((column, index) => timeColumns.has(index) ? { ...column, type: 'Text' } : column),
      rows: table.rows.map((row, index) => row.map((value, column) => timeColumns.has(column) ? castValue('Text', rows[index]![column]!, textOptions, r.step) : value))
    }];
  }
  cell(cell: CsvkitWorkbookCell | undefined, header = false, mixed = false, isoValue?: string): string | null {
    // SheetJS also permits a numeric built-in format ID in its cell API.
    // Resolve that ID through the reader's actual format table before inspection.
    const format = typeof cell?.z === 'number' ? SSF.get_table()[cell.z] : cell?.z;
    if (isoValue !== undefined) return workbookIsoValue(isoValue, header, format ?? 'General');
    if (!cell || cell.t === 'z' || cell.v === undefined || cell.v === null) return null;
    const value = cell.v;
    if (typeof value === 'number' && format && (this.format === 'xlsx' ? xlsxDateFormat(format, this.runtime) : SSF.is_date(format)) && !mixed && !(header && this.format === 'xls')) {
      return workbookDate(value, format, this.#date1904, header, this.format);
    }
    if (value instanceof Date) {
      throw new CsvkitBlocked('unexpected workbook reader Date object with raw-cell mode');
    }
    if (cell.t === 'e') return this.format === 'xls' ? String(value) : (cell.w ?? String(value));
    if (typeof value === 'boolean') return (header || mixed) && this.format === 'xls' ? String(Number(value)) : value ? 'True' : 'False';
    if (typeof value === 'number' && this.format === 'xls' && Number.isInteger(value)) return String(value) + '.0';
    return String(value);
  }
  async writeSheets(): Promise<void> {
    const r = this.runtime;
    const book = await this.open();
    const requested = String(r.options.write_sheets);
    const selections = requested === '-' ? (await this.open(true)).SheetNames : requested.split(',').map(value => {
      const numeric = value.length > 0 && Array.from(value).every(char => {
        const code = char.codePointAt(0)!;
        return decimalZeroes.some(zero => code >= zero && code < zero + 10) || nondecimalDigits.some(([low, high]) => code >= low && code <= high);
      });
      if (!numeric) return value;
      const index = integer(value);
      if (index === undefined) throw new CsvkitDiagnostic(`ValueError: invalid literal for int() with base 10: ${repr(value)}`);
      if (BigInt(index) > 9223372036854775807n) throw new CsvkitDiagnostic("IndexError: cannot fit 'int' into an index-sized integer");
      return Number(index);
    });
    const tables = new Map<string, TypedTable>();
    for (const selection of selections) { const [name, table] = await this.table(book, selection); tables.set(name, table); }
    const path = r.options.input_path as string | null;
    const base = !path || path === '-' ? 'stdin' : path.slice(0, path.length - pathExtension(path).length);
    let index = 0;
    for (const [name, table] of tables) {
      const filename = `${base}_${r.options.use_sheet_names ? name : index}.csv`; index++;
      const rows = function* () {
        const records = [table.headers, ...table.rows.map(csvifiedRow)];
        for (const [line, row] of records.entries()) {
          r.step(); const cells = r.options.line_numbers ? [line === 0 ? 'line_number' : line, ...row] : row;
          const next = writeCsvRow(cells); r.retain(next.length * 2); yield next;
        }
      };
      // Side files use the reference locale's UTF-8 text opening, independently of -e/BOM.
      await r.writeSideFile(filename, rows());
    }
  }
}
function workbookIsoValue(value: string, header: boolean, format: string): string {
  const raw = value.endsWith('Z') ? value.slice(0, -1) : value;
  const datetime = raw.includes('T');
  const [date, clock] = datetime ? raw.split('T') : raw.includes(':') ? ['', raw] : [raw, ''];
  if (!clock) return date!;
  const [time, fraction = ''] = clock.split('.');
  const normalized = time!.split(':').length === 2 ? time + ':00' : time!;
  const micros = fraction.slice(0, 3).padEnd(6, '0');
  const suffix = micros === '000000' ? '' : '.' + micros;
  if (!datetime) return normalized + suffix;
  if (!header && date === '1904-01-01' && !format.includes('d') && !format.includes('y')) return normalized + suffix;
  if (!header && normalized === '00:00:00' && !suffix) return date!;
  return date + ' ' + normalized + suffix;
}
/** Native readers convert cached serials; displayed text and recalculation are irrelevant. */
function workbookDate(serial: number, format: string, date1904: boolean, header: boolean, kind: 'xls' | 'xlsx'): string | null {
  if (!Number.isFinite(serial)) throw new CsvkitBlocked('invalid workbook date');
  // openpyxl's timedelta classifier considers only the first format section,
  // just as its date classifier does. Later sections cannot change raw types.
  if (kind === 'xlsx' && xlsxElapsedFormat(format)) {
    // timedelta first rounds the cached day fraction to microseconds; openpyxl
    // then rounds those microseconds to milliseconds with Python's half-even rule.
    const milliseconds = roundEven(roundEven(serial * 86400000000) / 1000);
    const days = Math.floor(milliseconds / 86400000);
    const rest = milliseconds - days * 86400000;
    const clock = new Date(rest).toISOString();
    const seconds = `${Number(clock.slice(11, 13))}${clock.slice(13, 19)}`;
    const fraction = clock.slice(20, 23) === '000' ? '' : '.' + clock.slice(20, 23) + '000';
    return `${days ? `${days} day${Math.abs(days) === 1 ? '' : 's'}, ` : ''}${seconds}${fraction}`;
  }
  if (kind === 'xls' && serial === 0) return null;
  let days = Math.floor(serial);
  // Preserve openpyxl's multiplication order: combining the two factors
  // changes binary half ties (for example a cached positive 1.5 millisecond).
  let milliseconds = kind === 'xlsx' ? roundEven((serial - days) * 86400 * 1000) : Math.round((serial - days) * 86400000);
  if (milliseconds === 86400000) { milliseconds = 0; days++; }
  // openpyxl treats every nonnegative serial below one as a time, even date styles.
  const timeOnly = kind === 'xlsx' && serial >= 0 && serial < 1 && days === 0;
  if (!date1904 && serial > 0 && serial < 60) days++;
  const date = new Date(Date.UTC(date1904 ? 1904 : 1899, date1904 ? 0 : 11, date1904 ? 1 : 30) + days * 86400000 + milliseconds);
  if (!Number.isFinite(date.getTime())) throw new CsvkitBlocked('invalid workbook date');
  const iso = date.toISOString();
  const fraction = kind === 'xls' || iso.slice(20, 23) === '000' ? '' : '.' + iso.slice(20, 23) + '000';
  const time = iso.slice(11, 19) + fraction;
  // Agate's 1904-01-01 time normalization applies to the decoded date under
  // either workbook epoch, and its format check is intentionally case-sensitive.
  if (timeOnly || (!header && kind === 'xlsx' && iso.slice(0, 10) === '1904-01-01' && !format.includes('d') && !format.includes('y'))) return time;
  if (!header && milliseconds === 0) return iso.slice(0, 10);
  return iso.slice(0, 10) + ' ' + time;
}
function roundEven(value: number): number {
  const lower = Math.floor(value);
  const fraction = value - lower;
  return fraction < 0.5 || (fraction === 0.5 && lower % 2 === 0) ? lower : lower + 1;
}
function xlsxElapsedFormat(format: string): boolean {
  const lower = format.split(';', 1)[0]!.toLowerCase();
  return ['[h]', '[hh]', '[m]', '[mm]', '[s]', '[ss]'].some(token => lower.includes(token));
}
/** openpyxl ignores all but the first section and strips quoted/bracketed text.
 * Its date tokens differ from the workbook reader's Excel display classifier.
 */
function xlsxDateFormat(format: string, runtime: Runtime): boolean {
  const section = format.indexOf(';');
  const end = section < 0 ? format.length : section;
  let previous = '';
  for (let index = 0; index < end; index++) {
    runtime.step();
    const char = format[index]!;
    if (char === '"' || char === '[') {
      const close = char === '"' ? '"' : ']';
      let last = index + 1;
      while (last < end && format[last] !== close && !(char === '"' && format[last] === '\n')) { runtime.step(); last++; }
      if (last < end && format[last] === close) {
        const bracket = char === '[' ? format.slice(index + 1, last) : '';
        // openpyxl's stripping exceptions are deliberately case-sensitive.
        if (!['h', 'hh', 'm', 'mm', 's', 'ss'].includes(bracket)) { index = last; continue; }
      }
    }
    if ('dmhysDMHYS'.includes(char) && previous !== '_' && previous !== '\\') return true;
    previous = char;
  }
  return false;
}
function unicodeBiff(bytes: Uint8Array): boolean {
  const stream = workbookBiffStream(bytes);
  return stream.length >= 6 && (stream[4]! | stream[5]! << 8) === 0x0600;
}
function workbookBiffStream(bytes: Uint8Array): ArrayLike<number> {
  let stream: ArrayLike<number> = bytes;
  if (bytes[0] === 208) {
    const cfb = CFB as { read(data: Uint8Array, options: { type: 'array' }): { FileIndex: readonly { name: string; content: ArrayLike<number> }[] } };
    stream = cfb.read(bytes, { type: 'array' }).FileIndex.find(entry => entry.name === 'Workbook' || entry.name === 'Book')?.content ?? bytes;
  }
  return stream;
}
function xlsCodepage(encoding: string): number {
  const names: Readonly<Record<string, number>> = { 'ascii': 20127, 'utf-8': 65001, 'utf8': 65001, 'latin1': 28591, 'latin-1': 28591, 'cp1252': 1252, 'windows-1252': 1252, 'cp437': 437, 'cp850': 850, 'cp932': 932 };
  const codepage = names[encoding.toLowerCase()];
  if (codepage === undefined) throw new CsvkitBlocked(`XLS encoding ${encoding}`);
  return codepage;
}

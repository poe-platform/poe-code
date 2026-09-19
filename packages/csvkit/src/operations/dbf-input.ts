import type { Runtime } from '../runtime.js';
import { CsvkitBlocked, CsvkitDiagnostic } from '../errors.js';
import { repr } from '../cli/parser.js';
import { resolveCodec, normalizeEncoding } from '../codecs/python.js';
import { pythonCodecAliases } from '../codecs/aliases.js';
import { PythonException } from '../diagnostics/index.js';
import { normalizeHeaders } from '../table/headers.js';
import { csvifiedRow } from './input-table.js';
import { dbfFile } from './dbf-files.js';
import { openDbfMemo } from './dbf-memo.js';
import { parseDbfField, type DbfField, type DbfValue } from './dbf-fields.js';
import { dbfTable } from './dbf-table.js';

/** csvkit reopens input_file.name, ignoring its encoding and parsed text bytes. */
export async function dbfConversion(r: Runtime): Promise<number> {
  const input = r.options.input_path as string | null; const path = !input || input === '-' ? '<stdin>' : input;
  const validateEncoding = (): void => {
    const encoding = String(r.options.encoding ?? 'utf-8-sig');
    if (!Object.hasOwn(pythonCodecAliases, normalizeEncoding(encoding))) resolveCodec(r.context.codecs, encoding);
  };
  if (!input || input === '-') validateEncoding();
  const file = await dbfFile(r, path, Boolean(input && input !== '-'));
  if (!file) {
    if (input && input !== '-') throw new PythonException('FileNotFoundError', `[Errno 2] No such file or directory: ${repr(input)}`);
    throw new CsvkitDiagnostic(`DBFNotFound: could not find file ${repr(path)}`);
  }
  validateEncoding();
  const bytes = file.bytes;
  if (bytes.length < 32) throw new CsvkitDiagnostic('error: unpack requires a buffer of 32 bytes');
  const view = new DataView(bytes.buffer); const start = view.getUint16(8, true); const width = view.getUint16(10, true); const version = bytes[0]!;
  const encodingByLanguage: Readonly<Record<number, string>> = {
    0:'ascii',1:'cp437',2:'cp850',3:'cp1252',4:'mac_roman',8:'cp865',9:'cp437',10:'cp850',11:'cp437',13:'cp437',14:'cp850',15:'cp437',16:'cp850',17:'cp437',18:'cp850',19:'cp932',20:'cp850',21:'cp437',22:'cp850',23:'cp865',24:'cp437',25:'cp437',26:'cp850',27:'cp437',28:'cp863',29:'cp850',31:'cp852',34:'cp852',35:'cp852',36:'cp860',37:'cp850',38:'cp866',55:'cp850',64:'cp852',77:'cp936',78:'cp949',79:'cp950',80:'cp874',87:'cp1252',88:'cp1252',89:'cp1252',100:'cp852',101:'cp866',102:'cp865',103:'cp861',106:'cp737',107:'cp857',120:'cp950',121:'cp949',122:'cp936',123:'cp932',124:'cp874',125:'cp1255',126:'cp1256',150:'mac_cyrillic',151:'mac_latin2',152:'mac_greek',200:'cp1250',201:'cp1251',202:'cp1254',203:'cp1253'
  };
  const codec = resolveCodec(r.context.codecs, encodingByLanguage[bytes[29]!] ?? 'ascii');
  let codepoints = 0;
  const decode = async (data: Uint8Array): Promise<string> => {
    const text = await codec.codec.decode(data, codec.encoding, r.context.signal);
    r.step(); r.retain(text.length * 2 + 32);
    let characters = 0;
    for (let offset = 0; offset < text.length; offset += text.codePointAt(offset)! > 65535 ? 2 : 1) {
      r.step(); characters++; codepoints++;
      if (codepoints > r.context.limits.maxCodepoints) throw new CsvkitBlocked('DBF codepoint budget exceeded');
      if (characters > r.context.limits.maxFieldCharacters) throw new CsvkitBlocked('DBF field character budget exceeded');
    }
    return text;
  };
  const fields: DbfField[] = [];
  for (let position = 32; position < bytes.length && ![13,10].includes(bytes[position]!); position += 32) {
    r.step(); if (position + 32 > bytes.length) throw new CsvkitDiagnostic('error: unpack requires a buffer of 32 bytes');
    let end = position; while (end < position + 11 && bytes[end]) end++;
    const type = String.fromCharCode(bytes[position + 11]!);
    const length = bytes[position + 16]! + (type === 'C' ? bytes[position + 17]! * 256 : 0);
    fields.push({ name: await decode(bytes.subarray(position, end)), type, length });
    if (fields.length > r.context.limits.maxColumns) throw new CsvkitBlocked('DBF column budget exceeded');
  }
  for (const field of fields) {
    if ((field.type === 'I' && field.length !== 4) || (field.type === 'L' && field.length !== 1))
      throw new CsvkitDiagnostic(`ValueError: Field type ${field.type} must have length ${field.type === 'I' ? 4 : 1} (was ${field.length})`);
    if (!'0CDFILMNOBGPTY+@V'.includes(field.type)) throw new CsvkitDiagnostic(`ValueError: Unknown field type: ${repr(field.type)}`);
  }
  const memo = fields.some(field => 'MGPB'.includes(field.type)) ? await openDbfMemo(r, file.path, version) : undefined;
  const rows: DbfValue[][] = [];
  // load=True reads active records first and parses deleted records on a second pass.
  for (const marker of [32,42]) {
    let position = start;
    while (position < bytes.length && bytes[position] !== 26) {
      r.step(); const separator = bytes[position++]!;
      if (separator !== marker) {
        if (width < 1) throw new CsvkitBlocked('DBF non-progressing record layout');
        position += width - 1; continue;
      }
      const row: DbfValue[] = [];
      for (const field of fields) {
        const data = bytes.subarray(position, Math.min(bytes.length, position + field.length)); position += data.length;
        const value = await parseDbfField(field, data, version, decode, memo, r);
        row.push(value);
      }
      const cells = row.map(value => value === null ? '' : typeof value === 'object' ? value.value : String(value));
      r.retain(64 + row.length * 64 + cells.reduce((size, value) => size + value.length * 2, 0));
      r.admitRecord({ cells, line: rows.length + 1 });
      if (marker === 32) rows.push(row);
    }
  }
  const headers = await normalizeHeaders(fields.map(field => field.name), r);
  const table = dbfTable(r, headers, rows);
  await r.row(table.headers);
  for (const row of table.rows) await r.row(csvifiedRow(row));
  return 0;
}

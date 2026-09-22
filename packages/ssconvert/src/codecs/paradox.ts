// Gnumeric 1.12.61 plugins/paradox/paradox.c and pxlib 0.6.8 file format.
import { SsconvertError, type CapabilityContext } from "../contracts.js";
import { type Cell, type CellValue, type Workbook } from "../workbook.js";
import { databaseInput, databaseText, databaseNumber, databaseNumeric } from "./database-support.js";
import { recordSheet, enteredRecord } from "./record-text.js";
import { renderCellText } from "../formatting.js";
import { encodeText } from "../encoding/encode.js";
import { decryptParadoxBlocks } from "./paradox-encryption.js";

interface Field { name: string; type: number; length: number; precision: number }
const fieldLetters = "?ADSI$N??L??MBFOG???T@+#Y";
const fieldTypes: Readonly<Record<string, readonly [number, number]>> = {
  S:[3,2], I:[4,4], A:[1,0], C:[1,0], N:[6,8], "$": [5,8], L:[9,1], D:[2,4],
  "+":[22,4], "@":[21,8], T:[20,4], "#":[23,17], M:[12,0], B:[13,0], F:[14,0], Y:[24,0]
};
const dataHeaderTypes = [0,2,3,5,6,8];

function integerText(text: string): number {
  let offset = 0;
  while (offset < text.length && " \t\n\r\v\f".includes(text[offset]!)) offset++;
  const start = offset;
  if (text[offset] === "+" || text[offset] === "-") offset++;
  if (!text[offset] || !"0123456789".includes(text[offset]!)) return 0;
  return Number.parseInt(text.slice(start), 10) || 0;
}

function signed(raw: Uint8Array): number | undefined {
  if (raw.every(b => b === 0)) return undefined;
  const bytes = new Uint8Array(raw); bytes[0] = bytes[0]! ^ 128;
  const view = new DataView(bytes.buffer);
  return bytes.length === 1 ? view.getInt8(0) : bytes.length === 2 ? view.getInt16(0) : view.getInt32(0);
}
function real(raw: Uint8Array): number | undefined {
  if (raw.every(b => b === 0)) return undefined;
  const bytes = new Uint8Array(raw);
  if (bytes[0]! & 128) bytes[0] = bytes[0]! & 127;
  else for (let i = 0; i < 8; i++) bytes[i] = bytes[i]! ^ 255;
  return new DataView(bytes.buffer).getFloat64(0);
}
function bcd(raw: Uint8Array, precision: number): string | undefined {
  if (!raw[0] || (raw[0] & 63) !== precision) return undefined;
  const negative = !(raw[0] & 128), digits: string[] = [];
  for (let i = 2; i < 34; i++) digits.push(String.fromCharCode(48 + ((i % 2 ? raw[i >> 1]! & 15 : raw[i >> 1]! >> 4) ^ (negative ? 15 : 0))));
  let whole = digits.slice(0, 32 - precision).join("");
  while (whole.length > 1 && whole[0] === "0") whole = whole.slice(1);
  return `${negative ? "-" : ""}${whole || "0"}.${digits.slice(32 - precision).join("")}`;
}

export async function readParadox(bytes: Uint8Array, context: CapabilityContext): Promise<Workbook> {
  const input = databaseInput(bytes, context), cells: Cell[] = [];
  let view = input.view;
  async function warning(message: string) { await context.diagnostic?.({ code: "paradox", severity: "warning", message }); }
  async function fail(message: string): Promise<never> {
    await warning(message); await warning("Unable to get header.");
    throw new SsconvertError("io", "E Error while opening Paradox file.");
  }
  if (bytes.length < 88) return fail("Could not read header from paradox file.");
  const type = bytes[4]!, tableSize = bytes[5]!, version = bytes[57]!;
  if (type > 8) return fail(`Paradox file has unknown file type (${type}).`);
  if (tableSize < 1 || tableSize > 32) return fail(`Paradox file has unknown table size (${tableSize}).`);
  if (version < 3 || version > 15) return fail(`Paradox file has unknown file version (0x${version.toString(16).toUpperCase()}).`);
  const length = view.getUint16(0, true), header = view.getUint16(2, true), records = view.getUint32(6, true);
  if (!length) return fail("Paradox file has zero record size.");
  if (!header) return fail("Paradox file has zero header size.");
  const count = view.getUint16(33, true), blockCount = view.getUint16(12, true), blockSize = tableSize * 1024;
  const dataHeader = dataHeaderTypes.includes(type) && version >= 5 && version <= 12;
  let at = dataHeader ? 120 : 88;
  if (header > bytes.length || at + count * 2 + 4 > header) return fail("Could not read header from paradox file.");
  let encryption = view.getUint32(37, true);
  if (encryption === 0xff00ff00) {
    if (!dataHeader) return fail("Paradox encryption header is missing.");
    encryption = view.getUint32(92, true);
  }
  if (encryption) {
    bytes = await decryptParadoxBlocks(bytes, header, blockSize, encryption, context);
    view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  }
  const codepage = dataHeader ? view.getUint16(106, true) : 0;
  const fields: Field[] = [];
  for (let i = 0; i < count; i++, at += 2) {
    await input.tick();
    const fieldType = bytes[at]!, size = bytes[at + 1]!;
    fields.push({ type: fieldType, length: fieldType === 23 ? 17 : size, precision: fieldType === 23 ? size : 0, name: "" });
  }
  at += 4 + (dataHeaderTypes.includes(type) ? count * 4 : 0);
  const nameLength = version === 12 ? 261 : 79;
  if (at + nameLength > header) return fail("Could not read header from paradox file.");
  const tableName = bytes.subarray(at, at + nameLength), tableEnd = tableName.indexOf(0);
  const name = new TextDecoder().decode(tableName.subarray(0, tableEnd < 0 ? tableName.length : tableEnd)) || "Sheet1"; at += nameLength;
  for (const [column, field] of fields.entries()) {
    let end = at; while (end < header && end - at < 299 && bytes[end] !== 0) end++;
    if (end >= header) return fail("Could not read header from paradox file.");
    field.name = new TextDecoder().decode(bytes.subarray(at, end)); at = end + 1;
    const text = `${field.name},${fieldLetters[field.type] ?? "?"},${field.type === 23 ? field.precision : field.length}`;
    // Native snprintf's 30-byte destination includes the terminating zero.
    const cell = enteredRecord(new TextDecoder().decode(new TextEncoder().encode(text).subarray(0, 29)), 0, column, context);
    input.add(cells, 0, column, cell.value, { ...cell, style: { ...cell.style, bold: true } });
  }
  const total = fields.reduce((sum, f) => sum + f.length, 0) + (type === 1 ? 6 : 0);
  if (total > length || length > blockSize - 6) return fail("Could not read record from paradox file.");
  if (dataHeaderTypes.includes(type)) {
    let number = view.getUint16(14, true), counted = 0;
    for (let step = 0; step < blockCount && number; step++) {
      await input.tick(); const start = header + (number - 1) * blockSize;
      if (start + 6 > bytes.length) break;
      counted += Math.floor(view.getUint16(start + 4, true) / length) + 1;
      number = view.getUint16(start, true);
    }
    if (counted !== records) await warning(`Number of records counted in blocks does not match number of records in header (${counted} != ${records})`);
  }
  if (codepage === 0) await warning("Target encoding could not be set.");
  let block = view.getUint16(14, true), row = 1;
  const visited = new Set<number>();
  for (let step = 0; step < blockCount && block && row <= records; step++) {
    await input.tick();
    if (visited.has(block) || block > blockCount) { await warning(`Could not get head of data block nr. ${block}.`); break; }
    visited.add(block);
    const start = header + (block - 1) * blockSize;
    if (start + 6 > bytes.length) { await warning(`Could not get head of data block nr. ${block}.`); break; }
    const used = view.getUint16(start + 4, true), next = view.getUint16(start, true);
    if (type !== 1 || used + length <= blockSize - 6) {
      for (let offset = 0; offset <= used && row <= records; offset += length, row++) {
        await input.tick();
        const record = start + 6 + offset;
        if (record + length > bytes.length || record + length > start + blockSize) { await warning(`Could not read record ${row - 1}.`); break; }
        let position = record;
        for (const [column, field] of fields.entries()) {
          await input.tick();
          const raw = bytes.subarray(position, position + field.length); position += field.length;
          let value: CellValue | undefined, format: string | undefined;
          if (field.type === 1 && raw[0]) {
            try { value = { kind: "string", value: databaseText(raw, codepage) }; }
            catch (error) { if (!(error instanceof RangeError)) throw error; }
          } else if ([2,3,4,9,20,22].includes(field.type)) {
            const expected = field.type === 9 ? 1 : field.type === 3 ? 2 : 4;
            if (raw.length < expected) { await warning("Could not read record from paradox file."); continue; }
            const number = signed(raw.subarray(0, expected));
            if (number !== undefined) {
              if (field.type === 9) value = { kind: "boolean", value: number !== 0 };
              else if (field.type === 20) { value = databaseNumber(number / 86400000); format = "h:mm:ss"; }
              else if (field.type === 2) { const serial = number - 693594; value = databaseNumber(serial <= 60 ? serial - 1 : serial); format = "m/d/yy"; }
              else value = databaseNumber(number);
            }
          } else if ([5,6,21].includes(field.type)) {
            if (raw.length < 8) { await warning("Could not read record from paradox file."); continue; }
            const number = real(raw.subarray(0, 8));
            if (number !== undefined) {
              value = databaseNumber(field.type === 21 ? number / 86400000 - 693594 : number);
              format = field.type === 5 ? "$#,##0.00" : field.type === 21 ? "m/d/yy h:mm" : undefined;
            }
          } else if (field.type === 23) {
            const text = bcd(raw, field.precision); if (text !== undefined) value = { kind: "string", value: text };
          } else if (field.type === 12) {
            if (raw.length < 10) { await warning("Could not read record from paradox file."); continue; }
            const size = new DataView(raw.buffer, raw.byteOffset, raw.length).getUint32(raw.length - 6, true);
            if (size && size <= raw.length - 10) value = { kind: "string", value: databaseText(raw.subarray(0, size), 28591) };
            else if (size) await warning("Blob data is not contained in record and a blob file is not set.");
          } else if (field.type !== 1) value = { kind: "string", value: `Field type ${field.type} is not supported.` };
          if (row < 65536 && column < 256) input.add(cells, row, column, value, format ? { format } : {});
        }
        if (type === 1 && row < 65536) {
          for (let i = 0; i < 3; i++) {
            const number = signed(bytes.subarray(position + 2 * i, position + 2 * i + 2));
            input.add(cells, row, count + i, number === undefined ? undefined : databaseNumber(number));
          }
          input.add(cells, row, count + 3, databaseNumber(block));
        }
      }
    }
    block = next;
  }
  return { sheets: [{ id: name, name, size: { columns: 256, rows: 65536 }, cells }], activeSheet: name };
}

export async function writeParadox(book: Workbook, _options: readonly string[], context: CapabilityContext): Promise<Uint8Array> {
  const sheet = recordSheet(book), input = databaseInput(new Uint8Array(), context);
  const cells = new Map<string, Cell>(); let endRow = 0, endColumn = 0, startRow = Infinity;
  async function warning(message: string) { await context.diagnostic?.({ code: "paradox", severity: "warning", message }); }
  for (const cell of sheet.cells) {
    await input.tick(); cells.set(`${cell.row}:${cell.column}`, cell);
    if ((cell.cachedResult ?? cell.value).kind !== "blank") { endRow = Math.max(endRow, cell.row); endColumn = Math.max(endColumn, cell.column); startRow = Math.min(startRow, cell.row); }
  }
  const fields: Field[] = [];
  if (endColumn >= context.limits.cells) throw new SsconvertError("resource-limit", "ssconvert database cells limit exceeded");
  for (let column = 0; column <= endColumn; column++) {
    await input.tick(); const cell = cells.get(`0:${column}`);
    if (!cell || (cell.cachedResult ?? cell.value).kind === "blank") throw new SsconvertError("io", "E First line of sheet must contain database specification.");
    const text = await renderCellText(cell, book, context, "preserve"), comma = text.indexOf(",");
    if (comma < 0) { await warning("Field specification must be a comma separated value (Name,Type,Size,Prec)."); return new Uint8Array(); }
    const spec = text.slice(comma + 1), letter = spec[0];
    if (!letter || letter === ",") { await warning(`${column}. field specification ${letter === "," ? "misses type" : "ended unexpectedly"}.`); return new Uint8Array(); }
    const mapping = fieldTypes[letter];
    if (!mapping) { await warning(`${column}. field type '${letter}' is unknown.`); return new Uint8Array(); }
    const [type, fixed] = mapping;
    let length = fixed, precision = 0;
    if (!fixed || type === 23) {
      const sizeAt = spec.indexOf(","), sizeText = sizeAt < 0 ? "" : spec.slice(sizeAt + 1), size = parseInt(sizeText, 10);
      if (!Number.isFinite(size)) { await warning("Field specification misses the column size."); return new Uint8Array(); }
      let digits = 0; while (digits < sizeText.length && " \t\r\n".includes(sizeText[digits]!)) digits++;
      if (sizeText[digits] === "+" || sizeText[digits] === "-") digits++;
      while (digits < sizeText.length && "0123456789".includes(sizeText[digits]!)) digits++;
      if (digits < sizeText.length) await warning(`The remainder '${sizeText.slice(digits + 1)}' of the specification for field ${column + 1} is being disregarded.`);
      if (type === 23) precision = size; else length = size;
    }
    if (length < 1 || length > 255 || precision < 0 || precision > 32 || ([12,13,14].includes(type) && length < 10))
      throw new SsconvertError("unsupported-feature", "Unsupported ssconvert feature: invalid Paradox field dimensions");
    fields.push({ name: text.slice(0, comma), type, length, precision });
  }
  const length = fields.reduce((n, f) => n + f.length, 0), tableSize = length < 80 ? 2 : length < 140 ? 3 : 16;
  if (length > tableSize * 1024 - 6) throw new SsconvertError("unsupported-feature", "Unsupported ssconvert feature: Paradox record exceeds block size");
  const names = fields.map(f => encodeText(f.name + "\0", "UTF-8", false, context));
  const approximate = 120 + fields.length * 10 + 269 + names.reduce((n, b) => n + b.length, 0) + 8;
  const header = (Math.floor(approximate / 2048) + 1) * 2048, blockSize = tableSize * 1024;
  const perBlock = Math.floor((blockSize - 6) / length), records = Math.max(0, endRow - (startRow === Infinity ? 0 : startRow));
  const blocks = Math.ceil(records / perBlock), outputLength = header + blocks * blockSize;
  if (blocks > 65535 || header > 65535 || length > 65535 || outputLength > context.limits.outputBytes)
    throw new SsconvertError("resource-limit", "ssconvert output bytes limit exceeded");
  const bytes = new Uint8Array(outputLength), view = new DataView(bytes.buffer);
  view.setUint16(0, length, true); view.setUint16(2, header, true); bytes[4] = 2; bytes[5] = tableSize;
  view.setUint32(6, records, true);
  for (const at of [10,12,16,58]) view.setUint16(at, blocks, true);
  view.setUint16(14, blocks ? 1 : 0, true); view.setUint16(33, fields.length, true);
  view.setUint32(37, 0xff00ff00, true); bytes[45] = 2; bytes[46] = 1; bytes[57] = 12;
  bytes[62] = 31; bytes[63] = 15; bytes[86] = 32;
  view.setUint16(88, 0x010c, true); view.setUint16(90, 0x010c, true);
  view.setUint32(96, Math.floor((context.clock?.now() ?? 0) / 1000), true);
  view.setUint16(100, fields.length + 1, true); view.setUint16(106, 1252, true); bytes[108] = 1; bytes[109] = 1;
  let at = 120;
  for (const f of fields) { bytes[at++] = f.type; bytes[at++] = f.type === 23 ? f.precision : f.length; }
  at += 4 + fields.length * 4;
  bytes.set(new TextEncoder().encode(sheet.name).subarray(0,260), at); at += 261;
  for (const name of names) { bytes.set(name, at); at += name.length; }
  for (let i = 0; i < fields.length; i++) { view.setUint16(at, i + 1, true); at += 2; }
  bytes.set(new TextEncoder().encode("ANSIINTL"), at); at += 9; view.setUint16(81, at, true);
  for (let block = 0; block < blocks; block++) {
    const start = header + block * blockSize, count = Math.min(perBlock, records - block * perBlock);
    view.setUint16(start, block + 1 < blocks ? block + 2 : 0, true); view.setUint16(start + 2, block, true);
    view.setInt16(start + 4, (count - 1) * length, true);
    for (let record = 0; record < count; record++) {
      const row = (startRow === Infinity ? 0 : startRow) + 1 + block * perBlock + record;
      let position = start + 6 + record * length;
      for (const [column, field] of fields.entries()) {
        await input.tick(); const cell = cells.get(`${row}:${column}`), value = cell?.cachedResult ?? cell?.value;
        const raw = bytes.subarray(position, position + field.length), data = new DataView(raw.buffer, raw.byteOffset, raw.length); position += field.length;
        if (!value || value.kind === "blank") continue;
        const text = await renderCellText(cell!, book, context, "preserve");
        const integer = [2,3,4,22].includes(field.type);
        let number = value.kind === "number" ? value.value : value.kind === "boolean" ? Number(value.value) : value.kind === "string" ? integer ? integerText(value.value) : databaseNumeric(value.value) : 0;
        if ([2,3,4,9,20,22].includes(field.type)) {
          if (field.type === 2) { number = Math.trunc(number); number += (number < 60 ? 1 : 0) + 693594; }
          if (field.type === 20) number = Math.trunc((number - Math.trunc(number)) * 86400000);
          if (field.type === 9) { data.setInt8(0, value.kind === "string" ? Number(value.value.toLowerCase() === "true") : Number(number !== 0)); }
          else if (field.type === 3) data.setInt16(0, Math.trunc(number)); else data.setInt32(0, Math.trunc(number));
          raw[0] = raw[0]! ^ 128;
        } else if ([5,6,21].includes(field.type)) {
          if (field.type === 21) number = (number + (number < 60 ? 1 : 0) + 693594) * 86400000;
          data.setFloat64(0, number);
          if (number >= 0) raw[0] = raw[0]! | 128; else for (let i = 0; i < 8; i++) raw[i] = raw[i]! ^ 255;
        } else if (field.type === 1) {
          const nlen = new TextEncoder().encode(text).length;
          if (nlen > field.length) await warning(`Field ${column + 1} in line ${row + 1} has possibly been cut off. Data has ${nlen} ${nlen === 1 ? "character" : "characters"}.`);
          try { raw.set(encodeText(text, "CP1252", false, context).subarray(0, field.length)); }
          catch (error) { if (!(error instanceof SsconvertError) || error.code === "resource-limit") throw error; /* pxlib leaves null on conversion loss. */ }
        } else if (field.type === 23) {
          const negative = text.startsWith("-"), sign = negative ? 15 : 0, point = text.indexOf(".");
          raw.fill(negative ? 255 : 0); raw[0] = (negative ? 64 : 192) + field.precision;
          const whole = point < 0 ? text.slice(0, field.precision) : text.slice(0, point), fraction = point < 0 ? "" : text.slice(point + 1);
          const integral = field.precision === 32 ? "" : whole.split("").filter(c => "0123456789".includes(c)).join("").padStart(32 - field.precision,"0").slice(-(32 - field.precision));
          const digits = integral + fraction.padEnd(field.precision,"0").slice(0,field.precision);
          for (let i = 0; i < 32; i++) {
            const nibble = (Number(digits[i]) || 0) ^ sign, index = (i + 2) >> 1;
            raw[index] = i % 2 ? (raw[index]! & 240) | nibble : (raw[index]! & 15) | (nibble << 4);
          }
        } else if (field.type === 12 || field.type === 14) {
          const blob = new TextEncoder().encode(text);
          if (blob.length > raw.length - 10) { await warning("Paradox database has no blob file."); await warning(`Field ${column + 1} in row ${row + 1} could not be written.`); }
          else { raw.set(blob); data.setUint32(raw.length - 6, blob.length, true); }
        }
      }
    }
  }
  return bytes;
}

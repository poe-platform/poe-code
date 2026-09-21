// Released Gnumeric 1.12.61 plugins/xbase/{xbase,boot}.c, GPL-2.0-or-later.
import { SsconvertError, type CapabilityContext } from "../contracts.js";
import { type Cell, type CellValue, type Workbook } from "../workbook.js";
import { databaseInput, databaseText, databaseNumber, databaseDate, databaseNumeric } from "./database-support.js";
import { enteredRecord } from "./record-text.js";

const codepages: Readonly<Record<number, number>> = {
  1:437,2:850,3:1252,4:10000,8:865,9:437,10:850,11:437,13:437,14:850,15:437,16:850,17:437,18:850,
  19:932,20:850,21:437,22:850,23:865,24:437,25:437,26:850,27:437,28:863,29:850,31:852,34:852,35:852,
  36:860,37:850,38:866,55:850,64:852,77:936,78:949,79:950,80:874,87:1252,88:1252,89:1252,100:852,
  101:866,102:865,103:861,104:895,105:620,106:737,107:857,108:863,120:950,121:949,122:936,123:932,
  124:874,125:1255,126:1256,134:737,135:852,136:857,150:10007,151:10029,152:10006,200:1250,201:1251,
  202:1254,203:1253,204:1257
};

export async function readXbase(bytes: Uint8Array, context: CapabilityContext): Promise<Workbook> {
  const input = databaseInput(bytes, context), cells: Cell[] = [];
  const warning = async (message: string) => { await context.diagnostic?.({ code: "xbase", severity: "warning", message }); };
  if (bytes.length < 32) throw new SsconvertError("io", "E Error while opening xbase file.\n  E Failed to read DBF header.");
  if (![2,3,0x30,0x43,0x63,0x83,0x8b,0xcb,0xf5,0xfb].includes(bytes[0]!)) await warning(`unknown 0x${bytes[0]!.toString(16)}`);
  const records = input.view.getUint32(4, true), header = input.view.getUint16(8, true), length = input.view.getUint16(10, true);
  let codepage = codepages[bytes[29]!];
  if (codepage !== undefined && [895,620,10029,10006].includes(codepage)) {
    await warning(`Unable to open an iconv handle from codepage ${codepage} -> UTF-8`);
    codepage = undefined;
  }
  if (codepage === undefined) await warning(`File has unknown or missing code page information (${bytes[29]!.toString(16)})`);
  const fields: { name: string; type: string; length: number; position: number }[] = [];
  let position = 0;
  for (let at = 32; fields.length < 16384; at += 32) {
    await input.tick();
    if (at + 2 > bytes.length) { await warning("xbase_field_new: fread error"); break; }
    if (bytes[at] === 0 || bytes[at] === 13) break;
    if (at + 32 > bytes.length) { await warning("Field descriptor short"); break; }
    const name = databaseText(bytes.subarray(at, at + 10), 28591), type = String.fromCharCode(bytes[at + 11]!);
    const size = bytes[at + 16]!;
    if (!"CNLDMF?BGPYTI".includes(type)) await warning(`Unrecognised field type '${type}'`);
    if (position + size >= length) { await warning(`Field '${name}' (at pos ${position}, len ${size}) exceeds record size (${length})`); break; }
    fields.push({ name, type, length: size, position }); position += size;
  }
  for (const [column, field] of fields.entries()) {
    const cell = enteredRecord(field.name, 0, column, context);
    input.add(cells, 0, column, cell.value, { ...cell, style: { ...cell.style, bold: true } });
  }
  let row = 0;
  for (let record = 0; record < records; record++) {
    await input.tick(); const at = header + record * length;
    if (!length || at + length > bytes.length) break;
    if (bytes[at] === 42) continue;
    if (++row >= 1048576) break;
    for (const [column, field] of fields.entries()) {
      await input.tick();
      const raw = bytes.subarray(at + 1 + field.position, at + 1 + field.position + field.length);
      const text = databaseText(raw, 28591);
      let value: CellValue | undefined;
      if (field.type === "C") {
        let end = raw.indexOf(0); if (end < 0) end = raw.length;
        while (end && [9,10,11,12,13,32].includes(raw[end - 1]!)) end--;
        try { value = { kind: "string", value: databaseText(raw.subarray(0, end), codepage ?? 28591) }; }
        catch (error) {
          if (!(error instanceof RangeError)) throw error;
          await warning("Unrepresentable characters replaced by '?'");
          value = { kind: "string", value: Array.from(raw.subarray(0, end), b => b >= 127 ? "?" : String.fromCharCode(b)).join("") };
        }
      } else if (field.type === "N") value = databaseNumber(databaseNumeric(text));
      else if (field.type === "L") {
        if ("YyTt".includes(text[0] ?? "\0")) value = { kind: "boolean", value: true };
        else if ("NnFf".includes(text[0] ?? "\0")) value = { kind: "boolean", value: false };
        else if (text[0] !== " " && text[0] !== "?") await warning("Invalid logical value.  File is probably corrupted.");
      } else if (field.type === "D") {
        if (text !== "00000000") {
          const date = databaseDate(Number(text.slice(0,4)), Number(text.slice(4,6)), Number(text.slice(6,8)));
          value = date === undefined ? { kind: "string", value: text } : databaseNumber(date);
        }
      } else if (field.type === "I" || field.type === "F" || field.type === "B") {
        if (field.type === "B") await warning('FIXME: "BINARY" field type doesn\'t work');
        if (raw.length !== (field.type === "I" ? 4 : 8)) await warning("Invalid field length.  File is probably corrupted.");
        else {
          // The released importer first g_strndup's every field; strncpy pads
          // binary bytes after the first NUL, too. Preserve that observable quirk.
          const copied = new Uint8Array(raw), nul = copied.indexOf(0);
          if (nul >= 0) copied.fill(0, nul);
          const view = new DataView(copied.buffer);
          value = databaseNumber(field.type === "I" ? view.getInt32(0, true) : field.type === "F" ? view.getFloat64(0, true) : Number(view.getBigInt64(0, true)));
        }
      } else value = { kind: "string", value: `Field type '0x${field.type.charCodeAt(0).toString(16).padStart(2,"0")}' unsupported` };
      input.add(cells, row, column, value, field.type === "D" ? { format: "m/d/yy" } : {});
    }
  }
  let columns = 256, rows = 65536;
  while (columns < fields.length) columns *= 2;
  while (rows <= row) rows *= 2;
  return { sheets: [{ id: "Sheet1", name: "Sheet1", size: { columns, rows }, cells }], activeSheet: "Sheet1" };
}

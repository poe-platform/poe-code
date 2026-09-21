import { SsconvertError, type CapabilityContext } from "../contracts.js";
import type { Workbook, Cell, CellValue, FormulaGroup } from "../workbook.js";
import { encodeText } from "../encoding/encode.js";
import { BiffOutput, words } from "./biff-write-binary.js";
import { biffErrors } from "./biff-formulas.js";
import { BiffFormulaWriter, type CompiledBiffFormula } from "./biff-write-formulas.js";
import { BiffStyles } from "./biff-write-styles.js";
import { BiffMetadataWriter } from "./biff-write-metadata.js";
import { singleByteTables } from "../encoding/tables.js";

export function biffString(text: string, revision: 7 | 8, context: CapabilityContext, width: 1 | 2 = 2): Uint8Array {
  const legacy = singleByteTables["windows-1252"]!;
  context.signal.throwIfAborted();
  if (text.length > context.limits.outputBytes) throw new SsconvertError("resource-limit", "ssconvert BIFF string bytes limit exceeded");
  const nul = text.indexOf("\0"), source = nul < 0 ? text : text.slice(0, nul);
  const data = revision === 8 ? encodeText(source, "UTF-16LE", false, context) :
    new Uint8Array(Array.from(source, character => { const byte = legacy.indexOf(character); return byte < 0 ? 63 : byte; }));
  const length = revision === 8 ? data.length / 2 : data.length;
  if (length > (width === 1 ? 255 : 65535)) throw new SsconvertError("unsupported-feature", "Excel BIFF string is too long");
  const result = new Uint8Array(width + (revision === 8 ? 1 : 0) + data.length), view = new DataView(result.buffer);
  if (width === 1) result[0] = length; else view.setUint16(0, length, true);
  if (revision === 8) result[width] = 1;
  result.set(data, width + (revision === 8 ? 1 : 0)); return result;
}

export function biffError(value: string): number {
  return Number(Object.entries(biffErrors).find(([, text]) => text === value)?.[0] ?? 15);
}

function bof(revision: 7 | 8, type: number): Uint8Array {
  return revision === 8 ? words(0x600, type, 0x1bb5, 0x07cd, 0x00c1, 0, 6, 0) : words(0x500, type, 0x096c, 0x07c9);
}

function join(a: Uint8Array, b: Uint8Array): Uint8Array {
  const bytes = new Uint8Array(a.length + b.length); bytes.set(a); bytes.set(b, a.length); return bytes;
}

/** Character continuations carry a width byte; headers never split across records. */
function sst(output: BiffOutput, strings: readonly string[], context: CapabilityContext): void {
  let payload = new Uint8Array(8224), at = 8, opcode = 0xfc;
  const view = new DataView(payload.buffer); view.setUint32(0, strings.length, true); view.setUint32(4, strings.length, true);
  const flush = () => { output.record(opcode, payload.subarray(0, at)); opcode = 0x3c; payload = new Uint8Array(8224); at = 0; };
  for (const text of strings) {
    context.signal.throwIfAborted();
    const data = biffString(text, 8, context);
    if (8224 - at < 5) flush();
    payload.set(data.subarray(0, 3), at); at += 3;
    for (let offset = 3; offset < data.length;) {
      if (8224 - at < 2) { flush(); payload[at++] = 1; }
      const count = Math.min(data.length - offset, Math.floor((8224 - at) / 2) * 2);
      payload.set(data.subarray(offset, offset + count), at); at += count; offset += count;
    }
  }
  output.record(opcode, payload.subarray(0, at));
}

function stringCache(output: BiffOutput, text: string, revision: 7 | 8, context: CapabilityContext): void {
  const data = biffString(text, revision, context); let at = 0;
  while (at < data.length) {
    const prefix = at && revision === 8 ? 1 : 0, header = !at && revision === 8 ? 3 : 0;
    const available = output.maximumRecord - prefix - header;
    const count = Math.min(data.length - at, header + (revision === 8 ? Math.floor(available / 2) * 2 : available));
    const payload = new Uint8Array(prefix + count); if (prefix) payload[0] = 1;
    payload.set(data.subarray(at, at + count), prefix); output.record(at ? 0x3c : 0x207, payload); at += count;
  }
}

export async function writeBiffStream(book: Workbook, revision: 7 | 8, dual: boolean, context: CapabilityContext): Promise<Uint8Array> {
  context.signal.throwIfAborted();
  if (book.sheets.length > context.limits.sheets) throw new SsconvertError("resource-limit", "ssconvert BIFF sheets limit exceeded");
  let cellCount = 0;
  for (const sheet of book.sheets) {
    context.signal.throwIfAborted(); cellCount += sheet.cells.length;
    if (cellCount > context.limits.cells) throw new SsconvertError("resource-limit", "ssconvert BIFF cells limit exceeded");
  }
  const output = new BiffOutput(context, revision === 8 ? 8224 : 2080);
  const active = book.sheets.find(sheet => sheet.id === book.activeSheet || sheet.name === book.activeSheet) ?? book.sheets[0];
  const maxRows = revision === 7 || dual ? 16384 : 65536;
  const metadata = new BiffMetadataWriter(book, context, maxRows);
  await metadata.prepare();
  const strings: string[] = [], stringIds = new Map<string, number>();
  const styles = new BiffStyles(context), xfIds = new Map<Cell, number>();
  const formulaWriter = new BiffFormulaWriter(book, revision, context), formulas = new Map<Cell, CompiledBiffFormula>();
  const arrayFormulas = new Map<FormulaGroup, CompiledBiffFormula>();
  const named = (book.names ?? []).map(name => ({ name, formula: formulaWriter.compile(name.expression,
    name.position?.sheet ?? name.sheet ?? book.sheets[0]!.id, name.position?.row ?? 0, name.position?.column ?? 0, true) }));
  for (const { formula } of named) for (const diagnostic of formula.diagnostics) await context.diagnostic?.(diagnostic);
  let extentWarningReported = false;
  for (const sheet of book.sheets) {
    for (const group of sheet.formulaGroups ?? []) if (group.kind === "array" && group.range.startRow < maxRows && group.range.startColumn < 256) {
      const formula = formulaWriter.compile(group.expression, sheet.id, group.range.startRow, group.range.startColumn);
      arrayFormulas.set(group, formula); for (const diagnostic of formula.diagnostics) await context.diagnostic?.(diagnostic);
    }
    let lastColumn = 0, lastRow = 0;
    for (const cell of sheet.cells) { lastColumn = Math.max(lastColumn, cell.column); lastRow = Math.max(lastRow, cell.row); }
    for (const [axis, max, last] of [["columns", 256, lastColumn], ["rows", maxRows, lastRow]] as const)
      if (last >= max && !(dual && revision === 8) && !extentWarningReported) {
        // GOffice's default error_info_list displays the oldest queued warning only.
        extentWarningReported = true;
        await context.diagnostic?.({ code: "biff-loss-warning", severity: "warning",
          message: `W Some content will be lost when saving.  This format only supports ${max} ${axis}, and this workbook has ${last}` });
      }
    for (const cell of sheet.cells) {
      context.signal.throwIfAborted(); if (cell.row >= maxRows || cell.column >= 256) continue;
      if (cell.value.kind === "string" && !cell.formula && !stringIds.has(cell.value.value)) {
        stringIds.set(cell.value.value, strings.length); strings.push(cell.value.value);
      }
      xfIds.set(cell, styles.register(cell));
      const group = sheet.formulaGroups?.find(group => group.id === cell.formulaGroup && group.kind === "array");
      if (group) {
        formulas.set(cell, { tokens: new Uint8Array([1, ...words(group.range.startRow, group.range.startColumn)]), arrays: new Uint8Array(), diagnostics: [] });
      } else if (cell.formula) { const formula = formulaWriter.compile(cell.formula, sheet.id, cell.row, cell.column);
        formulas.set(cell, formula); for (const diagnostic of formula.diagnostics) await context.diagnostic?.(diagnostic); }
    }
  }
  formulaWriter.finalize();
  output.record(0x809, bof(revision, 5));
  output.record(0xe1, revision === 8 ? words(1200) : new Uint8Array());
  output.record(0xc1, words(0)); output.record(0xe2);
  output.record(0x42, words(revision === 8 ? 1200 : 1252));
  if (revision === 8) { output.record(0x161, words(dual ? 1 : 0)); output.record(0x1c0); output.record(0x13d, words(...book.sheets.map((_, i) => i + 1))); }
  output.record(0x9c, words(14)); output.record(0x19, words(0)); output.record(0x12, words(0)); output.record(0x13, words(0));
  output.record(0x3d, words(0, 0, 0x3fcf, 0x2a4e, 0x38, Math.max(0, book.sheets.findIndex(sheet => sheet.id === book.activeSheet)), 0, 1, 600));
  output.record(0x40, words(0)); output.record(0x8d, words(0)); output.record(0x22, words(book.dateSystem === "1904" ? 1 : 0));
  output.record(0xe, words(1)); output.record(0x1b7, words(0)); output.record(0xda, words(0));
  styles.serialize(output, revision);
  for (const diagnostic of styles.diagnostics) await context.diagnostic?.(diagnostic);
  const bounds: number[] = [];
  for (const sheet of book.sheets) {
    const name = biffString(sheet.name.slice(0, 31), revision, context, 1), data = new Uint8Array(6 + name.length);
    data[4] = sheet.visibility === "hidden" ? 1 : sheet.visibility === "very-hidden" ? 2 : 0; data.set(name, 6);
    bounds.push(output.record(0x85, data));
  }
  if (revision === 7) legacyLinks(output, book, formulaWriter.externNames, context);
  for (const { name, formula } of named) {
    const text = biffString(name.name, revision, context, 1), header = new Uint8Array(14), view = new DataView(header.buffer);
    header[3] = text[0]!; view.setUint16(4, formula.tokens.length, true);
    const scope = name.sheet === undefined ? 0 : book.sheets.findIndex(sheet => sheet.id === name.sheet || sheet.name === name.sheet) + 1;
    view.setUint16(revision === 8 ? 8 : 6, scope, true);
    output.record(0x18, join(join(header, text.subarray(1)), join(formula.tokens, formula.arrays)));
  }
  for (const name of formulaWriter.macroNames) {
    const text = biffString(name, revision, context, 1), header = new Uint8Array(14); header[0] = 14; header[3] = text[0]!;
    output.record(0x18, join(header, text.subarray(1)));
  }
  if (revision === 8) {
    output.record(0x8c, words(1, 1));
    const addins = formulaWriter.externNames.length > 0;
    if (addins) {
      output.record(0x1ae, new Uint8Array([1, 0, 1, 0x3a]));
      for (const name of formulaWriter.externNames) output.record(0x23, join(join(new Uint8Array(6), biffString(name, revision, context, 1)), new Uint8Array([2, 0, 28, 23])));
    }
    output.record(0x1ae, words(book.sheets.length, 0x401));
    output.record(0x17, words(formulaWriter.externalSheets.length + Number(addins),
      ...(addins ? [0, 0xfffe, 0xfffe] : []), ...formulaWriter.externalSheets.flatMap(s => [Number(addins), s.first, s.last])));
    metadata.global(output); sst(output, strings, context);
  }
  output.record(10);
  const offsets: number[] = [];
  for (const sheet of book.sheets) {
    offsets.push(output.length); output.record(0x809, bof(revision, 16));
    output.record(0xd, words(book.calculationMode === "manual" ? 0 : 1)); output.record(0xc, words(book.iteration?.maximum ?? 100));
    output.record(0xf, words(1)); output.record(0x11, words(book.iteration?.enabled ? 1 : 0));
    const tolerance = new Uint8Array(8); new DataView(tolerance.buffer).setFloat64(0, book.iteration?.tolerance ?? 0.001, true); output.record(0x10, tolerance);
    if (revision === 7) legacyLinks(output, book, formulaWriter.externNames, context);
    output.record(0x5f, words(1)); output.record(0x82, words(1));
    output.record(0x80, words(0, 0, 0, 0)); output.record(0x225, words(0, 255));
    output.record(0x81, words(0x4c1));
    const cells = sheet.cells.filter(cell => cell.row < maxRows && cell.column < 256).sort((a, b) => a.row - b.row || a.column - b.column);
    let endRow = 0, endColumn = 0;
    for (const cell of cells) { endRow = Math.max(endRow, cell.row + 1); endColumn = Math.max(endColumn, cell.column + 1); }
    const dimensions = new Uint8Array(revision === 8 ? 14 : 10), dims = new DataView(dimensions.buffer);
    if (revision === 8) { dims.setUint32(4, endRow, true); dims.setUint16(10, endColumn, true); }
    else { dims.setUint16(2, endRow, true); dims.setUint16(6, endColumn, true); }
    output.record(0x200, dimensions);
    await metadata.sheet(output, sheet, revision);
    for (const cell of cells) {
      await writeCell(output, cell, xfIds.get(cell) ?? 15, revision, stringIds, context, formulas.get(cell));
      const group = sheet.formulaGroups?.find(group => group.id === cell.formulaGroup && group.kind === "array");
      if (group && cell.row === group.range.startRow && cell.column === group.range.startColumn) {
        const formula = arrayFormulas.get(group)!, data = new Uint8Array(14 + formula.tokens.length + formula.arrays.length), view = new DataView(data.buffer);
        view.setUint16(0, group.range.startRow, true); view.setUint16(2, Math.min(group.range.endRow, maxRows - 1), true);
        data[4] = group.range.startColumn; data[5] = Math.min(group.range.endColumn, 255); view.setUint16(12, formula.tokens.length, true);
        data.set(formula.tokens, 14); data.set(formula.arrays, 14 + formula.tokens.length); output.record(0x221, data);
      }
      const cached = cell.cachedResult ?? cell.value;
      if (formulas.has(cell) && cached.kind === "string") stringCache(output, cached.value, revision, context);
    }
    await metadata.links(output, sheet, revision);
    const zoom = Math.round(Number(sheet.view?.zoom ?? 1) * 100), flags = 0xb6 | (sheet === active ? 0x600 : 0);
    output.record(0x23e, revision === 8 ? words(flags, 0, 0, 64, 0, 0, zoom, zoom, 0) : words(flags, 0, 0, 64, 0));
    output.record(0xa0, words(zoom, 100));
    if (sheet.merges?.length) {
      const ranges = sheet.merges.filter(range => range.startRow < maxRows && range.startColumn < 256);
      const maximum = Math.floor((output.maximumRecord - 2) / 8);
      for (let i = 0; i < ranges.length; i += maximum) {
        const part = ranges.slice(i, i + maximum); output.record(0xe5, words(part.length,
          ...part.flatMap(range => [range.startRow, Math.min(range.endRow, maxRows - 1), range.startColumn, Math.min(range.endColumn, 255)])));
      }
    }
    output.record(10);
  }
  const bytes = output.finish(), view = new DataView(bytes.buffer);
  bounds.forEach((at, index) => view.setUint32(at + 4, offsets[index]!, true));
  await metadata.loss(bytes.subarray(0, offsets[0]));
  for (let i = 0; i < book.sheets.length; i++) await metadata.loss(bytes.subarray(offsets[i], offsets[i + 1]), book.sheets[i]);
  return bytes;
}

function legacyLinks(output: BiffOutput, book: Workbook, names: readonly string[], context: CapabilityContext): void {
  output.record(0x16, words(book.sheets.length + 2));
  for (const sheet of book.sheets) {
    const name = biffString(sheet.name, 7, context, 1);
    output.record(0x17, new Uint8Array([name[0]!, 3, ...name.subarray(1)]));
  }
  output.record(0x17, new Uint8Array([1, 0x3a]));
  for (const name of names) output.record(0x23, join(join(new Uint8Array(6), biffString(name, 7, context, 1)), new Uint8Array([2, 0, 28, 23])));
  output.record(0x17, new Uint8Array([1, 4]));
}

async function writeCell(output: BiffOutput, cell: Cell, xf: number, revision: 7 | 8, strings: ReadonlyMap<string, number>, context: CapabilityContext, formula?: CompiledBiffFormula): Promise<void> {
  const header = words(cell.row, cell.column, xf), value: CellValue = cell.value;
  if (formula) {
    const data = new Uint8Array(22 + formula.tokens.length + formula.arrays.length), view = new DataView(data.buffer);
    data.set(header); const cached = cell.cachedResult ?? cell.value;
    if (cached.kind === "number") view.setFloat64(6, cached.value, true);
    else { data[6] = cached.kind === "string" ? 0 : cached.kind === "boolean" ? 1 : cached.kind === "error" ? 2 : 3;
      data[8] = cached.kind === "boolean" ? Number(cached.value) : cached.kind === "error" ? biffError(cached.value) : 0;
      data[12] = 255; data[13] = 255; }
    view.setUint16(14, cell.formulaDirty ? 3 : 0, true); view.setUint16(20, formula.tokens.length, true);
    data.set(formula.tokens, 22); data.set(formula.arrays, 22 + formula.tokens.length); output.record(6, data);
    return;
  }
  if (value.kind === "number") { const data = new Uint8Array(14); data.set(header); new DataView(data.buffer).setFloat64(6, value.value, true); output.record(0x203, data); }
  else if (value.kind === "string") {
    if (revision === 8) { const data = new Uint8Array(10); data.set(header); new DataView(data.buffer).setUint32(6, strings.get(value.value)!, true); output.record(0xfd, data); }
    else {
      let text = value.value;
      if (text.length > context.limits.outputBytes) throw new SsconvertError("resource-limit", "ssconvert BIFF string bytes limit exceeded");
      const nul = text.indexOf("\0"); if (nul >= 0) text = text.slice(0, nul);
      if (text.length > 65535) {
        const characters = Array.from(text);
        if (characters.length > 65535) {
          await context.diagnostic?.({ code: "biff-loss-warning", severity: "warning", message: `Truncating string of ${characters.length} bytes` });
          context.signal.throwIfAborted(); text = characters.slice(0, 65535).join("");
        }
      }
      const data = join(header, biffString(text, revision, context));
      for (let at = 0; at < data.length; at += 2080) output.record(at ? 0x3c : 0x204, data.subarray(at, at + 2080)); }
  } else if (value.kind === "boolean" || value.kind === "error") output.record(0x205,
    join(header, new Uint8Array([value.kind === "boolean" ? Number(value.value) : biffError(value.value), value.kind === "error" ? 1 : 0])));
  else output.record(0x201, header);
}

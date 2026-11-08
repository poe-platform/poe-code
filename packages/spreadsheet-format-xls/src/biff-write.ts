import { BiffStagedOutput, type BiffRecordOutput } from "./biff-staged-output.js";
import { SsconvertError, type CapabilityContext } from "@poe-code/spreadsheet-engine/contracts";
import type { Workbook, Cell, CellValue, FormulaGroup } from "@poe-code/spreadsheet-ast";
import { encodeText } from "@poe-code/spreadsheet-engine/encoding/encode";
import { BiffOutput, words } from "./biff-write-binary.js";
import { biffErrors } from "./biff-formulas.js";
import { BiffFormulaWriter, type CompiledBiffFormula } from "./biff-write-formulas.js";
import { BiffStyles } from "./biff-write-styles.js";
import { BiffMetadataWriter } from "./biff-write-metadata.js";
import { singleByteTables } from "@poe-code/spreadsheet-engine/encoding/tables";
import { encodeBiffExternalPath } from "./biff-external-path.js";
import { writeBiffDataTable } from "./biff-data-tables.js";
import { biffDecode } from "./biff-strings.js";

export function biffString(text: string, revision: 7 | 8, context: CapabilityContext, width: 1 | 2 = 2): Uint8Array {
  const legacy = singleByteTables["windows-1252"]!;
  context.signal.throwIfAborted();
  if (text.length > context.limits.outputBytes) throw new SsconvertError("resource-limit", "ssconvert BIFF string bytes limit exceeded");
  const data = revision === 8 ? encodeText(text, "UTF-16LE", false, context) :
    new Uint8Array(Array.from(text, character => { const byte = legacy.indexOf(character); return byte < 0 ? 63 : byte; }));
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
async function sst(output: BiffRecordOutput, strings: readonly string[], context: CapabilityContext): Promise<void> {
  let payload = new Uint8Array(8224), at = 8, opcode = 0xfc;
  const view = new DataView(payload.buffer); view.setUint32(0, strings.length, true); view.setUint32(4, strings.length, true);
  const flush = async () => { await output.record(opcode, payload.subarray(0, at)); opcode = 0x3c; payload = new Uint8Array(8224); at = 0; };
  for (const text of strings) {
    context.signal.throwIfAborted();
    const data = biffString(text, 8, context);
    if (8224 - at < 5) await flush();
    payload.set(data.subarray(0, 3), at); at += 3;
    for (let offset = 3; offset < data.length;) {
      if (8224 - at < 2) { await flush(); payload[at++] = 1; }
      const count = Math.min(data.length - offset, Math.floor((8224 - at) / 2) * 2);
      payload.set(data.subarray(offset, offset + count), at); at += count; offset += count;
    }
  }
  await output.record(opcode, payload.subarray(0, at));
}

async function stringCache(output: BiffRecordOutput, text: string, revision: 7 | 8, context: CapabilityContext): Promise<void> {
  const data = biffString(text, revision, context); let at = 0;
  while (at < data.length) {
    const prefix = at && revision === 8 ? 1 : 0, header = !at && revision === 8 ? 3 : 0;
    const available = output.maximumRecord - prefix - header;
    const count = Math.min(data.length - at, header + (revision === 8 ? Math.floor(available / 2) * 2 : available));
    const payload = new Uint8Array(prefix + count); if (prefix) payload[0] = 1;
    payload.set(data.subarray(at, at + count), prefix); await output.record(at ? 0x3c : 0x207, payload); at += count;
  }
}

export function writeBiffStream(book: Workbook, revision: 7 | 8, dual: boolean, context: CapabilityContext,
  filepass?: Uint8Array): Promise<Uint8Array>;
export function writeBiffStream(book: Workbook, revision: 7 | 8, dual: boolean, context: CapabilityContext,
  filepass: Uint8Array | undefined, output: BiffStagedOutput): Promise<BiffStagedOutput>;
export async function writeBiffStream(book: Workbook, revision: 7 | 8, dual: boolean, context: CapabilityContext,
  filepass?: Uint8Array, output: BiffOutput | BiffStagedOutput = new BiffOutput(context, revision === 8 ? 8224 : 2080)): Promise<Uint8Array | BiffStagedOutput> {
  context.signal.throwIfAborted();
  if (revision !== 8 && book.automaticLabelLookup)
    throw new SsconvertError("unsupported-feature", "Excel BIFF7 cannot enable automatic label lookup");
  if (book.sheets.length > context.limits.sheets) throw new SsconvertError("resource-limit", "ssconvert BIFF sheets limit exceeded");
  let cellCount = 0;
  for (const sheet of book.sheets) {
    context.signal.throwIfAborted(); cellCount += sheet.cells.length;
    if (cellCount > context.limits.cells) throw new SsconvertError("resource-limit", "ssconvert BIFF cells limit exceeded");
  }
  const active = book.sheets.find(sheet => sheet.id === book.activeSheet || sheet.name === book.activeSheet) ?? book.sheets[0];
  const maxRows = revision === 7 || dual ? 16384 : 65536;
  const styles = new BiffStyles(context, book.view?.defaultStyle);
  const metadata = new BiffMetadataWriter(book, context, maxRows, styles.defaultFont);
  await metadata.prepare();
  const strings: string[] = [], stringIds = new Map<string, number>();
  const xfIds = new Map<Cell, number>();
  const formulaWriter = new BiffFormulaWriter(book, revision, context), formulas = new Map<Cell, CompiledBiffFormula>();
  const arrayFormulas = new Map<FormulaGroup, CompiledBiffFormula>();
  const dataTables = new Map<FormulaGroup, Uint8Array>();
  const named = (book.names ?? []).map(name => ({ name, formula: formulaWriter.compile(name.expression,
    name.position?.sheet ?? name.sheet ?? book.sheets[0]!.id, name.position?.row ?? 0, name.position?.column ?? 0, name) }));
  for (const { formula } of named) for (const diagnostic of formula.diagnostics) await context.diagnostic?.(diagnostic);
  let extentWarningReported = false;
  for (const sheet of book.sheets) {
    for (const group of sheet.formulaGroups ?? []) if (group.kind === "array" && group.range.startRow < maxRows && group.range.startColumn < 256) {
      const table = writeBiffDataTable(group, sheet.id, book, context, maxRows);
      if (table) { dataTables.set(group, table); continue; }
      const formula = formulaWriter.compile(group.expression, sheet.id, group.range.startRow, group.range.startColumn, undefined, group.arrayStringLiterals);
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
        formulas.set(cell, { tokens: new Uint8Array([dataTables.has(group) ? 2 : 1, ...words(group.range.startRow, group.range.startColumn)]),
          tokenBoundaries: [5], arrays: new Uint8Array(), arrayBoundaries: [], arrayStrings: [], diagnostics: [], nameDependencies: [] });
      } else if (cell.formula) { const formula = formulaWriter.compile(cell.formula, sheet.id, cell.row, cell.column, undefined, cell.arrayStringLiterals);
        formulas.set(cell, formula); for (const diagnostic of formula.diagnostics) await context.diagnostic?.(diagnostic); }
    }
  }
  const nameOrder = formulaWriter.finalize(named.map(entry => entry.formula));
  await output.record(0x809, bof(revision, 5));
  if (filepass) await output.record(0x2f, filepass);
  await output.record(0xe1, revision === 8 ? words(1200) : new Uint8Array());
  await output.record(0xc1, words(0)); await output.record(0xe2);
  await output.record(0x42, words(revision === 8 ? 1200 : 1252));
  if (revision === 8 && book.automaticLabelLookup) await output.record(0x160, words(1));
  if (revision === 8) { await output.record(0x161, words(dual ? 1 : 0)); await output.record(0x1c0); await output.record(0x13d, words(...book.sheets.map((_, i) => i + 1))); }
  await output.record(0x9c, words(14)); await metadata.workbookProtection(output);
  await output.record(0x3d, words(0, 0, 0x3fcf, 0x2a4e, 0x38, Math.max(0, book.sheets.findIndex(sheet => sheet.id === book.activeSheet)), 0, 1, 600));
  await output.record(0x40, words(0)); await output.record(0x8d, words(0)); await output.record(0x22, words(book.dateSystem === "1904" ? 1 : 0));
  await output.record(0xe, words(1)); await output.record(0x1b7, words(0)); await output.record(0xda, words(0));
  await styles.serializeSource(output, revision);
  for (const diagnostic of styles.diagnostics) await context.diagnostic?.(diagnostic);
  const bounds: number[] = [];
  for (const sheet of book.sheets) {
    const name = biffString(sheet.name.slice(0, 31), revision, context, 1), data = new Uint8Array(6 + name.length);
    data[4] = sheet.visibility === "hidden" ? 1 : sheet.visibility === "very-hidden" ? 2 : 0; data.set(name, 6);
    bounds.push(await output.record(0x85, data));
  }
  if (revision === 7) await legacyLinks(output, formulaWriter, context);
  if (revision === 8) {
    await output.record(0x8c, words(1, 1));
    const addins = formulaWriter.externNames.length > 0;
    if (formulaWriter.externalBooks.length + Number(addins) > 65535)
      throw new SsconvertError("unsupported-feature", "Excel BIFF external workbook index exceeds version limits");
    if (addins) {
      await output.record(0x1ae, new Uint8Array([1, 0, 1, 0x3a]));
      for (const name of formulaWriter.externNames) await output.record(0x23, join(join(new Uint8Array(6), biffString(name, revision, context, 1)), new Uint8Array([2, 0, 28, 23])));
    }
    await output.record(0x1ae, words(book.sheets.length, 0x401));
    for (const external of formulaWriter.externalBooks) {
      let data = join(words(external.sheets.length), biffString(encodeBiffExternalPath(external.workbook), revision, context));
      for (const sheet of external.sheets) {
        const text = biffString(sheet, revision, context);
        if (data.length + text.length > output.maximumRecord) throw new SsconvertError("unsupported-feature", "Excel BIFF external workbook record is too large");
        if (data.length + text.length + 4 > context.limits.outputBytes - output.length)
          throw new SsconvertError("resource-limit", "ssconvert BIFF output bytes limit exceeded");
        data = join(data, text);
      }
      await output.record(0x1ae, data);
      for (const name of external.names) {
        const definition = name.definition;
        await output.record(0x23, join(join(words(0, name.sheet === undefined ? 0 : name.sheet + 1, 0),
          biffString(name.name, revision, context, 1)), definition ? join(words(definition.tokens.length), definition.tokens) : new Uint8Array([2, 0, 28, 23])));
        if (definition?.record) metadata.exported.add(definition.record);
      }
    }
    await output.record(0x17, words(formulaWriter.externalSheets.length + Number(addins),
      ...(addins ? [0, 0xfffe, 0xfffe] : []), ...formulaWriter.externalSheets.flatMap(s => [Number(addins) + (s.book === undefined ? 0 : s.book + 1), s.first, s.last])));
  }
  // Native imports NAME expressions immediately, so their NameX/3D links
  // must already be declared even though our reader resolves them afterward.
  for (const index of nameOrder) {
    const entry = named[index];
    if (!entry) {
      const text = biffString(formulaWriter.macroNames[index - named.length]!, revision, context, 1), header = new Uint8Array(14);
      header[0] = 14; header[3] = text[0]!;
      await output.record(0x18, join(header, text.subarray(1)));
      continue;
    }
    const { name, formula } = entry;
    const text = biffString(name.name, revision, context, 1), header = new Uint8Array(14), view = new DataView(header.buffer);
    header[3] = text[0]!; view.setUint16(4, formula.tokens.length, true);
    const scope = name.sheet === undefined ? 0 : book.sheets.findIndex(sheet => sheet.id === name.sheet) + 1;
    // Calc reads BIFF5/7 offset 6 as a zero-based worksheet index, gated
    // by the one-based scope at offset 8. BIFF8 leaves offset 6 unused.
    if (revision === 7 && scope) view.setUint16(6, scope - 1, true);
    view.setUint16(8, scope, true);
    const start = header.length + text.length - 1;
    await output.continuedRecord(0x18, join(join(header, text.subarray(1)), join(formula.tokens, formula.arrays)),
      [start, ...formula.tokenBoundaries.map(offset => offset + start),
        ...formula.arrayBoundaries.map(offset => offset + start + formula.tokens.length)],
      formula.arrayStrings.map(span => ({ start: start + formula.tokens.length + span.start,
        end: start + formula.tokens.length + span.end })));
  }
  if (revision === 8) {
    await metadata.global(output); await sst(output, strings, context);
  }
  await output.record(10);
  const offsets: number[] = [];
  for (const sheet of book.sheets) {
    offsets.push(output.length); await output.record(0x809, bof(revision, 16));
    await output.record(0xd, words(book.calculationMode === "manual" ? 0 : 1)); await output.record(0xc, words(book.iteration?.maximum ?? 100));
    const nativeView = sheet.view?.gnumeric;
    const r1c1 = sheet.view?.referenceMode === "R1C1" || sheet.view?.referenceMode !== "A1" &&
      nativeView && typeof nativeView === "object" && !Array.isArray(nativeView) &&
      (nativeView as Readonly<Record<string, unknown>>).ExprConvention === "gnumeric:R1C1";
    await output.record(0xf, words(r1c1 ? 0 : 1)); await output.record(0x11, words(book.iteration?.enabled ? 1 : 0));
    const tolerance = new Uint8Array(8); new DataView(tolerance.buffer).setFloat64(0, book.iteration?.tolerance ?? 0.001, true); await output.record(0x10, tolerance);
    if (revision === 7) await legacyLinks(output, formulaWriter, context);
    await output.record(0x5f, words(1)); await output.record(0x82, words(1));
    const cells = sheet.cells.filter(cell => cell.row < maxRows && cell.column < 256).sort((a, b) => a.row - b.row || a.column - b.column);
    let endRow = 0, endColumn = 0;
    for (const cell of cells) { endRow = Math.max(endRow, cell.row + 1); endColumn = Math.max(endColumn, cell.column + 1); }
    const dimensions = new Uint8Array(revision === 8 ? 14 : 10), dims = new DataView(dimensions.buffer);
    if (revision === 8) { dims.setUint32(4, endRow, true); dims.setUint16(10, endColumn, true); }
    else { dims.setUint16(2, endRow, true); dims.setUint16(6, endColumn, true); }
    await output.record(0x200, dimensions);
    await metadata.sheet(output, sheet, revision);
    for (const cell of cells) {
      await writeCell(output, cell, xfIds.get(cell) ?? 15, revision, stringIds, context, formulas.get(cell));
      const group = sheet.formulaGroups?.find(group => group.id === cell.formulaGroup && group.kind === "array");
      if (group && cell.row === group.range.startRow && cell.column === group.range.startColumn) {
        const table = dataTables.get(group);
        if (table) await output.record(0x236, table);
        else {
          const formula = arrayFormulas.get(group)!, data = new Uint8Array(14 + formula.tokens.length + formula.arrays.length), view = new DataView(data.buffer);
          view.setUint16(0, group.range.startRow, true); view.setUint16(2, Math.min(group.range.endRow, maxRows - 1), true);
          data[4] = group.range.startColumn; data[5] = Math.min(group.range.endColumn, 255); view.setUint16(12, formula.tokens.length, true);
          data.set(formula.tokens, 14); data.set(formula.arrays, 14 + formula.tokens.length);
          await output.continuedRecord(0x221, data, [14, ...formula.tokenBoundaries.map(offset => offset + 14),
            ...formula.arrayBoundaries.map(offset => offset + 14 + formula.tokens.length)],
          formula.arrayStrings.map(span => ({ start: 14 + formula.tokens.length + span.start,
            end: 14 + formula.tokens.length + span.end })));
        }
      }
      const cached = cell.cachedResult ?? cell.value;
      if (formulas.has(cell) && cached.kind === "string") await stringCache(output, cached.value, revision, context);
    }
    await metadata.links(output, sheet, revision);
    await metadata.view(output, sheet, revision, sheet === active);
    if (sheet.merges?.length) {
      const ranges = sheet.merges.filter(range => range.startRow < maxRows && range.startColumn < 256);
      const maximum = Math.floor((output.maximumRecord - 2) / 8);
      for (let i = 0; i < ranges.length; i += maximum) {
        const part = ranges.slice(i, i + maximum); await output.record(0xe5, words(part.length,
          ...part.flatMap(range => [range.startRow, Math.min(range.endRow, maxRows - 1), range.startColumn, Math.min(range.endColumn, 255)])));
      }
    }
    await output.record(10);
  }
  const source = output instanceof BiffStagedOutput ? output : output.finish();
  for (const [index, at] of bounds.entries()) {
    const patch = new Uint8Array(4); new DataView(patch.buffer).setUint32(0, offsets[index]!, true);
    if (source instanceof Uint8Array) source.set(patch, at + 4); else await source.patch(at + 4, patch);
  }
  await metadata.loss(source, undefined, 0, offsets[0]);
  for (let i = 0; i < book.sheets.length; i++) await metadata.loss(source, book.sheets[i], offsets[i], offsets[i + 1]);
  return source;
}

async function legacyLinks(output: BiffRecordOutput, writer: BiffFormulaWriter, context: CapabilityContext): Promise<void> {
  const { book, externNames: names, externalBooks } = writer;
  await output.record(0x16, words(book.sheets.length + 2 + externalBooks.reduce((sum, external) => sum + external.sheets.length + 1, 0)));
  for (const sheet of book.sheets) {
    const name = biffString(sheet.name, 7, context, 1);
    await output.record(0x17, new Uint8Array([name[0]!, 3, ...name.subarray(1)]));
  }
  await output.record(0x17, new Uint8Array([1, 0x3a]));
  for (const name of names) await output.record(0x23, join(join(new Uint8Array(6), biffString(name, 7, context, 1)), new Uint8Array([2, 0, 28, 23])));
  await output.record(0x17, new Uint8Array([1, 4]));
  const identity = (text: string): Uint8Array => {
    const bytes = biffString(text, 7, context, 1);
    if (biffDecode(bytes.subarray(1), 1252) !== text)
      throw new SsconvertError("unsupported-feature", "Excel BIFF7 external identity is not representable in Windows-1252");
    return bytes;
  };
  const path = (workbook: string, sheet?: string): Uint8Array => {
    if (!workbook || Array.from(workbook + (sheet ?? "")).some(c => c.charCodeAt(0) < 32 || "[]".includes(c)))
      throw new SsconvertError("unsupported-feature", "Excel BIFF7 external path is not representable");
    const split = Math.max(workbook.lastIndexOf("/"), workbook.lastIndexOf("\\")) + 1;
    const directory = sheet === undefined ? workbook : workbook.slice(0, split);
    const suffix = sheet === undefined ? "" : "[" + workbook.slice(split) + "]" + sheet;
    const length = 1 + directory.length + suffix.length + (directory ? 2 : 0);
    if (length > 255) throw new SsconvertError("unsupported-feature", "Excel BIFF7 external path is too long");
    const raw = identity(directory), tail = identity(suffix);
    return new Uint8Array([length, 1, ...(directory ? [5, raw[0]!, ...raw.subarray(1)] : []), ...tail.subarray(1)]);
  };
  let base = book.sheets.length + 2;
  for (const external of externalBooks) {
    for (const sheet of external.sheets) await output.record(0x17, path(external.workbook, sheet));
    await output.record(0x17, path(external.workbook));
    for (const name of external.names) await output.record(0x23, join(join(words(0, name.sheet === undefined ? 0 : base + name.sheet + 1, 0),
      identity(name.name)), new Uint8Array([2, 0, 28, 23])));
    base += external.sheets.length + 1;
  }
}

async function writeCell(output: BiffRecordOutput, cell: Cell, xf: number, revision: 7 | 8, strings: ReadonlyMap<string, number>, context: CapabilityContext, formula?: CompiledBiffFormula): Promise<void> {
  const header = words(cell.row, cell.column, xf), value: CellValue = cell.value;
  if (formula) {
    const data = new Uint8Array(22 + formula.tokens.length + formula.arrays.length), view = new DataView(data.buffer);
    data.set(header); const cached = cell.cachedResult ?? cell.value;
    if (cached.kind === "number") view.setFloat64(6, cached.value, true);
    else { data[6] = cached.kind === "string" ? 0 : cached.kind === "boolean" ? 1 : cached.kind === "error" ? 2 : 3;
      data[8] = cached.kind === "boolean" ? Number(cached.value) : cached.kind === "error" ? biffError(cached.value) : 0;
      data[12] = 255; data[13] = 255; }
    view.setUint16(14, cell.formulaDirty ? 3 : 0, true); view.setUint16(20, formula.tokens.length, true);
    data.set(formula.tokens, 22); data.set(formula.arrays, 22 + formula.tokens.length);
    // Split auxiliary character data only with an explicit continuation width.
    await output.continuedRecord(6, data, [22, ...formula.tokenBoundaries.map(offset => offset + 22),
      ...formula.arrayBoundaries.map(offset => offset + 22 + formula.tokens.length)],
    formula.arrayStrings.map(span => ({ start: 22 + formula.tokens.length + span.start,
      end: 22 + formula.tokens.length + span.end })));
    return;
  }
  if (value.kind === "number") { const data = new Uint8Array(14); data.set(header); new DataView(data.buffer).setFloat64(6, value.value, true); await output.record(0x203, data); }
  else if (value.kind === "string") {
    if (revision === 8) { const data = new Uint8Array(10); data.set(header); new DataView(data.buffer).setUint32(6, strings.get(value.value)!, true); await output.record(0xfd, data); }
    else {
      let text = value.value;
      if (text.length > context.limits.outputBytes) throw new SsconvertError("resource-limit", "ssconvert BIFF string bytes limit exceeded");
      if (text.length > 65535) {
        const characters = Array.from(text);
        if (characters.length > 65535) {
          await context.diagnostic?.({ code: "biff-loss-warning", severity: "warning", message: `Truncating string of ${characters.length} bytes` });
          context.signal.throwIfAborted(); text = characters.slice(0, 65535).join("");
        }
      }
      const data = join(header, biffString(text, revision, context));
      for (let at = 0; at < data.length; at += 2080) await output.record(at ? 0x3c : 0x204, data.subarray(at, at + 2080)); }
  } else if (value.kind === "boolean" || value.kind === "error") await output.record(0x205,
    join(header, new Uint8Array([value.kind === "boolean" ? Number(value.value) : biffError(value.value), value.kind === "error" ? 1 : 0])));
  else await output.record(0x201, header);
}

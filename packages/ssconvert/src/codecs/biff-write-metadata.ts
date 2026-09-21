import { SsconvertError, type CapabilityContext } from "../contracts.js";
import { parseA1, type Sheet, type Workbook, type UnsupportedRecord } from "../workbook.js";
import { metadataNode, type MetadataNode } from "./xlsx-write-support.js";
import { BiffOutput, words } from "./biff-write-binary.js";
import { biffString } from "./biff-write.js";

function concat(...parts: Uint8Array[]): Uint8Array {
  const result = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0)); let at = 0;
  for (const part of parts) { result.set(part, at); at += part.length; } return result;
}
function escher(type: number, instance: number, version: number, data: Uint8Array): Uint8Array {
  const header = new Uint8Array(8), view = new DataView(header.buffer);
  view.setUint16(0, instance << 4 | version, true); view.setUint16(2, type, true); view.setUint32(4, data.length, true);
  return concat(header, data);
}
function dwords(...values: number[]): Uint8Array {
  const bytes = new Uint8Array(values.length * 4), view = new DataView(bytes.buffer);
  values.forEach((value, i) => view.setUint32(i * 4, value, true)); return bytes;
}

export class BiffMetadataWriter {
  private work = 0;
  private readonly records = new Map<Sheet, { record: Sheet["unsupportedRecords"] extends readonly (infer T)[] | undefined ? T : never; node?: MetadataNode }[]>();
  private readonly comments = new Map<Sheet, MetadataNode[]>();
  constructor(readonly book: Workbook, readonly context: CapabilityContext, readonly maxRows: number) {
    for (const sheet of book.sheets) {
      const records = (sheet.unsupportedRecords ?? []).map(record => ({ record, ...(record.data === undefined ? {} : { node: metadataNode(record.data, amount => this.charge(amount))! }) }));
      this.records.set(sheet, records);
      this.comments.set(sheet, records.flatMap(r => r.record.kind === "Objects" ? r.node?.children.filter(n => ["CellComment", "GnmCellComment"].includes(n.name)) ?? [] : []));
    }
  }
  private charge(amount = 1): void {
    this.context.signal.throwIfAborted(); this.work += amount;
    if (this.work > (this.context.limits.workbookWork ?? this.context.limits.outputBytes * 8)) throw new SsconvertError("resource-limit", "ssconvert BIFF metadata work limit exceeded");
  }
  async prepare(): Promise<void> {
    for (const sheet of this.book.sheets) {
      const admitted: MetadataNode[] = [];
      for (const comment of this.comments.get(sheet)!) {
        this.charge(); const pos = parseA1(comment.attributes.ObjectBound?.split(":")[0] ?? "A1");
        if (pos.row >= this.maxRows || pos.column >= 256) {
          await this.context.diagnostic?.({ code: "biff-loss-warning", severity: "warning", message: `Unsupported Excel BIFF comment anchor: ${comment.attributes.ObjectBound}` });
        } else admitted.push(comment);
      }
      this.comments.set(sheet, admitted);
    }
  }
  async loss(bytes: Uint8Array, sheet?: Sheet): Promise<void> {
    const emitted = new Map<number, Set<string>>(), view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    for (let at = 0; at + 4 <= bytes.length;) {
      this.charge(); const opcode = view.getUint16(at, true), length = view.getUint16(at + 2, true);
      const encoded = Array.from(bytes.subarray(at + 4, at + 4 + length), b => b.toString(16).padStart(2, "0")).join("");
      const values = emitted.get(opcode) ?? new Set<string>(); values.add(encoded); emitted.set(opcode, values); at += length + 4;
    }
    const records: readonly UnsupportedRecord[] = sheet ? sheet.unsupportedRecords ?? [] : this.book.unsupportedRecords ?? [];
    for (const record of records) {
      this.charge();
      if (record.source === "biff" && record.data && typeof record.data === "object" && !Array.isArray(record.data)) {
        const data = record.data as Readonly<Record<string, unknown>>;
        if (typeof data.opcode === "number" && typeof data.bytes === "string" && emitted.get(data.opcode)?.has(data.bytes)) continue;
      }
      if (["PrintInformation", "Styles", "Rows", "Cols"].includes(record.kind)) continue;
      const node = sheet ? this.records.get(sheet)?.find(r => r.record === record)?.node : undefined;
      if (record.kind === "Objects" && node?.children.every(n => ["CellComment", "GnmCellComment"].includes(n.name))) continue;
      await this.context.diagnostic?.({ code: "biff-loss-warning", severity: "warning", message: `Unsupported Excel BIFF export metadata: ${record.kind}` });
    }
  }
  global(output: BiffOutput): void {
    const groups = this.book.sheets.filter(sheet => this.comments.get(sheet)!.length);
    if (!groups.length) return;
    const counts = groups.map(sheet => this.comments.get(sheet)!.length + 1), last = groups.length * 1024 + counts.at(-1)!;
    const dgg = concat(dwords(last, groups.length + 1, counts.reduce((sum, count) => sum + count, 0), groups.length),
      ...counts.map((count, i) => dwords(i + 1, count)));
    output.record(0xeb, escher(0xf000, 0, 15, escher(0xf006, 0, 0, dgg)));
  }
  async sheet(output: BiffOutput, sheet: Sheet, revision: 7 | 8): Promise<void> {
    const records = this.records.get(sheet)!, print = records.find(r => r.record.kind === "PrintInformation")?.node;
    const child = (name: string) => print?.children.find(n => n.name === name);
    const flag = (name: string) => Number(child(name)?.attributes.value ?? 0);
    output.record(0x2a, words(flag("titles"))); output.record(0x2b, words(flag("grid")));
    output.record(0x83, words(flag("hcenter"))); output.record(0x84, words(flag("vcenter")));
    for (const [name, opcode, fallback] of [["left", 0x26, 72], ["right", 0x27, 72], ["top", 0x28, 120], ["bottom", 0x29, 120]] as const) {
      const bytes = new Uint8Array(8); new DataView(bytes.buffer).setFloat64(0,
        Number(child("Margins")?.children.find(n => n.name === name)?.attributes.Points ?? fallback) / 72, true); output.record(opcode, bytes);
    }
    const setup = new Uint8Array(34), view = new DataView(setup.buffer), scale = child("Scale")?.attributes;
    view.setUint16(0, ({ na_letter: 1, na_legal: 5, iso_a3: 8, iso_a4: 9, iso_a5: 11 } as Record<string, number>)[child("paper")?.text ?? "iso_a4"] ?? 9, true);
    view.setUint16(2, Number(scale?.percentage ?? 100), true); view.setUint16(4, 1, true);
    view.setUint16(6, Number(scale?.cols ?? 1), true); view.setUint16(8, Number(scale?.rows ?? 1), true);
    view.setUint16(10, (child("orientation")?.text === "landscape" ? 0 : 2) | (child("order")?.text === "r_then_d" ? 1 : 0) | (flag("monochrome") ? 8 : 0) | (flag("draft") ? 16 : 0), true);
    view.setUint16(12, 600, true); view.setUint16(14, 600, true);
    view.setFloat64(16, Number(child("Margins")?.children.find(n => n.name === "header")?.attributes.Points ?? 72) / 72, true);
    view.setFloat64(24, Number(child("Margins")?.children.find(n => n.name === "footer")?.attributes.Points ?? 72) / 72, true); view.setUint16(32, 1, true); output.record(0xa1, setup);
    const substitutions: Readonly<Record<string, string>> = { PAGE: "P", PAGES: "N", DATE: "D", TIME: "T", FILE: "F", TAB: "A", PATH: "Z" };
    for (const [name, opcode, fallback] of [["Header", 0x14, "&A"], ["Footer", 0x15, "Page &P"]] as const) {
      const node = child(name); let text = node ? "" : fallback;
      for (const [part, marker] of [["Left", "L"], ["Middle", "C"], ["Right", "R"]] as const) {
        const source = node?.attributes[part]; if (!source) continue;
        if (part !== "Middle" || node?.attributes.Left || node?.attributes.Right) text += "&" + marker;
        for (let at = 0; at < source.length; at++) {
          if (source[at] === "&" && source[at + 1] === "[") { const end = source.indexOf("]", at + 2), replacement = substitutions[source.slice(at + 2, end)];
            if (end >= 0 && replacement) { text += "&" + replacement; at = end; continue; } }
          text += source[at] === "&" ? "&&" : source[at];
        }
      }
      output.record(opcode, biffString(text, revision, this.context, revision === 8 ? 2 : 1));
    }
    for (const [name, opcode] of [["hPageBreaks", 0x1b], ["vPageBreaks", 0x1a]] as const) {
      const step = revision === 8 ? 6 : 2;
      const maximum = Math.floor((output.maximumRecord - 4) / step);
      const breaks = (child(name)?.children.filter(n => n.name === "break" && n.attributes.type !== "auto") ?? []).slice(0, maximum);
      if (breaks.length) output.record(opcode, words(breaks.length, ...breaks.flatMap(n => revision === 8 ? [Number(n.attributes.pos), 0, name === "hPageBreaks" ? 256 : 65536] : [Number(n.attributes.pos)])));
    }
    for (const row of sheet.rows ?? []) if (row.index < this.maxRows) output.record(0x208,
      words(row.index, 0, 256, Math.round((row.sizePoints ?? 12.75) * 20), 0, 0,
        0x140 | (row.hidden ? 32 : 0) | (row.collapsed ? 16 : 0) | (row.outlineLevel ?? 0), 15));
    for (const column of sheet.columns ?? []) if (column.index < 256) output.record(0x7d,
      words(column.index, column.index, Math.round(((column.sizePoints ?? 48) / 0.75 - 64) * 36.5 + 0x0924), 15,
        (column.hidden ? 1 : 0) | (column.collapsed ? 0x1000 : 0) | (column.outlineLevel ?? 0) << 8, 0));
    if (revision === 7) this.legacyComments(output, sheet);
    else this.drawComments(output, sheet);
  }
  async links(output: BiffOutput, sheet: Sheet, revision: 7 | 8): Promise<void> {
    if (revision === 8) for (const cell of sheet.cells) {
      if (cell.row >= this.maxRows || cell.column >= 256) continue;
      const node = metadataNode(cell.style?.gnumeric, amount => this.charge(amount)), link = node?.children.find(n => n.name === "HyperLink");
      if (!link) continue;
      const target = biffString(link.attributes.target ?? "", 8, this.context).subarray(3), zero = new Uint8Array(2);
      const range = words(cell.row, cell.row, cell.column, cell.column);
      const guid = new Uint8Array([0xd0, 0xc9, 0xea, 0x79, 0xf9, 0xba, 0xce, 0x11, 0x8c, 0x82, 0, 0xaa, 0, 0x4b, 0xa9, 0x0b]);
      const type = link.attributes.type;
      if (type === "GnmHLinkCurWB") output.record(0x1b8, concat(range, guid, dwords(2, 8, target.length / 2 + 1), target, zero));
      else if (type === "GnmHLinkURL" || type === "GnmHLinkEMail") {
        const moniker = new Uint8Array(guid); moniker[0] = 0xe0;
        output.record(0x1b8, concat(range, guid, dwords(2, 3), moniker, dwords(target.length + 2), target, zero));
      } else { await this.context.diagnostic?.({ code: "biff-loss-warning", severity: "warning", message: `Unsupported Excel BIFF hyperlink type: ${type}` }); continue; }
      if (link.attributes.tip !== undefined) output.record(0x800, concat(words(0x800), range,
        biffString(link.attributes.tip, 8, this.context).subarray(3), zero));
    }
  }
  private legacyComments(output: BiffOutput, sheet: Sheet): void {
    for (const comment of this.comments.get(sheet)!) {
      this.charge(); const pos = parseA1(comment.attributes.ObjectBound?.split(":")[0] ?? "A1");
      if (!pos || pos.row >= this.maxRows || pos.column >= 256) continue;
      const text = biffString(comment.attributes.Text ?? "", 7, this.context).subarray(2);
      for (let at = 0; at < text.length; at += 2048) output.record(0x1c,
        concat(words(at ? 0xffff : pos.row, at ? 0 : pos.column, at ? Math.min(2048, text.length - at) : text.length), text.subarray(at, at + 2048)));
    }
  }
  private drawComments(output: BiffOutput, sheet: Sheet): void {
    const comments = this.comments.get(sheet)!; if (!comments.length) return;
    const group = this.book.sheets.filter(s => this.comments.get(s)!.length).indexOf(sheet) + 1, base = group * 1024;
    const shapes = comments.map((comment, index) => {
      const pos = parseA1(comment.attributes.ObjectBound?.split(":")[0] ?? "A1");
      if (!pos) throw new SsconvertError("unsupported-feature", "Invalid Excel comment anchor");
      const anchor = words(0, Math.min(pos.column + 1, 255), 512, Math.max(0, pos.row - 1), 128, Math.min(pos.column + 3, 255), 512, Math.min(pos.row + 3, this.maxRows - 1), 128);
      const body = concat(escher(0xf00a, 202, 2, dwords(base + index + 1, 0xa00)), escher(0xf010, 0, 0, anchor), escher(0xf011, 0, 0, new Uint8Array()));
      const shape = escher(0xf004, 0, 15, body); new DataView(shape.buffer).setUint32(4, body.length + 8, true); return { comment, pos, shape };
    });
    const root = escher(0xf004, 0, 15, concat(escher(0xf009, 0, 1, new Uint8Array(16)), escher(0xf00a, 0, 2, dwords(base, 5))));
    const shapeBytes = shapes.reduce((sum, shape) => sum + shape.shape.length + 8, 0);
    const dg = escher(0xf008, group, 0, dwords(shapes.length + 1, base + shapes.length));
    const containers = concat(words(15, 0xf002), dwords(dg.length + 8 + root.length + shapeBytes), dg,
      words(15, 0xf003), dwords(root.length + shapeBytes), root);
    shapes.forEach(({ comment, pos, shape }, index) => {
      this.charge(); output.record(0xec, index ? shape : concat(containers, shape));
      const common = new Uint8Array(22); common.set(words(0x15, 18, 25, index + 1, 0x4011));
      const note = new Uint8Array(26); note.set(words(0xd, 22)); output.record(0x5d, concat(common, note, words(0, 0)));
      output.record(0xec, escher(0xf00d, 0, 0, new Uint8Array()));
      const text = biffString(comment.attributes.Text || " ", 8, this.context), txo = new Uint8Array(18); txo.set(words(0x212));
      new DataView(txo.buffer).setUint16(10, (text.length - 3) / 2, true); new DataView(txo.buffer).setUint16(12, 16, true); output.record(0x1b6, txo);
      for (let at = 3; at < text.length; at += 8222) output.record(0x3c, concat(new Uint8Array([1]), text.subarray(at, at + 8222)));
      const runs = new Uint8Array(16); new DataView(runs.buffer).setUint16(8, (text.length - 3) / 2, true); output.record(0x3c, runs);
      output.record(0x1c, concat(words(pos.row, pos.column, 0, index + 1), biffString(comment.attributes.Author ?? "", 8, this.context), new Uint8Array([0])));
    });
  }
}

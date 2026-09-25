import { SsconvertError, type CapabilityContext } from "../contracts.js";
import { formatA1, type ImportedValue, type UnsupportedRecord } from "../workbook.js";
import { Binary, invalidBiff, type BiffRecord } from "./biff-binary.js";
import { BiffStrings, biffDecode } from "./biff-strings.js";

export function biffNode(name: string, attributes: Readonly<Record<string, ImportedValue>>, text = "", children: readonly ImportedValue[] = []): ImportedValue {
  return { name, namespace: "http://www.gnumeric.org/v10.dtd", attributes: Object.entries(attributes).map(([name, value]) =>
    ({ name, namespace: "", value: String(value) })), text, children };
}
export const biffMetadataOpcodes = new Set([0x2a, 0x2b, 0x25, 0x225, 0x81, 0x83, 0x84, 0xa1, 0x55, 0x23e, 0x3e,
  0x1d, 0x1a, 0x1b, 0x41, 0xa0, 0x867, 0x1c, 0x1b6]);

function header(text: string): Readonly<Record<string, string>> {
  const values: Record<string, string> = { Left: "", Middle: "", Right: "" };
  const substitutions: Readonly<Record<string, string>> = { P: "&[PAGE]", N: "&[PAGES]", D: "&[DATE]", T: "&[TIME]", F: "&[FILE]", A: "&[TAB]", Z: "&[PATH]" };
  let side = "Middle";
  for (let i = 0; i < text.length; i++) {
    const character = text[i]!;
    if (character !== "&" || i + 1 >= text.length) { values[side] += character; continue; }
    const token = text[++i]!;
    if (["L", "C", "R"].includes(token)) side = token === "L" ? "Left" : token === "R" ? "Right" : "Middle";
    else values[side] += substitutions[token] ?? (token === "&" ? "&" : "&" + token);
  }
  return values;
}

/** Source-backed neutral records consumed by both existing workbook writers. */
export function readBiffMetadata(records: readonly BiffRecord[], revision: number, codepage: number, context: CapabilityContext): {
  records: UnsupportedRecord[]; view: Record<string, ImportedValue>; active: boolean;
} {
  const print: Record<string, ImportedValue> = { vcenter: 0, hcenter: 0, grid: 0, titles: 0, monochrome: 0, draft: 0 };
  const margins: Record<string, number> = { top: 120, bottom: 120, left: 72, right: 72, header: 72, footer: 72 };
  let scale: Record<string, ImportedValue> = { type: "percentage", percentage: 100 }, orientation = "portrait", paper = "iso_a4", order = "d_then_r";
  let fitToPage = false, fitColumns = 1, fitRows = 1;
  let headerText = "&A", footerText = "Page &P", commentPlacement = "GNM_PRINT_COMMENTS_NONE", errorDisplay = "GNM_PRINT_ERRORS_AS_DISPLAYED";
  const objects: ImportedValue[] = [], breaks: ImportedValue[] = [], view: Record<string, ImportedValue> = {};
  let active = false, hasPrint = false;
  let window: { row: number; column: number; frozen: boolean } | undefined;
  let pane: { x: number; y: number; row: number; column: number } | undefined;
  const comments = new Map<number, string>(); let lastObject: number | undefined;
  let textBytes = 0;
  const accountText = (text: string): void => {
    textBytes += new TextEncoder().encode(text).length;
    if (textBytes > (context.limits.workbookTextBytes ?? context.limits.inputBytes))
      throw new SsconvertError("resource-limit", "ssconvert BIFF metadata text limit exceeded");
  };
  for (let index = 0; index < records.length; index++) {
    context.signal.throwIfAborted();
    const record = records[index]!, data = record.data, opcode = record.opcode;
    if (opcode === 0x5d) {
      lastObject = undefined;
      for (let at = 0; at + 4 <= data.bytes.length;) {
        const type = data.u16(at), length = data.u16(at + 2); data.check(at + 4, length);
        if (type === 0x15 && length >= 6) lastObject = data.u16(at + 6);
        at += 4 + length; if (!type) break;
      }
    } else if (opcode === 0x1b6 && lastObject !== undefined) {
      const length = data.u16(10), parts: Binary[] = [];
      while (records[index + 1]?.opcode === 0x3c) parts.push(records[++index]!.data);
      if (length) comments.set(lastObject, new BiffStrings(parts, context, codepage).unicode(length).text);
    } else if (opcode === 0x1c) {
      const row = data.u16(0), column = data.u16(2); if (column > 255) invalidBiff("invalid comment position");
      let text = "", author = "";
      if (revision >= 8) {
        const object = data.u16(6), length = data.u16(8);
        author = length ? new BiffStrings([new Binary(data.slice(10, data.bytes.length - 10))], context, codepage).unicode(length).text : "";
        text = comments.get(object) ?? "";
      } else {
        let remaining = data.u16(4), current = data;
        if (remaining > (context.limits.workbookTextBytes ?? context.limits.inputBytes))
          throw new SsconvertError("resource-limit", "ssconvert BIFF metadata text limit exceeded");
        while (remaining) {
          context.signal.throwIfAborted();
          const amount = Math.min(2048, remaining); text += biffDecode(current.slice(6, amount), codepage); remaining -= amount;
          if (!remaining) break;
          const continuation = records[++index]; if (!continuation || continuation.opcode !== 0x1c || continuation.data.u16(0) !== 0xffff || continuation.data.u16(2) !== 0)
            invalidBiff("missing NOTE continuation");
          current = continuation.data;
        }
      }
      accountText(text); accountText(author);
      objects.push(biffNode("CellComment", { ObjectBound: formatA1(row, column), ObjectOffset: "1 0 1 0", Direction: 17, Print: 1,
        Author: author, Text: text }));
    } else if (opcode >= 0x26 && opcode <= 0x29) {
      const value = data.f64(0) * 72; if (!Number.isFinite(value)) invalidBiff("invalid print margin");
      margins[["left", "right", "top", "bottom"][opcode - 0x26]!] = value; hasPrint = true;
    } else if (opcode === 0x14 || opcode === 0x15) {
      if (!data.bytes.length) continue;
      const offset = revision >= 8 ? 2 : 1, length = revision >= 8 ? data.u16(0) : data.u8(0);
      const cursor = new BiffStrings([new Binary(data.slice(offset, data.bytes.length - offset))], context, codepage);
      const text = length ? revision >= 8 ? cursor.unicode(length).text : cursor.legacy(length) : "";
      accountText(text);
      if (opcode === 0x14) headerText = text; else footerText = text; hasPrint = true;
    } else if (opcode === 0x2a || opcode === 0x2b || opcode === 0x83 || opcode === 0x84) {
      print[opcode === 0x2a ? "titles" : opcode === 0x2b ? "grid" : opcode === 0x83 ? "hcenter" : "vcenter"] = data.u16(0) ? 1 : 0; hasPrint = true;
    } else if (opcode === 0xa1) {
      data.check(0, revision > 4 ? 34 : 12); const flags = data.u16(10);
      fitColumns = data.u16(6); fitRows = data.u16(8);
      print.monochrome = flags & 8 ? 1 : 0; print.draft = flags & 16 ? 1 : 0;
      orientation = flags & 2 ? "portrait" : "landscape"; order = flags & 1 ? "r_then_d" : "d_then_r";
      commentPlacement = flags & 0x20 ? revision >= 8 && flags & 0x200 ? "GNM_PRINT_COMMENTS_AT_END" : "GNM_PRINT_COMMENTS_IN_PLACE" : "GNM_PRINT_COMMENTS_NONE";
      errorDisplay = ["GNM_PRINT_ERRORS_AS_DISPLAYED", "GNM_PRINT_ERRORS_AS_BLANK", "GNM_PRINT_ERRORS_AS_DASHES", "GNM_PRINT_ERRORS_AS_NA"][revision >= 8 ? flags >> 10 & 3 : 0]!;
      if (!(flags & 4)) {
        paper = ({ 1: "na_letter", 5: "na_legal", 8: "iso_a3", 9: "iso_a4", 11: "iso_a5" } as Record<number, string>)[data.u16(0)] ?? `biff-paper-${data.u16(0)}`;
        const percentage = data.u16(2); scale = { type: "percentage", percentage: percentage >= 1 && percentage <= 1000 ? percentage : 100 };
      }
      if (revision > 4) { margins.header = data.f64(16) * 72; margins.footer = data.f64(24) * 72;
        if (!Number.isFinite(margins.header) || !Number.isFinite(margins.footer)) invalidBiff("invalid print margin"); }
      hasPrint = true;
    } else if (opcode === 0x81) {
      const flags = data.u16(0); view.gnumeric = { OutlineSymbolsBelow: flags & 0x40 ? "1" : "0", OutlineSymbolsRight: flags & 0x80 ? "1" : "0" };
      fitToPage = !!(flags & 0x100);
    } else if (opcode === 0x23e) {
      const flags = data.u16(0); active = !!(flags & 0x200);
      window = { row: data.u16(2), column: data.u16(4), frozen: !!(flags & 8) };
      if (window.column > 255 || window.row >= (revision >= 8 ? 65536 : 16384)) invalidBiff("invalid sheet layout position");
      view.gnumeric = { ...(view.gnumeric as Record<string, ImportedValue> | undefined), DisplayFormulas: flags & 1 ? "1" : "0",
        HideGrid: flags & 2 ? "0" : "1", HideColHeader: flags & 4 ? "0" : "1", HideRowHeader: flags & 4 ? "0" : "1",
        HideZero: flags & 0x10 ? "0" : "1", DisplayOutlines: flags & 0x80 ? "1" : "0" };
      if (revision >= 8 && data.bytes.length >= 14) view.zoom = data.u16(12) ? data.u16(12) / 100 : 1;
    } else if (opcode === 0x41) {
      data.check(0, revision >= 5 ? 10 : 9);
      pane = { x: data.u16(0), y: data.u16(2), row: data.u16(4), column: data.u16(6) };
    } else if (opcode === 0xa0) { const denominator = data.u16(2); if (!denominator) invalidBiff("invalid sheet zoom"); view.zoom = data.u16(0) / denominator; }
    else if (opcode === 0x1a || opcode === 0x1b) {
      const count = data.u16(0), width = revision >= 8 ? 6 : 2; data.check(2, count * width);
      breaks.push(biffNode(opcode === 0x1b ? "hPageBreaks" : "vPageBreaks", { count }, "",
        Array.from({ length: count }, (_, i) => biffNode("break", { pos: data.u16(2 + i * width), type: "manual" })))); hasPrint = true;
    }
  }
  const result: UnsupportedRecord[] = [];
  if (window) {
    const frozen = window.frozen && pane && (pane.x || pane.y) ? pane : undefined;
    if (frozen && (frozen.column > 255 || window.column + frozen.x > 255 ||
      frozen.row >= (revision >= 8 ? 65536 : 16384) || window.row + frozen.y >= (revision >= 8 ? 65536 : 16384)))
      invalidBiff("invalid frozen sheet layout");
    result.push({ source: "Gnumeric_XmlIO:sax", kind: "SheetLayout", disposition: "retained",
      data: biffNode("SheetLayout", { TopLeft: formatA1(frozen?.y ? frozen.row : window.row, frozen?.x ? frozen.column : window.column) }, "", frozen ? [
        biffNode("FreezePanes", { FrozenTopLeft: formatA1(frozen.y ? window.row : 0, frozen.x ? window.column : 0),
          UnfrozenTopLeft: formatA1(frozen.y ? window.row + frozen.y : 0, frozen.x ? window.column + frozen.x : 0) })
      ] : []) });
  }
  if (hasPrint) result.push({ source: "Gnumeric_XmlIO:sax", kind: "PrintInformation", disposition: "retained",
    data: biffNode("PrintInformation", {}, "", [biffNode("Margins", {}, "", Object.entries(margins).map(([name, Points]) => biffNode(name, { Points, PrefUnit: "mm" }))),
      biffNode("Scale", fitToPage ? { type: "fit", cols: fitColumns, rows: fitRows } : scale), ...Object.entries(print).map(([name, value]) => biffNode(name, { value })), biffNode("order", {}, order),
      biffNode("orientation", {}, orientation), biffNode("Header", header(headerText)), biffNode("Footer", header(footerText)),
      biffNode("paper", {}, paper), biffNode("comments", { placement: commentPlacement }), biffNode("errors", { PrintErrorsAs: errorDisplay }), ...breaks]) });
  if (objects.length) result.push({ source: "Gnumeric_XmlIO:sax", kind: "Objects", disposition: "retained", data: biffNode("Objects", {}, "", objects) });
  return { records: result, view, active };
}

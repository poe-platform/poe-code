import { SsconvertError, type CapabilityContext, type Diagnostic } from "../contracts.js";
import type { Cell } from "../workbook.js";
import { cellValueFormat } from "../workbook/value-format.js";
import { metadataNode, type MetadataNode } from "./xlsx-write-support.js";
import { BiffOutput, words } from "./biff-write-binary.js";
import { biffString } from "./biff-write.js";

export class BiffStyles {
  readonly diagnostics: Diagnostic[] = [];
  private readonly styles: { format: string; node?: MetadataNode }[] = [{ format: "General" }];
  private readonly ids = new Map<string, number>();
  constructor(readonly context: CapabilityContext) {}
  register(cell: Pick<Cell, "format" | "style"> & Partial<Pick<Cell, "value" | "cachedResult">>): number {
    const node = metadataNode(cell.style?.gnumeric, amount => this.charge(amount));
    const styleFormat = cell.format ?? node?.attributes.Format ?? node?.children.find(n => n.name === "Format")?.text ?? "General";
    const entry = { format: styleFormat === "General" ? cellValueFormat(cell) ?? styleFormat : styleFormat,
      ...(node ? { node } : {}) };
    if (!node && entry.format === "General") return 15;
    const key = JSON.stringify(entry); this.charge(key.length);
    const existing = this.ids.get(key); if (existing !== undefined) return existing;
    if (this.styles.length >= 4080) throw new SsconvertError("unsupported-feature", "Excel BIFF XF limit exceeded");
    const id = 15 + this.styles.length; this.ids.set(key, id); this.styles.push(entry); return id;
  }
  private work = 0;
  private charge(amount = 1): void {
    this.context.signal.throwIfAborted(); this.work += amount;
    if (this.work > (this.context.limits.workbookWork ?? this.context.limits.outputBytes * 8))
      throw new SsconvertError("resource-limit", "ssconvert BIFF style work limit exceeded");
  }
  serialize(output: BiffOutput, revision: 7 | 8): void {
    const fonts: Uint8Array[] = [], fontIds = new Map<string, number>(), palette: string[] = [], formats = new Map<string, number>();
    const lostColors = new Map<string, number>();
    const color = (value: string | undefined, fallback: number): number => {
      if (!value) return fallback;
      const rgb = value.split(":").map(c => (parseInt(c, 16) >>> 8).toString(16).padStart(2, "0")).join("").toUpperCase();
      const standard = ["000000", "FFFFFF", "FF0000", "00FF00", "0000FF", "FFFF00", "FF00FF", "00FFFF"].indexOf(rgb);
      if (standard >= 0) return standard;
      let index = palette.indexOf(rgb);
      if (index < 0) {
        // Native gather_palette never evicts the default black/white slots.
        if (!palette.length) palette.push("000000", "FFFFFF");
        if (palette.length >= 56) {
          let lost = lostColors.get(rgb);
          if (lost === undefined) {
            lost = 56 + lostColors.size; lostColors.set(rgb, lost);
            this.diagnostics.push({ code: "biff-loss-warning", severity: "warning", message: "uh oh, we're going to lose a colour" });
          }
          const bgr = rgb.slice(4, 6) + rgb.slice(2, 4) + rgb.slice(0, 2);
          this.diagnostics.push({ code: "biff-loss-warning", severity: "warning",
            message: `We lost colour #${lost} (#${bgr.toLowerCase()}), converting it to black` });
          return 0;
        }
        index = palette.length; palette.push(rgb);
      }
      return 8 + index;
    };
    const xfs: Uint8Array[] = [];
    for (const style of this.styles) {
      this.charge(); const attrs = style.node?.attributes ?? {}, font = style.node?.children.find(n => n.name === "Font"), f = font?.attributes ?? {};
      const fore = color(attrs.Fore, 0x7fff), key = JSON.stringify({ font, fore });
      let fontId = fontIds.get(key);
      if (fontId === undefined) {
        fontId = fonts.length + (fonts.length >= 4 ? 1 : 0); fontIds.set(key, fontId);
        const name = biffString(font?.text || "Sans", revision, this.context, 1), bytes = new Uint8Array(14 + name.length), view = new DataView(bytes.buffer);
        view.setUint16(0, Math.round(Number(f.Unit ?? 10) * 20), true); view.setUint16(2, (Number(f.Bold) ? 1 : 0) | (Number(f.Italic) ? 2 : 0) | (Number(f.StrikeThrough) ? 8 : 0), true);
        view.setUint16(4, fore, true); view.setUint16(6, Number(f.Bold) ? 700 : 400, true);
        view.setUint16(8, Number(f.Script) > 0 ? 1 : Number(f.Script) < 0 ? 2 : 0, true);
        bytes[10] = [0, 1, 2, 0x21, 0x22][Number(f.Underline ?? 0)] ?? 0; bytes.set(name, 14); fonts.push(bytes);
      }
      if (style.format !== "General" && !formats.has(style.format)) formats.set(style.format, 164 + formats.size);
      const xf = new Uint8Array(revision === 8 ? 20 : 16), view = new DataView(xf.buffer);
      view.setUint16(0, fontId, true); view.setUint16(2, formats.get(style.format) ?? 0, true);
      view.setUint16(4, (Number(attrs.Locked ?? 1) ? 1 : 0) | (Number(attrs.Hidden) ? 2 : 0), true);
      const horizontal = ["GENERAL", "LEFT", "CENTER", "RIGHT", "FILL", "JUSTIFY", "CENTER_ACROSS_SELECTION", "DISTRIBUTED"].indexOf((attrs.HAlign ?? "GNM_HALIGN_GENERAL").slice(11));
      const vertical = ["TOP", "CENTER", "BOTTOM", "JUSTIFY", "DISTRIBUTED"].indexOf((attrs.VAlign ?? "GNM_VALIGN_BOTTOM").slice(11));
      xf[6] = Math.max(0, horizontal) | (Number(attrs.WrapText) ? 8 : 0) | Math.max(0, vertical) << 4;
      const rotation = Number(attrs.Rotation ?? 0), fill = color(attrs.PatternColor, 64) | color(attrs.Back, 65) << 7;
      const edges = style.node?.children.find(n => n.name === "StyleBorder")?.children ?? [];
      const edge = (name: string) => { const n = edges.find(e => e.name === name); return { style: Number(n?.attributes.Style ?? 0), color: color(n?.attributes.Color, 64) }; };
      const left = edge("Left"), right = edge("Right"), top = edge("Top"), bottom = edge("Bottom");
      if (revision === 8) {
        const angle = rotation % 360;
        xf[7] = rotation < 0 ? 255 : angle > 90 ? 450 - angle : angle;
        xf[8] = Number(attrs.Indent ?? 0) & 15 | (Number(attrs.ShrinkToFit) ? 16 : 0); xf[9] = 0xfc;
        view.setUint16(10, left.style | right.style << 4 | top.style << 8 | bottom.style << 12, true);
        const diagonal = edge("Diagonal"), reverse = edge("RevDiagonal"), diag = diagonal.style ? diagonal : reverse;
        view.setUint16(12, left.color | right.color << 7 | (diagonal.style ? 0x4000 : 0) | (reverse.style ? 0x8000 : 0), true);
        view.setUint32(14, top.color | bottom.color << 7 | diag.color << 14 | diag.style << 21 | Number(attrs.Shade ?? 0) << 26, true);
        view.setUint16(18, fill, true);
      } else {
        xf[7] = 0xfc | (rotation < 0 ? 1 : rotation > 45 && rotation <= 135 ? 2 : rotation > 225 && rotation <= 315 ? 3 : 0);
        view.setUint16(8, fill, true); view.setUint16(10, Number(attrs.Shade ?? 0) | (bottom.style & 7) << 6 | bottom.color << 9, true);
        view.setUint16(12, (top.style & 7) | (left.style & 7) << 3 | (right.style & 7) << 6 | top.color << 9, true);
        view.setUint16(14, left.color | right.color << 7, true);
      }
      xfs.push(xf);
    }
    for (const font of fonts) output.record(0x31, font);
    for (const [format, id] of formats) { const text = biffString(format, revision, this.context, revision === 8 ? 2 : 1), bytes = new Uint8Array(2 + text.length); bytes.set(words(id)); bytes.set(text, 2); output.record(0x41e, bytes); }
    for (let i = 0; i < 15; i++) { const xf = new Uint8Array(xfs[0]!); new DataView(xf.buffer).setUint16(4, 0xfff5, true); output.record(0xe0, xf); }
    for (const xf of xfs) output.record(0xe0, xf);
    output.record(0x293, words(0x8000, 0xff00));
    if (palette.length) { const bytes = new Uint8Array(2 + palette.length * 4); bytes.set(words(palette.length));
      palette.forEach((rgb, i) => { for (let j = 0; j < 3; j++) bytes[2 + i * 4 + j] = parseInt(rgb.slice(j * 2, j * 2 + 2), 16); }); output.record(0x92, bytes); }
  }
}

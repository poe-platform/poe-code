import type { Cell, ImportedValue } from "../workbook.js";
import { cellValueFormat } from "../workbook/value-format.js";
import { metadataNode, type ElementWriter, type MetadataNode } from "./xlsx-write-support.js";

const builtinFormats = new Map<string, number>(Object.entries({ General: 0, "0": 1, "0.00": 2, "#,##0": 3, "#,##0.00": 4,
  "0%": 9, "0.00%": 10, "0.00E+00": 11, "# ?/?": 12, "# ??/??": 13, "d-mmm-yy": 15, "d-mmm": 16, "mmm-yy": 17,
  "h:mm AM/PM": 18, "h:mm:ss AM/PM": 19, "h:mm": 20, "h:mm:ss": 21, "m/d/yy h:mm": 22,
  "#,##0 ;(#,##0)": 37, "#,##0 ;[Red](#,##0)": 38, "#,##0.00;(#,##0.00)": 39, "#,##0.00;[Red](#,##0.00)": 40,
  "mm:ss": 45, "[h]:mm:ss": 46, "mmss.0": 47, "##0.0E+0": 48, "@": 49 }));
const patterns = ["none", "solid", "darkGray", "mediumGray", "lightGray", "gray125", "gray0625", "darkHorizontal", "darkVertical", "darkUp", "darkDown", "darkGrid", "darkTrellis", "lightHorizontal", "lightVertical", "lightDown", "lightUp", "lightGrid", "lightTrellis"];
const borderStyles = ["none", "thin", "medium", "dashed", "dotted", "thick", "double", "hair", "mediumDashed", "dashDot", "mediumDashDot", "dashDotDot", "mediumDashDotDot", "slantDashDot"];
function rgb(source: string | undefined, fallback: string): string {
  if (!source) return fallback;
  return "FF" + source.split(":").map(c => Math.round(parseInt(c, 16) / 257).toString(16).padStart(2, "0")).join("").toUpperCase();
}
function alignment(value: string | undefined, fallback: string): string {
  return value === undefined ? fallback : value.toLowerCase().split("_").at(-1) ?? fallback;
}
export function createXlsxStyles(xml: ElementWriter, edition: "2006" | "2008", namespace: string, charge: (amount?: number) => void) {
  const styles: { format: string; node?: MetadataNode }[] = [{ format: "General" }];
  const dxfs: MetadataNode[] = [];
  const differentialIds = new Map<string, number>();
  const keys = new Map<string, number>(); keys.set(JSON.stringify(styles[0]), 0);
  function register(cell: Pick<Cell, "format" | "style"> & Partial<Pick<Cell, "value" | "cachedResult">>, inherited = 0): number {
    charge(); const node = metadataNode(cell.style?.gnumeric, charge) ?? styles[inherited]?.node;
    const styleFormat = cell.format ?? node?.attributes.Format ?? node?.children.find(n => n.name === "Format")?.text ?? styles[inherited]?.format ?? "General";
    const format = styleFormat === "General" ? cellValueFormat(cell) ?? styleFormat : styleFormat;
    const entry = { format, ...(node ? { node: { ...node, children: node.children.filter(n => !["HyperLink", "Validation", "Condition", "Conditions", "InputMessage"].includes(n.name)) } } : {}) };
    const key = JSON.stringify(entry); const existing = keys.get(key); if (existing !== undefined) return existing;
    keys.set(key, styles.length); styles.push(entry); return styles.length - 1;
  }
  function serialize(): string {
    const custom = new Map<string, number>();
    for (const style of styles) if (!builtinFormats.has(style.format) && !custom.has(style.format)) custom.set(style.format, 100 + custom.size);
    const fonts: string[] = [], fills = [xml("fill", {}, xml("patternFill", { patternType: "none" })), xml("fill", {}, xml("patternFill", { patternType: "gray125" }))], borders: string[] = [];
    const fontIds = new Map<string, number>(), fillIds = new Map(fills.map((fill, i) => [fill, i])), borderIds = new Map<string, number>();
    const intern = (text: string, array: string[], map: Map<string, number>) => {
      const existing = map.get(text); if (existing !== undefined) return existing;
      map.set(text, array.length); array.push(text); return array.length - 1;
    };
    const xfs: string[] = []; let defaultXf = "";
    for (const [index, style] of styles.entries()) {
      charge(); const a = style.node?.attributes ?? {}, f = style.node?.children.find(n => n.name === "Font"), fa = f?.attributes ?? {};
      const font = xml("font", {}, xml("b", { val: Number(fa.Bold ?? 0) }) + xml("i", { val: Number(fa.Italic ?? 0) }) +
        xml("u", { val: ["none", "single", "double", "singleAccounting", "doubleAccounting"][Number(fa.Underline ?? 0)] ?? "none" }) +
        xml("color", { rgb: rgb(a.Fore, "FF000000") }) + xml("name", { val: f?.text || "Sans" }) +
        xml("vertAlign", { val: Number(fa.Script) > 0 ? "superscript" : Number(fa.Script) < 0 ? "subscript" : "baseline" }) +
        xml("sz", { val: Number(fa.Unit ?? 10) }) + xml("strike", { val: Number(fa.StrikeThrough ?? 0) }));
      const shade = Number(a.Shade ?? 0);
      const fill = xml("fill", {}, xml("patternFill", { patternType: patterns[shade] ?? "solid" }, shade
        ? xml("fgColor", { rgb: rgb(a.Back, "FFFFFFFF") }) + xml("bgColor", { rgb: rgb(a.PatternColor, "FF000000") }) : ""));
      const edges = style.node?.children.find(n => n.name === "StyleBorder")?.children ?? [];
      const border = xml("border", { diagonalUp: edges.some(n => n.name === "Rev-Diagonal") ? 1 : 0, diagonalDown: edges.some(n => n.name === "Diagonal") ? 1 : 0 },
        [["Left", edition === "2006" ? "left" : "start"], ["Right", edition === "2006" ? "right" : "end"], ["Top", "top"], ["Bottom", "bottom"], ["Diagonal", "diagonal"], ["Rev-Diagonal", "diagonal"]].map(([source, target]) => {
          const edge = edges.find(n => n.name === source); if (!edge && target === "diagonal") return "";
          return xml(target!, { style: borderStyles[Number(edge?.attributes.Style ?? 0)] ?? "none" }, xml("color", { rgb: rgb(edge?.attributes.Color, "FFC7C7C7") }));
        }).join(""));
      const attrs = { fontId: intern(font, fonts, fontIds), fillId: intern(fill, fills, fillIds), borderId: intern(border, borders, borderIds), numFmtId: builtinFormats.get(style.format) ?? custom.get(style.format)! };
      const properties = xml("alignment", { horizontal: alignment(a.HAlign, "general"), vertical: alignment(a.VAlign, "bottom"),
        wrapText: Number(a.WrapText ?? 0), shrinkToFit: Number(a.ShrinkToFit ?? 0), textRotation: Number(a.Rotation ?? 0) < 0 ? 90 - Number(a.Rotation) : Number(a.Rotation ?? 0), indent: Number(a.Indent ?? 0) }) +
        xml("protection", { locked: Number(a.Locked ?? 1), hidden: Number(a.Hidden ?? 0) });
      if (index === 0) defaultXf = xml("xf", attrs, properties);
      xfs.push(xml("xf", { applyAlignment: 1, applyBorder: 1, applyFont: 1, applyFill: 1, applyNumberFormat: 1, ...attrs, xfId: 0 }, properties));
    }
    return xml("styleSheet", { xmlns: namespace }, (custom.size ? xml("numFmts", { count: custom.size }, [...custom].map(([formatCode, numFmtId]) => xml("numFmt", { formatCode, numFmtId })).join("")) : "") +
      xml("fonts", { count: fonts.length }, fonts.join("")) + xml("fills", { count: fills.length }, fills.join("")) + xml("borders", { count: borders.length }, borders.join("")) +
      xml("cellStyleXfs", { count: 1 }, defaultXf) + xml("cellXfs", { count: xfs.length }, xfs.join("")) +
      xml("cellStyles", { count: 1 }, xml("cellStyle", { name: "Normal", xfId: 0, builtinId: 0 })) +
      (dxfs.length ? xml("dxfs", { count: dxfs.length }, dxfs.map(node => {
        const a = node.attributes; let content = "";
        if (a.Back !== undefined || a.Shade !== undefined) content += xml("fill", {}, xml("patternFill", { patternType: patterns[Number(a.Shade ?? 1)] ?? "solid" }, xml("bgColor", { rgb: rgb(a.Back, "FFFFFFFF") })));
        const font = node.children.find(n => n.name === "Font"), fa = font?.attributes ?? {};
        if (font || a.Fore !== undefined) content += xml("font", {}, (font?.text ? xml("name", { val: font.text }) : "") +
          (fa.Bold === undefined ? "" : xml("b", { val: Number(fa.Bold) })) + (fa.Italic === undefined ? "" : xml("i", { val: Number(fa.Italic) })) +
          (fa.Unit === undefined ? "" : xml("sz", { val: Number(fa.Unit) })) + (a.Fore === undefined ? "" : xml("color", { rgb: rgb(a.Fore, "FF000000") })));
        return xml("dxf", {}, content);
      }).join("")) : ""));
  }
  function differential(node: MetadataNode): number {
    const key = JSON.stringify(node); charge(key.length); const existing = differentialIds.get(key);
    if (existing !== undefined) return existing;
    differentialIds.set(key, dxfs.length); dxfs.push(node); return dxfs.length - 1;
  }
  return { register, differential, serialize };
}
export function styleRecord(style: Readonly<Record<string, ImportedValue>> | undefined): MetadataNode | undefined {
  const node = metadataNode(style?.gnumeric);
  return node?.name === "Style" ? node : undefined;
}

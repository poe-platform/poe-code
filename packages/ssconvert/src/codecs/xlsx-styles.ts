import type { XmlElement } from "@poe-code/safe-fs/xml";
import { SsconvertError, type CapabilityContext } from "../contracts.js";
import type { ImportedValue, RichTextRun } from "../workbook.js";
import { xlsxNamespaces } from "./xlsx-schema.js";

const namespace = "http://www.gnumeric.org/v10.dtd";
const knownNamespaces = new Set(Object.values(xlsxNamespaces).flat());
const builtins: Readonly<Record<number, string>> = {
  0: "General", 1: "0", 2: "0.00", 3: "#,##0", 4: "#,##0.00", 9: "0%", 10: "0.00%", 11: "0.00E+00", 12: "# ?/?", 13: "# ??/??",
  14: "[$-f8f2]m/d/yy", 15: "d-mmm-yy", 16: "d-mmm", 17: "mmm-yy", 18: "h:mm AM/PM", 19: "h:mm:ss AM/PM", 20: "h:mm", 21: "h:mm:ss", 22: "m/d/yy h:mm",
  37: "#,##0 ;(#,##0)", 38: "#,##0 ;[Red](#,##0)", 39: "#,##0.00;(#,##0.00)", 40: "#,##0.00;[Red](#,##0.00)", 45: "mm:ss", 46: "[h]:mm:ss", 47: "mmss.0", 48: "##0.0E+0", 49: "@"
};
const palette = ["000000", "FFFFFF", "FF0000", "00FF00", "0000FF", "FFFF00", "FF00FF", "00FFFF", "800000", "008000", "000080", "808000", "800080", "008080", "C0C0C0", "808080", "9999FF", "993366", "FFFFCC", "CCFFFF", "660066", "FF8080", "0066CC", "CCCCFF", "000080", "FF00FF", "FFFF00", "00FFFF", "800080", "800000", "008080", "0000FF", "00CCFF", "CCFFFF", "CCFFCC", "FFFF99", "99CCFF", "FF99CC", "CC99FF", "FFCC99", "3366FF", "33CCCC", "99CC00", "FFCC00", "FF9900", "FF6600", "666699", "969696", "003366", "339966", "003300", "333300", "993300", "993366", "333399", "333333"];
const patterns: Readonly<Record<string, number>> = { none: 0, solid: 1, darkGray: 2, mediumGray: 3, lightGray: 4, gray125: 5, gray0625: 6, darkHorizontal: 7, darkVertical: 8, darkUp: 9, darkDown: 10, darkGrid: 11, darkTrellis: 12, lightHorizontal: 13, lightVertical: 14, lightDown: 15, lightUp: 16, lightGrid: 17, lightTrellis: 18 };
const borderStyles: Readonly<Record<string, number>> = { none: 0, thin: 1, medium: 2, dashed: 3, dotted: 4, thick: 5, double: 6, hair: 7, mediumDashed: 8, dashDot: 9, mediumDashDot: 10, dashDotDot: 11, mediumDashDotDot: 12, slantDashDot: 13 };
const underlines: Readonly<Record<string, number>> = { none: 0, single: 1, double: 2, singleAccounting: 3, doubleAccounting: 4 };
interface Style { readonly format?: string; readonly style: Readonly<Record<string, ImportedValue>>; }
function attribute(node: XmlElement | undefined, name: string): string | undefined { return node?.attributes.find(a => a.localName === name && !a.namespace)?.value; }
function children(node: XmlElement | undefined, name: string): XmlElement[] {
  return node?.children.filter(c => c.localName === name && (xlsxNamespaces.XL_NS_SS!.includes(c.namespace) || !knownNamespaces.has(c.namespace) && !c.name.includes(":"))) ?? [];
}
function child(node: XmlElement | undefined, name: string): XmlElement | undefined { return children(node, name)[0]; }
function boolean(value: string | undefined, fallback = false): boolean { return value === undefined ? fallback : ["1", "true", "TRUE", "on", "ON"].includes(value); }
function number(value: string | undefined, fallback = 0): number {
  const result = value === undefined ? fallback : Number(value);
  if (!Number.isFinite(result)) throw new SsconvertError("io", "E Invalid XLSX: invalid style number"); return result;
}
function sourceRecord(node: XmlElement): ImportedValue {
  return { name: node.localName, namespace: node.namespace, attributes: Object.fromEntries(node.attributes.filter(a => a.namespace !== "http://www.w3.org/2000/xmlns/").map(a => [a.name, a.value])), text: node.text, children: node.children.map(sourceRecord) };
}
function record(name: string, attributes: Readonly<Record<string, string | number>>, text = "", children: readonly ImportedValue[] = []): ImportedValue {
  return { name, namespace, attributes: Object.entries(attributes).map(([name, value]) => ({ name, namespace: "", value: String(value) })), text, children };
}
function indexed(index: number): string {
  if (index < 8) return palette[index] ?? "000000";
  if (index === 65) return "FFFFFF"; if (index === 80) return "FFFF00";
  return palette[index - 8] ?? "000000";
}
function tint(rgb: string, amount: number): string {
  if (Math.abs(amount) < 0.005) return rgb;
  const r = parseInt(rgb.slice(0, 2), 16), g = parseInt(rgb.slice(2, 4), 16), b = parseInt(rgb.slice(4, 6), 16);
  const max = Math.max(r, g, b), min = Math.min(r, g, b), delta = max - min, sum = max + min;
  let light = Math.trunc((sum * 240 + 255) / 510), saturation = 0, hue = 0;
  if (delta) {
    saturation = light <= 120 ? Math.trunc((delta * 240 + Math.trunc(sum / 2)) / sum) : Math.trunc((delta * 240 + Math.trunc((510 - sum) / 2)) / (510 - sum));
    hue = max === r ? Math.trunc((g - b) * 240 / (6 * delta)) : max === g ? 80 + Math.trunc((b - r) * 240 / (6 * delta)) : 160 + Math.trunc((r - g) * 240 / (6 * delta));
    if (hue < 0) hue += 240; else if (hue >= 240) hue -= 240;
  }
  amount = Math.max(-1, Math.min(1, amount));
  light = Math.trunc(amount < 0 ? light * (1 + amount) : light * (1 - amount) + 240 * amount);
  const hex = (value: number) => (value & 255).toString(16).padStart(2, "0").toUpperCase();
  if (!saturation) return hex(Math.trunc(light * 255 / 240)).repeat(3);
  const m2 = light <= 120 ? Math.trunc((light * (240 + saturation) + 120) / 240) : light + saturation - Math.trunc((light * saturation + 120) / 240), m1 = 2 * light - m2;
  const channel = (h: number): number => {
    if (h < 0) h += 240; if (h > 240) h -= 240;
    const value = h < 40 ? m1 + Math.trunc(((m2 - m1) * h + 20) / 40) : h < 120 ? m2 : h < 160 ? m1 + Math.trunc((m2 - m1) * (160 - h + 20) / 40) : m1;
    return Math.trunc((value * 255 + 120) / 240);
  };
  return [channel(hue + 80), channel(hue), channel(hue - 80)].map(hex).join("");
}
function themeColors(theme: XmlElement | undefined): readonly string[] {
  const scheme = theme?.children.find(c => c.localName === "themeElements")?.children.find(c => c.localName === "clrScheme");
  return ["lt1", "dk1", "lt2", "dk2", "accent1", "accent2", "accent3", "accent4", "accent5", "accent6", "hlink", "folHlink"].map(name => {
    const c = scheme?.children.find(c => c.localName === name)?.children[0];
    return attribute(c, c?.localName === "sysClr" ? "lastClr" : "val") ?? (name === "lt1" ? "FFFFFF" : "000000");
  });
}
function color(node: XmlElement | undefined, theme: readonly string[], rich = false): string | undefined {
  if (!node) return undefined;
  const rgb = attribute(node, "rgb"), index = attribute(node, "indexed"), themed = attribute(node, "theme");
  let value: string | undefined;
  if (rgb !== undefined) {
    if (rgb.length !== 8 || [...rgb].some(c => !"0123456789abcdefABCDEF".includes(c))) throw new SsconvertError("io", "E Invalid XLSX: invalid style color");
    value = rgb.slice(-6).toUpperCase();
  } else if (index !== undefined) value = indexed(number(index));
  else if (!rich && themed !== undefined) value = theme[number(themed)] ?? "000000";
  else if (rich) value = "000000";
  return value === undefined ? undefined : rich ? value : tint(value, number(attribute(node, "tint")));
}
function gnumericColor(value: string): string { return [0, 2, 4].map(i => (parseInt(value.slice(i, i + 2), 16) * 257).toString(16).toUpperCase()).join(":"); }

export function readXlsxString(node: XmlElement | undefined, context: CapabilityContext): { value: string; richText?: readonly RichTextRun[] } {
  let value = "", offset = 0; const runs: RichTextRun[] = [];
  for (const item of node?.children ?? []) {
    context.signal.throwIfAborted();
    if (item.localName === "t") { value += item.text; offset += new TextEncoder().encode(item.text).length; }
    if (item.localName !== "r") continue;
    const text = child(item, "t")?.text ?? "", start = offset; value += text; offset += new TextEncoder().encode(text).length;
    const properties = child(item, "rPr"), attributes: Record<string, ImportedValue> = {};
    for (const p of properties?.children ?? []) {
      const val = attribute(p, "val");
      if (p.localName === "family" && val !== undefined) attributes.family = val;
      else if (p.localName === "sz") attributes.size = Math.trunc(Math.max(0, Math.min(1000, number(val))) * 1024);
      else if (p.localName === "b") attributes.bold = boolean(val, true) ? 1 : 0;
      else if (p.localName === "i") attributes.italic = boolean(val, true) ? 1 : 0;
      else if (p.localName === "strike") attributes.strikethrough = boolean(val, true) ? 1 : 0;
      else if (p.localName === "u") attributes.underline = val === "double" ? "double" : val === "none" ? "none" : val === "singleAccounting" || val === "doubleAccounting" ? "low" : "single";
      else if (p.localName === "vertAlign" && val === "subscript") attributes.subscript = 1;
      else if (p.localName === "vertAlign" && val === "superscript") attributes.superscript = 1;
      else if (p.localName === "color") { const rgb = color(p, [], true)!; attributes.color = [rgb.slice(0, 2), rgb.slice(2, 4), rgb.slice(4, 6)].join("x"); }
    }
    if (offset > start && Object.keys(attributes).length) runs.push({ start, end: offset, attributes });
  }
  return { value, ...(runs.length ? { richText: runs } : {}) };
}

export async function readXlsxStyles(root: XmlElement | undefined, theme: XmlElement | undefined, context: CapabilityContext): Promise<readonly Style[]> {
  if (!root) return [];
  if (root.localName !== "styleSheet" || !xlsxNamespaces.XL_NS_SS!.includes(root.namespace)) throw new SsconvertError("io", "E Invalid XLSX: unsupported styleSheet namespace");
  const colors = themeColors(theme), formats = new Map(Object.entries(builtins).map(([id, format]) => [Number(id), format]));
  for (const fmt of children(child(root, "numFmts"), "numFmt")) {
    const id = number(attribute(fmt, "numFmtId")), code = attribute(fmt, "formatCode"); if (code === undefined) continue;
    if (formats.has(id)) { const message = `Ignoring attempt to override number format ${id}`; await context.diagnostic?.({ code: "xlsx", severity: "warning", message, bytes: new TextEncoder().encode(message + "\n") }); }
    else formats.set(id, code);
  }
  const fonts = children(child(root, "fonts"), "font"), fills = children(child(root, "fills"), "fill"), borders = children(child(root, "borders"), "border");
  const parentXfs = children(child(root, "cellStyleXfs"), "xf");
  type Materialized = { attributes: Record<string, string | number>; font: Record<string, string | number>; family: string; border: ImportedValue[]; format: string };
  function materialize(xf: XmlElement, parent?: Materialized): Materialized {
    context.signal.throwIfAborted();
    const result: Materialized = { attributes: { HAlign: "GNM_HALIGN_GENERAL", VAlign: "GNM_VALIGN_BOTTOM", WrapText: 0, ShrinkToFit: 0, Rotation: 0, Shade: 0, Indent: 0, Locked: 1, Hidden: 0, Fore: "0:0:0", Back: "FFFF:FFFF:FFFF", PatternColor: "0:0:0", ...parent?.attributes }, font: { Unit: 10, Bold: 0, Italic: 0, Underline: 0, StrikeThrough: 0, Script: 0, ...parent?.font }, family: parent?.family ?? "Sans", border: [...parent?.border ?? []], format: (attribute(xf, "numFmtId") === undefined ? undefined : formats.get(number(attribute(xf, "numFmtId")))) ?? parent?.format ?? "General" };
    const fontId = attribute(xf, "fontId"), font = fontId === undefined ? undefined : fonts[number(fontId)];
    for (const p of font?.children ?? []) {
      const val = attribute(p, "val");
      if (p.localName === "name" && val !== undefined) result.family = val;
      else if (p.localName === "sz") result.font.Unit = number(val);
      else if (p.localName === "b") result.font.Bold = boolean(val, true) ? 1 : 0;
      else if (p.localName === "i") result.font.Italic = boolean(val, true) ? 1 : 0;
      else if (p.localName === "strike") result.font.StrikeThrough = boolean(val, true) ? 1 : 0;
      else if (p.localName === "u") result.font.Underline = underlines[val ?? "single"] ?? 1;
      else if (p.localName === "vertAlign") result.font.Script = val === "superscript" ? 1 : val === "subscript" ? -1 : 0;
      else if (p.localName === "color") { const rgb = color(p, colors); if (rgb) result.attributes.Fore = gnumericColor(rgb); }
    }
    const fillId = attribute(xf, "fillId"), fill = fillId === undefined ? undefined : fills[number(fillId)], pattern = child(fill, "patternFill");
    if (pattern) {
      result.attributes.Shade = patterns[attribute(pattern, "patternType") ?? "solid"] ?? 1;
      const fg = color(child(pattern, "fgColor"), colors), bg = color(child(pattern, "bgColor"), colors);
      if (fg) result.attributes.Back = gnumericColor(fg); if (bg) result.attributes.PatternColor = gnumericColor(bg);
    }
    const borderId = attribute(xf, "borderId"), border = borderId === undefined ? undefined : borders[number(borderId)];
    if (border) {
      result.border = [];
      for (const [source, target] of [["top", "Top"], ["bottom", "Bottom"], ["left", "Left"], ["right", "Right"]] as const) {
        const edge = child(border, source), style = borderStyles[attribute(edge, "style") ?? "none"] ?? 0;
        if (style) result.border.push(record(target, { Style: style, Color: gnumericColor(color(child(edge, "color"), colors) ?? "000000") }));
      }
    }
    const align = child(xf, "alignment");
    if (align) {
      const h: Readonly<Record<string, string>> = { general: "GENERAL", left: "LEFT", center: "CENTER", right: "RIGHT", fill: "FILL", justify: "JUSTIFY", centerContinuous: "CENTER_ACROSS_SELECTION", distributed: "DISTRIBUTED" };
      const v: Readonly<Record<string, string>> = { top: "TOP", center: "CENTER", bottom: "BOTTOM", justify: "JUSTIFY", distributed: "DISTRIBUTED" };
      const rotation = number(attribute(align, "textRotation"));
      Object.assign(result.attributes, { HAlign: "GNM_HALIGN_" + (h[attribute(align, "horizontal") ?? "general"] ?? "GENERAL"), VAlign: "GNM_VALIGN_" + (v[attribute(align, "vertical") ?? "bottom"] ?? "BOTTOM"), WrapText: boolean(attribute(align, "wrapText")) ? 1 : 0, ShrinkToFit: boolean(attribute(align, "shrinkToFit")) ? 1 : 0, Rotation: rotation === 255 ? -1 : rotation > 90 ? 450 - rotation : rotation, Indent: number(attribute(align, "indent")) });
    }
    const protection = child(xf, "protection"); if (protection) Object.assign(result.attributes, { Locked: boolean(attribute(protection, "locked"), true) ? 1 : 0, Hidden: boolean(attribute(protection, "hidden"), true) ? 1 : 0 });
    return result;
  }
  const parents = parentXfs.map(xf => materialize(xf));
  return children(child(root, "cellXfs"), "xf").map(xf => {
    const parentId = attribute(xf, "xfId"), result = materialize(xf, parentId === undefined ? undefined : parents[number(parentId)]);
    return { format: result.format, style: { xlsx: sourceRecord(xf), gnumeric: record("Style", result.attributes, "", [record("Font", result.font, result.family), ...(result.border.length ? [record("StyleBorder", {}, "", result.border)] : [])]) } };
  });
}

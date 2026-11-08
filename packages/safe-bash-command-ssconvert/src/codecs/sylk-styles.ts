import type { Cell, ImportedValue } from "../workbook.js";
import type { MetadataNode } from "./xlsx-write-support.js";

export type SylkStyle = Record<string, ImportedValue>;
export function sylkStyleNode(style: SylkStyle): ImportedValue {
  function node(name: string, attributes: SylkStyle, children: ImportedValue[] = [], text = ""): ImportedValue {
    return { name, namespace: "http://www.gnumeric.org/v10.dtd", text, children,
      attributes: Object.entries(attributes).map(([name, value]) => ({ name, namespace: "", value: String(value) })) };
  }
  const font = style.Font as SylkStyle | undefined;
  const borders = style.StyleBorder as SylkStyle | undefined;
  return node("Style", Object.fromEntries(Object.entries(style).filter(([key]) => key !== "Font" && key !== "StyleBorder")), [
    ...(font ? [node("Font", Object.fromEntries(Object.entries(font).filter(([key]) => key !== "Name")), [], String(font.Name ?? "Sans"))] : []),
    ...(borders ? [node("StyleBorder", {}, Object.keys(borders).map(key => node(key, { Style: 1, Color: "0:0:0" })))] : [])
  ]);
}
export function sylkMergeStyle(a: SylkStyle, b: SylkStyle): SylkStyle {
  const result = { ...a, ...b };
  for (const key of ["Font", "StyleBorder"]) if (a[key] || b[key]) result[key] = { ...(a[key] as SylkStyle ?? {}), ...(b[key] as SylkStyle ?? {}) };
  return result;
}
export function sylkOutputStyle(node: MetadataNode | undefined, cell?: Cell) {
  // Native SYLK writes effective styles, rather than text-entry value formats.
  const format = cell?.format === cell?.inferredValueFormat ? undefined : cell?.format;
  const font = node?.children.find(n => n.name === "Font");
  const border = node?.children.find(n => n.name === "StyleBorder");
  return { format: format ?? node?.attributes.Format ?? "General", name: font?.text ?? "Sans", size: Number(font?.attributes.Unit ?? 10),
    align: Number(node?.attributes.HAlign ?? 1), bold: Number(font?.attributes.Bold ?? 0) !== 0,
    italic: Number(font?.attributes.Italic ?? 0) !== 0, stipple: Number(node?.attributes.Shade ?? 0) === 5,
    borders: ["Top", "Bottom", "Left", "Right"].map(key => border?.children.some(n => n.name === key && Number(n.attributes.Style ?? 0) > 0) ?? false) };
}

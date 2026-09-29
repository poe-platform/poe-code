import type { XmlElement } from "@poe-code/safe-fs/xml";
import { SsconvertError } from "../contracts.js";
import type { ImportedValue, RichTextRun } from "../workbook.js";
import { createOdfXml, odfNamespaces, type OdfAttributes } from "./odf-write-support.js";
import { createOdfStyleDefinitions } from "./odf-style-definitions.js";
import { richTextSegments } from "./rich-text-runs.js";

const namespaces = {
  text: [odfNamespaces.text!, "http://openoffice.org/2000/text"],
  style: [odfNamespaces.style!, "http://openoffice.org/2000/style"],
  fo: [odfNamespaces.fo!, "http://www.w3.org/1999/XSL/Format"],
  svg: [odfNamespaces.svg!, "http://www.w3.org/2000/svg"],
  gnm: [odfNamespaces.gnm!]
};
function attribute(node: XmlElement, name: string, namespace: keyof typeof namespaces) {
  return node.attributes.find(a => a.localName === name && namespaces[namespace].includes(a.namespace))?.value;
}
function pointSize(source: string | undefined) {
  if (!source) return undefined;
  const factors: Readonly<Record<string, number>> = { pt: 1, pc: 12, in: 72, cm: 72 / 2.54, mm: 72 / 25.4 };
  const factor = factors[source.slice(-2)], size = Number(source.slice(0, -2));
  return factor && Number.isFinite(size) && size >= 0 ? size * factor : undefined;
}

export function createOdfTextReader(roots: readonly XmlElement[], charge: (amount?: number) => void) {
  const styles = new Map<string, XmlElement>(), fonts = new Map<string, string>();
  for (const root of roots) for (const container of root.children) for (const node of container.children) {
    charge();
    if (!namespaces.style.includes(node.namespace)) continue;
    const name = attribute(node, "name", "style");
    if (!name) continue;
    if (["styles", "automatic-styles"].includes(container.localName) && node.localName === "style")
      styles.set(attribute(node, "family", "style") + ":" + name, node);
    if (["font-face-decls", "font-decls"].includes(container.localName)) {
      const family = attribute(node, "font-family", "svg") ?? attribute(node, "font-family", "fo");
      if (family !== undefined) fonts.set(name, family.length >= 2 && ["'", '"'].includes(family[0]!) && family.at(-1) === family[0]
        ? family.slice(1, -1) : family);
    }
  }
  const cache = new Map<string, Readonly<Record<string, ImportedValue>>>(), active = new Set<string>();
  function resolve(name: string | undefined, family: string): Readonly<Record<string, ImportedValue>> {
    if (!name) return {};
    charge(); const key = family + ":" + name, found = cache.get(key);
    if (found) return found;
    const node = styles.get(key); if (!node) return {};
    if (active.has(key)) throw new SsconvertError("io", "E Invalid OpenDocument: cyclic text style inheritance");
    active.add(key);
    try {
      const result: Record<string, ImportedValue> = { ...resolve(attribute(node, "parent-style-name", "style"), family) };
      for (const p of node.children) {
        charge(); if (!namespaces.style.includes(p.namespace) || !["text-properties", "properties"].includes(p.localName)) continue;
        const fontName = attribute(p, "font-name", "style"), font = attribute(p, "font-family", "fo") ?? (fontName ? fonts.get(fontName) ?? fontName : undefined);
        if (font !== undefined) result.family = font;
        const size = pointSize(attribute(p, "font-size", "fo")); if (size !== undefined) result.size = Math.round(size * 1024);
        const bold = attribute(p, "font-weight", "fo"); if (bold !== undefined) result.bold = bold === "bold" || Number(bold) >= 600 ? 1 : 0;
        const italic = attribute(p, "font-style", "fo"); if (italic !== undefined) result.italic = ["italic", "oblique"].includes(italic) ? 1 : 0;
        const strike = attribute(p, "text-line-through-style", "style"); if (strike !== undefined) result.strikethrough = strike === "none" ? 0 : 1;
        const underline = attribute(p, "text-underline-style", "style"), type = attribute(p, "text-underline-type", "style");
        if (underline !== undefined || type === "none") {
          const double = type === "double" || attribute(p, "text-underline-width", "style") === "bold";
          const low = attribute(p, "text-underline-placement", "gnm") === "low";
          result.underline = underline === "none" || type === "none" ? "none"
            : low ? double ? "doubleAccounting" : "low" : double ? "double" : "single";
        }
        const color = attribute(p, "color", "fo");
        if (color?.length === 7 && color[0] === "#" && [...color.slice(1)].every(c => "0123456789abcdefABCDEF".includes(c)))
          result.color = [color.slice(1, 3), color.slice(3, 5), color.slice(5)].map(part => part.toUpperCase()).join("x");
      }
      cache.set(key, result); return result;
    } finally { active.delete(key); }
  }
  return (cell: XmlElement): { value: string; richText?: readonly RichTextRun[] } => {
    let value = "", offset = 0;
    const runs: RichTextRun[] = [];
    function append(text: string, attributes: Readonly<Record<string, ImportedValue>>) {
      charge(text.length); const start = offset; offset += new TextEncoder().encode(text).length; value += text;
      const keys = Object.keys(attributes); charge(keys.length);
      if (offset === start || !keys.length) return;
      const previous = runs.at(-1);
      if (previous?.end === start && Object.keys(previous.attributes).length === keys.length && keys.every(key => previous.attributes[key] === attributes[key]))
        runs[runs.length - 1] = { ...previous, end: offset };
      else runs.push({ start, end: offset, attributes });
    }
    function inline(node: XmlElement, inherited: Readonly<Record<string, ImportedValue>>) {
      charge();
      const attributes = { ...inherited, ...resolve(attribute(node, "style-name", "text"), node.localName === "p" ? "paragraph" : "text") };
      for (const item of node.content) {
        charge();
        if (item.kind === "text" || item.kind === "cdata") append(item.text, attributes);
        else if (item.kind === "element" && namespaces.text.includes(item.namespace)) {
          if (["span", "a"].includes(item.localName)) inline(item, attributes);
          else if (["tab", "tab-stop", "line-break"].includes(item.localName)) append(item.localName === "line-break" ? "\n" : "\t", attributes);
          else if (item.localName === "s") {
            const count = Number(attribute(item, "c", "text") ?? "1");
            if (!Number.isSafeInteger(count) || count < 0) throw new SsconvertError("io", "E Invalid OpenDocument: invalid text space count");
            charge(count); append(" ".repeat(count), attributes);
          }
        }
      }
    }
    let first = true;
    for (const node of cell.children) if (namespaces.text.includes(node.namespace) && node.localName === "p") {
      if (!first) append("\n", {}); first = false; inline(node, {});
    }
    return { value, ...(runs.length ? { richText: runs } : {}) };
  };
}

export function writeOdfRichText(value: string, runs: readonly RichTextRun[], xml: ReturnType<typeof createOdfXml>,
  definitions: ReturnType<typeof createOdfStyleDefinitions>, extended: boolean, hyperlink?: OdfAttributes): string {
  let result = "";
  for (const { text, attributes: a } of richTextSegments(value, runs, xml.charge)) {
    const properties: Record<string, string> = {};
    if (typeof a.family === "string") properties["style:font-name"] = definitions.register("fonts", "style:font-face", "rtfont", { "svg:font-family": a.family });
    if (typeof a.size === "number" && Number.isFinite(a.size) && a.size >= 0) properties["fo:font-size"] = a.size / 1024 + "pt";
    if (a.bold !== undefined) properties["fo:font-weight"] = Number(a.bold) ? "bold" : "normal";
    if (a.italic !== undefined) properties["fo:font-style"] = Number(a.italic) ? "italic" : "normal";
    if (a.strikethrough !== undefined) properties["style:text-line-through-style"] = Number(a.strikethrough) ? "solid" : "none";
    if (typeof a.color === "string") properties["fo:color"] = "#" + a.color.split("x").join("");
    if (typeof a.underline === "string") {
      const low = ["low", "singleAccounting", "doubleAccounting"].includes(a.underline);
      const double = ["double", "double-line", "doubleAccounting"].includes(a.underline);
      const enabled = low || double || ["single", "single-line", "error", "error-line"].includes(a.underline);
      properties["style:text-underline-style"] = enabled ? "solid" : "none";
      properties["style:text-underline-type"] = enabled ? double ? "double" : "single" : "none";
      properties["style:text-underline-width"] = "auto";
      properties["style:text-underline-color"] = "font-color";
      properties["style:text-underline-mode"] = "continuous";
      if (extended && low) properties["gnm:text-underline-placement"] = "low";
    }
    // Calc accepts controls as character data inside spans and URL fields,
    // but its specialized span context does not handle tab/line-break children.
    const content = hyperlink ? xml.element("text:a", hyperlink, xml.escape(text)) : xml.text(text, true);
    if (!Object.keys(properties).length) result += content;
    else {
      const name = definitions.register("contentAutomatic", "style:style", "rt", { "style:family": "text" }, xml.element("style:text-properties", properties));
      result += xml.element("text:span", { "text:style-name": name }, content);
    }
  }
  return result;
}

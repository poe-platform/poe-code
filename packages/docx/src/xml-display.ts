import type { XmlContent, XmlElement } from "./package-xml.js";
import { DocumentBudget } from "./budget.js";

/** Display serialization; adds indentation only where there are no text nodes. */
export function displayXml(root: XmlElement, budget: DocumentBudget, pretty: boolean): string {
  const chunks: string[] = [];
  let size = 0;
  const append = (text: string) => {
    const bytes = new TextEncoder().encode(text).length;
    budget.check("serializedOutput", size + bytes);
    budget.charge("retainedBytes", text.length * 2 + 64);
    budget.charge("work", text.length);
    size += bytes;
    chunks.push(text);
  };
  const escaped = (text: string, attribute = false) => {
    let chunk = "";
    for (const char of text) {
      chunk += char === "&" ? "&amp;" : char === "<" ? "&lt;" : char === ">" ? "&gt;" :
        char === "\r" ? "&#13;" : attribute && char === '"' ? "&quot;" : attribute && char === "\n" ? "&#10;" : attribute && char === "\t" ? "&#9;" : char;
      if (chunk.length >= 4096) { append(chunk); chunk = ""; }
    }
    if (chunk) append(chunk);
  };
  const visit = (node: XmlContent, depth: number, preserve: boolean): void => {
    budget.charge("work", 1);
    if (node.kind === "element") {
      const space = node.attributes.find(a => a.namespace === "http://www.w3.org/XML/1998/namespace" && a.localName === "space")?.value;
      preserve = space === "preserve" || (space !== "default" && preserve);
      append("<" + node.name);
      for (const attr of node.attributes) { append(" " + attr.name + '="'); escaped(attr.value, true); append('"'); }
      if (!node.content.length) { append("/>"); return; }
      append(">");
      const indent = pretty && !preserve && !node.content.some(child => child.kind === "text" || child.kind === "cdata");
      for (const child of node.content) {
        if (indent) append("\n" + "  ".repeat(depth + 1));
        visit(child, depth + 1, preserve);
      }
      if (indent) append("\n" + "  ".repeat(depth));
      append("</" + node.name + ">");
    } else if (node.kind === "comment") append("<!--" + node.text + "-->");
    else if (node.kind === "processing-instruction") append("<?" + node.target + (node.text ? " " + node.text : "") + "?>");
    else if (node.kind === "cdata") append("<![CDATA[" + node.text + "]]>");
    else escaped(node.text);
  };
  if (root.declaration !== undefined) append('<?xml version="1.0" encoding="UTF-8"?>');
  for (const node of root.prolog ?? []) visit(node, 0, false);
  visit(root, 0, false);
  for (const node of root.epilog ?? []) visit(node, 0, false);
  return chunks.join("");
}

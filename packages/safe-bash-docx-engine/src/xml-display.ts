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
    budget.charge("retainedBytes", 64);
    const pending = [{ node, depth, preserve, index: -1, indent: false }];
    while (pending.length) {
      const frame = pending.at(-1)!;
      const current = frame.node;
      if (frame.index === -1) {
        budget.charge("work", 1);
        if (current.kind !== "element") {
          if (current.kind === "comment") append("<!--" + current.text + "-->");
          else if (current.kind === "processing-instruction") append("<?" + current.target + (current.text ? " " + current.text : "") + "?>");
          else if (current.kind === "cdata") append("<![CDATA[" + current.text + "]]>");
          else escaped(current.text);
          pending.pop(); continue;
        }
        const space = current.attributes.find(a => a.namespace === "http://www.w3.org/XML/1998/namespace" && a.localName === "space")?.value;
        frame.preserve = space === "preserve" || (space !== "default" && frame.preserve);
        append("<" + current.name);
        for (const attr of current.attributes) { append(" " + attr.name + '="'); escaped(attr.value, true); append('"'); }
        if (!current.content.length) { append("/>"); pending.pop(); continue; }
        append(">");
        frame.indent = pretty && !frame.preserve && !current.content.some(child => child.kind === "text" || child.kind === "cdata");
        frame.index = 0;
      }
      if (current.kind !== "element") continue;
      const child = current.content[frame.index++];
      if (child) {
        if (frame.indent) append("\n" + "  ".repeat(frame.depth + 1));
        budget.charge("retainedBytes", 64);
        pending.push({ node: child, depth: frame.depth + 1, preserve: frame.preserve, index: -1, indent: false });
      } else {
        if (frame.indent) append("\n" + "  ".repeat(frame.depth));
        append("</" + current.name + ">");
        pending.pop();
      }
    }
  };
  if (root.declaration !== undefined) append('<?xml version="1.0" encoding="UTF-8"?>');
  for (const node of root.prolog ?? []) visit(node, 0, false);
  visit(root, 0, false);
  for (const node of root.epilog ?? []) visit(node, 0, false);
  return chunks.join("");
}

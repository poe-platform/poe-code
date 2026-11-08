import type { XmlElement, XmlContent } from "@poe-code/safe-fs/core";
import { XmlBudget, XmlQueryError } from "safe-bash-xml-engine/limits";

export function outputEncoding(value: string): string {
  const upper = value.toUpperCase();
  const aliases: Record<string, string> = { UTF8: "UTF-8", UTF16: "UTF-16", ASCII: "US-ASCII", LATIN1: "ISO-8859-1" };
  const encoding = aliases[upper] ?? upper;
  if (!["UTF-8", "UTF-16", "UTF-16LE", "UTF-16BE", "US-ASCII", "ISO-8859-1"].includes(encoding))
    throw new XmlQueryError(`unsupported output encoding: ${value}`, 2);
  return encoding;
}
const encoder = new TextEncoder();
export function encodeOutput(text: string, encoding: string | undefined, first: boolean): Uint8Array {
  if (!encoding || encoding === "UTF-8") return encoder.encode(text);
  if (encoding.startsWith("UTF-16")) {
    const bom = first && encoding === "UTF-16" ? 2 : 0;
    const bytes = new Uint8Array(text.length * 2 + bom);
    const view = new DataView(bytes.buffer);
    const little = encoding !== "UTF-16BE";
    if (bom) view.setUint16(0, 0xfeff, little);
    for (let index = 0; index < text.length; index++) view.setUint16(index * 2 + bom, text.charCodeAt(index), little);
    return bytes;
  }
  const ceiling = encoding === "US-ASCII" ? 127 : 255;
  const bytes: number[] = [];
  for (const character of text) {
    const point = character.codePointAt(0)!;
    if (point <= ceiling) bytes.push(point);
    else for (const digit of `&#${point};`) bytes.push(digit.charCodeAt(0));
  }
  return Uint8Array.from(bytes);
}

export async function prepareDocument(root: XmlElement, noblanks: boolean, encoding: string | undefined, budget: XmlBudget, nocdata = false): Promise<XmlElement> {
  const pending = [{ element: root, preserve: false }];
  while ((noblanks || nocdata) && pending.length) {
    const { element, preserve } = pending.pop()!;
    let keep = preserve;
    for (const attribute of element.attributes) {
      const p = budget.tick(); if (p) await p;
      if (attribute.namespace === "http://www.w3.org/XML/1998/namespace" && attribute.localName === "space")
        keep = attribute.value === "preserve";
    }
    const content: XmlContent[] = [];
    let mixed = false;
    for (let index = 0; index < element.content.length; index++) {
      let child = element.content[index]!;
      if (nocdata && (child.kind === "cdata" || child.kind === "text")) {
        const parts = [child.text];
        while (index + 1 < element.content.length) {
          const next = element.content[index + 1]!;
          if (next.kind !== "text" && next.kind !== "cdata") break;
          const p = budget.tick(next.text.length + 1); if (p) await p;
          parts.push(next.text);
          index++;
        }
        child = { kind: "text", text: parts.join("") };
      }
      const p = budget.tick(); if (p) await p;
      if (child.kind === "element") pending.push({ element: child, preserve: keep });
      if (child.kind === "text") {
        let blank = true;
        for (const character of child.text) {
          const p = budget.tick(); if (p) await p;
          if (!" \t\r\n".includes(character)) blank = false;
        }
        if (noblanks && !keep && !mixed && blank && (content.length > 0 || index + 1 < element.content.length)) continue;
        mixed = true;
      } else if (child.kind === "cdata") mixed = true;
      content.push(child);
    }
    // The parser owns these mutable arrays; keep the shared public AST readonly.
    const mutable = element.content as XmlContent[];
    for (let index = 0; index < content.length; index++) mutable[index] = content[index]!;
    mutable.length = content.length;
  }
  if (!encoding) return root;
  let declaration = root.declaration ?? '<?xml version="1.0"?>';
  const start = declaration.indexOf("encoding");
  if (start >= 0) {
    let at = declaration.indexOf("=", start) + 1;
    while (" \t\r\n".includes(declaration[at] ?? "") && at < declaration.length) at++;
    const end = declaration.indexOf(declaration[at]!, at + 1);
    declaration = declaration.slice(0, start) + `encoding="${encoding}"` + declaration.slice(end + 1);
  } else declaration = declaration.slice(0, -2) + ` encoding="${encoding}"?>`;
  return { ...root, declaration };
}

import { InputTypeError, ResourceLimitError } from "./archive.js";
import { DocumentBudget } from "./budget.js";
import {
  parseDocumentXml, documentXmlSettings, InvalidXmlError, type DocumentXml, type DocumentXmlLimits,
  type XmlContent, type XmlElement, type XmlAttribute
} from "./package-xml.js";

import { MarkupCompatibility, compatibilitySettings, documentCompatibilityProfile, hasCompatibilityMarkup, type CompatibilityProfile, type ExpandedXmlName } from "./compatibility.js";
import { dialectForNamespace, validateXmlDialect, type DocumentDialect } from "./dialect.js";

type Token = XmlContent | XmlAttribute;
interface Span { start: number; end: number; owner: XmlContent; }

export class UnsupportedEditError extends Error {
  readonly code = "unsupported-edit";
}

function unsupported(): never {
  throw new UnsupportedEditError("The XML edit cannot establish faithful preservation.");
}

// Index only XML already admitted by the namespace-aware parser. Every retained
// token must match; no omitted subtree may be reconstructed from a partial view.
function indexSource(document: DocumentXml, source: string): Map<Token, Span> {
  const spans = new Map<Token, Span>();
  let offset = source.charCodeAt(0) === 0xfeff ? 1 : 0;
  const consume = (value: string): void => {
    if (!source.startsWith(value, offset)) unsupported();
    offset += value.length;
  };
  const whitespace = (): void => {
    while (offset < source.length && " \t\r\n".includes(source[offset]!)) offset++;
  };
  const until = (delimiter: string): number => {
    const end = source.indexOf(delimiter, offset);
    if (end < 0) unsupported();
    return end;
  };
  const visit = (node: XmlContent): void => {
    if (node.kind === "element") {
      consume("<" + node.name);
      for (const attribute of node.attributes) {
        whitespace();
        consume(attribute.name);
        whitespace();
        consume("=");
        whitespace();
        const quote = source[offset++];
        if (quote !== '"' && quote !== "'") unsupported();
        const start = offset;
        offset = until(quote);
        spans.set(attribute, { start, end: offset, owner: node });
        offset++;
      }
      whitespace();
      if (source.startsWith("/>", offset)) {
        if (node.content.length) unsupported();
        offset += 2;
      } else {
        consume(">");
        for (const child of node.content) visit(child);
        consume("</" + node.name);
        whitespace();
        consume(">");
      }
      return;
    }
    let suffix = "";
    if (node.kind === "comment") { consume("<!--"); suffix = "-->"; }
    else if (node.kind === "cdata") { consume("<![CDATA["); suffix = "]]>"; }
    else if (node.kind === "processing-instruction") {
      consume("<?" + node.target);
      whitespace();
      suffix = "?>";
    }
    const start = offset;
    if (suffix) offset = until(suffix);
    else {
      const next = source.indexOf("<", offset);
      offset = next < 0 ? source.length : next;
      if (offset === start) unsupported();
    }
    spans.set(node, { start, end: offset, owner: node });
    offset += suffix.length;
  };
  if (document.root.declaration !== undefined) {
    consume("<?xml");
    offset = until("?>") + 2;
  }
  for (const node of document.root.prolog ?? []) visit(node);
  visit(document.root);
  for (const node of document.root.epilog ?? []) visit(node);
  if (offset !== source.length) unsupported();
  return spans;
}

function escapeValue(value: string, attribute: boolean): string {
  let escaped = "";
  for (const char of value) {
    if (char === "&") escaped += "&amp;";
    else if (char === "<") escaped += "&lt;";
    else if (char === ">") escaped += "&gt;";
    else if (char === "\r") escaped += "&#13;";
    else if (attribute && char === "\n") escaped += "&#10;";
    else if (attribute && char === "\t") escaped += "&#9;";
    else if (attribute && char === '"') escaped += "&quot;";
    else if (attribute && char === "'") escaped += "&apos;";
    else escaped += char;
  }
  return escaped;
}

export class DocumentXmlEditor {
  readonly #budget: DocumentBudget;
  readonly #profile: CompatibilityProfile;
  #compatibility: MarkupCompatibility | undefined;
  #guardCompatibility = false;
  readonly #document: DocumentXml;
  readonly #source: string;
  readonly #limits: DocumentXmlLimits;
  readonly #spans: Map<Token, Span>;
  readonly #patches = new Map<Token, string>();
  readonly #namespaces = new Map<ReadonlyMap<string, string>, Map<string, string>>();
  readonly #elements = new Set<XmlElement>();
  readonly #dialect: DocumentDialect | undefined;

  constructor(bytes: Uint8Array, limits: DocumentXmlLimits = {}, profile: CompatibilityProfile = documentCompatibilityProfile, budget = new DocumentBudget()) {
    this.#budget = budget;
    this.#profile = compatibilitySettings(profile);
    this.#limits = documentXmlSettings(limits, budget);
    this.#document = parseDocumentXml(bytes, this.#limits, budget);
    budget.charge("retainedBytes", bytes.length * 8);
    budget.charge("work", bytes.length * 8);
    this.#dialect = dialectForNamespace(this.#document.root.namespace);
    this.#guardCompatibility = this.#dialect !== undefined;
    this.#source = new TextDecoder(this.#document.encoding, { fatal: true, ignoreBOM: true }).decode(this.#document.bytes);
    this.#spans = indexSource(this.#document, this.#source);
    const stack: XmlContent[] = [this.#document.root];
    while (stack.length) {
      const node = stack.pop()!;
      if (node.kind === "element") {
        this.#elements.add(node);
        if (hasCompatibilityMarkup(node, this.#profile)) this.#guardCompatibility = true;
        if (!this.#namespaces.has(node.namespaces))
          this.#namespaces.set(node.namespaces, new Map(node.namespaces));
        for (const attribute of node.attributes) Object.freeze(attribute);
        for (const children of [node.content, node.children, node.attributes, node.prolog, node.epilog])
          if (children) Object.freeze(children);
        for (const child of node.content) stack.push(child);
        for (const child of node.prolog ?? []) stack.push(child);
        for (const child of node.epilog ?? []) stack.push(child);
      }
      Object.freeze(node);
    }
  }

  get compatibility(): MarkupCompatibility {
    return this.#compatibility ??= new MarkupCompatibility(this.root, this.#profile, this.#budget);
  }

  get root(): XmlElement { return this.#document.root; }

  get dirtyNodes(): readonly XmlContent[] {
    return [...new Set([...this.#patches.keys()].map(token => this.#spans.get(token)!.owner))];
  }

  setText(node: XmlContent, text: string): void {
    if (typeof text !== "string") throw new InputTypeError("Expected an XML text string.");
    if (!this.#spans.has(node) || !["text", "cdata", "comment", "processing-instruction"].includes(node.kind)) unsupported();
    if (node.kind === "element") unsupported();
    if (node.kind !== "text" && text.includes("\r")) unsupported();
    if (node.kind === "cdata" && text.includes("]]>")) unsupported();
    if (node.kind === "comment" && (text.includes("--") || text.endsWith("-"))) unsupported();
    if (node.kind === "processing-instruction" && (text.includes("?>") || (text.length && " \t\n".includes(text[0]!)))) unsupported();
    this.#stage(node, text, node.text, node.kind === "text");
  }

  setAttribute(element: XmlElement, name: string | ExpandedXmlName, value: string): void {
    if ((typeof name !== "string" && (!name || typeof name !== "object" || Array.isArray(name) ||
      typeof name.namespace !== "string" || typeof name.localName !== "string" ||
      Object.keys(name).some(key => key !== "namespace" && key !== "localName"))) || typeof value !== "string")
      throw new InputTypeError("Expected an XML attribute name or expanded name and string value.");
    if (!this.#elements.has(element)) unsupported();
    const attribute = element.attributes.find(item => typeof name === "string" ? item.name === name :
      item.namespace === name.namespace && item.localName === name.localName);
    if (!attribute || attribute.namespace === "http://www.w3.org/2000/xmlns/") unsupported();
    this.#stage(attribute, value, attribute.value, true);
  }

  #stage(token: Token, value: string, original: string, escape: boolean): void {
    if (value.length > (this.#limits.maxBytes ?? 32 * 1024 * 1024))
      throw new ResourceLimitError("XML output byte limit exceeded.");
    this.#budget.charge("work", value.length * 8);
    this.#budget.charge("retainedBytes", value.length * 12);
    for (const char of value) {
      const point = char.codePointAt(0)!;
      if (!(point === 9 || point === 10 || point === 13 ||
        (point >= 0x20 && point <= 0xd7ff) || (point >= 0xe000 && point <= 0xfffd) ||
        (point >= 0x10000 && point <= 0x10ffff)))
        throw new InvalidXmlError("Invalid XML character in replacement value.");
    }
    if (value !== original && this.#guardCompatibility && !this.compatibility.canEdit(token)) unsupported();
    const before = new Map(this.#patches);
    if (value === original) this.#patches.delete(token);
    else {
      let patch = escape ? escapeValue(value, !("kind" in token)) : value;
      if ("kind" in token && token.kind === "processing-instruction" && value &&
        !" \t\r\n".includes(this.#source[this.#spans.get(token)!.start - 1]!)) patch = " " + patch;
      this.#patches.set(token, patch);
    }
    try {
      // Validate the whole candidate before accepting a staged mutation. This also
      // checks characters, document siblings, encoding and cumulative output limits.
      const candidate = parseDocumentXml(this.serialize(), this.#limits, this.#budget);
      if (this.#dialect && this.#patches.size) validateXmlDialect(candidate.root, this.#dialect, this.#profile, this.#budget);
    } catch (error) {
      this.#patches.clear();
      for (const [key, patch] of before) this.#patches.set(key, patch);
      throw error;
    }
  }

  serialize(): Uint8Array {
    for (const [current, original] of this.#namespaces) {
      if (current.size !== original.size) unsupported();
      for (const [prefix, uri] of original) if (current.get(prefix) !== uri) unsupported();
    }
    if (!this.#patches.size) {
      this.#budget.charge("retainedBytes", this.#document.bytes.length);
      return new Uint8Array(this.#document.bytes);
    }
    const patches = [...this.#patches].map(([token, value]) => ({ ...this.#spans.get(token)!, value }));
    patches.sort((a, b) => a.start - b.start);
    const maxBytes = this.#limits.maxBytes ?? 32 * 1024 * 1024;
    let length = this.#source.length;
    for (const patch of patches) length += patch.value.length - (patch.end - patch.start);
    const utf8 = this.#document.encoding === "UTF-8";
    if (length * (utf8 ? 1 : 2) > maxBytes)
      throw new ResourceLimitError("XML output byte limit exceeded.");
    this.#budget.charge("retainedBytes", length * 8);
    this.#budget.charge("work", length * 4);
    const chunks: string[] = [];
    let offset = 0;
    for (const patch of patches) {
      if (patch.start < offset) unsupported();
      chunks.push(this.#source.slice(offset, patch.start), patch.value);
      offset = patch.end;
    }
    chunks.push(this.#source.slice(offset));
    const source = chunks.join("");
    let bytes: Uint8Array;
    if (utf8) bytes = new TextEncoder().encode(source);
    else {
      bytes = new Uint8Array(source.length * 2);
      const view = new DataView(bytes.buffer);
      for (let index = 0; index < source.length; index++)
        view.setUint16(index * 2, source.charCodeAt(index), this.#document.encoding === "UTF-16LE");
    }
    if (bytes.length > maxBytes) throw new ResourceLimitError("XML output byte limit exceeded.");
    return bytes;
  }
}

import { InputTypeError, ResourceLimitError } from "./archive.js";
import { DocumentBudget } from "./budget.js";
import {
  parseDocumentXml, documentXmlSettings, InvalidXmlError, type DocumentXml, type DocumentXmlLimits,
  type XmlContent, type XmlElement, type XmlAttribute
} from "./package-xml.js";

import { MarkupCompatibility, compatibilitySettings, documentCompatibilityProfile, hasCompatibilityMarkup, type CompatibilityProfile, type ExpandedXmlName } from "./compatibility.js";
import { dialectForNamespace, validateXmlDialect, type DocumentDialect } from "./dialect.js";

type Token = XmlContent | XmlAttribute;
interface Span { start: number; end: number; owner: XmlContent; contentStart?: number; contentEnd?: number; empty?: boolean }

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
      const start = offset;
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
        const contentStart = offset;
        offset += 2;
        spans.set(node, { start, end: offset, contentStart, contentEnd: contentStart, empty: true, owner: node });
      } else {
        consume(">");
        const contentStart = offset;
        for (const child of node.content) visit(child);
        const contentEnd = offset;
        consume("</" + node.name);
        whitespace();
        consume(">");
        spans.set(node, { start, end: offset, contentStart, contentEnd, owner: node });
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

  /** Exact admitted source, for engine-authored fragments retaining lexical XML. */
  sourceXml(node: XmlElement, replacements: ReadonlyMap<XmlElement, string> = new Map(), contentOnly = false): string {
    if (!this.#elements.has(node)) unsupported();
    const span = this.#spans.get(node)!;
    this.#budget.charge("work", span.end - span.start);
    this.#budget.charge("retainedBytes", (span.end - span.start) * 2);
    let offset = contentOnly ? span.contentStart! : span.start;
    const chunks: string[] = [];
    for (const child of replacements.keys()) if (!node.children.includes(child)) unsupported();
    for (const child of node.children) {
      const replacement = replacements.get(child);
      if (replacement === undefined) continue;
      if (typeof replacement !== "string") throw new InputTypeError("Expected XML markup.");
      const childSpan = this.#spans.get(child)!;
      this.#budget.charge("work", replacement.length);
      this.#budget.charge("retainedBytes", replacement.length * 2);
      chunks.push(this.#source.slice(offset, childSpan.start), replacement);
      offset = childSpan.end;
    }
    chunks.push(this.#source.slice(offset, contentOnly ? span.contentEnd! : span.end));
    return chunks.join("");
  }

  /** Replace an owned editable subtree; validate the complete candidate atomically. */
  replaceElement(node: XmlElement, xml: string): void {
    if (typeof xml !== "string") throw new InputTypeError("Expected XML markup.");
    if (!this.#elements.has(node) || node === this.root || this.#patches.has(node)) unsupported();
    const check = (element: XmlElement): void => {
      this.#budget.charge("work", 1);
      if (this.#guardCompatibility && (!this.compatibility.canEdit(element) ||
        element.attributes.some(attribute => attribute.namespace !== "http://www.w3.org/2000/xmlns/" && !this.compatibility.canEdit(attribute)))) unsupported();
      for (const child of element.children) check(child);
    };
    check(node);
    this.#budget.charge("retainedBytes", xml.length * 8);
    this.#budget.charge("work", xml.length * 4);
    this.#patches.set(node, xml);
    try {
      const bindings = [...node.namespaces].filter(([prefix]) => prefix !== "xml").map(([prefix, value]) => ` ${prefix ? "xmlns:" + prefix : "xmlns"}="${escapeValue(value, true)}"`).join("");
      const before = this.#budget.usage.xmlNodes;
      parseDocumentXml(new TextEncoder().encode(`<fragment${bindings}>${xml}</fragment>`), this.#limits, this.#budget);
      this.#budget.charge("insertedNodes", this.#budget.usage.xmlNodes - before - 1);
      const candidate = parseDocumentXml(this.serialize(), this.#limits, this.#budget);
      if (this.#dialect) validateXmlDialect(candidate.root, this.#dialect, this.#profile, this.#budget);
    } catch (error) { this.#patches.delete(node); throw error; }
  }

  /** Replace only scalar text content while preserving the exact owned element shell. */
  replaceScalarText(node: XmlElement, text: string): void {
    if (typeof text !== "string") throw new InputTypeError("Expected an XML text string.");
    if (!this.#elements.has(node) || this.#patches.has(node) || node.content.some(token => token.kind !== "text" && token.kind !== "cdata")) unsupported();
    if (this.#guardCompatibility && (!this.compatibility.canEdit(node) || node.content.some(token => !this.compatibility.canEdit(token)))) unsupported();
    if (node.text === text) return;
    const span = this.#spans.get(node)!;
    const maximum = span.end - span.start + text.length * 6 + node.name.length + 3;
    this.#budget.charge("retainedBytes", maximum * 8);
    this.#budget.charge("work", maximum * 4);
    this.#budget.charge("insertedNodes", text.length ? 1 : 0);
    const patch = this.#source.slice(span.start, span.contentStart!) + (span.empty ? ">" : "") + escapeValue(text, false) + (span.empty ? `</${node.name}>` : this.#source.slice(span.contentEnd!, span.end));
    this.#patches.set(node, patch);
    try {
      const candidate = parseDocumentXml(this.serialize(), this.#limits, this.#budget);
      if (this.#dialect) validateXmlDialect(candidate.root, this.#dialect, this.#profile, this.#budget);
    } catch (error) { this.#patches.delete(node); throw error; }
  }

  /** Inserts admitted markup at an owned child boundary, retaining source tokens. */
  insertChildren(parent: XmlElement, xml: string, before?: XmlElement): void {
    if (typeof xml !== "string") throw new InputTypeError("Expected XML markup.");
    if (!this.#elements.has(parent) || (before && !parent.children.includes(before))) unsupported();
    if (this.#guardCompatibility && !this.compatibility.canEdit(parent)) unsupported();
    const span = this.#spans.get(parent)!;
    const offset = before ? this.#spans.get(before)!.start : span.contentEnd!;
    const prefix = this.#source.slice(span.start, offset);
    const suffix = this.#source.slice(offset, span.end);
    const patch = span.empty ? prefix + ">" + xml + `</${parent.name}>` : prefix + xml + suffix;
    this.#budget.charge("retainedBytes", patch.length * 8);
    this.#budget.charge("work", patch.length * 4);
    if (this.#patches.has(parent)) unsupported();
    this.#patches.set(parent, patch);
    try {
      const candidate = parseDocumentXml(this.serialize(), this.#limits, this.#budget);
      if (this.#dialect) validateXmlDialect(candidate.root, this.#dialect, this.#profile, this.#budget);
      const inserted = parseDocumentXml(new TextEncoder().encode(`<root>${xml}</root>`), this.#limits, this.#budget);
      const count = (node: XmlContent): number => node.kind === "element" ? 1 + node.content.reduce((n, child) => n + count(child), 0) : 1;
      this.#budget.charge("insertedNodes", inserted.root.content.reduce((n, node) => n + count(node), 0));
    } catch (error) { this.#patches.delete(parent); throw error; }
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
      this.#budget.charge("work", this.#document.bytes.length);
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

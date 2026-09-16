import { InputTypeError, ResourceLimitError } from "./archive.js";
import { DocumentBudget } from "./budget.js";
import {
  parseDocumentXml, documentXmlSettings, InvalidXmlError, type DocumentXml, type DocumentXmlLimits,
  type XmlContent, type XmlElement, type XmlAttribute
} from "./package-xml.js";

import { MarkupCompatibility, compatibilitySettings, documentCompatibilityProfile, hasCompatibilityMarkup, type CompatibilityProfile, type ExpandedXmlName } from "./compatibility.js";
import { dialectForNamespace, validateXmlDialect, type DocumentDialect } from "./dialect.js";

import {admitEquationFragment,inspectEquationFragment,mathNamespace} from './equation-fragments.js';
import {documentDialects} from './dialect.js';
import {assertOutsideRevisionRanges} from './revision-markup.js';
import { collectShapeCarriers, type ShapeCarrierCensus } from "./shape-carriers.js";

type Token = XmlContent | XmlAttribute;
interface Span { start: number; end: number; owner: XmlContent; contentStart?: number; contentEnd?: number; empty?: boolean; attributeStart?: number; attributeEnd?: number }

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
        const attributeStart = offset;
        consume(attribute.name);
        whitespace();
        consume("=");
        whitespace();
        const quote = source[offset++];
        if (quote !== '"' && quote !== "'") unsupported();
        const start = offset;
        offset = until(quote);
        offset++;
        spans.set(attribute, { start, end: offset - 1, owner: node, attributeStart, attributeEnd: offset });
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
  #shapes: ShapeCarrierCensus | undefined;
  readonly #boxViews = new Map<XmlElement, MarkupCompatibility>();

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

  /** Every affected native box must admit the operation, even before a no-op edit. */
  assertShapeEditAllowed(node: XmlElement): void {
    if (!this.#dialect) return;
    const span = this.#spans.get(node);
    if (!span) unsupported();
    for (const carrier of this.#shapeCensus().rawCarriers) {
      for (const body of this.#shapeCensus().bodyRoots) {
        const bodySpan = this.#spans.get(body)!;
        const carrierSpan = this.#spans.get(carrier.node)!;
        if (!(carrierSpan.start <= bodySpan.start && bodySpan.end <= carrierSpan.end)) continue;
        if (span.start <= bodySpan.start && bodySpan.end <= span.end || bodySpan.start <= span.start && span.end <= bodySpan.end) {
          if (!carrier.active || carrier.refusalReasons.length || !carrier.bodies.some(b => b.node === body)) unsupported();
        }
      }
    }
  }

  #shapeCensus(): ShapeCarrierCensus {
    return this.#shapes ??= collectShapeCarriers(this.root, this.#dialect!, this.#budget,
      new Map(this.compatibility.branches.map(branch => [branch.alternateContent, branch.selected])));
  }

  #canEdit(token: Token): boolean {
    if (this.compatibility.canEdit(token)) return true;
    if (!this.#dialect) return false;
    const span = this.#spans.get(token);
    if (!span) return false;
    for (const carrier of this.#shapeCensus().carriers) {
      if (carrier.refusalReasons.length) continue;
      for (const body of carrier.bodies) {
        const boundary = this.#spans.get(body.node)!;
        if (boundary.contentStart! <= span.start && span.end <= boundary.contentEnd!) {
          let view = this.#boxViews.get(body.node);
          if (!view) { view = new MarkupCompatibility(body.node, this.#profile, this.#budget); this.#boxViews.set(body.node, view); }
          return view.canEdit(token);
        }
      }
    }
    return false;
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
    this.assertShapeEditAllowed(node);
    const check = (element: XmlElement): void => {
      this.#budget.charge("work", 1);
      if (this.#guardCompatibility && (!this.#canEdit(element) ||
        element.attributes.some(attribute => attribute.namespace !== "http://www.w3.org/2000/xmlns/" && !this.#canEdit(attribute)))) unsupported();
      for (const child of element.children) check(child);
    };
    check(node);
    this.#stageReplacement(node,xml);
  }

  #stageReplacement(node:XmlElement,xml:string):void {
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

  /** Explicit bounded math authority; generic subtree replacement remains conservative. */
  replaceEquationElement(node:XmlElement,markup:string):void {
    if(typeof markup!=="string")throw new InputTypeError("Expected equation markup.");
    if(!this.#elements.has(node)||node===this.root||this.#patches.has(node)||!this.#dialect)unsupported();
    const namespace=mathNamespace(this.#dialect==='strict');
    if(node.namespace!==namespace||!['oMath','oMathPara'].includes(node.localName)||inspectEquationFragment(node,namespace,this.#budget).length)unsupported();
    const fragment=admitEquationFragment(new TextEncoder().encode(markup),namespace,this.#budget);
    if(fragment.root.localName!==node.localName)unsupported();
    this.#assertEquationHost(node);
    this.assertShapeEditAllowed(node);this.#stageReplacement(node,fragment.xml);
  }

  /** Append one bounded math root without granting generic compatibility insertion. */
  appendEquationElement(paragraph:XmlElement,markup:string):void {
    if(typeof markup!=="string")throw new InputTypeError("Expected equation markup.");
    if(!this.#elements.has(paragraph)||this.#patches.has(paragraph)||!this.#dialect||paragraph.namespace!==documentDialects[this.#dialect].w||paragraph.localName!=='p')unsupported();
    const fragment=admitEquationFragment(new TextEncoder().encode(markup),mathNamespace(this.#dialect==='strict'),this.#budget);
    this.#assertEquationHost(paragraph);this.assertShapeEditAllowed(paragraph);
    this.#stageInsertion(paragraph,fragment.xml);
  }

  #assertEquationHost(node:XmlElement):void {
    const namespace=mathNamespace(this.#dialect==='strict'),w=documentDialects[this.#dialect!].w;
    let chain:XmlElement[]|undefined;
    const search=(current:XmlElement,parents:XmlElement[]):void=>{this.#budget.charge('work',1);if(current===node){chain=[...parents,current];return;}for(const child of current.children){if(chain)return;search(child,[...parents,current]);}};
    search(this.root,[]);if(!chain)unsupported();
    let paragraphIndex=-1;for(let i=chain.length-1;i>=0;i--)if(chain[i]!.namespace===w&&chain[i]!.localName==='p'){paragraphIndex=i;break;}if(paragraphIndex<0)unsupported();
    const native=['document','body','hdr','ftr','footnotes','footnote','endnotes','endnote','comments','comment','tbl','tr','tc','p'];
    const mc='http://schemas.openxmlformats.org/markup-compatibility/2006';
    if(chain.slice(0,paragraphIndex+1).some(n=>n.namespace===w?!native.includes(n.localName):n.namespace!==mc||!['AlternateContent','Choice','Fallback'].includes(n.localName))||chain.slice(paragraphIndex+1,-1).some(n=>n.namespace!==mc||!['AlternateContent','Choice','Fallback'].includes(n.localName)))unsupported();
    const paragraph=chain[paragraphIndex]!,view=this.compatibility,active=new Set<XmlElement>();
    const projected=(content:typeof view.content):void=>{for(const item of content){this.#budget.charge('work',1);if('source' in item){active.add(item.source);this.#budget.charge('retainedBytes',32);if(item.disposition==='understood')projected(item.content);}}};projected(view.content);
    if(!active.has(node)||!active.has(paragraph))unsupported();
    const check=(current:XmlElement):void=>{this.#budget.charge('work',1+current.attributes.length);if(current.namespace===mc&&current.localName==='AlternateContent'){view.branches.find(b=>b.alternateContent===current)?.selected?.children.forEach(check);return;}if(!active.has(current))return;
      if(![w,namespace].includes(current.namespace)||current.namespace===w&&['sdt','fldSimple','fldChar','instrText','ins','del','moveFrom','moveTo','pPrChange','rPrChange','moveFromRangeStart','moveFromRangeEnd','moveToRangeStart','moveToRangeEnd'].includes(current.localName)||current.attributes.some(a=>![w,namespace,mc,'','http://www.w3.org/XML/1998/namespace','http://www.w3.org/2000/xmlns/'].includes(a.namespace)))unsupported();current.children.forEach(check);};check(paragraph);
    assertOutsideRevisionRanges(this.root,paragraph,this.#budget,view.branches);
  }

  /** Replace only scalar text content while preserving the exact owned element shell. */
  replaceScalarText(node: XmlElement, text: string): void {
    if (typeof text !== "string") throw new InputTypeError("Expected an XML text string.");
    if (!this.#elements.has(node) || this.#patches.has(node) || node.content.some(token => token.kind !== "text" && token.kind !== "cdata")) unsupported();
    if (this.#guardCompatibility && (!this.#canEdit(node) || node.content.some(token => !this.#canEdit(token)))) unsupported();
    this.assertShapeEditAllowed(node);
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
    if (this.#guardCompatibility && !this.#canEdit(parent)) unsupported();
    this.assertShapeEditAllowed(parent);
    this.#stageInsertion(parent,xml,before);
  }

  #stageInsertion(parent:XmlElement,xml:string,before?:XmlElement):void {
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

  /** Leading scalar XML text, retaining every child and non-text token. */
  setLeadingText(element: XmlElement, value: string | null): void {
    this.#assertOwnedEdit(element);
    const leading: XmlContent[] = [];
    for (const token of element.content) {
      if (token.kind !== "text" && token.kind !== "cdata") break;
      leading.push(token);
    }
    if (this.#guardCompatibility && leading.some(token => !this.#canEdit(token))) unsupported();
    const span = this.#spans.get(element)!;
    const end = leading.length ? this.#spans.get(leading.at(-1)!)!.end + (leading.at(-1)!.kind === "cdata" ? 3 : 0) : span.contentStart!;
    const patch = this.#source.slice(span.start, span.contentStart!) + (span.empty ? ">" : "")
      + escapeValue(value ?? "", false) + (span.empty ? `</${element.name}>` : this.#source.slice(end, span.end));
    this.#acceptOwnedPatch(element, patch, value ? 1 : 0);
  }

  /** Tail text is owned by the containing element, never by an external resource. */
  setElementTail(element: XmlElement, value: string | null): void {
    if (!this.#elements.has(element)) unsupported();
    const parent = [...this.#elements].find(node => node.children.includes(element));
    const owner = parent ?? element;
    this.#assertOwnedEdit(owner);
    const content = parent?.content ?? this.root.epilog ?? [];
    const index = parent ? content.indexOf(element) + 1 : 0;
    let end = this.#spans.get(element)!.end;
    for (let offset = index; offset < content.length; offset++) {
      const token = content[offset]!;
      if (token.kind !== "text" && token.kind !== "cdata") break;
      if (parent && this.#guardCompatibility && !this.#canEdit(token)) unsupported();
      end = this.#spans.get(token)!.end + (token.kind === "cdata" ? 3 : 0);
    }
    if (!parent) {
      if (end !== this.#spans.get(element)!.end) {
        let first = true;
        for (const token of content) {
          if (token.kind !== "text") break;
          this.setText(token, first ? value ?? "" : "");
          first = false;
        }
        return;
      }
      if (!value) return;
      this.#acceptOwnedPatch(element, this.sourceXml(element) + escapeValue(value ?? "", false), value ? 1 : 0);
      return;
    }
    const span = this.#spans.get(parent)!;
    const start = this.#spans.get(element)!.end;
    this.#acceptOwnedPatch(parent, this.#source.slice(span.start, start) + escapeValue(value ?? "", false) + this.#source.slice(end, span.end), value ? 1 : 0);
  }

  /** Qualified attribute insertion/removal preserves unrelated lexical shells. */
  setQualifiedAttribute(element: XmlElement, name: ExpandedXmlName, value: string | null): void {
    this.#assertOwnedEdit(element);
    if (name.namespace === "http://www.w3.org/2000/xmlns/" || name.localName === "xmlns") unsupported();
    const existing = element.attributes.find(attribute => attribute.namespace === name.namespace && attribute.localName === name.localName);
    if (existing && this.#guardCompatibility && !this.#canEdit(existing)) unsupported();
    if (!existing && this.#guardCompatibility && !this.#profile.understoodNamespaces.includes(name.namespace)
      && !this.#profile.understoodElements?.some(node => node.namespace === element.namespace && node.localName === element.localName
        && node.attributes.some(attribute => attribute.namespace === name.namespace && attribute.localName === name.localName))) unsupported();
    if (!existing && value === null) return;
    if (existing && value !== null) { this.setAttribute(element, name, value); return; }
    const span = this.#spans.get(element)!;
    let patch: string;
    if (existing) {
      const attribute = this.#spans.get(existing)!;
      patch = this.#source.slice(span.start, attribute.attributeStart!) + this.#source.slice(attribute.attributeEnd!, span.end);
    } else {
      let prefix = "", declaration = "";
      if (name.namespace) {
        prefix = [...element.namespaces].find(([prefix, namespace]) => prefix && namespace === name.namespace)?.[0] ?? "xv";
        if (!element.namespaces.has(prefix)) declaration = ` xmlns:${prefix}="${escapeValue(name.namespace, true)}"`;
        else if (element.namespaces.get(prefix) !== name.namespace) {
          while (element.namespaces.has(prefix)) prefix += "v";
          declaration = ` xmlns:${prefix}="${escapeValue(name.namespace, true)}"`;
        }
      }
      const offset = span.empty ? span.contentStart! : span.contentStart! - 1;
      patch = this.#source.slice(span.start, offset) + declaration + ` ${prefix ? prefix + ":" : ""}${name.localName}="${escapeValue(value!, true)}"` + this.#source.slice(offset, span.end);
    }
    this.#acceptOwnedPatch(element, patch, existing ? 0 : 1);
  }

  #assertOwnedEdit(element: XmlElement): void {
    if (!this.#elements.has(element) || this.#patches.size || this.#guardCompatibility && !this.#canEdit(element)) unsupported();
    this.assertShapeEditAllowed(element);
  }

  #acceptOwnedPatch(element: XmlElement, patch: string, inserted: number): void {
    this.#budget.charge("work", patch.length * 4);
    this.#budget.charge("retainedBytes", patch.length * 8);
    this.#patches.set(element, patch);
    try {
      const candidate = parseDocumentXml(this.serialize(), this.#limits, this.#budget);
      if (this.#dialect) validateXmlDialect(candidate.root, this.#dialect, this.#profile, this.#budget);
      this.#budget.charge("insertedNodes", inserted);
    } catch (error) { this.#patches.delete(element); throw error; }
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
    if (value !== original && this.#guardCompatibility && !this.#canEdit(token)
      && !("kind" in token && token.kind === "text" && this.root.epilog?.includes(token))) unsupported();
    const owner = this.#spans.get(token)!.owner;
    const element = owner.kind === "element" ? owner : [...this.#elements].find(n => n.content.includes(owner));
    if (element) this.assertShapeEditAllowed(element);
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

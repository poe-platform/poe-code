import { BoundsError, StaleHandleError } from "./model-errors.js";
import { InputTypeError } from "./archive.js";
import { validateDocxValue } from "./operation-schema.js";
import { runElementOpen } from "./run-properties.js";
import { xmlValue } from "./create-content.js";
import { DocumentBudget } from "./budget.js";
import { DocumentXmlEditor, UnsupportedEditError } from "./xml-write.js";
import type { XmlElement } from "./package-xml.js";
import type { DocxXmlNode } from "./operation-types.js";

export interface XmlViewName { readonly namespaceURI: string; readonly localName: string }

/** Internal live binding; callbacks never come from operation input. */
export interface XmlViewBinding {
  readonly budget: DocumentBudget;
  read(): DocumentXmlEditor;
  resolve(xml: DocumentXmlEditor): XmlElement;
  change(action: (xml: DocumentXmlEditor) => void): void;
  inserted?(parent: XmlElement, node: DocxXmlNode, index: number): void;
  removed?(parent: XmlElement | undefined, node: XmlElement): void;
  removeRoot?(): void;
}

function expanded(node: { namespace: string; localName: string }): XmlViewName {
  return Object.freeze({ namespaceURI: node.namespace, localName: node.localName });
}

function markup(node: DocxXmlNode, budget: DocumentBudget, depth = 1): string {
  budget.check("xmlDepth", depth);
  budget.charge("work", 1);
  if (node.kind === "text") return xmlValue(node.text);
  if (node.kind === "comment") return `<!--${node.text}-->`;
  if (node.kind === "processingInstruction") return `<?${node.target}${node.data ? " " + node.data : ""}?>`;
  if (node.kind !== "element") throw new InputTypeError("Expected a structured XML element.");
  const namespaces = new Map<string, string>();
  const qualify = (name: XmlViewName, attribute = false): string => {
    if (!name.namespaceURI) return name.localName;
    if (name.namespaceURI === "http://www.w3.org/2000/xmlns/") throw new UnsupportedEditError("Namespace declarations are not mutable attributes.");
    const prefix = name.namespaceURI === "http://www.w3.org/XML/1998/namespace" ? "xml"
      : name.namespaceURI === "http://purl.org/dc/terms/" ? "dcterms"
      : [...namespaces].find(([, uri]) => uri === name.namespaceURI)?.[0] ?? `x${namespaces.size}`;
    namespaces.set(prefix, name.namespaceURI);
    if (attribute && name.localName === "xmlns") throw new UnsupportedEditError("Namespace declarations are not mutable attributes.");
    return `${prefix}:${name.localName}`;
  };
  const tag = qualify(node.name);
  const attributes = (node.attributes ?? []).map(attribute => ` ${qualify(attribute.name, true)}="${xmlValue(attribute.value)}"`).join("");
  const declarations = [...namespaces].filter(([prefix]) => prefix !== "xml").map(([prefix, uri]) => ` xmlns:${prefix}="${xmlValue(uri)}"`).join("");
  const children = (node.children ?? []).map(child => markup(child, budget, depth + 1)).join("");
  budget.charge("retainedBytes", (tag.length + attributes.length + declarations.length + children.length) * 2);
  return `<${tag}${declarations}${attributes}>${children}</${tag}>`;
}

class XmlViewStore {
  readonly paths = new Map<XmlElementView, number[] | null>();
  private source: string | undefined;
  constructor(readonly binding: XmlViewBinding) {}
  read(): { xml: DocumentXmlEditor; root: XmlElement } {
    this.binding.budget.check("work", 0);
    const xml = this.binding.read(), root = this.binding.resolve(xml);
    const source = xml.sourceXml(root);
    if (this.source !== undefined && source !== this.source)
      for (const [view, path] of this.paths) if (path?.length) this.paths.set(view, null);
    this.source = source;
    return { xml, root };
  }
  node(view: XmlElementView): { xml: DocumentXmlEditor; node: XmlElement } {
    const { xml, root } = this.read(), path = this.paths.get(view);
    if (!path) throw new StaleHandleError("The XML view is detached.");
    let node = root;
    for (const index of path) {
      this.binding.budget.charge("work", 1);
      const child = node.children[index];
      if (!child) throw new StaleHandleError("The XML view is detached.");
      node = child;
    }
    return { xml, node };
  }
  view(path: number[]): XmlElementView {
    this.binding.budget.charge("retainedBytes", 128 + path.length * 8);
    const view = new XmlElementView(this);
    this.paths.set(view, path);
    return view;
  }
  change(action: (xml: DocumentXmlEditor, root: XmlElement) => void): void {
    this.read();
    this.binding.change(xml => action(xml, this.binding.resolve(xml)));
    const xml = this.binding.read();
    this.source = xml.sourceXml(this.binding.resolve(xml));
  }
  shift(parent: number[], index: number, remove: boolean): void {
    for (const [view, path] of this.paths) {
      if (!path || path.length <= parent.length || !parent.every((value, offset) => path[offset] === value)) continue;
      const position = path[parent.length]!;
      if (remove && position === index) this.paths.set(view, null);
      else if (position >= index) this.paths.set(view, [...path.slice(0, parent.length), position + (remove ? -1 : 1), ...path.slice(parent.length + 1)]);
    }
  }
}

/** Owner-bound XML surface with explicit names and structured, validated edits. */
export class XmlElementView {
  readonly #store: XmlViewStore;
  constructor(store: XmlViewStore) { this.#store = store; Object.freeze(this); }
  get tag(): XmlViewName { return expanded(this.#store.node(this).node); }
  get localName(): string { return this.tag.localName; }
  get namespace(): string { return this.tag.namespaceURI; }
  get attributes(): ReadonlyMap<XmlViewName, string> {
    const attributes = this.#store.node(this).node.attributes;
    this.#store.binding.budget.charge("retainedBytes", attributes.length * 128);
    return new Map(attributes.filter(attribute => attribute.namespace !== "http://www.w3.org/2000/xmlns/").map(attribute => [expanded(attribute), attribute.value]));
  }
  get children(): readonly XmlElementView[] {
    const { node } = this.#store.node(this), path = this.#store.paths.get(this)!;
    return Object.freeze(node.children.map((_, index) => this.#store.view([...path!, index])));
  }
  get text(): string | null {
    const { node } = this.#store.node(this);
    let text = "";
    for (const token of node.content) { if (token.kind !== "text" && token.kind !== "cdata") break; text += token.text; }
    return text || null;
  }
  set text(value: string | null) {
    if (value !== null && typeof value !== "string") throw new InputTypeError("Expected XML text or null.");
    this.#store.node(this);
    const path = this.#store.paths.get(this)!;
    this.#store.change((xml, root) => xml.setLeadingText(this.resolve(root, path!), value));
  }
  get tail(): string | null {
    const { xml, node } = this.#store.node(this);
    const stack = [xml.root];
    let content = xml.root.epilog ?? [], index = 0;
    while (stack.length) {
      const parent = stack.pop()!;
      this.#store.binding.budget.charge("work", 1);
      if (parent.children.includes(node)) { content = parent.content; index = content.indexOf(node) + 1; break; }
      stack.push(...parent.children);
    }
    let text = "";
    for (; index < content.length; index++) { const token = content[index]!; if (token.kind !== "text" && token.kind !== "cdata") break; text += token.text; }
    return text || null;
  }
  set tail(value: string | null) {
    if (value !== null && typeof value !== "string") throw new InputTypeError("Expected XML tail or null.");
    this.#store.node(this);
    const path = this.#store.paths.get(this)!;
    this.#store.change((xml, root) => xml.setElementTail(this.resolve(root, path!), value));
  }
  set_attribute(name: XmlViewName, value: string | null): void {
    if (!validateDocxValue("ExpandedName", name) || value !== null && typeof value !== "string") throw new InputTypeError("Expected an expanded XML attribute and string or null.");
    this.#store.node(this);
    const path = this.#store.paths.get(this)!;
    this.#store.change((xml, root) => xml.setQualifiedAttribute(this.resolve(root, path!), { namespace: name.namespaceURI, localName: name.localName }, value));
  }
  insert(index: number, node: DocxXmlNode): XmlElementView {
    const { node: parent } = this.#store.node(this), path = this.#store.paths.get(this)!;
    if (!Number.isSafeInteger(index) || index < 0 || index > parent.children.length) throw new BoundsError("XML child index is out of range.");
    if (!validateDocxValue("XmlNodeInput", node)) throw new InputTypeError("Expected an original structured XML node.");
    const source = markup(node, this.#store.binding.budget);
    this.#store.change((xml, root) => { const parent = this.resolve(root, path!); xml.insertChildren(parent, source, parent.children[index]); });
    this.#store.binding.inserted?.(parent, node, index);
    if (node.kind !== "element") return this;
    this.#store.shift(path!, index, false);
    return this.#store.view([...path!, index]);
  }
  remove(): void {
    const { xml, node } = this.#store.node(this), path = this.#store.paths.get(this)!;
    if (!path!.length && this.#store.binding.removeRoot) {
      this.#store.binding.removeRoot();
      for (const view of this.#store.paths.keys()) this.#store.paths.set(view, null);
      return;
    }
    const parentPath = path!.slice(0, -1), parent = path!.length ? this.resolve(this.#store.binding.resolve(xml), parentPath) : undefined;
    this.#store.change((editor, root) => editor.replaceElement(this.resolve(root, path!), ""));
    this.#store.binding.removed?.(parent, node);
    if (!path!.length) { for (const view of this.#store.paths.keys()) this.#store.paths.set(view, null); }
    else this.#store.shift(parentPath, path!.at(-1)!, true);
  }
  serialize(): Uint8Array {
    const { xml, node } = this.#store.node(this);
    const source = runElementOpen(node) + xml.sourceXml(node, new Map(), true) + `</${node.name}>`;
    const bytes = new TextEncoder().encode(source);
    this.#store.binding.budget.check("serializedOutput", bytes.length);
    this.#store.binding.budget.charge("retainedBytes", bytes.length);
    return bytes;
  }
  private resolve(root: XmlElement, path: number[]): XmlElement {
    let node = root;
    for (const index of path) { const child = node.children[index]; if (!child) throw new StaleHandleError("The XML view is detached."); node = child; }
    return node;
  }
}

export function bindXmlElementView(binding: XmlViewBinding): XmlElementView {
  const store = new XmlViewStore(binding);
  return store.view([]);
}

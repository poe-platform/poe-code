import { parseStoredXml } from "./recovery.js";
import { type XmlAttribute, type XmlContent, type XmlElement } from "@poe-code/safe-fs/core";
import { PagedStorage, type PagedStorageContext } from "@poe-code/safe-fs/storage";
import { StoredStringMap as StoredNamespaces } from "./stored-map.js";
import { XmlBudget } from "./limits.js";

// Fixed-size links are separate from the variable-size node metadata. Pointers
// are safe integer byte offsets; zero is the absent-link sentinel.
const headerBytes = 80;
const namespacesField = 72;
const parentField = 0, nextField = 8, firstField = 16, lastField = 24, sizeField = 32, firstAttributeField = 40, lastAttributeField = 48, flagsField = 56, fragmentField = 64;
const textFlag = 1, preserveSpaceFlag = 2;

export type StoredAttribute = XmlAttribute & { readonly valueReference?: number; readonly namespaceValueReference?: number };
export type StoredXmlAttribute = { kind: "attribute"; value: XmlAttribute };
type XmlStreamEvent = Parameters<NonNullable<Parameters<typeof parseStoredXml>[4]>>[0];
type Metadata = StoredXmlAttribute | Exclude<XmlContent, XmlElement> | {
  kind: "element"; name: string; localName: string; namespace: string;
  declaration?: string;
};

/** XML node state in the caller's paged filesystem storage. Metadata is loaded
 * one node at a time; XML tokens and parser ancestry still have their own cost. */
export class StoredXmlDocument {
  private rootReference = 0;
  private documentReference = 0;
  readonly storage: PagedStorage;
  private closing: Promise<void> | undefined;

  private constructor(context: PagedStorageContext, readonly budget: XmlBudget, pages: number) {
    this.storage = new PagedStorage(context, pages);
  }

  get root(): number { return this.rootReference; }
  get document(): number { return this.documentReference; }

  static async parse(source: AsyncIterable<string> | Iterable<string>, context: PagedStorageContext & { readonly registerCleanup?: (cleanup: () => Promise<void>) => void },
    budget: XmlBudget, pages = 64, recover?: (message: string) => void): Promise<StoredXmlDocument> {
    const document = new StoredXmlDocument(context, budget, pages);
    try {
      context.registerCleanup?.(document.close.bind(document));
      document.documentReference = await document.storage.append(new Uint8Array(headerBytes));
      const namespaces = await new StoredNamespaces(document.storage, budget).set("xml", "http://www.w3.org/XML/1998/namespace");
      await document.set(document.documentReference, namespacesField, namespaces.reference);
      let parent = document.documentReference, fragmentTail = 0, attributeTail = 0;
      let pendingNamespace: { prefix: string; reference: number } | undefined;
      const consume = async (event: XmlStreamEvent): Promise<void> => {
          if (pendingNamespace && !(event.type === "attribute" && event.continuation)) {
            const scope = await document.namespaceScope(parent);
            const updated = await scope.set(pendingNamespace.prefix, document.text(pendingNamespace.reference));
            await document.set(parent, namespacesField, updated.reference);
            pendingNamespace = undefined;
          }
          if (event.type === "attribute") {
            const reference = await document.append(parent, { kind: "attribute", value: event.attribute }, event.continuation);
            if (event.continuation) await document.set(attributeTail, fragmentField, reference);
            attributeTail = reference;
            if (!event.continuation && event.attribute.namespace === "http://www.w3.org/2000/xmlns/")
              pendingNamespace = { prefix: event.attribute.name === "xmlns" ? "" : event.attribute.localName, reference };
            return;
          }
          if (event.type === "close") { parent = await document.field(parent, parentField); return; }
          let metadata: Metadata;
          if (event.type === "content") metadata = event.content;
          else {
            const element = event.element;
            metadata = { kind: "element", name: element.name, localName: element.localName, namespace: element.namespace,
              ...(element.declaration === undefined ? {} : { declaration: element.declaration }) };
          }
          const continuation = event.type === "content" && event.continuation === true;
          const reference = await document.append(parent, metadata, continuation);
          if (continuation) await document.set(fragmentTail, fragmentField, reference);
          fragmentTail = reference;
          if (event.type === "open") {
            const namespaces = await document.namespaceScope(parent);
            await document.set(reference, namespacesField, namespaces.reference);
            if (!document.rootReference) document.rootReference = reference;
            parent = reference;
          }
      };
      await parseStoredXml(source, context, budget, recover, consume);
      return document;
    } catch (error) {
      try { await document.close(); }
      catch { /* Preserve the original parser, source or cancellation failure. */ }
      throw error;
    }
  }

  private async field(reference: number, offset: number): Promise<number> {
    const bytes = await this.storage.read(reference + offset, 8);
    return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getFloat64(0, true);
  }

  private async set(reference: number, offset: number, value: number): Promise<void> {
    const bytes = new Uint8Array(8);
    new DataView(bytes.buffer).setFloat64(0, value, true);
    await this.storage.write(reference + offset, bytes);
  }

  private async append(parent: number, metadata: Metadata, fragment = false): Promise<number> {
    const source = JSON.stringify(metadata);
    const encoder = new TextEncoder();
    // Encode in fixed windows instead of allocating another full-node byte copy.
    let size = 0, scanned = 0;
    for (const character of source) {
      const point = character.codePointAt(0)!;
      size += point <= 0x7f ? 1 : point <= 0x7ff ? 2 : point <= 0xffff ? 3 : 4;
      if (++scanned === 4096) { const checkpoint = this.budget.tick(scanned); if (checkpoint) await checkpoint; scanned = 0; }
    }
    const reference = this.storage.allocate(headerBytes + size);
    const header = new Uint8Array(headerBytes), view = new DataView(header.buffer);
    view.setFloat64(parentField, parent, true);
    view.setFloat64(sizeField, size, true);
    await this.storage.write(reference, header);
    let at = reference + headerBytes;
    for (let offset = 0; offset < source.length;) {
      let end = Math.min(source.length, offset + 4096);
      const last = source.charCodeAt(end - 1);
      if (end < source.length && last >= 0xd800 && last <= 0xdbff) end--;
      const bytes = encoder.encode(source.slice(offset, end));
      await this.storage.write(at, bytes);
      at += bytes.length; offset = end;
      const checkpoint = this.budget.tick(bytes.length); if (checkpoint) await checkpoint;
    }
    if (fragment) return reference;
    const firstLink = metadata.kind === "attribute" ? firstAttributeField : firstField;
    const lastLink = metadata.kind === "attribute" ? lastAttributeField : lastField;
    const last = await this.field(parent, lastLink);
    if (metadata.kind === "attribute") await this.set(reference, lastField, last);
    if (last) await this.set(last, nextField, reference);
    else await this.set(parent, firstLink, reference);
    await this.set(parent, lastLink, reference);
    return reference;
  }

  /** Buffering convenience API; engine traversal uses metadata and attribute links. */
  async node(reference: number): Promise<XmlContent | StoredXmlAttribute> {
    const value = await this.metadata(reference);
    if (value.kind === "element") {
      const attributes: XmlAttribute[] = [];
      for await (const attribute of this.attributes(reference)) {
        const { valueReference: ignoredReference, ...complete } = attribute;
        complete.value = "";
        for await (const part of this.attributeText(attribute)) complete.value += part;
        attributes.push(complete);
      }
      const namespaces = new Map<string, string>();
      for await (const [prefix, uri] of await this.namespaceScope(reference)) namespaces.set(prefix, uri);
      return { ...value, attributes, namespaces };
    }
    if (value.kind === "attribute") {
      let text = "";
      for await (const part of this.text(reference)) text += part;
      return { ...value, value: { ...value.value, value: text } };
    }
    return value;
  }

  async namespaceScope(reference: number): Promise<StoredNamespaces> {
    return new StoredNamespaces(this.storage, this.budget, await this.field(reference, namespacesField));
  }

  /** Load scalar metadata only; attributes and namespace scopes have separate iterators. */
  async metadata(reference: number): Promise<XmlContent | StoredXmlAttribute> {
    const size = await this.field(reference, sizeField);
    const decoder = new TextDecoder();
    const parts: string[] = [];
    for (let offset = 0; offset < size; offset += 16384) {
      const bytes = await this.storage.read(reference + headerBytes + offset, Math.min(16384, size - offset));
      parts.push(decoder.decode(bytes, { stream: true }));
      const checkpoint = this.budget.tick(bytes.length); if (checkpoint) await checkpoint;
    }
    parts.push(decoder.decode());
    const metadata = JSON.parse(parts.join("")) as Metadata;
    if (metadata.kind === "cdata" && (await this.field(reference, flagsField) & textFlag))
      return { kind: "text", text: metadata.text };
    return metadata.kind === "element"
      ? { ...metadata, attributes: [], namespaces: new Map<string, string>(), children: [], content: [], text: "" }
      : metadata;
  }

  /** Content bodies may span parser fragments or coalesced text tokens.
   * Replay them without making a concatenated node value. */
  async *text(reference: number): AsyncGenerator<string> {
    let fragment = reference;
    while (fragment) {
      const node = await this.metadata(fragment);
      if (node.kind === "element") throw new TypeError("Expected XML value node");
      yield node.kind === "attribute" ? node.value.value : node.text;
      fragment = await this.field(fragment, fragmentField);
    }
  }

  /** Apply tree transformations by changing stored links. Whitespace inheritance
   * lives on each parent record; merged text remains a chain of token bodies. */
  async transform(options: { noblanks?: boolean; nocdata?: boolean }): Promise<void> {
    if (!options.noblanks && !options.nocdata) return;
    for await (const event of this.walk(this.root)) {
      if (event.closing) continue;
      const element = await this.metadata(event.reference);
      if (element.kind !== "element") continue;
      let preserve = (await this.field(await this.parent(event.reference), flagsField) & preserveSpaceFlag) !== 0;
      for await (const attribute of this.attributes(event.reference)) {
        if (attribute.namespace === "http://www.w3.org/XML/1998/namespace" && attribute.localName === "space")
          preserve = await this.attributeEquals(attribute, "preserve");
      }
      await this.set(event.reference, flagsField, preserve ? preserveSpaceFlag : 0);
      let current = await this.field(event.reference, firstField), previous = 0, mixed = false;
      while (current) {
        let child = await this.metadata(current);
        let next = await this.field(current, nextField);
        if (options.nocdata && (child.kind === "text" || child.kind === "cdata")) {
          await this.set(current, flagsField, textFlag);
          let tail = current;
          for (let fragment = await this.field(tail, fragmentField); fragment; fragment = await this.field(tail, fragmentField)) tail = fragment;
          while (next) {
            const adjacent = await this.metadata(next);
            if (adjacent.kind !== "text" && adjacent.kind !== "cdata") break;
            await this.set(tail, fragmentField, next);
            tail = next;
            next = await this.field(next, nextField);
            for (let fragment = await this.field(tail, fragmentField); fragment; fragment = await this.field(tail, fragmentField)) tail = fragment;
          }
          await this.set(current, nextField, next);
          if (!next) await this.set(event.reference, lastField, current);
          child = { kind: "text", text: child.text };
        }
        let skip = false;
        if (child.kind === "text") {
          if (options.noblanks && !preserve && !mixed && (previous !== 0 || next !== 0)) {
            skip = true;
            for await (const part of this.text(current)) for (const character of part) {
              const checkpoint = this.budget.tick(); if (checkpoint) await checkpoint;
              if (!" \t\r\n".includes(character)) skip = false;
            }
          }
          if (!skip) mixed = true;
        } else if (child.kind === "cdata") mixed = true;
        if (skip) {
          if (previous) await this.set(previous, nextField, next);
          else await this.set(event.reference, firstField, next);
          if (!next) await this.set(event.reference, lastField, previous);
        } else previous = current;
        current = next;
      }
    }
  }

  async *attributeReferences(reference: number, reverse = false): AsyncGenerator<number> {
    let attribute = await this.field(reference, reverse ? lastAttributeField : firstAttributeField);
    while (attribute) {
      const checkpoint = this.budget.tick(); if (checkpoint) await checkpoint;
      yield attribute;
      attribute = await this.field(attribute, reverse ? lastField : nextField);
    }
  }

  async *attributes(reference: number): AsyncGenerator<StoredAttribute> {
    for await (const attribute of this.attributeReferences(reference)) {
      const value = await this.metadata(attribute);
      if (value.kind !== "attribute") throw new TypeError("Expected XML attribute");
      yield { ...value.value, valueReference: attribute };
    }
  }

  async *attributeText(attribute: StoredAttribute): AsyncGenerator<string> {
    if (attribute.namespaceValueReference !== undefined) yield* new StoredNamespaces(this.storage, this.budget).valueParts(attribute.namespaceValueReference);
    else if (attribute.valueReference === undefined) yield attribute.value;
    else yield* this.text(attribute.valueReference);
  }

  async attributeEquals(attribute: StoredAttribute, expected: string): Promise<boolean> {
    let offset = 0;
    for await (const part of this.attributeText(attribute)) {
      if (part.length > expected.length - offset || expected.slice(offset, offset + part.length) !== part) return false;
      offset += part.length;
    }
    return offset === expected.length;
  }

  async *children(reference: number, attributes = false): AsyncGenerator<number> {
    let child = await this.field(reference, attributes ? firstAttributeField : firstField);
    while (child) {
      const checkpoint = this.budget.tick(); if (checkpoint) await checkpoint;
      const value = attributes ? await this.metadata(child) : undefined;
      if (value?.kind !== "attribute" || value.value.namespace !== "http://www.w3.org/2000/xmlns/") yield child;
      child = await this.field(child, nextField);
    }
  }

  async parent(reference: number): Promise<number> {
    return this.field(reference, parentField);
  }

  /** Traverse only the requested subtree, following stored links rather than a
   * resident stack of siblings or ancestors. Attribute nodes are separate. */
  async *walk(reference: number): AsyncGenerator<{ reference: number; closing: boolean }> {
    let current = reference;
    while (current) {
      const checkpoint = this.budget.tick(); if (checkpoint) await checkpoint;
      yield { reference: current, closing: false };
      const first = await this.field(current, firstField);
      if (first) { current = first; continue; }
      yield { reference: current, closing: true };
      while (current !== reference) {
        const next = await this.field(current, nextField);
        if (next) { current = next; break; }
        current = await this.field(current, parentField);
        yield { reference: current, closing: true };
      }
      if (current === reference) break;
    }
  }

  close(): Promise<void> {
    this.rootReference = 0;
    this.documentReference = 0;
    return this.closing ??= this.storage.close();
  }
}

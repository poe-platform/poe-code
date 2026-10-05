import { parseStoredXml } from "./recovery.js";
import { parseXmlStream, type XmlAttribute, type XmlContent, type XmlElement } from "@poe-code/safe-fs/core";
import { PagedStorage, type PagedStorageContext } from "@poe-code/safe-fs/storage";
import { XmlBudget } from "./limits.js";

// Fixed-size links are separate from the variable-size node metadata. Pointers
// are safe integer byte offsets; zero is the absent-link sentinel.
const headerBytes = 72;
const parentField = 0, nextField = 8, firstField = 16, lastField = 24, sizeField = 32, firstAttributeField = 40, lastAttributeField = 48, flagsField = 56, fragmentField = 64;
const textFlag = 1, preserveSpaceFlag = 2;

export type StoredXmlAttribute = { kind: "attribute"; value: XmlAttribute };
type XmlStreamEvent = Parameters<NonNullable<NonNullable<Parameters<typeof parseXmlStream>[1]>["events"]>>[0];
type Metadata = StoredXmlAttribute | Exclude<XmlContent, XmlElement> | {
  kind: "element"; name: string; localName: string; namespace: string;
  attributes: XmlElement["attributes"]; namespaces: [string, string][]; declaration?: string;
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
      let parent = document.documentReference, fragmentTail = 0;
      const consume = async (event: XmlStreamEvent): Promise<void> => {
          if (event.type === "close") { parent = await document.field(parent, parentField); return; }
          let metadata: Metadata;
          if (event.type === "content") metadata = event.content;
          else {
            const element = event.element;
            metadata = { kind: "element", name: element.name, localName: element.localName, namespace: element.namespace,
              attributes: element.attributes, namespaces: [...element.namespaces],
              ...(element.declaration === undefined ? {} : { declaration: element.declaration }) };
          }
          const continuation = event.type === "content" && event.continuation === true;
          const reference = await document.append(parent, metadata, continuation);
          if (continuation) await document.set(fragmentTail, fragmentField, reference);
          fragmentTail = reference;
          if (event.type === "open") {
            for (const attribute of event.element.attributes) {
              if (attribute.namespace !== "http://www.w3.org/2000/xmlns/")
                await document.append(reference, { kind: "attribute", value: attribute });
            }
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
    if (last) await this.set(last, nextField, reference);
    else await this.set(parent, firstLink, reference);
    await this.set(parent, lastLink, reference);
    return reference;
  }

  async node(reference: number): Promise<XmlContent | StoredXmlAttribute> {
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
      ? { ...metadata, namespaces: new Map(metadata.namespaces), children: [], content: [], text: "" }
      : metadata;
  }

  /** Logical text may span many original parser tokens after CDATA conversion.
   * Replay their bodies without making a concatenated node value. */
  async *text(reference: number): AsyncGenerator<string> {
    let fragment = reference;
    while (fragment) {
      const node = await this.node(fragment);
      if (node.kind !== "text" && node.kind !== "cdata") throw new TypeError("Expected XML text node");
      yield node.text;
      fragment = await this.field(fragment, fragmentField);
    }
  }

  /** Apply tree transformations by changing stored links. Whitespace inheritance
   * lives on each parent record; merged text remains a chain of token bodies. */
  async transform(options: { noblanks?: boolean; nocdata?: boolean }): Promise<void> {
    if (!options.noblanks && !options.nocdata) return;
    for await (const event of this.walk(this.root)) {
      if (event.closing) continue;
      const element = await this.node(event.reference);
      if (element.kind !== "element") continue;
      let preserve = (await this.field(await this.parent(event.reference), flagsField) & preserveSpaceFlag) !== 0;
      for (const attribute of element.attributes) {
        if (attribute.namespace === "http://www.w3.org/XML/1998/namespace" && attribute.localName === "space")
          preserve = attribute.value === "preserve";
      }
      await this.set(event.reference, flagsField, preserve ? preserveSpaceFlag : 0);
      let current = await this.field(event.reference, firstField), previous = 0, mixed = false;
      while (current) {
        let child = await this.node(current);
        let next = await this.field(current, nextField);
        if (options.nocdata && (child.kind === "text" || child.kind === "cdata")) {
          await this.set(current, flagsField, textFlag);
          let tail = current;
          for (let fragment = await this.field(tail, fragmentField); fragment; fragment = await this.field(tail, fragmentField)) tail = fragment;
          while (next) {
            const adjacent = await this.node(next);
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

  async *children(reference: number, attributes = false): AsyncGenerator<number> {
    let child = await this.field(reference, attributes ? firstAttributeField : firstField);
    while (child) {
      const checkpoint = this.budget.tick(); if (checkpoint) await checkpoint;
      yield child;
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

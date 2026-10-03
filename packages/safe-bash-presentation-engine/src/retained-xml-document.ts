import { PagedStorage } from "@poe-code/safe-fs/storage";
import { ZipDirectoryIndex } from "@poe-code/office-package/zip";
import { literal, equal, digest, characters as streamCharacters } from "./retained-values.js";
import type { ByteSource } from "./contracts.js";
import { OfficeError } from "./errors.js";
import { openRetainedXml, type XmlRange } from "./retained-xml.js";
import type { RetainedPackageContext } from "./retained-package.js";
import { resourceContext } from "./resource-limits.js";

export interface RetainedXmlNode {
  readonly kind: "element" | "text" | "cdata" | "comment" | "instruction" | "attribute";
  readonly name: XmlRange;
  readonly localName: XmlRange;
}
export interface RetainedXmlDocument {
  readonly root: RetainedXmlNode;
  readonly nodeCount: number;
  /** Stable references are scoped to this document. Foreign handles are rejected. */
  reference(node: RetainedXmlNode): number;
  node(id: number): Promise<RetainedXmlNode>;
  /** The factory must replay the same immutable prefix bytes. */
  resolveNamespace(node: RetainedXmlNode, prefix: () => ByteSource): Promise<ByteSource | undefined>;
  children(node: RetainedXmlNode): AsyncGenerator<RetainedXmlNode>;
  attributes(node: RetainedXmlNode): AsyncGenerator<RetainedXmlNode>;
  namespace(node: RetainedXmlNode): ByteSource;
  text(node: RetainedXmlNode): ByteSource;
  raw(range: XmlRange): ByteSource;
  close(): Promise<void>;
}

const xmlNamespace = "http://www.w3.org/XML/1998/namespace";
const xmlnsNamespace = "http://www.w3.org/2000/xmlns/";
const whitespace = (value: string) => value === " " || value === "\t" || value === "\r" || value === "\n";
function invalid(): never { throw new OfficeError("invalid-xml", "Invalid retained XML document.", "parse"); }
function nameStart(point: number): boolean {
  return point === 95 || point >= 65 && point <= 90 || point >= 97 && point <= 122
    || point >= 0xc0 && point <= 0xd6 || point >= 0xd8 && point <= 0xf6 || point >= 0xf8 && point <= 0x2ff
    || point >= 0x370 && point <= 0x37d || point >= 0x37f && point <= 0x1fff || point >= 0x200c && point <= 0x200d
    || point >= 0x2070 && point <= 0x218f || point >= 0x2c00 && point <= 0x2fef || point >= 0x3001 && point <= 0xd7ff
    || point >= 0xf900 && point <= 0xfdcf || point >= 0xfdf0 && point <= 0xfffd || point >= 0x10000 && point <= 0xeffff;
}
function namePart(point: number): boolean {
  return nameStart(point) || point === 45 || point === 46 || point === 0xb7 || point >= 48 && point <= 57
    || point >= 0x300 && point <= 0x36f || point >= 0x203f && point <= 0x2040;
}
export async function validateRetainedLocalName(source: ByteSource): Promise<void> {
  let first = true;
  for await (const character of streamCharacters(source)) {
    if (!(first ? nameStart(character.codePointAt(0)!) : namePart(character.codePointAt(0)!))) invalid();
    first = false;
  }
  if (first) invalid();
}

// Fixed-size rows keep tree links, namespace scope and collision chains outside
// the JS heap. Namespace/hash indexes share the same bounded backing cache.
enum F { Kind, Parent, First, Last, Next, Attrs, LastAttr, PrevAttr, Name, NameLength, Local, LocalLength, Prefix, PrefixLength, Value, ValueLength, Namespace, HashNext, PreviousBinding, Count }
const kinds = ["document", "element", "text", "cdata", "comment", "instruction", "attribute"] as const;

export async function openRetainedXmlDocument(source: ByteSource, settings: RetainedPackageContext): Promise<RetainedXmlDocument> {
  const context = resourceContext(settings), working = { ...settings.workingStorage };
  const xml = await openRetainedXml(source, { ...context, workingStorage: working });
  const signal = context.signal ?? new AbortController().signal;
  const pages = new PagedStorage({ fs: working.fs, cwd: working.directory, env: {}, signal },
    (working.cacheBytes ?? 1024 * 1024) / 16384);
  const index = new ZipDirectoryIndex(pages, { signal });
  const handles = new WeakMap<RetainedXmlNode, number>();
  let closed = false, closing: Promise<void> | undefined, count = 0;
  const check = () => {
    if (closed) throw new OfficeError("invalid-handle", "XML document is closed.", "parse");
    if (signal.aborted) throw new OfficeError("cancelled", "Operation cancelled.", "parse");
  };
  const close = () => {
    closed = true;
    return closing ??= (async () => {
      const outcomes = await Promise.allSettled([pages.close(), xml.close()]);
      const failure = outcomes.find(outcome => outcome.status === "rejected");
      if (failure?.status === "rejected") throw failure.reason;
    })();
  };
  const range = (row: number[], field: F): XmlRange => Object.freeze({ start: row[field]!, length: row[field + 1]! });
  async function row(pointer: number): Promise<number[]> {
    check(); const bytes = await pages.read(pointer, F.Count * 8), view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    return Array.from({ length: F.Count }, (_, field) => view.getFloat64(field * 8, true));
  }
  async function save(pointer: number, values: number[]) {
    check(); const bytes = new Uint8Array(F.Count * 8), view = new DataView(bytes.buffer);
    for (let field = 0; field < F.Count; field++) view.setFloat64(field * 8, values[field]!, true);
    await pages.write(pointer, bytes);
  }
  async function create(kind: number, parent: number, name?: XmlRange, value?: XmlRange): Promise<number> {
    if (kind !== 0 && kind !== 6 && ++count > context.xmlLimits.maxNodes) throw new OfficeError("resource-limit", "XML node limit exceeded.", "parse");
    const pointer = pages.allocate(F.Count * 8), values = new Array<number>(F.Count).fill(0);
    values[F.Kind] = kind; values[F.Parent] = parent;
    if (name) { values[F.Name] = name.start; values[F.NameLength] = name.length; }
    if (value) { values[F.Value] = value.start; values[F.ValueLength] = value.length; }
    if (parent) {
      const owner = await row(parent), first = kind === 6 ? F.Attrs : F.First, last = kind === 6 ? F.LastAttr : F.Last;
      const previous = owner[last]!;
      if (previous) { const sibling = await row(previous); sibling[F.Next] = pointer; await save(previous, sibling); }
      else owner[first] = pointer;
      if (kind === 6) values[F.PrevAttr] = previous;
      owner[last] = pointer; await save(parent, owner);
    }
    await save(pointer, values);
    if (kind !== 0) await index.set(`node:${pointer}`, pointer);
    return pointer;
  }
  async function* characters(value: XmlRange) {
    const decoder = new TextDecoder();
    for await (const bytes of xml.read(value)) for (const character of decoder.decode(bytes, { stream: true })) yield character;
    for (const character of decoder.decode()) yield character;
  }
  async function qualified(value: XmlRange, plain = false): Promise<{ prefix: XmlRange; local: XmlRange }> {
    let position = value.start, local = value.start, first = true, colon = false;
    for await (const character of characters(value)) {
      const point = character.codePointAt(0)!;
      if (point === 58 && !plain) {
        if (first || colon) invalid(); colon = true; local = position + 1; first = true;
      } else {
        if (!(plain && point === 58 || (first ? nameStart(point) : namePart(point)))) invalid();
        first = false;
      }
      position += point < 128 ? 1 : point < 2048 ? 2 : point < 65536 ? 3 : 4;
    }
    if (first) invalid();
    return { prefix: { start: value.start, length: colon ? local - value.start - 1 : 0 }, local: { start: local, length: value.start + value.length - local } };
  }
  async function setName(pointer: number) {
    const values = await row(pointer), parsed = await qualified(range(values, F.Name));
    values[F.Local] = parsed.local.start; values[F.LocalLength] = parsed.local.length;
    values[F.Prefix] = parsed.prefix.start; values[F.PrefixLength] = parsed.prefix.length;
    await save(pointer, values);
  }
  const matches = (value: XmlRange, expected: string) => equal(xml.read(value), literal(expected));
  async function* namespaceValue(binding: number): ByteSource {
    if (binding === -1) yield* literal(xmlNamespace);
    else if (binding === -2) yield* literal(xmlnsNamespace);
    else if (binding) yield* xml.value(range(await row(binding), F.Value), true);
  }
  const declaredPrefix = (values: number[]): XmlRange => values[F.PrefixLength] ? range(values, F.Local) : { start: 0, length: 0 };
  async function binding(prefix: XmlRange, attribute: boolean): Promise<number> {
    if (!prefix.length && attribute) return 0;
    if (await matches(prefix, "xml")) return -1;
    if (await matches(prefix, "xmlns")) invalid();
    let pointer = await index.get(`n:${await digest(xml.read(prefix))}`) ?? 0;
    while (pointer) {
      const values = await row(pointer);
      if (await equal(xml.read(prefix), xml.read(declaredPrefix(values)))) return pointer;
      pointer = values[F.PreviousBinding]!;
    }
    if (prefix.length) invalid();
    return 0;
  }
  async function uniqueAttribute(pointer: number, values: number[]) {
    const key = `a:${values[F.Parent]}:${await digest(namespaceValue(values[F.Namespace]!), literal("\0"), xml.read(range(values, F.Local)))}`;
    const head = await index.get(key) ?? 0;
    for (let previous = head; previous;) {
      const other = await row(previous);
      if (await equal(xml.read(range(other, F.Local)), xml.read(range(values, F.Local)))
        && await equal(namespaceValue(other[F.Namespace]!), namespaceValue(values[F.Namespace]!))) invalid();
      previous = other[F.HashNext]!;
    }
    values[F.HashNext] = head; await save(pointer, values); await index.set(key, pointer);
  }
  async function openElement(pointer: number) {
    const element = await row(pointer);
    for (let attribute = element[F.Attrs]!; attribute;) {
      const values = await row(attribute);
      const declaration = await matches(range(values, F.Prefix), "xmlns") || !values[F.PrefixLength] && await matches(range(values, F.Local), "xmlns");
      if (declaration) {
        values[F.Namespace] = -2;
        const prefix = declaredPrefix(values), value = range(values, F.Value);
        const isXml = await matches(prefix, "xml");
        if (await matches(prefix, "xmlns") || await equal(xml.value(value, true), literal(xmlnsNamespace))
          || isXml !== await equal(xml.value(value, true), literal(xmlNamespace))
          || prefix.length > 0 && await equal(xml.value(value, true), literal(""))) invalid();
        await uniqueAttribute(attribute, values);
        const key = `n:${await digest(xml.read(prefix))}`;
        values[F.PreviousBinding] = await index.get(key) ?? 0;
        await save(attribute, values); await index.set(key, attribute);
      }
      attribute = values[F.Next]!;
    }
    element[F.Namespace] = await binding(range(element, F.Prefix), false); await save(pointer, element);
    for (let attribute = element[F.Attrs]!; attribute;) {
      const values = await row(attribute);
      if (values[F.Namespace] !== -2) {
        values[F.Namespace] = await binding(range(values, F.Prefix), true);
        await uniqueAttribute(attribute, values);
      }
      attribute = values[F.Next]!;
    }
  }
  async function closeElement(pointer: number): Promise<number> {
    const element = await row(pointer);
    for (let attribute = element[F.LastAttr]!; attribute;) {
      const values = await row(attribute);
      if (values[F.Namespace] === -2) await index.set(`n:${await digest(xml.read(declaredPrefix(values)))}`, values[F.PreviousBinding]!);
      attribute = values[F.PrevAttr]!;
    }
    return element[F.Parent]!;
  }
  async function declaration(value: XmlRange) {
    const iterator = characters(value)[Symbol.asyncIterator]();
    let next = await iterator.next(), order = -1;
    try {
      while (!next.done) {
        let spaced = false;
        while (!next.done && whitespace(next.value)) { spaced = true; next = await iterator.next(); }
        if (next.done) break;
        if (!spaced) invalid();
        let name = "";
        while (!next.done && !whitespace(next.value) && next.value !== "=") { name += next.value; if (name.length > 10) invalid(); next = await iterator.next(); }
        while (!next.done && whitespace(next.value)) next = await iterator.next();
        if (next.done || next.value !== "=") invalid(); next = await iterator.next();
        while (!next.done && whitespace(next.value)) next = await iterator.next();
        if (next.done || next.value !== '"' && next.value !== "'") invalid();
        const quote = next.value; next = await iterator.next(); let field = "";
        while (!next.done && next.value !== quote) { field += next.value; if (field.length > 8) invalid(); next = await iterator.next(); }
        if (next.done) invalid(); next = await iterator.next();
        if (name === "version" && order === -1 && field === "1.0") order = 0;
        else if (name === "encoding" && order === 0 && field.toLowerCase() === (xml.encoding === "utf-8" ? "utf-8" : "utf-16")) order = 1;
        else if (name === "standalone" && (order === 0 || order === 1) && (field === "yes" || field === "no")) order = 2;
        else invalid();
      }
      if (order < 0) invalid();
    } finally { await iterator.return?.(); }
  }
  async function instruction(value: XmlRange): Promise<boolean> {
    let bytes = 0;
    for await (const character of characters(value)) {
      if (whitespace(character)) break;
      const point = character.codePointAt(0)!; bytes += point < 128 ? 1 : point < 2048 ? 2 : point < 65536 ? 3 : 4;
    }
    const target = { start: value.start, length: bytes };
    await qualified(target, true);
    if (bytes === 3) {
      let name = ""; for await (const character of characters(target)) name += character;
      if (name.toLowerCase() === "xml") {
        if (name !== "xml" || value.start !== 2) invalid();
        await declaration({ start: value.start + bytes, length: value.length - bytes }); return true;
      }
    }
    return false;
  }
  const handle = async (pointer: number): Promise<RetainedXmlNode> => {
    const values = await row(pointer);
    const node = Object.freeze({ kind: kinds[values[F.Kind]!] as RetainedXmlNode["kind"], name: range(values, F.Name), localName: range(values, F.Local) });
    handles.set(node, pointer); return node;
  };
  const address = (node: RetainedXmlNode): number => {
    check(); const pointer = handles.get(node);
    if (!pointer) throw new OfficeError("invalid-handle", "Foreign XML node.", "parse");
    return pointer;
  };
  const failure = (error: unknown) => error instanceof OfficeError ? error
    : new OfficeError(signal.aborted ? "cancelled" : "io-failure", "XML index operation failed.", "parse");
  try {
    const document = await create(0, 0); let current = document, root = 0, depth = 0, attribute = 0;
    for await (const token of xml.tokens()) {
      check();
      if (token.kind === "start-name") {
        if (current === document && root) invalid();
        if (++depth > context.xmlLimits.maxDepth) throw new OfficeError("resource-limit", "XML depth limit exceeded.", "parse");
        current = await create(1, current, token.range); await setName(current);
        if (!root) root = current;
      } else if (token.kind === "attribute-name") {
        attribute = await create(6, current, token.range); await setName(attribute);
      } else if (token.kind === "attribute-value") {
        const values = await row(attribute); values[F.Value] = token.range.start; values[F.ValueLength] = token.range.length;
        await save(attribute, values);
        for await (const bytes of xml.value(token.range, true)) void bytes;
      } else if (token.kind === "start-end") {
        await openElement(current);
        if (token.empty) { current = await closeElement(current); depth--; }
      } else if (token.kind === "end-name") {
        if (current === document || !await equal(xml.read(token.range), xml.read(range(await row(current), F.Name)))) invalid();
        current = await closeElement(current); depth--;
      } else {
        if (token.kind === "text") {
          if (current === document) {
            for await (const character of characters(token.range)) if (!whitespace(character)) invalid();
            // Match the existing parser: initial whitespace precedes its first text event.
            if (token.range.start === 0) continue;
          }
          else for await (const bytes of xml.value(token.range)) void bytes;
        } else if (token.kind === "cdata" && current === document) invalid();
        else if (token.kind === "instruction" && await instruction(token.range)) continue;
        await create(kinds.indexOf(token.kind), current, undefined, token.range);
      }
    }
    if (!root || current !== document) invalid();
    const api: RetainedXmlDocument = {
      root: await handle(root), nodeCount: count, raw: xml.read, close, reference: address,
      async node(id) {
        try {
          check();
          if (!Number.isSafeInteger(id) || id < 1 || await index.get(`node:${id}`) !== id)
            throw new OfficeError("invalid-handle", "Unknown XML node identifier.", "parse");
          return await handle(id);
        } catch (error) { throw failure(error); }
      },
      async resolveNamespace(node, prefix) {
        try {
          let pointer = address(node);
          if (await equal(prefix(), literal("xml"))) return literal(xmlNamespace);
          while (pointer) {
            const owner = await row(pointer);
            for (let attribute = owner[F.Attrs]!; attribute;) {
              const values = await row(attribute);
              if (values[F.Namespace] === -2 && await equal(prefix(), xml.read(declaredPrefix(values))))
                return xml.value(range(values, F.Value), true);
              attribute = values[F.Next]!;
            }
            pointer = owner[F.Parent]!;
          }
          return undefined;
        } catch (error) { throw failure(error); }
      },
      async *children(node) {
        try { for (let pointer = (await row(address(node)))[F.First]!; pointer;) { yield await handle(pointer); pointer = (await row(pointer))[F.Next]!; } }
        catch (error) { throw failure(error); }
      },
      async *attributes(node) {
        try { for (let pointer = (await row(address(node)))[F.Attrs]!; pointer;) { const values = await row(pointer); if (values[F.Namespace] !== -2) yield await handle(pointer); pointer = values[F.Next]!; } }
        catch (error) { throw failure(error); }
      },
      async *namespace(node) { try { yield* namespaceValue((await row(address(node)))[F.Namespace]!); } catch (error) { throw failure(error); } },
      async *text(node) {
        try {
          const base = address(node), original = await row(base);
          if (original[F.Kind] !== 1) { yield* xml.value(range(original, F.Value), original[F.Kind] === 6, original[F.Kind] !== 3 && original[F.Kind] !== 4 && original[F.Kind] !== 5); return; }
          let pointer = original[F.First]!;
          while (pointer) {
            let values = await row(pointer);
            if (values[F.Kind] === 2 || values[F.Kind] === 3) yield* xml.value(range(values, F.Value), false, values[F.Kind] === 2);
            if (values[F.First]) { pointer = values[F.First]!; continue; }
            while (!values[F.Next] && values[F.Parent] !== base) { pointer = values[F.Parent]!; values = await row(pointer); }
            pointer = values[F.Next]!;
          }
        } catch (error) { throw failure(error); }
      }
    };
    return Object.freeze(api);
  } catch (error) { await close().catch(() => {}); throw failure(error); }
}

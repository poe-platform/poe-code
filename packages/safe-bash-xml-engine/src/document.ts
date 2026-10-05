import type { StoredAttribute as XmlAttribute } from "./stored-document.js";
import type { XmlContent, XmlElement } from "@poe-code/safe-fs/core";
import { escape } from "./evaluate.js";
import { StoredStringMap as StoredNamespaces } from "./stored-map.js";
import { StoredAttributes } from "./stored-attributes.js";
import { StoredXmlDocument } from "./stored-document.js";
import { XmlBudget, XmlQueryError } from "./limits.js";

export type DocumentMode = "format" | "c14n" | "exc-c14n";
const xmlns = "http://www.w3.org/2000/xmlns/";
const xml = "http://www.w3.org/XML/1998/namespace";
type NamespaceScope = ReadonlyMap<string, string> | StoredNamespaces;

function compare(left: string, right: string): number {
  let a = 0,
    b = 0;
  while (a < left.length && b < right.length) {
    const x = left.codePointAt(a)!,
      y = right.codePointAt(b)!;
    if (x !== y) return x - y;
    a += x > 0xffff ? 2 : 1;
    b += y > 0xffff ? 2 : 1;
  }
  return left.length - right.length;
}

function declaration(source: string | undefined): string {
  let result = "<?xml";
  for (const name of ["version", "encoding", "standalone"]) {
    const start = source?.indexOf(name) ?? -1;
    if (start < 0) {
      if (name === "version") result += ' version="1.0"';
      continue;
    }
    let offset = source!.indexOf("=", start) + 1;
    while (" \t\n\r".includes(source![offset]!)) offset++;
    const quote = source![offset++]!;
    result += ` ${name}="${source!.slice(offset, source!.indexOf(quote, offset))}"`;
  }
  return result + "?>\n";
}

async function attributes(
  element: XmlElement,
  source: () => AsyncIterable<XmlAttribute>,
  namespaces: NamespaceScope,
  inherited: NamespaceScope,
  budget: XmlBudget,
  exclusive: boolean,
  stored?: StoredXmlDocument
): Promise<Iterable<XmlAttribute> | AsyncIterable<XmlAttribute>> {
  const selected = stored ? new StoredAttributes(stored.storage, budget) : [] as XmlAttribute[];
  for await (const attribute of source()) {
    { const _p = budget.tick(); if (_p) await _p; }
    if (attribute.namespace !== xmlns) {
      if (Array.isArray(selected)) selected.push(attribute); else await selected.append(attribute);
    }
  }
  for await (const [prefix, uri] of namespaces instanceof StoredNamespaces ? namespaces.references() : namespaces) {
    { const _p = budget.tick((typeof uri === "string" ? uri.length : 1) + prefix.length + 1); if (_p) await _p; }
    if (prefix === "xml") continue;
    if (exclusive) {
      const colon = element.name.indexOf(":");
      let used = prefix === (colon < 0 ? "" : element.name.slice(0, colon));
      for await (const attribute of source()) {
        const p = budget.tick(attribute.name.length + 1); if (p) await p;
        if (attribute.namespace === xmlns) continue;
        const at = attribute.name.indexOf(":");
        if (at > 0 && attribute.name.slice(0, at) === prefix) used = true;
      }
      if (!used) continue;
    }
    if (typeof uri === "number" && namespaces instanceof StoredNamespaces) {
      const previous = inherited instanceof StoredNamespaces ? await inherited.lookup(prefix) : await inherited.get(prefix);
      if (await namespaces.equals(uri, previous ?? "")) continue;
    } else if (uri === ((await inherited.get(prefix)) ?? "")) continue;
    const attribute = {
      name: prefix ? `xmlns:${prefix}` : "xmlns",
      namespace: xmlns,
      localName: prefix,
      value: typeof uri === "string" ? uri : "",
      ...(typeof uri === "number" ? { namespaceValueReference: uri } : {})
    };
    if (Array.isArray(selected)) selected.push(attribute); else await selected.append(attribute);
  }
  const ordering = (left: XmlAttribute, right: XmlAttribute): number => {
    if (left.namespace === xmlns || right.namespace === xmlns) {
      if (left.namespace !== right.namespace) return left.namespace === xmlns ? -1 : 1;
      return compare(left.localName, right.localName);
    }
    return compare(left.namespace, right.namespace) || compare(left.localName, right.localName);
  };
  if (Array.isArray(selected)) {
    const comparisons = Math.ceil(Math.log2(selected.length + 1));
    for (const attribute of selected)
      await budget.tick((attribute.namespace.length + attribute.localName.length + 1) * comparisons);
    selected.sort(ordering);
  } else await selected.sort(async (left, right) => {
    if (left.namespace === xmlns || right.namespace === xmlns) return ordering(left, right);
    const tokens = new StoredNamespaces(stored!.storage, budget);
    const leftReference = left.namespaceReference, rightReference = right.namespaceReference;
    const order = rightReference !== undefined ? await tokens.compare(leftReference ?? left.namespace, rightReference)
      : leftReference !== undefined ? -await tokens.compare(right.namespace, leftReference) : compare(left.namespace, right.namespace);
    return order || compare(left.localName, right.localName);
  });
  return selected;
}

type Reference = XmlContent | number;
interface Frame {
  content: Reference | string;
  depth: number;
  namespaces: NamespaceScope;
  preserveSpace: boolean;
  preserveBlanks: boolean;
  inline: boolean;
}

/** Pending traversal state belongs to the same caller-backed cache as nodes.
 * Reverse links in place to schedule siblings in order without retaining them. */
class StoredFrames {
  private head = 0;
  constructor(private readonly document: StoredXmlDocument) {}

  private async store(value: unknown): Promise<number> {
    const bytes = new TextEncoder().encode(JSON.stringify(value));
    const header = new Uint8Array(8);
    new DataView(header.buffer).setFloat64(0, bytes.length, true);
    const reference = await this.document.storage.append(header);
    await this.document.storage.append(bytes);
    return reference;
  }

  private async load(reference: number): Promise<unknown> {
    const size = await this.document.storage.read(reference, 8);
    const length = new DataView(size.buffer, size.byteOffset, 8).getFloat64(0, true);
    return JSON.parse(new TextDecoder().decode(await this.document.storage.read(reference + 8, length)));
  }

  async push(source: AsyncIterable<Frame>): Promise<void> {
    let reversed = 0;
    for await (const frame of source) {
      const checkpoint = this.document.budget.tick(); if (checkpoint) await checkpoint;
      if (!(frame.namespaces instanceof StoredNamespaces)) throw new TypeError("Stored frames require backed namespace scopes");
      const namespaces = frame.namespaces.reference;
      const value = await this.store({ ...frame, namespaces });
      const link = new Uint8Array(16), view = new DataView(link.buffer);
      view.setFloat64(0, reversed, true); view.setFloat64(8, value, true);
      reversed = await this.document.storage.append(link);
    }
    while (reversed) {
      const checkpoint = this.document.budget.tick(); if (checkpoint) await checkpoint;
      const link = await this.document.storage.read(reversed, 8);
      const view = new DataView(link.buffer, link.byteOffset, 8), previous = view.getFloat64(0, true);
      view.setFloat64(0, this.head, true);
      await this.document.storage.write(reversed, link);
      this.head = reversed; reversed = previous;
    }
  }

  async pop(): Promise<Frame | undefined> {
    if (!this.head) return undefined;
    const link = await this.document.storage.read(this.head, 16);
    const view = new DataView(link.buffer, link.byteOffset, 16);
    this.head = view.getFloat64(0, true);
    const frame = await this.load(view.getFloat64(8, true)) as Omit<Frame, "namespaces"> & { namespaces: number };
    const namespaces = new StoredNamespaces(this.document.storage, this.document.budget, frame.namespaces);
    return { ...frame, namespaces };
  }
}

function* indentation(depth: number): Generator<string> {
  yield "\n";
  for (let left = depth; left > 0; left -= 2048) yield "  ".repeat(Math.min(left, 2048));
}

export async function* serializeDocument(
  source: XmlElement | StoredXmlDocument,
  mode: DocumentMode,
  budget: XmlBudget,
  format = mode === "format",
  options: { noblanks?: boolean; declaration?: string | undefined } = {}
): AsyncGenerator<string> {
  const stored = source instanceof StoredXmlDocument ? source : undefined;
  const rootReference: Reference = stored ? stored.root : source as XmlElement;
  const load = async (reference: Reference): Promise<XmlContent> => {
    const node = typeof reference === "number" ? await stored!.metadata(reference) : reference;
    if (node.kind === "attribute") throw new TypeError("Attribute used as XML content");
    return node;
  };
  async function* children(reference: Reference): AsyncGenerator<Reference> {
    if (typeof reference === "number") yield* stored!.children(reference);
    else if (reference.kind === "element") yield* reference.content;
  }
  async function* elementAttributes(reference: Reference): AsyncGenerator<XmlAttribute> {
    if (typeof reference === "number") yield* stored!.attributes(reference);
    else if (reference.kind === "element") yield* reference.attributes;
  }
  async function namespaceScope(reference: Reference, element: XmlElement): Promise<NamespaceScope> {
    return typeof reference === "number" ? stored!.namespaceScope(reference) : element.namespaces;
  }
  const root = await load(rootReference) as XmlElement;
  const canonical = mode !== "format";
  const documentDeclaration = options.declaration ?? root.declaration;
  const escaping = { canonical, ascii: !canonical && !documentDeclaration?.includes("encoding") };
  if (canonical) {
    // Iterators retain only the active ancestry, never an array of all siblings.
    async function* descendants(): AsyncGenerator<Reference> {
      if (stored) {
        for await (const entry of stored.walk(stored.root)) if (!entry.closing) yield entry.reference;
      } else {
        const pending: AsyncIterator<Reference>[] = [(async function* () { yield rootReference; })()];
        while (pending.length) {
          const next = await pending.at(-1)!.next();
          if (next.done) { pending.pop(); continue; }
          yield next.value;
          pending.push(children(next.value));
        }
      }
    }
    for await (const reference of descendants()) {
      const element = await load(reference);
      if (element.kind !== "element") continue;
      { const p = budget.tick(); if (p) await p; }
      const scope = await namespaceScope(reference, element);
      for await (const [prefix, uri] of scope instanceof StoredNamespaces ? scope.references() : scope) {
        { const p = budget.tick(prefix.length + 1); if (p) await p; }
        const parts = typeof uri === "number" && scope instanceof StoredNamespaces ? scope.valueParts(uri) : [uri as string];
        let length = 0, absolute = false;
        scan: for await (const part of parts) {
          { const p = budget.tick(part.length); if (p) await p; }
          for (const character of part) {
            if (character === ":") { absolute = length > 0; if (!absolute) length++; break scan; }
            const allowed = length === 0 ? "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ" : "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789+.-";
            if (!allowed.includes(character)) throw new XmlQueryError("Failed to canonicalize: relative namespace URI", 6);
            length++;
          }
        }
        if (length && !absolute) throw new XmlQueryError("Failed to canonicalize: relative namespace URI", 6);
      }
    }
  } else yield declaration(documentDeclaration);
  const namespaces: NamespaceScope = stored ? await new StoredNamespaces(stored.storage, budget).set("xml", xml) : new Map([["xml", xml]]);
  async function* siblings(): AsyncGenerator<Reference> {
    if (stored) yield* stored.children(stored.document);
    else {
      yield* root.prolog ?? [];
      yield rootReference;
      yield* root.epilog ?? [];
    }
  }
  async function* documentFrames(): AsyncGenerator<Frame> {
    const frame = { depth: 0, namespaces, preserveSpace: false, preserveBlanks: false, inline: false };
    let after = false;
    for await (const reference of siblings()) {
      { const p = budget.tick(); if (p) await p; }
      if (reference === rootReference) {
        yield { ...frame, content: reference };
        after = true;
        if (!canonical) yield { ...frame, content: "\n" };
      } else {
        const content = await load(reference);
        if (content.kind === "text") continue;
        if (after && canonical) yield { ...frame, content: "\n" };
        yield { ...frame, content: reference };
        if (!after || !canonical) yield { ...frame, content: "\n" };
      }
    }
  }
  async function* selectedChildren(reference: Reference, preserveSpace: boolean, preserveBlanks: boolean): AsyncGenerator<{ reference: Reference; mixed: boolean }> {
    let mixed = false, count = 0;
    const iterator = children(reference);
    let current = await iterator.next();
    try {
      while (!current.done) {
        const next = await iterator.next();
        const child = await load(current.value);
        { const p = budget.tick(); if (p) await p; }
        let skip = false;
        if (child.kind === "text") {
          let blank = true;
          for await (const part of typeof current.value === "number" ? stored!.text(current.value) : [child.text]) for (const character of part) {
            { const p = budget.tick(); if (p) await p; }
            if (!" \t\n\r".includes(character)) blank = false;
          }
          skip = (format && !preserveSpace || options.noblanks === true && !preserveBlanks) && !mixed && blank && (count > 0 || !next.done);
          if (!skip) mixed = true;
        } else if (child.kind === "cdata") mixed = true;
        if (!skip) { count++; yield { reference: current.value, mixed }; }
        current = next;
      }
    } finally { await iterator.return(undefined); }
  }
  const pending: AsyncIterator<Frame>[] = [];
  const frames = stored ? new StoredFrames(stored) : undefined;
  async function push(source: AsyncIterable<Frame>): Promise<void> {
    if (frames) await frames.push(source);
    else pending.push(source[Symbol.asyncIterator]());
  }
  await push(documentFrames());
  while (true) {
    { const p = budget.tick(); if (p) await p; }
    let frame: Frame | undefined;
    if (frames) frame = await frames.pop();
    else while (pending.length) {
      const next = await pending.at(-1)!.next();
      if (next.done) pending.pop();
      else { frame = next.value; break; }
    }
    if (!frame) break;
    if (typeof frame.content === "string") { yield frame.content; continue; }
    const reference = frame.content;
    const current = await load(reference);
    if (current.kind === "element") {
      let preserveSpace = frame.preserveSpace;
      let preserveBlanks = frame.preserveBlanks;
      for await (const attribute of elementAttributes(reference)) {
        { const p = budget.tick(); if (p) await p; }
        if (attribute.namespace === xml && attribute.localName === "space") {
          const preserve = stored ? await stored.attributeEquals(attribute, "preserve") : attribute.value === "preserve";
          const normal = stored ? await stored.attributeEquals(attribute, "default") : attribute.value === "default";
          preserveBlanks = preserve;
          if (preserve) preserveSpace = true;
          else if (normal) preserveSpace = false;
        }
      }
      let count = 0, mixed = false;
      for await (const child of selectedChildren(reference, preserveSpace, preserveBlanks)) { count++; mixed = child.mixed; }
      const ordered = canonical ? await attributes(current, () => elementAttributes(reference), await namespaceScope(reference, current), frame.namespaces, budget, mode === "exc-c14n", stored) : [];
      async function* outputAttributes(): AsyncGenerator<XmlAttribute> {
        if (canonical) yield* ordered;
        else for (const namespace of [true, false]) for await (const attribute of elementAttributes(reference)) {
          const p = budget.tick(); if (p) await p;
          if ((attribute.namespace === xmlns) === namespace) yield attribute;
        }
      }
      let childNamespaces = frame.namespaces;
      let changed: Map<string, string> | undefined;
      yield `<${current.name}`;
      for await (const attribute of outputAttributes()) {
        if (canonical && attribute.namespace === xmlns) {
          if (childNamespaces instanceof StoredNamespaces) childNamespaces = await childNamespaces.set(attribute.localName,
            attribute.namespaceValueReference === undefined ? attribute.value : { reference: attribute.namespaceValueReference });
          else {
            changed ??= new Map(childNamespaces);
            changed.set(attribute.localName, attribute.value);
            childNamespaces = changed;
          }
        }
        { const p = budget.tick(); if (p) await p; }
        yield ` ${attribute.name}="`;
        if (stored) for await (const part of stored.attributeText(attribute)) yield* escape(part, true, budget, escaping);
        else yield* escape(attribute.value, true, budget, escaping);
        yield '"';
      }
      if (!count && !canonical) { yield "/>"; continue; }
      yield ">";
      const indent = !canonical && format && !frame.inline && !mixed && count > 0;
      const childFrame = { depth: frame.depth + 1, namespaces: childNamespaces, preserveSpace, preserveBlanks, inline: frame.inline || mixed };
      const parentFrame = frame;
      await push((async function* (): AsyncGenerator<Frame> {
        for await (const child of selectedChildren(reference, preserveSpace, preserveBlanks)) {
          if (indent) for (const part of indentation(childFrame.depth)) yield { ...childFrame, content: part };
          yield { ...childFrame, content: child.reference };
        }
        if (indent) for (const part of indentation(parentFrame.depth)) yield { ...parentFrame, content: part };
        yield { ...parentFrame, content: `</${current.name}>` };
      })());
    } else if (current.kind === "text" || (current.kind === "cdata" && canonical)) {
      for await (const part of typeof reference === "number" ? stored!.text(reference) : [current.text])
        yield* escape(part, false, budget, escaping);
    } else if (current.kind === "cdata") {
      yield "<![CDATA[";
      yield* typeof reference === "number" ? stored!.text(reference) : [current.text];
      yield "]]>";
    }
    else if (current.kind === "comment") {
      yield "<!--";
      yield* typeof reference === "number" ? stored!.text(reference) : [current.text];
      yield "-->";
    }
    else if (current.kind === "processing-instruction") {
      yield `<?${current.target}`;
      if (current.text) {
        yield " ";
        yield* typeof reference === "number" ? stored!.text(reference) : [current.text];
      }
      yield "?>";
    }
  }
}

import type { XmlAttribute, XmlContent, XmlElement } from "@poe-code/safe-fs/core";
import { escape } from "./evaluate.js";
import { StoredXmlDocument } from "./stored-document.js";
import { XmlBudget, XmlQueryError } from "./limits.js";

export type DocumentMode = "format" | "c14n" | "exc-c14n";
const xmlns = "http://www.w3.org/2000/xmlns/";
const xml = "http://www.w3.org/XML/1998/namespace";

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
  inherited: ReadonlyMap<string, string>,
  budget: XmlBudget,
  exclusive: boolean
): Promise<XmlAttribute[]> {
  const selected: XmlAttribute[] = [];
  for (const attribute of element.attributes) {
    { const _p = budget.tick(); if (_p) await _p; }
    if (attribute.namespace !== xmlns) selected.push(attribute);
  }
  for (const [prefix, uri] of element.namespaces) {
    { const _p = budget.tick(uri.length + prefix.length + 1); if (_p) await _p; }
    if (prefix === "xml") continue;
    if (exclusive) {
      const colon = element.name.indexOf(":");
      let used = prefix === (colon < 0 ? "" : element.name.slice(0, colon));
      for (const attribute of element.attributes) {
        const p = budget.tick(attribute.name.length + 1); if (p) await p;
        if (attribute.namespace === xmlns) continue;
        const at = attribute.name.indexOf(":");
        if (at > 0 && attribute.name.slice(0, at) === prefix) used = true;
      }
      if (!used) continue;
    }
    if (uri === (inherited.get(prefix) ?? "")) continue;
    selected.push({
      name: prefix ? `xmlns:${prefix}` : "xmlns",
      namespace: xmlns,
      localName: prefix,
      value: uri
    });
  }
  // Admit comparison work before sorting; names are bounded by the XML input cap.
  const comparisons = Math.ceil(Math.log2(selected.length + 1));
  for (const attribute of selected)
    await budget.tick((attribute.namespace.length + attribute.localName.length + 1) * comparisons);
  selected.sort((left, right) => {
    if (left.namespace === xmlns || right.namespace === xmlns) {
      if (left.namespace !== right.namespace) return left.namespace === xmlns ? -1 : 1;
      return compare(left.localName, right.localName);
    }
    return compare(left.namespace, right.namespace) || compare(left.localName, right.localName);
  });
  return selected;
}

type Reference = XmlContent | number;
interface Frame {
  content: Reference | string;
  depth: number;
  namespaces: ReadonlyMap<string, string>;
  preserveSpace: boolean;
  preserveBlanks: boolean;
  inline: boolean;
}

/** Pending traversal state belongs to the same caller-backed cache as nodes.
 * Reverse links in place to schedule siblings in order without retaining them. */
class StoredFrames {
  private head = 0;
  private readonly namespaces = new WeakMap<ReadonlyMap<string, string>, number>();
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
      let namespaces = this.namespaces.get(frame.namespaces);
      if (namespaces === undefined) {
        namespaces = await this.store([...frame.namespaces]);
        this.namespaces.set(frame.namespaces, namespaces);
      }
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
    const namespaces = new Map(await this.load(frame.namespaces) as [string, string][]);
    this.namespaces.set(namespaces, frame.namespaces);
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
    const node = typeof reference === "number" ? await stored!.node(reference) : reference;
    if (node.kind === "attribute") throw new TypeError("Attribute used as XML content");
    return node;
  };
  async function* children(reference: Reference): AsyncGenerator<Reference> {
    if (typeof reference === "number") yield* stored!.children(reference);
    else if (reference.kind === "element") yield* reference.content;
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
      for (const [prefix, uri] of element.namespaces) {
        { const p = budget.tick(uri.length + prefix.length + 1); if (p) await p; }
        if (!uri) continue;
        const colon = uri.indexOf(":");
        let absolute = colon > 0 && "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ".includes(uri[0]!);
        for (let index = 1; index < colon; index++) {
          if (!"abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789+.-".includes(uri[index]!)) absolute = false;
        }
        if (!absolute) throw new XmlQueryError("Failed to canonicalize: relative namespace URI", 6);
      }
    }
  } else yield declaration(documentDeclaration);
  const namespaces = new Map<string, string>([["xml", xml]]);
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
      for (const attribute of current.attributes) {
        { const p = budget.tick(); if (p) await p; }
        if (attribute.namespace === xml && attribute.localName === "space") {
          preserveBlanks = attribute.value === "preserve";
          if (attribute.value === "preserve") preserveSpace = true;
          else if (attribute.value === "default") preserveSpace = false;
        }
      }
      let count = 0, mixed = false;
      for await (const child of selectedChildren(reference, preserveSpace, preserveBlanks)) { count++; mixed = child.mixed; }
      const ordered = canonical ? await attributes(current, frame.namespaces, budget, mode === "exc-c14n") : [];
      if (!canonical) {
        for (const namespace of [true, false]) for (const attribute of current.attributes) {
          { const p = budget.tick(); if (p) await p; }
          if ((attribute.namespace === xmlns) === namespace) ordered.push(attribute);
        }
      }
      yield `<${current.name}`;
      for (const attribute of ordered) {
        { const p = budget.tick(); if (p) await p; }
        yield ` ${attribute.name}="`;
        yield* escape(attribute.value, true, budget, escaping);
        yield '"';
      }
      if (!count && !canonical) { yield "/>"; continue; }
      yield ">";
      const indent = !canonical && format && !frame.inline && !mixed && count > 0;
      let childNamespaces = frame.namespaces;
      if (canonical && ordered.some(attribute => attribute.namespace === xmlns)) {
        const changed = new Map(frame.namespaces);
        for (const attribute of ordered) if (attribute.namespace === xmlns) changed.set(attribute.localName, attribute.value);
        childNamespaces = changed;
      }
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
    } else if (current.kind === "cdata") { yield "<![CDATA["; yield current.text; yield "]]>"; }
    else if (current.kind === "comment") { yield "<!--"; yield current.text; yield "-->"; }
    else if (current.kind === "processing-instruction") {
      yield `<?${current.target}`;
      if (current.text) { yield " "; yield current.text; }
      yield "?>";
    }
  }
}

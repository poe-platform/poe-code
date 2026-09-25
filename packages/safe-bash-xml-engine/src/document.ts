import type { XmlAttribute, XmlContent, XmlElement } from "@poe-code/safe-fs/core";
import { escape } from "./evaluate.js";
import { XmlBudget, XmlQueryError } from "./limits.js";

export type DocumentMode = "format" | "c14n";
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
  budget: XmlBudget
): Promise<XmlAttribute[]> {
  const selected: XmlAttribute[] = [];
  for (const attribute of element.attributes) {
    await budget.tick();
    if (attribute.namespace !== xmlns) selected.push(attribute);
  }
  for (const [prefix, uri] of element.namespaces) {
    await budget.tick(uri.length + prefix.length + 1);
    if (prefix === "xml") continue;
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

export async function* serializeDocument(
  root: XmlElement,
  mode: DocumentMode,
  budget: XmlBudget,
  format = mode === "format"
): AsyncGenerator<string> {
  const canonical = mode === "c14n";
  const escaping = { canonical, ascii: !canonical && !root.declaration?.includes("encoding") };
  if (canonical) {
    const elements = [root];
    while (elements.length) {
      const element = elements.pop()!;
      await budget.tick();
      for (const [prefix, uri] of element.namespaces) {
        await budget.tick(prefix.length + uri.length + 1);
        if (!uri) continue;
        const colon = uri.indexOf(":");
        let absolute =
          colon > 0 && "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ".includes(uri[0]!);
        for (let index = 1; index < colon; index++) {
          if (
            !"abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789+.-".includes(
              uri[index]!
            )
          )
            absolute = false;
        }
        if (!absolute) throw new XmlQueryError("Failed to canonicalize: relative namespace URI", 6);
      }
      for (const child of element.children) {
        await budget.tick();
        elements.push(child);
      }
    }
  } else yield declaration(root.declaration);
  interface Frame {
    content: XmlContent | string;
    depth: number;
    namespaces: ReadonlyMap<string, string>;
    preserveSpace: boolean;
  }
  const namespaces = new Map<string, string>([["xml", xml]]);
  const pending: Frame[] = [];
  for (let index = (root.epilog?.length ?? 0) - 1; index >= 0; index--) {
    const content = root.epilog![index]!;
    await budget.tick();
    if (content.kind === "text") continue;
    if (!canonical) pending.push({ content: "\n", depth: 0, namespaces, preserveSpace: false });
    pending.push({ content, depth: 0, namespaces, preserveSpace: false });
    if (canonical) pending.push({ content: "\n", depth: 0, namespaces, preserveSpace: false });
  }
  if (!canonical) pending.push({ content: "\n", depth: 0, namespaces, preserveSpace: false });
  pending.push({ content: root, depth: 0, namespaces, preserveSpace: false });
  for (let index = (root.prolog?.length ?? 0) - 1; index >= 0; index--) {
    const content = root.prolog![index]!;
    await budget.tick();
    if (content.kind === "text") continue;
    pending.push({ content: "\n", depth: 0, namespaces, preserveSpace: false });
    pending.push({ content, depth: 0, namespaces, preserveSpace: false });
  }
  while (pending.length) {
    await budget.tick();
    const frame = pending.pop()!;
    const current = frame.content;
    if (typeof current === "string") {
      yield current;
      continue;
    }
    if (current.kind === "element") {
      let preserveSpace = frame.preserveSpace;
      for (const attribute of current.attributes) {
        await budget.tick();
        if (attribute.namespace === xml && attribute.localName === "space") {
          if (attribute.value === "preserve") preserveSpace = true;
          else if (attribute.value === "default") preserveSpace = false;
        }
      }
      const content: XmlContent[] = [];
      let mixed = false;
      for (let index = 0; index < current.content.length; index++) {
        const child = current.content[index]!;
        await budget.tick();
        if (child.kind === "text") {
          let blank = true;
          for (const character of child.text) {
            await budget.tick();
            if (!" \t\n\r".includes(character)) blank = false;
          }
          // libxml's formatting parser removes blanks before markup and after
          // an already parsed child, while preserving text-only leaf content.
          if (
            format &&
            !preserveSpace &&
            !mixed &&
            blank &&
            (content.length > 0 || index + 1 < current.content.length)
          )
            continue;
          mixed = true;
        } else if (child.kind === "cdata") mixed = true;
        content.push(child);
      }
      const ordered = canonical ? await attributes(current, frame.namespaces, budget) : [];
      if (!canonical) {
        for (const namespace of [true, false])
          for (const attribute of current.attributes) {
            await budget.tick();
            if ((attribute.namespace === xmlns) === namespace) ordered.push(attribute);
          }
      }
      yield `<${current.name}`;
      for (const attribute of ordered) {
        await budget.tick();
        yield ` ${attribute.name}="`;
        yield* escape(attribute.value, true, budget, escaping);
        yield '"';
      }
      if (!content.length && !canonical) {
        yield "/>";
        continue;
      }
      yield ">";
      const indent = !canonical && format && !mixed && content.length > 0;
      const childNamespaces = canonical ? current.namespaces : frame.namespaces;
      const childFrame = { depth: frame.depth + 1, namespaces: childNamespaces, preserveSpace };
      pending.push({
        ...frame,
        content: `${indent ? "\n" + "  ".repeat(frame.depth) : ""}</${current.name}>`
      });
      for (let index = content.length - 1; index >= 0; index--) {
        await budget.tick();
        pending.push({ ...childFrame, content: content[index]! });
        if (indent) pending.push({ ...childFrame, content: "\n" + "  ".repeat(childFrame.depth) });
      }
    } else if (current.kind === "text" || (current.kind === "cdata" && canonical))
      yield* escape(current.text, false, budget, escaping);
    else if (current.kind === "cdata") {
      yield "<![CDATA[";
      yield current.text;
      yield "]]>";
    } else if (current.kind === "comment") {
      yield "<!--";
      yield current.text;
      yield "-->";
    } else if (current.kind === "processing-instruction") {
      yield `<?${current.target}`;
      if (current.text) {
        yield " ";
        yield current.text;
      }
      yield "?>";
    }
  }
}

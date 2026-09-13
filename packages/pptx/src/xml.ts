import { SaxesParser } from "saxes";
import { OfficeError } from "./errors.js";

export interface XmlName {
  readonly namespace: string;
  readonly localName: string;
}
export interface XmlAttribute {
  readonly name: XmlName;
  readonly value: string;
}
export interface XmlElement {
  readonly name: XmlName;
  readonly attributes: readonly XmlAttribute[];
  readonly children: readonly XmlElement[];
}
export interface XmlLimits {
  readonly maxBytes: number;
  readonly maxNodes: number;
  readonly maxDepth: number;
}
export interface XmlMerge {
  readonly attributes?: readonly (XmlName & { readonly value: string | null })[];
  readonly children?: {
    readonly sequence: readonly XmlName[];
    readonly remove?: readonly XmlName[];
    readonly upsert: readonly { readonly name: XmlName; readonly merge: XmlMerge }[];
  };
}
export interface XmlPart {
  readonly nodeCount: number;
  readonly root: XmlElement;
  bytes(): Uint8Array;
  markup(element: XmlElement, standalone?: boolean): string;
  subtree(element: XmlElement): XmlPart;
  resolveNamespace(element: XmlElement, prefix: string): string | undefined;
  reorderChildren(element: XmlElement, children: readonly XmlElement[]): XmlPart;
  spliceChildren(
    element: XmlElement,
    index: number,
    deleteCount: number,
    children: readonly string[]
  ): XmlPart;
  setText(element: XmlElement, text: string): XmlPart;
  merge(element: XmlElement, update: XmlMerge): XmlPart;
}
interface AttributeSpan {
  readonly start: number;
  readonly end: number;
  readonly valueStart: number;
  readonly valueEnd: number;
  readonly quote: string;
}
interface ElementSpan {
  readonly element: XmlElement;
  readonly start: number;
  readonly openEnd: number;
  readonly qname: string;
  readonly empty: boolean;
  readonly depth: number;
  readonly bindings: ReadonlyMap<string, string>;
  readonly declaredBindings: ReadonlySet<string>;
  readonly attributes: ReadonlyMap<string, AttributeSpan>;
  closeStart: number;
  end: number;
}
interface Patch {
  readonly start: number;
  readonly end: number;
  readonly value: string;
}
const xmlns = "http://www.w3.org/2000/xmlns/";
const xmlNamespace = "http://www.w3.org/XML/1998/namespace";
function fail(code: "invalid-xml" | "invalid-value" | "resource-limit"): never {
  throw new OfficeError(
    code,
    code === "resource-limit" ? "XML resource limit exceeded." : "Invalid XML or structured edit.",
    code === "invalid-value" ? "usage" : "parse"
  );
}
function key(name: XmlName): string {
  return JSON.stringify([name.namespace, name.localName]);
}
function escape(value: string, quote: string, maxLength: number): string {
  let output = "";
  if (value.length > maxLength) fail("resource-limit");
  for (const character of value) {
    const point = character.codePointAt(0)!;
    if (
      (point < 32 && point !== 9 && point !== 10 && point !== 13) ||
      (point >= 0xd800 && point <= 0xdfff) ||
      point === 0xfffe ||
      point === 0xffff
    )
      fail("invalid-value");
    switch (character) {
      case "&":
        output += "&amp;";
        break;
      case "<":
        output += "&lt;";
        break;
      case "\t":
        output += "&#9;";
        break;
      case "\n":
        output += "&#10;";
        break;
      case "\r":
        output += "&#13;";
        break;
      default:
        output += character === quote ? (quote === '"' ? "&quot;" : "&apos;") : character;
    }
    if (output.length > maxLength) fail("resource-limit");
  }
  if (output.length > maxLength) fail("resource-limit");
  return output;
}
function validName(name: XmlName, maxLength: number): void {
  if (
    !name ||
    typeof name.namespace !== "string" ||
    typeof name.localName !== "string" ||
    !name.localName ||
    name.localName.includes(":") ||
    name.namespace === xmlns ||
    name.localName === "xmlns"
  )
    fail("invalid-value");
  if (name.namespace.length + name.localName.length > maxLength) fail("resource-limit");
  const parser = new SaxesParser();
  let count = 0;
  parser.on("error", () => fail("invalid-value"));
  parser.on("opentag", (tag) => {
    if (++count !== 1 || tag.name !== name.localName || Object.keys(tag.attributes).length)
      fail("invalid-value");
  });
  parser.write(`<${name.localName}/>`).close();
}
function apply(
  source: string,
  start: number,
  end: number,
  patches: Patch[],
  maxLength: number
): string {
  const length =
    end -
    start +
    patches.reduce((sum, patch) => sum + patch.value.length - (patch.end - patch.start), 0);
  if (length > maxLength) fail("resource-limit");
  patches.sort((a, b) => a.start - b.start || a.end - b.end);
  let position = start;
  const output: string[] = [];
  for (const patch of patches) {
    if (patch.start < position || patch.end > end) fail("invalid-value");
    output.push(source.slice(position, patch.start), patch.value);
    position = patch.end;
  }
  output.push(source.slice(position, end));
  return output.join("");
}

export function parseXmlPart(input: Uint8Array, requestedLimits: XmlLimits): XmlPart {
  if (!(input instanceof Uint8Array))
    throw new OfficeError("invalid-type", "Expected XML bytes.", "usage");
  if (!requestedLimits) fail("invalid-value");
  const limits = { ...requestedLimits };
  for (const value of [limits.maxBytes, limits.maxNodes, limits.maxDepth])
    if (!Number.isSafeInteger(value) || value < 1) fail("invalid-value");
  if (input.length > limits.maxBytes) fail("resource-limit");
  const original = Uint8Array.from(input);
  const little = (input[0] === 255 && input[1] === 254) || (input[0] === 60 && input[1] === 0);
  const big = (input[0] === 254 && input[1] === 255) || (input[0] === 0 && input[1] === 60);
  const encoding = little ? "utf-16le" : big ? "utf-16be" : "utf-8";
  const bom =
    little || big
      ? input[0] === 255 || input[0] === 254
        ? 2
        : 0
      : input[0] === 239 && input[1] === 187 && input[2] === 191
        ? 3
        : 0;
  let source: string;
  try {
    source = new TextDecoder(encoding, { fatal: true }).decode(original);
  } catch {
    fail("invalid-xml");
  }
  const spans = new Map<XmlElement, ElementSpan>();
  const stack: ElementSpan[] = [];
  const annotated = new Set<XmlElement>();
  let root: XmlElement | undefined;
  let start = 0;
  let nodes = 0;
  const countNode = () => {
    if (++nodes > limits.maxNodes) fail("resource-limit");
  };
  const parser = new SaxesParser({ xmlns: true });
  parser.on("error", () => fail("invalid-xml"));
  parser.on("doctype", () => fail("invalid-xml"));
  parser.on("xmldecl", (declaration) => {
    if (
      declaration.version !== "1.0" ||
      (declaration.encoding &&
        declaration.encoding.toLowerCase() !== (encoding === "utf-8" ? "utf-8" : "utf-16"))
    )
      fail("invalid-xml");
  });
  for (const event of ["text", "cdata"] as const) parser.on(event, countNode);
  for (const event of ["comment", "processinginstruction"] as const)
    parser.on(event, () => {
      countNode();
      const parent = stack.at(-1);
      if (parent) annotated.add(parent.element);
    });
  parser.on("opentagstart", () => {
    start = source.lastIndexOf("<", parser.position - 1);
  });
  parser.on("opentag", (tag) => {
    countNode();
    const depth = stack.length + 1;
    if (depth > limits.maxDepth) fail("resource-limit");
    const parent = stack.at(-1);
    const bindings = new Map(parent?.bindings ?? [["xml", xmlNamespace]]);
    for (const [prefix, uri] of Object.entries(tag.ns)) bindings.set(prefix, uri);
    const attributes = Object.values(tag.attributes).filter((a) => a.uri !== xmlns);
    const element = {
      name: Object.freeze({ namespace: tag.uri, localName: tag.local }),
      attributes: Object.freeze(
        attributes.map((a) =>
          Object.freeze({
            name: Object.freeze({ namespace: a.uri, localName: a.local }),
            value: a.value
          })
        )
      ),
      children: [] as XmlElement[]
    };
    const lexical = new Map<string, AttributeSpan>();
    let position = start + 1 + tag.name.length;
    while (position < parser.position) {
      while (" \t\r\n".includes(source[position] ?? "\0")) position++;
      if (source[position] === "/" || source[position] === ">") break;
      const attributeStart = position;
      while (position < parser.position && !"= \t\r\n".includes(source[position]!)) position++;
      const qname = source.slice(attributeStart, position);
      while (source[position] !== "=") position++;
      position++;
      while (" \t\r\n".includes(source[position] ?? "\0")) position++;
      const quote = source[position++]!;
      const valueStart = position;
      while (source[position] !== quote) position++;
      const valueEnd = position++;
      const attribute = attributes.find((a) => a.name === qname);
      if (attribute)
        lexical.set(key({ namespace: attribute.uri, localName: attribute.local }), {
          start: attributeStart,
          end: position,
          valueStart,
          valueEnd,
          quote
        });
    }
    const span: ElementSpan = {
      element,
      start,
      openEnd: parser.position,
      qname: tag.name,
      empty: tag.isSelfClosing,
      depth,
      bindings,
      declaredBindings: new Set(Object.keys(tag.ns)),
      attributes: lexical,
      closeStart: parser.position,
      end: parser.position
    };
    if (parent) (parent.element.children as XmlElement[]).push(element);
    else root = element;
    spans.set(element, span);
    stack.push(span);
  });
  parser.on("closetag", () => {
    const span = stack.pop()!;
    span.end = parser.position;
    span.closeStart = span.empty ? span.openEnd - 2 : source.lastIndexOf("</", parser.position - 1);
    Object.freeze(span.element.children);
    Object.freeze(span.element);
  });
  parser.write(source).close();
  if (!root) fail("invalid-xml");

  function encode(value: string): Uint8Array {
    if (encoding === "utf-8") {
      let length = bom;
      for (const character of value) {
        const point = character.codePointAt(0)!;
        length += point < 0x80 ? 1 : point < 0x800 ? 2 : point < 0x10000 ? 3 : 4;
        if (length > limits.maxBytes) fail("resource-limit");
      }
      const payload = new TextEncoder().encode(value);
      if (payload.length + bom > limits.maxBytes) fail("resource-limit");
      const output = new Uint8Array(payload.length + bom);
      output.set(original.subarray(0, bom));
      output.set(payload, bom);
      return output;
    }
    if (value.length * 2 + bom > limits.maxBytes) fail("resource-limit");
    const output = new Uint8Array(value.length * 2 + bom);
    output.set(original.subarray(0, bom));
    const view = new DataView(output.buffer);
    for (let i = 0; i < value.length; i++) view.setUint16(bom + i * 2, value.charCodeAt(i), little);
    return output;
  }
  return Object.freeze({
    nodeCount: nodes,
    root,
    bytes: () => Uint8Array.from(original),
    subtree(element: XmlElement): XmlPart {
      return parseXmlPart(new TextEncoder().encode(this.markup(element, true)), limits);
    },
    markup(element: XmlElement, standalone = false): string {
      const span = spans.get(element);
      if (!span) fail("invalid-value");
      if (!standalone) return source.slice(span.start, span.end);
      let declarations = "";
      for (const [prefix, uri] of span.bindings) {
        if (prefix === "xml" || span.declaredBindings.has(prefix)) continue;
        declarations += ` xmlns${prefix ? `:${prefix}` : ""}="${escape(uri, '"', limits.maxBytes)}"`;
      }
      const insertion = span.start + 1 + span.qname.length;
      const result =
        source.slice(span.start, insertion) + declarations + source.slice(insertion, span.end);
      if (result.length > limits.maxBytes) fail("resource-limit");
      return result;
    },
    setText(element: XmlElement, text: string): XmlPart {
      const span = spans.get(element);
      if (!span || element.children.length || annotated.has(element) || typeof text !== "string")
        fail("invalid-value");
      const value = escape(text, '"', limits.maxBytes).split("]]>").join("]]&gt;");
      const patch = span.empty
        ? { start: span.openEnd - 2, end: span.end, value: `>${value}</${span.qname}>` }
        : { start: span.openEnd, end: span.closeStart, value };
      return parseXmlPart(
        encode(apply(source, 0, source.length, [patch], limits.maxBytes)),
        limits
      );
    },
    resolveNamespace(element: XmlElement, prefix: string): string | undefined {
      const span = spans.get(element);
      if (!span) fail("invalid-value");
      return span.bindings.get(prefix);
    },
    reorderChildren(element: XmlElement, children: readonly XmlElement[]): XmlPart {
      const owned = new Set(element.children);
      if (!spans.has(element) || !Array.isArray(children) || children.length !== owned.size)
        fail("invalid-value");
      for (const child of children) if (!owned.delete(child)) fail("invalid-value");
      const patches = element.children.map((child, index) => {
        const old = spans.get(child)!;
        const next = spans.get(children[index]!)!;
        return { start: old.start, end: old.end, value: source.slice(next.start, next.end) };
      });
      return parseXmlPart(
        encode(apply(source, 0, source.length, patches, limits.maxBytes)),
        limits
      );
    },
    spliceChildren(
      element: XmlElement,
      index: number,
      deleteCount: number,
      children: readonly string[]
    ): XmlPart {
      const selected = spans.get(element);
      if (
        !selected ||
        !Number.isSafeInteger(index) ||
        index < 0 ||
        index > element.children.length ||
        !Number.isSafeInteger(deleteCount) ||
        deleteCount < 0 ||
        deleteCount > element.children.length - index ||
        !Array.isArray(children)
      )
        fail("invalid-value");
      let authoredLength = 0;
      let authoredNodes = 0;
      for (const child of children) {
        if (typeof child !== "string") fail("invalid-value");
        authoredLength += child.length;
        if (authoredLength > limits.maxBytes) fail("resource-limit");
        const bytes = new TextEncoder().encode(child);
        if (new TextDecoder().decode(bytes) !== child) fail("invalid-value");
        const fragment = parseXmlPart(bytes, limits);
        authoredNodes += fragment.nodeCount;
        if (authoredNodes > limits.maxNodes) fail("resource-limit");
        if (
          fragment.markup(fragment.root) !== child ||
          (selected.bindings.get("") && fragment.resolveNamespace(fragment.root, "") === undefined)
        )
          fail("invalid-value");
      }
      const content = children.join("");
      const patches: Patch[] = [];
      if (selected.empty && content) {
        patches.push({
          start: selected.openEnd - 2,
          end: selected.openEnd,
          value: `>${content}</${selected.qname}>`
        });
      } else {
        const position =
          index < element.children.length
            ? spans.get(element.children[index]!)!.start
            : selected.closeStart;
        if (content) patches.push({ start: position, end: position, value: content });
        for (const child of element.children.slice(index, index + deleteCount)) {
          const removed = spans.get(child)!;
          patches.push({ start: removed.start, end: removed.end, value: "" });
        }
      }
      return parseXmlPart(
        encode(apply(source, 0, source.length, patches, limits.maxBytes)),
        limits
      );
    },
    merge(element: XmlElement, update: XmlMerge): XmlPart {
      const selected = spans.get(element);
      if (!selected) fail("invalid-value");
      let workingSource = source;
      const active = new Set<XmlMerge>();
      let edits = 0;
      const charge = () => {
        if (++edits > limits.maxNodes) fail("resource-limit");
      };
      const pending: { span: ElementSpan; update: XmlMerge; depth: number; finish?: boolean }[] = [
        { span: selected, update, depth: selected.depth }
      ];
      const results = new Map<ElementSpan, string>();
      const preparation = new Map<
        ElementSpan,
        {
          patches: Patch[];
          children: {
            span: ElementSpan;
            update: XmlMerge;
            inserted: boolean;
            position: number;
            rank: number;
          }[];
        }
      >();
      while (pending.length) {
        const task = pending.pop()!;
        const { span, update: change, depth } = task;
        if (task.finish) {
          const prepared = preparation.get(span)!;
          let emptyContent = "";
          for (const child of prepared.children) {
            const value = results.get(child.span)!;
            if (span.empty && child.inserted) emptyContent += value;
            else
              prepared.patches.push({
                start: child.position,
                end: child.inserted ? child.position : child.span.end,
                value
              });
          }
          if (emptyContent)
            prepared.patches.push({
              start: span.openEnd - 2,
              end: span.openEnd,
              value: `>${emptyContent}</${span.qname}>`
            });
          const value = apply(
            workingSource,
            span.start,
            span.end,
            prepared.patches,
            limits.maxBytes
          );
          if (value.length > limits.maxBytes) fail("resource-limit");
          results.set(span, value);
          active.delete(change);
          preparation.delete(span);
          for (const child of prepared.children) results.delete(child.span);
          continue;
        }
        if (!change || typeof change !== "object" || active.has(change)) fail("invalid-value");
        if (depth > limits.maxDepth) fail("resource-limit");
        charge();
        active.add(change);
        const patches: Patch[] = [];
        const bindings = new Map(span.bindings);
        const seen = new Set<string>();
        let additions = "";
        for (const attribute of change.attributes ?? []) {
          charge();
          validName(attribute, limits.maxBytes);
          const id = key(attribute);
          if (seen.has(id) || (attribute.value !== null && typeof attribute.value !== "string"))
            fail("invalid-value");
          seen.add(id);
          const existing = span.attributes.get(id);
          if (existing) {
            if (attribute.value === null)
              patches.push({ start: existing.start, end: existing.end, value: "" });
            else if (
              span.element.attributes.find((a) => key(a.name) === id)!.value !== attribute.value
            ) {
              if (attribute.value.length > limits.maxBytes) fail("resource-limit");
              patches.push({
                start: existing.valueStart,
                end: existing.valueEnd,
                value: escape(attribute.value, existing.quote, limits.maxBytes)
              });
            }
          } else if (attribute.value !== null) {
            if (attribute.value.length > limits.maxBytes) fail("resource-limit");
            let prefix = "";
            if (attribute.namespace) {
              prefix =
                [...bindings].find(([p, uri]) => p && uri === attribute.namespace)?.[0] ?? "";
              if (!prefix) {
                let index = 1;
                do {
                  prefix = `n${index++}`;
                } while (bindings.has(prefix));
                bindings.set(prefix, attribute.namespace);
                additions += ` xmlns:${prefix}="${escape(attribute.namespace, '"', limits.maxBytes)}"`;
              }
            }
            additions += ` ${prefix ? `${prefix}:` : ""}${attribute.localName}="${escape(attribute.value, '"', limits.maxBytes)}"`;
          }
          if (additions.length > limits.maxBytes) fail("resource-limit");
        }
        if (additions.length > limits.maxBytes) fail("resource-limit");
        if (additions)
          patches.push({
            start: span.openEnd - (span.empty ? 2 : 1),
            end: span.openEnd - (span.empty ? 2 : 1),
            value: additions
          });
        const children: {
          span: ElementSpan;
          update: XmlMerge;
          inserted: boolean;
          position: number;
          rank: number;
        }[] = [];
        if (change.children) {
          const sequence = new Map<string, number>();
          for (const [index, item] of change.children.sequence.entries()) {
            charge();
            validName(item, limits.maxBytes);
            if (sequence.has(key(item))) fail("invalid-value");
            sequence.set(key(item), index);
          }
          let previous = -1;
          const existing = new Map<string, ElementSpan>();
          for (const child of span.element.children) {
            const id = key(child.name);
            const rank = sequence.get(id);
            if (rank === undefined) continue;
            if (rank <= previous) fail("invalid-value");
            previous = rank;
            existing.set(id, spans.get(child)!);
          }
          const requested = new Set<string>();
          for (const removal of change.children.remove ?? []) {
            charge();
            validName(removal, limits.maxBytes);
            const id = key(removal);
            if (!sequence.has(id) || requested.has(id)) fail("invalid-value");
            requested.add(id);
            const removed = existing.get(id);
            if (removed) patches.push({ start: removed.start, end: removed.end, value: "" });
          }
          for (const child of change.children.upsert) {
            charge();
            validName(child.name, limits.maxBytes);
            const id = key(child.name);
            const rank = sequence.get(id);
            if (rank === undefined || requested.has(id)) fail("invalid-value");
            requested.add(id);
            const matched = existing.get(id);
            if (matched)
              children.push({
                span: matched,
                update: child.merge,
                inserted: false,
                position: matched.start,
                rank
              });
            else {
              const qname = child.name.namespace
                ? `${child.name.namespace === xmlNamespace ? "xml" : "n"}:${child.name.localName}`
                : child.name.localName;
              const declaration =
                child.name.namespace === xmlNamespace
                  ? ""
                  : child.name.namespace
                    ? ` xmlns:n="${escape(child.name.namespace, '"', limits.maxBytes)}"`
                    : ' xmlns=""';
              const fragment = `<${qname}${declaration}/>`;
              if (workingSource.length + fragment.length > source.length + limits.maxBytes)
                fail("resource-limit");
              const start = workingSource.length;
              workingSource += fragment;
              const bindings = new Map([
                ["xml", xmlNamespace],
                [child.name.namespace ? "n" : "", child.name.namespace]
              ]);
              const authored: ElementSpan = {
                element: { name: child.name, attributes: [], children: [] },
                start,
                openEnd: workingSource.length,
                qname,
                empty: true,
                depth: depth + 1,
                bindings,
                declaredBindings: new Set(),
                attributes: new Map(),
                closeStart: workingSource.length - 2,
                end: workingSource.length
              };
              const following = [...existing.entries()].find(
                ([candidate]) => sequence.get(candidate)! > rank
              )?.[1];
              children.push({
                span: authored,
                update: child.merge,
                inserted: true,
                position: following?.start ?? span.closeStart,
                rank
              });
            }
          }
          children.sort((a, b) => a.position - b.position || a.rank - b.rank);
        }
        preparation.set(span, { patches, children });
        pending.push({ ...task, finish: true });
        for (const child of [...children].reverse())
          pending.push({ span: child.span, update: child.update, depth: depth + 1 });
      }
      const result = apply(
        source,
        0,
        source.length,
        [{ start: selected.start, end: selected.end, value: results.get(selected)! }],
        limits.maxBytes
      );
      return parseXmlPart(encode(result), limits);
    }
  });
}

import { encodeTextStream } from "../encoding/encode-stream.js";
import { parseXmlSteps } from "@poe-code/safe-fs/xml";
import { SsconvertError, type CapabilityContext } from "../contracts.js";
import type { ImportedValue } from "@poe-code/spreadsheet-ast";

const urn = "urn:oasis:names:tc:opendocument:xmlns:";
export const odfEncryptionNamespace = "urn:org:documentfoundation:names:experimental:office:xmlns:loext:1.0";
export const odfNamespaces: Readonly<Record<string, string>> = {
  xml: "http://www.w3.org/XML/1998/namespace",
  office: urn + "office:1.0", style: urn + "style:1.0", text: urn + "text:1.0", table: urn + "table:1.0",
  draw: urn + "drawing:1.0", fo: urn + "xsl-fo-compatible:1.0", xlink: "http://www.w3.org/1999/xlink",
  dc: "http://purl.org/dc/elements/1.1/", meta: urn + "meta:1.0", number: urn + "datastyle:1.0",
  svg: urn + "svg-compatible:1.0", chart: urn + "chart:1.0", config: urn + "config:1.0",
  form: urn + "form:1.0", script: urn + "script:1.0", of: urn + "of:1.2",
  manifest: urn + "manifest:1.0", gnm: "http://www.gnumeric.org/odf-extension/1.0",
  calcext: "urn:org:documentfoundation:names:experimental:calc:xmlns:calcext:1.0"
};
export type OdfAttributes = Readonly<Record<string, string | number | undefined>>;
export function odfObject(value: ImportedValue | undefined): Readonly<Record<string, ImportedValue>> | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Readonly<Record<string, ImportedValue>> : undefined;
}
export function odfAttributes(value: ImportedValue | undefined, namespace?: string): Record<string, string> {
  const source = odfObject(value)?.attributes;
  if (Array.isArray(source)) return Object.fromEntries(source.flatMap(a => {
    const v = odfObject(a); return typeof v?.name === "string" && typeof v.value === "string" && (namespace === undefined || v.namespace === namespace) ? [[v.name, v.value]] : [];
  }));
  if (namespace !== undefined) return {};
  return Object.fromEntries(Object.entries(odfObject(source) ?? {}).filter((entry): entry is [string, string] => typeof entry[1] === "string"));
}
export function odfChildren(value: ImportedValue | undefined): readonly ImportedValue[] {
  const source = odfObject(value)?.children; return Array.isArray(source) ? source : [];
}

/** OOo2Oasis moves legacy annotation attributes into DC/meta elements. */
export function upgradeOdfAnnotation(node: Readonly<Record<string, ImportedValue>>, charge: (amount?: number) => void): Readonly<Record<string, ImportedValue>> {
  const original = odfChildren(node); charge(original.length);
  const attributes: ImportedValue[] = [], children = [...original];
  for (const value of Array.isArray(node.attributes) ? node.attributes : []) {
    charge(); const a = odfObject(value); if (!a) continue;
    if (a.namespace === "http://openoffice.org/2000/office") {
      // The canonical comment owns the author; preserve the two date fields.
      if (a.name === "author") continue;
      if (a.name === "create-date" || a.name === "create-date-string") {
        const date = a.name === "create-date";
        children.push({ name: date ? "date" : "date-string", namespace: odfNamespaces[date ? "dc" : "meta"]!,
          attributes: [], children: [], text: a.value ?? "" });
        continue;
      }
      attributes.push({ ...a, namespace: odfNamespaces.office! });
    } else attributes.push(a.namespace === "http://www.w3.org/2000/svg" ? { ...a, namespace: odfNamespaces.svg! } : value);
  }
  return { ...node, namespace: odfNamespaces.office!, attributes, children,
    content: children.map((_, index) => ({ kind: "element", index })) };
}

export function createOdfXml(context: CapabilityContext, extended: boolean) {
  let work = 0, nodes = 0;
  const names = new Set<string>();
  const declarations = { ...Object.fromEntries(Object.entries(odfNamespaces).map(([prefix, uri]) => ["xmlns:" + prefix, uri])),
    "xmlns:loext": odfEncryptionNamespace };
  function charge(amount = 1) {
    context.signal.throwIfAborted();
    if (!Number.isSafeInteger(amount) || amount < 0 || amount > (context.limits.workbookWork ?? Infinity) - work)
      throw new SsconvertError("resource-limit", "ssconvert OpenDocument work limit exceeded");
    work += amount;
  }
  function name(value: string) {
    charge(value.length); if (names.has(value)) return;
    try {
      const parser = parseXmlSteps(`<${value} ${Object.entries(declarations).map(([k,v]) => `${k}="${v}"`).join(" ")}/>`, { maxNodes: 1, maxAttributes: 100 });
      let step = parser.next(); while (!step.done) step = parser.next();
      if (step.value.name !== value || step.value.children.length) throw new Error("name");
    } catch { throw new SsconvertError("invalid-request", "Invalid OpenDocument XML name"); }
    // Retained extension metadata can introduce arbitrary element names.
    // Cache common short names without retaining a document-wide name set.
    if (value.length <= 128) {
      if (names.size === 128) names.delete(names.values().next().value!);
      names.add(value);
    }
  }
  function escape(value: string) {
    charge(value.length); let result = "";
    for (const c of value) {
      const code = c.codePointAt(0)!;
      if (code < 32 && !"\t\n\r".includes(c) || code === 65534 || code === 65535 || code >= 0xd800 && code <= 0xdfff)
        throw new SsconvertError("unsupported-feature", "Unsupported ssconvert feature: non-XML OpenDocument character");
      result += c === "&" ? "&amp;" : c === "<" ? "&lt;" : c === ">" ? "&gt;" : c === '"' ? "&quot;" : c === "\r" ? "&#13;" : c === "\n" ? "&#10;" : c === "\t" ? "&#9;" : c;
    }
    return result;
  }
  function* escapedFragments(value: string): Generator<string> {
    for (let offset = 0; offset < value.length;) {
      let end = Math.min(offset + 2048, value.length);
      const last = value.charCodeAt(end - 1);
      if (end < value.length && last >= 0xd800 && last <= 0xdbff) end--;
      yield escape(value.slice(offset, end)); offset = end;
    }
  }
  function* opening(tag: string, attributes: OdfAttributes): Generator<string> {
    charge(); if (++nodes > (context.limits.workbookNodes ?? Infinity))
      throw new SsconvertError("resource-limit", "ssconvert OpenDocument XML nodes limit exceeded");
    name(tag); yield "<" + tag;
    for (const [key, value] of Object.entries(attributes)) if (value !== undefined) {
      // XML namespace declaration names are validated by the final parser.
      if (!key.startsWith("xmlns:")) name(key);
      yield ` ${key}="`;
      yield* escapedFragments(String(value));
      yield '"';
    }
  }
  function element(tag: string, attributes: OdfAttributes = {}, content = "") {
    let result = "";
    for (const fragment of opening(tag, attributes)) result += fragment;
    result += content ? ">" + content + "</" + tag + ">" : "/>";
    let bytes = 0, characters = 0;
    if (context.limits.outputBytes !== Infinity) for (const character of result) {
      if (++characters % 16384 === 0) context.signal.throwIfAborted();
      const point = character.codePointAt(0)!;
      bytes += point < 128 ? 1 : point < 2048 ? 2 : point < 65536 ? 3 : 4;
      if (bytes > context.limits.outputBytes)
        throw new SsconvertError("resource-limit", "ssconvert OpenDocument output bytes limit exceeded");
    }
    return result;
  }
  async function* stream(tag: string, attributes: OdfAttributes,
    content: AsyncIterable<string | Uint8Array>): AsyncGenerator<Uint8Array> {
    async function* parts() {
      yield* opening(tag, attributes);
      let opened = false;
      for await (const part of content) {
        context.signal.throwIfAborted();
        if (!part.length) continue;
        if (!opened) { yield ">"; opened = true; }
        yield part;
      }
      yield opened ? "</" + tag + ">" : "/>";
    }
    yield* encodeTextStream(parts(), "UTF-8", false, context);
  }
  async function* documentStream(tag: string, content: AsyncIterable<string | Uint8Array>): AsyncGenerator<Uint8Array> {
    async function* parts() {
      yield '<?xml version="1.0" encoding="UTF-8"?>\n';
      yield* stream(tag, { ...declarations, "xmlns:loext": undefined, "office:version": "1.2" }, content);
    }
    yield* encodeTextStream(parts(), "UTF-8", false, context);
  }
  function text(value: string, inlineControls = false): string {
    charge(value.length); let result = "", plain = "";
    function flush() { result += escape(plain); plain = ""; }
    for (let i = 0; i < value.length; i++) {
      const c = value[i]!;
      if (c === " ") {
        flush(); let count = 1; while (value[i + 1] === " ") { i++; count++; }
        result += element("text:s", count > 1 ? { "text:c": count } : {});
      } else if (c === "\t" || c === "\n") { flush(); result += inlineControls ? escape(c) : element(c === "\t" ? "text:tab" : "text:line-break"); }
      else plain += c;
    }
    flush(); return result;
  }
  function* retainedFragments(value: ImportedValue | undefined, depth = 0, hyperlink?: (href: string) => string,
    hyperlinkContent = false, contentOverride?: string): Generator<string, void, unknown> {
    const active = new Set<object>();
    function* visit(value: ImportedValue | undefined, depth: number, hyperlinkContent: boolean,
      contentOverride?: string): Generator<string, void, unknown> {
      charge(); const v = odfObject(value); if (!v || typeof v.name !== "string" || typeof v.namespace !== "string") return;
      if (depth > (context.limits.xmlDepth ?? Infinity)) throw new SsconvertError("resource-limit", "ssconvert OpenDocument metadata depth limit exceeded");
      if (active.has(v)) throw new SsconvertError("invalid-request", "Invalid cyclic OpenDocument metadata");
      const prefix = Object.entries(odfNamespaces).find(([, uri]) => uri === v.namespace)?.[0];
      if (!prefix || !extended && ["gnm", "calcext"].includes(prefix)) return;
      active.add(v);
      try {
        const attributes: Record<string, string> = {};
        if (Array.isArray(v.attributes)) for (const a of v.attributes) {
          charge(); const attribute = odfObject(a);
          if (typeof attribute?.name !== "string" || typeof attribute.value !== "string" || typeof attribute.namespace !== "string") continue;
          const p = Object.entries(odfNamespaces).find(([, uri]) => uri === attribute.namespace)?.[0];
          if (attribute.namespace && (!p || !extended && ["gnm", "calcext"].includes(p))) continue;
          attributes[(p ? p + ":" : "") + attribute.name] = attribute.value;
        }
        if (prefix === "text" && v.name === "a" && attributes["xlink:href"] !== undefined && hyperlink)
          attributes["xlink:href"] = hyperlink(attributes["xlink:href"]);
        const children = odfChildren(v);
        const childHyperlinkContent = Boolean(hyperlink) && prefix === "text" && v.name === "a" && attributes["xlink:href"] !== undefined;
        function* content(): Generator<string, void, unknown> {
          if (contentOverride !== undefined) { if (contentOverride) yield contentOverride; return; }
          if (Array.isArray(v!.content)) for (const c of v!.content) {
            charge(); const item = odfObject(c);
            if (item?.kind === "text" && typeof item.text === "string") { yield* escapedFragments(item.text); continue; }
            if (item?.kind !== "element") continue;
            if (item.index === undefined) { yield* visit(item.value, depth + 1, childHyperlinkContent); continue; }
            if (typeof item.index !== "number" || !Number.isSafeInteger(item.index) || item.index < 0 || item.index >= children.length)
              throw new SsconvertError("invalid-request", "Invalid OpenDocument metadata child index");
            yield* visit(children[item.index], depth + 1, childHyperlinkContent);
          } else {
            if (typeof v!.text === "string") yield* escapedFragments(v!.text);
            for (const child of children) yield* visit(child, depth + 1, childHyperlinkContent);
          }
        }
        const cursor = content();
        try {
          const first = cursor.next();
          // Calc URL fields have no whitespace child contexts. Keep the same
          // flattening rules without constructing the entire whitespace field.
          if (first.done && hyperlinkContent && prefix === "text" && !children.length) {
            if (v.name === "s" && Object.keys(attributes).every(key => key === "text:c")) {
              const count = Number(attributes["text:c"] ?? "1");
              if (!Number.isSafeInteger(count) || count < 0) throw new SsconvertError("invalid-request", "Invalid OpenDocument whitespace count");
              if (count > context.limits.outputBytes) throw new SsconvertError("resource-limit", "ssconvert OpenDocument output bytes limit exceeded");
              charge(count);
              for (let offset = 0; offset < count; offset += 4096) { context.signal.throwIfAborted(); yield " ".repeat(Math.min(4096, count - offset)); }
              return;
            }
            if (!Object.keys(attributes).length && (v.name === "tab" || v.name === "line-break")) {
              yield escape(v.name === "tab" ? "\t" : "\n"); return;
            }
          }
          const tag = prefix + ":" + v.name;
          yield* opening(tag, attributes);
          if (first.done) { yield "/>"; return; }
          yield ">";
          yield first.value;
          yield* cursor;
          yield "</" + tag + ">";
        } finally { cursor.return(); }
      } finally { active.delete(v); }
    }
    let bytes = 0;
    for (const fragment of visit(value, depth, hyperlinkContent, contentOverride)) {
      context.signal.throwIfAborted();
      if (context.limits.outputBytes !== Infinity) for (const character of fragment) {
        const point = character.codePointAt(0)!;
        bytes += point < 128 ? 1 : point < 2048 ? 2 : point < 65536 ? 3 : 4;
        if (bytes > context.limits.outputBytes) throw new SsconvertError("resource-limit", "ssconvert OpenDocument output bytes limit exceeded");
      }
      yield fragment;
    }
  }
  function retained(value: ImportedValue | undefined, depth = 0, hyperlink?: (href: string) => string, hyperlinkContent = false, contentOverride?: string): string {
    let result = "";
    for (const fragment of retainedFragments(value, depth, hyperlink, hyperlinkContent, contentOverride)) result += fragment;
    return result;
  }
  function document(tag: string, body: string) {
    // The encryption extension is declared only on its outer package manifest.
    return '<?xml version="1.0" encoding="UTF-8"?>\n' + element(tag, { ...declarations, "xmlns:loext": undefined, "office:version": "1.2" }, body);
  }
  return { element, stream, escape, text, retained, retainedFragments, document, documentStream, charge };
}

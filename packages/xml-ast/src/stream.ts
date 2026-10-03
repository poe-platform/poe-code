import { SaxesParser } from "saxes/saxes.js";
import { XmlLimitError, type XmlContent, type XmlElement, type XmlLimits } from "./index.js";

/** Incremental source consumption. The returned tree and individual XML tokens remain resident. */
export async function parseXmlStream(
  source: AsyncIterable<string> | Iterable<string>,
  limits: XmlLimits = {},
  checkpoint?: (units: number) => void | Promise<void>
): Promise<XmlElement> {
  if (limits.recover) throw new TypeError("XML stream recovery is unsupported; use parseXmlSteps");
  for (const key of ["maxDepth", "maxNodes", "maxAttributes", "maxAttributesPerElement", "maxNamespaces", "maxContentNodes", "maxTextLength"] as const) {
    const value = limits[key];
    if (value !== undefined && value !== Infinity && (!Number.isSafeInteger(value) || value < 1))
      throw new RangeError("XML limits must be positive integers");
  }
  const counters = { maxNodes: 0, maxAttributes: 0, maxContentNodes: 0, maxTextLength: 0 };
  function bound(key: keyof typeof counters | "maxDepth" | "maxAttributesPerElement" | "maxNamespaces", value: number) {
    if (value > (limits[key] ?? Infinity)) throw new XmlLimitError(key, "XML resource limit exceeded");
  }
  function charge(key: keyof typeof counters, value = 1) { counters[key] += value; bound(key, counters[key]); }
  const retain = limits.retainContent !== false;
  const stack: { element: XmlElement; namespaces: Map<string, string> }[] = [];
  const prolog: XmlContent[] = [], epilog: XmlContent[] = [];
  const emptyNamespaces = new Map<string, string>();
  let root: XmlElement | undefined, declaration: string | undefined;
  const parser = new SaxesParser({ xmlns: true, defaultXMLVersion: "1.0", forceXMLVersion: true });
  parser.on("error", error => { throw new SyntaxError(`Invalid XML: ${error.message}`); });
  parser.on("doctype", () => { throw new SyntaxError("Invalid XML: DTD and entity declarations are forbidden"); });
  let prefix = "", capturing = true;
  parser.on("xmldecl", value => {
    const encoding = value.encoding?.toUpperCase();
    if (value.version !== "1.0" || encoding !== undefined &&
      (!["UTF-8", "UTF-16", "UTF-16LE", "UTF-16BE"].includes(encoding) ||
       limits.expectedEncoding !== undefined && encoding !== limits.expectedEncoding &&
       !(encoding === "UTF-16" && ["UTF-16LE", "UTF-16BE"].includes(limits.expectedEncoding))))
      throw new SyntaxError("Invalid XML: unsupported XML declaration");
    if (retain) declaration = prefix.slice(0, prefix.indexOf("?>") + 2);
    prefix = ""; capturing = false;
  });
  parser.on("opentag", tag => {
    charge("maxNodes"); bound("maxDepth", stack.length + 1);
    const attrs = Object.values(tag.attributes);
    charge("maxAttributes", attrs.length); bound("maxAttributesPerElement", attrs.length);
    const parent = stack.at(-1);
    let namespaces = parent?.namespaces ?? new Map([["xml", "http://www.w3.org/XML/1998/namespace"]]);
    const bindings = Object.entries(tag.ns);
    if (bindings.length) {
      namespaces = new Map(namespaces);
      for (const [name, uri] of bindings) namespaces.set(name, uri);
      bound("maxNamespaces", namespaces.size);
    }
    for (const attr of attrs) charge("maxTextLength", attr.value.length);
    const name = { name: tag.name, namespace: tag.uri, localName: tag.local };
    limits.onElement?.(name, parent?.element, stack.length + 1);
    charge("maxContentNodes", 1 + (retain ? attrs.length : 0));
    const element: XmlElement = { kind: "element", ...name, children: [], content: [], text: "",
      attributes: retain ? attrs.map(attr => ({ name: attr.name, localName: attr.local, namespace: attr.uri, value: attr.value })) : [],
      namespaces: retain ? namespaces : emptyNamespaces,
      ...(!root && retain ? { prolog, epilog, ...(declaration === undefined ? {} : { declaration }) } : {}) };
    if (parent) {
      parent.element.children.push(element);
      if (retain) (parent.element.content as XmlContent[]).push(element);
    } else root = element;
    stack.push({ element, namespaces });
  });
  parser.on("closetag", () => { stack.pop(); });
  function append(content: Exclude<XmlContent, XmlElement>) {
    charge("maxTextLength", content.text.length);
    charge("maxContentNodes");
    const parent = stack.at(-1)?.element;
    if (parent && (content.kind === "text" || content.kind === "cdata")) parent.text += content.text;
    if (retain) (parent ? parent.content as XmlContent[] : root ? epilog : prolog).push(content);
  }
  parser.on("text", text => { if (text.length) append({ kind: "text", text }); });
  parser.on("cdata", text => append({ kind: "cdata", text }));
  parser.on("comment", text => append({ kind: "comment", text }));
  parser.on("processinginstruction", value => append({ kind: "processing-instruction", target: value.target, text: value.body }));
  let cr = false, first = true;
  function write(text: string) {
    if (!text) return;
    if (first) { first = false; if (text.charCodeAt(0) === 0xfeff) { parser.write(text[0]!); text = text.slice(1); } }
    if (cr) { if (text.startsWith("\n")) text = text.slice(1); cr = false; }
    cr = text.endsWith("\r");
    text = text.replaceAll("\r\n", "\n").replaceAll("\r", "\n");
    if (capturing) {
      prefix += text;
      if (prefix.length >= 6 && !(prefix.startsWith("<?xml") && " \t\n".includes(prefix[5]!))) { prefix = ""; capturing = false; }
    }
    parser.write(text);
  }
  await checkpoint?.(0);
  for await (const text of source) {
    if (typeof text !== "string") throw new TypeError("XML producer must yield strings");
    for (let i = 0; i < text.length; i += 512) {
      await checkpoint?.(0);
      write(text.slice(i, i + 512));
      await checkpoint?.(Math.min(512, text.length - i));
    }
  }
  await checkpoint?.(0);
  parser.close();
  if (!root) throw new SyntaxError("Invalid XML: incomplete document");
  return root;
}

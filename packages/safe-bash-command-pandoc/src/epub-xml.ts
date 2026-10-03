import { SaxesParser } from "saxes";
import { defaultTreeAdapter as tree, html, type DefaultTreeAdapterTypes as H } from "parse5";
import { PandocError } from "./errors.js";
import type { AdapterContext } from "./types.js";

export const namespaces = {
  container: "urn:oasis:names:tc:opendocument:xmlns:container",
  opf: "http://www.idpf.org/2007/opf",
  dc: "http://purl.org/dc/elements/1.1/",
  xhtml: "http://www.w3.org/1999/xhtml",
  epub: "http://www.idpf.org/2007/ops",
  ncx: "http://www.daisy.org/z3986/2005/ncx/"
};
export interface XmlElement {
  name: string;
  uri: string;
  attrs: {name: string; uri: string; value: string}[];
  children: (XmlElement | string)[];
}
export function attribute(node: XmlElement, name: string, uri = ""): string {
  return node.attrs.find(a => a.name === name && a.uri === uri)?.value ?? "";
}
export function children(node: XmlElement, name: string, uri = node.uri): XmlElement[] {
  return node.children.filter((n): n is XmlElement => typeof n !== "string" && n.name === name && n.uri === uri);
}
export function xmlText(node: XmlElement): string {
  return node.children.map(n => typeof n === "string" ? n : xmlText(n)).join("");
}
export function epubFailure(ctx: AdapterContext, part: string, message: string, code: "E_PARSE" | "E_LIMIT" = "E_PARSE"): never {
  throw new PandocError(code, ctx.operation ?? "read", message, "epub", part);
}

type XmlBytes = AsyncIterable<Uint8Array> | Iterable<Uint8Array>;

export async function parseEpubXml(bytes: Uint8Array | XmlBytes, part: string, ctx: AdapterContext): Promise<XmlElement> {
  const parser = new SaxesParser({xmlns: true});
  const stack: XmlElement[] = [];
  let root: XmlElement | undefined;
  parser.on("error", error => epubFailure(ctx, part, `Invalid EPUB XML: ${error.message}`));
  parser.on("doctype", () => epubFailure(ctx, part, "EPUB DTD and external entities are forbidden"));
  parser.on("xmldecl", decl => {
    if (decl.encoding && decl.encoding.toLowerCase() !== "utf-8") epubFailure(ctx, part, "Only UTF-8 EPUB XML is supported");
  });
  parser.on("opentag", tag => {
    ctx.checkpoint();
    ctx.bound("xmlDepth", stack.length + 1);
    ctx.charge("xmlNodes", 1);
    ctx.charge("attributes", Object.keys(tag.attributes).length);
    ctx.charge("retainedBytes", 128 + Object.keys(tag.attributes).length * 64);
    if (!(bytes instanceof Uint8Array)) ctx.charge("retainedBytes", 2 * (tag.local.length + tag.uri.length + Object.values(tag.attributes).reduce((sum, attr) => sum + attr.local.length + attr.uri.length + attr.value.length, 0)));
    const node: XmlElement = {name: tag.local, uri: tag.uri, attrs: Object.values(tag.attributes).map(a => ({name: a.local, uri: a.uri, value: a.value})), children: []};
    if (stack.length) stack.at(-1)!.children.push(node);
    else root = node;
    stack.push(node);
  });
  parser.on("closetag", () => {stack.pop();});
  const append = (value: string) => {
    ctx.charge("xmlNodes", 1);
    ctx.charge("retainedBytes", value.length * 2);
    if (stack.length) stack.at(-1)!.children.push(value);
  };
  parser.on("text", append);
  parser.on("cdata", append);
  if (bytes instanceof Uint8Array) {
    const text = await ctx.decodeUtf8([bytes]);
    for (let i = 0; i < text.length; i += 256) {
      parser.write(text.slice(i, i + 256));
      await ctx.cooperate(256);
    }
  } else {
    // Avoid separate full-source byte/text copies. The tree and SAX token
    // buffers remain resident. Consume each chunk before requesting the next.
    ctx.charge("retainedBytes", 8192);
    const decoder = new TextDecoder("utf-8", {fatal: true});
    const decode = (chunk?: Uint8Array): string => {
      try {return chunk === undefined ? decoder.decode() : decoder.decode(chunk, {stream: true});}
      catch {throw new PandocError("E_ENCODING", ctx.operation ?? "read", "Invalid or incomplete UTF-8 sequence");}
    };
    let cr = false;
    const write = (text: string) => {
      ctx.charge("text", text.length);
      if (!text) return;
      if (cr) {
        parser.write("\n");
        if (text.startsWith("\n")) text = text.slice(1);
      }
      cr = text.endsWith("\r");
      if (cr) text = text.slice(0, -1);
      parser.write(text.replaceAll("\r\n", "\n").replaceAll("\r", "\n"));
    };
    const iterator = Symbol.asyncIterator in bytes ? bytes[Symbol.asyncIterator]() : bytes[Symbol.iterator]();
    let done = false;
    const cleanup = async () => {if (!done) {done = true; await iterator.return?.();}};
    const release = ctx.onClose?.(cleanup);
    let failure: {reason: unknown} | undefined;
    try {
      while (!done) {
        ctx.checkpoint();
        const next = await iterator.next();
        ctx.checkpoint();
        if (next.done) {done = true; break;}
        const chunk = next.value;
        if (!(chunk instanceof Uint8Array)) throw new PandocError("E_IO", ctx.operation ?? "read", "Producer must yield bytes");
        for (let offset = 0; offset < chunk.length; offset += 256) {
          const text = decode(chunk.subarray(offset, offset + 256));
          write(text);
          await ctx.cooperate(256);
        }
        await ctx.cooperate(0);
      }
      const text = decode();
      write(text);
      if (cr) parser.write("\n");
    } catch (reason) {failure = {reason}; throw reason;}
    finally {
      try {await cleanup().catch(reason => {if (!failure) throw reason;});}
      finally {release?.();}
    }
  }
  parser.close();
  if (!root) epubFailure(ctx, part, "Missing EPUB XML root");
  return root;
}

/** Namespace-checked XML becomes a tree directly; no HTML parser is involved. */
export function xhtmlTree(root: XmlElement, ctx: AdapterContext, part: string): H.Document {
  if (root.name !== "html" || root.uri !== namespaces.xhtml) epubFailure(ctx, part, "Expected XHTML html root");
  if (children(root, "body").length !== 1) epubFailure(ctx, part, "Expected exactly one XHTML body");
  const doc = tree.createDocument();
  function append(node: XmlElement | string, parent: H.ParentNode): void {
    ctx.checkpoint();
    if (typeof node === "string") {tree.insertText(parent, node); return;}
    if (node.uri !== namespaces.xhtml) {
      ctx.report({code: "W_RAW_CONTENT", operation: ctx.operation ?? "read", format: "epub", location: part, message: `Unsupported foreign XHTML media/namespace: ${node.uri}`});
      return;
    }
    const attrs = node.attrs.filter(a => {
      if (!a.uri || a.uri === namespaces.epub || a.uri === "http://www.w3.org/XML/1998/namespace") return true;
      if (a.uri !== "http://www.w3.org/2000/xmlns/") ctx.report({code: "W_RAW_CONTENT", operation: ctx.operation ?? "read", format: "epub", location: part, message: `Unsupported foreign XHTML attribute loss: ${a.uri}:${a.name}`});
      return false;
    });
    const mappedAttrs = attrs.map(a => ({name: a.uri === "http://www.w3.org/XML/1998/namespace" ? `xml:${a.name}` : a.uri === namespaces.epub ? `epub:${a.name}` : a.name, value: a.value}));
    const element = tree.createElement(node.name, html.NS.HTML, mappedAttrs);
    // The shared HTML mapper has no Attr slot for these containers/items.
    // Explicit empty anchors retain their XML IDs without changing list geometry.
    if (["html", "body", "ul", "ol", "li", "blockquote", "hr", "dl", "dt", "dd"].includes(node.name) && attribute(node, "id")) {
      const anchor = tree.createElement("span", html.NS.HTML, [{name: "id", value: attribute(node, "id")}]);
      if (["ul", "ol", "hr"].includes(node.name)) tree.appendChild(parent, anchor);
      else if (node.name !== "html" && node.name !== "body") tree.appendChild(element, anchor);
    }
    if (["abbr", "bdi", "bdo", "mark", "time", "label", "small", "big", "dfn", "kbd"].includes(node.name) && attrs.length) {
      const wrapper = tree.createElement("span", html.NS.HTML, mappedAttrs);
      tree.appendChild(parent, wrapper);
      tree.appendChild(wrapper, element);
    } else tree.appendChild(parent, element);
    let contentParent = element;
    if (node.name === "body" && attrs.length) {
      contentParent = tree.createElement("div", html.NS.HTML, mappedAttrs);
      tree.appendChild(element, contentParent);
    }
    if (node.name === "body" && attribute(root, "id")) tree.appendChild(contentParent, tree.createElement("span", html.NS.HTML, [{name: "id", value: attribute(root, "id")}]));
    for (const child of node.children) append(child, contentParent);
  }
  append(root, doc);
  return doc;
}

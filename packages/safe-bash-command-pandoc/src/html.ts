import {htmlColumnWidth} from "./html-column-width.js";
import {headingIdentifier} from "./heading-attributes.js";
import {
  Parser,
  html,
  serializeOuter,
  defaultTreeAdapter as tree,
  type DefaultTreeAdapterTypes as H,
  type TreeAdapter,
  type DefaultTreeAdapterMap,
  type Token
} from "parse5";
import type { Attr, Block, Inline, Row, ColSpec, TableBody, MetaValue } from "./ast-types.js";
import type { AdapterContext, ReaderCapability } from "./types.js";
import {PandocError} from "./errors.js";

const listStyles: Readonly<Record<string, "Decimal" | "LowerAlpha" | "UpperAlpha" | "LowerRoman" | "UpperRoman">> = {
  "1": "Decimal", a: "LowerAlpha", A: "UpperAlpha", i: "LowerRoman", I: "UpperRoman"
};

const empty: Attr = ["", [], []];
const dropped = new Set([
  "head",
  "script",
  "style",
  "iframe",
  "object",
  "embed",
  "template",
  "noscript",
  "svg",
  "base",
  "link",
  "meta",
  "input",
  "source",
  "track"
]);
const containers = new Set([
  "div",
  "main",
  "section",
  "aside",
  "header",
  "address",
  "form",
  "fieldset"
]);
const blocks = new Set([
  ...containers,
  "article",
  "footer",
  "nav",
  "details",
  "summary",
  "p",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "ul",
  "ol",
  "li",
  "blockquote",
  "pre",
  "hr",
  "figure",
  "figcaption",
  "table",
  "dl",
  "dt",
  "dd"
]);
const styles: Readonly<
  Record<string, "Emph" | "Strong" | "Underline" | "Strikeout" | "Superscript" | "Subscript">
> = {
  em: "Emph",
  i: "Emph",
  b: "Strong",
  strong: "Strong",
  u: "Underline",
  s: "Strikeout",
  del: "Strikeout",
  strike: "Strikeout",
  sup: "Superscript",
  sub: "Subscript"
};
const ws = (c: string) => c === " " || c === "\t" || c === "\n" || c === "\r" || c === "\f";
function words(text: string): string[] {
  const result: string[] = [];
  let word = "";
  for (const c of text) {
    if (ws(c)) {
      if (word) result.push(word);
      word = "";
    } else word += c;
  }
  if (word) result.push(word);
  return result;
}
function element(node: H.Node): node is H.Element {
  return "tagName" in node;
}
function value(node: H.Element, name: string): string {
  return node.attrs.find((a) => a.name === name)?.value ?? "";
}
function noteId(node: H.Element): string {
  return node.attrs.find(a => a.name === "id")?.value ?? value(node, "data-heading");
}
function attr(node: H.Element, omit: readonly string[] = []): Attr {
  return [
    value(node, "id") || (node.tagName === "a" ? value(node, "name") : ""),
    [...(["section", "aside", "header"].includes(node.tagName) ? [node.tagName] : []), ...words(value(node, "class"))],
    [...(node.tagName === "main" ? [["role", "main"] as [string, string]] : []), ...node.attrs
      .filter((a) => !a.name.startsWith("on") && !["id", "class", ...omit].includes(a.name))
      .map((a): [string, string] => [a.prefix ? `${a.prefix}:${a.name}` : a.name, a.value])]
  ];
}
function directionAttr(node: H.Element): Attr {
  return ["", [], attr(node)[2].filter(([name]) => name === "dir" || name === "style")];
}
function directionBlocks(node: H.Element, blocks: Block[]): Block[] {
  const attributes = directionAttr(node);
  return attributes[2].length ? [{t: "Div", c: [attributes, blocks]}] : blocks;
}
function listNumber(text: string, fallback: number): number {
  const result = /^[+-]?[0-9]+$/.test(text) ? Number(text) : NaN;
  return Number.isSafeInteger(result) ? result : fallback;
}
function number(text: string, fallback: number, max = 65534): number {
  if (!text || [...text].some((c) => c < "0" || c > "9")) return fallback;
  const n = Number(text);
  return Number.isSafeInteger(n) ? Math.min(n, max) : fallback;
}

export interface HtmlImageSource { readonly source: string; readonly start: number; readonly end: number }

async function parse(text: string, ctx: AdapterContext, images?: HtmlImageSource[]): Promise<H.Document> {
  // Conservative source accounting also covers discarded/raw text and duplicate attrs.
  ctx.charge("text", text.length);
  ctx.charge("retainedBytes", text.length * 4);
  for (let i = 0; i < text.length; i++) {
    ctx.checkpoint();
    if (text[i] === "&") {
      ctx.charge("entities", 1);
      ctx.charge("entityBytes", 8);
    }
    if (i % 256 === 0) await ctx.cooperate(0);
  }
  const allocate = (size = 0) => {
    ctx.checkpoint();
    ctx.charge("nodes", 1);
    ctx.charge("retainedBytes", 128 + size * 2);
  };
  const attach = (parent: H.ParentNode) => {
    let depth = 1;
    let node: H.Node | null = parent;
    while (node) {
      ctx.checkpoint();
      ctx.bound("depth", depth++);
      node = "parentNode" in node ? node.parentNode : null;
    }
  };
  const adapter: TreeAdapter<DefaultTreeAdapterMap> = {
    ...tree,
    createDocument() {
      allocate();
      return tree.createDocument();
    },
    createDocumentFragment() {
      allocate();
      return tree.createDocumentFragment();
    },
    createElement(name, namespace, attrs) {
      allocate(name.length);
      ctx.charge("attributes", attrs.length);
      for (const a of attrs) ctx.charge("retainedBytes", 64 + (a.name.length + a.value.length) * 2);
      if (name === "td" || name === "th") ctx.charge("tableCells", 1);
      return tree.createElement(name, namespace, attrs);
    },
    createCommentNode(data) {
      allocate(data.length);
      return tree.createCommentNode(data);
    },
    appendChild(parent, child) {
      attach(parent);
      tree.appendChild(parent, child);
    },
    insertBefore(parent, child, reference) {
      attach(parent);
      tree.insertBefore(parent, child, reference);
    },
    insertText(parent, text) {
      allocate(text.length);
      tree.insertText(parent, text);
    },
    insertTextBefore(parent, text, reference) {
      allocate(text.length);
      tree.insertTextBefore(parent, text, reference);
    },
    adoptAttributes(node, attrs) {
      ctx.checkpoint(attrs.length);
      ctx.charge("attributes", attrs.length);
      tree.adoptAttributes(node, attrs);
    }
  };
  class BoundedParser extends Parser<DefaultTreeAdapterMap> {
    override _insertFakeElement(tagName: string, tagID: html.TAG_ID): void {
      super._insertFakeElement(tagName, tagID);
      // Generated TBODY differs from an authored row group for header inference.
      if (tagName === "tbody") this.openElements.current!.sourceCodeLocation = null;
    }
    override onItemPush(node: H.ParentNode, tid: number, isTop: boolean): void {
      ctx.checkpoint();
      ctx.bound("depth", this.openElements.stackTop + 1);
      super.onItemPush(node, tid, isTop);
    }
    override onStartTag(token: Token.TagToken): void {
      ctx.checkpoint(this.openElements.stackTop + 2);
      if (images && token.tagName === "img") {
        const source = token.attrs.find(attribute => attribute.name === "src")?.value;
        const location = token.location?.attrs?.src;
        if (source !== undefined && location) {
          ctx.charge("references", 1);
          ctx.charge("retainedBytes", 32 + source.length * 2);
          images.push({source, start: location.startOffset, end: location.endOffset});
        }
      }
      super.onStartTag(token);
    }
    override onEndTag(token: Token.TagToken): void {
      ctx.checkpoint(this.openElements.stackTop + 2);
      super.onEndTag(token);
    }
  }
  const parser = new BoundedParser({ treeAdapter: adapter, scriptingEnabled: false, sourceCodeLocationInfo: images !== undefined });
  for (let i = 0; i < text.length; i += 256) {
    parser.tokenizer.write(text.slice(i, i + 256), false);
    ctx.bound("depth", parser.openElements.stackTop + 1);
    await ctx.cooperate(0);
  }
  parser.tokenizer.write("", true);
  return parser.document;
}

/** Discover authored image targets without serializing split raw HTML fragments. */
export async function htmlImageSources(text: string, ctx: AdapterContext): Promise<HtmlImageSource[]> {
  const images: HtmlImageSource[] = [];
  const document = await parse(text, ctx, images);
  // Keep authored spans (including split raw fragments), but do not acquire
  // images in backlinks that the semantic note renderer removes.
  const ignored = new Set<number>();
  const pending: {node: H.Node; note: boolean; backlink: boolean}[] = [{node: document, note: false, backlink: false}];
  while (pending.length) {
    await ctx.cooperate();
    const {node, note, backlink} = pending.pop()!;
    let inNote = note, inBacklink = backlink;
    if (element(node)) {
      const parent = node.parentNode;
      const section = parent && element(parent) ? parent.parentNode : null;
      inNote ||= node.tagName === "li" && !!noteId(node) && !!parent && element(parent) && parent.tagName === "ol" && !!section && element(section) && value(section, "role") === "doc-endnotes";
      inBacklink ||= note && value(node, "role") === "doc-backlink";
      const location = node.sourceCodeLocation?.attrs?.src;
      if (inBacklink && node.tagName === "img" && location) ignored.add(location.startOffset);
      if (node.tagName === "template") pending.push({node: tree.getTemplateContent(node as H.Template), note: inNote, backlink: inBacklink});
    }
    if ("childNodes" in node) for (const child of node.childNodes) pending.push({node: child, note: inNote, backlink: inBacklink});
  }
  return images.filter(image => !ignored.has(image.start));
}

export const htmlReader: ReaderCapability = {
  format: "html",
  async read(input, ctx) {
    return htmlTreeDocument(await parse(input.text ?? (await ctx.decodeUtf8([input.bytes])), ctx), ctx, true);
  }
};

/** Native Markdown divs use the same bounded HTML parser and attribute mapping. */
export async function nativeDivBlocks(text: string, ctx: AdapterContext): Promise<Block[] | undefined> {
  const opening = text.trimStart().slice(0, 5).toLowerCase();
  if (!opening.startsWith("<div") || ![">", " ", "\t", "\n", "\r", "/"].includes(opening[4] ?? "")) return;
  const blocks = (await htmlTreeDocument(await parse(text, ctx), ctx)).blocks;
  // An unterminated quoted opening tag can consume the entire HTML input.
  // Keep that source as a raw block rather than accepting an empty conversion.
  return blocks.length ? blocks : undefined;
}

/** Map an already parsed tree without invoking HTML tokenization or recovery. */
export async function htmlTreeDocument(tree: H.Document, ctx: AdapterContext, footnotes = false) {
    // EPUB resolves references across chapters, and Markdown divs are fragments.
    // Only the complete HTML reader can resolve a document's local note roles.
    const notes = new Map<string, H.Element>();
    const references = new Map<H.Element, string>();
    const activeNotes = new Set<string>();
    const noteError = (message: string): never => {throw new PandocError("E_PARSE", "read", message, "html");};
    if (footnotes) {
      const pending: {node: H.Node; owner: H.Element | undefined; endnotes: H.Element | undefined}[] = [{node: tree, owner: undefined, endnotes: undefined}];
      const refs: {node: H.Element; owner: H.Element | undefined}[] = [];
      while (pending.length) {
        await ctx.cooperate();
        const {node, owner, endnotes} = pending.pop()!;
        if (!element(node)) {
          if (endnotes && !owner && node.nodeName === "#text" && (node as H.TextNode).value.trim()) noteError("Malformed HTML footnote definition list");
          if ("childNodes" in node) for (const child of node.childNodes) pending.push({node: child, owner, endnotes});
          continue;
        }
        if (dropped.has(node.tagName) && node.tagName !== "svg") continue;
        const role = value(node, "role");
        if (owner && role === "doc-backlink") continue;
        if (role === "doc-noteref" || role === "doc-endnotes") {
          for (let parent: H.Node | null = node; parent; parent = "parentNode" in parent ? parent.parentNode : null) {
            ctx.checkpoint();
            if (element(parent) && ["pre", "code", "tt", "samp", "var", "kbd", "math", "svg"].includes(parent.tagName)) noteError("HTML footnote markup inside literal content is unsupported");
          }
        }
        let definition = owner, section = endnotes;
        if (endnotes && !owner) {
          if (node.parentNode === endnotes) {
            if (node.tagName === "hr") continue;
            if (node.tagName !== "ol") noteError("HTML footnote definitions require an ordered list");
          } else {
            const id = noteId(node);
            if (node.tagName !== "li" || !id) noteError("HTML footnote definitions require list items with IDs");
            if (notes.has(id)) noteError(`Duplicate HTML footnote definition: ${id}`);
            ctx.charge("references", 1); ctx.charge("retainedBytes", 64 + id.length * 2);
            notes.set(id, node); definition = node;
          }
        }
        if (role === "doc-endnotes") {
          if (endnotes) noteError("Nested HTML footnote definitions are not supported");
          section = node;
        } else if (role === "doc-noteref") {
          if (node.tagName !== "a" || !value(node, "href").startsWith("#")) noteError("HTML footnote reference requires a local fragment target");
          ctx.charge("references", 1); ctx.charge("retainedBytes", 64);
          refs.push({node, owner: definition});
        }
        for (const child of node.childNodes) pending.push({node: child, owner: definition, endnotes: section});
      }
      const reached = new Set<string>(), edges = new Map<string, string[]>();
      for (const {node, owner} of refs) {
        let id = value(node, "href").slice(1);
        if (!notes.has(id) && id.includes("%")) {
          // Match the shared Rust fragment resolver: exact IDs win, decode once,
          // replace invalid UTF-8, and preserve malformed escapes, BOM and '+'.
          ctx.charge("retainedBytes", id.length * 5);
          const bytes = new TextEncoder().encode(id);
          const hex = (byte: number) => byte >= 48 && byte <= 57 ? byte - 48 : byte >= 65 && byte <= 70 ? byte - 55 : byte >= 97 && byte <= 102 ? byte - 87 : -1;
          let length = 0;
          for (let i = 0; i < bytes.length; i++) {
            ctx.checkpoint();
            const high = hex(bytes[i + 1] ?? 0), low = hex(bytes[i + 2] ?? 0);
            if (bytes[i] === 37 && high >= 0 && low >= 0) {bytes[length++] = high * 16 + low; i += 2;}
            else bytes[length++] = bytes[i]!;
          }
          id = new TextDecoder("utf-8", {ignoreBOM: true}).decode(bytes.subarray(0, length));
        }
        if (!notes.has(id)) noteError(`Missing HTML footnote target: ${id}`);
        references.set(node, id); reached.add(id);
        if (owner) {const source = noteId(owner), targets = edges.get(source) ?? []; targets.push(id); edges.set(source, targets);}
      }
      const complete = new Set<string>(), active = new Set<string>();
      for (const id of notes.keys()) {
        if (!reached.has(id)) noteError(`Unreferenced HTML footnote definition: ${id}`);
        const pending: [string, boolean][] = [[id, false]];
        while (pending.length) {
          await ctx.cooperate();
          const [id, closing] = pending.pop()!;
          if (closing) {active.delete(id); complete.add(id);}
          else if (!complete.has(id)) {
            if (active.has(id)) noteError(`Circular HTML footnote reference: ${id}`);
            active.add(id); pending.push([id, true]);
            for (const target of edges.get(id) ?? []) pending.push([target, false]);
          }
        }
      }
      // Count repeated note bodies before materializing their expanded AST.
      const expanded: {node: H.Node; depth: number; note: boolean}[] = refs.length ? [{node: tree, depth: 0, note: false}] : [];
      while (expanded.length) {
        await ctx.cooperate();
        const {node, depth, note} = expanded.pop()!;
        ctx.bound("depth", depth);
        if (note) {
          ctx.charge("nodes", 1);
          ctx.charge("retainedBytes", 128 + (node.nodeName === "#text" ? (node as H.TextNode).value.length * 2 : element(node) ? node.attrs.reduce((size, attr) => size + 64 + (attr.name.length + attr.value.length) * 2, 0) : 0));
        }
        if (element(node)) {
          if (dropped.has(node.tagName) || value(node, "role") === "doc-endnotes" || note && value(node, "role") === "doc-backlink") continue;
          const id = references.get(node);
          if (id !== undefined) {
            for (const child of notes.get(id)!.childNodes) expanded.push({node: child, depth: depth + 1, note: true});
            continue;
          }
        }
        if ("childNodes" in node) for (const child of node.childNodes) expanded.push({node: child, depth: depth + 1, note});
      }
    }
    const identifiers = new Set<string>();
    const anchor = (id: string): Inline => ({t: "Span", c: [[id, [], []], []]});
    const noteAnchors = (node: H.Element) => [node, ...node.childNodes.filter(element)].map(noteId).filter(Boolean).map(anchor);
    async function note(node: H.Element, id: string): Promise<Inline[]> {
      const definition = notes.get(id)!;
      activeNotes.add(id); ctx.bound("depth", activeNotes.size);
      let body: Block[];
      try {body = await flow(definition.childNodes);} finally {activeNotes.delete(id);}
      body = [{t: "Div", c: [[id, [], []], body]}];
      for (let ancestor: H.Node | null = definition; ancestor; ancestor = "parentNode" in ancestor ? ancestor.parentNode : null) {
        await ctx.cooperate();
        if (element(ancestor)) {
          const pairs: [string, string][] = ancestor.attrs.filter(attribute => ["dir", "style", "align"].includes(attribute.name)).map(attribute => [attribute.name, attribute.value]);
          const emphasis = ["strong", "b", "summary"].includes(ancestor.tagName) ? "font-weight:bold" : ["em", "i"].includes(ancestor.tagName) ? "font-style:italic" : "";
          if (emphasis) {
            const style = pairs.find(([name]) => name === "style");
            if (style) style[1] = `${emphasis};${style[1]}`;
            else pairs.push(["style", emphasis]);
          }
          for (const [, value] of pairs) {
            ctx.charge("nodes", 1); ctx.charge("retainedBytes", 128 + value.length * 2);
          }
          if (pairs.length) body = [{t: "Div", c: [["", [], pairs], body]}];
        }
      }
      const marker = value(node, "id");
      const reference: Inline = {t: "Note", c: body};
      return marker ? [{t: "Span", c: [[marker, [], []], [reference]]}] : [reference];
    }
    async function literal(node: H.Node): Promise<string> {
      await ctx.cooperate();
      if (node.nodeName === "#text") return (node as H.TextNode).value;
      if (element(node) && dropped.has(node.tagName)) return "";
      let result = "";
      if ("childNodes" in node) for (const child of node.childNodes) result += await literal(child);
      return result;
    }
    async function math(node: H.Node): Promise<string> {
      await ctx.cooperate();
      const escape = (text: string) => Array.from(text, c =>
        "\\{}#$%&_".includes(c) ? `\\${c}` : c === "^" ? "\\hat{}" : c === "~" ? "\\sim" : c
      ).join("");
      if (!element(node)) return node.nodeName === "#text" ? escape((node as H.TextNode).value.trim()) : "";
      const tag = node.tagName;
      if (dropped.has(tag) || tag === "annotation" || tag === "annotation-xml") return "";
      if (["mi", "mn", "mo", "mtext", "ms"].includes(tag)) {
        const text = escape((await literal(node)).trim());
        return tag === "mtext" || tag === "ms" ? `\\text{${text}}` : text;
      }
      const children: string[] = [];
      for (const child of node.childNodes) {
        // Formatting whitespace between MathML elements has no mathematical meaning.
        if (child.nodeName === "#text" && !(child as H.TextNode).value.trim()) continue;
        children.push(await math(child));
      }
      const [first = "", second = "", third = ""] = children;
      const base = first.length === 1 ? first : `{${first}}`;
      let result: string;
      if (tag === "mfrac" && children.length === 2) result = `\\frac{${first}}{${second}}`;
      else if (tag === "msqrt") result = `\\sqrt{${children.join(" ")}}`;
      else if (tag === "mroot" && children.length === 2) result = `\\sqrt[${second}]{${first}}`;
      else if (tag === "msup" && children.length === 2) result = `${base}^{${second}}`;
      else if (tag === "msub" && children.length === 2) result = `${base}_{${second}}`;
      else if (tag === "msubsup" && children.length === 3) result = `${base}_{${second}}^{${third}}`;
      else result = children.filter(Boolean).join(" ");
      ctx.charge("retainedBytes", result.length * 2);
      return result;
    }
    async function inlines(nodes: readonly H.ChildNode[]): Promise<Inline[]> {
      const result: Inline[] = [];
      const text = (s: string) => {
        let word = "";
        const flush = () => {
          if (word) {
            const last = result.at(-1);
            if (last?.t === "Str") result[result.length - 1] = { t: "Str", c: last.c + word };
            else result.push({ t: "Str", c: word });
            word = "";
          }
        };
        for (const c of s) {
          if (ws(c)) {
            flush();
            if (result.at(-1)?.t !== "Space") result.push({ t: "Space" });
          } else word += c;
        }
        flush();
      };
      for (const node of nodes) {
        await ctx.cooperate();
        if (!element(node)) {
          if (node.nodeName === "#text") text((node as H.TextNode).value);
          continue;
        }
        const tag = node.tagName;
        if (footnotes && value(node, "role") === "doc-endnotes") {result.push(...noteAnchors(node)); continue;}
        if (footnotes && value(node, "role") === "doc-backlink" && activeNotes.size) continue;
        const target = references.get(node);
        if (target !== undefined) {result.push(...await note(node, target)); continue;}
        if (tag === "svg") {
          const markup = serializeOuter(node);
          // Account for serialized text, UTF-8 bytes, binary text and base64 output.
          ctx.charge("retainedBytes", markup.length * 16 + 64);
          const bytes = new TextEncoder().encode(markup);
          let binary = "";
          for (let i = 0; i < bytes.length; i += 4096) {
            await ctx.cooperate(4096);
            binary += String.fromCharCode(...bytes.subarray(i, i + 4096));
          }
          result.push({ t: "Image", c: [empty, [], [`data:image/svg+xml;base64,${btoa(binary)}`, ""]] });
          continue;
        }
        if (dropped.has(tag)) continue;
        if (tag === "math") {
          result.push({t: "Math", c: [value(node, "display") === "block" ? "DisplayMath" : "InlineMath", await math(node)]});
          continue;
        }
        if (tag === "br") {
          result.push({ t: "LineBreak" });
          continue;
        }
        if (["code", "tt", "samp", "var"].includes(tag)) {
          result.push({ t: "Code", c: [attr(node), await literal(node)] });
          continue;
        }
        if (tag === "img") {
          result.push({
            t: "Image",
            c: [
              (() => {
                const [id, classes, attributes] = attr(node, ["src", "alt", "title"]);
                return [id, classes, attributes.map(([name, value]) =>
                  (name === "width" || name === "height") && value.trim() && Number.isFinite(Number(value)) && Number(value) > 0 ? [name, `${value}px`] : [name, value])];
              })(),
              await inlines([{ nodeName: "#text", value: value(node, "alt"), parentNode: null }]),
              [value(node, "src"), value(node, "title")]
            ]
          });
          continue;
        }
        const children = await inlines(node.childNodes);
        const style = Object.hasOwn(styles, tag) ? styles[tag] : undefined;
        if (style) {
          const styled: Inline = { t: style, c: children };
          const attributes = attr(node);
          result.push(
            attributes[0] || attributes[1].length || attributes[2].length
              ? { t: "Span", c: [attributes, [styled]] }
              : styled
          );
        } else if (tag === "a" && node.attrs.some((a) => a.name === "href"))
          result.push({
            t: "Link",
            c: [
              attr(node, ["href", "title"]),
              children,
              [value(node, "href"), value(node, "title")]
            ]
          });
        else if (tag === "span" || tag === "a" || tag === "mark" || tag === "bdi" || tag === "bdo" || directionAttr(node)[2].length) {
          let attributes = attr(node);
          if (tag === "bdi" || tag === "bdo") {
            let pairs = [...attributes[2]];
            if (!pairs.some(([name]) => name === "dir")) pairs.push(["dir", "auto"]);
            if (tag === "bdo") {
              if (pairs.some(([name]) => name === "style")) pairs = pairs.map(([name, value]) => [name, name === "style" ? value + ";unicode-bidi:isolate-override" : value]);
              else pairs.push(["style", "unicode-bidi:isolate-override"]);
            }
            attributes = [attributes[0], attributes[1], pairs];
          }
          result.push({ t: "Span", c: [tag === "mark" ? [attributes[0], ["mark", ...attributes[1]], attributes[2]] : attributes, children] });
        }
        else {
          for (const child of children) {
            if (child.t === "Str") text(child.c);
            else if (child.t !== "Space" || result.at(-1)?.t !== "Space") result.push(child);
          }
        }
      }
      return result;
    }
    async function flow(nodes: readonly H.ChildNode[]): Promise<Block[]> {
      const result: Block[] = [];
      let pending: H.ChildNode[] = [];
      const flush = async () => {
        const c = await inlines(pending);
        pending = [];
        while (c[0]?.t === "Space") c.shift();
        while (c.at(-1)?.t === "Space") c.pop();
        if (c.length) result.push({ t: "Plain", c });
      };
      for (const node of nodes) {
        await ctx.cooperate();
        if (element(node) && footnotes && value(node, "role") === "doc-endnotes") {
          await flush();
          const anchors = noteAnchors(node);
          if (anchors.length) result.push({t: "Plain", c: anchors});
          continue;
        }
        if (!element(node) || !blocks.has(node.tagName)) {
          pending.push(node);
          continue;
        }
        await flush();
        const tag = node.tagName;
        const firstBlock = result.length;
        const inlineContent = async () => {
          const c = await inlines(node.childNodes);
          while (c[0]?.t === "Space") c.shift();
          while (c.at(-1)?.t === "Space") c.pop();
          return c;
        };
        if (["details", "article", "footer", "nav"].includes(tag)) {
          for (const block of await flow(node.childNodes)) result.push(block);
        } else if (tag === "summary") {
          result.push({ t: "Para", c: await inlineContent() });
        } else if (tag === "p") {
          const paragraph: Block = { t: "Para", c: await inlineContent() };
          const attributes = attr(node);
          result.push(
            attributes[0] || attributes[1].length || attributes[2].length
              ? { t: "Div", c: [attributes, [paragraph]] }
              : paragraph
          );
        } else if (["h1", "h2", "h3", "h4", "h5", "h6"].includes(tag)) {
          const content = await inlineContent();
          let attributes = attr(node);
          if (!attributes[0]) {
            const base = headingIdentifier(content, ctx);
            let id = base;
            for (let suffix = 1; identifiers.has(id); suffix++) {ctx.checkpoint(); id = `${base}-${suffix}`;}
            ctx.charge("retainedBytes", id.length * 2);
            attributes = [id, attributes[1], attributes[2]];
          }
          identifiers.add(attributes[0]);
          result.push({ t: "Header", c: [Number(tag[1]), attributes, content] });
        } else if (containers.has(tag))
          result.push({ t: "Div", c: [attr(node), await flow(node.childNodes)] });
        else if (tag === "hr") result.push({ t: "HorizontalRule" });
        else if (tag === "blockquote")
          result.push({ t: "BlockQuote", c: await flow(node.childNodes) });
        else if (tag === "pre") {
          const code = node.childNodes.find((n) => element(n) && n.tagName === "code");
          const preAttr = attr(node);
          const codeAttr = code && element(code) ? attr(code) : empty;
          const attributes: Attr = [
            preAttr[0] || codeAttr[0],
            [...new Set([...preAttr[1], ...codeAttr[1]].map(name => name.startsWith("language-") ? name.slice(9) : name))],
            [...preAttr[2], ...codeAttr[2].filter(([key]) => !preAttr[2].some(([k]) => k === key))]
          ];
          result.push({ t: "CodeBlock", c: [attributes, await literal(node)] });
        } else if (tag === "ul" || tag === "ol") {
          const children = node.childNodes.filter((child): child is H.Element => element(child) && child.tagName === "li");
          const reversed = tag === "ol" && node.attrs.some(attribute => attribute.name === "reversed");
          const style = Object.hasOwn(listStyles, value(node, "type")) ? listStyles[value(node, "type")]! : "DefaultStyle";
          let next = listNumber(value(node, "start"), reversed ? children.length : 1), start = next;
          let items: Block[][] = [];
          const flush = () => {result.push({t: "OrderedList", c: [[start, style, "DefaultDelim"], items]}); items = [];};
          for (const child of children) {
            const blocks = await flow(child.childNodes), id = value(child, "id"), first = blocks[0];
            const existing = first?.t === "Para" || first?.t === "Plain" ? first.c[0] : undefined;
            if (id && !(existing?.t === "Span" && existing.c[0][0] === id)) {
              const anchor: Inline = {t: "Span", c: [[id, [], []], []]};
              if (first?.t === "Para" || first?.t === "Plain") blocks[0] = {...first, c: [anchor, ...first.c]};
              else blocks.unshift({t: "Plain", c: [anchor]});
            }
            if (tag === "ol") {
              const marker = listNumber(value(child, "value"), next);
              if (items.length && (reversed || marker !== next)) flush();
              if (!items.length) start = marker;
              next = marker + (reversed ? -1 : 1);
            }
            items.push(directionBlocks(child, blocks));
          }
          if (tag === "ul") result.push({t: "BulletList", c: items});
          else flush();
        } else if (tag === "dl") {
          const items: [Inline[], Block[][]][] = [];
          let term: Inline[] = [], definitions: Block[][] = [], started = false;
          for (const child of node.childNodes) {
            if (!element(child)) continue;
            if (child.tagName === "dt") {
              if (definitions.length) {items.push([term, definitions]); term = []; definitions = []; started = false;}
              const content = await inlines(child.childNodes);
              while (content[0]?.t === "Space") content.shift();
              while (content.at(-1)?.t === "Space") content.pop();
              if (started) term.push({t: "LineBreak"});
              const attributes = directionAttr(child);
              term.push(...(attributes[2].length ? [{t: "Span" as const, c: [attributes, content] as [Attr, Inline[]]}] : content)); started = true;
            } else if (child.tagName === "dd") definitions.push(directionBlocks(child, await flow(child.childNodes)));
          }
          if (started || definitions.length) items.push([term, definitions]);
          result.push({t: "DefinitionList", c: items});
        } else if (tag === "figure") {
          const caption = node.childNodes.find((n) => element(n) && n.tagName === "figcaption");
          result.push({
            t: "Figure",
            c: [
              attr(node),
              [null, caption && element(caption) ? directionBlocks(caption, await flow(caption.childNodes)) : []],
              await flow(node.childNodes.filter((n) => n !== caption))
            ]
          });
        } else if (tag === "table") result.push(...await table(node));
        else result.push(...(await flow(node.childNodes)));
        if (["details", "article", "footer", "nav", "summary", "hr", "blockquote", "ul", "ol", "dl", "li", "dt", "dd", "figcaption"].includes(tag) && directionAttr(node)[2].length) {
          const scoped = result.splice(firstBlock);
          result.push(...directionBlocks(node, scoped));
        }
      }
      await flush();
      return result;
    }
    async function table(node: H.Element): Promise<Block[]> {
      const heads: Row[] = [];
      const feet: Row[] = [];
      let headAttr = empty, footAttr = empty;
      const bodies: TableBody[] = [];
      let width = 0;
      let complexCells = false;
      let caption: Block[] = [];
      let pendingAnchors: Inline[] = [];
      let inferHead = !node.childNodes.some(child => element(child) && child.tagName === "thead");
      async function rows(nodes: readonly H.ChildNode[], group: "head" | "body" | "foot", inferred = false): Promise<[number, Row[], Row[]]> {
        const source = nodes.filter((row): row is H.Element => element(row) && row.tagName === "tr");
        const retainedRows = [0];
        for (const row of source) retainedRows.push(retainedRows.at(-1)! + Number(row.childNodes.some(cell => element(cell) && ["th", "td"].includes(cell.tagName))));
        const rowSpan = (cell: H.Element, index: number) => {
          const authored = number(value(cell, "rowspan"), 1);
          const span = Math.min(authored === 0 ? source.length - index : authored, source.length - index);
          return Math.max(1, retainedRows[index + span]! - retainedRows[index]!);
        };
        let headerCount = 0, reach = 0;
        if (group === "body") for (const [index, row] of source.entries()) {
          const cells = row.childNodes.filter((cell): cell is H.Element => element(cell) && ["th", "td"].includes(cell.tagName));
          if (!cells.length || cells.some(cell => cell.tagName !== "th") || inferred && index > 0) break;
          headerCount++;
          for (const cell of cells) reach = Math.max(reach, index + rowSpan(cell, index));
        }
        if (reach > headerCount) headerCount = 0;
        let rowHeads: number | undefined;
        if (group === "body") for (const [index, row] of source.entries()) {
          if (index < headerCount) continue;
          if (retainedRows[index] === retainedRows[index + 1]) continue;
          let prefix = 0, data = false, regular = true;
          for (const cell of row.childNodes) if (element(cell) && ["th", "td"].includes(cell.tagName)) {
            if (rowSpan(cell, index) > 1) regular = false;
            if (cell.tagName === "td") data = true;
            else if (data) regular = false;
            else prefix += number(value(cell, "colspan"), 1, 1000) || 1;
          }
          rowHeads = !regular || rowHeads !== undefined && rowHeads !== prefix ? 0 : prefix;
        }
        rowHeads ??= 0;
        const result: Row[] = [], intermediate: Row[] = [];
        const occupied: number[] = [];
        for (const [index, row] of source.entries()) {
          await ctx.cooperate();
          if (retainedRows[index] === retainedRows[index + 1]) {
            const id = value(row, "id");
            if (id) pendingAnchors.push({t: "Span", c: [[id, [], []], []]});
            continue;
          }
          const cells: Row[1][number][] = [];
          let column = 0, data = false;
          for (const cell of row.childNodes) if (element(cell) && ["td", "th"].includes(cell.tagName)) {
            while ((occupied[column] ?? 0) > 0) {column++; ctx.checkpoint();}
            const r = rowSpan(cell, index), c = number(value(cell, "colspan"), 1, 1000) || 1;
            ctx.bound("tableCells", column + c); ctx.charge("references", c);
            for (let i = 0; i < c; i++) occupied[column + i] = Math.max(occupied[column + i] ?? 0, r);
            const canonical = group === "head" || index < headerCount || column < rowHeads;
            let attributes = attr(cell, ["rowspan", "colspan", "align", ...(cell.tagName === "td" ? ["scope"] : [])]);
            if (cell.tagName === "th" && !canonical && !attributes[2].some(([key, value]) => key === "role" && ["rowheader", "columnheader"].includes(value.trim()) || key === "scope" && ["row", "col", "rowgroup", "colgroup"].includes(value.trim().toLowerCase()))) {
              const role = data ? "columnheader" : "rowheader";
              attributes = [attributes[0], attributes[1], attributes[2].some(([key]) => key === "role")
                ? [...attributes[2].filter(([key]) => key !== "scope"), ["scope", data ? "col" : "row"]]
                : [...attributes[2], ["role", role]]];
            }
            if (cell.tagName === "td") data = true;
            column += c;
            const content = await flow(cell.childNodes);
            if (!cells.length && pendingAnchors.length) {
              const first = content[0];
              if (first?.t === "Plain" || first?.t === "Para") content[0] = {...first, c: [...pendingAnchors, ...first.c]};
              else content.unshift({t: "Plain", c: pendingAnchors});
              pendingAnchors = [];
            }
            if (content.length > 1 || content.some(block => block.t !== "Plain" && block.t !== "Para")) complexCells = true;
            let alignment = value(cell, "align").toLowerCase();
            for (const declaration of value(cell, "style").split(";")) {
              const colon = declaration.indexOf(":");
              if (declaration.slice(0, colon).trim().toLowerCase() === "text-align") alignment = declaration.slice(colon + 1).trim().toLowerCase();
            }
            cells.push([attributes, alignment === "left" ? "AlignLeft" : alignment === "center" ? "AlignCenter" : alignment === "right" ? "AlignRight" : "AlignDefault", r, c, content]);
          }
          width = Math.max(width, column, occupied.length);
          for (let i = 0; i < occupied.length; i++) occupied[i] = Math.max(0, (occupied[i] ?? 0) - 1);
          (index < headerCount ? inferred ? heads : intermediate : result).push([attr(row), cells]);
        }
        return [rowHeads, intermediate, result];
      }
      for (const phase of ["head", "body", "foot"]) {
      for (const child of node.childNodes) if (element(child) && (child.tagName === "thead" ? phase === "head" : child.tagName === "tfoot" ? phase === "foot" : phase === "body")) {
        if (child.tagName === "caption") caption = directionBlocks(child, await flow(child.childNodes));
        else if (child.tagName === "thead") {headAttr = attr(child); heads.push(...(await rows(child.childNodes, "head"))[2]);}
        else if (child.tagName === "tfoot") {footAttr = attr(child); feet.push(...(await rows(child.childNodes, "foot"))[2]);}
        else if (child.tagName === "tbody") {
          bodies.push([attr(child), ...await rows(child.childNodes, "body", inferHead && child.sourceCodeLocation === null)]);
          inferHead = false;
        }
      }
      if (phase === "body" && node.childNodes.some(child => element(child) && child.tagName === "tr")) bodies.push([empty, ...await rows(node.childNodes, "body", inferHead)]);
      }
      const specs: ColSpec[] = Array.from({ length: width }, () => [
        "AlignDefault",
        { t: "ColWidthDefault" }
      ]);
      let column = 0;
      for (const group of node.childNodes) if (element(group) && group.tagName === "colgroup") {
        for (const col of group.childNodes) if (element(col) && col.tagName === "col" && column < width) {
          const columnWidth = await htmlColumnWidth(value(col, "width") ?? "", value(col, "style") ?? "");
          if (columnWidth !== undefined) specs[column] = ["AlignDefault", {t: "ColWidth", c: columnWidth}];
          column++;
        }
      }
      if (!column && complexCells) for (let i = 0; i < width; i++) specs[i] = ["AlignDefault", {t: "ColWidth", c: 1 / width}];
      return [{
        t: "Table",
        c: [attr(node), [null, caption], specs, [headAttr, heads], bodies, [footAttr, feet]]
      }, ...(pendingAnchors.length ? [{t: "Plain" as const, c: pendingAnchors}] : [])];
    }
    const html = tree.childNodes.find((n) => element(n) && n.tagName === "html");
    const body =
      html && element(html)
        ? html.childNodes.find((n) => element(n) && n.tagName === "body")
        : undefined;
    const language = html && element(html) ? value(html, "lang") || value(html, "xml:lang") : "";
    const dir = html && element(html) ? value(html, "dir") : "";
    const metadata: Record<string, MetaValue> = {};
    const head = html && element(html) ? html.childNodes.find(n => element(n) && n.tagName === "head") : undefined;
    if (head && element(head)) for (const node of head.childNodes) {
      await ctx.cooperate();
      if (!element(node)) continue;
      const key = node.tagName === "title" ? "title" : node.tagName === "meta" && value(node, "name").toLowerCase() === "author" ? "author" : undefined;
      if (!key) continue;
      const content = await inlines(key === "title" ? node.childNodes : [{nodeName: "#text", value: value(node, "content"), parentNode: null}]);
      while (content[0]?.t === "Space") content.shift();
      while (content.at(-1)?.t === "Space") content.pop();
      metadata[key] = {t: "MetaInlines", c: content};
    }
    let content = await flow(body && element(body) ? body.childNodes : []);
    if (body && element(body)) {
      const attributes = attr(body);
      if (attributes[0] || attributes[1].length || attributes[2].length) content = [{t: "Div", c: [attributes, content]}];
    }
    if (html && element(html) && html.attrs.some(a => a.name === "style" || a.name === "dir" && !["ltr", "rtl", "auto"].includes(dir))) content = directionBlocks(html, content);
    return {
      blocks: content,
      metadata,
      resources: [],
      ...(language ? { language } : {}),
      ...(["ltr", "rtl", "auto"].includes(dir) ? { direction: dir as "ltr" | "rtl" | "auto" } : {})
    };
}

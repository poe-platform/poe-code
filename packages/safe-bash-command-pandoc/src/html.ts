import {headingIdentifier} from "./heading-attributes.js";
import {
  Parser,
  serializeOuter,
  defaultTreeAdapter as tree,
  type DefaultTreeAdapterTypes as H,
  type TreeAdapter,
  type DefaultTreeAdapterMap,
  type Token
} from "parse5";
import type { Attr, Block, Inline, Row, ColSpec, TableBody, MetaValue } from "./ast-types.js";
import type { AdapterContext, ReaderCapability } from "./types.js";

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
function attr(node: H.Element, omit: readonly string[] = []): Attr {
  return [
    value(node, "id") || (node.tagName === "a" ? value(node, "name") : ""),
    [...(["section", "aside", "header"].includes(node.tagName) ? [node.tagName] : []), ...words(value(node, "class"))],
    [...(node.tagName === "main" ? [["role", "main"] as [string, string]] : []), ...node.attrs
      .filter((a) => !a.name.startsWith("on") && !["id", "class", ...omit].includes(a.name))
      .map((a): [string, string] => [a.prefix ? `${a.prefix}:${a.name}` : a.name, a.value])]
  ];
}
function number(text: string, fallback: number, max = 65534): number {
  if (!text || [...text].some((c) => c < "0" || c > "9")) return fallback;
  const n = Number(text);
  return Number.isSafeInteger(n) && n > 0 ? Math.min(n, max) : fallback;
}

async function parse(text: string, ctx: AdapterContext): Promise<H.Document> {
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
    override onItemPush(node: H.ParentNode, tid: number, isTop: boolean): void {
      ctx.checkpoint();
      ctx.bound("depth", this.openElements.stackTop + 1);
      super.onItemPush(node, tid, isTop);
    }
    override onStartTag(token: Token.TagToken): void {
      ctx.checkpoint(this.openElements.stackTop + 2);
      super.onStartTag(token);
    }
    override onEndTag(token: Token.TagToken): void {
      ctx.checkpoint(this.openElements.stackTop + 2);
      super.onEndTag(token);
    }
  }
  const parser = new BoundedParser({ treeAdapter: adapter, scriptingEnabled: false });
  for (let i = 0; i < text.length; i += 256) {
    parser.tokenizer.write(text.slice(i, i + 256), false);
    ctx.bound("depth", parser.openElements.stackTop + 1);
    await ctx.cooperate(0);
  }
  parser.tokenizer.write("", true);
  return parser.document;
}

export const htmlReader: ReaderCapability = {
  format: "html",
  async read(input, ctx) {
    return htmlTreeDocument(await parse(input.text ?? (await ctx.decodeUtf8([input.bytes])), ctx), ctx);
  }
};

/** Native Markdown divs use the same bounded HTML parser and attribute mapping. */
export async function nativeDivBlocks(text: string, ctx: AdapterContext): Promise<Block[] | undefined> {
  const opening = text.trimStart().slice(0, 5).toLowerCase();
  if (!opening.startsWith("<div") || ![">", " ", "\t", "\n", "\r", "/"].includes(opening[4] ?? "")) return;
  return (await htmlTreeDocument(await parse(text, ctx), ctx)).blocks;
}

/** Map an already parsed tree without invoking HTML tokenization or recovery. */
export async function htmlTreeDocument(tree: H.Document, ctx: AdapterContext) {
    const identifiers = new Set<string>();
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
              attr(node, ["src", "alt", "title"]),
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
        else if (tag === "span" || tag === "a" || tag === "mark") {
          const attributes = attr(node);
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
        if (!element(node) || !blocks.has(node.tagName)) {
          pending.push(node);
          continue;
        }
        await flush();
        const tag = node.tagName;
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
          const items: Block[][] = [];
          for (const child of node.childNodes)
            if (element(child) && child.tagName === "li") items.push(await flow(child.childNodes));
          result.push(
            tag === "ul"
              ? { t: "BulletList", c: items }
              : {
                  t: "OrderedList",
                  c: [[number(value(node, "start"), 1), (Object.hasOwn(listStyles, value(node, "type")) ? listStyles[value(node, "type")]! : "DefaultStyle"), "DefaultDelim"], items]
                }
          );
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
              term.push(...content); started = true;
            } else if (child.tagName === "dd") definitions.push(await flow(child.childNodes));
          }
          if (started || definitions.length) items.push([term, definitions]);
          result.push({t: "DefinitionList", c: items});
        } else if (tag === "figure") {
          const caption = node.childNodes.find((n) => element(n) && n.tagName === "figcaption");
          result.push({
            t: "Figure",
            c: [
              attr(node),
              [null, caption && element(caption) ? await flow(caption.childNodes) : []],
              await flow(node.childNodes.filter((n) => n !== caption))
            ]
          });
        } else if (tag === "table") result.push(await table(node));
        else result.push(...(await flow(node.childNodes)));
      }
      await flush();
      return result;
    }
    async function table(node: H.Element): Promise<Block> {
      const heads: Row[] = [];
      const feet: Row[] = [];
      const bodies: TableBody[] = [];
      let width = 0;
      let caption: Block[] = [];
      let inferHead = !node.childNodes.some(child => element(child) && child.tagName === "thead");
      async function rows(nodes: readonly H.ChildNode[], leadingHead = false): Promise<Row[]> {
        const result: Row[] = [];
        const occupied: number[] = [];
        for (const row of nodes)
          if (element(row) && row.tagName === "tr") {
            await ctx.cooperate();
            const cells: Row[1][number][] = [];
            let header = leadingHead;
            let column = 0;
            for (const cell of row.childNodes)
              if (element(cell) && ["td", "th"].includes(cell.tagName)) {
                if (cell.tagName === "td") header = false;
                while ((occupied[column] ?? 0) > 0) {
                  column++;
                  ctx.checkpoint();
                }
                const r = number(value(cell, "rowspan"), 1);
                const c = number(value(cell, "colspan"), 1, 1000);
                ctx.bound("tableCells", column + c);
                ctx.charge("references", c);
                for (let i = 0; i < c; i++)
                  occupied[column + i] = Math.max(occupied[column + i] ?? 0, r);
                column += c;
                cells.push([
                  attr(cell, ["rowspan", "colspan"]),
                  "AlignDefault",
                  r,
                  c,
                  await flow(cell.childNodes)
                ]);
              }
            width = Math.max(width, column, occupied.length);
            for (let i = 0; i < occupied.length; i++)
              occupied[i] = Math.max(0, (occupied[i] ?? 0) - 1);
            (header && cells.length ? heads : result).push([attr(row), cells]);
            leadingHead = false;
          }
        return result;
      }
      for (const child of node.childNodes)
        if (element(child)) {
          if (child.tagName === "caption") caption = await flow(child.childNodes);
          else if (child.tagName === "thead") heads.push(...(await rows(child.childNodes)));
          else if (child.tagName === "tfoot") feet.push(...(await rows(child.childNodes)));
          else if (child.tagName === "tbody") {
            bodies.push([attr(child), 0, [], await rows(child.childNodes, inferHead)]);
            inferHead = false;
          }
        }
      const specs: ColSpec[] = Array.from({ length: width }, () => [
        "AlignDefault",
        { t: "ColWidthDefault" }
      ]);
      return {
        t: "Table",
        c: [attr(node), [null, caption], specs, [empty, heads], bodies, [empty, feet]]
      };
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
    return {
      blocks: await flow(body && element(body) ? body.childNodes : []),
      metadata,
      resources: [],
      ...(language ? { language } : {}),
      ...(["ltr", "rtl", "auto"].includes(dir) ? { direction: dir as "ltr" | "rtl" | "auto" } : {})
    };
}

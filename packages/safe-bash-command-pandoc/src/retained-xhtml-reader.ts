import type {RetainedXmlDocument, RetainedXmlNode} from "@poe-code/office-xml/retained-xml-document";
import {characters, equal, literal} from "@poe-code/office-xml/retained-values";
import {IntegerTable, type PagedStorage} from "safe-bash-io-engine/storage";
import {RetainedRtfAst, type RtfValue} from "./retained-rtf-ast.js";
import {PandocError} from "./errors.js";
import type {AdapterContext} from "./types.js";

const xhtml = "http://www.w3.org/1999/xhtml";
const containers = new Set(["div", "main", "section", "article", "aside", "header", "footer", "nav", "address", "form", "fieldset"]);
const blocks = new Set([...containers, "p", "h1", "h2", "h3", "h4", "h5", "h6", "ul", "ol", "li", "blockquote", "pre", "hr", "figure", "figcaption", "table", "dl", "dt", "dd"]);
const dropped = new Set(["head", "script", "style", "iframe", "object", "embed", "template", "noscript", "svg", "math", "base", "link", "meta", "input", "source", "track"]);
const styles = {em: "Emph", i: "Emph", b: "Strong", strong: "Strong", u: "Underline", s: "Strikeout", del: "Strikeout", strike: "Strikeout", sup: "Superscript", sub: "Subscript"} as const;
const names = ["", "#text", "html", "body", "br", "code", "tt", "samp", "var", "img", "a", "span", "caption", "thead", "tbody", "tfoot", "tr", "td", "th", "abbr", "bdi", "bdo", "mark", "time", "label", "small", "big", "dfn", "kbd", ...blocks, ...dropped, ...Object.keys(styles)];
const ws = (c: string) => c === " " || c === "\t" || c === "\r" || c === "\n" || c === "\f";
// Fixed-size records link normalized nodes, their children and postorder results.
enum F {Previous, Tag, Attributes, First, Last, Next, Inline, Flow, Literal, Content, Count}

/** The normalization worklist, document tree and Pandoc values live in caller
 * storage. Processing reverse document order avoids a depth-sized JS stack. */
export async function readRetainedXhtml(xml: RetainedXmlDocument, ast: RetainedRtfAst, storage: PagedStorage, ctx: AdapterContext, part: string): Promise<{blocks: RtfValue; language?: RtfValue; direction?: "ltr" | "rtl" | "auto"}> {
  const put = async (position: number, values: readonly number[]) => {
    const bytes = new Uint8Array(values.length * 8), view = new DataView(bytes.buffer);
    values.forEach((value, i) => view.setFloat64(i * 8, value, true)); await storage.write(position, bytes);
  };
  const get = async (position: number, count: number) => {
    const bytes = await storage.read(position, count * 8), view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    return Array.from({length: count}, (_, i) => view.getFloat64(i * 8, true));
  };
  const record = async (values: readonly number[]) => {const p = storage.allocate(values.length * 8); await put(p, values); return p;};
  const value = (position: number): RtfValue => ({position});
  const text = async (source: AsyncIterable<string>) => ast.string(await ast.text.from((async function* () {
    let chunk = "";
    for await (const piece of source) {chunk += piece; if (chunk.length >= 4096) {yield chunk; chunk = "";}}
    if (chunk) yield chunk;
  })()));
  const same = async (a: RtfValue, b: string) => {
    let offset = 0;
    for await (const chunk of ast.text.chunks(await ast.range(a))) {if (chunk !== b.slice(offset, offset + chunk.length)) return false; offset += chunk.length;}
    return offset === b.length;
  };
  const shortName = async (node: RetainedXmlNode) => {
    let name = ""; for await (const c of characters(xml.raw(node.localName))) {name += c; if (name.length > 16) return "";}
    return names.includes(name) ? name : "";
  };
  const empty = await ast.value(["", [], []]), emptyString = await ast.value("");
  const entry = async (pair: RtfValue) => [await ast.edge(pair), await ast.edge(pair, true)] as const;
  const lookup = async (attrs: RtfValue, key: string): Promise<RtfValue> => {
    for await (const pair of ast.children(attrs)) {const [k, v] = await entry(pair); if (await same(k!, key)) return v!;}
    return emptyString;
  };
  const nonempty = async (s: RtfValue) => (await ast.range(s)).units > 0;
  const words = async (s: RtfValue) => {
    const result = await ast.array(); let buffer = "", word = await ast.value("");
    const flush = async () => {if (buffer) {await ast.appendText(word, await ast.text.from([buffer])); buffer = "";}};
    for await (const chunk of ast.text.chunks(await ast.range(s))) for (const c of chunk) {
      if (ws(c)) {await flush(); if (await nonempty(word)) {await ast.push(result, word); word = await ast.value("");}}
      else {buffer += c; if (buffer.length >= 4096) await flush();}
    }
    await flush(); if (await nonempty(word)) await ast.push(result, word); return result;
  };
  const attributes = async (raw: RtfValue, tag: string, omit: readonly string[] = []) => {
    let id = await lookup(raw, "id"); if (!await nonempty(id) && tag === "a") id = await lookup(raw, "name");
    const classes = await words(await lookup(raw, "class")), pairs = await ast.array();
    for await (const pair of ast.children(raw)) {
      const [key] = await entry(pair); let prefix = "";
      for await (const chunk of ast.text.chunks(await ast.range(key!))) {prefix += chunk.slice(0, 2 - prefix.length); if (prefix.length === 2) break;}
      let excluded = prefix === "on";
      for (const name of ["id", "class", ...omit]) if (await same(key!, name)) excluded = true;
      if (!excluded) await ast.push(pairs, pair);
    }
    return ast.value([id, classes, pairs]);
  };
  const hasAttrs = async (attrs: RtfValue) => {
    let i = 0; for await (const v of ast.children(attrs)) {if (i++ === 0 ? await nonempty(v) : await ast.count(v)) return true;} return false;
  };
  let previous = 0;
  const create = async (tag: string, attrs: RtfValue, parent: number, content = 0) => {
    const row = Array<number>(F.Count).fill(0); row[F.Previous] = previous; row[F.Tag] = names.indexOf(tag); row[F.Attributes] = attrs.position; row[F.Content] = content;
    const p = await record(row); previous = p;
    if (parent) {const owner = await get(parent, F.Count); if (owner[F.Last]) await put(owner[F.Last]! + F.Next * 8, [p]); else await put(parent + F.First * 8, [p]); await put(parent + F.Last * 8, [p]);}
    return p;
  };
  async function* children(p: number) {let child = (await get(p + F.First * 8, 1))[0]!; while (child) {yield child; child = (await get(child + F.Next * 8, 1))[0]!;}}
  const rawEmpty = await ast.array();
  const anchor = async (parent: number, id: RtfValue) => {const attrs = await ast.value([["id", id]]); await create("span", attrs, parent);};
  // Diagnostic messages are an existing whole-string API. Only a rejected
  // namespace/name crosses that boundary; accepted payloads remain backed.
  const diagnosticText = async (source: AsyncIterable<string>) => {let result = ""; for await (const c of source) {result += c; await ctx.cooperate();} return result;};
  const warn = (message: string) => ctx.report({code: "W_RAW_CONTENT", operation: ctx.operation ?? "read", format: "epub", location: part, message});
  const fail = (message: string): never => {throw new PandocError("E_PARSE", ctx.operation ?? "read", message, "epub", part);};
  if (await shortName(xml.root) !== "html" || !await equal(xml.namespace(xml.root), literal(xhtml))) fail("Expected XHTML html root");
  let bodies = 0, bodyReference = 0; for await (const child of xml.children(xml.root)) if (child.kind === "element" && await shortName(child) === "body" && await equal(xml.namespace(child), literal(xhtml))) {bodies++; bodyReference = xml.reference(child);}
  if (bodies !== 1) fail("Expected exactly one XHTML body");
  let task = await record([0, xml.reference(xml.root), 0]), body = 0, rootId = emptyString, rootAttributes = rawEmpty;
  while (task) {
    await ctx.cooperate(); const [next, ref, parent] = await get(task, 3); task = next!; const node = await xml.node(ref!);
    if (node.kind === "text" || node.kind === "cdata") {await create("#text", rawEmpty, parent!, (await text(characters(xml.text(node)))).position); continue;}
    if (node.kind !== "element") continue;
    if (!await equal(xml.namespace(node), literal(xhtml))) {warn(`Unsupported foreign XHTML media/namespace: ${await diagnosticText(characters(xml.namespace(node)))}`); continue;}
    const tag = await shortName(node), raw = await ast.array();
    for await (const a of xml.attributes(node)) {
      let prefix = "";
      if (await equal(xml.namespace(a), literal("http://www.w3.org/XML/1998/namespace"))) prefix = "xml:";
      else if (await equal(xml.namespace(a), literal("http://www.idpf.org/2007/ops"))) prefix = "epub:";
      else if (!await equal(xml.namespace(a), literal(""))) {
        warn(`Unsupported foreign XHTML attribute loss: ${await diagnosticText(characters(xml.namespace(a)))}:${await diagnosticText(characters(xml.raw(a.localName)))}`);
        continue;
      }
      const key = await text((async function* () {yield prefix; yield* characters(xml.raw(a.localName));})());
      await ast.push(raw, await ast.value([key, await text(characters(xml.text(a)))]));
    }
    const id = await lookup(raw, "id"); let target = parent!;
    if (["ul", "ol", "hr"].includes(tag) && await nonempty(id)) await anchor(target, id);
    if (["abbr", "bdi", "bdo", "mark", "time", "label", "small", "big", "dfn", "kbd"].includes(tag) && await ast.count(raw)) target = await create("span", raw, target);
    const p = await create(tag, raw, target);
    if (ref === xml.reference(xml.root)) {rootId = id; rootAttributes = raw;}
    target = p;
    if (tag === "body") {if (ref === bodyReference) body = p; if (await ast.count(raw)) target = await create("div", raw, p); if (await nonempty(rootId)) await anchor(target, rootId);}
    if (["li", "blockquote", "dl", "dt", "dd"].includes(tag) && await nonempty(id)) await anchor(target, id);
    let reverse = 0;
    for await (const child of xml.children(node)) reverse = await record([reverse, xml.reference(child)]);
    while (reverse) {const [prev, child] = await get(reverse, 2); task = await record([task, child!, target]); reverse = prev!;}
  }
  const copy = async (target: RtfValue, source: RtfValue) => {for await (const child of ast.children(source)) await ast.push(target, child);};
  const appendInline = async (target: RtfValue, child: RtfValue) => {
    const name = await ast.name(child), last = await ast.edge(target, true);
    if (name === "Space" && last && await ast.name(last) === "Space") return;
    if (name === "Str" && last && await ast.name(last) === "Str") {
      // Shared child text is immutable: copy its chain before concatenating.
      const current = (await ast.content(last))!, extra = (await ast.content(child))!;
      const combined = await ast.text.from((async function* () {yield* ast.text.chunks(await ast.range(current)); yield* ast.text.chunks(await ast.range(extra));})());
      await ast.remove(target, true); await ast.push(target, await ast.tag("Str", await ast.string(combined)));
    } else await ast.push(target, child);
  };
  const inlineText = async (s: RtfValue) => {
    const result = await ast.array(); let buffer = "", word = await ast.value("");
    const chunk = async () => {if (buffer) {await ast.appendText(word, await ast.text.from([buffer])); buffer = "";}};
    const flush = async () => {await chunk(); if (await nonempty(word)) {await appendInline(result, await ast.tag("Str", word)); word = await ast.value("");}};
    for await (const piece of ast.text.chunks(await ast.range(s))) for (const c of piece) {if (ws(c)) {await flush(); await appendInline(result, await ast.tag("Space"));} else {buffer += c; if (buffer.length >= 4096) await chunk();}}
    await flush(); return result;
  };
  const trim = async (source: RtfValue) => {const result = await ast.array(); await copy(result, source); for (const last of [false, true]) {const edge = await ast.edge(result, last); if (edge && await ast.name(edge) === "Space") await ast.remove(result, last);} return result;};
  const number = async (s: RtfValue, max = 65534) => {let n = 0, seen = false; for await (const chunk of ast.text.chunks(await ast.range(s))) for (const c of chunk) {if (c < "0" || c > "9") return 1; seen = true; n = n * 10 + Number(c); if (!Number.isSafeInteger(n)) return 1;} return seen && n > 0 ? Math.min(n, max) : 1;};
  const childFlow = async (p: number, exclude = 0) => {
    const result = await ast.array(); let pending = await ast.array();
    const flush = async () => {const content = await trim(pending); if (await ast.count(content)) await ast.push(result, await ast.tag("Plain", content)); pending = await ast.array();};
    for await (const child of children(p)) {if (child === exclude) continue; const row = await get(child, F.Count); if (blocks.has(names[row[F.Tag]!]!)) {await flush(); await copy(result, value(row[F.Flow]!));} else for await (const inline of ast.children(value(row[F.Inline]!))) await appendInline(pending, inline);}
    await flush(); return result;
  };
  async function* literalContent(root: number): AsyncGenerator<string> {
    let pending = await record([0, root]);
    while (pending) {
      const [next, p] = await get(pending, 2); pending = next!;
      const row = await get(p!, F.Count), tag = names[row[F.Tag]!]!;
      await ctx.cooperate();
      if (tag === "#text") {yield* ast.text.chunks(await ast.range(value(row[F.Content]!))); continue;}
      if (dropped.has(tag)) continue;
      let reverse = 0;
      for await (const child of children(p!)) reverse = await record([reverse, child]);
      while (reverse) {const [next, child] = await get(reverse, 2); pending = await record([pending, child!]); reverse = next!;}
    }
  }
  for (let p = previous; p;) {
    await ctx.cooperate(); const row = await get(p, F.Count), tag = names[row[F.Tag]!]!, raw = value(row[F.Attributes]!);
    let inlines = await ast.array(), flow = await ast.array();
    const lit = tag === "#text" ? value(row[F.Content]!) : ["code", "tt", "samp", "var", "pre"].includes(tag) ? await ast.string(await ast.text.from(literalContent(p))) : emptyString;
    if (tag === "#text") inlines = await inlineText(lit);
    else if (!dropped.has(tag)) {
      const content = await ast.array(); for await (const child of children(p)) {const r = await get(child, F.Count); for await (const inline of ast.children(value(r[F.Inline]!))) await appendInline(content, inline);}
      const attrs = await attributes(raw, tag);
      if (tag === "br") await ast.push(inlines, await ast.tag("LineBreak"));
      else if (["code", "tt", "samp", "var"].includes(tag)) await ast.push(inlines, await ast.tag("Code", await ast.value([attrs, lit])));
      else if (tag === "img") await ast.push(inlines, await ast.tag("Image", await ast.value([await attributes(raw, tag, ["src", "alt", "title"]), await inlineText(await lookup(raw, "alt")), [await lookup(raw, "src"), await lookup(raw, "title")]])));
      else if (Object.hasOwn(styles, tag)) {const styled = await ast.tag(styles[tag as keyof typeof styles], content); await ast.push(inlines, await hasAttrs(attrs) ? await ast.tag("Span", await ast.value([attrs, [styled]])) : styled);}
      else if (tag === "a" && await (async () => {for await (const pair of ast.children(raw)) if (await same((await entry(pair))[0]!, "href")) return true; return false;})()) await ast.push(inlines, await ast.tag("Link", await ast.value([await attributes(raw, tag, ["href", "title"]), content, [await lookup(raw, "href"), await lookup(raw, "title")]])));
      else if (tag === "span" || tag === "a") await ast.push(inlines, await ast.tag("Span", await ast.value([attrs, content])));
      else inlines = content;
      if (tag === "p") {const para = await ast.tag("Para", await trim(content)); await ast.push(flow, await hasAttrs(attrs) ? await ast.tag("Div", await ast.value([attrs, [para]])) : para);}
      else if (["h1", "h2", "h3", "h4", "h5", "h6"].includes(tag)) await ast.push(flow, await ast.tag("Header", await ast.value([Number(tag[1]), attrs, await trim(content)])));
      else if (containers.has(tag)) await ast.push(flow, await ast.tag("Div", await ast.value([attrs, await childFlow(p)])));
      else if (tag === "hr") await ast.push(flow, await ast.tag("HorizontalRule"));
      else if (tag === "blockquote") await ast.push(flow, await ast.tag("BlockQuote", await childFlow(p)));
      else if (tag === "pre") {
        let code = empty; for await (const child of children(p)) {const r = await get(child, F.Count); if (names[r[F.Tag]!] === "code") {code = await attributes(value(r[F.Attributes]!), "code"); break;}}
        const a = []; for await (const v of ast.children(attrs)) a.push(v); const b = []; for await (const v of ast.children(code)) b.push(v);
        const classes = await ast.array(), pairs = await ast.array();
        for (const source of [a[1]!, b[1]!]) for await (const item of ast.children(source)) {let found = false; for await (const prior of ast.children(classes)) if (await equalText(prior, item)) {found = true; break;} if (!found) await ast.push(classes, item);}
        await copy(pairs, a[2]!); for await (const pair of ast.children(b[2]!)) {let found = false; for await (const prior of ast.children(a[2]!)) if (await equalText((await entry(prior))[0]!, (await entry(pair))[0]!)) {found = true; break;} if (!found) await ast.push(pairs, pair);}
        await ast.push(flow, await ast.tag("CodeBlock", await ast.value([[await nonempty(a[0]!) ? a[0]! : b[0]!, classes, pairs], lit])));
      } else if (tag === "ul" || tag === "ol") {
        const items = await ast.array(); for await (const child of children(p)) {const r = await get(child, F.Count); if (names[r[F.Tag]!] === "li") await ast.push(items, value(r[F.Flow]!));}
        await ast.push(flow, tag === "ul" ? await ast.tag("BulletList", items) : await ast.tag("OrderedList", await ast.value([[await number(await lookup(raw, "start")), "Decimal", "Period"], items])));
      } else if (tag === "figure") {
        let caption = 0; for await (const child of children(p)) {const r = await get(child, F.Count); if (names[r[F.Tag]!] === "figcaption") {caption = child; break;}}
        await ast.push(flow, await ast.tag("Figure", await ast.value([attrs, [null, caption ? await childFlow(caption) : await ast.array()], await childFlow(p, caption)])));
      } else if (tag === "table") await ast.push(flow, await table(p, attrs));
      else flow = await childFlow(p);
    }
    await put(p + F.Inline * 8, [inlines.position, flow.position, lit.position]); p = row[F.Previous]!;
  }
  async function equalText(a: RtfValue, b: RtfValue) {
    const x = ast.text.chunks(await ast.range(a)), y = ast.text.chunks(await ast.range(b));
    let left = "", right = "", xd = false, yd = false;
    try {while (true) {if (!left && !xd) {const n = await x.next(); xd = !!n.done; left = n.value ?? "";} if (!right && !yd) {const n = await y.next(); yd = !!n.done; right = n.value ?? "";} if (!left || !right) return xd && yd; const count = Math.min(left.length, right.length); if (left.slice(0, count) !== right.slice(0, count)) return false; left = left.slice(count); right = right.slice(count);}} finally {await x.return(undefined); await y.return(undefined);}
  }
  async function table(p: number, attrs: RtfValue) {
    const heads = await ast.array(), feet = await ast.array(), bodies = await ast.array(); let width = 0, caption = await ast.array();
    const rows = async (parent: number) => {
      const result = await ast.array(), occupied = new IntegerTable(storage, 64); let columns = 0;
      for await (const child of children(parent)) {
        const row = await get(child, F.Count); if (names[row[F.Tag]!] !== "tr") continue;
        const cells = await ast.array(); let column = 0;
        for await (const cell of children(child)) {
          const r = await get(cell, F.Count), tag = names[r[F.Tag]!]!; if (tag !== "td" && tag !== "th") continue;
          while ((await occupied.get(BigInt(column)) ?? 0n) > 0n) {column++; ctx.checkpoint();}
          const raw = value(r[F.Attributes]!), rows = await number(await lookup(raw, "rowspan")), cols = await number(await lookup(raw, "colspan"), 1000);
          ctx.bound("tableCells", column + cols); ctx.charge("references", cols);
          for (let i = 0; i < cols; i++) await occupied.set(BigInt(column + i), BigInt(Math.max(rows, Number(await occupied.get(BigInt(column + i)) ?? 0n))));
          columns = Math.max(columns, column + cols);
          column += cols; await ast.push(cells, await ast.value([await attributes(raw, tag, ["rowspan", "colspan"]), "AlignDefault", rows, cols, await childFlow(cell)]));
        }
        width = Math.max(width, column, columns); for (let column = 0; column < columns; column++) await occupied.set(BigInt(column), BigInt(Math.max(0, Number(await occupied.get(BigInt(column)) ?? 0n) - 1)));
        await ast.push(result, await ast.value([await attributes(value(row[F.Attributes]!), "tr"), cells]));
      }
      return result;
    };
    for await (const child of children(p)) {const row = await get(child, F.Count), tag = names[row[F.Tag]!]!; if (tag === "caption") caption = await childFlow(child); else if (tag === "thead") await copy(heads, await rows(child)); else if (tag === "tfoot") await copy(feet, await rows(child)); else if (tag === "tbody") await ast.push(bodies, await ast.value([await attributes(value(row[F.Attributes]!), tag), 0, [], await rows(child)]));}
    const specs = await ast.array(); for (let i = 0; i < width; i++) await ast.push(specs, await ast.value(["AlignDefault", await ast.tag("ColWidthDefault")]));
    return ast.tag("Table", await ast.value([attrs, [null, caption], specs, [empty, heads], bodies, [empty, feet]]));
  }
  let language = await lookup(rootAttributes, "lang");
  if (!await nonempty(language)) language = await lookup(rootAttributes, "xml:lang");
  const dir = await lookup(rootAttributes, "dir");
  let direction: "ltr" | "rtl" | "auto" | undefined;
  for (const candidate of ["ltr", "rtl", "auto"] as const) if (await same(dir, candidate)) direction = candidate;
  return {blocks: await childFlow(body), ...(await nonempty(language) ? {language} : {}), ...(direction ? {direction} : {})};
}

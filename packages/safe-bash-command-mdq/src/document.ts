import { parseCommonMarkBlocks, parseCommonMarkInlines, type PendingBlock, type Inline as ParsedInline, type AdapterContext } from "safe-bash-markdown-engine";
import { normalizeLabel, decodeSyntax } from "safe-bash-markdown-engine/commonmark-syntax";
import type { MdqBudget } from "./budget.js";

export interface Link { url: string; title?: string; reference?: string; style?: "collapsed" | "shortcut"; autolink?: "bracketed" | "bare" }
export interface Inline { kind: "text" | "emph" | "strong" | "strike" | "code" | "html" | "link" | "image" | "footnote"; text: string; children: Inline[]; link?: Link }
export interface Node {
  kind: "document" | "section" | "paragraph" | "quote" | "code" | "html" | "list" | "item" | "table" | "break" | "frontmatter" | "inline";
  children: Node[]; inline: Inline[]; text: string;
  level?: number; language?: string; metadata?: string; variant?: "yaml" | "toml";
  index?: number; checked?: boolean; rows?: Inline[][][]; alignments?: string[];
}
export interface Document { roots: Node[]; footnotes: Map<string, Node[]> }
export function node(kind: Node["kind"], props: Partial<Node> = {}): Node { return { kind, children: [], inline: [], text: "", ...props }; }
export function inline(kind: Inline["kind"], text = "", children: Inline[] = [], link?: Link): Inline { return { kind, text, children, ...(link ? { link } : {}) }; }
export function plain(inlines: readonly Inline[]): string {
  return inlines.map(i => i.kind === "footnote" ? "" : i.children.length ? plain(i.children) : i.text).join("");
}
export async function parseDocument(source: string, budget: MdqBudget): Promise<Document> {
  const footnotes = new Map<string, Node[]>(), pendingNotes = new Map<string, PendingBlock[]>();
  const noteLabels = new Set<string>();
  const references = new WeakMap<object, Omit<Link, "url" | "title">>();
  const autolinks = new WeakMap<object, Pick<Link, "url" | "autolink">>();
  const ctx: AdapterContext = {
    checkpoint: n => budget.checkpoint(n), charge: (k, n) => budget.charge(k, n), bound: (k, n) => budget.bound(k, n), cooperate: n => budget.cooperate(n), decodeEntity: n => budget.decodeEntity(n),
    linkReference(target, label, style) { references.set(target, style === "full" ? { reference: label } : { reference: label, style }); },
    autolink(target, label, style) { autolinks.set(target, { url: label, autolink: style }); },
    footnoteReference(label) { return noteLabels.has(normalizeLabel(label, budget)); }
  };
  const roots: Node[] = [];
  let beginning = 0;
  for (let at = 0; at < source.length;) {
    const next = source.indexOf("\n", at), end = next < 0 ? source.length : next + 1;
    let empty = true;
    for (let i = at; i < end; i++) {
      budget.checkpoint();
      const code = source.charCodeAt(i);
      if (!(code >= 9 && code <= 13 || code === 32 || code === 133 || code === 160 || code === 5760 || code >= 8192 && code <= 8202 || code === 8232 || code === 8233 || code === 8239 || code === 8287 || code === 12288)) { empty = false; break; }
    }
    if (!empty) break;
    beginning = end; at = end;
  }
  const leading = source.slice(beginning + (source[beginning] === "\uFEFF" ? 1 : 0));
  source = leading;
  const firstEnd = leading.indexOf("\n"), marker = leading.slice(0, firstEnd).trimEnd();
  if (marker === "---" || marker === "+++") {
    let at = firstEnd + 1;
    while (at < leading.length) {
      const next = leading.indexOf("\n", at), end = next < 0 ? leading.length : next;
      if (leading.slice(at, end).trimEnd() === marker) {
        const body = leading.slice(firstEnd + 1, at);
        roots.push(node("frontmatter", { variant: marker === "---" ? "yaml" : "toml", text: body.endsWith("\r\n") ? body.slice(0, -2) : body.endsWith("\n") ? body.slice(0, -1) : body }));
        source = leading.slice(next < 0 ? end : end + 1); break;
      }
      at = end + 1;
    }
  }
  const extensions = { pipe_tables: true, preserve_table_columns: true, strikeout: true, single_tilde: true, autolink_bare_uris: true, footnotes: true };
  const parsed = await parseCommonMarkBlocks(source, ctx, "input", extensions);
  const stack = [...parsed.blocks].reverse();
  while (stack.length) {
    const b = stack.pop()!;
    if (b.kind === "footnote") {
      noteLabels.add(normalizeLabel(b.label, budget));
      if (!pendingNotes.has(b.label)) pendingNotes.set(b.label, b.blocks);
    }
    if ("blocks" in b) stack.push(...[...b.blocks].reverse());
    if (b.kind === "list") for (const item of [...b.items].reverse()) stack.push(...[...item.blocks].reverse());
  }
  const convertInline = (items: readonly ParsedInline[]): Inline[] => items.flatMap((i): Inline[] => {
    budget.charge("retainedBytes", 128); budget.charge("nodes", 1);
    switch (i.t) {
      case "Str": return [inline("text", i.c)];
      case "Space": return [inline("text", " ")];
      case "SoftBreak": case "LineBreak": return [inline("text", "\n")];
      case "Code": return [inline("code", i.c[1])];
      case "RawInline": return [inline(i.c[0] === "mdq-footnote" ? "footnote" : "html", i.c[1])];
      case "Emph": case "Strong": case "Strikeout": return [inline(i.t === "Emph" ? "emph" : i.t === "Strong" ? "strong" : "strike", "", convertInline(i.c))];
      case "Link": case "Image": {
        const children = convertInline(i.c[1]);
        return [inline(i.t === "Link" ? "link" : "image", "", i.t === "Image" ? [inline("text", plain(children))] : children, { url: i.c[2][0], ...(i.c[2][1] ? { title: i.c[2][1] } : {}), ...references.get(i.c[2]), ...autolinks.get(i.c[2]) })];
      }
      default: throw new Error(`Unexpected CommonMark inline ${i.t}`);
    }
  });
  const parseInline = async (text: string): Promise<Inline[]> => convertInline(await parseCommonMarkInlines({ kind: "pendingInline", lines: [{ text, start: { line: 1, column: 1 } }] }, parsed.definitions, ctx, extensions));
  async function assemble(blocks: PendingBlock[], depth = 0): Promise<Node[]> {
    budget.bound("depth", depth);
    const result: Node[] = [], sections: Node[] = [];
    for (const b of blocks) {
      await budget.cooperate(); budget.charge("retainedBytes", 128);
      let n: Node;
      switch (b.kind) {
        case "footnote": continue;
        case "heading":
          n = node("section", { level: b.level, inline: convertInline(await parseCommonMarkInlines(b.inline, parsed.definitions, ctx, extensions)) });
          while (sections.length && sections.at(-1)!.level! >= b.level) sections.pop();
          (sections.at(-1)?.children ?? result).push(n); sections.push(n); continue;
        case "paragraph": n = node("paragraph", { inline: convertInline(await parseCommonMarkInlines(b.inline, parsed.definitions, ctx, extensions)) }); break;
        case "code": {
          const info = decodeSyntax(b.info, ctx).trim();
          let split = 0;
          while (split < info.length && info[split] !== " " && info[split] !== "\t") split++;
          n = node("code", { text: b.literal.endsWith("\n") ? b.literal.slice(0, -1) : b.literal, ...(info ? { language: info.slice(0, split) } : {}), ...(split === info.length ? {} : { metadata: info.slice(split).trimStart() }) }); break;
        }
        case "html": n = node("html", { text: b.literal.trimEnd() }); break;
        case "thematicBreak": n = node("break"); break;
        case "quote": n = node("quote", { children: await assemble(b.blocks, depth + 1) }); break;
        case "list": {
          const items: Node[] = [];
          for (let ix = 0; ix < b.items.length; ix++) {
            const item = b.items[ix]!, first = item.blocks[0];
            const text = first?.kind === "paragraph" ? first.inline.lines[0]?.text ?? "" : "";
            const task = text.startsWith("[") && text[2] === "]" && " xX".includes(text[1]!) && text.length > 3 && " \t".includes(text[3]!);
            if (task && first?.kind === "paragraph") first.inline.lines[0]!.text = text.slice(3).trimStart();
            items.push(node("item", { ...(b.start === null ? {} : { index: b.start + ix }), ...(task ? { checked: text[1] !== " " } : {}), children: await assemble(item.blocks, depth + 1) }));
          }
          n = node("list", { children: items }); break;
        }
        case "table": {
          const rows: Inline[][][] = [];
          for (const cells of [b.header, ...b.rows]) {
            const row: Inline[][] = [];
            for (const cell of cells) row.push(await parseInline(cell));
            rows.push(row);
          }
          n = node("table", { rows, alignments: b.alignments.map(a => a === "AlignDefault" ? "none" : a.slice(5).toLowerCase()) }); break;
        }
      }
      (sections.at(-1)?.children ?? result).push(n);
    }
    return result;
  }
  roots.push(...await assemble(parsed.blocks));
  for (const [label, blocks] of pendingNotes) footnotes.set(label, await assemble(blocks));
  return { roots, footnotes };
}

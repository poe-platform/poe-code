import { parseDocument } from "yaml";
import { filterGfmHtml } from "./gfm-syntax.js";
import type { Block, Row, Inline, MetaValue } from "./ast-types.js";
function toMetaValue(val: unknown): MetaValue | undefined {
  if (typeof val === "string") return { t: "MetaString", c: val };
  if (typeof val === "number") return { t: "MetaString", c: String(val) };
  if (typeof val === "boolean") return { t: "MetaBool", c: val };
  if (Array.isArray(val)) {
    const items = val.map(toMetaValue).filter((x): x is MetaValue => x !== undefined);
    return { t: "MetaList", c: items };
  }
  if (val && typeof val === "object") {
    const map: Record<string, MetaValue> = {};
    for (const [k, v] of Object.entries(val)) {
      const mv = toMetaValue(v);
      if (mv !== undefined) map[k] = mv;
    }
    return { t: "MetaMap", c: map };
  }
  return undefined;
}
import type { ReaderCapability } from "./types.js";
import { parseCommonMarkBlocks, type PendingBlock } from "./commonmark-blocks.js";
import { parseCommonMarkInlines } from "./commonmark-inlines.js";
import { decodeSyntax } from "./commonmark-syntax.js";

export const readCommonMark: ReaderCapability["read"] = async (input, context, selection) => {
  const extensions = selection?.extensions ?? {};
  const rawText = input.text ?? await context.decodeUtf8([input.bytes]);
  const metadata: Record<string, MetaValue> = {};
  let text = rawText;
  const fmMatch = /^---[ \t]*\r?\n((?:[A-Za-z_][A-Za-z0-9_-]*[ \t]*:[^\r\n]*\r?\n|[ \t]+[^\r\n]*\r?\n)+)(?:---|\.\.\.)[ \t]*\r?\n(?=\s*\S)/.exec(rawText);
  if (fmMatch) {
    try {
      const doc = parseDocument(fmMatch[1]!);
      if (doc.errors.length === 0) {
        const jsVal = doc.toJS({ maxAliasCount: 32 });
        if (jsVal && typeof jsVal === "object" && !Array.isArray(jsVal)) {
          for (const [k, v] of Object.entries(jsVal as Record<string, unknown>)) {
            const mv = toMetaValue(v);
            if (mv !== undefined) metadata[k] = mv;
          }
          text = rawText.slice(fmMatch[0].length);
        }
      }
    } catch {
      // Keep unparseable frontmatter in the document body.
    }
  }
  const pending = await parseCommonMarkBlocks(text, context, input.base, extensions);
  async function assemble(blocks: readonly PendingBlock[], depth: number, tight = false): Promise<Block[]> {
    context.bound("depth", depth);
    const result: Block[] = [];
    for (const block of blocks) {
      await context.cooperate();
      switch (block.kind) {
        case "table": {
          const row = async (cells: readonly string[]): Promise<Row> => {
            const values: Row[1][number][] = [];
            for (let i = 0; i < block.alignments.length; i++) {
              const text = cells[i] ?? "";
              const inlines = text ? await parseCommonMarkInlines({ kind: "pendingInline", lines: [{ text, start: block.source.start }] }, pending.definitions, context, extensions) : [];
              values.push([["", [], []], "AlignDefault", 1, 1, inlines.length ? [{ t: "Plain", c: inlines }] : []]);
            }
            return [["", [], []], values];
          };
          const rows: Row[] = [];
          for (const cells of block.rows) rows.push(await row(cells));
          result.push({ t: "Table", c: [["", [], []], [null, []], block.alignments.map((alignment) => [alignment, { t: "ColWidthDefault" }]), [["", [], []], [await row(block.header)]], [[["", [], []], 0, [], rows]], [["", [], []], []]] });
          break;
        }
        case "paragraph": result.push({ t: tight ? "Plain" : "Para", c: await parseCommonMarkInlines(block.inline, pending.definitions, context, extensions) }); break;
        case "heading": result.push({ t: "Header", c: [block.level, ["", [], []], await parseCommonMarkInlines(block.inline, pending.definitions, context, extensions)] }); break;
        case "thematicBreak": result.push({ t: "HorizontalRule" }); break;
        case "html": result.push({ t: "RawBlock", c: ["html", Object.hasOwn(extensions, "raw_html") ? filterGfmHtml(block.literal, context) : block.literal] }); break;
        case "code": {
          const info = decodeSyntax(block.info, context).trim().split(" ")[0];
          result.push({ t: "CodeBlock", c: [["", info ? [info] : [], []], block.literal] });
          break;
        }
        case "quote": result.push({ t: "BlockQuote", c: await assemble(block.blocks, depth + 1) }); break;
        case "list": {
          const items: Block[][] = [];
          for (const item of block.items) {
            const first = item.blocks[0];
            const text = first?.kind === "paragraph" ? first.inline.lines[0]?.text : undefined;
            const task = extensions.task_lists && text?.startsWith("[") && text[2] === "]" && [" ", "\t", "x", "X"].includes(text[1] ?? "") && (text.length === 3 || text[3] === " " || text[3] === "\t");
            const blocks = task && first?.kind === "paragraph" ? [{ ...first, inline: { ...first.inline, lines: first.inline.lines.map((line, i) => i ? line : { ...line, text: line.text.slice(4).trimStart() }) } }, ...item.blocks.slice(1)] : item.blocks;
            const assembled = await assemble(blocks, depth + 1, block.tight);
            const leading = assembled[0];
            if (task && (leading?.t === "Plain" || leading?.t === "Para")) {
              const marker: Inline = { t: "Span", c: [["", ["task-list-marker"], [["checked", String(text![1] === "x" || text![1] === "X")]]], []] };
              assembled[0] = { t: leading.t, c: [marker, ...leading.c] };
            }
            items.push(assembled);
          }
          result.push(block.start === null ? { t: "BulletList", c: items } : { t: "OrderedList", c: [[block.start, "Decimal", block.marker === ")" ? "OneParen" : "Period"], items] });
          break;
        }
      }
    }
    return result;
  }
  return { blocks: await assemble(pending.blocks, 1), metadata, resources: [] };
};

export const commonmarkReader: ReaderCapability = { format: "commonmark", read: readCommonMark };

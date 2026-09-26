import { filterGfmHtml } from "./gfm-syntax.js";
import type { Block, Row, Inline } from "./ast-types.js";
import type { ReaderCapability } from "./types.js";
import { parseCommonMarkBlocks, type PendingBlock } from "./commonmark-blocks.js";
import { parseCommonMarkInlines } from "./commonmark-inlines.js";
import { decodeSyntax } from "./commonmark-syntax.js";

export const readCommonMark: ReaderCapability["read"] = async (input, context, selection) => {
  const extensions = selection?.extensions ?? {};
  const text = input.text ?? await context.decodeUtf8([input.bytes]);
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
  return { blocks: await assemble(pending.blocks, 1), metadata: {}, resources: [] };
};

export const commonmarkReader: ReaderCapability = { format: "commonmark", read: readCommonMark };

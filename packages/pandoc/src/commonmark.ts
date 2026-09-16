import type { Block } from "./ast-types.js";
import type { ReaderCapability } from "./types.js";
import { parseCommonMarkBlocks, type PendingBlock } from "./commonmark-blocks.js";
import { parseCommonMarkInlines } from "./commonmark-inlines.js";
import { decodeSyntax } from "./commonmark-syntax.js";

export const commonmarkReader: ReaderCapability = {
  format: "commonmark",
  async read(input, context) {
    const text = input.text ?? await context.decodeUtf8([input.bytes]);
    const pending = await parseCommonMarkBlocks(text, context, input.base);
    async function assemble(blocks: readonly PendingBlock[], depth: number, tight = false): Promise<Block[]> {
      context.bound("depth", depth);
      const result: Block[] = [];
      for (const block of blocks) {
        await context.cooperate();
        switch (block.kind) {
          case "paragraph": result.push({ t: tight ? "Plain" : "Para", c: await parseCommonMarkInlines(block.inline, pending.definitions, context) }); break;
          case "heading": result.push({ t: "Header", c: [block.level, ["", [], []], await parseCommonMarkInlines(block.inline, pending.definitions, context)] }); break;
          case "thematicBreak": result.push({ t: "HorizontalRule" }); break;
          case "html": result.push({ t: "RawBlock", c: ["html", block.literal] }); break;
          case "code": {
            const info = decodeSyntax(block.info, context).trim().split(" ")[0];
            result.push({ t: "CodeBlock", c: [["", info ? [info] : [], []], block.literal] });
            break;
          }
          case "quote": result.push({ t: "BlockQuote", c: await assemble(block.blocks, depth + 1) }); break;
          case "list": {
            const items: Block[][] = [];
            for (const item of block.items) items.push(await assemble(item.blocks, depth + 1, block.tight));
            result.push(block.start === null ? { t: "BulletList", c: items } : { t: "OrderedList", c: [[block.start, "Decimal", block.marker === ")" ? "OneParen" : "Period"], items] });
            break;
          }
        }
      }
      return result;
    }
    return { blocks: await assemble(pending.blocks, 1), metadata: {}, resources: [] };
  }
};

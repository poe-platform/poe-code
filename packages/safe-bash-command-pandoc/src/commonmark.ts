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
import { upgradeBracketedCitationsInBlocks } from "./citeproc-filters.js";

/** Resident YAML frontmatter semantics; the retained reader uses caller-backed
 * composition and conversion with matching metadata behavior. */
export function parseCommonMarkMetadata(text: string, metadata: Record<string, MetaValue>): boolean {
  try {
    const doc = parseDocument(text);
    if (doc.errors.length) return false;
    const value = doc.toJS({maxAliasCount: 32});
    if (!value || typeof value !== "object" || Array.isArray(value)) return false;
    for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
      const converted = toMetaValue(entry); if (converted !== undefined) metadata[key] = converted;
    }
    return true;
  } catch {return false;}
}

export const readCommonMark: ReaderCapability["read"] = async (input, context, selection) => {
  const extensions = selection?.extensions ?? {};
  const rawText = input.text ?? await context.decodeUtf8([input.bytes]);
  const metadata: Record<string, MetaValue> = {};
  let text = rawText;
  const fmMatch = /^---[ \t]*\r?\n((?:[A-Za-z_][A-Za-z0-9_-]*[ \t]*:[^\r\n]*\r?\n|[ \t]+[^\r\n]*\r?\n)+)(?:---|\.\.\.)[ \t]*\r?\n(?=\s*\S)/.exec(rawText);
  if (fmMatch) {
    if (parseCommonMarkMetadata(fmMatch[1]!, metadata)) text = rawText.slice(fmMatch[0].length);
  }
  const pending = await parseCommonMarkBlocks(text, context, input.base, extensions);
  const notes = new Map<string, Extract<PendingBlock, {kind: "footnote"}>>();
  function collect(blocks: readonly PendingBlock[], depth: number) {
    context.bound("depth", depth);
    for (const block of blocks) {
      context.checkpoint();
      if (block.kind === "footnote" && !notes.has(block.label)) {
        context.bound("references", notes.size + 1);
        context.charge("retainedBytes", block.label.length * 2 + 48);
        notes.set(block.label, block);
      }
      if ("blocks" in block) collect(block.blocks, depth + 1);
      if (block.kind === "list") for (const item of block.items) collect(item.blocks, depth + 1);
      if (block.kind === "definitionList") for (const item of block.items) for (const definition of item.definitions) collect(definition.blocks, depth + 1);
    }
  }
  if (extensions.footnotes) collect(pending.blocks, 1);
  const active = new Set<string>();
  async function assemble(blocks: readonly PendingBlock[], depth: number, tight = false): Promise<Block[]> {
    context.bound("depth", depth);
    const result: Block[] = [];
    const footnote = async (label: string): Promise<Inline | undefined> => {
      const note = notes.get(label);
      if (!note || active.has(label)) return undefined;
      active.add(label);
      try {return {t: "Note", c: await assemble(note.blocks, depth + 1)};}
      finally {active.delete(label);}
    };
    for (const block of blocks) {
      await context.cooperate();
      switch (block.kind) {
        case "table": {
          const row = async (cells: readonly string[]): Promise<Row> => {
            const values: Row[1][number][] = [];
            for (let i = 0; i < block.alignments.length; i++) {
              const text = cells[i] ?? "";
              const inlines = text ? await parseCommonMarkInlines({ kind: "pendingInline", lines: [{ text, start: block.source.start }] }, pending.definitions, context, extensions, footnote) : [];
              values.push([["", [], []], "AlignDefault", 1, 1, inlines.length ? [{ t: "Plain", c: inlines }] : []]);
            }
            return [["", [], []], values];
          };
          const rows: Row[] = [];
          for (const cells of block.rows) rows.push(await row(cells));
          result.push({ t: "Table", c: [["", [], []], [null, []], block.alignments.map((alignment) => [alignment, { t: "ColWidthDefault" }]), [["", [], []], [await row(block.header)]], [[["", [], []], 0, [], rows]], [["", [], []], []]] });
          break;
        }
        case "definitionList": {
          const items: Extract<Block, {t: "DefinitionList"}>["c"][number][] = [];
          for (const item of block.items) {
            const definitions: Block[][] = [];
            for (const definition of item.definitions) definitions.push(await assemble(definition.blocks, depth + 1, definition.tight));
            items.push([await parseCommonMarkInlines(item.term, pending.definitions, context, extensions, footnote), definitions]);
          }
          result.push({t: "DefinitionList", c: items});
          break;
        }
        case "paragraph": result.push({ t: tight ? "Plain" : "Para", c: await parseCommonMarkInlines(block.inline, pending.definitions, context, extensions, footnote) }); break;
        case "heading": result.push({ t: "Header", c: [block.level, ["", [], []], await parseCommonMarkInlines(block.inline, pending.definitions, context, extensions, footnote)] }); break;
        case "thematicBreak": result.push({ t: "HorizontalRule" }); break;
        case "html": result.push({ t: "RawBlock", c: ["html", Object.hasOwn(extensions, "raw_html") ? filterGfmHtml(block.literal, context) : block.literal] }); break;
        case "code": {
          const info = decodeSyntax(block.info, context).trim().split(" ")[0];
          result.push({ t: "CodeBlock", c: [["", info ? [info] : [], []], block.literal.endsWith("\n") ? block.literal.slice(0, -1) : block.literal] });
          break;
        }
        case "div": result.push({t: "Div", c: [block.attributes, await assemble(block.blocks, depth + 1)]}); break;
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
              const marker: Inline = {t: "Str", c: text![1] === "x" || text![1] === "X" ? "☒" : "☐"};
              assembled[0] = {t: leading.t, c: leading.c.length ? [marker, {t: "Space"}, ...leading.c] : [marker]};
            }
            items.push(assembled);
          }
          result.push(block.start === null ? { t: "BulletList", c: items } : { t: "OrderedList", c: [[block.start, block.style ?? "Decimal", block.marker === ")" ? "OneParen" : "Period"], items] });
          break;
        }
      }
    }
    return result;
  }
  const assembledBlocks = await assemble(pending.blocks, 1);
  const finalBlocks = (extensions.citations || metadata.bibliography !== undefined || metadata.references !== undefined)
    ? upgradeBracketedCitationsInBlocks(assembledBlocks)
    : assembledBlocks;
  return { blocks: finalBlocks, metadata, resources: [] };
};

export const commonmarkReader: ReaderCapability = { format: "commonmark", read: readCommonMark };

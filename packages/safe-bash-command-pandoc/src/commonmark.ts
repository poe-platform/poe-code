import {markdownTitleBlock} from "./markdown-title-block.js";
import {headingAttributes, headingIdentifier} from "./heading-attributes.js";
import {nativeDivBlocks} from "./html.js";
import { parseDocument } from "yaml";
import { filterGfmHtml } from "./gfm-syntax.js";
import type { Block, Row, Inline, MetaValue } from "./ast-types.js";
function toMetaValue(val: unknown, stringValue: (value: string) => MetaValue): MetaValue | undefined {
  if (typeof val === "string") return stringValue(val);
  if (typeof val === "number") return { t: "MetaString", c: String(val) };
  if (typeof val === "boolean") return { t: "MetaBool", c: val };
  if (Array.isArray(val)) {
    const items = val.map(value => toMetaValue(value, stringValue)).filter((x): x is MetaValue => x !== undefined);
    return { t: "MetaList", c: items };
  }
  if (val && typeof val === "object") {
    const map: Record<string, MetaValue> = {};
    for (const [k, v] of Object.entries(val)) {
      const mv = toMetaValue(v, stringValue);
      if (mv !== undefined) map[k] = mv;
    }
    return { t: "MetaMap", c: map };
  }
  return undefined;
}
import type { ReaderCapability } from "./types.js";
import { parseCommonMarkBlocks, type PendingBlock } from "./commonmark-blocks.js";
import { parseCommonMarkInlines } from "./commonmark-inlines.js";
import { decodeSyntax, fencedDivAttributes } from "./commonmark-syntax.js";

/** Resident YAML frontmatter semantics; the retained reader uses caller-backed
 * composition and conversion with matching metadata behavior. */
export function parseCommonMarkMetadata(text: string, metadata: Record<string, MetaValue>,
  stringValue: (value: string) => MetaValue = c => ({t: "MetaString", c})): boolean {
  try {
    const doc = parseDocument(text);
    if (doc.errors.length) return false;
    const value = doc.toJS({maxAliasCount: 32});
    if (!value || typeof value !== "object" || Array.isArray(value)) return false;
    for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
      const converted = toMetaValue(entry, stringValue); if (converted !== undefined) metadata[key] = converted;
    }
    return true;
  } catch {return false;}
}

export const readCommonMark: ReaderCapability["read"] = async (input, context, selection) => {
  const citationsState = {note: 0};
  let extensions: Readonly<Record<string, boolean>> = {...selection?.extensions, autolinkClasses: selection?.autolinkClasses ?? false};
  const rawText = input.text ?? await context.decodeUtf8([input.bytes]);
  const metadata: Record<string, MetaValue> = {};
  let text = rawText;
  if (extensions.pandoc_title_block) {
    const authors: MetaValue[] = [];
    const end = await markdownTitleBlock(offset => rawText[offset] ?? "", {start: 0, end: rawText.length}, context, async (name, range) => {
      const c = await parseCommonMarkInlines({kind: "pendingInline", lines: rawText.slice(range.start, range.end).split("\n").map((text, index) => ({text: text.trim(), start: {line: index + 1, column: 1}}))}, [], context, extensions);
      const value: MetaValue = {t: "MetaInlines", c};
      if (name === "author") authors.push(value);
      else metadata[name] = value;
    });
    if (authors.length) metadata.author = {t: "MetaList", c: authors};
    text = rawText.slice(end);
  }
  const fmMatch = /^---[ \t]*\r?\n((?:[A-Za-z_][A-Za-z0-9_-]*[ \t]*:[^\r\n]*\r?\n|[ \t]+[^\r\n]*\r?\n)+)(?:---|\.\.\.)[ \t]*\r?\n(?=\s*\S)/.exec(text);
  if (fmMatch) {
    const strings: {text: string; value: {t: "MetaInlines"; c: readonly Inline[]}}[] = [];
    if (parseCommonMarkMetadata(fmMatch[1]!, metadata, text => {
      const value: {t: "MetaInlines"; c: readonly Inline[]} = {t: "MetaInlines", c: []};
      strings.push({text, value}); return value;
    })) text = text.slice(fmMatch[0].length);
    for (const entry of strings) entry.value.c = await parseCommonMarkInlines({kind: "pendingInline",
      lines: entry.text.split("\n").map((text, index) => ({text: text.trim(), start: {line: index + 1, column: 1}}))}, [], context, extensions);
  }
  extensions = {...extensions, citations: extensions.citations ?? (metadata.bibliography !== undefined || metadata.references !== undefined)};
  const identifiers = new Set<string>();
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
    for (let index = 0; index < blocks.length; index++) {
      let block = blocks[index]!;
      await context.cooperate();
      let caption: Block[] = [];
      const first = block.kind === "paragraph" ? block.inline.lines[0] : undefined;
      if (extensions.table_captions && block.kind === "paragraph" && first &&
        first.text.startsWith("Table:") && [" ", "\t"].includes(first.text[6] ?? "") && blocks[index + 1]?.kind === "table") {
        const lines = [{...first, text: first.text.slice(6).trimStart()}, ...block.inline.lines.slice(1)];
        caption = [{t: "Plain", c: await parseCommonMarkInlines({...block.inline, lines}, pending.definitions, context, extensions, footnote, citationsState)}];
        block = blocks[++index]!;
      }
      switch (block.kind) {
        case "table": {
          const following = blocks[index + 1];
          const first = following?.kind === "paragraph" ? following.inline.lines[0] : undefined;
          if (extensions.table_captions && !caption.length && following?.kind === "paragraph" && first &&
            first.text.startsWith(":") && [" ", "\t"].includes(first.text[1] ?? "")) {
            const lines = [{...first, text: first.text.slice(1).trimStart()}, ...following.inline.lines.slice(1)];
            caption = [{t: "Plain", c: await parseCommonMarkInlines({...following.inline, lines}, pending.definitions, context, extensions, footnote, citationsState)}];
            index++;
          }
          const row = async (cells: readonly string[]): Promise<Row> => {
            const values: Row[1][number][] = [];
            for (let i = 0; i < block.alignments.length; i++) {
              const text = cells[i] ?? "";
              const inlines = text ? await parseCommonMarkInlines({ kind: "pendingInline", lines: [{ text, start: block.source.start }] }, pending.definitions, context, extensions, footnote, citationsState) : [];
              values.push([["", [], []], "AlignDefault", 1, 1, inlines.length ? [{ t: "Plain", c: inlines }] : []]);
            }
            return [["", [], []], values];
          };
          const rows: Row[] = [];
          for (const cells of block.rows) rows.push(await row(cells));
          result.push({ t: "Table", c: [["", [], []], [null, caption], block.alignments.map((alignment) => [alignment, { t: "ColWidthDefault" }]), [["", [], []], [await row(block.header)]], [[["", [], []], 0, [], rows]], [["", [], []], []]] });
          break;
        }
        case "definitionList": {
          const items: Extract<Block, {t: "DefinitionList"}>["c"][number][] = [];
          for (const item of block.items) {
            const definitions: Block[][] = [];
            for (const definition of item.definitions) definitions.push(await assemble(definition.blocks, depth + 1, definition.tight));
            items.push([await parseCommonMarkInlines(item.term, pending.definitions, context, extensions, footnote, citationsState), definitions]);
          }
          result.push({t: "DefinitionList", c: items});
          break;
        }
        case "paragraph": {
          const lines = block.inline.lines;
          const first = lines[0];
          if (extensions.line_blocks && first && (first.text === "|" || first.text.startsWith("| ") || first.text.startsWith("|\t"))) {
            const content: Inline[][] = [];
            let index = 0;
            while (index < lines.length) {
              const line = lines[index]!;
              if (line.text !== "|" && !line.text.startsWith("| ") && !line.text.startsWith("|\t")) break;
              let text = line.text.slice(2), indent = 0;
              while (text[indent] === " " || text[indent] === "\t") indent++;
              text = "\u00a0".repeat(indent) + text.slice(indent);
              index++;
              while (index < lines.length && lines[index]!.start.column > first.start.column) {
                text += " " + lines[index++]!.text.trim();
              }
              content.push(await parseCommonMarkInlines({kind: "pendingInline", lines: [{text, start: line.start}]}, pending.definitions, context, extensions, footnote, citationsState));
            }
            result.push({t: "LineBlock", c: content});
            if (index < lines.length) result.push(...await assemble([{...block, inline: {...block.inline, lines: lines.slice(index)}}], depth, tight));
            break;
          }
          const inlines = await parseCommonMarkInlines(block.inline, pending.definitions, context, extensions, footnote, citationsState);
          const image = inlines.length === 1 ? inlines[0] : undefined;
          if (extensions.implicit_figures && image?.t === "Image" && image.c[1].length) {
            result.push({t: "Figure", c: [["", [], []], [null, [{t: "Plain", c: image.c[1]}]], [{t: "Plain", c: inlines}]]});
          } else result.push({t: tight ? "Plain" : "Para", c: inlines});
          break;
        }
        case "heading": {
          const lines = [...block.inline.lines], last = lines.at(-1);
          const heading = extensions.header_attributes && last ? headingAttributes(last.text, context) : undefined;
          if (heading && last) lines[lines.length - 1] = {...last, text: last.text.slice(0, heading.end)};
          const inlines = await parseCommonMarkInlines({...block.inline, lines}, pending.definitions, context, extensions, footnote, citationsState);
          let attributes: import("./ast-types.js").Attr = heading?.attributes ?? ["", [], []];
          if (!attributes[0] && extensions.auto_identifiers) {
            const base = headingIdentifier(inlines, context);
            let id = base;
            for (let suffix = 1; identifiers.has(id); suffix++) {context.checkpoint(); id = `${base}-${suffix}`;}
            attributes = [id, attributes[1], attributes[2]];
          }
          if (attributes[0] && !identifiers.has(attributes[0])) {
            context.charge("references", 1); context.charge("retainedBytes", attributes[0].length * 2);
            identifiers.add(attributes[0]);
          }
          result.push({t: "Header", c: [block.level, attributes, inlines]});
          break;
        }
        case "thematicBreak": result.push({ t: "HorizontalRule" }); break;
        case "html": {
          const divs = extensions.native_divs ? await nativeDivBlocks(block.literal, context) : undefined;
          if (divs) result.push(...divs);
          else result.push({ t: "RawBlock", c: ["html", Object.hasOwn(extensions, "raw_html") ? filterGfmHtml(block.literal, context) : block.literal] });
          break;
        }
        case "code": {
          const decoded = decodeSyntax(block.info, context).trim();
          const info = decoded.split(" ")[0];
          const attributes = extensions.fenced_code_attributes && decoded.startsWith("{") && decoded.endsWith("}")
            ? fencedDivAttributes(decoded, context) : undefined;
          result.push({ t: "CodeBlock", c: [attributes ?? ["", info ? [info] : [], []], block.literal.endsWith("\n") ? block.literal.slice(0, -1) : block.literal] });
          break;
        }
        case "nativeDiv": {
          const div = (await nativeDivBlocks(block.literal, context))?.[0];
          if (div?.t === "Div") result.push({t: "Div", c: [div.c[0], await assemble(block.blocks, depth + 1)]});
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
  return { blocks: assembledBlocks, metadata, resources: [] };
};

export const commonmarkReader: ReaderCapability = { format: "commonmark", read: readCommonMark };

import type {Paragraph, Table, DocumentModelContext, XmlElement} from "safe-bash-docx-engine";
import type {Block, Inline, Row, Alignment} from "./ast-types.js";
import type {AdapterContext, ReaderCapability, Resource} from "./types.js";
import {PandocError} from "./errors.js";
import {literalInlines} from "./literal-inlines.js";
import {rustDocumentWriter} from "./rust-document-writer.js";
import {headingText} from "./heading-attributes.js";
const attr = ["", [], []] as const;
async function modelContext(ctx: AdapterContext): Promise<DocumentModelContext> {
  const {DocumentBudget} = await import("safe-bash-docx-engine/pandoc-adapter");
  const l = ctx.limits;
  const signal = ctx.signal ?? new AbortController().signal;
  return {signal, budget: new DocumentBudget({compressedInput: l.compressedBytes, expandedPackage: l.expandedBytes,
    zipEntries: l.parts, xmlPartBytes: l.binaryBytes, xmlNodes: l.xmlNodes, xmlDepth: l.xmlDepth,
    retainedBytes: l.retainedBytes, serializedOutput: l.outputBytes, work: l.work,
    tableCells: l.tableCells, tableRows: l.tableRows, tableColumns: l.tableColumns}, signal, async () => ctx.cooperate())};
}
async function guarded<T>(ctx: AdapterContext, action: () => Promise<T>): Promise<T> {
  try {return await action();} catch (error) {
    if (error instanceof PandocError) throw error;
    const code = (error as {code?: string}).code;
    throw new PandocError(code === "cancelled" ? "E_CANCELLED" : code === "limit-exceeded" ? "E_LIMIT" : "E_PARSE",
      ctx.operation ?? "convert", error instanceof Error ? error.message : "Invalid DOCX", "docx");
  }
}
export const docxReader: ReaderCapability = {format: "docx", async read(input, ctx) {
  return guarded(ctx, async () => {
    const {Document: openDocument, Paragraph, Run, NumberingGraph, numberingAttribute, numberingChild, modelText, activeModelChildren} = await import("safe-bash-docx-engine/pandoc-adapter");
    const model = await openDocument(input.bytes, await modelContext(ctx));
    const child = (node: XmlElement | undefined, name: string, part = model.part.partname.toString()): XmlElement | undefined =>
      node && activeModelChildren(model.store, part)(node).find(value => value.namespace === node.namespace && value.localName === name);
    const value = (node: XmlElement | undefined, name: string) =>
      node?.attributes.find(a => a.namespace === node.namespace && a.localName === name)?.value;
    const section = child(child(model.store.xml(model.part.partname.toString()).root, "body"), "sectPr");
    const margins = child(section, "pgMar");
    const page = [value(child(section, "pgSz"), "w"), ...["left", "right", "gutter"].map(name => value(margins, name))];
    const textWidth = page.every(n => n !== undefined && Number.isFinite(Number(n)))
      ? Number(page[0]) - Number(page[1]) - Number(page[2]) - Number(page[3]) : 9360;
    const related = (kind: string) => {
      const edge = [...model.part.rels.values()].find(edge => !edge.is_external && edge.reltype.endsWith(`/${kind}`));
      return edge ? model.store.xml(edge.target_part.partname.toString()) : undefined;
    };
    const numberingXml = related("numbering");
    const numbering = numberingXml ? new NumberingGraph(numberingXml, related("styles")?.root, model.store.context.budget) : undefined;
    const definitions = new Map<number, ReturnType<InstanceType<typeof NumberingGraph>["resolve"]>>();
    const notes = new Map<string, ReturnType<typeof model.store.ref>>();
    const activeNotes = new Set<string>();
    const identifiers = new Map<string, number>();
    for (const edge of model.part.rels.values()) {
      ctx.checkpoint();
      if (edge.is_external || !["http://schemas.openxmlformats.org/officeDocument/2006/relationships/footnotes", "http://purl.oclc.org/ooxml/officeDocument/relationships/footnotes"].includes(edge.reltype)) continue;
      const part = edge.target_part.partname.toString();
      const root = model.store.xml(part).root;
      for (const node of activeModelChildren(model.store, part)(root)) {
        ctx.checkpoint();
        if (node.namespace !== root.namespace || node.localName !== "footnote") continue;
        const id = node.attributes.find(a => a.namespace === root.namespace && a.localName === "id")?.value;
        const type = node.attributes.find(a => a.namespace === root.namespace && a.localName === "type")?.value;
        if (id !== undefined && (!type || type === "normal")) notes.set(id, model.store.ref(part, node));
      }
    }
    const resources = new Map<string, Resource>();
    const paragraph = async (p: Paragraph): Promise<Block> => {
      const name = p.style?.name ?? "";
      if (name.toLowerCase() === "source code") return {t: "CodeBlock", c: [attr, p.text]};
      const onlyChild = (node: XmlElement | undefined, name: string, namespace = node?.namespace): XmlElement | undefined => {
        if (!node) return undefined;
        const children = activeModelChildren(p.store, p.ref.part)(node);
        return children.length === 1 && children[0]!.namespace === namespace && children[0]!.localName === name ? children[0] : undefined;
      };
      const node = p.store.node(p.ref);
      if (onlyChild(onlyChild(onlyChild(node, "pPr"), "pBdr"), "bottom") ||
          onlyChild(onlyChild(onlyChild(node, "r"), "pict"), "rect", "urn:schemas-microsoft-com:vml")) return {t: "HorizontalRule"};
      const inlines: Inline[] = [];
      for (const item of p.iter_inner_content()) {
        ctx.checkpoint();
        const runs = item instanceof Run ? [item] : item.runs;
        const content: Inline[] = [];
        for (const run of runs) {
          ctx.checkpoint();
          const children = activeModelChildren(run.store, run.ref.part);
          const node = run.store.node(run.ref);
          let text = "";
          const flush = async () => {
            if (!text) return;
            let inlines: Inline[] = run.style?.style_id === "VerbatimChar"
              ? [{t: "Code", c: [attr, text]}]
              : await literalInlines(text, ctx);
            const font = run.font;
            if (font.underline) inlines = [{t: "Underline", c: inlines}];
            if (font.superscript) inlines = [{t: "Superscript", c: inlines}];
            else if (font.subscript) inlines = [{t: "Subscript", c: inlines}];
            if (font.strike) inlines = [{t: "Strikeout", c: inlines}];
            if (run.bold) inlines = [{t: "Strong", c: inlines}];
            if (run.italic) inlines = [{t: "Emph", c: inlines}];
            content.push(...inlines);
            text = "";
          };
          for (const child of children(node)) {
            ctx.checkpoint();
            if (child.namespace === node.namespace && child.localName === "footnoteReference") {
              await flush();
              const id = child.attributes.find(a => a.namespace === node.namespace && a.localName === "id")?.value ?? "";
              const ref = notes.get(id);
              if (!ref || activeNotes.has(id)) throw new PandocError("E_PARSE", "read", `Invalid DOCX footnote reference: ${id}`, "docx");
              activeNotes.add(id);
              const blocks = await readBlocks(model.store.blocks(ref));
              activeNotes.delete(id);
              // Word separates the automatic note marker from its text with whitespace.
              const first = blocks[0];
              if (first?.t === "Para") {
                let start = 0;
                while (first.c[start]?.t === "Space") start++;
                blocks[0] = {...first, c: first.c.slice(start)};
              }
              content.push({t: "Note", c: blocks});
            } else if (child.namespace === node.namespace && child.localName === "drawing") {
              await flush();
              const strict = node.namespace === "http://purl.oclc.org/ooxml/wordprocessingml/main";
              const drawingNamespace = strict ? "http://purl.oclc.org/ooxml/drawingml/main" : "http://schemas.openxmlformats.org/drawingml/2006/main";
              const wordDrawingNamespace = strict ? "http://purl.oclc.org/ooxml/drawingml/wordprocessingDrawing" : "http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing";
              const relationshipNamespace = strict ? "http://purl.oclc.org/ooxml/officeDocument/relationships" : "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
              const descendants: XmlElement[] = [];
              const pending = [child];
              while (pending.length) {
                ctx.checkpoint();
                const current = pending.pop()!;
                descendants.push(current);
                const nested = children(current);
                for (let index = nested.length - 1; index >= 0; index--) pending.push(nested[index]!);
              }
              const properties = descendants.find(n => n.namespace === wordDrawingNamespace && n.localName === "docPr");
              const extent = descendants.find(n => n.namespace === wordDrawingNamespace && n.localName === "extent");
              const attribute = (n: XmlElement | undefined, name: string) => n?.attributes.find(a => a.namespace === "" && a.localName === name)?.value;
              for (const blip of descendants.filter(n => n.namespace === drawingNamespace && n.localName === "blip")) {
                const embed = blip.attributes.find(a => a.namespace === relationshipNamespace && a.localName === "embed")?.value;
                if (!embed) continue;
                ctx.charge("images", 1);
                const edge = run.store.part(run.ref.part).rels.get(embed);
                if (!edge || edge.is_external || edge.reltype !== `${relationshipNamespace}/image`) throw new PandocError("E_PARSE", "read", "Invalid DOCX image relationship", "docx");
                const part = edge.target_part;
                const path = part.partname.toString();
                const id = path.startsWith("/word/") ? path.slice(6) : path.slice(1);
                if (!resources.has(id)) {
                  const bytes = part.blob;
                  ctx.charge("retainedBytes", bytes.length);
                  resources.set(id, {id, bytes});
                }
                const dimensions: [string, string][] = [];
                for (const [name, axis] of [["width", "cx"], ["height", "cy"]] as const) {
                  const emu = Number(attribute(extent, axis));
                  if (Number.isFinite(emu) && emu > 0) {
                    const inches = emu / 914400;
                    dimensions.push([name, `${Number.isInteger(inches) ? inches.toFixed(1) : inches}in`]);
                  }
                }
                content.push({t: "Image", c: [["", [], dimensions], await literalInlines(attribute(properties, "descr") ?? "", ctx), [id, attribute(properties, "title") ?? ""]]});
              }
            } else if (child.namespace === node.namespace) text += modelText(child, children);
          }
          await flush();
        }
        if (item instanceof Run) inlines.push(...content);
        else inlines.push({t: "Link", c: [attr, content, [item.url, ""]]});
      }
      const level = name.startsWith("Heading ") ? Number(name.slice(8)) : 0;
      if (!inlines.length) {
        const node = p.store.node(p.ref);
        const runs = node.children.filter(n => n.namespace === node.namespace && n.localName === "r");
        if (runs.length === 1 && numberingChild(runs[0], "pict")?.children.some(rect =>
          rect.namespace === "urn:schemas-microsoft-com:vml" && rect.localName === "rect" && rect.attributes.some(a =>
            a.namespace === "urn:schemas-microsoft-com:office:office" && a.localName === "hr" && ["t", "true", "1"].includes(a.value))))
          return {t: "HorizontalRule"};
      }
      if (level >= 1 && level <= 6) {
        const base = headingText(inlines, ctx).normalize("NFC").toLowerCase().replace(/[^\p{L}\p{N}\s._-]/gu, "")
          .replace(/^[^\p{L}]*/u, "").trimEnd().replace(/\s+/gu, "-") || "section";
        let id = base, suffix = identifiers.get(base) ?? 0;
        if (suffix) {
          do {ctx.checkpoint(); id = `${base}-${suffix++}`;} while (identifiers.has(id));
          identifiers.set(base, suffix);
        }
        ctx.charge("references", 1); ctx.charge("retainedBytes", id.length * 2);
        identifiers.set(id, 1);
        return {t: "Header", c: [level, [id, [], []], inlines]};
      }
      return {t: "Para", c: inlines};
    };
    type ListFrame = {id: number; level: number; items: Block[][]};
    const appendParagraph = async (p: Paragraph, blocks: Block[], stack: ListFrame[], inCell = false) => {
      const block = await paragraph(p);
      const node = p.store.node(p.ref);
      if (!numbering && Number(numberingAttribute(numberingChild(numberingChild(numberingChild(node, "pPr"), "numPr"), "numId")) ?? 0)) throw new PandocError("E_PARSE", "read", "Missing DOCX numbering definitions", "docx");
      numbering?.project(node);
      const binding = numbering?.paragraph(node);
      if (!binding || !numbering) {
        stack.length = 0;
        if (p.style?.style_id === "BlockText" || p.style?.name?.toLowerCase() === "block text" || (p.paragraph_format.left_indent?.twips ?? 0) > 0) {
          const previous = blocks.at(-1);
          if (previous?.t === "BlockQuote") blocks[blocks.length - 1] = {t: "BlockQuote", c: [...previous.c, block]};
          else blocks.push({t: "BlockQuote", c: [block]});
        } else if (block.t !== "Para") blocks.push(block);
        else if (block.c.length) blocks.push(inCell && p.style?.style_id === "Compact" ? {t: "Plain", c: block.c} : block);
        return;
      }
      const {id, level} = binding;
      while (stack.length && stack.at(-1)!.level > level) stack.pop();
      if (stack.at(-1)?.level === level && stack.at(-1)!.id !== id) stack.pop();
      if (stack.at(-1)?.level !== level) {
        let definition = definitions.get(id);
        if (!definition) {definition = numbering.resolve(id); definitions.set(id, definition);}
        const properties = definition.levels.get(level);
        if (!properties) throw new PandocError("E_PARSE", "read", "Missing DOCX numbering level", "docx");
        const value = (name: string) => numberingAttribute(numbering.child(properties, name));
        const format = value("numFmt");
        const items: Block[][] = [];
        let list: Block;
        if (format === "bullet") list = {t: "BulletList", c: items};
        else {
          const styles = {decimal: "Decimal", lowerLetter: "LowerAlpha", upperLetter: "UpperAlpha", lowerRoman: "LowerRoman", upperRoman: "UpperRoman"} as const;
          const style = styles[format as keyof typeof styles];
          if (!style) throw new PandocError("E_UNSUPPORTED_FEATURE", "read", "Unsupported DOCX numbering format", "docx");
          const marker = value("lvlText") ?? "";
          const delimiter = marker.startsWith("(") && marker.endsWith(")") ? "TwoParens" : marker.endsWith(")") ? "OneParen" : "Period";
          const start = Number(numberingAttribute(definition.starts.get(level)) ?? value("start") ?? 1);
          list = {t: "OrderedList", c: [[start, style, delimiter], items]};
        }
        const parent = stack.at(-1);
        (parent ? parent.items.at(-1)! : blocks).push(list);
        stack.push({id, level, items});
      }
      stack.at(-1)!.items.push([block.t === "Para" && p.style?.style_id === "Compact" ? {t: "Plain", c: block.c} : block]);
    };
    const readTable = async (table: Table): Promise<Block> => {
      const grid = table.grid();
      // The Word reader reserves 10 twips between columns; a missing page layout defaults to 6.5 inches.
      const available = (Number.isFinite(textWidth) ? textWidth : 9360) - 10 * (grid.columns.length - 1);
      const widths = grid.columns.map(col => (Number(numberingAttribute(col, "w")) || 0) / available);
      const scale = Math.max(1, widths.reduce((sum, n) => sum + n, 0));
      const look = numberingChild(numberingChild(table.store.node(table.ref), "tblPr"), "tblLook");
      const firstRow = numberingAttribute(look, "firstRow");
      const firstHeader = firstRow === undefined ? !!(parseInt(numberingAttribute(look) ?? "", 16) & 32) : firstRow === "1";
      const head: Row[] = [], body: Row[] = [];
      let previousHeader = false;
      for (const [r, row] of grid.rows.entries()) {
        const cells: Row[1][number][] = [];
        for (const [c, owner] of grid.slots[r]!.entries()) {
          if (!owner || owner.row !== r || owner.column !== c) continue;
          await ctx.cooperate();
          const cell = table.logicalCell(grid.original(owner.node));
          const content: Block[] = [], group: ListFrame[] = [];
          let align: Alignment = "AlignDefault", first = true;
          for (const item of cell.iter_inner_content()) {
            if (item instanceof Paragraph) {
              const node = item.store.node(item.ref);
              if (first) {
                const jc = numberingAttribute(numberingChild(numberingChild(node, "pPr"), "jc"));
                align = jc === "right" ? "AlignRight" : jc === "center" ? "AlignCenter" : jc === "left" || jc === "both" ? "AlignLeft" : "AlignDefault";
              }
              await appendParagraph(item, content, group, true);
            } else {
              group.length = 0;
              content.push(await readTable(item));
            }
            first = false;
          }
          if (content.length === 1 && content[0]!.t === "Para") content[0] = {t: "Plain", c: content[0]!.c};
          cells.push([attr, align, owner.rowSpan, owner.columnSpan, content]);
        }
        const header = numberingChild(numberingChild(row, "trPr"), "tblHeader");
        const isHeader: boolean = r === 0 && firstHeader || !!header && !["0", "false", "off"].includes(numberingAttribute(header) ?? "1") ||
          previousHeader && grid.slots[r]!.some(owner => owner && owner.row < r);
        if (isHeader && !head.length) {for (const prior of body) head.push(prior); body.length = 0;}
        (isHeader ? head : body).push([attr, cells]);
        previousHeader = isHeader;
      }
      const firstCell = (head[0] ?? body[0])?.[1][0];
      return {t: "Table", c: [attr, [null, []], widths.map((w, i) => [firstCell && i < firstCell[3] ? firstCell[1] : "AlignDefault", w ? {t: "ColWidth", c: w / scale} : {t: "ColWidthDefault"}]),
        [attr, head], [[attr, 0, [], body]], [attr, []]]};
    };
    const readBlocks = async (items: Iterable<Paragraph | Table>): Promise<Block[]> => {
      const blocks: Block[] = [];
      const stack: ListFrame[] = [];
      for (const item of items) {
        await ctx.cooperate();
        if (item instanceof Paragraph) await appendParagraph(item, blocks, stack);
        else {
          stack.length = 0;
          blocks.push(await readTable(item));
        }
      }
      return blocks;
    };
    return {blocks: await readBlocks(model.iter_inner_content()), metadata: {}, resources: [...resources.values()]};
  });
}};
export const docxWriter = rustDocumentWriter("docx");

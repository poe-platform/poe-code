import {encodeXML} from "entities";
import type {Paragraph, Table, DocxBlock, DocxRunInput, DocumentModelContext, XmlElement} from "safe-bash-docx-engine";
import type {Block, Cell, Inline, Row, Alignment} from "./ast-types.js";
import type {AdapterContext, ReaderCapability, WriterCapability, Resource} from "./types.js";
import {PandocError} from "./errors.js";
import {literalInlines} from "./literal-inlines.js";
import {imageLength} from "./image-dimensions.js";
import {headingText} from "./heading-attributes.js";
interface RichRun extends DocxRunInput {
  readonly code?: boolean;
  readonly raw?: string;
  readonly link?: string;
  readonly strike?: boolean;
  readonly baseline?: "superscript" | "subscript";
  readonly image?: Extract<Inline, {t: "Image" | "Link"}>;
}
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
export const docxWriter: WriterCapability = {format: "docx", imageResources: "embed", async write(document, ctx) {
  return guarded(ctx, async () => {
    const blocks: DocxBlock[] = [];
    const paragraphs: {runs: readonly RichRun[]; properties: string}[] = [];
    const numbering: string[] = [];
    const notes: (readonly Block[])[] = [];
    let noteReference = false;
    let compactLists = false;
    const tables: {widths: number[]; fraction: number}[] = [];
    const cellEdits: (string | null)[] = [];
    const w = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
    const r = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
    const runs = (nodes: readonly Inline[], style: Omit<RichRun, "text" | "image" | "raw"> = {}, result: RichRun[] = []): RichRun[] => {
      for (const node of nodes) {
        ctx.checkpoint();
        if (node.t === "Strong") runs(node.c, {...style, bold: true}, result);
        else if (node.t === "Emph") runs(node.c, {...style, italic: true}, result);
        else if (node.t === "Underline") runs(node.c, {...style, underline: true}, result);
        else if (node.t === "Strikeout") runs(node.c, {...style, strike: true}, result);
        else if (node.t === "Superscript" || node.t === "Subscript") runs(node.c, {...style, baseline: node.t === "Superscript" ? "superscript" : "subscript"}, result);
        else if (node.t === "Span" || node.t === "Cite") runs(node.c[1], style, result);
        else if (node.t === "Link") runs(node.c[1], {...style, link: node.c[2][0]}, result);
        else if (node.t === "Quoted") runs([{t: "Str", c: node.c[0] === "SingleQuote" ? "‘" : "“"}, ...node.c[1], {t: "Str", c: node.c[0] === "SingleQuote" ? "’" : "”"}], style, result);
        else if (node.t === "RawInline") {
          if (node.c[0] === "openxml") result.push({text: "", raw: node.c[1]});
        }
        else if (node.t === "Note") {
          notes.push(node.c);
          result.push({text: "", raw: `<w:r><w:rPr><w:vertAlign w:val="superscript"/></w:rPr><w:footnoteReference w:id="${notes.length}"/></w:r>`});
        }
        else if (node.t === "Image") result.push({...style, text: "", image: node});
        else {
          let text: string;
          if (node.t === "Str") text = node.c;
          else if (node.t === "Space" || node.t === "SoftBreak") text = " ";
          else if (node.t === "LineBreak") text = "\n";
          else if (node.t === "Code") text = node.c[1];
          else throw new PandocError("E_UNSUPPORTED_FEATURE", "write", `Unsupported DOCX inline: ${node.t}`, "docx");
          const next: RichRun = {...style, text, ...(node.t === "Code" ? {code: true} : {})};
          const prev = result.at(-1);
          if (prev && prev.raw === undefined && !prev.image && !next.image && !prev.code && !next.code && prev.text !== "\n" && next.text !== "\n" &&
              prev.bold === next.bold && prev.italic === next.italic && prev.underline === next.underline &&
              prev.strike === next.strike && prev.baseline === next.baseline && prev.link === next.link) {
            result[result.length - 1] = {...prev, text: prev.text + next.text};
          } else {
            result.push(next);
          }
        }
      }
      return result;
    };
    const paragraph = (target: DocxBlock[], content: readonly RichRun[], properties: string, level?: number) => {
      if (noteReference) {
        content = [{text: "", raw: '<w:r><w:rPr><w:vertAlign w:val="superscript"/></w:rPr><w:footnoteRef/></w:r>'}, ...content];
        noteReference = false;
      }
      // Sidecars keep relationship/paragraph properties out of the structured content API.
      paragraphs.push({runs: content, properties});
      target.push({kind: "paragraph", ...(level === undefined ? {} : {level}), runs: content.map(({code: _code, link: _link, strike: _strike, baseline: _baseline, image: _image, raw: _raw, ...run}) => run)});
    };
    const visit = async (nodes: readonly Block[], target: DocxBlock[], indent = 0, list?: {id: number; level: number; pending: boolean}, alignment = ""): Promise<void> => {
      for (const block of nodes) {
        await ctx.cooperate();
        const properties = (list?.pending ? `<w:numPr><w:ilvl w:val="${list.level}"/><w:numId w:val="${list.id}"/></w:numPr>` : "") +
          (indent ? `<w:ind w:left="${indent}"/>` : "") + alignment;
        if (block.t === "Header") {paragraph(target, runs(block.c[2]), properties, block.c[0]); if (list) list.pending = false;}
        else if (block.t === "Para" || block.t === "Plain") {
          const compact = block.t === "Plain" && list !== undefined;
          compactLists ||= compact;
          paragraph(target, runs(block.c), (compact ? '<w:pStyle w:val="Compact"/>' : "") + properties);
          if (list) list.pending = false;
        }
        else if (block.t === "CodeBlock") {paragraph(target, [{text: block.c[1]}], properties); if (list) list.pending = false;}
        else if (block.t === "Figure") {
          await visit(block.c[2], target, indent, list, alignment);
          await visit(block.c[1][1], target, indent);
        }
        else if (block.t === "Div") await visit(block.c[1], target, indent, list, alignment);
        else if (block.t === "BlockQuote") await visit(block.c, target, indent + 720, list, alignment);
        else if (block.t === "HorizontalRule") paragraph(target, [], `<w:pBdr><w:bottom w:val="single" w:sz="6" w:space="1" w:color="auto"/></w:pBdr>`);
        else if (block.t === "BulletList" || block.t === "OrderedList") {
          const level = list ? list.level + 1 : 0;
          if (level > 8) throw new PandocError("E_UNSUPPORTED_FEATURE", "write", "DOCX lists support at most nine levels", "docx");
          const id = numbering.length + 1;
          const styles = {DefaultStyle: "decimal", Decimal: "decimal", LowerAlpha: "lowerLetter", UpperAlpha: "upperLetter", LowerRoman: "lowerRoman", UpperRoman: "upperRoman"};
          const format = block.t === "BulletList" ? "bullet" : styles[block.c[0][1] as keyof typeof styles];
          if (!format) throw new PandocError("E_UNSUPPORTED_FEATURE", "write", "Unsupported DOCX list style", "docx");
          const marker = block.t === "BulletList" ? "•" : block.c[0][2] === "TwoParens" ? `(%${level + 1})` : block.c[0][2] === "OneParen" ? `%${level + 1})` : `%${level + 1}.`;
          numbering.push(`<w:abstractNum w:abstractNumId="${id}"><w:multiLevelType w:val="multilevel"/><w:lvl w:ilvl="${level}"><w:start w:val="${block.t === "BulletList" ? 1 : block.c[0][0]}"/><w:numFmt w:val="${format}"/><w:lvlText w:val="${marker}"/><w:pPr><w:ind w:left="${720 * (level + 1)}" w:hanging="360"/></w:pPr></w:lvl></w:abstractNum>`);
          for (const item of block.t === "BulletList" ? block.c : block.c[1]) await visit(item, target, indent, {id, level, pending: true}, alignment);
        } else if (block.t === "Table") {
          if (block.c[1][1].length) await visit(block.c[1][1], target, indent);
          else if (block.c[1][0]?.length) paragraph(target, runs(block.c[1][0]), "");
          const cols = block.c[2], fraction = cols.reduce((sum, [,w]) => sum + (w.t === "ColWidth" ? w.c : 0), 0);
          const widths = cols.map(([,w]) => Math.floor(7920 * (fraction ? w.t === "ColWidth" ? w.c : 0 : 1 / cols.length)));
          tables.push({widths, fraction});
          const rows = [];
          const active = new Map<number, {cell: Cell; end: number}>();
          for (const row of [...block.c[3][1], ...block.c[4].flatMap(body => [...body[2], ...body[3]]), ...block.c[5][1]]) {
            const cells = [];
            let owner = 0;
            for (let col = 0; col < cols.length;) {
              await ctx.cooperate();
              const prior = active.get(col);
              const cell = prior?.cell ?? row[1][owner++]!;
              const end = prior?.end ?? rows.length + cell[2];
              if (end > rows.length + 1) active.set(col, {cell, end}); else active.delete(col);
              const width = widths.slice(col, col + cell[3]).reduce((a,b) => a+b, 0);
              const span = cell[3] > 1 ? `<w:gridSpan w:val="${cell[3]}"/>` : "";
              const merge = prior ? "<w:vMerge/>" : cell[2] > 1 ? '<w:vMerge w:val="restart"/>' : "";
              cellEdits.push(`<w:tcPr xmlns:w="${w}"><w:tcW w:w="${width}" w:type="dxa"/>${span}${merge}</w:tcPr>`);
              const children: DocxBlock[] = [];
              if (!prior) {
                const align = cell[1] === "AlignDefault" ? cols[col]![0] : cell[1];
                const justification = align === "AlignDefault" ? "" : `<w:jc w:val="${align.slice(5).toLowerCase()}"/>`;
                await visit(cell[4], children, 0, undefined, justification);
              }
              if (children.at(-1)?.kind !== "paragraph") paragraph(children, [], "");
              cells.push({blocks: children});
              // The archive creator takes a rectangular grid. These cells are removed before serialization.
              for (let j = 1; j < cell[3]; j++) {ctx.checkpoint(); cellEdits.push(null); cells.push({blocks: []});}
              col += cell[3];
            }
            rows.push(cells);
          }
          target.push({kind: "table", rows, headerRows: block.c[3][1].length});
        } else throw new PandocError("E_UNSUPPORTED_FEATURE", "write", `Unsupported DOCX block: ${block.t}`, "docx");
      }
    };
    await visit(document.blocks, blocks);
    // Render note blocks through the same path, then move them into their OPC part.
    const noteRanges: {start: number; end: number}[] = [];
    for (const note of notes) {
      const start = blocks.length;
      noteReference = true;
      await visit(note, blocks);
      if (noteReference) paragraph(blocks, [], "");
      noteRanges.push({start, end: blocks.length});
    }
    const {createDocumentArchive, writeDocumentArchive, DocumentXmlEditor, Image, numberingChild} = await import("safe-bash-docx-engine/pandoc-adapter");
    const mc = await modelContext(ctx);
    const archiveContext = {signal: mc.signal!, budget: mc.budget!};
    const archive = await createDocumentArchive({content: {version: 1, blocks}}, archiveContext);
    const main = new DocumentXmlEditor(archive.members.find(member => member.name === "word/document.xml")!.bytes, {}, undefined, mc.budget);
    const relationships = new DocumentXmlEditor(archive.members.find(member => member.name === "word/_rels/document.xml.rels")!.bytes, {}, undefined, mc.budget);
    let paragraphIndex = 0, relationshipId = 2;
    const linkRelationships: string[] = [];
    const media = new Map<string, {name: string; bytes: Uint8Array; type: string; id: string; asset: import("safe-bash-docx-engine").Image}>();
    let drawingId = 0;
    const drawing = async (node: Extract<Inline, {t: "Image" | "Link"}>): Promise<string> => {
      ctx.charge("images", 1);
      const source = node.c[2][0];
      let entry = media.get(source);
      if (!entry) {
        const bytes = document.resources.find(resource => resource.id === source)?.bytes ?? await ctx.resources?.resolve(source, undefined, ctx.signal);
        if (!bytes) throw new PandocError("E_RESOURCE", "write", `Missing image resource: ${source}`, "docx");
        ctx.charge("resourceBytes", bytes.length);
        const asset = await Image.from_blob(bytes, mc);
        const name = `media/image-${media.size + 1}.${asset.ext}`;
        entry = {name, bytes, type: asset.content_type, id: `rId${relationshipId++}`, asset};
        media.set(source, entry);
        linkRelationships.push(`<Relationship Id="${entry.id}" Type="${r}/image" Target="${name}"/>`);
      }
      const attributes = Object.fromEntries(node.c[0][2]);
      let width = imageLength(attributes.width, entry.asset.width.emu, ctx, "docx"), height = imageLength(attributes.height, entry.asset.height.emu, ctx, "docx");
      if (attributes.width && !attributes.height) height = Math.max(1, Math.round(width * entry.asset.height.emu / entry.asset.width.emu));
      if (attributes.height && !attributes.width) width = Math.max(1, Math.round(height * entry.asset.width.emu / entry.asset.height.emu));
      const alt = encodeXML(runs(node.c[1]).map(run => run.text).join(""));
      const a = "http://schemas.openxmlformats.org/drawingml/2006/main", pic = "http://schemas.openxmlformats.org/drawingml/2006/picture";
      return `<w:drawing xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" xmlns:a="${a}" xmlns:pic="${pic}" xmlns:r="${r}"><wp:inline distT="0" distB="0" distL="0" distR="0"><wp:extent cx="${width}" cy="${height}"/><wp:docPr id="${++drawingId}" name="Image ${drawingId}" descr="${alt}" title="${encodeXML(node.c[2][1])}"/><wp:cNvGraphicFramePr><a:graphicFrameLocks noChangeAspect="1"/></wp:cNvGraphicFramePr><a:graphic><a:graphicData uri="${pic}"><pic:pic><pic:nvPicPr><pic:cNvPr id="0" name="Image ${drawingId}"/><pic:cNvPicPr/></pic:nvPicPr><pic:blipFill><a:blip r:embed="${entry.id}"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill><pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${width}" cy="${height}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing>`;
    };
    const documentEdits = new Map<import("safe-bash-docx-engine").XmlElement, string>();
    let tableIndex = 0, cellIndex = 0;
    const edit = async (node: import("safe-bash-docx-engine").XmlElement): Promise<void> => {
      await ctx.cooperate();
      if (node.namespace === w && node.localName === "tbl") {
        const {widths, fraction} = tables[tableIndex++]!;
        const grid = numberingChild(node, "tblGrid")!, props = numberingChild(node, "tblPr")!;
        documentEdits.set(grid, `<w:tblGrid xmlns:w="${w}">${widths.map(width => `<w:gridCol w:w="${width}"/>`).join("")}</w:tblGrid>`);
        documentEdits.set(numberingChild(props, "tblW")!, `<w:tblW xmlns:w="${w}" w:type="${fraction ? "pct" : "auto"}" w:w="${Math.round(fraction * 5000)}"/>`);
        for (const row of node.children.filter(n => n.namespace === w && n.localName === "tr")) await edit(row);
      } else if (node.namespace === w && node.localName === "tc") {
        const props = cellEdits[cellIndex++];
        if (props === null) {documentEdits.set(node, ""); return;}
        documentEdits.set(numberingChild(node, "tcPr")!, props!);
        for (const child of node.children) if (child.localName !== "tcPr") await edit(child);
      } else if (node.namespace === w && node.localName === "p") {
        const extra = paragraphs[paragraphIndex++];
        if (!extra) return;
        const replacements = new Map<import("safe-bash-docx-engine").XmlElement, string>();
        const properties = node.children.find(child => child.localName === "pPr");
        if (properties && extra.properties) replacements.set(properties, `<w:pPr>${main.sourceXml(properties, new Map(), true)}${extra.properties}</w:pPr>`);
        const nativeRuns = node.children.filter(child => child.localName === "r");
        for (const [index, run] of extra.runs.entries()) {
          ctx.checkpoint();
          const native = nativeRuns[index]!;
          if (run.raw !== undefined) {
            // Parse the fragment in its WordprocessingML namespace before insertion.
            const fragment = new DocumentXmlEditor(new TextEncoder().encode(`<w:p xmlns:w="${w}" xmlns:r="${r}">${run.raw}</w:p>`), {}, undefined, mc.budget);
            replacements.set(native, fragment.sourceXml(fragment.root, new Map(), true));
            continue;
          }
          const properties = native.children.find(child => child.localName === "rPr");
          const codeStyle = run.code ? '<w:rStyle w:val="VerbatimChar"/>' : "";
          const format = (run.strike ? "<w:strike/>" : "") + (run.baseline ? `<w:vertAlign w:val="${run.baseline}"/>` : "");
          const edits = new Map<import("safe-bash-docx-engine").XmlElement, string>();
          if (properties && (codeStyle || format)) edits.set(properties, `<w:rPr>${codeStyle}${main.sourceXml(properties, new Map(), true)}${format}</w:rPr>`);
          let xml = run.image ? `<w:r>${await drawing(run.image)}</w:r>` : `<w:r>${!properties && (codeStyle || format) ? `<w:rPr>${codeStyle}${format}</w:rPr>` : ""}${main.sourceXml(native, edits, true)}</w:r>`;
          if (run.link !== undefined) {
          const anchor = run.link.startsWith("#");
          const id = `rId${relationshipId++}`;
          if (!anchor) linkRelationships.push(`<Relationship Id="${id}" Type="${r}/hyperlink" Target="${encodeXML(run.link)}" TargetMode="External"/>`);
          xml = `<w:hyperlink ${anchor ? `w:anchor="${encodeXML(run.link.slice(1))}"` : `xmlns:r="${r}" r:id="${id}"`}>${xml}</w:hyperlink>`;
          }
          if (codeStyle || format || run.image || run.link !== undefined) replacements.set(native, xml);
        }
        if (extra.properties || replacements.size) documentEdits.set(node, `<w:p xmlns:w="${w}" xmlns:r="${r}">${!properties && extra.properties ? `<w:pPr>${extra.properties}</w:pPr>` : ""}${main.sourceXml(node, replacements, true)}</w:p>`);
      } else for (const child of node.children) await edit(child);
    };
    await edit(main.root);
    if (documentEdits.size) {
      const body = numberingChild(main.root, "body")!;
      main.replaceElement(body, main.sourceXml(body, documentEdits));
    }
    let documentBytes = main.serialize();
    let footnotes: string | undefined;
    if (notes.length) {
      const rendered = new DocumentXmlEditor(documentBytes, {}, undefined, mc.budget);
      const body = rendered.root.children.find(child => child.namespace === w && child.localName === "body")!;
      footnotes = `<w:footnotes xmlns:w="${w}" xmlns:r="${r}">${noteRanges.map(({start, end}, index) => {
        const children = body.children.slice(start, end);
        const xml = children.map(child => rendered.sourceXml(child)).join("");
        for (const child of children) rendered.replaceElement(child, "");
        return `<w:footnote w:id="${index + 1}">${xml}</w:footnote>`;
      }).join("")}</w:footnotes>`;
      documentBytes = rendered.serialize();
    }
    if (numbering.length) linkRelationships.push(`<Relationship Id="rId${relationshipId++}" Type="${r}/numbering" Target="numbering.xml"/>`);
    const noteRelationships = linkRelationships.join("");
    if (notes.length) linkRelationships.push(`<Relationship Id="rId${relationshipId++}" Type="${r}/footnotes" Target="footnotes.xml"/>`);
    if (linkRelationships.length) relationships.insertChildren(relationships.root, linkRelationships.map(xml => xml.replace("<Relationship ", '<Relationship xmlns="http://schemas.openxmlformats.org/package/2006/relationships" ')).join(""));

    const types = new DocumentXmlEditor(archive.members.find(member => member.name === "[Content_Types].xml")!.bytes, {}, undefined, mc.budget);
    const typeOverrides = [
      ...(notes.length ? ['<Override xmlns="http://schemas.openxmlformats.org/package/2006/content-types" PartName="/word/footnotes.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.footnotes+xml"/>'] : []),
      ...(numbering.length ? ['<Override xmlns="http://schemas.openxmlformats.org/package/2006/content-types" PartName="/word/numbering.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.numbering+xml"/>'] : []),
      ...[...media.values()].map(entry => `<Override xmlns="http://schemas.openxmlformats.org/package/2006/content-types" PartName="/word/${entry.name}" ContentType="${entry.type}"/>`)
    ];
    if (typeOverrides.length) types.insertChildren(types.root, typeOverrides.join(""));
    const parts = new Map([["word/document.xml", documentBytes], ["word/_rels/document.xml.rels", relationships.serialize()], ["[Content_Types].xml", types.serialize()]]);
    const codeStyle = paragraphs.some(paragraph => paragraph.runs.some(run => run.code));
    if (compactLists || codeStyle) {
      const styles = new DocumentXmlEditor(archive.members.find(member => member.name === "word/styles.xml")!.bytes, {}, undefined, mc.budget);
      styles.insertChildren(styles.root, (compactLists ? `<w:style xmlns:w="${w}" w:type="paragraph" w:styleId="Compact"><w:name w:val="Compact"/><w:basedOn w:val="Normal"/><w:pPr><w:spacing w:before="0" w:after="0"/></w:pPr></w:style>` : "") + (codeStyle ? `<w:style xmlns:w="${w}" w:type="character" w:styleId="VerbatimChar"><w:name w:val="Verbatim Char"/><w:rPr><w:rFonts w:ascii="Courier New" w:hAnsi="Courier New"/></w:rPr></w:style>` : ""));
      parts.set("word/styles.xml", styles.serialize());
    }
    const members = archive.members.map(member => ({...member, bytes: parts.get(member.name) ?? member.bytes}));
    if (footnotes !== undefined) {
      members.push({name: "word/footnotes.xml", bytes: new TextEncoder().encode(footnotes), directory: false, modified: new Date(0)});
      if (noteRelationships) members.push({name: "word/_rels/footnotes.xml.rels", bytes: new TextEncoder().encode(`<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${noteRelationships}</Relationships>`), directory: false, modified: new Date(0)});
    }
    for (const entry of media.values()) members.push({name: `word/${entry.name}`, bytes: entry.bytes, directory: false, modified: new Date(0)});
    if (numbering.length) members.push({name: "word/numbering.xml", bytes: new TextEncoder().encode(`<w:numbering xmlns:w="${w}">${numbering.join("")}${numbering.map((_, i) => `<w:num w:numId="${i + 1}"><w:abstractNumId w:val="${i + 1}"/></w:num>`).join("")}</w:numbering>`), directory: false, modified: new Date(0)});
    const chunks: Uint8Array[] = []; let size = 0;
    await writeDocumentArchive({members, comment: archive.comment}, {async write(bytes) {size += bytes.length; ctx.bound("outputBytes", size); ctx.charge("retainedBytes", bytes.length); chunks.push(new Uint8Array(bytes));}}, {order: "name", compression: "store"}, archiveContext);
    const bytes = new Uint8Array(size); let offset = 0;
    for (const chunk of chunks) {bytes.set(chunk, offset); offset += chunk.length;}
    return {kind: "binary", bytes};
  });
}};

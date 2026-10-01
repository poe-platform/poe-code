import {encodeXML} from "entities";
import type {Paragraph, DocxBlock, DocxRunInput, DocumentModelContext} from "docx";
import type {Block, Inline, Row} from "./ast-types.js";
import type {AdapterContext, ReaderCapability, WriterCapability} from "./types.js";
import {PandocError} from "./errors.js";
const attr = ["", [], []] as const;
async function modelContext(ctx: AdapterContext): Promise<DocumentModelContext> {
  const {DocumentBudget} = await import("docx");
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
    const {Document: openDocument, Paragraph, Run} = await import("docx");
    const model = await openDocument(input.bytes, await modelContext(ctx));
    const paragraph = (p: Paragraph): Block => {
      const inlines: Inline[] = [];
      for (const item of p.iter_inner_content()) {
        ctx.checkpoint();
        const runs = item instanceof Run ? [item] : item.runs;
        const content = runs.map(run => {
          let inline: Inline = {t: "Str", c: run.text};
          if (run.bold) inline = {t: "Strong", c: [inline]};
          if (run.italic) inline = {t: "Emph", c: [inline]};
          return inline;
        });
        if (item instanceof Run) inlines.push(...content);
        else inlines.push({t: "Link", c: [attr, content, [item.url, ""]]});
      }
      const name = p.style?.name ?? "";
      const level = name.startsWith("Heading ") ? Number(name.slice(8)) : 0;
      return level >= 1 && level <= 6 ? {t: "Header", c: [level, attr, inlines]} : {t: "Para", c: inlines};
    };
    const blocks: Block[] = [];
    for (const item of model.iter_inner_content()) {
      await ctx.cooperate();
      if (item instanceof Paragraph) blocks.push(paragraph(item));
      else {
        const rows: Row[] = [];
        for (const row of item.rows) rows.push([attr, row.cells.map(cell => [attr, "AlignDefault", 1, 1, cell.paragraphs.map(paragraph)])]);
        blocks.push({t: "Table", c: [attr, [null, []], Array.from({length: item.columns.length}, () => ["AlignDefault", {t: "ColWidthDefault"}]), [attr, []], [[attr, 0, [], rows]], [attr, []]]});
      }
    }
    return {blocks, metadata: {}, resources: []};
  });
}};
export const docxWriter: WriterCapability = {format: "docx", async write(document, ctx) {
  return guarded(ctx, async () => {
    const blocks: DocxBlock[] = [];
    const paragraphs: {runs: readonly (DocxRunInput & {link?: string})[]; properties: string}[] = [];
    const numbering: string[] = [];
    const w = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
    const r = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
    const runs = (nodes: readonly Inline[], bold = false, italic = false, link?: string): (DocxRunInput & {link?: string})[] => {
      const result: (DocxRunInput & {link?: string})[] = [];
      for (const node of nodes) {
        ctx.checkpoint();
        if (node.t === "Strong") result.push(...runs(node.c, true, italic, link));
        else if (node.t === "Emph") result.push(...runs(node.c, bold, true, link));
        else if (node.t === "Span") result.push(...runs(node.c[1], bold, italic, link));
        else if (node.t === "Link") result.push(...runs(node.c[1], bold, italic, node.c[2][0]));
        else {
          let text: string;
          if (node.t === "Str") text = node.c;
          else if (node.t === "Space" || node.t === "SoftBreak") text = " ";
          else if (node.t === "LineBreak") text = "\n";
          else if (node.t === "Code") text = node.c[1];
          else throw new PandocError("E_UNSUPPORTED_FEATURE", "write", `Unsupported DOCX inline: ${node.t}`, "docx");
          result.push({text, bold, italic, ...(link === undefined ? {} : {link})});
        }
      }
      return result;
    };
    const paragraph = (target: DocxBlock[], content: readonly (DocxRunInput & {link?: string})[], properties: string, level?: number) => {
      // Sidecars keep relationship/paragraph properties out of the structured content API.
      paragraphs.push({runs: content, properties});
      target.push({kind: "paragraph", ...(level === undefined ? {} : {level}), runs: content.map(({link: _link, ...run}) => run)});
    };
    const visit = async (nodes: readonly Block[], target: DocxBlock[], indent = 0, list?: {id: number; level: number; pending: boolean}): Promise<void> => {
      for (const block of nodes) {
        await ctx.cooperate();
        const properties = (list?.pending ? `<w:numPr><w:ilvl w:val="${list.level}"/><w:numId w:val="${list.id}"/></w:numPr>` : "") +
          (indent ? `<w:ind w:left="${indent}"/>` : "");
        if (block.t === "Header") {paragraph(target, runs(block.c[2]), properties, block.c[0]); if (list) list.pending = false;}
        else if (block.t === "Para" || block.t === "Plain") {paragraph(target, runs(block.c), properties); if (list) list.pending = false;}
        else if (block.t === "CodeBlock") {paragraph(target, [{text: block.c[1]}], properties); if (list) list.pending = false;}
        else if (block.t === "Div") await visit(block.c[1], target, indent, list);
        else if (block.t === "BlockQuote") await visit(block.c, target, indent + 720, list);
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
          for (const item of block.t === "BulletList" ? block.c : block.c[1]) await visit(item, target, indent, {id, level, pending: true});
        } else if (block.t === "Table") {
          if (block.c[1][1].length) await visit(block.c[1][1], target, indent);
          else if (block.c[1][0]?.length) paragraph(target, runs(block.c[1][0]), "");
          const rows = [];
          for (const row of [...block.c[3][1], ...block.c[4].flatMap(body => [...body[2], ...body[3]]), ...block.c[5][1]]) {
            const cells = [];
            for (const cell of row[1]) {
              if (cell[2] !== 1 || cell[3] !== 1) throw new PandocError("E_UNSUPPORTED_FEATURE", "write", "DOCX table spans are unsupported", "docx");
              const children: DocxBlock[] = []; await visit(cell[4], children);
              if (!children.length || children.at(-1)?.kind !== "paragraph") paragraph(children, [], "");
              cells.push({blocks: children});
            }
            rows.push(cells);
          }
          target.push({kind: "table", rows, headerRows: block.c[3][1].length});
        } else throw new PandocError("E_UNSUPPORTED_FEATURE", "write", `Unsupported DOCX block: ${block.t}`, "docx");
      }
    };
    await visit(document.blocks, blocks);
    const {createDocumentArchive, writeDocumentArchive, DocumentXmlEditor} = await import("docx");
    const mc = await modelContext(ctx);
    const archiveContext = {signal: mc.signal!, budget: mc.budget!};
    const archive = await createDocumentArchive({content: {version: 1, blocks}}, archiveContext);
    const main = new DocumentXmlEditor(archive.members.find(member => member.name === "word/document.xml")!.bytes, {}, undefined, mc.budget);
    const relationships = new DocumentXmlEditor(archive.members.find(member => member.name === "word/_rels/document.xml.rels")!.bytes, {}, undefined, mc.budget);
    let paragraphIndex = 0, relationshipId = 2;
    const linkRelationships: string[] = [];
    const edit = async (node: import("docx").XmlElement): Promise<void> => {
      await ctx.cooperate();
      if (node.namespace === w && node.localName === "p") {
        const extra = paragraphs[paragraphIndex++];
        if (!extra) return;
        const replacements = new Map<import("docx").XmlElement, string>();
        const properties = node.children.find(child => child.localName === "pPr");
        if (properties && extra.properties) replacements.set(properties, `<w:pPr>${main.sourceXml(properties, new Map(), true)}${extra.properties}</w:pPr>`);
        const nativeRuns = node.children.filter(child => child.localName === "r");
        for (const [index, run] of extra.runs.entries()) if (run.link !== undefined) {
          ctx.checkpoint();
          const native = nativeRuns[index]!;
          const anchor = run.link.startsWith("#");
          const id = `rId${relationshipId++}`;
          if (!anchor) linkRelationships.push(`<Relationship Id="${id}" Type="${r}/hyperlink" Target="${encodeXML(run.link)}" TargetMode="External"/>`);
          replacements.set(native, `<w:hyperlink ${anchor ? `w:anchor="${encodeXML(run.link.slice(1))}"` : `xmlns:r="${r}" r:id="${id}"`}>${main.sourceXml(native)}</w:hyperlink>`);
        }
        if (extra.properties || replacements.size) main.replaceElement(node, `<w:p xmlns:w="${w}">${!properties && extra.properties ? `<w:pPr>${extra.properties}</w:pPr>` : ""}${main.sourceXml(node, replacements, true)}</w:p>`);
      } else for (const child of node.children) await edit(child);
    };
    await edit(main.root);
    if (numbering.length) linkRelationships.push(`<Relationship Id="rId${relationshipId++}" Type="${r}/numbering" Target="numbering.xml"/>`);
    if (linkRelationships.length) relationships.insertChildren(relationships.root, linkRelationships.map(xml => xml.replace("<Relationship ", '<Relationship xmlns="http://schemas.openxmlformats.org/package/2006/relationships" ')).join(""));

    const types = new DocumentXmlEditor(archive.members.find(member => member.name === "[Content_Types].xml")!.bytes, {}, undefined, mc.budget);
    if (numbering.length) types.insertChildren(types.root, '<Override xmlns="http://schemas.openxmlformats.org/package/2006/content-types" PartName="/word/numbering.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.numbering+xml"/>');
    const parts = new Map([["word/document.xml", main.serialize()], ["word/_rels/document.xml.rels", relationships.serialize()], ["[Content_Types].xml", types.serialize()]]);
    const members = archive.members.map(member => ({...member, bytes: parts.get(member.name) ?? member.bytes}));
    if (numbering.length) members.push({name: "word/numbering.xml", bytes: new TextEncoder().encode(`<w:numbering xmlns:w="${w}">${numbering.join("")}${numbering.map((_, i) => `<w:num w:numId="${i + 1}"><w:abstractNumId w:val="${i + 1}"/></w:num>`).join("")}</w:numbering>`), directory: false, modified: new Date(0)});
    const chunks: Uint8Array[] = []; let size = 0;
    await writeDocumentArchive({members, comment: archive.comment}, {async write(bytes) {size += bytes.length; ctx.bound("outputBytes", size); ctx.charge("retainedBytes", bytes.length); chunks.push(new Uint8Array(bytes));}}, {order: "name", compression: "store"}, archiveContext);
    const bytes = new Uint8Array(size); let offset = 0;
    for (const chunk of chunks) {bytes.set(chunk, offset); offset += chunk.length;}
    return {kind: "binary", bytes};
  });
}};

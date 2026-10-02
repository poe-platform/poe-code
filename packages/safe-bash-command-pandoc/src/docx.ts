import {encodeXML} from "entities";
import type {Paragraph, DocxBlock, DocxRunInput, DocumentModelContext} from "safe-bash-docx-engine";
import type {Block, Inline, Row} from "./ast-types.js";
import type {AdapterContext, ReaderCapability, WriterCapability} from "./types.js";
import {PandocError} from "./errors.js";
import {literalInlines} from "./literal-inlines.js";
import {imageLength} from "./image-dimensions.js";
interface RichRun extends DocxRunInput {
  readonly code?: boolean;
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
    const {Document: openDocument, Paragraph, Run} = await import("safe-bash-docx-engine/pandoc-adapter");
    const model = await openDocument(input.bytes, await modelContext(ctx));
    const paragraph = async (p: Paragraph): Promise<Block> => {
      const inlines: Inline[] = [];
      for (const item of p.iter_inner_content()) {
        ctx.checkpoint();
        const runs = item instanceof Run ? [item] : item.runs;
        const content: Inline[] = [];
        for (const run of runs) {
          ctx.checkpoint();
          let inlines: Inline[] = run.style?.style_id === "VerbatimChar"
            ? [{t: "Code", c: [attr, run.text]}]
            : await literalInlines(run.text, ctx);
          if (run.bold) inlines = [{t: "Strong", c: inlines}];
          if (run.italic) inlines = [{t: "Emph", c: inlines}];
          content.push(...inlines);
        }
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
      if (item instanceof Paragraph) blocks.push(await paragraph(item));
      else {
        const rows: Row[] = [];
        for (const row of item.rows) {
          const cells: Row[1][number][] = [];
          for (const cell of row.cells) {
            const blocks: Block[] = [];
            for (const p of cell.paragraphs) blocks.push(await paragraph(p));
            cells.push([attr, "AlignDefault", 1, 1, blocks]);
          }
          rows.push([attr, cells]);
        }
        blocks.push({t: "Table", c: [attr, [null, []], Array.from({length: item.columns.length}, () => ["AlignDefault", {t: "ColWidthDefault"}]), [attr, []], [[attr, 0, [], rows]], [attr, []]]});
      }
    }
    return {blocks, metadata: {}, resources: []};
  });
}};
export const docxWriter: WriterCapability = {format: "docx", imageResources: "embed", async write(document, ctx) {
  return guarded(ctx, async () => {
    const blocks: DocxBlock[] = [];
    const paragraphs: {runs: readonly RichRun[]; properties: string}[] = [];
    const numbering: string[] = [];
    const w = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
    const r = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
    const runs = (nodes: readonly Inline[], style: Omit<RichRun, "text" | "image"> = {}): RichRun[] => {
      const result: RichRun[] = [];
      for (const node of nodes) {
        ctx.checkpoint();
        if (node.t === "Strong") result.push(...runs(node.c, {...style, bold: true}));
        else if (node.t === "Emph") result.push(...runs(node.c, {...style, italic: true}));
        else if (node.t === "Underline") result.push(...runs(node.c, {...style, underline: true}));
        else if (node.t === "Strikeout") result.push(...runs(node.c, {...style, strike: true}));
        else if (node.t === "Superscript" || node.t === "Subscript") result.push(...runs(node.c, {...style, baseline: node.t === "Superscript" ? "superscript" : "subscript"}));
        else if (node.t === "Span" || node.t === "Cite") result.push(...runs(node.c[1], style));
        else if (node.t === "Link") result.push(...runs(node.c[1], {...style, link: node.c[2][0]}));
        else if (node.t === "Quoted") result.push(...runs([{t: "Str", c: node.c[0] === "SingleQuote" ? "‘" : "“"}, ...node.c[1], {t: "Str", c: node.c[0] === "SingleQuote" ? "’" : "”"}], style));
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
          if (prev && !prev.image && !next.image && !prev.code && !next.code && prev.text !== "\n" && next.text !== "\n" &&
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
      // Sidecars keep relationship/paragraph properties out of the structured content API.
      paragraphs.push({runs: content, properties});
      target.push({kind: "paragraph", ...(level === undefined ? {} : {level}), runs: content.map(({code: _code, link: _link, strike: _strike, baseline: _baseline, image: _image, ...run}) => run)});
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
    const {createDocumentArchive, writeDocumentArchive, DocumentXmlEditor, Image} = await import("safe-bash-docx-engine/pandoc-adapter");
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
    const edit = async (node: import("safe-bash-docx-engine").XmlElement): Promise<void> => {
      await ctx.cooperate();
      if (node.namespace === w && node.localName === "p") {
        const extra = paragraphs[paragraphIndex++];
        if (!extra) return;
        const replacements = new Map<import("safe-bash-docx-engine").XmlElement, string>();
        const properties = node.children.find(child => child.localName === "pPr");
        if (properties && extra.properties) replacements.set(properties, `<w:pPr>${main.sourceXml(properties, new Map(), true)}${extra.properties}</w:pPr>`);
        const nativeRuns = node.children.filter(child => child.localName === "r");
        for (const [index, run] of extra.runs.entries()) {
          ctx.checkpoint();
          const native = nativeRuns[index]!;
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
        if (extra.properties || replacements.size) main.replaceElement(node, `<w:p xmlns:w="${w}">${!properties && extra.properties ? `<w:pPr>${extra.properties}</w:pPr>` : ""}${main.sourceXml(node, replacements, true)}</w:p>`);
      } else for (const child of node.children) await edit(child);
    };
    await edit(main.root);
    if (numbering.length) linkRelationships.push(`<Relationship Id="rId${relationshipId++}" Type="${r}/numbering" Target="numbering.xml"/>`);
    if (linkRelationships.length) relationships.insertChildren(relationships.root, linkRelationships.map(xml => xml.replace("<Relationship ", '<Relationship xmlns="http://schemas.openxmlformats.org/package/2006/relationships" ')).join(""));

    const types = new DocumentXmlEditor(archive.members.find(member => member.name === "[Content_Types].xml")!.bytes, {}, undefined, mc.budget);
    const typeOverrides = [
      ...(numbering.length ? ['<Override xmlns="http://schemas.openxmlformats.org/package/2006/content-types" PartName="/word/numbering.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.numbering+xml"/>'] : []),
      ...[...media.values()].map(entry => `<Override xmlns="http://schemas.openxmlformats.org/package/2006/content-types" PartName="/word/${entry.name}" ContentType="${entry.type}"/>`)
    ];
    if (typeOverrides.length) types.insertChildren(types.root, typeOverrides.join(""));
    const parts = new Map([["word/document.xml", main.serialize()], ["word/_rels/document.xml.rels", relationships.serialize()], ["[Content_Types].xml", types.serialize()]]);
    if (paragraphs.some(paragraph => paragraph.runs.some(run => run.code))) {
      const styles = new DocumentXmlEditor(archive.members.find(member => member.name === "word/styles.xml")!.bytes, {}, undefined, mc.budget);
      styles.insertChildren(styles.root, `<w:style xmlns:w="${w}" w:type="character" w:styleId="VerbatimChar"><w:name w:val="Verbatim Char"/><w:rPr><w:rFonts w:ascii="Courier New" w:hAnsi="Courier New"/></w:rPr></w:style>`);
      parts.set("word/styles.xml", styles.serialize());
    }
    const members = archive.members.map(member => ({...member, bytes: parts.get(member.name) ?? member.bytes}));
    for (const entry of media.values()) members.push({name: `word/${entry.name}`, bytes: entry.bytes, directory: false, modified: new Date(0)});
    if (numbering.length) members.push({name: "word/numbering.xml", bytes: new TextEncoder().encode(`<w:numbering xmlns:w="${w}">${numbering.join("")}${numbering.map((_, i) => `<w:num w:numId="${i + 1}"><w:abstractNumId w:val="${i + 1}"/></w:num>`).join("")}</w:numbering>`), directory: false, modified: new Date(0)});
    const chunks: Uint8Array[] = []; let size = 0;
    await writeDocumentArchive({members, comment: archive.comment}, {async write(bytes) {size += bytes.length; ctx.bound("outputBytes", size); ctx.charge("retainedBytes", bytes.length); chunks.push(new Uint8Array(bytes));}}, {order: "name", compression: "store"}, archiveContext);
    const bytes = new Uint8Array(size); let offset = 0;
    for (const chunk of chunks) {bytes.set(chunk, offset); offset += chunk.length;}
    return {kind: "binary", bytes};
  });
}};

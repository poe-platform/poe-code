import {
  Presentation, createPresentation, readPresentationText, readTextParagraphs,
  readSelectionIndex, readAnimations, readCharts, readObjects, readNotes,
  mutateNotes, mutateTextParagraphs, Picture, GraphicFrame, Image, Emu, Pt,
  readLayouts, removeSlides, addSlide, readImages, Shape, PP_PLACEHOLDER_TYPE,
  type PresentationContext, type ParagraphBullet, type LayoutRecord,
  OfficeError
} from "pptx";
import type { Attr, Block, Inline, Row } from "./ast-types.js";
import type { AdapterContext, Document, ReaderCapability, WriterCapability } from "./types.js";
import { PandocError } from "./errors.js";

const attr: Attr = ["", [], []];
function engineContext(context: AdapterContext): PresentationContext & Required<Pick<PresentationContext, "limits" | "archiveLimits" | "xmlLimits" | "relationshipLimits">> {
  const l = context.limits;
  return {
    ...(context.signal ? {signal: context.signal} : {}),
    limits: {maxBytes: Math.min(l.binaryBytes, Math.max(l.inputBytes, l.outputBytes)), maxReads: l.work, chunkBytes: 4096},
    archiveLimits: {maxArchiveBytes: l.compressedBytes, maxEntryBytes: l.binaryBytes,
      maxTotalBytes: l.expandedBytes, maxMembers: l.parts, maxPathBytes: 1024,
      maxDepth: l.depth, maxPaxBytes: 4096, maxTextBytes: l.text, chunkSize: 4096},
    xmlLimits: {maxBytes: l.binaryBytes, maxNodes: l.xmlNodes, maxDepth: l.xmlDepth},
    relationshipLimits: {maxBytes: l.binaryBytes, maxParts: l.parts, maxRelationships: l.references}
  };
}
function fail(context: AdapterContext, message: string, code: "E_OPTION" | "E_CAPABILITY" | "E_RESOURCE" = "E_CAPABILITY"): never {
  throw new PandocError(code, context.operation ?? "convert", message, "pptx");
}
function loss(context: AdapterContext, message: string): void {
  if (!context.lossy) fail(context, message);
  context.report({code: "W_PRESENTATION_LOSS", operation: context.operation ?? "read", format: "pptx", message});
}
async function guarded<T>(context: AdapterContext, action: () => Promise<T>): Promise<T> {
  try { return await action(); }
  catch (error) {
    if (!(error instanceof OfficeError)) throw error;
    throw new PandocError(error.code === "cancelled" ? "E_CANCELLED" : error.code === "resource-limit" ? "E_LIMIT" : "E_PARSE",
      context.operation ?? "convert", error.message, "pptx");
  }
}
function setting(document: Document, key: string, fallback: string, context: AdapterContext): string {
  const value = document.metadata[key];
  if (!value) return fallback;
  if (value.t !== "MetaString") fail(context, `${key} requires a string`, "E_OPTION");
  return value.c;
}
function slideLevel(document: Document, context: AdapterContext): number {
  const value = setting(document, "pptx-slide-level", "1", context);
  if (!["1", "2", "3", "4", "5", "6"].includes(value)) fail(context, "pptx-slide-level requires an explicit integer from 1 to 6", "E_OPTION");
  return Number(value);
}
function imageLength(value: string | undefined, natural: number, context: AdapterContext): number {
  if (value === undefined) return natural;
  const units: Record<string, number> = {in: 914400, pt: 12700, cm: 360000, mm: 36000, px: 9525};
  const unit = Object.keys(units).find(unit => value.endsWith(unit));
  const number = unit ? Number(value.slice(0, -unit.length)) : NaN;
  if (!unit || !Number.isFinite(number) || number <= 0) fail(context, "Image dimensions require positive in, pt, cm, mm or px values", "E_OPTION");
  return Math.round(number * units[unit]!);
}
interface SlideContent { title: readonly Inline[] | undefined; blocks: Block[]; notes: Block[] }
function slides(document: Document, level: number): SlideContent[] {
  const result: SlideContent[] = [];
  let current: SlideContent | undefined;
  for (const block of document.blocks) {
    if (block.t === "Div" && block.c[0][1].includes("slide")) {
      current = {title: undefined, blocks: [], notes: []};
      result.push(current);
      for (const child of block.c[1]) {
        if (child.t === "Header" && child.c[0] === level && current.title === undefined && !current.blocks.length) current.title = child.c[2];
        else if (child.t === "Div" && child.c[0][1].includes("notes")) current.notes.push(...child.c[1]);
        else current.blocks.push(child);
      }
    } else if (block.t === "Header" && block.c[0] === level) {
      current = {title: block.c[2], blocks: [], notes: []};
      result.push(current);
    } else if (block.t === "HorizontalRule") {
      current = {title: undefined, blocks: [], notes: []};
      result.push(current);
    } else {
      if (!current) { current = {title: undefined, blocks: [], notes: []}; result.push(current); }
      if (block.t === "Div" && block.c[0][1].includes("notes")) current.notes.push(...block.c[1]);
      else current.blocks.push(block);
    }
  }
  return result;
}
function plainContent(nodes: readonly Inline[], context: AdapterContext): string {
  if (nodes.some(n => !["Str", "Space", "SoftBreak", "LineBreak", "Code"].includes(n.t))) fail(context, "Notes and table cells require plaintext; rich content is unsupported");
  return plain(nodes, context);
}
function plain(nodes: readonly Inline[], context: AdapterContext): string {
  return nodes.map(node => {
    context.checkpoint();
    switch (node.t) {
      case "Str": return node.c;
      case "Space": case "SoftBreak": return " ";
      case "LineBreak": return "\v";
      case "Code": return node.c[1];
      case "Link": case "Span": return plain(node.c[1], context);
      case "Emph": case "Strong": return plain(node.c, context);
      default: return fail(context, `Unsupported PPTX inline: ${node.t}`);
    }
  }).join("");
}
function writeInline(shape: Shape, nodes: readonly Inline[], context: AdapterContext): void {
  shape.text_frame.clear();
  const paragraph = shape.text_frame.paragraphs[0]!;
  const add = (inlines: readonly Inline[], bold = false, italic = false, url?: string): void => {
    for (const node of inlines) {
      context.checkpoint();
      if (node.t === "Strong") add(node.c, true, italic, url);
      else if (node.t === "Emph") add(node.c, bold, true, url);
      else if (node.t === "Span") add(node.c[1], bold, italic, url);
      else if (node.t === "Link") {
        if (!node.c[2][0] || node.c[2][0].startsWith("#")) fail(context, "Internal document links require slide target resolution");
        add(node.c[1], bold, italic, node.c[2][0]);
      } else if (node.t === "LineBreak") paragraph.add_line_break();
      else {
        const run = paragraph.add_run();
        run.text = plain([node], context);
        run.font.bold = bold; run.font.italic = italic; run.font.size = new Pt(20);
        if (url) run.hyperlink.address = url;
      }
    }
  };
  add(nodes);
}
type BulletEdit = { slide: number; shape: string; bullet: ParagraphBullet; level: number };
interface Box {x: number; y: number; width: number; height: number}
function referenceBox(layout: LayoutRecord | undefined, types: readonly string[], fallback: Box, width: number, height: number, context: AdapterContext) {
  const matches = layout?.placeholders.filter(p => types.includes(p.type)) ?? [];
  if (matches.length > 1) fail(context, "Ambiguous reference content placeholders");
  const placeholder = matches[0];
  if (!placeholder) return {box: fallback, placeholder};
  const {x, y, width: w, height: h} = placeholder;
  if (x === null || y === null || w === null || h === null || ![x, y, w, h].every(Number.isSafeInteger) || x < 0 || y < 0 || w <= 0 || h <= 0 || x + w > width || y + h > height)
    fail(context, "Missing or overflowing reference placeholder geometry");
  return {box: {x, y, width: w, height: h}, placeholder};
}

export const pptxWriter: WriterCapability = {
  format: "pptx",
  async write(document, context) {
    return guarded(context, async () => {
      const ec = engineContext(context);
      const content = slides(document, slideLevel(document, context));
      context.report({code: "W_LAYOUT_UNMEASURED", operation: context.operation ?? "write", format: "pptx", message: "Text is preserved within authored-content and geometry limits; text fit is unmeasured and may overflow. No rendering engine is used."});
      context.bound("pages", content.length);
      const reference = setting(document, "pptx-reference", "", context);
      const selectedLayouts: LayoutRecord[] = [];
      let bytes: Uint8Array;
      if (reference) {
        if (!context.resources) fail(context, "Reference deck requires an explicit resource capability", "E_RESOURCE");
        bytes = await context.resources.resolve(reference, undefined, context.signal);
        context.bound("inputBytes", bytes.byteLength);
        const layoutRecords = await readLayouts(bytes, ec);
        if ((await readSelectionIndex(bytes, ec)).slides.length)
          bytes = await removeSlides(bytes, {selection: {kind: "slide", all: true}, referencePolicy: "remove"}, ec);
        for (const item of content) {
          const kind = item.title ? item.blocks.length ? "title-body" : "title-only" : "blank";
          const name = setting(document, `pptx-layout-${kind}`, {"title-body": "Title and Content", "title-only": "Title Only", blank: "Blank"}[kind], context);
          const matches = layoutRecords.filter(l => l.name === name);
          if (matches.length !== 1) fail(context, `Missing or ambiguous reference layout: ${name}`);
          if (!["blank", "titleOnly", "title", "tx", "obj"].includes(matches[0]!.type)) fail(context, `Unsupported reference layout type: ${matches[0]!.type}; only single-column layouts are supported`);
          selectedLayouts.push(matches[0]!);
          bytes = await addSlide(bytes, {layout: matches[0]!.part}, ec);
        }
      } else bytes = await createPresentation({width: 12192000, height: 6858000}, ec);
      const model = await Presentation(bytes, ec);
      const width = model.slide_width!.emu, height = model.slide_height!.emu;
      const margin = Math.round(width * 0.05), bodyWidth = width - margin * 2;
      const bullets: BulletEdit[] = [];
      for (const [index, item] of content.entries()) {
        await context.cooperate();
        const slide = reference ? model.slides.get(index) : model.slides.add_slide(model.slide_layouts.get(0));
        const layout = selectedLayouts[index];
        const body = referenceBox(layout, ["body", "obj"], {x: margin, y: 1400000, width: bodyWidth, height: height - 1900000}, width, height, context).box;
        if (reference) for (const shape of slide.shapes) if (shape instanceof Shape && shape.is_placeholder && shape.has_text_frame) shape.text_frame.clear();
        let y = body.y;
        const paragraph = (nodes: readonly Inline[], level = 0, bullet?: ParagraphBullet) => {
          const text = plain(nodes, context);
          // This is an authored-content admission ceiling, not measured text fit.
          if (text.length > 800 || y + 450000 > body.y + body.height || body.width - level * 300000 <= 0) fail(context, "PPTX content exceeds the conservative paragraph/geometry admission policy");
          context.charge("objects", 1);
          const shape = slide.shapes.add_textbox(new Emu(body.x + level * 300000), new Emu(y), new Emu(body.width - level * 300000), new Emu(450000));
          writeInline(shape, nodes, context);
          shape.text_frame.paragraphs[0]!.level = level;
          shape.name = `Pandoc paragraph ${shape.shape_id}`;
          if (bullet) bullets.push({slide: index + 1, shape: shape.name, level, bullet});
          y += 500000;
          return shape;
        };
        if (item.title) {
          const {box, placeholder} = referenceBox(layout, ["title", "ctrTitle"], {x: margin, y: 400000, width: bodyWidth, height: 800000}, width, height, context);
          const native = placeholder ? [...slide.shapes].find(shape => shape instanceof Shape && shape.is_placeholder && shape.has_text_frame && shape.placeholder_format.idx === placeholder.index && shape.placeholder_format.type === PP_PLACEHOLDER_TYPE.from_xml(placeholder.type)) : undefined;
          const title = native instanceof Shape ? native : slide.shapes.add_textbox(new Emu(box.x), new Emu(box.y), new Emu(box.width), new Emu(box.height));
          title.left = new Emu(box.x); title.top = new Emu(box.y);
          title.width = new Emu(box.width); title.height = new Emu(box.height);
          title.name = "Pandoc slide title";
          writeInline(title, item.title, context);
          for (const run of title.text_frame.paragraphs[0]!.runs) run.font.size = new Pt(30);
        }
        const blocks = async (nodes: readonly Block[], level = 0, bullet?: ParagraphBullet): Promise<void> => {
          let firstParagraph = true;
          for (const block of nodes) {
            await context.cooperate();
            if (level > 8) fail(context, "PPTX lists support at most nine levels");
            switch (block.t) {
              case "Para": case "Plain": {
                const image = block.c.length === 1 && block.c[0]!.t === "Image" ? block.c[0]! : undefined;
                if (!image) {
                  const shape = paragraph(block.c, level, firstParagraph ? bullet : undefined);
                  if (bullet && !firstParagraph) shape.name = "Pandoc list continuation";
                  firstParagraph = false;
                  break;
                }
                if (bullet) fail(context, "Images inside list items are unsupported");
                const id = image.c[2][0];
                const media = document.resources.find(r => r.id === id)?.bytes;
                if (!media) fail(context, `Missing image resource: ${id}`, "E_RESOURCE");
                const asset = new Image(media);
                if (!["image/png", "image/jpeg"].includes(asset.content_type)) fail(context, "Only PNG and JPEG pictures are supported");
                const attrs = Object.fromEntries(image.c[0][2]);
                const naturalWidth = asset.size[0] * 914400 / asset.dpi[0];
                const naturalHeight = asset.size[1] * 914400 / asset.dpi[1];
                let w = imageLength(attrs.width, naturalWidth, context), h = imageLength(attrs.height, naturalHeight, context);
                if (attrs.width && !attrs.height) h = Math.round(w * naturalHeight / naturalWidth);
                if (attrs.height && !attrs.width) w = Math.round(h * naturalWidth / naturalHeight);
                if (Math.abs(w / h - naturalWidth / naturalHeight) > 0.01) fail(context, "Picture dimensions must preserve aspect ratio");
                if (attrs.width || attrs.height) {
                  if (w > body.width || y + h > body.y + body.height) fail(context, "Explicit image dimensions overflow the slide");
                } else {
                  const scale = Math.min(1, body.width / w, (body.y + body.height - y) / h);
                  w = Math.round(w * scale); h = Math.round(h * scale);
                }
                context.charge("images", 1);
                const picture = await slide.shapes.add_picture(media, new Emu(body.x), new Emu(y), new Emu(w), new Emu(h));
                picture.name = plain(image.c[1], context);
                y += h + 500000;
                break;
              }
              case "Header": paragraph(block.c[2], level); break;
              case "BulletList":
                for (const item of block.c) await blocks(item, bullet ? level + 1 : level, {kind: "character", character: "•"});
                break;
              case "OrderedList":
                if (!["Decimal", "DefaultStyle"].includes(block.c[0][1])) fail(context, "Only decimal numbered lists are supported");
                for (const [i, item] of block.c[1].entries()) await blocks(item, bullet ? level + 1 : level, {kind: "numbered", scheme: "arabicPeriod", startAt: block.c[0][0] + i});
                break;
              case "Table": {
                if (bullet || block.c[1][0]?.length || block.c[1][1].length) fail(context, "Table captions and tables in lists are unsupported");
                if (block.c[2].some(([alignment, width]) => alignment !== "AlignDefault" || width.t !== "ColWidthDefault"))
                  fail(context, "Explicit table column alignment and widths are unsupported");
                if (block.c[3][1].length > 1 || block.c[5][1].length)
                  fail(context, "Multiple table header rows and table footers are unsupported");
                const rows = [...block.c[3][1], ...block.c[4].flatMap(body => {
                  if (body[1] || body[2].length) fail(context, "Intermediate table headers and row headers are unsupported");
                  return body[3];
                }), ...block.c[5][1]];
                const count = block.c[2].length;
                const h = rows.length * 450000;
                if (!rows.length || !count || y + h > body.y + body.height) fail(context, "Table geometry overflows the slide");
                const table = slide.shapes.add_table(rows.length, count, new Emu(body.x), new Emu(y), new Emu(body.width), new Emu(h)).table;
                table.first_row = block.c[3][1].length > 0;
                for (const [r, row] of rows.entries()) {
                  if (row[1].length !== count) fail(context, "PPTX tables require rectangular unmerged rows");
                  for (const [c, cell] of row[1].entries()) {
                    if (cell[2] !== 1 || cell[3] !== 1 || cell[1] !== "AlignDefault") fail(context, "Table spans and explicit alignment are unsupported");
                    const values = cell[4].map(b => {
                      if (b.t !== "Plain" && b.t !== "Para") fail(context, "Table cells require plain paragraphs");
                      return plainContent(b.c, context);
                    });
                    table.cell(r, c).text = values.join("\n");
                  }
                }
                y += h + 500000;
                break;
              }
              default: fail(context, `Unsupported PPTX block: ${block.t}`);
            }
          }
        };
        await blocks(item.blocks);
      }
      let output = await model.save();
      for (const edit of bullets) {
        await context.cooperate();
        output = (await mutateTextParagraphs(output, {select: {kind: "slide", position: {coordinateSystem: "one-based", value: edit.slide}}, shape: edit.shape,
          paragraph: 0, bullet: edit.bullet, level: edit.level}, ec)).bytes;
      }
      for (const [i, item] of content.entries()) if (item.notes.length) {
        const text = item.notes.map(b => {
          if (b.t !== "Para" && b.t !== "Plain") fail(context, "Speaker notes require plain paragraphs");
          return plainContent(b.c, context);
        }).join("\n");
        output = (await mutateNotes(output, "add", {selection: {kind: "slide", position: {coordinateSystem: "one-based", value: i + 1}}, text}, ec)).bytes;
      }
      context.bound("outputBytes", output.byteLength);
      return {kind: "binary", bytes: output};
    });
  }
};

export const pptxReader: ReaderCapability = {
  format: "pptx",
  async read(input, context) {
    return guarded(context, async () => {
      const ec = engineContext(context);
      const index = await readSelectionIndex(input.bytes, ec);
      context.bound("pages", index.slides.length);
      for (const animation of await readAnimations(input.bytes, {}, ec)) if (animation.xml.length) loss(context, `Animations on slide ${animation.slide} cannot be converted`);
      if ((await readCharts(input.bytes, {}, ec)).length) loss(context, "Charts cannot be converted");
      const objects = await readObjects(input.bytes, ec);
      if (objects.objects.length) loss(context, "Embedded objects cannot be converted");
      const model = await Presentation(input.bytes, ec);
      const text = await readPresentationText(input.bytes, {}, ec);
      const formats = await readTextParagraphs(input.bytes, {}, ec);
      const notes = await readNotes(input.bytes, {}, ec);
      const pictures = await readImages(input.bytes, {scope: "slides"}, ec);
      const resources: Document["resources"][number][] = [];
      const blocks: Block[] = [];
      for (const [i, slide] of [...model.slides].entries()) {
        await context.cooperate();
        const visible: Block[] = [];
        let activeList: {levels: {kind: "bullet" | "numbered"; items: Block[][]}[]} | undefined;
        for (const shape of slide.shapes) {
          if (shape instanceof Picture) {
            activeList = undefined;
            const occurrence = pictures.occurrences.find(p => p.location.owner === slide.part.partname && p.shapeId === String(shape.shape_id));
            if (!occurrence || occurrence.external || !["image/png", "image/jpeg"].includes(occurrence.contentType ?? "") || Object.values(occurrence.crop).some(v => v !== 0)) {
              loss(context, "External, cropped or unsupported pictures cannot be converted"); continue;
            }
            if (!shape.width || !shape.height) fail(context, "Picture dimensions are unavailable");
            const id = `pptx-image-${i + 1}-${shape.shape_id}.${shape.image.ext}`;
            const bytes = shape.image.blob;
            context.charge("images", 1); context.charge("resourceBytes", bytes.byteLength);
            resources.push({id, bytes});
            visible.push({t: "Para", c: [{t: "Image", c: [["", [], [["width", `${shape.width.inches}in`], ["height", `${shape.height.inches}in`]]], [{t: "Str", c: occurrence.altText ?? shape.name}], [id, occurrence.title ?? ""]]}]});
            continue;
          }
          if (shape instanceof GraphicFrame && shape.has_table) {
            activeList = undefined;
            const table = shape.table;
            const rows: Row[] = [];
            for (let r = 0; r < table.rows.length; r++) {
              const cells: Row[1][number][] = [];
              for (let c = 0; c < table.columns.length; c++) {
                const cell = table.cell(r, c);
                if (cell.is_spanned || cell.span_width !== 1 || cell.span_height !== 1) fail(context, "Merged presentation tables are unsupported");
                cells.push([attr, "AlignDefault", 1, 1, cell.text.split("\n").map(text => ({t: "Plain", c: [{t: "Str", c: text}]}))]);
              }
              rows.push([attr, cells]);
            }
            const header = table.first_row ? rows.splice(0, 1) : [];
            visible.push({t: "Table", c: [attr, [null, []], [...table.columns].map(() => ["AlignDefault", {t: "ColWidthDefault"}]), [attr, header], [[attr, 0, [], rows]], [attr, []]]});
            continue;
          }
          if (!shape.has_text_frame) {
            activeList = undefined;
            loss(context, "Non-text slide content is not yet supported");
            continue;
          }
          const segment = text.segments.find(s => s.location.owner === slide.part.partname && s.location.objectId === String(shape.shape_id));
          if (!segment) continue;
          for (const [p, paragraph] of segment.paragraphs.entries()) {
            if (!paragraph.text) continue;
            let runIndex = 0;
            const inlines: Inline[] = paragraph.inlines.map(inline => {
              if (inline.kind === "break") return {t: "LineBreak"};
              let value: Inline = {t: "Str", c: inline.kind === "field" ? inline.cachedText : inline.text};
              if (inline.kind === "run") {
                const run = shape.text_frame.paragraphs[p]?.runs[runIndex++];
                if (run?.font.bold) value = {t: "Strong", c: [value]};
                if (run?.font.italic) value = {t: "Emph", c: [value]};
                if (run?.hyperlink.address) value = {t: "Link", c: [attr, [value], [run.hyperlink.address, ""]]};
              }
              return value;
            });
            const format = formats.find(f => f.location.owner === segment.location.owner && f.location.objectId === segment.location.objectId && f.paragraph === p)?.formatting;
            const bullet = format?.bullet;
            if (shape.name === "Pandoc list continuation" && activeList) {
              const item = activeList.levels[format?.level ?? 0]?.items.at(-1);
              if (!item) fail(context, "List continuation without a parent item");
              item.push({t: "Para", c: inlines}); continue;
            }
            if (bullet && bullet.kind !== "none") {
              const kind = bullet.kind === "numbered" ? "numbered" : "bullet";
              const level = format?.level ?? 0;
              if (!activeList) {
                if (level !== 0) fail(context, "Nested list without a parent item");
                activeList = {levels: []};
              }
              if (level > activeList.levels.length) fail(context, "List nesting skips a level");
              if (!activeList.levels[level] || activeList.levels[level]!.kind !== kind) {
                const items: Block[][] = [];
                const root: Block = kind === "bullet" ? {t: "BulletList", c: items} : {t: "OrderedList", c: [[bullet.kind === "numbered" ? bullet.startAt ?? 1 : 1, "Decimal", "Period"], items]};
                if (level === 0) visible.push(root);
                else {
                  const parent = activeList.levels[level - 1]!.items.at(-1);
                  if (!parent) fail(context, "Nested list without a parent item");
                  parent.push(root);
                }
                activeList.levels[level] = {kind, items};
              }
              activeList.levels.length = level + 1;
              activeList.levels[level]!.items.push([{t: "Plain", c: inlines}]);
            } else {
              activeList = undefined;
              const title = shape.name === "Pandoc slide title" || (shape.is_placeholder && [1, 3].includes(shape.placeholder_format.type));
              visible.push(title ? {t: "Header", c: [1, attr, inlines]} : {t: "Para", c: inlines});
            }
          }
        }
        const note = notes.find(n => n.slide === i + 1);
        if (note?.text !== null && note?.text !== undefined) visible.push({t: "Div", c: [["", ["notes"], []], note.text.split("\n").map(text => ({t: "Para", c: [{t: "Str", c: text}]}))]});
        blocks.push({t: "Div", c: [[`slide-${i + 1}`, ["slide"], [["data-pptx-order", "structural"]]], visible]});
      }
      return {blocks, metadata: {}, resources};
    });
  }
};

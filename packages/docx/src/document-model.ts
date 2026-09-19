import { snapshotSequence } from "./numeric-index.js";
import { admitDocumentModel } from "./model-admission.js";
import { type DocumentModelContext } from "./model-context.js";
import { type DocumentModelInput } from "./model-input.js";
import { ModelStore, type ModelRef } from "./model-store.js";
import { Sections } from "./section-model.js";
import { Comments, bindCommentRange } from "./review-model.js";
import type { Length } from "./formatting-values.js";
import type { DocumentOutput, DocumentSaveOptions } from "./model-output.js";
import { InputTypeError, InvalidValueError } from "./archive.js";
import { WD_BREAK, WD_SECTION_START, Emu, Inches, isLength } from "./formatting-values.js";
import { resolveHeadingStyle, type TableStyle } from "./styles-model.js";
import type { DocxEnumValue } from "./operation-types.js";
import { sectionAttribute } from "./section-properties.js";
import { runElementOpen } from "./run-properties.js";
import { Settings } from "./settings-model.js";
import { InlineShapes, insertModelImage } from "./inline-shape-model.js";
import { Image, type ImageModelInput } from "./image-model.js";
import { packageAdmitImages, DocumentPartView } from "./package-view.js";
import { activeModelChildren } from "./model-active-children.js";
import { appendBodyBlocks, UnsupportedEditError } from "./xml-write.js";

export class DocumentView {
  readonly ref: ModelRef;
  private boundSettings: Settings | undefined;
  private boundInlineShapes: InlineShapes | undefined;
  constructor(readonly store: ModelStore, owner = store.mainPart) {
    const root = store.xml(owner).root;
    const body = activeModelChildren(store, owner)(root).find(
      (child) => child.namespace === root.namespace && child.localName === "body"
    )!;
    this.ref = store.ref(owner, body);
  }
  equals(other: unknown): boolean {
    const node = this.store.node(this.ref);
    return other instanceof DocumentView && other.store === this.store && other.store.node(other.ref) === node;
  }
  get part() {
    this.store.node(this.ref);
    const part = this.store.part(this.ref.part);
    if (!(part instanceof DocumentPartView)) throw new InputTypeError("Expected a native document owner.");
    return part;
  }
  get element() {
    return this.store.element(
      this.store.ref(this.ref.part, this.store.xml(this.ref.part).root)
    );
  }
  get paragraphs() {
    return snapshotSequence([...this.store.blocks(this.ref)].filter(
      (block) => this.store.node(block.ref).localName === "p"
    ) as import("./block-model.js").Paragraph[]);
  }
  get tables() {
    return snapshotSequence([...this.store.blocks(this.ref)].filter(
      (block) => this.store.node(block.ref).localName === "tbl"
    ) as import("./table-model.js").Table[]);
  }
  get styles() {
    return this.store.stylesForDocument(this.ref.part);
  }
  get settings(): Settings {
    return (this.boundSettings ??= new Settings(this.store, undefined, this.ref.part));
  }
  get inline_shapes(): InlineShapes {
    return (this.boundInlineShapes ??= new InlineShapes(this.store, this.ref));
  }
  async add_picture(
    input: ImageModelInput,
    width?: number | Length | null,
    height?: number | Length | null
  ) {
    const image = await Image.from_file(input, this.store.context);
    return this.store.transaction(() => {
      const run = this.add_paragraph().add_run();
      return insertModelImage(this.store, run.ref, image, width, height);
    });
  }
  add_comment(
    runs: import("./block-model.js").Run | readonly import("./block-model.js").Run[],
    text = "",
    author = "",
    initials: string | null = ""
  ) {
    return this.store.transaction(() => bindCommentRange(this.store, runs, text, author, initials, this.ref.part));
  }
  get sections() {
    return new Sections(this.store, this.ref);
  }
  get comments() {
    return new Comments(this.store, this.store.ensureComments(this.ref.part));
  }
  get core_properties() {
    return this.store.package.core_properties;
  }
  iter_inner_content() {
    return this.store.blocks(this.ref);
  }
  add_paragraph(text = "", style?: string | import("./styles-model.js").ParagraphStyle | null) {
    return this.store.addParagraph(this.ref, text, style);
  }
  add_heading(text = "", level = 1) {
    if (typeof text !== "string" || !Number.isSafeInteger(level))
      throw new InputTypeError("Expected heading text and an integer level.");
    if (level < 0 || level > 9)
      throw new InvalidValueError("Heading level must be between 0 and 9.");
    return this.store.transaction(() => {
      const style = this.styles[resolveHeadingStyle](level);
      return this.store.addParagraph(this.ref, text, style);
    });
  }
  add_page_break() {
    return this.store.transaction(() => {
      const paragraph = this.store.addParagraph(this.ref);
      paragraph.add_run().add_break(WD_BREAK.PAGE);
      return paragraph;
    });
  }
  add_section(start_type: DocxEnumValue<"WD_SECTION_START"> = WD_SECTION_START.NEW_PAGE) {
    if (!Object.values(WD_SECTION_START).includes(start_type))
      throw new InputTypeError("Expected a section start enum.");
    return this.store.transaction(() => {
      this.store.change(this.ref.part, (xml) => {
        const body = this.store.node(this.ref),
          section = activeModelChildren(this.store, this.ref.part)(body).find(
            (node) => node.namespace === body.namespace && node.localName === "sectPr"
          );
        const old = section
          ? runElementOpen(section) + xml.sourceXml(section, new Map(), true) + `</${section.name}>`
          : `<ds:sectPr xmlns:ds="${body.namespace}"/>`;
        xml[appendBodyBlocks](
          body,
          `<ds:p xmlns:ds="${body.namespace}"><ds:pPr>${old}</ds:pPr></ds:p>` + (section ? "" : old)
        );
      });
      this.store.change(this.ref.part, (xml) => {
        const section = this.store.node(this.sections.at(-1).ref);
        const bindings = activeModelChildren(this.store, this.ref.part)(section).filter(
          node => node.namespace === section.namespace &&
            ["headerReference", "footerReference"].includes(node.localName)
        );
        const variants = new Set<string>();
        for (const binding of bindings) {
          const variant = sectionAttribute(binding, "type"), key = binding.localName + ":" + variant;
          if (!variant || !["default", "first", "even"].includes(variant) || variants.has(key))
            throw new UnsupportedEditError("Ambiguous section story bindings cannot be inherited.");
          variants.add(key);
        }
        xml.replaceElement(section, xml.sourceXml(section, new Map(bindings.map(binding => [binding, ""]))));
      });
      const section = this.sections.at(-1);
      section.start_type = start_type;
      return section;
    });
  }
  add_table(rows: number, cols: number, style?: string | TableStyle | null, width?: Length): import("./table-model.js").Table;
  add_table(rows: number, cols: number, width: Length): import("./table-model.js").Table;
  add_table(rows: number, cols: number, style?: string | TableStyle | Length | null, width?: Length) {
    if (isLength(style)) {
      if (width !== undefined) throw new InputTypeError("Choose one table width.");
      width = style;
      style = undefined;
    }
    if (width !== undefined && !isLength(width)) throw new InputTypeError("Expected a table width length.");
    if (width === undefined) {
      const section = this.sections.at(-1);
      const page = section.page_width,
        left = section.left_margin,
        right = section.right_margin;
      width = Emu((page ?? Inches(8.5)).emu - (left ?? Inches(1)).emu - (right ?? Inches(1)).emu);
    }
    return this.store.transaction(() => {
      const table = this.store.addTable(this.ref, rows, cols, width);
      if (style !== undefined && style !== null) table.style = style;
      return table;
    });
  }
  async save(output: DocumentOutput, options?: DocumentSaveOptions): Promise<void> {
    await this.store.save(output, options);
  }
}

export async function Document(
  input?: DocumentModelInput | null,
  context?: DocumentModelContext
): Promise<DocumentView> {
  const { archive, settings, source } = await admitDocumentModel(input, context);
  const store = new ModelStore(archive, settings, archive.mainPart, source);
  await store.package[packageAdmitImages]();
  return store.document;
}

export { Paragraph, Run } from "./block-model.js";

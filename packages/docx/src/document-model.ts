import { readDocumentArchive } from "./admission.js";
import { createDocumentArchive } from "./create.js";
import { modelContext, type DocumentModelContext } from "./model-context.js";
import { acquireDocumentModelInput, type DocumentModelInput } from "./model-input.js";
import { ModelStore, type ModelRef } from "./model-store.js";
import { Sections } from "./section-model.js";
import { Comments, bindCommentRange } from "./review-model.js";
import type { Length } from "./formatting-values.js";
import type { ArchiveSink } from "./archive-write.js";
import { InputTypeError, InvalidValueError } from "./archive.js";
import { WD_STYLE_TYPE, WD_BREAK, WD_SECTION_START, Emu, Inches } from "./formatting-values.js";
import type { DocxEnumValue } from "./operation-types.js";
import { mergeStyleChildren } from "./style-properties.js";
import { sectionPropertyOrder } from "./section-properties.js";
import { runElementOpen } from "./run-properties.js";

import { Settings } from "./settings-model.js";

export class DocumentView {
  readonly ref: ModelRef;
  private boundSettings: Settings | undefined;
  constructor(readonly store: ModelStore) {
    const root = store.xml(store.mainPart).root;
    const body = root.children.find(
      (child) => child.namespace === root.namespace && child.localName === "body"
    )!;
    this.ref = store.ref(store.mainPart, body);
  }
  get part() {
    return this.store.part(this.store.mainPart);
  }
  get element() {
    return this.store.element(
      this.store.ref(this.store.mainPart, this.store.xml(this.store.mainPart).root)
    );
  }
  get paragraphs() {
    return [...this.store.blocks(this.ref)].filter(
      (block) => this.store.node(block.ref).localName === "p"
    ) as import("./block-model.js").Paragraph[];
  }
  get tables() {
    return [...this.store.blocks(this.ref)].filter(
      (block) => this.store.node(block.ref).localName === "tbl"
    ) as import("./table-model.js").Table[];
  }
  get styles() {
    return this.store.styles;
  }
  get settings(): Settings {
    return (this.boundSettings ??= new Settings(this.store));
  }
  add_comment(
    runs: import("./block-model.js").Run | readonly import("./block-model.js").Run[],
    text = "",
    author = "",
    initials: string | null = ""
  ) {
    return this.store.transaction(() => bindCommentRange(this.store, runs, text, author, initials));
  }
  get sections() {
    return new Sections(this.store);
  }
  get comments() {
    return new Comments(this.store, this.store.ensureComments());
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
      const name = level === 0 ? "Title" : `Heading ${level}`;
      if (!this.styles.has(name)) this.styles.add_style(name, WD_STYLE_TYPE.PARAGRAPH, true);
      return this.store.addParagraph(this.ref, text, name);
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
          section = body.children.find(
            (node) => node.namespace === body.namespace && node.localName === "sectPr"
          );
        const old = section
          ? runElementOpen(section) + xml.sourceXml(section, new Map(), true) + `</${section.name}>`
          : `<ds:sectPr xmlns:ds="${body.namespace}"/>`;
        xml.insertChildren(
          body,
          `<ds:p xmlns:ds="${body.namespace}"><ds:pPr>${old}</ds:pPr></ds:p>`,
          section
        );
        if (!section) xml.insertChildren(body, old);
      });
      this.store.change(this.ref.part, (xml) => {
        const section = this.store.node(this.sections.at(-1).ref);
        xml.replaceElement(
          section,
          mergeStyleChildren(
            xml,
            section,
            new Map([
              ["headerReference", ""],
              ["footerReference", ""]
            ]),
            sectionPropertyOrder
          )
        );
      });
      const section = this.sections.at(-1);
      section.start_type = start_type;
      return section;
    });
  }
  add_table(rows: number, cols: number, width?: Length) {
    if (width === undefined) {
      const section = this.sections.at(-1);
      const page = section.page_width,
        left = section.left_margin,
        right = section.right_margin;
      width = Emu((page ?? Inches(8.5)).emu - (left ?? Inches(1)).emu - (right ?? Inches(1)).emu);
    }
    return this.store.addTable(this.ref, rows, cols, width);
  }
  async save(sink: ArchiveSink): Promise<void> {
    await this.store.save(sink);
  }
}

export async function Document(
  input?: DocumentModelInput | null,
  context?: DocumentModelContext
): Promise<DocumentView> {
  const settings = modelContext(context);
  const archive =
    input === undefined || input === null
      ? await createDocumentArchive(
          { timestamp: settings.timestamp.toISOString(), author: settings.author },
          settings
        )
      : await readDocumentArchive(await acquireDocumentModelInput(input, settings), settings);
  return new DocumentView(new ModelStore(archive, settings, archive.mainPart));
}

export { Paragraph, Run } from "./block-model.js";

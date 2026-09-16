import { readDocumentArchive } from "./admission.js";
import { createDocumentArchive } from "./create.js";
import { modelContext, type DocumentModelContext } from "./model-context.js";
import { acquireDocumentModelInput, type DocumentModelInput } from "./model-input.js";
import { ModelStore, type ModelRef } from "./model-store.js";
import { Sections } from "./section-model.js";
import { Comments, bindCommentRange } from "./review-model.js";
import type { Length } from "./formatting-values.js";
import type { ArchiveSink } from "./archive-write.js";

export class DocumentView {
  readonly ref: ModelRef;
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
  add_table(rows: number, cols: number, width?: Length) {
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

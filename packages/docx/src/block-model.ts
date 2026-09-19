import { requireComparisonOperand } from "./comparison-operand.js";
import { snapshotSequence } from "./numeric-index.js";
import type { ModelRef, ModelStore } from "./model-store.js";
import type { XmlElement } from "./package-xml.js";
import { InputTypeError } from "./archive.js";
import { Font, ParagraphFormat, modelFormattingOwner } from "./formatting-model.js";
import { paragraphTextRun, replaceParagraphContent, replaceRunContent } from "./paragraph-content.js";
import { xmlValue } from "./create-content.js";
import { Hyperlink, RenderedPageBreak, markCommentRange } from "./review-model.js";
import type { DocxEnumValue } from "./operation-types.js";
import type { ParagraphStyle, CharacterStyle } from "./styles-model.js";
import { WD_STYLE_TYPE, WD_BREAK, isEnumMember } from "./formatting-values.js";
import { insertParagraphBefore } from "./xml-write.js";
import { insertModelImage, Drawing } from "./inline-shape-model.js";
import type { ImageModelInput } from "./image-model-input.js";
import { Image } from "./image-model.js";
import type { Length } from "./formatting-values.js";
import { activeModelChildren } from "./model-active-children.js";

/** Stored text only; drawings and field instructions never execute. */
export function modelText(node: XmlElement, children: (node: XmlElement) => readonly XmlElement[] = node => node.children): string {
  let text = "";
  const visit = (current: XmlElement) => {
    if (current.namespace !== node.namespace) return;
    const name = current.localName;
    if (name === "t") text += current.text;
    else if (name === "tab" || name === "ptab") text += "\t";
    else if (name === "noBreakHyphen") text += "\u2011";
    else if (name === "softHyphen") text += "\u00ad";
    else if (
      name === "cr" ||
      (name === "br" &&
        !["page", "column"].includes(
          current.attributes.find((a) => a.localName === "type" && a.namespace === node.namespace)
            ?.value ?? ""
        ))
    )
      text += "\n";
    else if (["p", "hyperlink", "r"].includes(name))
      for (const child of children(current)) visit(child);
  };
  visit(node);
  return text;
}

export class Paragraph {
  constructor(
    readonly store: ModelStore,
    readonly ref: ModelRef
  ) {}
  equals(other: unknown): boolean {
    requireComparisonOperand(other);
    this.store.node(this.ref);
    return (
      other instanceof Paragraph &&
      other.store === this.store &&
      this.store.node(this.ref) === other.store.node(other.ref)
    );
  }
  get element() {
    return this.store.element(this.ref);
  }
  get part() {
    this.store.node(this.ref);
    return this.store.part(this.ref.part, true);
  }
  get text(): string {
    return modelText(this.store.node(this.ref), activeModelChildren(this.store, this.ref.part));
  }
  set text(value: string | null) {
    if (value !== null && typeof value !== "string") throw new InputTypeError("Expected paragraph text or null.");
    this.store.change(this.ref.part, (xml) => {
      const p = this.store.node(this.ref);
      const props = activeModelChildren(this.store, this.ref.part)(p).find(
        (child) => child.namespace === p.namespace && child.localName === "pPr"
      );
      xml.replaceElement(
        p,
        replaceParagraphContent(xml, p, props ? xml.sourceXml(props) : "", value ?? "", this.store.context.budget)
      );
    });
  }
  get runs(): readonly Run[] {
    const p = this.store.node(this.ref);
    return snapshotSequence(activeModelChildren(this.store, this.ref.part)(p)
      .filter((child) => child.namespace === p.namespace && child.localName === "r")
      .map((child) => this.store.run(this.store.ref(this.ref.part, child))));
  }
  get hyperlinks(): readonly Hyperlink[] {
    const p = this.store.node(this.ref);
    return snapshotSequence(activeModelChildren(this.store, this.ref.part)(p)
      .filter((child) => child.namespace === p.namespace && child.localName === "hyperlink")
      .map((child) => new Hyperlink(this.store, this.store.ref(this.ref.part, child))));
  }
  *iter_inner_content(): IterableIterator<Run | Hyperlink> {
    const p = this.store.node(this.ref);
    for (const child of activeModelChildren(this.store, this.ref.part)(p)) {
      this.store.context.budget.charge("work", 1);
      if (child.namespace !== p.namespace) continue;
      if (child.localName === "r") yield this.store.run(this.store.ref(this.ref.part, child));
      if (child.localName === "hyperlink")
        yield new Hyperlink(this.store, this.store.ref(this.ref.part, child));
    }
  }
  get rendered_page_breaks(): readonly RenderedPageBreak[] {
    const p = this.store.node(this.ref);
    const children = activeModelChildren(this.store, this.ref.part);
    const result: RenderedPageBreak[] = [];
    const visit = (node: XmlElement) => {
      this.store.context.budget.charge("work", 1);
      if (node.namespace !== p.namespace) return;
      if (node.localName === "lastRenderedPageBreak")
        result.push(
          new RenderedPageBreak(this.store, this.store.ref(this.ref.part, node), this.ref)
        );
      else for (const child of children(node)) visit(child);
    };
    visit(p);
    return snapshotSequence(result);
  }
  get contains_page_break(): boolean {
    return this.rendered_page_breaks.length > 0;
  }
  get paragraph_format(): ParagraphFormat {
    return new ParagraphFormat(modelFormattingOwner(this.store, this.ref));
  }
  get alignment() {
    return this.paragraph_format.alignment;
  }
  set alignment(value: DocxEnumValue<"WD_PARAGRAPH_ALIGNMENT"> | null) {
    this.paragraph_format.alignment = value;
  }
  get style(): ParagraphStyle | null {
    const p = this.store.node(this.ref);
    const children = activeModelChildren(this.store, this.ref.part);
    const props = children(p).find(child => child.namespace === p.namespace && child.localName === "pPr");
    const id = props ? children(props)
        .find(child => child.namespace === p.namespace && child.localName === "pStyle")
        ?.attributes.find(a => a.namespace === p.namespace && a.localName === "val")?.value ?? null : null;
    return this.store.stylesForStory(this.ref.part).get_by_id(id, WD_STYLE_TYPE.PARAGRAPH) as ParagraphStyle | null;
  }
  set style(value: string | ParagraphStyle | null) {
    const id = this.store.stylesForStory(this.ref.part).get_style_id(value, WD_STYLE_TYPE.PARAGRAPH);
    this.store.change(this.ref.part, (xml) => {
      const children = activeModelChildren(this.store, this.ref.part);
      const p = this.store.node(this.ref),
        props = children(p).find(child => child.namespace === p.namespace && child.localName === "pPr");
      const old = props && children(props).find(child => child.namespace === p.namespace && child.localName === "pStyle");
      const replacement =
        id === null ? "" : `<bm:pStyle xmlns:bm="${p.namespace}" bm:val="${xmlValue(id)}"/>`;
      if (old) xml.replaceElement(old, replacement);
      else if (replacement) {
        if (props) xml.insertChildren(props, replacement, props.children[0]);
        else
          xml.insertChildren(
            p,
            `<bm:pPr xmlns:bm="${p.namespace}">${replacement}</bm:pPr>`,
            p.children[0]
          );
      } else if (!props) {
        xml.insertChildren(p, `<bm:pPr xmlns:bm="${p.namespace}"/>`, p.children[0]);
      }
    });
  }
  add_run(text?: string | null, style?: string | CharacterStyle | null): Run {
    if (text !== undefined && text !== null && typeof text !== "string")
      throw new InputTypeError("Expected run text.");
    return this.store.transaction(() => {
      const styleId =
        style === undefined || style === null
          ? null
          : this.store.stylesForStory(this.ref.part).get_style_id(style, WD_STYLE_TYPE.CHARACTER);
      this.store.change(this.ref.part, (xml) => {
        const p = this.store.node(this.ref);
        xml.insertChildren(p, paragraphTextRun(p.namespace, text ?? "", styleId ?? undefined));
      });
      const p = this.store.node(this.ref);
      return this.store.run(this.store.ref(this.ref.part, p.children.at(-1)!));
    });
  }
  clear(): this {
    this.text = "";
    return this;
  }
  insert_paragraph_before(text?: string | null, style?: string | ParagraphStyle | null): Paragraph {
    if (text !== undefined && text !== null && typeof text !== "string")
      throw new InputTypeError("Expected paragraph text or null.");
    return this.store.transaction(() => {
      const styleId =
        style === undefined || style === null
          ? null
          : this.store.stylesForStory(this.ref.part).get_style_id(style, WD_STYLE_TYPE.PARAGRAPH);
      const p = this.store.node(this.ref);
      let path: readonly number[] | undefined;
      this.store.change(this.ref.part, (editor) => {
        path = editor[insertParagraphBefore](
          this.store.node(this.ref),
          `<bm:p xmlns:bm="${p.namespace}">${styleId ? `<bm:pPr><bm:pStyle bm:val="${xmlValue(styleId)}"/></bm:pPr>` : ""}${text ? paragraphTextRun(p.namespace, text) : ""}</bm:p>`
        );
      });
      let inserted = this.store.xml(this.ref.part).root;
      for (const index of path!) inserted = inserted.children[index]!;
      return this.store.paragraph(this.store.ref(this.ref.part, inserted));
    });
  }
}

export class Run {
  constructor(
    readonly store: ModelStore,
    readonly ref: ModelRef
  ) {}
  equals(other: unknown): boolean {
    requireComparisonOperand(other);
    this.store.node(this.ref);
    return (
      other instanceof Run &&
      other.store === this.store &&
      this.store.node(this.ref) === other.store.node(other.ref)
    );
  }
  get element() {
    return this.store.element(this.ref);
  }
  get part() {
    this.store.node(this.ref);
    return this.store.part(this.ref.part, true);
  }
  get text(): string {
    return modelText(this.store.node(this.ref), activeModelChildren(this.store, this.ref.part));
  }
  set text(value: string) {
    if (typeof value !== "string") throw new InputTypeError("Expected run text.");
    this.store.change(this.ref.part, (xml) => {
      const r = this.store.node(this.ref);
      const props = activeModelChildren(this.store, this.ref.part)(r).find(
        (child) => child.localName === "rPr" && child.namespace === r.namespace
      );
      xml.replaceElement(r, replaceRunContent(xml, r, props ? xml.sourceXml(props) : "", value, this.store.context.budget));
    });
  }
  get style(): CharacterStyle | null {
    const r = this.store.node(this.ref);
    const children = activeModelChildren(this.store, this.ref.part);
    const props = children(r).find(child => child.namespace === r.namespace && child.localName === "rPr");
    const id = props ? children(props)
        .find(child => child.namespace === r.namespace && child.localName === "rStyle")
        ?.attributes.find(a => a.namespace === r.namespace && a.localName === "val")?.value ?? null : null;
    return this.store.stylesForStory(this.ref.part).get_by_id(id, WD_STYLE_TYPE.CHARACTER) as CharacterStyle | null;
  }
  set style(value: string | CharacterStyle | null) {
    const id = this.store.stylesForStory(this.ref.part).get_style_id(value, WD_STYLE_TYPE.CHARACTER);
    this.store.change(this.ref.part, (xml) => {
      const children = activeModelChildren(this.store, this.ref.part);
      const r = this.store.node(this.ref),
        props = children(r).find(child => child.namespace === r.namespace && child.localName === "rPr");
      const old = props && children(props).find(child => child.namespace === r.namespace && child.localName === "rStyle");
      const replacement =
        id === null ? "" : `<bm:rStyle xmlns:bm="${r.namespace}" bm:val="${xmlValue(id)}"/>`;
      if (old) xml.replaceElement(old, replacement);
      else if (props) {
        if (replacement) xml.insertChildren(props, replacement, props.children[0]);
      } else
        xml.insertChildren(
          r,
          `<bm:rPr xmlns:bm="${r.namespace}">${replacement}</bm:rPr>`,
          r.children[0]
        );
    });
  }
  get font(): Font {
    return new Font(modelFormattingOwner(this.store, this.ref));
  }
  get bold(): boolean | null {
    return this.font.bold;
  }
  set bold(value: boolean | null) {
    this.font.bold = value;
  }
  get italic(): boolean | null {
    return this.font.italic;
  }
  set italic(value: boolean | null) {
    this.font.italic = value;
  }
  get underline() {
    return this.font.underline;
  }
  set underline(value: boolean | DocxEnumValue<"WD_UNDERLINE"> | null) {
    this.font.underline = value;
  }
  clear(): this {
    this.text = "";
    return this;
  }
  add_text(text: string) {
    if (typeof text !== "string") throw new InputTypeError("Expected run text.");
    this.store.change(this.ref.part, (xml) => {
      const r = this.store.node(this.ref);
      xml.insertChildren(
        r,
        `<bm:t xmlns:bm="${r.namespace}" xml:space="preserve">${xmlValue(text)}</bm:t>`
      );
    });
    return this.element.children.at(-1);
  }
  add_tab(): void {
    this.store.change(this.ref.part, (xml) => {
      const r = this.store.node(this.ref);
      xml.insertChildren(r, `<bm:tab xmlns:bm="${r.namespace}"/>`);
    });
  }
  add_break(type: DocxEnumValue<"WD_BREAK_TYPE"> = WD_BREAK.LINE): void {
    if (!isEnumMember(type) || type.enum !== "WD_BREAK_TYPE")
      throw new InputTypeError("Expected a trusted break enum.");
    const attributes: Readonly<Record<string, string>> = {
      LINE: "",
      PAGE: ' bm:type="page"',
      COLUMN: ' bm:type="column"',
      LINE_CLEAR_LEFT: ' bm:clear="left"',
      LINE_CLEAR_RIGHT: ' bm:clear="right"',
      LINE_CLEAR_ALL: ' bm:clear="all"'
    };
    const markup = attributes[type.name];
    if (markup === undefined) throw new InputTypeError("The break cannot be inserted in a run.");
    this.store.change(this.ref.part, (xml) => {
      const r = this.store.node(this.ref);
      xml.insertChildren(r, `<bm:br xmlns:bm="${r.namespace}"${markup}/>`);
    });
  }
  mark_comment_range(last_run: Run, comment_id: number): void {
    this.store.transaction(() => markCommentRange(this.store, this, last_run, comment_id));
  }
  async add_picture(input: ImageModelInput, width?: Length | null, height?: Length | null) {
    const image = await Image.from_file(input, this.store.context);
    return insertModelImage(this.store, this.ref, image, width, height);
  }
  get contains_page_break(): boolean {
    const r = this.store.node(this.ref);
    return activeModelChildren(this.store, this.ref.part)(r).some(
      (child) => child.localName === "lastRenderedPageBreak" && child.namespace === r.namespace
    );
  }
  *iter_inner_content(): IterableIterator<string | RenderedPageBreak | Drawing> {
    const run = this.store.node(this.ref);
    const findParagraph = (node: XmlElement, paragraph?: XmlElement): XmlElement | undefined => {
      this.store.context.budget.charge("work", 1);
      const owner = node.localName === "p" && node.namespace === run.namespace ? node : paragraph;
      if (node === run) return owner;
      for (const child of node.children) {
        const found = findParagraph(child, owner);
        if (found) return found;
      }
      return undefined;
    };
    const paragraph = findParagraph(this.store.xml(this.ref.part).root);
    let text = "";
    for (const child of activeModelChildren(this.store, this.ref.part)(run)) {
      this.store.context.budget.charge("work", 1);
      if (child.namespace !== run.namespace) continue;
      if (child.localName === "lastRenderedPageBreak") {
        if (text) { yield text; text = ""; }
        if (paragraph) yield new RenderedPageBreak(this.store, this.store.ref(this.ref.part, child), this.store.ref(this.ref.part, paragraph));
      } else if (child.localName === "drawing") {
        if (text) { yield text; text = ""; }
        yield new Drawing(this.store, this.store.ref(this.ref.part, child));
      } else if (["t", "tab", "ptab", "noBreakHyphen", "softHyphen", "br", "cr"].includes(child.localName)) {
        text += modelText(child);
      }
    }
    if (text) yield text;
  }
}

import type { ModelRef, ModelStore } from "./model-store.js";
import type { XmlElement } from "./package-xml.js";
import { InputTypeError } from "./archive.js";
import { Font, ParagraphFormat, type FormattingXmlOwner } from "./formatting-model.js";
import { paragraphTextRun, replaceParagraphContent } from "./paragraph-content.js";
import { runElementOpen } from "./run-properties.js";
import { xmlValue } from "./create-content.js";
import { Hyperlink, RenderedPageBreak, markCommentRange } from "./review-model.js";
import type { DocxEnumValue } from "./operation-types.js";
import type { ParagraphStyle, CharacterStyle } from "./styles-model.js";
import { WD_STYLE_TYPE, WD_BREAK, isEnumMember } from "./formatting-values.js";
import { UnsupportedEditError } from "./xml-write.js";

/** Stored text only; drawings and field instructions never execute. */
export function modelText(node: XmlElement): string {
  let text = "";
  const visit = (current: XmlElement) => {
    if (current.namespace !== node.namespace) return;
    const name = current.localName;
    if (name === "t") text += current.text;
    else if (name === "tab") text += "\t";
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
      for (const child of current.children) visit(child);
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
    return this.store.part(this.ref.part);
  }
  get text(): string {
    return modelText(this.store.node(this.ref));
  }
  set text(value: string) {
    if (typeof value !== "string") throw new InputTypeError("Expected paragraph text.");
    this.store.change(this.ref.part, (xml) => {
      const p = this.store.node(this.ref);
      const props = p.children.find(
        (child) => child.namespace === p.namespace && child.localName === "pPr"
      );
      xml.replaceElement(
        p,
        replaceParagraphContent(xml, p, props ? xml.sourceXml(props) : "", value)
      );
    });
  }
  get runs(): readonly Run[] {
    const p = this.store.node(this.ref);
    return p.children
      .filter((child) => child.namespace === p.namespace && child.localName === "r")
      .map((child) => this.store.run(this.store.ref(this.ref.part, child)));
  }
  get hyperlinks(): readonly Hyperlink[] {
    const p = this.store.node(this.ref);
    return p.children
      .filter((child) => child.namespace === p.namespace && child.localName === "hyperlink")
      .map((child) => new Hyperlink(this.store, this.store.ref(this.ref.part, child)));
  }
  *iter_inner_content(): IterableIterator<Run | Hyperlink> {
    const p = this.store.node(this.ref);
    for (const child of p.children) {
      this.store.context.budget.charge("work", 1);
      if (child.namespace !== p.namespace) continue;
      if (child.localName === "r") yield this.store.run(this.store.ref(this.ref.part, child));
      if (child.localName === "hyperlink")
        yield new Hyperlink(this.store, this.store.ref(this.ref.part, child));
    }
  }
  get rendered_page_breaks(): readonly RenderedPageBreak[] {
    const p = this.store.node(this.ref);
    const result: RenderedPageBreak[] = [];
    const visit = (node: XmlElement) => {
      this.store.context.budget.charge("work", 1);
      if (node.namespace !== p.namespace) return;
      if (node.localName === "lastRenderedPageBreak")
        result.push(
          new RenderedPageBreak(this.store, this.store.ref(this.ref.part, node), this.ref)
        );
      else for (const child of node.children) visit(child);
    };
    visit(p);
    return result;
  }
  get contains_page_break(): boolean {
    return this.rendered_page_breaks.length > 0;
  }
  get paragraph_format(): ParagraphFormat {
    return new ParagraphFormat(this.owner());
  }
  get alignment() {
    return this.paragraph_format.alignment;
  }
  set alignment(value) {
    this.paragraph_format.alignment = value;
  }
  get style(): ParagraphStyle | null {
    const p = this.store.node(this.ref);
    const id =
      p.children
        .find((child) => child.localName === "pPr")
        ?.children.find((child) => child.localName === "pStyle")
        ?.attributes.find((a) => a.localName === "val")?.value ?? null;
    return this.store.styles.get_by_id(id, WD_STYLE_TYPE.PARAGRAPH) as ParagraphStyle | null;
  }
  set style(value: string | ParagraphStyle | null) {
    const id = this.store.styles.get_style_id(value, WD_STYLE_TYPE.PARAGRAPH);
    this.store.change(this.ref.part, (xml) => {
      const p = this.store.node(this.ref),
        props = p.children.find((child) => child.localName === "pPr");
      const old = props?.children.find((child) => child.localName === "pStyle");
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
      }
    });
  }
  add_run(text?: string, style?: string | CharacterStyle | null): Run {
    if (text !== undefined && typeof text !== "string")
      throw new InputTypeError("Expected run text.");
    const styleId =
      style === undefined || style === null
        ? null
        : this.store.styles.get_style_id(style, WD_STYLE_TYPE.CHARACTER);
    this.store.change(this.ref.part, (xml) => {
      const p = this.store.node(this.ref);
      xml.insertChildren(p, paragraphTextRun(p.namespace, text ?? "", styleId ?? undefined));
    });
    const p = this.store.node(this.ref);
    return this.store.run(this.store.ref(this.ref.part, p.children.at(-1)!));
  }
  clear(): this {
    this.text = "";
    return this;
  }
  insert_paragraph_before(text?: string, style?: string): Paragraph {
    const p = this.store.node(this.ref),
      xml = this.store.xml(this.ref.part);
    let parent: XmlElement | undefined;
    const find = (node: XmlElement) => {
      if (node.children.includes(p)) parent = node;
      else for (const child of node.children) find(child);
    };
    find(xml.root);
    if (!parent) throw new UnsupportedEditError("Detached paragraph has no insertion owner.");
    const parentRef = this.store.ref(this.ref.part, parent),
      index = parent.children.indexOf(p);
    this.store.change(this.ref.part, (editor) => {
      const current = this.store.node(parentRef);
      editor.insertChildren(
        current,
        `<bm:p xmlns:bm="${p.namespace}">${style ? `<bm:pPr><bm:pStyle bm:val="${xmlValue(style)}"/></bm:pPr>` : ""}${paragraphTextRun(p.namespace, text ?? "")}</bm:p>`,
        this.store.node(this.ref)
      );
    });
    return this.store.paragraph(
      this.store.ref(this.ref.part, this.store.node(parentRef).children[index]!)
    );
  }
  private owner(): FormattingXmlOwner {
    const store = this.store,
      ref = this.ref;
    return {
      budget: store.context.budget,
      get part() {
        store.node(ref);
        return store.part(ref.part);
      },
      get identity() {
        return store.identity(ref);
      },
      getXml: () => store.xml(ref.part).sourceXml(store.node(ref)),
      setXml: (text) => store.change(ref.part, (xml) => xml.replaceElement(store.node(ref), text))
    };
  }
}

export class Run {
  constructor(
    readonly store: ModelStore,
    readonly ref: ModelRef
  ) {}
  equals(other: unknown): boolean {
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
    return this.store.part(this.ref.part);
  }
  get text(): string {
    return modelText(this.store.node(this.ref));
  }
  set text(value: string) {
    if (typeof value !== "string") throw new InputTypeError("Expected run text.");
    this.store.change(this.ref.part, (xml) => {
      const r = this.store.node(this.ref);
      const props = r.children.find(
        (child) => child.localName === "rPr" && child.namespace === r.namespace
      );
      if (
        r.children.some(
          (child) =>
            !["rPr", "t", "tab", "br", "cr", "lastRenderedPageBreak"].includes(child.localName)
        )
      )
        throw new UnsupportedEditError("Whole run text cannot discard owned resources.");
      const fragment = paragraphTextRun(r.namespace, value);
      const inner = fragment.slice(fragment.indexOf(">") + 1, fragment.lastIndexOf("</"));
      xml.replaceElement(
        r,
        runElementOpen(r).slice(0, -1) +
          (r.attributes.some((a) => a.name === "xmlns:pi") ? ">" : ` xmlns:pi="${r.namespace}">`) +
          (props ? xml.sourceXml(props) : "") +
          inner +
          `</${r.name}>`
      );
    });
  }
  get style(): CharacterStyle | null {
    const r = this.store.node(this.ref);
    const id =
      r.children
        .find((child) => child.localName === "rPr")
        ?.children.find((child) => child.localName === "rStyle")
        ?.attributes.find((a) => a.localName === "val")?.value ?? null;
    return this.store.styles.get_by_id(id, WD_STYLE_TYPE.CHARACTER) as CharacterStyle | null;
  }
  set style(value: string | CharacterStyle | null) {
    const id = this.store.styles.get_style_id(value, WD_STYLE_TYPE.CHARACTER);
    this.store.change(this.ref.part, (xml) => {
      const r = this.store.node(this.ref),
        props = r.children.find((child) => child.localName === "rPr");
      const old = props?.children.find((child) => child.localName === "rStyle");
      const replacement =
        id === null ? "" : `<bm:rStyle xmlns:bm="${r.namespace}" bm:val="${xmlValue(id)}"/>`;
      if (old) xml.replaceElement(old, replacement);
      else if (replacement) {
        if (props) xml.insertChildren(props, replacement, props.children[0]);
        else
          xml.insertChildren(
            r,
            `<bm:rPr xmlns:bm="${r.namespace}">${replacement}</bm:rPr>`,
            r.children[0]
          );
      }
    });
  }
  get font(): Font {
    const store = this.store,
      ref = this.ref;
    return new Font({
      budget: store.context.budget,
      get part() {
        store.node(ref);
        return store.part(ref.part);
      },
      get identity() {
        return store.identity(ref);
      },
      getXml: () => new TextDecoder().decode(store.element(ref).serialize()),
      setXml: (text) => store.change(ref.part, (xml) => xml.replaceElement(store.node(ref), text))
    });
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
  set underline(value) {
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
  get contains_page_break(): boolean {
    const r = this.store.node(this.ref);
    return r.children.some(
      (child) => child.localName === "lastRenderedPageBreak" && child.namespace === r.namespace
    );
  }
}

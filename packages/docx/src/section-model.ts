import { InputTypeError, InvalidValueError } from "./archive.js";
import { BoundsError } from "./model-errors.js";
import type { ModelRef, ModelStore } from "./model-store.js";
import { numericSequence } from "./numeric-index.js";
import { DocumentPackage } from "./package.js";
import { documentDialects, dialectForNamespace } from "./dialect.js";
import {
  sectionAttribute,
  sectionBoolean,
  sectionChild,
  sectionPropertyOrder,
  sectionStarts
} from "./section-properties.js";
import { mergeStyleChildren } from "./style-properties.js";
import { xmlValue } from "./create-content.js";
import { relativePartTarget } from "./part-uri.js";
import {
  isLength,
  Twips,
  WD_ORIENT,
  WD_SECTION_START,
  WD_HEADER_FOOTER_INDEX,
  type Length
} from "./formatting-values.js";
import type { DocxEnumValue } from "./operation-types.js";
import type { XmlElement } from "./package-xml.js";

function refs(store: ModelStore, partname = store.mainPart): ModelRef[] {
  const xml = store.xml(partname),
    body = sectionChild(xml.root, "body")!;
  const nodes: XmlElement[] = [];
  for (const child of body.children) {
    if (child.namespace !== body.namespace) continue;
    if (child.localName === "p") {
      const section = sectionChild(sectionChild(child, "pPr"), "sectPr");
      if (section) nodes.push(section);
    } else if (child.localName === "sectPr") nodes.push(child);
  }
  return nodes.map((node) => store.ref(partname, node));
}

/** Live zero-based section sequence; utility ordinals remain one-based. */
export class Sections implements Iterable<Section> {
  readonly [index: number]: Section;
  constructor(private readonly store: ModelStore, private readonly partname = store.mainPart) {
    return numericSequence(this);
  }
  get length(): number {
    return refs(this.store, this.partname).length;
  }
  at(index: number): Section {
    if (!Number.isSafeInteger(index))
      throw new InputTypeError("Expected a safe integer section index.");
    const items = refs(this.store, this.partname),
      ref = items[index < 0 ? items.length + index : index];
    if (!ref) throw new BoundsError("Section index is out of bounds.");
    return new Section(this.store, ref);
  }
  *[Symbol.iterator](): Iterator<Section> {
    for (const ref of refs(this.store, this.partname)) yield new Section(this.store, ref);
  }
  slice(start?: number, end?: number): Section[] {
    for (const value of [start, end])
      if (value !== undefined && !Number.isSafeInteger(value))
        throw new InputTypeError("Expected safe integer slice bounds.");
    return [...this].slice(start, end);
  }
  count(value: unknown): number {
    return [...this].filter((section) => section.equals(value)).length;
  }
  index(value: unknown, start = 0, stop?: number): number {
    for (const bound of [start, stop])
      if (bound !== undefined && !Number.isSafeInteger(bound))
        throw new InputTypeError("Expected safe integer sequence bounds.");
    const items = [...this],
      lower = start < 0 ? Math.max(0, items.length + start) : start,
      upper =
        stop === undefined
          ? items.length
          : stop < 0
            ? Math.max(0, items.length + stop)
            : Math.min(stop, items.length);
    for (let index = lower; index < upper; index++) if (items[index]!.equals(value)) return index;
    throw new InvalidValueError("Section is not in this sequence range.");
  }
  includes(value: unknown): boolean {
    return [...this].some((section) => section.equals(value));
  }
  *reversed(): IterableIterator<Section> {
    yield* [...this].reverse();
  }
}

export class Section {
  constructor(
    readonly store: ModelStore,
    readonly ref: ModelRef
  ) {}
  get element() {
    return this.store.element(this.ref);
  }
  get part() {
    this.store.node(this.ref);
    return this.store.part(this.ref.part);
  }
  equals(other: unknown): boolean {
    this.store.node(this.ref);
    return (
      other instanceof Section &&
      other.store === this.store &&
      this.store.node(this.ref) === other.store.node(other.ref)
    );
  }
  private length(tag: string, attr: string): Length | null {
    const value = sectionAttribute(sectionChild(this.store.node(this.ref), tag), attr);
    if (value === undefined) return null;
    if (!Number.isSafeInteger(Number(value)))
      throw new InvalidValueError("Invalid section length storage.");
    return Twips(Number(value));
  }
  private set(tag: string, attr: string, value: string | null): void {
    this.store.change(this.ref.part, (xml) => {
      const node = this.store.node(this.ref),
        child = sectionChild(node, tag);
      const markup = child
        ? mergeStyleChildren(xml, child, new Map(), [], { [attr]: value })
        : `<sp:${tag} xmlns:sp="${node.namespace}"${value === null ? "" : ` sp:${attr}="${xmlValue(value)}"`}/>`;
      xml.replaceElement(
        node,
        mergeStyleChildren(xml, node, new Map([[tag, markup]]), sectionPropertyOrder)
      );
    });
  }
  private setLength(tag: string, attr: string, value: Length | null): void {
    if (value !== null && !isLength(value))
      throw new InputTypeError("Expected a typed length or null.");
    this.set(tag, attr, value === null ? null : String(value.twips));
  }
  get page_width() {
    return this.length("pgSz", "w");
  }
  set page_width(v: Length | null) {
    this.setLength("pgSz", "w", v);
  }
  get page_height() {
    return this.length("pgSz", "h");
  }
  set page_height(v: Length | null) {
    this.setLength("pgSz", "h", v);
  }
  get top_margin() {
    return this.length("pgMar", "top");
  }
  set top_margin(v: Length | null) {
    this.setLength("pgMar", "top", v);
  }
  get bottom_margin() {
    return this.length("pgMar", "bottom");
  }
  set bottom_margin(v: Length | null) {
    this.setLength("pgMar", "bottom", v);
  }
  get left_margin() {
    return this.length("pgMar", "left");
  }
  set left_margin(v: Length | null) {
    this.setLength("pgMar", "left", v);
  }
  get right_margin() {
    return this.length("pgMar", "right");
  }
  set right_margin(v: Length | null) {
    this.setLength("pgMar", "right", v);
  }
  get gutter() {
    return this.length("pgMar", "gutter");
  }
  set gutter(v: Length | null) {
    this.setLength("pgMar", "gutter", v);
  }
  get header_distance() {
    return this.length("pgMar", "header");
  }
  set header_distance(v: Length | null) {
    this.setLength("pgMar", "header", v);
  }
  get footer_distance() {
    return this.length("pgMar", "footer");
  }
  set footer_distance(v: Length | null) {
    this.setLength("pgMar", "footer", v);
  }
  get orientation(): DocxEnumValue<"WD_ORIENTATION"> {
    return sectionAttribute(sectionChild(this.store.node(this.ref), "pgSz"), "orient") ===
      "landscape"
      ? WD_ORIENT.LANDSCAPE
      : WD_ORIENT.PORTRAIT;
  }
  set orientation(value: DocxEnumValue<"WD_ORIENTATION"> | null) {
    if (value !== null && !Object.values(WD_ORIENT).includes(value))
      throw new InputTypeError("Expected an orientation enum or null.");
    this.set("pgSz", "orient", value === null || value.name === "PORTRAIT" ? null : "landscape");
  }
  get start_type(): DocxEnumValue<"WD_SECTION_START"> {
    const value =
      sectionAttribute(sectionChild(this.store.node(this.ref), "type"), "val") ?? "nextPage";
    const name = Object.entries(sectionStarts).find(([, stored]) => value === stored)?.[0] as
      | keyof typeof sectionStarts
      | undefined;
    if (!name) throw new InvalidValueError("Invalid section start type.");
    return WD_SECTION_START[name];
  }
  set start_type(value: DocxEnumValue<"WD_SECTION_START"> | null) {
    if (value !== null && !Object.values(WD_SECTION_START).includes(value))
      throw new InputTypeError("Expected a section start enum or null.");
    this.store.change(this.ref.part, (xml) => {
      const node = this.store.node(this.ref),
        markup =
          value === null || value.name === "NEW_PAGE"
            ? ""
            : `<sp:type xmlns:sp="${node.namespace}" sp:val="${sectionStarts[value.name]}"/>`;
      xml.replaceElement(
        node,
        mergeStyleChildren(xml, node, new Map([["type", markup]]), sectionPropertyOrder)
      );
    });
  }
  get different_first_page_header_footer(): boolean {
    return sectionBoolean(sectionChild(this.store.node(this.ref), "titlePg"));
  }
  set different_first_page_header_footer(value: boolean) {
    if (typeof value !== "boolean")
      throw new InputTypeError("Expected a first-page policy boolean.");
    this.store.change(this.ref.part, (xml) => {
      const node = this.store.node(this.ref);
      xml.replaceElement(
        node,
        mergeStyleChildren(
          xml,
          node,
          new Map([["titlePg", value ? `<sp:titlePg xmlns:sp="${node.namespace}"/>` : ""]]),
          sectionPropertyOrder
        )
      );
    });
  }
  get header() {
    return new _Header(this, "default");
  }
  get first_page_header() {
    return new _Header(this, "first");
  }
  get even_page_header() {
    return new _Header(this, "even");
  }
  get footer() {
    return new _Footer(this, "default");
  }
  get first_page_footer() {
    return new _Footer(this, "first");
  }
  get even_page_footer() {
    return new _Footer(this, "even");
  }
  *iter_inner_content() {
    const body = sectionChild(this.store.xml(this.ref.part).root, "body")!,
      sections = refs(this.store, this.ref.part),
      position = sections.findIndex((ref) => ref.id === this.ref.id);
    this.store.node(this.ref);
    let current = 0;
    for (const block of body.children) {
      if (block.namespace !== body.namespace || !["p", "tbl"].includes(block.localName)) continue;
      if (current === position)
        yield block.localName === "p"
          ? this.store.paragraph(this.store.ref(this.ref.part, block))
          : this.store.table(this.store.ref(this.ref.part, block));
      if (sectionChild(sectionChild(block, "pPr"), "sectPr")) current++;
    }
  }
}

class HeaderFooter {
  constructor(
    readonly section: Section,
    readonly variant: "default" | "first" | "even",
    readonly kind: "header" | "footer"
  ) {}
  private local() {
    const node = this.section.store.node(this.section.ref);
    return node.children.find(
      (child) =>
        child.namespace === node.namespace &&
        child.localName === this.kind + "Reference" &&
        sectionAttribute(child, "type") === this.variant
    );
  }
  get is_linked_to_previous(): boolean {
    return !this.local();
  }
  set is_linked_to_previous(value: boolean) {
    if (typeof value !== "boolean") throw new InputTypeError("Expected a linkage boolean.");
    if (value === this.is_linked_to_previous) return;
    if (!value) {
      this.create();
      return;
    }
    const store = this.section.store,
      local = this.local()!,
      r = documentDialects[dialectForNamespace(local.namespace)!].r;
    const id = local.attributes.find(
      (attr) => attr.namespace === r && attr.localName === "id"
    )?.value;
    const graph = new DocumentPackage(store.snapshot(), store.context.limits, store.context.budget);
    const edge = graph.relationships(this.section.ref.part).find((edge) => edge.rId === id);
    if (!edge || edge.is_external) throw new InvalidValueError("Invalid story binding.");
    const shared = refs(store, this.section.ref.part).some((ref) =>
      store
        .node(ref)
        .children.some(
          (child) =>
            child !== local &&
            ["headerReference", "footerReference"].includes(child.localName) &&
            child.attributes.some(
              (attr) => attr.namespace === r && attr.localName === "id" && attr.value === id
            )
        )
    );
    const owners = [
      "/",
      ...graph.parts.filter((part) => !part.partname.endsWith(".rels")).map((part) => part.partname)
    ];
    const otherEdge = owners.some((owner) =>
      graph
        .relationships(owner)
        .some(
          (candidate) =>
            candidate !== edge &&
            !candidate.is_external &&
            candidate.target_part.partname === edge.target_part.partname
        )
    );
    store.transaction(() => {
      store.change(this.section.ref.part, (xml) => xml.replaceElement(this.local()!, ""));
      if (!shared) {
        const relationshipPart =
          this.section.ref.part.slice(0, this.section.ref.part.lastIndexOf("/") + 1) +
          "_rels/" +
          this.section.ref.part.slice(this.section.ref.part.lastIndexOf("/") + 1) +
          ".rels";
        store.change(relationshipPart, (xml) => {
          const relationship = xml.root.children.find((child) =>
            child.attributes.some((attr) => attr.localName === "Id" && attr.value === id)
          );
          if (relationship) xml.replaceElement(relationship, "");
        });
        if (!otherEdge) {
          const part = edge.target_part.partname,
            relationshipPart =
              part.slice(0, part.lastIndexOf("/") + 1) +
              "_rels/" +
              part.slice(part.lastIndexOf("/") + 1) +
              ".rels";
          store.change("/[Content_Types].xml", (xml) => {
            for (const child of xml.root.children)
              if (
                child.attributes.some(
                  (attr) =>
                    attr.localName === "PartName" && [part, relationshipPart].includes(attr.value)
                )
              )
                xml.replaceElement(child, "");
          });
          if (store.snapshot().members.some((member) => "/" + member.name === relationshipPart))
            store.deletePart(relationshipPart);
          store.deletePart(part);
        }
      }
    });
  }
  private resolve(create = true): ModelRef | null {
    const store = this.section.store,
      local = this.local();
    if (local) {
      const r = documentDialects[dialectForNamespace(local.namespace)!].r;
      const id = local.attributes.find(
        (attr) => attr.namespace === r && attr.localName === "id"
      )?.value;
      const graph = new DocumentPackage(
        store.snapshot(),
        store.context.limits,
        store.context.budget
      );
      const edge = graph.relationships(this.section.ref.part).find((edge) => edge.rId === id);
      if (!edge || edge.is_external || edge.reltype !== r + "/" + this.kind)
        throw new InvalidValueError("Invalid story binding.");
      const part = edge.target_part.partname;
      return store.ref(part, store.xml(part).root);
    }
    const sections = refs(store, this.section.ref.part),
      index = sections.findIndex((ref) => ref.id === this.section.ref.id);
    if (index > 0)
      return new HeaderFooter(
        new Section(store, sections[index - 1]!),
        this.variant,
        this.kind
      ).resolve(create);
    return create ? this.create() : null;
  }
  private create(): ModelRef {
    const store = this.section.store;
    return store.transaction(() => {
      const node = store.node(this.section.ref),
        w = node.namespace,
        r = documentDialects[dialectForNamespace(w)!].r;
      const graph = new DocumentPackage(
        store.snapshot(),
        store.context.limits,
        store.context.budget
      );
      const part = graph.allocatePartName(
          this.section.ref.part.slice(0, this.section.ref.part.lastIndexOf("/") + 1) + this.kind,
          ".xml"
        ),
        id = graph.allocateRelationshipId(this.section.ref.part);
      const relationshipPart =
        this.section.ref.part.slice(0, this.section.ref.part.lastIndexOf("/") + 1) +
        "_rels/" +
        this.section.ref.part.slice(this.section.ref.part.lastIndexOf("/") + 1) +
        ".rels";
      const relationship = `<Relationship xmlns="http://schemas.openxmlformats.org/package/2006/relationships" Id="${id}" Type="${r}/${this.kind}" Target="${xmlValue(relativePartTarget(this.section.ref.part, part))}"/>`;
      const contentType = `application/vnd.openxmlformats-officedocument.wordprocessingml.${this.kind}+xml`;
      store.setPart(
        part,
        new TextEncoder().encode(
          `<w:${this.kind === "header" ? "hdr" : "ftr"} xmlns:w="${w}"><w:p/></w:${this.kind === "header" ? "hdr" : "ftr"}>`
        ),
        contentType
      );
      if (store.snapshot().members.some((member) => "/" + member.name === relationshipPart))
        store.change(relationshipPart, (xml) => xml.insertChildren(xml.root, relationship));
      else
        store.setPart(
          relationshipPart,
          new TextEncoder().encode(
            `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${relationship}</Relationships>`
          )
        );
      store.change(this.section.ref.part, (xml) => {
        const section = store.node(this.section.ref),
          markup = `<sp:${this.kind}Reference xmlns:sp="${w}" xmlns:r="${r}" sp:type="${this.variant}" r:id="${id}"/>`;
        const next = section.children.find(
          (child) =>
            child.namespace === w &&
            sectionPropertyOrder.indexOf(child.localName) >
              sectionPropertyOrder.indexOf(this.kind + "Reference")
        );
        xml.insertChildren(section, markup, next);
      });
      return store.ref(part, store.xml(part).root);
    });
  }
  get part() {
    return this.section.store.part(this.resolve()!.part);
  }
  get element() {
    return this.section.store.element(this.resolve()!);
  }
  get paragraphs() {
    const store = this.section.store,
      ref = this.resolve()!;
    return [...store.blocks(ref)].filter(
      (block): block is ReturnType<ModelStore["paragraph"]> =>
        store.node(block.ref).localName === "p"
    );
  }
  get tables() {
    const store = this.section.store,
      ref = this.resolve()!;
    return [...store.blocks(ref)].filter(
      (block): block is ReturnType<ModelStore["table"]> => store.node(block.ref).localName === "tbl"
    );
  }
  iter_inner_content() {
    return this.section.store.blocks(this.resolve()!);
  }
  add_paragraph(text = "", style?: Parameters<ModelStore["addParagraph"]>[2]) {
    return this.section.store.addParagraph(this.resolve()!, text, style);
  }
  add_table(rows: number, cols: number, width: Length) {
    return this.section.store.addTable(this.resolve()!, rows, cols, width);
  }
}

function storyVariant(
  index: "default" | "first" | "even" | DocxEnumValue<"WD_HEADER_FOOTER_INDEX">
): "default" | "first" | "even" {
  if (index === "default" || index === "first" || index === "even") return index;
  if (!Object.values(WD_HEADER_FOOTER_INDEX).includes(index))
    throw new InputTypeError("Expected a header/footer index enum.");
  return index.name === "PRIMARY" ? "default" : index.name === "FIRST_PAGE" ? "first" : "even";
}

/** Public header block container, including inherited part and ordered content. */
export class _Header extends HeaderFooter {
  constructor(
    section: Section,
    index:
      | "default"
      | "first"
      | "even"
      | DocxEnumValue<"WD_HEADER_FOOTER_INDEX"> = WD_HEADER_FOOTER_INDEX.PRIMARY
  ) {
    super(section, storyVariant(index), "header");
  }
}
/** Public footer block container, including inherited part and ordered content. */
export class _Footer extends HeaderFooter {
  constructor(
    section: Section,
    index:
      | "default"
      | "first"
      | "even"
      | DocxEnumValue<"WD_HEADER_FOOTER_INDEX"> = WD_HEADER_FOOTER_INDEX.PRIMARY
  ) {
    super(section, storyVariant(index), "footer");
  }
}

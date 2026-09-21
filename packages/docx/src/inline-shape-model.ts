import { activeModelChildren } from "./model-active-children.js";
import { InputTypeError, InvalidValueError, ResourceLimitError } from "./archive.js";
import { BoundsError } from "./model-errors.js";
import { Image } from "./image-model.js";
import type { DocxLength } from "./operation-types.js";
import { Emu, isLength, WD_INLINE_SHAPE, type Length } from "./formatting-values.js";
import type { ModelRef, ModelStore } from "./model-store.js";
import { DocumentPackage } from "./package.js";
import { dialectForNamespace, documentDialects } from "./dialect.js";
import { inlineImageRun } from "./inline-image-xml.js";
import { parseDocumentXml, type XmlElement } from "./package-xml.js";
import { numericSequence } from "./numeric-index.js";
import { ImagePartView, packageAdmittedImage } from "./package-view.js";

/** Ordered run drawing content, with capability-bound image metadata. */
export class Drawing {
  constructor(
    readonly store: ModelStore,
    readonly ref: ModelRef
  ) {}
  get element() {
    return this.store.element(this.ref);
  }
  get _drawing() {
    return this.element;
  }
  get part() {
    this.store.node(this.ref);
    return this.store.part(this.ref.part);
  }
  get has_picture(): boolean {
    const node = this.store.node(this.ref),
      ns = documentDialects[dialectForNamespace(this.store.xml(this.ref.part).root.namespace)!];
    const children = activeModelChildren(this.store, this.ref.part);
    const picture = descendant(node, ns.pic, "pic", children),
      blip = picture && descendant(picture, ns.a, "blip", children);
    return !!blip?.attributes.some((a) => a.namespace === ns.r && a.localName === "embed");
  }
  get image(): Image {
    const node = this.store.node(this.ref),
      ns = documentDialects[dialectForNamespace(this.store.xml(this.ref.part).root.namespace)!];
    const children = activeModelChildren(this.store, this.ref.part);
    const picture = descendant(node, ns.pic, "pic", children),
      blip = picture && descendant(picture, ns.a, "blip", children);
    const id = blip?.attributes.find((a) => a.namespace === ns.r && a.localName === "embed")?.value;
    if (!id) throw new InvalidValueError("Drawing has no embedded picture.");
    const part = this.part.related_parts.get(id);
    if (!(part instanceof ImagePartView))
      throw new InvalidValueError("Drawing picture relationship is invalid.");
    return part.image;
  }
}

function descendant(
  node: XmlElement,
  namespace: string,
  name: string,
  children: (node: XmlElement) => readonly XmlElement[]
): XmlElement | undefined {
  if (node.namespace === namespace && node.localName === name) return node;
  for (const child of children(node)) {
    const found = descendant(child, namespace, name, children);
    if (found) return found;
  }
  return undefined;
}

/** Live inline drawing, including inert linked and non-picture type inspection. */
export class InlineShape {
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
  get type() {
    const node = this.store.node(this.ref),
      ns = documentDialects[dialectForNamespace(this.store.xml(this.ref.part).root.namespace)!];
    const children = activeModelChildren(this.store, this.ref.part);
    const data = descendant(node, ns.a, "graphicData", children);
    const uri = data?.attributes.find((a) => a.namespace === "" && a.localName === "uri")?.value;
    if (uri === ns.pic) {
      const blip = descendant(data!, ns.a, "blip", children);
      return blip?.attributes.some((a) => a.namespace === ns.r && a.localName === "link")
        ? WD_INLINE_SHAPE.LINKED_PICTURE
        : WD_INLINE_SHAPE.PICTURE;
    }
    if (
      [
        "http://schemas.openxmlformats.org/drawingml/2006/chart",
        "http://purl.oclc.org/ooxml/drawingml/chart"
      ].includes(uri ?? "")
    )
      return WD_INLINE_SHAPE.CHART;
    if (
      [
        "http://schemas.openxmlformats.org/drawingml/2006/diagram",
        "http://purl.oclc.org/ooxml/drawingml/diagram"
      ].includes(uri ?? "")
    )
      return WD_INLINE_SHAPE.SMART_ART;
    return WD_INLINE_SHAPE.NOT_IMPLEMENTED;
  }
  private extent(axis: "cx" | "cy"): Length {
    const node = this.store.node(this.ref),
      extent = activeModelChildren(
        this.store,
        this.ref.part
      )(node).find((c) => c.namespace === node.namespace && c.localName === "extent");
    const raw = extent?.attributes.find((a) => a.namespace === "" && a.localName === axis)?.value;
    if (
      raw === undefined ||
      raw.trim() === "" ||
      !Number.isSafeInteger(Number(raw)) ||
      Number(raw) < 0
    )
      throw new InvalidValueError("Invalid inline shape extent.");
    return Emu(Number(raw));
  }
  private setExtent(axis: "cx" | "cy", value: Length): void {
    if (!isLength(value)) throw new InputTypeError("Expected a typed inline shape length.");
    if (value.emu < 0) throw new InvalidValueError("Inline shape extent must be nonnegative.");
    this.store.transaction(() => {
      const node = this.store.node(this.ref),
        ns = documentDialects[dialectForNamespace(this.store.xml(this.ref.part).root.namespace)!];
      const children = activeModelChildren(this.store, this.ref.part);
      const extent = children(node).find(
        (c) => c.namespace === node.namespace && c.localName === "extent"
      );
      const transform = descendant(node, ns.a, "xfrm", children),
        inner =
          transform &&
          children(transform).find((c) => c.namespace === ns.a && c.localName === "ext");
      if (!extent) throw new InvalidValueError("Inline shape extent is missing.");
      const refs = [extent, ...(inner ? [inner] : [])].map((c) => this.store.ref(this.ref.part, c));
      for (const ref of refs)
        this.store.change(this.ref.part, (xml) =>
          xml.setQualifiedAttribute(
            this.store.node(ref),
            { namespace: "", localName: axis },
            String(value.emu)
          )
        );
    });
  }
  get width() {
    return this.extent("cx");
  }
  set width(value: Length) {
    this.setExtent("cx", value);
  }
  get height() {
    return this.extent("cy");
  }
  set height(value: Length) {
    this.setExtent("cy", value);
  }
}

/** Readonly zero-based sequence of active inline drawings in the document body. */
export class InlineShapes implements Iterable<InlineShape> {
  readonly [index: number]: InlineShape;
  private readonly cache = new Map<number, InlineShape>();
  constructor(
    private readonly store: ModelStore,
    private readonly owner: ModelRef
  ) {
    return numericSequence(this);
  }
  get part() {
    this.store.node(this.owner);
    return this.store.part(this.owner.part);
  }
  private refs(): ModelRef[] {
    const ns =
      documentDialects[dialectForNamespace(this.store.xml(this.owner.part).root.namespace)!];
    const refs: ModelRef[] = [];
    const children = activeModelChildren(this.store, this.owner.part);
    const visit = (node: XmlElement) => {
      this.store.context.budget.charge("work", 1);
      if (node.namespace === ns.w && ["ins", "del", "moveFrom", "moveTo"].includes(node.localName))
        return;
      if (node.namespace === ns.wp && node.localName === "inline")
        refs.push(this.store.ref(this.owner.part, node));
      for (const child of children(node)) visit(child);
    };
    visit(this.store.node(this.owner));
    return refs;
  }
  get length() {
    return this.refs().length;
  }
  at(index: number): InlineShape {
    if (!Number.isSafeInteger(index))
      throw new InputTypeError("Expected an integer inline shape index.");
    const refs = this.refs(),
      ref = refs[index < 0 ? refs.length + index : index];
    if (!ref) throw new BoundsError("Inline shape index is out of bounds.");
    let shape = this.cache.get(ref.id);
    if (!shape) {
      shape = new InlineShape(this.store, ref);
      this.cache.set(ref.id, shape);
    }
    return shape;
  }
  *[Symbol.iterator](): Iterator<InlineShape> {
    for (let i = 0; i < this.length; i++) yield this.at(i);
  }
}

/** Admits image bytes before atomically changing the selected live container. */
export function insertModelImage(
  store: ModelStore,
  ref: ModelRef,
  image: Image,
  width?: number | Length | DocxLength | null,
  height?: number | Length | DocxLength | null
): InlineShape {
  const [cx, cy] = image.scaled_dimensions(width, height);
  return store.transaction(() => {
    const owner = store.node(ref),
      ns = documentDialects[dialectForNamespace(store.xml(ref.part).root.namespace)!];
    if (owner.namespace !== ns.w || !["r", "body"].includes(owner.localName))
      throw new InputTypeError("Unsupported live picture insertion owner.");
    const imagePart = store.package[packageAdmittedImage](image),
      graph = new DocumentPackage(store.snapshot(), store.context.limits, store.context.budget);
    const relationshipId = store.part(ref.part).relate_to(imagePart, `${ns.r}/image`),
      drawingIds = new Set<number>();
    for (const member of store.snapshot().members) {
      const type = graph.parts.find((p) => p.partname === "/" + member.name)?.content_type;
      if (!type || !(type.endsWith("+xml") || type === "application/xml" || type === "text/xml"))
        continue;
      const collect = (node: XmlElement) => {
        store.context.budget.charge("work", 1);
        if (node.namespace === ns.wp && node.localName === "docPr")
          drawingIds.add(
            Number(node.attributes.find((a) => a.namespace === "" && a.localName === "id")?.value)
          );
        for (const child of node.children) collect(child);
      };
      collect(parseDocumentXml(member.bytes, {}, store.context.budget).root);
    }
    let drawingId = 1;
    while (drawingIds.has(drawingId)) drawingId++;
    if (drawingId > 4294967295) throw new ResourceLimitError("No drawing identifier is available.");
    const { run } = inlineImageRun(ns, drawingId, relationshipId, {
      width: cx.emu,
      height: cy.emu,
      crop: ""
    });
    store.change(ref.part, (xml) => {
      const container = store.node(ref);
      const section = container.children.find(
        (c) => c.namespace === ns.w && c.localName === "sectPr"
      );
      const markup =
        container.localName === "r"
          ? run.slice(run.indexOf(">") + 1, run.lastIndexOf("</"))
          : `<wi:p xmlns:wi="${ns.w}">${run}</wi:p>`;
      if (container.localName === "r") {
        const namespaces = ` xmlns:wp="${ns.wp}" xmlns:di="${ns.a}" xmlns:pic="${ns.pic}" xmlns:ri="${ns.r}" xmlns:wi="${ns.w}"`;
        xml.insertChildren(
          container,
          `<wi:drawing${namespaces}>${markup.slice(markup.indexOf(">") + 1, markup.lastIndexOf("</"))}</wi:drawing>`
        );
      } else xml.insertChildren(container, markup, section);
    });
    const container = store.node(ref),
      all = new InlineShapes(store, ref);
    const inline = all.at(-1);
    if (container.localName === "r" && inline.ref.part !== ref.part)
      throw new InputTypeError("Inline image owner is invalid.");
    return inline;
  });
}

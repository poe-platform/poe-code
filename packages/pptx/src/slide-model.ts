import { shapeOwnerTokens } from "./shape-owner-token.js";
import type { BinaryInput } from "./contracts.js";
import {
  IndexError,
  InvalidHandleError,
  KeyError,
  OfficeError,
  PropertyAccessError,
  ValueError
} from "./errors.js";
import { attr, required } from "./masters.js";
import { Length } from "./length.js";
import { Shape, applyShapeUpdate, readShape, createShapeXml, type ShapeKind } from "./shapes.js";
import { Table } from "./tables-model.js";
import { createTableXml } from "./tables.js";
import { parseXmlPart, type XmlElement, type XmlPart } from "./xml.js";
import { applyPictureUpdate, type SetImageOptions } from "./image-formatting.js";
import type { Chart } from "./chart-model.js";
import { chartTypes, type ChartData, type CreatableChartType } from "./chart-editing.js";
import { XL_CHART_TYPE } from "./chart-enums.js";
import {
  toChartData,
  type CategoryChartData,
  type XyChartData,
  type BubbleChartData
} from "./chart-data-model.js";
import { GroupShape } from "./group-model.js";
import { Connector } from "./connectors-model.js";
import { createConnectorXml, type ConnectorKind } from "./connectors.js";
import { FreeformBuilder } from "./freeform-builder.js";
import { ShapeIdAllocator } from "./shape-id.js";

export interface SlideShapeOwner {
  read(): XmlPart;
  write(xml: XmlPart): void;
  inherited?(idx: number): readonly XmlPart[];
  chart?(shapeId: number): Chart;
  insertRich?(shapeId: number, kind: "picture", options: unknown): Promise<void>;
  insertChart?(
    shapeId: number,
    options: {
      type: CreatableChartType;
      data: ChartData;
      left: number;
      top: number;
      width: number;
      height: number;
    }
  ): void;
}
function tree(xml: XmlPart, groupId?: number): XmlElement {
  if (groupId !== undefined) {
    const pending = [xml.root];
    while (pending.length) {
      const node = pending.pop()!;
      if (node.name.localName === "grpSp" && readShape(node).shapeId === groupId) return node;
      pending.push(...node.children);
    }
    throw new InvalidHandleError();
  }
  return required(required(xml.root, "cSld"), "spTree");
}
function shapes(xml: XmlPart, groupId?: number): readonly XmlElement[] {
  return tree(xml, groupId).children.filter((n) =>
    ["sp", "pic", "graphicFrame", "cxnSp", "grpSp"].includes(n.name.localName)
  );
}
function indexed<T extends { get(index: number): unknown }>(target: T): T {
  return new Proxy(target, {
    get(object, key) {
      if (typeof key === "string" && key !== "" && String(Number(key)) === key)
        return object.get(Number(key));
      const value = Reflect.get(object, key, object);
      return typeof value === "function" ? value.bind(object) : value;
    },
    set(object, key, value) {
      if (typeof key === "string" && key !== "" && String(Number(key)) === key)
        throw new ValueError("Collection entries are read-only.");
      return Reflect.set(object, key, value, object);
    },
    defineProperty(object, key, descriptor) {
      if (typeof key === "string" && key !== "" && String(Number(key)) === key)
        throw new ValueError("Collection entries are read-only.");
      return Reflect.defineProperty(object, key, descriptor);
    },
    deleteProperty(object, key) {
      if (typeof key === "string" && key !== "" && String(Number(key)) === key)
        throw new ValueError("Collection entries are read-only.");
      return Reflect.deleteProperty(object, key);
    }
  });
}

function descendants(xml: XmlPart): XmlElement[] {
  const nodes: XmlElement[] = [],
    pending = [xml.root];
  while (pending.length) {
    const node = pending.pop()!;
    nodes.push(node);
    pending.push(...node.children);
  }
  return nodes;
}
function binding(owner: SlideShapeOwner, id: number, kind: string, _groupId?: number) {
  const node = (xml: XmlPart) => {
    const matches = descendants(xml).filter(
      (n) =>
        ["sp", "grpSp", "pic", "graphicFrame"].includes(n.name.localName) &&
        readShape(n).shapeId === id
    );
    if (matches.length !== 1 || matches[0]!.name.localName !== kind) throw new InvalidHandleError();
    return matches[0]!;
  };
  let source: XmlPart | undefined, cached: XmlPart | undefined;
  return {
    read() {
      const xml = owner.read();
      if (xml === source && cached) return cached;
      cached = xml.subtree(node(xml));
      shapeOwnerTokens.set(cached, owner);
      source = xml;
      return cached;
    },
    write(replacement: XmlPart) {
      const xml = owner.read(),
        previous = node(xml),
        parent = descendants(xml).find((n) => n.children.includes(previous))!;
      owner.write(
        xml.spliceChildren(parent, parent.children.indexOf(previous), 1, [
          replacement.markup(replacement.root, true)
        ])
      );
    }
  };
}
class InheritedShape extends Shape {
  readonly #owner: SlideShapeOwner;
  readonly #binding: ReturnType<typeof binding>;
  constructor(owner: SlideShapeOwner, id: number, kind: string, groupId?: number) {
    const bound = binding(owner, id, kind, groupId);
    super(bound.read(), bound);
    this.#owner = owner;
    this.#binding = bound;
  }
  #dimension(key: "left" | "top" | "width" | "height"): Length | null {
    const own = readShape(this.element)[key];
    if (own !== null) return new Length(own);
    if (!this.is_placeholder) return null;
    const idx = this.placeholder_format.idx;
    for (const inherited of this.#owner.inherited?.(idx) ?? []) {
      const matches = shapes(inherited).filter((n) => readShape(n).placeholder?.idx === idx);
      if (matches.length > 1)
        throw new OfficeError(
          "ambiguous-selection",
          "Duplicate inherited placeholder key.",
          "select"
        );
      const value = matches[0] && readShape(matches[0])[key];
      if (value !== undefined && value !== null) return new Length(value);
    }
    return null;
  }
  #setDimension(key: "left" | "top" | "width" | "height", value: Length | null) {
    if (!(value instanceof Length)) throw new ValueError("Expected a Length.");
    const pair =
      key === "left" ? "top" : key === "top" ? "left" : key === "width" ? "height" : "width";
    const xml = this.#binding.read();
    this.#binding.write(
      applyShapeUpdate(xml, xml.root, {
        [key]: value,
        [pair]: this.#dimension(pair) ?? new Length(0)
      })
    );
  }
  override get left() {
    return this.#dimension("left");
  }
  override set left(v: Length | null) {
    this.#setDimension("left", v);
  }
  override get top() {
    return this.#dimension("top");
  }
  override set top(v: Length | null) {
    this.#setDimension("top", v);
  }
  override get width() {
    return this.#dimension("width");
  }
  override set width(v: Length | null) {
    this.#setDimension("width", v);
  }
  override get height() {
    return this.#dimension("height");
  }
  override set height(v: Length | null) {
    this.#setDimension("height", v);
  }
}
export class SlidePlaceholder extends InheritedShape {
  readonly #owner: SlideShapeOwner;
  readonly #binding: ReturnType<typeof binding>;
  constructor(owner: SlideShapeOwner, id: number, groupId?: number) {
    super(owner, id, "sp", groupId);
    this.#owner = owner;
    this.#binding = binding(owner, id, "sp", groupId);
  }
  #geometry() {
    const values = {
      left: this.left?.emu,
      top: this.top?.emu,
      width: this.width?.emu,
      height: this.height?.emu
    };
    if (Object.values(values).some((v) => v === undefined))
      throw new PropertyAccessError("Placeholder geometry is unresolved.");
    return values as { left: number; top: number; width: number; height: number };
  }
  insert_table(rows: number, cols: number): GraphicFrame {
    if (this.placeholder_format.type !== 12)
      throw new ValueError("A table placeholder is required.");
    const id = this.shape_id,
      xml = this.#binding.read();
    let replacement = parseXmlPart(
      new TextEncoder().encode(
        createTableXml(
          id,
          {
            rows,
            columns: cols,
            left: this.left!,
            top: this.top!,
            width: this.width!,
            height: new Length(rows * 370840)
          },
          xml.root.name.namespace
        )
      ),
      { maxBytes: 8388608, maxNodes: 100000, maxDepth: 128 }
    );
    replacement = preservePlaceholder(xml, replacement);
    this.#binding.write(replacement);
    return new GraphicFrame(this.#owner, id);
  }
  async insert_picture(input: BinaryInput): Promise<Picture> {
    if (this.placeholder_format.type !== 18)
      throw new ValueError("A picture placeholder is required.");
    const id = this.shape_id;
    if (!this.#owner.insertRich)
      throw new PropertyAccessError("Picture insertion requires a package owner.");
    await this.#owner.insertRich(id, "picture", { input, ...this.#geometry(), fit: "cover" });
    return new Picture(this.#owner, id);
  }
  insert_chart(
    type: XL_CHART_TYPE,
    data: ChartData | CategoryChartData | XyChartData | BubbleChartData
  ): GraphicFrame;
  insert_chart(
    type: CreatableChartType,
    data: ChartData | CategoryChartData | XyChartData | BubbleChartData
  ): GraphicFrame;
  insert_chart(
    type: XL_CHART_TYPE | CreatableChartType,
    data: ChartData | CategoryChartData | XyChartData | BubbleChartData
  ): GraphicFrame {
    const creationType =
      typeof type === "number"
        ? chartTypes.find((name) => XL_CHART_TYPE[name] === type)
        : chartTypes.find((name) => name === type);
    if (!creationType) throw new ValueError("Unsupported chart creation type.");
    if (this.placeholder_format.type !== 8)
      throw new ValueError("A chart placeholder is required.");
    const id = this.shape_id;
    if (!this.#owner.insertChart)
      throw new PropertyAccessError("Chart insertion requires a package owner.");
    this.#owner.insertChart(id, {
      type: creationType,
      data: toChartData(data),
      ...this.#geometry()
    });
    return new GraphicFrame(this.#owner, id);
  }
}
export function preservePlaceholder(previous: XmlPart, replacement: XmlPart): XmlPart {
  const oldNv = previous.root.children.find((n) => n.name.localName.startsWith("nv"))!;
  const newNv = replacement.root.children.find((n) => n.name.localName.startsWith("nv"))!;
  const identity = required(oldNv, "cNvPr"),
    target = required(newNv, "cNvPr");
  replacement = replacement.merge(target, {
    attributes: ["id", "name"].map((localName) => ({
      namespace: "",
      localName,
      value: attr(identity, localName) ?? ""
    }))
  });
  const nv = replacement.root.children.find((n) => n.name.localName.startsWith("nv"))!;
  const props = required(nv, "nvPr"),
    oldProps = required(oldNv, "nvPr");
  return replacement.spliceChildren(nv, nv.children.indexOf(props), 1, [
    previous.markup(oldProps, true)
  ]);
}
export class GraphicFrame extends InheritedShape {
  readonly #table: Table | undefined;
  readonly #owner: SlideShapeOwner;
  #chart: Chart | undefined;
  constructor(owner: SlideShapeOwner, id: number, groupId?: number) {
    const bound = binding(owner, id, "graphicFrame", groupId);
    super(owner, id, "graphicFrame", groupId);
    this.#owner = owner;
    if (this.has_table) this.#table = new Table(bound.read(), undefined, bound);
  }
  override get has_table() {
    return this.element.children.some(
      (n) =>
        n.name.localName === "graphic" &&
        n.children.some((d) => d.children.some((t) => t.name.localName === "tbl"))
    );
  }
  override get has_chart() {
    return this.element.children.some(
      (n) =>
        n.name.localName === "graphic" &&
        n.children.some((d) => d.children.some((t) => t.name.localName === "chart"))
    );
  }
  override get shape_type(): 14 | 19 | 3 {
    return this.is_placeholder ? 14 : this.has_table ? 19 : 3;
  }
  get chart(): Chart {
    if (!this.has_chart || !this.#owner.chart)
      throw new PropertyAccessError("Graphic frame has no accessible chart.");
    return (this.#chart ??= this.#owner.chart(this.shape_id));
  }
  get table(): Table {
    void this.element;
    if (!this.#table) throw new PropertyAccessError("Graphic frame has no table.");
    return this.#table;
  }
}
export class Picture extends InheritedShape {
  readonly #binding: ReturnType<typeof binding>;
  constructor(owner: SlideShapeOwner, id: number, groupId?: number) {
    const bound = binding(owner, id, "pic", groupId);
    super(owner, id, "pic", groupId);
    this.#binding = bound;
  }
  override get shape_type(): 14 | 13 {
    return this.is_placeholder ? 14 : 13;
  }
  #crop(side: string) {
    const fill = required(this.element, "blipFill");
    const crop = fill.children.find((n) => n.name.localName === "srcRect");
    return Number((crop && attr(crop, side)) || 0) / 100000;
  }
  #setCrop(key: keyof SetImageOptions, value: number) {
    const xml = this.#binding.read();
    this.#binding.write(applyPictureUpdate(xml, xml.root, { [key]: value }));
  }
  get crop_left() {
    return this.#crop("l");
  }
  set crop_left(v: number) {
    this.#setCrop("cropLeft", v);
  }
  get crop_right() {
    return this.#crop("r");
  }
  set crop_right(v: number) {
    this.#setCrop("cropRight", v);
  }
  get crop_top() {
    return this.#crop("t");
  }
  set crop_top(v: number) {
    this.#setCrop("cropTop", v);
  }
  get crop_bottom() {
    return this.#crop("b");
  }
  set crop_bottom(v: number) {
    this.#setCrop("cropBottom", v);
  }
}
function recalculateGroups(document: XmlPart, initialId: number): XmlPart {
  let groupId: number | undefined = initialId;
  while (groupId !== undefined) {
    let group = tree(document, groupId);
    const ancestor = descendants(document).find(
      (node) => node.name.localName === "grpSp" && node.children.includes(group)
    );
    const children = shapes(document, groupId).map(readShape);
    if (
      children.length &&
      children.every((shape) =>
        [shape.left, shape.top, shape.width, shape.height].every((value) => value !== null)
      )
    ) {
      const left = Math.min(...children.map((shape) => shape.left!)),
        top = Math.min(...children.map((shape) => shape.top!));
      const width = Math.max(...children.map((shape) => shape.left! + shape.width!)) - left,
        height = Math.max(...children.map((shape) => shape.top! + shape.height!)) - top;
      const namespace = group.name.namespace.includes("purl")
        ? "http://purl.oclc.org/ooxml/drawingml/main"
        : "http://schemas.openxmlformats.org/drawingml/2006/main";
      for (const [name, values] of [
        ["off", { x: left, y: top }],
        ["ext", { cx: width, cy: height }],
        ["chOff", { x: left, y: top }],
        ["chExt", { cx: width, cy: height }]
      ] as const) {
        group = tree(document, groupId);
        const props = required(group, "grpSpPr"),
          transform = props.children.find((node) => node.name.localName === "xfrm");
        if (!transform) {
          document = document.spliceChildren(props, 0, 0, [`<a:xfrm xmlns:a="${namespace}"/>`]);
        }
        const xfrm = required(tree(document, groupId), "grpSpPr").children.find(
          (node) => node.name.localName === "xfrm" && node.name.namespace === namespace
        )!;
        const node = xfrm.children.find(
          (node) => node.name.localName === name && node.name.namespace === namespace
        );
        const attributes = Object.entries(values).map(([localName, value]) => ({
          namespace: "",
          localName,
          value: String(value)
        }));
        if (node) document = document.merge(node, { attributes });
        else
          document = document.spliceChildren(xfrm, xfrm.children.length, 0, [
            `<a:${name} xmlns:a="${namespace}" ${Object.entries(values)
              .map(([key, value]) => `${key}="${value}"`)
              .join(" ")}/>`
          ]);
      }
    }
    groupId = ancestor ? readShape(ancestor).shapeId : undefined;
  }
  return document;
}
export class SlideShapes implements Iterable<Shape | Connector> {
  readonly [index: number]: Shape | Connector;
  readonly #owner: SlideShapeOwner;
  readonly #groupId: number | undefined;
  readonly #allocator: ShapeIdAllocator;
  constructor(owner: SlideShapeOwner, groupId?: number) {
    this.#owner = owner;
    this.#groupId = groupId;
    this.#allocator = new ShapeIdAllocator(owner.read);
    return indexed(this);
  }
  get length() {
    return shapes(this.#owner.read(), this.#groupId).length;
  }
  at(index: number): Shape | Connector {
    return this.get(index < 0 ? this.length + index : index);
  }
  get_by_id(id: number): Shape | Connector | null {
    const position = shapes(this.#owner.read(), this.#groupId).findIndex(
      (node) => readShape(node).shapeId === id
    );
    return position < 0 ? null : this.get(position);
  }
  get title(): Shape | null {
    const position = shapes(this.#owner.read(), this.#groupId).findIndex((node) =>
      ["title", "ctrTitle"].includes(readShape(node).placeholder?.type ?? "")
    );
    return position < 0 ? null : (this.get(position) as Shape);
  }
  get turbo_add_enabled() {
    return this.#allocator.turbo_add_enabled;
  }
  set turbo_add_enabled(value: boolean) {
    this.#allocator.turbo_add_enabled = value;
  }
  get(index: number): Shape | Connector {
    const nodes = shapes(this.#owner.read(), this.#groupId);
    if (!Number.isSafeInteger(index) || index < 0 || index >= nodes.length) throw new IndexError();
    const node = nodes[index]!,
      id = readShape(node).shapeId;
    if (node.name.localName === "cxnSp") {
      const xml = this.#owner.read();
      shapeOwnerTokens.set(xml, this.#owner);
      return new Connector(xml, id, this.#owner);
    }
    if (node.name.localName === "grpSp") {
      const bound = binding(this.#owner, id, "grpSp", this.#groupId);
      return new GroupShape(bound.read(), new SlideShapes(this.#owner, id), bound);
    }
    if (node.name.localName === "graphicFrame")
      return new GraphicFrame(this.#owner, id, this.#groupId);
    if (node.name.localName === "pic") return new Picture(this.#owner, id, this.#groupId);
    if (readShape(node).placeholder) return new SlidePlaceholder(this.#owner, id, this.#groupId);
    const bound = binding(this.#owner, id, node.name.localName, this.#groupId);
    return new Shape(bound.read(), bound);
  }

  #append(makeMarkup: (id: number) => string): Shape | Connector {
    const xml = this.#owner.read(),
      parent = tree(xml, this.#groupId);
    let updated = this.#allocator.append(parent, makeMarkup).xml;
    if (this.#groupId !== undefined) updated = recalculateGroups(updated, this.#groupId);
    this.#owner.write(updated);
    return this.get(this.length - 1);
  }
  add_shape(kind: ShapeKind, left: Length, top: Length, width: Length, height: Length): Shape {
    return this.#append((id) =>
      createShapeXml(kind, id, { left, top, width, height }, this.#owner.read().root.name.namespace)
    ) as Shape;
  }
  add_textbox(left: Length, top: Length, width: Length, height: Length): Shape {
    return this.#append((id) =>
      createShapeXml(
        "text-box",
        id,
        { left, top, width, height },
        this.#owner.read().root.name.namespace
      )
    ) as Shape;
  }
  add_connector(
    kind: ConnectorKind,
    begin_x: Length,
    begin_y: Length,
    end_x: Length,
    end_y: Length
  ): Connector {
    return this.#append((id) =>
      createConnectorXml(
        id,
        { kind, beginX: begin_x, beginY: begin_y, endX: end_x, endY: end_y },
        this.#owner.read().root.name.namespace
      )
    ) as Connector;
  }
  add_group_shape(selected: Iterable<Shape | Connector> = []): GroupShape<SlideShapes> {
    const source = this.#owner.read(),
      parent = tree(source, this.#groupId),
      members: XmlElement[] = [],
      ids = new Set<number>();
    for (const handle of selected) {
      if (members.length >= 4096)
        throw new OfficeError("resource-limit", "Group child limit exceeded.", "usage");
      if (!(handle instanceof Shape) && !(handle instanceof Connector))
        throw new ValueError("Expected an owned shape handle.");
      const id = handle.shape_id;
      const member = shapes(source, this.#groupId).find((node) => readShape(node).shapeId === id);
      if (shapeOwnerTokens.get(handle.xml) !== this.#owner || !member || ids.has(id))
        throw new ValueError("Group members must be distinct direct children of this collection.");
      const geometry = readShape(member);
      if ([geometry.left, geometry.top, geometry.width, geometry.height].some((v) => v === null))
        throw new PropertyAccessError("Grouping requires explicit geometry.");
      ids.add(id);
      members.push(member);
    }
    const p = source.root.name.namespace,
      a = p.includes("purl")
        ? "http://purl.oclc.org/ooxml/drawingml/main"
        : "http://schemas.openxmlformats.org/drawingml/2006/main";
    const values = members.map(readShape),
      left = values.length ? Math.min(...values.map((x) => x.left!)) : 0,
      top = values.length ? Math.min(...values.map((x) => x.top!)) : 0;
    const width = values.length ? Math.max(...values.map((x) => x.left! + x.width!)) - left : 0,
      height = values.length ? Math.max(...values.map((x) => x.top! + x.height!)) - top : 0;
    const markup = (id: number) =>
      `<p:grpSp xmlns:p="${p}" xmlns:a="${a}"><p:nvGrpSpPr><p:cNvPr id="${id}" name="Group ${id}"/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr><a:xfrm><a:off x="${left}" y="${top}"/><a:ext cx="${width}" cy="${height}"/><a:chOff x="${left}" y="${top}"/><a:chExt cx="${width}" cy="${height}"/></a:xfrm></p:grpSpPr>${members.map((node) => source.markup(node, true)).join("")}</p:grpSp>`;
    if (!members.length) return this.#append(markup) as GroupShape<SlideShapes>;
    const id = this.#allocator.next();
    const retained = parent.children.filter((node) => !members.includes(node));
    const extension = retained.findIndex((node) => node.name.localName === "extLst");
    const children = retained.map((node) => source.markup(node, true));
    children.splice(extension < 0 ? children.length : extension, 0, markup(id));
    let updated = source.spliceChildren(parent, 0, parent.children.length, children);
    if (this.#groupId !== undefined) updated = recalculateGroups(updated, this.#groupId);
    this.#owner.write(updated);
    return this.get_by_id(id) as GroupShape<SlideShapes>;
  }
  build_freeform(
    start_x = 0,
    start_y = 0,
    scale: number | readonly [number, number] = 1
  ): FreeformBuilder<Shape> {
    return new FreeformBuilder(
      (geometry) => {
        const p = this.#owner.read().root.name.namespace,
          a = p.includes("purl")
            ? "http://purl.oclc.org/ooxml/drawingml/main"
            : "http://schemas.openxmlformats.org/drawingml/2006/main";
        const commands = geometry.commands
          .map((command) =>
            command.type === "close"
              ? "<a:close/>"
              : `<a:${command.type === "move" ? "moveTo" : "lnTo"}><a:pt x="${command.x}" y="${command.y}"/></a:${command.type === "move" ? "moveTo" : "lnTo"}>`
          )
          .join("");
        return this.#append(
          (id) =>
            `<p:sp xmlns:p="${p}" xmlns:a="${a}"><p:nvSpPr><p:cNvPr id="${id}" name="Freeform ${id}"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr><p:spPr><a:xfrm><a:off x="${geometry.left}" y="${geometry.top}"/><a:ext cx="${geometry.width}" cy="${geometry.height}"/></a:xfrm><a:custGeom><a:avLst/><a:gdLst/><a:ahLst/><a:cxnLst/><a:rect l="0" t="0" r="r" b="b"/><a:pathLst><a:path w="${geometry.localWidth}" h="${geometry.localHeight}">${commands}</a:path></a:pathLst></a:custGeom></p:spPr></p:sp>`
        ) as Shape;
      },
      start_x,
      start_y,
      scale
    );
  }
  *[Symbol.iterator]() {
    for (let i = 0; i < this.length; i++) yield this.get(i);
  }
}
export class SlidePlaceholders implements Iterable<SlidePlaceholder | GraphicFrame | Picture> {
  readonly [idx: number]: SlidePlaceholder | GraphicFrame | Picture;
  readonly #owner: SlideShapeOwner;
  constructor(owner: SlideShapeOwner) {
    this.#owner = owner;
    return indexed(this);
  }
  #entries() {
    const entries = shapes(this.#owner.read())
      .map((node, index) => ({ node, index, ph: readShape(node).placeholder }))
      .filter((x) => x.ph !== null);
    const keys = new Set<number>();
    for (const x of entries) {
      if (!Number.isSafeInteger(x.ph!.idx) || x.ph!.idx < 0 || x.ph!.idx > 4294967295)
        throw new ValueError("Invalid placeholder key.");
      if (keys.has(x.ph!.idx))
        throw new OfficeError("ambiguous-selection", "Duplicate placeholder key.", "select");
      keys.add(x.ph!.idx);
    }
    return entries.sort((a, b) => a.ph!.idx - b.ph!.idx);
  }
  get length() {
    return this.#entries().length;
  }
  get(idx: number): SlidePlaceholder | GraphicFrame | Picture {
    const entry = this.#entries().find((x) => x.ph!.idx === idx);
    if (!Number.isSafeInteger(idx) || !entry) throw new KeyError();
    return new SlideShapes(this.#owner).get(entry.index) as
      | SlidePlaceholder
      | GraphicFrame
      | Picture;
  }
  *[Symbol.iterator]() {
    for (const entry of this.#entries()) yield this.get(entry.ph!.idx);
  }
}
export class Slide {
  readonly shapes: SlideShapes;
  readonly placeholders: SlidePlaceholders;
  readonly #owner: SlideShapeOwner;
  constructor(
    readonly slide_id: number,
    owner: SlideShapeOwner
  ) {
    this.#owner = owner;
    this.shapes = new SlideShapes(owner);
    this.placeholders = new SlidePlaceholders(owner);
  }
  get element() {
    return this.#owner.read().root;
  }
  get name() {
    return attr(required(this.element, "cSld"), "name") ?? "";
  }
  set name(value: string) {
    if (typeof value !== "string") throw new ValueError("Expected slide name text.");
    const xml = this.#owner.read();
    this.#owner.write(
      xml.merge(required(xml.root, "cSld"), {
        attributes: [{ namespace: "", localName: "name", value }]
      })
    );
  }
}
export class Slides implements Iterable<Slide> {
  readonly [index: number]: Slide;
  readonly #items: readonly Slide[];
  constructor(items: readonly Slide[]) {
    this.#items = items;
    return indexed(this);
  }
  get length() {
    return this.#items.length;
  }
  get(index: number): Slide {
    if (!Number.isSafeInteger(index) || index < 0 || index >= this.length) throw new IndexError();
    return this.#items[index]!;
  }
  at(index: number): Slide {
    return this.get(index < 0 ? this.length + index : index);
  }
  get_by_id(id: number): Slide | null {
    return this.#items.find((slide) => slide.slide_id === id) ?? null;
  }
  *[Symbol.iterator]() {
    yield* this.#items;
  }
}

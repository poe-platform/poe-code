import { OfficeError } from "./errors.js";
import { Length } from "./length.js";
import { attr, child } from "./masters.js";
import { parseXmlPart, type XmlElement, type XmlPart, type XmlMerge } from "./xml.js";
import { TextFrame, applyFrameFormatting } from "./text-frames.js";
import { RGBColor, ColorPropertyAccessError, readRunColor } from "./text-run-color.js";
import { MSO_SHAPE_TYPE } from "./shape-types.js";
export { MSO_SHAPE_TYPE } from "./shape-types.js";
import { MSO_AUTO_SHAPE_TYPE, shapePresets } from "./shape-presets.js";
import { PP_PLACEHOLDER_TYPE } from "./shape-placeholder-types.js";
export { PP_PLACEHOLDER_TYPE, PP_PLACEHOLDER } from "./shape-placeholder-types.js";
export { MSO_AUTO_SHAPE_TYPE, MSO_SHAPE, shapePresets } from "./shape-presets.js";
export type ShapeKind = "text-box" | keyof typeof shapePresets | MSO_AUTO_SHAPE_TYPE;
export type ShapeLength =
  | Length
  | { readonly value: number; readonly unit: "emu" | "in" | "cm" | "mm" | "pt" };
export interface ShapeUpdate {
  readonly kind?: ShapeKind;
  readonly name?: string;
  readonly title?: string | null;
  readonly description?: string | null;
  readonly altText?: string | null;
  readonly locked?: boolean | null;
  readonly left?: ShapeLength;
  readonly top?: ShapeLength;
  readonly width?: ShapeLength;
  readonly height?: ShapeLength;
  readonly rotation?: number;
  readonly flipHorizontal?: boolean;
  readonly flipVertical?: boolean;
  readonly fill?: string | null;
  readonly lineColor?: string | null;
  readonly lineWidth?: ShapeLength | null;
  readonly text?: string;
}
const pns = "http://schemas.openxmlformats.org/presentationml/2006/main";
const ans = "http://schemas.openxmlformats.org/drawingml/2006/main";
function drawing(node: XmlElement) {
  if (![pns, "http://purl.oclc.org/ooxml/presentationml/main"].includes(node.name.namespace))
    invalid("Unsupported shape namespace.");
  return node.name.namespace === "http://purl.oclc.org/ooxml/presentationml/main"
    ? "http://purl.oclc.org/ooxml/drawingml/main"
    : ans;
}
function invalid(message = "Invalid shape properties."): never {
  throw new OfficeError("invalid-value", message, "usage");
}
function unsupported(message: string): never {
  throw new OfficeError("unsupported-edit", message, "validate-intent");
}
function preset(kind: ShapeKind): keyof typeof shapePresets | null {
  if (kind === "text-box") return null;
  const name =
    typeof kind === "number"
      ? (Object.keys(shapePresets) as (keyof typeof shapePresets)[]).find(
          (k) => MSO_AUTO_SHAPE_TYPE[k] === kind
        )
      : kind;
  if (!name || !Object.hasOwn(shapePresets, name)) invalid("Unknown preset shape.");
  return name;
}
function emu(value: ShapeLength): number {
  if (value instanceof Length) return value.emu;
  if (
    !value ||
    typeof value !== "object" ||
    Object.keys(value).some((k) => !["value", "unit"].includes(k)) ||
    typeof value.value !== "number"
  )
    invalid();
  const factors = { emu: 1, in: 914400, cm: 360000, mm: 36000, pt: 12700 };
  if (!Object.hasOwn(factors, value.unit)) invalid();
  const result = new Length(value.value * factors[value.unit]).emu;
  return result;
}
function escaped(value: string): string {
  let text = "";
  for (const c of value) {
    const cp = c.codePointAt(0)!;
    if (
      (cp < 32 && ![9, 10, 13].includes(cp)) ||
      (cp >= 0xd800 && cp <= 0xdfff) ||
      cp === 0xfffe ||
      cp === 0xffff
    )
      invalid();
    text +=
      c === "&"
        ? "&amp;"
        : c === "<"
          ? "&lt;"
          : c === '"'
            ? "&quot;"
            : c === "\r"
              ? "&#13;"
              : c === "\n"
                ? "&#10;"
                : c === "\t"
                  ? "&#9;"
                  : c;
  }
  return text;
}
export function validateShapeOptions(options: ShapeUpdate, adding = false): void {
  if (
    !options ||
    typeof options !== "object" ||
    ![Object.prototype, null].includes(Object.getPrototypeOf(options)) ||
    Object.keys(options).some(
      (k) =>
        ![
          "kind",
          "name",
          "title",
          "description",
          "altText",
          "locked",
          "left",
          "top",
          "width",
          "height",
          "rotation",
          "flipHorizontal",
          "flipVertical",
          "fill",
          "lineColor",
          "lineWidth",
          "text"
        ].includes(k)
    )
  )
    invalid();
  if (options.kind !== undefined) preset(options.kind);
  for (const key of ["flipHorizontal", "flipVertical"] as const)
    if (options[key] !== undefined && typeof options[key] !== "boolean") invalid();
  if (adding && options.kind === undefined) invalid("Shape creation requires a kind.");
  if (
    adding &&
    ["left", "top", "width", "height"].some((k) => options[k as keyof ShapeUpdate] === undefined)
  )
    invalid("Shape creation requires explicit geometry.");
  for (const k of ["left", "top", "width", "height", "lineWidth"] as const) {
    if (options[k] === null && k !== "lineWidth") invalid();
    if (options[k] !== undefined && options[k] !== null) {
      const n = emu(options[k]);
      if (Math.abs(n) > 27273042316900) invalid("Shape geometry exceeds DrawingML bounds.");
      if (((k === "width" || k === "height") && n <= 0) || (k === "lineWidth" && n < 0)) invalid();
    }
  }
  for (const k of ["name", "text", "title", "description", "altText"] as const) {
    const v = options[k];
    if (v !== undefined && v !== null) {
      if (typeof v !== "string") invalid();
      if (k !== "text") escaped(v);
    } else if (v === null && (k === "name" || k === "text")) invalid();
  }
  if (options.description !== undefined && options.altText !== undefined)
    invalid("Use description or altText, not both.");
  if (
    options.locked !== undefined &&
    options.locked !== null &&
    typeof options.locked !== "boolean"
  )
    invalid();
  if (
    options.rotation !== undefined &&
    (typeof options.rotation !== "number" ||
      !Number.isFinite(options.rotation) ||
      Math.abs(options.rotation) > 360000)
  )
    invalid();
  for (const k of ["fill", "lineColor"] as const) {
    const v = options[k];
    if (
      v !== undefined &&
      v !== null &&
      v !== "solid" &&
      (typeof v !== "string" ||
        v.length !== 6 ||
        Array.from(v).some((c) => !"0123456789abcdefABCDEF".includes(c)))
    )
      invalid();
  }
}
function nv(node: XmlElement) {
  return node.children.find(
    (n) =>
      n.name.namespace === node.name.namespace &&
      ["nvSpPr", "nvPicPr", "nvGraphicFramePr", "nvGrpSpPr", "nvCxnSpPr"].includes(n.name.localName)
  );
}
function props(node: XmlElement) {
  return child(node, node.name.localName === "grpSp" ? "grpSpPr" : "spPr");
}
function num(node: XmlElement | undefined, key: string): number | null {
  const v = node && attr(node, key);
  if (v === undefined) return null;
  const n = Number(v);
  if (!Number.isSafeInteger(n))
    throw new OfficeError("invalid-xml", "Invalid shape geometry.", "parse");
  return n;
}
export function readShape(node: XmlElement) {
  const a = drawing(node),
    n = nv(node),
    cn = n && child(n, "cNvPr"),
    pr = props(node),
    x = node.name.localName === "graphicFrame" ? child(node, "xfrm") : pr && child(pr, "xfrm", a),
    off = x && child(x, "off", a),
    ext = x && child(x, "ext", a),
    geom = pr && child(pr, "prstGeom", a),
    raw = geom && attr(geom, "prst"),
    cp = n && child(n, "cNvSpPr"),
    ph = n && child(n, "nvPr") && child(child(n, "nvPr")!, "ph"),
    locks = cp && child(cp, "spLocks", a),
    line = pr && child(pr, "ln", a);
  const readColor = (v: XmlElement | undefined) => {
    const sf = v && child(v, "solidFill", a),
      rgb = sf && child(sf, "srgbClr", a);
    return rgb ? (attr(rgb, "val") ?? null) : null;
  };
  const found = raw
    ? (Object.keys(shapePresets) as (keyof typeof shapePresets)[]).find(
        (k) => shapePresets[k] === raw
      )
    : undefined;
  const unknown: string[] = [];
  for (const [label, owner] of [
    ["fill", pr],
    ["line", line]
  ] as const) {
    const fill = owner && child(owner, "solidFill", a);
    for (const color of fill?.children ?? [])
      if (color.name.namespace === a && color.name.localName !== "srgbClr")
        unknown.push(`${label}:${color.name.localName}`);
  }
  if (raw && !found) unknown.push(`preset:${raw}`);
  for (const v of pr?.children ?? [])
    if (
      v.name.namespace === a &&
      ["gradFill", "pattFill", "blipFill", "grpFill", "custGeom"].includes(v.name.localName)
    )
      unknown.push(v.name.localName);
  const lock = locks && attr(locks, "noSelect");
  return {
    shapeId: cn ? (num(cn, "id") ?? 0) : 0,
    name: cn ? (attr(cn, "name") ?? "") : "",
    title: cn ? (attr(cn, "title") ?? null) : null,
    description: cn ? (attr(cn, "descr") ?? null) : null,
    kind: cp && ["1", "true"].includes(attr(cp, "txBox") ?? "") ? "text-box" : (found ?? null),
    left: num(off, "x"),
    top: num(off, "y"),
    width: num(ext, "cx"),
    height: num(ext, "cy"),
    rotation: ((((num(x, "rot") ?? 0) % 21600000) + 21600000) % 21600000) / 60000,
    flipHorizontal: x ? ["true", "1"].includes(attr(x, "flipH") ?? "0") : false,
    flipVertical: x ? ["true", "1"].includes(attr(x, "flipV") ?? "0") : false,
    locked: lock === undefined ? null : ["1", "true"].includes(lock),
    fill: readColor(pr),
    fillType:
      pr?.children.find(
        (n) =>
          n.name.namespace === a &&
          ["noFill", "solidFill", "gradFill", "pattFill", "blipFill", "grpFill"].includes(
            n.name.localName
          )
      )?.name.localName ?? null,
    lineColor: readColor(line),
    lineFillType:
      line?.children.find(
        (n) =>
          n.name.namespace === a &&
          ["noFill", "solidFill", "gradFill", "pattFill"].includes(n.name.localName)
      )?.name.localName ?? null,
    lineWidth: num(line, "w"),
    unsupported: unknown,
    placeholder: ph
      ? {
          idx: num(ph, "idx") ?? 0,
          type: attr(ph, "type") ?? "obj",
          orient: attr(ph, "orient") ?? "horz",
          sz: attr(ph, "sz") ?? "full"
        }
      : null
  };
}
export type ShapeRecord = ReturnType<typeof readShape>;
const propertyOrder = [
  "xfrm",
  "prstGeom",
  "custGeom",
  "noFill",
  "solidFill",
  "gradFill",
  "blipFill",
  "pattFill",
  "grpFill",
  "ln",
  "effectLst",
  "effectDag",
  "scene3d",
  "sp3d",
  "extLst"
];
export function applyShapeUpdate(
  document: XmlPart,
  node: XmlElement,
  options: ShapeUpdate
): XmlPart {
  validateShapeOptions(options);
  if (
    node.name.localName !== "sp" &&
    (!["pic", "cxnSp", "graphicFrame", "grpSp"].includes(node.name.localName) ||
      Object.keys(options).some(
        (key) =>
          ![
            "left",
            "top",
            "width",
            "height",
            "rotation",
            "flipHorizontal",
            "flipVertical"
          ].includes(key)
      ))
  )
    unsupported("This object supports only position, size, rotation and flip edits.");
  const p = node.name.namespace,
    a = drawing(node);
  const at = (name: string, value: string | null) => ({ namespace: "", localName: name, value });
  const ch = (
    namespace: string,
    order: readonly string[],
    upsert: { name: { namespace: string; localName: string }; merge: XmlMerge }[],
    remove: readonly string[] = []
  ): XmlMerge => ({
    children: {
      sequence: order.map((localName) => ({ namespace, localName })),
      remove: remove
        .filter((localName) => !upsert.some((item) => item.name.localName === localName))
        .map((localName) => ({ namespace, localName })),
      upsert
    }
  });
  const u = (namespace: string, localName: string, merge: XmlMerge) => ({
    name: { namespace, localName },
    merge
  });
  const nvEdits: ReturnType<typeof u>[] = [];
  const attrs = [];
  for (const [key, xmlKey] of [
    ["name", "name"],
    ["title", "title"],
    ["description", "descr"],
    ["altText", "descr"]
  ] as const)
    if (options[key] !== undefined) attrs.push(at(xmlKey, options[key]));
  if (attrs.length) nvEdits.push(u(p, "cNvPr", { attributes: attrs }));
  if (options.locked !== undefined || options.kind !== undefined) {
    const lock =
      options.locked === undefined
        ? {}
        : ch(
            a,
            ["spLocks", "extLst"],
            [
              u(a, "spLocks", {
                attributes: [
                  at("noSelect", options.locked === null ? null : options.locked ? "1" : "0")
                ]
              })
            ]
          );
    nvEdits.push(
      u(p, "cNvSpPr", {
        ...lock,
        ...(options.kind === undefined
          ? {}
          : { attributes: [at("txBox", options.kind === "text-box" ? "1" : null)] })
      })
    );
  }
  const propEdits: ReturnType<typeof u>[] = [];
  const removes: string[] = [];
  const coords: ReturnType<typeof u>[] = [];
  for (const [name, keys] of [
    [
      "off",
      [
        ["left", "x"],
        ["top", "y"]
      ]
    ],
    [
      "ext",
      [
        ["width", "cx"],
        ["height", "cy"]
      ]
    ]
  ] as const) {
    const values = keys
      .filter(([k]) => options[k] !== undefined)
      .map(([k, v]) => at(v, String(emu(options[k]!))));
    if (values.length) {
      const existingProperties = props(node);
      const existingTransform =
        node.name.localName === "graphicFrame"
          ? child(node, "xfrm")
          : existingProperties && child(existingProperties, "xfrm", a);
      const existingPair = existingTransform && child(existingTransform, name, a);
      for (const [key, attribute] of keys) {
        if (
          options[key] === undefined &&
          (!existingPair || attr(existingPair, attribute) === undefined)
        ) {
          if (name === "ext") invalid("Creating dimensions requires both width and height.");
          values.push(at(attribute, "0"));
        }
      }
    }
    if (values.length) coords.push(u(a, name, { attributes: values }));
  }
  const transformAttributes = [];
  if (options.rotation !== undefined) {
    const angle = Math.sign(options.rotation) * Math.round(Math.abs(options.rotation) * 60000);
    transformAttributes.push(at("rot", String(((angle % 21600000) + 21600000) % 21600000)));
  }
  for (const [key, name] of [
    ["flipHorizontal", "flipH"],
    ["flipVertical", "flipV"]
  ] as const)
    if (options[key] !== undefined) transformAttributes.push(at(name, options[key] ? "1" : "0"));
  if (coords.length || transformAttributes.length)
    propEdits.push(
      u(a, "xfrm", {
        ...ch(a, ["off", "ext", "chOff", "chExt"], coords),
        attributes: transformAttributes
      })
    );
  if (options.kind !== undefined) {
    const key = preset(options.kind);
    propEdits.push(
      u(a, "prstGeom", {
        attributes: [at("prst", key ? shapePresets[key] : "rect")],
        ...ch(a, ["avLst"], [u(a, "avLst", {})])
      })
    );
    removes.push("custGeom");
  }
  const fill = (color: string | null): XmlMerge =>
    color === null || color === "solid"
      ? {}
      : ch(
          a,
          ["srgbClr", "schemeClr", "scrgbClr", "hslClr", "sysClr", "prstClr"],
          [u(a, "srgbClr", { attributes: [at("val", color.toUpperCase())] })],
          ["schemeClr", "scrgbClr", "hslClr", "sysClr", "prstClr"]
        );
  if (options.fill !== undefined) {
    removes.push("noFill", "solidFill", "gradFill", "blipFill", "pattFill", "grpFill");
    propEdits.push(u(a, options.fill === null ? "noFill" : "solidFill", fill(options.fill)));
  }
  if (options.lineColor !== undefined || options.lineWidth !== undefined) {
    const lineChildren =
      options.lineColor === undefined
        ? {}
        : ch(
            a,
            [
              "noFill",
              "solidFill",
              "gradFill",
              "pattFill",
              "prstDash",
              "custDash",
              "round",
              "bevel",
              "miter",
              "headEnd",
              "tailEnd",
              "extLst"
            ],
            [u(a, options.lineColor === null ? "noFill" : "solidFill", fill(options.lineColor))],
            ["noFill", "solidFill", "gradFill", "pattFill"]
          );
    propEdits.push(
      u(a, "ln", {
        ...lineChildren,
        ...(options.lineWidth === undefined
          ? {}
          : {
              attributes: [
                at("w", options.lineWidth === null ? null : String(emu(options.lineWidth)))
              ]
            })
      })
    );
  }
  const top = [];
  if (node.name.localName === "graphicFrame")
    return document.merge(node, {
      children: {
        sequence: ["nvGraphicFramePr", "xfrm", "graphic", "extLst"].map((localName) => ({
          namespace: localName === "graphic" ? a : p,
          localName
        })),
        upsert: propEdits.map((edit) => u(p, "xfrm", edit.merge))
      }
    });
  if (node.name.localName !== "sp") {
    const existing = props(node);
    if (!existing) unsupported("Transform edits require existing shape properties.");
    return document.merge(existing, ch(a, propertyOrder, propEdits));
  }
  if (nvEdits.length) top.push(u(p, "nvSpPr", ch(p, ["cNvPr", "cNvSpPr", "nvPr"], nvEdits)));
  if (propEdits.length) top.push(u(p, "spPr", ch(a, propertyOrder, propEdits, removes)));
  let updated = document.merge(node, ch(p, ["nvSpPr", "spPr", "style", "txBody", "extLst"], top));
  if (options.text !== undefined) {
    const path: number[] = [];
    function locate(n: XmlElement): boolean {
      if (n === node) return true;
      for (let i = 0; i < n.children.length; i++) {
        path.push(i);
        if (locate(n.children[i]!)) return true;
        path.pop();
      }
      return false;
    }
    locate(document.root);
    const target = path.reduce((n, i) => n.children[i]!, updated.root);
    let body = child(target, "txBody");
    if (!body) {
      const extensionIndex = target.children.findIndex(
        (n) => n.name.namespace === p && n.name.localName === "extLst"
      );
      updated = updated.spliceChildren(
        target,
        extensionIndex < 0 ? target.children.length : extensionIndex,
        0,
        [`<p:txBody xmlns:p="${p}" xmlns:a="${a}"><a:bodyPr/><a:lstStyle/><a:p/></p:txBody>`]
      );
      body = child(
        path.reduce((n, i) => n.children[i]!, updated.root),
        "txBody"
      )!;
    }
    updated = applyFrameFormatting(updated, body, { text: options.text });
  }
  return updated;
}
export function createShapeXml(
  kind: ShapeKind,
  id: number,
  options: ShapeUpdate,
  presentationNamespace = pns
): string {
  validateShapeOptions({ ...options, kind }, true);
  if (!Number.isInteger(id) || id < 1 || id > 4294967295)
    invalid("Shape identity must be a positive unsigned 32-bit integer.");
  if (![pns, "http://purl.oclc.org/ooxml/presentationml/main"].includes(presentationNamespace))
    invalid();
  const a = presentationNamespace === pns ? ans : "http://purl.oclc.org/ooxml/drawingml/main";
  let doc = parseXmlPart(
    new TextEncoder().encode(
      `<p:sp xmlns:p="${presentationNamespace}" xmlns:a="${a}"><p:nvSpPr><p:cNvPr id="${id}" name="Shape ${id}"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr><p:spPr/></p:sp>`
    ),
    { maxBytes: 1000000, maxNodes: 100000, maxDepth: 64 }
  );
  doc = applyShapeUpdate(doc, doc.root, { ...options, kind, text: options.text ?? "" });
  return doc.markup(doc.root, true);
}
export class Shape {
  #xml: XmlPart;
  constructor(xml: XmlPart) {
    if (xml.root.name.localName !== "sp") invalid();
    drawing(xml.root);
    this.#xml = xml;
  }
  get xml() {
    return this.#xml;
  }
  get element() {
    return this.#xml.root;
  }
  get shape_id() {
    return readShape(this.element).shapeId;
  }
  get name() {
    return readShape(this.element).name;
  }
  set name(v: string) {
    this.#xml = applyShapeUpdate(this.#xml, this.element, { name: v });
  }
  get title() {
    return readShape(this.element).title;
  }
  set title(v: string | null) {
    this.#xml = applyShapeUpdate(this.#xml, this.element, { title: v });
  }
  get description() {
    return readShape(this.element).description;
  }
  set description(v: string | null) {
    this.#xml = applyShapeUpdate(this.#xml, this.element, { description: v });
  }
  get locked() {
    return readShape(this.element).locked;
  }
  set locked(v: boolean | null) {
    this.#xml = applyShapeUpdate(this.#xml, this.element, { locked: v });
  }
  get left() {
    const v = readShape(this.element).left;
    return v === null ? null : new Length(v);
  }
  set left(v: Length | null) {
    if (!(v instanceof Length)) invalid();
    this.#xml = applyShapeUpdate(this.#xml, this.element, { left: v });
  }
  get top() {
    const v = readShape(this.element).top;
    return v === null ? null : new Length(v);
  }
  set top(v: Length | null) {
    if (!(v instanceof Length)) invalid();
    this.#xml = applyShapeUpdate(this.#xml, this.element, { top: v });
  }
  get width() {
    const v = readShape(this.element).width;
    return v === null ? null : new Length(v);
  }
  set width(v: Length | null) {
    if (!(v instanceof Length)) invalid();
    this.#xml = applyShapeUpdate(this.#xml, this.element, { width: v });
  }
  get height() {
    const v = readShape(this.element).height;
    return v === null ? null : new Length(v);
  }
  set height(v: Length | null) {
    if (!(v instanceof Length)) invalid();
    this.#xml = applyShapeUpdate(this.#xml, this.element, { height: v });
  }
  get rotation() {
    return readShape(this.element).rotation;
  }
  set rotation(v: number) {
    this.#xml = applyShapeUpdate(this.#xml, this.element, { rotation: v });
  }
  get flip_horizontal() {
    return readShape(this.element).flipHorizontal;
  }
  set flip_horizontal(v: boolean) {
    this.#xml = applyShapeUpdate(this.#xml, this.element, { flipHorizontal: v });
  }
  get flip_vertical() {
    return readShape(this.element).flipVertical;
  }
  set flip_vertical(v: boolean) {
    this.#xml = applyShapeUpdate(this.#xml, this.element, { flipVertical: v });
  }
  get is_placeholder() {
    return readShape(this.element).placeholder !== null;
  }
  get placeholder_format() {
    const ph = readShape(this.element).placeholder;
    if (!ph) invalid("Shape is not a placeholder.");
    return { ...ph, type: PP_PLACEHOLDER_TYPE.from_xml(ph.type) };
  }
  get auto_shape_type() {
    const kind = readShape(this.element).kind;
    if (!kind || kind === "text-box") invalid("Shape has no supported preset type.");
    return MSO_AUTO_SHAPE_TYPE[kind as keyof typeof shapePresets];
  }
  get has_text_frame() {
    return true;
  }
  get text_frame(): TextFrame {
    if (!child(this.element, "txBody"))
      this.#xml = applyShapeUpdate(this.#xml, this.element, { text: "" });
    let owner: XmlPart | undefined;
    let cached: XmlPart | undefined;
    const read = () => {
      if (owner === this.#xml && cached) return cached;
      const body = child(this.element, "txBody");
      if (!body) unsupported("Text frame no longer exists.");
      cached = parseXmlPart(new TextEncoder().encode(this.#xml.markup(body, true)), {
        maxBytes: 1000000,
        maxNodes: 100000,
        maxDepth: 64
      });
      owner = this.#xml;
      return cached;
    };
    const write = (xml: XmlPart) => {
      const body = child(this.element, "txBody");
      if (!body) unsupported("Text frame no longer exists.");
      this.#xml = this.#xml.spliceChildren(this.element, this.element.children.indexOf(body), 1, [
        xml.markup(xml.root, true)
      ]);
    };
    const extents = () => {
      const shape = readShape(this.element);
      return shape.width === null || shape.height === null
        ? undefined
        : { width: shape.width / 12700, height: shape.height / 12700 };
    };
    return new TextFrame(read(), extents(), { read, write, extents });
  }
  get fill(): FillFormat {
    return new FillFormat(
      () => this.#xml,
      (update) => {
        this.#xml = applyShapeUpdate(this.#xml, this.element, update);
      },
      false
    );
  }
  get line(): LineFormat {
    return new LineFormat(
      () => this.#xml,
      (update) => {
        this.#xml = applyShapeUpdate(this.#xml, this.element, update);
      }
    );
  }
  get shape_type(): MSO_SHAPE_TYPE {
    const record = readShape(this.element);
    if (record.placeholder) return MSO_SHAPE_TYPE.PLACEHOLDER;
    if (record.kind === "text-box") return MSO_SHAPE_TYPE.TEXT_BOX;
    const pr = props(this.element);
    if (pr && child(pr, "custGeom", drawing(this.element))) return MSO_SHAPE_TYPE.FREEFORM;
    if (record.kind) return MSO_SHAPE_TYPE.AUTO_SHAPE;
    unsupported("Shape category is unsupported.");
  }
  get has_chart() {
    return false;
  }
  get has_table() {
    return false;
  }
  get text() {
    const body = child(this.element, "txBody");
    if (!body) return "";
    return new TextFrame(
      parseXmlPart(new TextEncoder().encode(this.#xml.markup(body, true)), {
        maxBytes: 1000000,
        maxNodes: 100000,
        maxDepth: 64
      })
    ).text;
  }
  set text(v: string) {
    this.#xml = applyShapeUpdate(this.#xml, this.element, { text: v });
  }
}
export class ShapeColorFormat {
  constructor(
    private readonly read: () => XmlPart,
    private readonly update: (value: ShapeUpdate) => void,
    private readonly line: boolean
  ) {}
  get type() {
    const node = this.read().root,
      a = drawing(node),
      pr = props(node),
      owner = this.line ? pr && child(pr, "ln", a) : pr,
      fill = owner && child(owner, "solidFill", a);
    return fill ? (readRunColor(fill)?.type ?? null) : null;
  }
  get rgb(): RGBColor {
    const record = readShape(this.read().root);
    const value = this.line ? record.lineColor : record.fill;
    if (value === null) throw new ColorPropertyAccessError("RGB color is unavailable.");
    return RGBColor.from_string(value);
  }
  set rgb(value: RGBColor) {
    if (!(value instanceof RGBColor)) invalid("A color value object is required.");
    this.update(this.line ? { lineColor: value.toString() } : { fill: value.toString() });
  }
}
export class FillFormat {
  constructor(
    private readonly read: () => XmlPart,
    private readonly update: (value: ShapeUpdate) => void,
    private readonly line: boolean
  ) {}
  get type(): number | null {
    const record = readShape(this.read().root);
    const kind = this.line ? record.lineFillType : record.fillType;
    const types: Record<string, number> = {
      solidFill: 1,
      pattFill: 2,
      gradFill: 3,
      blipFill: 6,
      noFill: 5,
      grpFill: 101
    };
    return kind === null ? null : (types[kind] ?? null);
  }
  solid(): void {
    if (this.type === 1) return;
    this.update(this.line ? { lineColor: "solid" } : { fill: "solid" });
  }
  background(): void {
    this.update(this.line ? { lineColor: null } : { fill: null });
  }
  get fore_color(): ShapeColorFormat {
    if (this.type !== 1)
      throw new ColorPropertyAccessError("Foreground color requires a solid fill.");
    return new ShapeColorFormat(this.read, this.update, this.line);
  }
}
export class LineFormat {
  constructor(
    private readonly read: () => XmlPart,
    private readonly update: (value: ShapeUpdate) => void
  ) {}
  get width(): Length {
    return new Length(readShape(this.read().root).lineWidth ?? 0);
  }
  set width(value: Length | null) {
    if (value !== null && !(value instanceof Length)) invalid();
    this.update({ lineWidth: value });
  }
  get fill(): FillFormat {
    return new FillFormat(this.read, this.update, true);
  }
  get color(): ShapeColorFormat {
    if (this.fill.type !== 1) this.fill.solid();
    return new ShapeColorFormat(this.read, this.update, true);
  }
}

import { OfficeError } from "./errors.js";
import { Length } from "./length.js";
import { MSO_COLOR_TYPE, MSO_THEME_COLOR_INDEX } from "./color-enums.js";
import { attr, child } from "./masters.js";
import { parseXmlPart, type XmlElement, type XmlPart, type XmlMerge } from "./xml.js";
import { TextFrame, applyFrameFormatting } from "./text-frames.js";
import {
  RGBColor,
  ColorPropertyAccessError,
  readRunColor,
  colorMerge,
  colorBrightnessMerge
} from "./text-run-color.js";
import { MSO_SHAPE_TYPE } from "./shape-types.js";
export { MSO_SHAPE_TYPE } from "./shape-types.js";
import { MSO_AUTO_SHAPE_TYPE, shapePresets } from "./shape-presets.js";
import { PP_PLACEHOLDER_TYPE } from "./shape-placeholder-types.js";
export { PP_PLACEHOLDER_TYPE, PP_PLACEHOLDER } from "./shape-placeholder-types.js";
export { MSO_AUTO_SHAPE_TYPE, MSO_SHAPE, shapePresets } from "./shape-presets.js";
import { applyDrawingUpdate, readDrawingFormat, readDrawingColor } from "./drawing-format.js";
import { patternTokens, dashTokens } from "./drawing-enums.js";
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
  if ([ans, "http://purl.oclc.org/ooxml/drawingml/main"].includes(node.name.namespace))
    return node.name.namespace;
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
  #textFrame: TextFrame | undefined;
  constructor(xml: XmlPart) {
    if (!["sp", "grpSp"].includes(xml.root.name.localName)) invalid();
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
    return this.element.name.localName === "sp";
  }
  get text_frame(): TextFrame {
    if (!this.has_text_frame) unsupported("This shape has no text frame.");
    if (this.#textFrame) return this.#textFrame;
    if (!child(this.element, "txBody"))
      this.#xml = applyShapeUpdate(this.#xml, this.element, { text: "" });
    let owner: XmlPart | undefined;
    let cached: XmlPart | undefined;
    const read = () => {
      if (owner === this.#xml && cached) return cached;
      const body = child(this.element, "txBody");
      if (!body) unsupported("Text frame no longer exists.");
      cached = this.#xml.subtree(body);
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
    this.#textFrame = new TextFrame(read(), extents(), { read, write, extents, parent: this });
    return this.#textFrame;
  }
  get fill(): FillFormat {
    return new FillFormat(
      () => this.#xml,
      (update) => {
        this.#xml = applyShapeUpdate(this.#xml, this.element, update);
      },
      false,
      (transform) => {
        this.#xml = transform(this.#xml, this.element);
      }
    );
  }
  get shadow(): ShadowFormat {
    return new ShadowFormat(
      () => this.#xml,
      (transform) => {
        this.#xml = transform(this.#xml, this.element);
      }
    );
  }
  get line(): LineFormat {
    return new LineFormat(
      () => this.#xml,
      (update) => {
        this.#xml = applyShapeUpdate(this.#xml, this.element, update);
      },
      (transform) => {
        this.#xml = transform(this.#xml, this.element);
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
    return this.text_frame.text;
  }
  set text(v: string) {
    this.text_frame.text = v;
  }
}
type DrawingEdit = (transform: (xml: XmlPart, shape: XmlElement) => XmlPart) => void;
type ColorOwner = (shape: XmlElement) => XmlElement;
export class ShapeColorFormat {
  constructor(
    private readonly read: () => XmlPart,
    private readonly edit: DrawingEdit,
    private readonly owner: ColorOwner
  ) {}
  get type(): MSO_COLOR_TYPE | null {
    const type = readRunColor(this.owner(this.read().root))?.type;
    return type === undefined ? null : MSO_COLOR_TYPE[type];
  }
  get rgb(): RGBColor {
    const v = readRunColor(this.owner(this.read().root))?.rgb;
    if (!v) throw new ColorPropertyAccessError("RGB color is unavailable.");
    return RGBColor.from_string(v);
  }
  set rgb(v: RGBColor) {
    if (!(v instanceof RGBColor)) invalid();
    this.edit((doc, node) => {
      const owner = this.owner(node);
      return doc.merge(owner, colorMerge(v.toString(), owner.name.namespace));
    });
  }
  get theme_color(): MSO_THEME_COLOR_INDEX {
    const c = readRunColor(this.owner(this.read().root));
    if (!c) throw new ColorPropertyAccessError("Theme color is unavailable.");
    return c.theme === null
      ? MSO_THEME_COLOR_INDEX.NOT_THEME_COLOR
      : MSO_THEME_COLOR_INDEX.from_xml(c.theme);
  }
  set theme_color(v: MSO_THEME_COLOR_INDEX) {
    const theme = MSO_THEME_COLOR_INDEX.to_xml(v);
    this.edit((doc, node) => {
      const owner = this.owner(node);
      return doc.merge(owner, colorMerge({ theme }, owner.name.namespace));
    });
  }
  get brightness() {
    return readRunColor(this.owner(this.read().root))?.brightness ?? 0;
  }
  set brightness(v: number) {
    this.edit((doc, node) => {
      const owner = this.owner(node),
        color = owner.children.find(
          (n) =>
            n.name.namespace === owner.name.namespace &&
            ["srgbClr", "schemeClr", "scrgbClr", "hslClr", "sysClr", "prstClr"].includes(
              n.name.localName
            )
        );
      if (!color) invalid("Brightness requires a color.");
      return doc.merge(color, colorBrightnessMerge(v, color.name.namespace));
    });
  }
  get opacity() {
    return readDrawingColor(this.owner(this.read().root))?.opacity ?? null;
  }
  set opacity(v: number | null) {
    if (v !== null && (!Number.isFinite(v) || v < 0 || v > 1)) invalid();
    this.edit((doc, node) => {
      const owner = this.owner(node),
        color = owner.children.find(
          (n) =>
            n.name.namespace === owner.name.namespace &&
            ["srgbClr", "schemeClr", "scrgbClr", "hslClr", "sysClr", "prstClr"].includes(
              n.name.localName
            )
        );
      if (!color) invalid("Alpha requires a color.");
      return doc.merge(color, {
        children: {
          sequence: [{ namespace: color.name.namespace, localName: "alpha" }],
          remove: v === null ? [{ namespace: color.name.namespace, localName: "alpha" }] : [],
          upsert:
            v === null
              ? []
              : [
                  {
                    name: { namespace: color.name.namespace, localName: "alpha" },
                    merge: {
                      attributes: [
                        { namespace: "", localName: "val", value: String(Math.round(v * 100000)) }
                      ]
                    }
                  }
                ]
        }
      });
    });
  }
}
function fillPosition(owner: XmlElement, fill: XmlElement | undefined, namespace: string) {
  if (fill) return owner.children.indexOf(fill);
  const after = owner.children.findIndex(
    (node) =>
      node.name.namespace === namespace &&
      [
        "ln",
        "prstDash",
        "custDash",
        "round",
        "bevel",
        "miter",
        "headEnd",
        "tailEnd",
        "effectLst",
        "effectDag",
        "scene3d",
        "sp3d",
        "extLst"
      ].includes(node.name.localName)
  );
  return after < 0 ? owner.children.length : after;
}
function gradientNodes(owner: XmlElement) {
  return owner.children.filter(
    (node) => node.name.namespace === owner.name.namespace && node.name.localName === "gs"
  );
}
export class FillFormat {
  constructor(
    private readonly read: () => XmlPart,
    private readonly update: ((value: ShapeUpdate) => void) | undefined,
    private readonly line: boolean,
    private readonly edit?: DrawingEdit,
    private readonly fillOwner?: (node: XmlElement) => XmlElement | undefined
  ) {}
  private owner(node: XmlElement) {
    if (this.fillOwner) return this.fillOwner(node);
    const pr = props(node);
    const result = this.line ? pr && child(pr, "ln", drawing(node)) : pr;
    return result;
  }
  private fill(node: XmlElement) {
    const owner = this.owner(node);
    return owner?.children.find(
      (n) =>
        n.name.namespace === drawing(node) &&
        ["solidFill", "gradFill", "pattFill", "blipFill", "noFill", "grpFill"].includes(
          n.name.localName
        )
    );
  }
  private change(transform: (doc: XmlPart, node: XmlElement) => XmlPart) {
    if (!this.edit) unsupported("This view does not support extended drawing edits.");
    this.edit(transform);
  }
  get type(): number | null {
    const f = this.fill(this.read().root);
    return f
      ? ({ solidFill: 1, pattFill: 2, gradFill: 3, blipFill: 6, noFill: 5, grpFill: 101 }[
          f.name.localName
        ] ?? null)
      : null;
  }
  solid() {
    if (this.fillOwner) {
      if (this.type !== 1)
        this.change((doc, node) => {
          const owner = this.owner(node)!,
            fill = this.fill(node);
          return doc.spliceChildren(owner, fillPosition(owner, fill, drawing(node)), fill ? 1 : 0, [
            `<a:solidFill xmlns:a="${drawing(node)}"/>`
          ]);
        });
      return;
    }
    if (this.type !== 1) {
      if (!this.update) unsupported("This view does not support drawing edits.");
      this.update(this.line ? { lineColor: "solid" } : { fill: "solid" });
    }
  }
  background() {
    if (this.fillOwner) {
      this.change((doc, node) => {
        const owner = this.owner(node)!,
          fill = this.fill(node);
        return doc.spliceChildren(owner, fillPosition(owner, fill, drawing(node)), fill ? 1 : 0, [
          `<a:noFill xmlns:a="${drawing(node)}"/>`
        ]);
      });
      return;
    }
    if (!this.update) unsupported("This view does not support drawing edits.");
    this.update(this.line ? { lineColor: null } : { fill: null });
  }
  gradient() {
    if (this.type === 3) return;
    if (!this.owner(this.read().root)) this.solid();
    this.change((doc, node) => {
      const owner = this.owner(node)!,
        fill = this.fill(node),
        a = drawing(node);
      return doc.spliceChildren(owner, fillPosition(owner, fill, drawing(node)), fill ? 1 : 0, [
        `<a:gradFill xmlns:a="${a}" rotWithShape="1"><a:gsLst><a:gs pos="0"><a:schemeClr val="accent1"><a:tint val="100000"/><a:shade val="100000"/><a:satMod val="130000"/></a:schemeClr></a:gs><a:gs pos="100000"><a:schemeClr val="accent1"><a:tint val="50000"/><a:shade val="100000"/><a:satMod val="350000"/></a:schemeClr></a:gs></a:gsLst><a:lin ang="16200000" scaled="1"/></a:gradFill>`
      ]);
    });
  }
  patterned() {
    if (this.type === 2) return;
    if (!this.owner(this.read().root)) this.solid();
    this.change((doc, node) => {
      const owner = this.owner(node)!,
        fill = this.fill(node);
      return doc.spliceChildren(owner, fillPosition(owner, fill, drawing(node)), fill ? 1 : 0, [
        `<a:pattFill xmlns:a="${drawing(node)}"/>`
      ]);
    });
  }
  get gradient_angle(): number | null {
    const fill = this.fill(this.read().root);
    if (fill?.name.localName !== "gradFill" || child(fill, "path"))
      throw new ColorPropertyAccessError("Linear gradient angle is unavailable.");
    const lin = child(fill, "lin");
    return lin ? (((360 - Number(attr(lin, "ang")) / 60000) % 360) + 360) % 360 : null;
  }
  set gradient_angle(v: number) {
    void this.gradient_angle;
    if (!Number.isFinite(v) || Math.abs(v) > 360000) invalid();
    this.change((doc, node) => {
      const fill = this.fill(node)!;
      return doc.merge(fill, {
        children: {
          sequence: ["gsLst", "lin", "path", "tileRect"].map((localName) => ({
            namespace: fill.name.namespace,
            localName
          })),
          upsert: [
            {
              name: { namespace: fill.name.namespace, localName: "lin" },
              merge: {
                attributes: [
                  {
                    namespace: "",
                    localName: "ang",
                    value: String(
                      Math.round(((((360 - (v % 360)) % 360) + 360) % 360) * 60000) % 21600000
                    )
                  }
                ]
              }
            }
          ]
        }
      });
    });
  }
  get gradient_stops(): GradientStops {
    if (this.type !== 3) throw new ColorPropertyAccessError("Gradient stops are unavailable.");
    if (!child(this.fill(this.read().root)!, "gsLst"))
      this.change((doc, node) => {
        const fill = this.fill(node)!;
        return doc.spliceChildren(fill, 0, 0, [
          `<a:gsLst xmlns:a="${fill.name.namespace}"><a:gs pos="0"><a:schemeClr val="accent1"><a:tint val="100000"/><a:shade val="100000"/><a:satMod val="130000"/></a:schemeClr></a:gs><a:gs pos="100000"><a:schemeClr val="accent1"><a:tint val="50000"/><a:shade val="100000"/><a:satMod val="350000"/></a:schemeClr></a:gs></a:gsLst>`
        ]);
      });
    return new GradientStops(
      this.read,
      (t) => this.change(t),
      (node) => child(this.fill(node)!, "gsLst")!
    );
  }
  get pattern(): number | null {
    if (this.type !== 2) throw new ColorPropertyAccessError("Pattern is unavailable.");
    const token = attr(this.fill(this.read().root)!, "prst");
    const key = Object.keys(patternTokens).find((k) => patternTokens[Number(k)] === token);
    return key === undefined ? null : Number(key);
  }
  set pattern(v: number | null) {
    if (this.type !== 2) throw new ColorPropertyAccessError("Pattern is unavailable.");
    if (v !== null && (typeof v !== "number" || !Object.hasOwn(patternTokens, v))) invalid();
    this.change((doc, node) =>
      doc.merge(this.fill(node)!, {
        attributes: [
          { namespace: "", localName: "prst", value: v === null ? null : patternTokens[v]! }
        ]
      })
    );
  }
  private color(back: boolean): ShapeColorFormat {
    if ((this.type !== 1 && this.type !== 2) || (back && this.type !== 2))
      throw new ColorPropertyAccessError("Fill color is unavailable.");
    if (this.type === 2) {
      const tag = back ? "bgClr" : "fgClr";
      if (!child(this.fill(this.read().root)!, tag))
        this.change((doc, node) => {
          const fill = this.fill(node)!;
          const afterForeground = fill.children.findIndex(
            (n) => n.name.namespace !== fill.name.namespace || n.name.localName !== "fgClr"
          );
          return doc.spliceChildren(
            fill,
            back ? (afterForeground < 0 ? fill.children.length : afterForeground) : 0,
            0,
            [
              `<a:${tag} xmlns:a="${fill.name.namespace}"><a:srgbClr val="${back ? "FFFFFF" : "000000"}"/></a:${tag}>`
            ]
          );
        });
    }
    return new ShapeColorFormat(
      this.read,
      (t) => this.change(t),
      (node) => {
        const f = this.fill(node)!;
        return f.name.localName === "pattFill" ? child(f, back ? "bgClr" : "fgClr")! : f;
      }
    );
  }
  get fore_color() {
    return this.color(false);
  }
  get back_color() {
    return this.color(true);
  }
}
export class GradientStop {
  constructor(
    private readonly read: () => XmlPart,
    private readonly edit: DrawingEdit,
    private readonly owner: ColorOwner,
    readonly index: number
  ) {}
  private node(shape: XmlElement) {
    const n = gradientNodes(this.owner(shape))[this.index];
    if (!n) invalid("Gradient stop is unavailable.");
    return n;
  }
  get position() {
    return Number(attr(this.node(this.read().root), "pos")) / 100000;
  }
  set position(v: number) {
    if (!Number.isFinite(v) || v < 0 || v > 1) invalid();
    this.edit((doc, node) =>
      doc.merge(this.node(node), {
        attributes: [{ namespace: "", localName: "pos", value: String(Math.round(v * 100000)) }]
      })
    );
  }
  get color() {
    return new ShapeColorFormat(this.read, this.edit, (node) => this.node(node));
  }
}
export class GradientStops implements Iterable<GradientStop> {
  private readonly cache = new Map<number, GradientStop>();
  constructor(
    private readonly read: () => XmlPart,
    private readonly edit: DrawingEdit,
    private readonly owner: ColorOwner
  ) {}
  get length() {
    return gradientNodes(this.owner(this.read().root)).length;
  }
  at(index: number) {
    if (!Number.isInteger(index) || index < -this.length || index >= this.length)
      invalid("Gradient stop index is out of range.");
    const i = index < 0 ? index + this.length : index;
    let stop = this.cache.get(i);
    if (!stop) {
      stop = new GradientStop(this.read, this.edit, this.owner, i);
      this.cache.set(i, stop);
    }
    return stop;
  }
  *[Symbol.iterator]() {
    for (let i = 0; i < this.length; i++) yield this.at(i);
  }
  slice(start?: number, end?: number) {
    return Array.from(this).slice(start, end);
  }
  includes(value: GradientStop) {
    return Array.from(this).includes(value);
  }
  count(value: GradientStop) {
    return this.includes(value) ? 1 : 0;
  }
  index(value: GradientStop) {
    const i = Array.from(this).indexOf(value);
    if (i < 0) invalid("Gradient stop is not in this collection.");
    return i;
  }
  reversed() {
    return Array.from(this).reverse();
  }
}
export class ShadowFormat {
  constructor(
    private readonly read: () => XmlPart,
    private readonly edit: DrawingEdit
  ) {}
  get inherit() {
    return readDrawingFormat(this.read().root).shadowInherit;
  }
  set inherit(value: boolean) {
    this.edit((doc, node) => applyDrawingUpdate(doc, node, { shadowInherit: value }));
  }
}
export class LineFormat {
  constructor(
    private readonly read: () => XmlPart,
    private readonly update: (value: ShapeUpdate) => void,
    private readonly edit?: DrawingEdit
  ) {}
  get width(): Length {
    return new Length(readShape(this.read().root).lineWidth ?? 0);
  }
  set width(value: Length | null) {
    if (value !== null && !(value instanceof Length)) invalid();
    this.update({ lineWidth: value });
  }
  get fill() {
    return new FillFormat(this.read, this.update, true, this.edit);
  }
  get color() {
    if (this.fill.type !== 1) this.fill.solid();
    return this.fill.fore_color;
  }
  get dash_style(): number | null {
    const token = readDrawingFormat(this.read().root).line.dash;
    const key = Object.keys(dashTokens).find((k) => dashTokens[Number(k)] === token);
    return key === undefined ? null : Number(key);
  }
  set dash_style(v: number | null) {
    if (v !== null && (typeof v !== "number" || !Object.hasOwn(dashTokens, v))) invalid();
    if (!this.edit) unsupported("Extended line editing is unavailable.");
    this.edit((doc, node) =>
      applyDrawingUpdate(doc, node, { line: { dash: v === null ? null : dashTokens[v]! } })
    );
  }
}

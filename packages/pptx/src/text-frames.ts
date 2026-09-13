import { protectedEquationNodes } from "./equations-compatibility.js";
import type { FontMetricsHandle } from "./font-metrics.js";
import { fitFrameXml, type ModelTextFitOptions } from "./text-fitting.js";
import { SaxesParser } from "saxes";
import { Length, Pt } from "./length.js";
import type { BinaryInput, Location } from "./contracts.js";
import { InvalidHandleError, OfficeError } from "./errors.js";
import { Paragraph } from "./text-paragraphs.js";
import { loadShared } from "./masters.js";
import { SelectionError, type SelectionContext } from "./selectors.js";
import {
  readTextBodies,
  validateTextReadingOptions,
  type ReadPresentationTextOptions
} from "./text-reading.js";
import type { XmlElement, XmlMerge, XmlPart } from "./xml.js";

import { MSO_AUTO_SIZE, MSO_VERTICAL_ANCHOR } from "./text-frame-enums.js";
export { MSO_AUTO_SIZE, MSO_VERTICAL_ANCHOR, MSO_ANCHOR } from "./text-frame-enums.js";
export const textVerticalModes = [
  "horz",
  "vert",
  "vert270",
  "wordArtVert",
  "eaVert",
  "mongolianVert",
  "wordArtVertRtl"
] as const;
export interface TextFrameFormatting {
  readonly marginLeft?: number | null;
  readonly marginRight?: number | null;
  readonly marginTop?: number | null;
  readonly marginBottom?: number | null;
  readonly verticalAnchor?: "top" | "middle" | "bottom" | MSO_VERTICAL_ANCHOR | null;
  readonly columns?: number | null;
  readonly wrap?: boolean | null;
  readonly verticalText?: (typeof textVerticalModes)[number] | null;
  readonly rotation?: number | null;
  readonly autofit?: "none" | "shape" | "text" | MSO_AUTO_SIZE | null;
  readonly text?: string;
}
export interface MutateTextFramesOptions extends ReadPresentationTextOptions, TextFrameFormatting {
  readonly all?: boolean;
  readonly allowEmpty?: boolean;
}
const drawingNamespaces = [
  "http://schemas.openxmlformats.org/drawingml/2006/main",
  "http://purl.oclc.org/ooxml/drawingml/main"
];
const keys = [
  "marginLeft",
  "marginRight",
  "marginTop",
  "marginBottom",
  "verticalAnchor",
  "columns",
  "wrap",
  "verticalText",
  "rotation",
  "autofit",
  "text"
] as const;
const insetAttributes = {
  marginLeft: "lIns",
  marginRight: "rIns",
  marginTop: "tIns",
  marginBottom: "bIns"
} as const;
const anchorValues = { top: "t", middle: "ctr", bottom: "b", 1: "t", 3: "ctr", 4: "b" };
const fitValues = {
  none: "noAutofit",
  shape: "spAutoFit",
  text: "normAutofit",
  0: "noAutofit",
  1: "spAutoFit",
  2: "normAutofit"
};
function invalid(): never {
  throw new OfficeError("invalid-value", "Invalid text frame options.", "usage");
}
function malformed(): never {
  throw new OfficeError("invalid-xml", "Invalid text frame properties.", "parse");
}
export function validateTextFrameOptions(options: MutateTextFramesOptions): void {
  if (
    !options ||
    typeof options !== "object" ||
    ![Object.prototype, null].includes(Object.getPrototypeOf(options)) ||
    Object.keys(options).some(
      (k) => ![...keys, "scope", "select", "shape", "all", "allowEmpty"].includes(k)
    ) ||
    !keys.some((k) => options[k] !== undefined)
  )
    invalid();
  const { scope, select, shape } = options;
  validateTextReadingOptions({
    ...(scope === undefined ? {} : { scope }),
    ...(select === undefined ? {} : { select }),
    ...(shape === undefined ? {} : { shape })
  });
  for (const key of ["all", "allowEmpty"] as const)
    if (options[key] !== undefined && typeof options[key] !== "boolean") invalid();
  for (const key of Object.keys(insetAttributes) as (keyof typeof insetAttributes)[]) {
    const v = options[key];
    if (
      v != null &&
      (typeof v !== "number" ||
        !Number.isFinite(v) ||
        v < -2147483648 / 12700 ||
        v > 2147483647 / 12700)
    )
      invalid();
  }
  if (options.wrap != null && typeof options.wrap !== "boolean") invalid();
  if (
    options.columns != null &&
    (!Number.isInteger(options.columns) || options.columns < 1 || options.columns > 16)
  )
    invalid();
  if (
    options.rotation != null &&
    (typeof options.rotation !== "number" ||
      !Number.isFinite(options.rotation) ||
      options.rotation < -2147483648 / 60000 ||
      options.rotation > 2147483647 / 60000)
  )
    invalid();
  if (options.verticalText != null && !textVerticalModes.includes(options.verticalText)) invalid();
  if (
    options.verticalAnchor != null &&
    !(typeof options.verticalAnchor === "number"
      ? [1, 3, 4].includes(options.verticalAnchor)
      : ["top", "middle", "bottom"].includes(options.verticalAnchor))
  )
    invalid();
  if (
    options.autofit != null &&
    !(typeof options.autofit === "number"
      ? [0, 1, 2].includes(options.autofit)
      : ["none", "shape", "text"].includes(options.autofit))
  )
    invalid();
  if (options.text !== undefined && typeof options.text !== "string") invalid();
}
function bodyProperties(body: XmlElement): XmlElement | undefined {
  if (
    !(
      body.name.localName === "txBody" &&
      [
        ...drawingNamespaces,
        "http://schemas.openxmlformats.org/presentationml/2006/main",
        "http://purl.oclc.org/ooxml/presentationml/main"
      ].includes(body.name.namespace)
    ) &&
    !(
      body.name.localName === "rich" &&
      [
        "http://schemas.openxmlformats.org/drawingml/2006/chart",
        "http://purl.oclc.org/ooxml/drawingml/chart"
      ].includes(body.name.namespace)
    )
  )
    malformed();
  const children = body.children.filter(
    (n) => drawingNamespaces.includes(n.name.namespace) && n.name.localName === "bodyPr"
  );
  if (children.length > 1) malformed();
  return children[0];
}
export function readFrameFormatting(body: XmlElement) {
  const p = bodyProperties(body);
  const attr = (key: string) =>
    p?.attributes.find((a) => !a.name.namespace && a.name.localName === key)?.value ?? null;
  const number = (key: string, scale: number) => {
    const raw = attr(key);
    if (raw === null) return null;
    const token = raw.trim();
    const digits = token.startsWith("+") || token.startsWith("-") ? token.slice(1) : token;
    if (
      !digits.length ||
      Array.from(digits).some((c) => c < "0" || c > "9") ||
      !Number.isSafeInteger(Number(raw))
    )
      malformed();
    return Number(raw) / scale;
  };
  const wrap = attr("wrap"),
    anchor = attr("anchor"),
    vertical = attr("vert");
  if (wrap !== null && !["square", "none"].includes(wrap)) malformed();
  const fits =
    p?.children.filter(
      (n) =>
        n.name.namespace === p.name.namespace &&
        ["noAutofit", "normAutofit", "spAutoFit"].includes(n.name.localName)
    ) ?? [];
  if (fits.length > 1) malformed();
  const result = {
    marginLeft: number("lIns", 12700),
    marginRight: number("rIns", 12700),
    marginTop: number("tIns", 12700),
    marginBottom: number("bIns", 12700),
    verticalAnchor:
      anchor === null
        ? null
        : (({ t: "top", ctr: "middle", b: "bottom" } as Record<string, string>)[anchor] ?? anchor),
    columns: number("numCol", 1),
    wrap: wrap === null ? null : wrap === "square",
    verticalText: vertical,
    rotation: number("rot", 60000),
    autofit: fits.length
      ? ({ noAutofit: "none", spAutoFit: "shape", normAutofit: "text" } as const)[
          fits[0]!.name.localName as "noAutofit" | "spAutoFit" | "normAutofit"
        ]
      : null
  };
  // Recognized attributes retain schema bounds even when supplied by package bytes.
  try {
    if (anchor !== null && !["t", "ctr", "b", "just", "dist"].includes(anchor)) malformed();
    validateTextFrameOptions({ ...result, verticalAnchor: null } as TextFrameFormatting);
  } catch {
    malformed();
  }
  return result;
}
export function applyFrameFormatting(
  document: XmlPart,
  node: XmlElement,
  options: TextFrameFormatting
): XmlPart {
  validateTextFrameOptions(options);
  readFrameFormatting(node);
  if (
    options.text !== undefined &&
    (protectedEquationNodes(node).size > 0 || protectedEquationNodes(document.root).has(node))
  )
    throw new OfficeError(
      "unsupported-edit",
      "Whole text replacement cannot remove equations or their fallbacks.",
      "validate-intent"
    );
  const path: number[] = [];
  function locate(current: XmlElement): boolean {
    if (current === node) return true;
    for (const [i, c] of current.children.entries()) {
      path.push(i);
      if (locate(c)) return true;
      path.pop();
    }
    return false;
  }
  if (!locate(document.root)) invalid();
  let result = document;
  const current = () => path.reduce((n, i) => n.children[i]!, result.root);
  let p = bodyProperties(node);
  const ns =
    p?.name.namespace ??
    (node.name.namespace.includes("purl.oclc.org") ? drawingNamespaces[1]! : drawingNamespaces[0]!);
  if (!p) {
    result = result.spliceChildren(current(), 0, 0, [`<bodyPr xmlns="${ns}"/>`]);
    p = bodyProperties(current())!;
  }
  const attributes: NonNullable<XmlMerge["attributes"]>[number][] = [];
  for (const [key, localName] of Object.entries(insetAttributes)) {
    const value = options[key as keyof typeof insetAttributes];
    if (value !== undefined)
      attributes.push({
        namespace: "",
        localName,
        value:
          value === null ? null : String(Math.sign(value) * Math.round(Math.abs(value) * 12700))
      });
  }
  for (const [key, localName] of [
    ["columns", "numCol"],
    ["wrap", "wrap"],
    ["verticalText", "vert"],
    ["rotation", "rot"],
    ["verticalAnchor", "anchor"]
  ] as const) {
    const value = options[key];
    if (value === undefined) continue;
    attributes.push({
      namespace: "",
      localName,
      value:
        value === null
          ? null
          : key === "wrap"
            ? value
              ? "square"
              : "none"
            : key === "rotation"
              ? String(Math.sign(Number(value)) * Math.round(Math.abs(Number(value)) * 60000))
              : key === "verticalAnchor"
                ? anchorValues[value as keyof typeof anchorValues]
                : String(value)
    });
  }
  const name = (localName: string) => ({ namespace: ns, localName });
  const fit = options.autofit == null ? null : fitValues[options.autofit as keyof typeof fitValues];
  result = result.merge(p, {
    attributes,
    ...(options.autofit === undefined
      ? {}
      : {
          children: {
            sequence: [
              "prstTxWarp",
              "noAutofit",
              "normAutofit",
              "spAutoFit",
              "scene3d",
              "sp3d",
              "flatTx",
              "extLst"
            ].map(name),
            remove: ["noAutofit", "normAutofit", "spAutoFit"].filter((n) => n !== fit).map(name),
            upsert: fit ? [{ name: name(fit), merge: {} }] : []
          }
        })
  });
  if (options.text !== undefined) {
    const paragraphs = current().children.flatMap((n, i) =>
      n.name.namespace === ns && n.name.localName === "p" ? [i] : []
    );
    const position = paragraphs[0] ?? current().children.length;
    for (const index of paragraphs.reverse())
      result = result.spliceChildren(current(), index, 1, []);
    const escape = (text: string) =>
      Array.from(text)
        .map((c) => {
          const point = c.codePointAt(0)!;
          return (point < 32 && ![9, 10, 13].includes(point)) ||
            (point >= 0xd800 && point <= 0xdfff) ||
            [0xfffe, 0xffff].includes(point)
            ? `_x${point.toString(16).toUpperCase().padStart(4, "0")}_`
            : c === "&"
              ? "&amp;"
              : c === "<"
                ? "&lt;"
                : c === "\r"
                  ? "&#13;"
                  : c;
        })
        .join("");
    const fragments = options.text.split("\n").map(
      (text) =>
        `<p xmlns="${ns}">${text
          .split("\v")
          .map((piece) => (piece ? `<r><t>${escape(piece)}</t></r>` : ""))
          .join("<br/>")}</p>`
    );
    result = result.spliceChildren(current(), position, 0, fragments);
  }
  return result;
}
export async function readTextFrames(
  input: BinaryInput,
  options: ReadPresentationTextOptions,
  context: SelectionContext
) {
  const bodies = await readTextBodies(input, options, context).catch((error) => {
    if (error instanceof SelectionError && error.code === "missing-selection") return [];
    throw error;
  });
  return bodies
    .filter((body) => body.segment.cell === undefined)
    .map((body) => ({
      location: body.segment.location,
      formatting: readFrameFormatting(body.node)
    }));
}
export async function mutateTextFrames(
  input: BinaryInput,
  options: MutateTextFramesOptions,
  context: SelectionContext
): Promise<{
  readonly bytes: Uint8Array;
  readonly affected: number;
  readonly locations: readonly Location[];
}> {
  validateTextFrameOptions(options);
  if (!options.all && options.select === undefined && options.shape === undefined)
    throw new SelectionError("missing-selection");
  const state = await loadShared(input, context);
  const { scope, select, shape } = options;
  const bodies = await readTextBodies(
    state.source,
    {
      ...(scope === undefined ? {} : { scope }),
      ...(select === undefined ? {} : { select }),
      ...(shape === undefined ? {} : { shape })
    },
    context
  )
    .catch((error) => {
      if (error instanceof SelectionError && error.code === "missing-selection") return [];
      throw error;
    })
    .then((bodies) => bodies.filter((body) => body.segment.cell === undefined));
  if (!bodies.length && !options.allowEmpty) throw new SelectionError("missing-selection");
  if (bodies.length > 1 && !options.all) throw new SelectionError("ambiguous-selection");
  const edits = new Map<string, { document: XmlPart; nodes: Set<XmlElement> }>();
  for (const body of bodies) {
    const edit = edits.get(body.part) ?? { document: body.document, nodes: new Set<XmlElement>() };
    edit.nodes.add(body.node);
    edits.set(body.part, edit);
  }
  for (const [part, edit] of edits) {
    const paths: number[][] = [];
    const visit = (node: XmlElement, path: number[]) => {
      if (edit.nodes.has(node)) paths.push(path);
      node.children.forEach((n, i) => visit(n, [...path, i]));
    };
    visit(edit.document.root, []);
    let document = edit.document;
    for (const path of paths.reverse()) {
      context.signal?.throwIfAborted();
      document = applyFrameFormatting(
        document,
        path.reduce((n, i) => n.children[i]!, document.root),
        options
      );
    }
    state.save(part, document);
  }
  return {
    bytes: bodies.length ? (await state.finish(state.main, [])).bytes : state.source,
    affected: bodies.length,
    locations: bodies.map((b) => b.segment.location)
  };
}
export class TextFrame {
  #paragraphs: Paragraph[] = [];
  #storedXml: XmlPart;
  #binding:
    | {
        readonly read: () => XmlPart;
        readonly write: (xml: XmlPart) => void;
        readonly parent?: unknown;
        readonly extents?: () => { readonly width: number; readonly height: number } | undefined;
      }
    | undefined;
  get #xml(): XmlPart {
    return this.#binding?.read() ?? this.#storedXml;
  }
  set #xml(xml: XmlPart) {
    if (this.#binding) this.#binding.write(xml);
    else this.#storedXml = xml;
  }
  #extents: { readonly width: number; readonly height: number } | undefined;
  constructor(
    xml: XmlPart,
    extents?: { readonly width: number; readonly height: number },
    binding?: {
      readonly read: () => XmlPart;
      readonly write: (xml: XmlPart) => void;
      readonly parent?: unknown;
      readonly extents?: () => { readonly width: number; readonly height: number } | undefined;
    }
  ) {
    readFrameFormatting(xml.root);
    this.#storedXml = xml;
    this.#binding = binding;
    this.#extents = extents === undefined ? undefined : { ...extents };
  }
  fit_text(
    font_family = "Calibri",
    max_size = 18,
    bold = false,
    italic = false,
    font_file?: FontMetricsHandle | null,
    options: ModelTextFitOptions = {}
  ): void {
    const extents = this.#binding?.extents ? this.#binding.extents() : this.#extents;
    const result = fitFrameXml(
      this.#xml,
      { ...options, fontFamily: font_family, maxSize: max_size, bold, italic, metrics: font_file! },
      extents?.width ?? NaN,
      extents?.height ?? NaN
    );
    this.#xml = result.xml;
  }
  get xml(): XmlPart {
    return this.#xml;
  }
  get parent(): unknown {
    return this.#binding?.parent;
  }
  get paragraphs(): readonly Paragraph[] {
    const nodes = this.#xml.root.children.filter(
      (node) => node.name.localName === "p" && drawingNamespaces.includes(node.name.namespace)
    );
    return Object.freeze(
      nodes.map((_, index) => {
        if (this.#paragraphs[index]) return this.#paragraphs[index]!;
        let owner: XmlPart | undefined;
        let cached: XmlPart | undefined;
        const locate = () => {
          if (this.#paragraphs[index] !== handle) throw new InvalidHandleError();
          const xml = this.#xml;
          const node = xml.root.children.filter(
            (child) =>
              child.name.localName === "p" && drawingNamespaces.includes(child.name.namespace)
          )[index];
          if (!node) throw new InvalidHandleError();
          return { xml, node };
        };
        const read = () => {
          const { xml, node } = locate();
          if (owner !== xml) {
            cached = xml.subtree(node);
            owner = xml;
          }
          return cached!;
        };
        const initial = this.#xml.subtree(nodes[index]!);
        const handle: Paragraph = new Paragraph(initial, {
          parent: this,
          read,
          write: (value) => {
            const { xml, node } = locate();
            this.#xml = xml.spliceChildren(xml.root, xml.root.children.indexOf(node), 1, [
              value.markup(value.root, true)
            ]);
          }
        });
        this.#paragraphs[index] = handle;
        return handle;
      })
    );
  }
  add_paragraph(): Paragraph {
    const xml = this.#xml;
    const ns = xml.root.name.namespace.includes("purl.oclc.org")
      ? drawingNamespaces[1]!
      : drawingNamespaces[0]!;
    const extension = xml.root.children.findIndex((node) => node.name.localName === "extLst");
    this.#xml = xml.spliceChildren(
      xml.root,
      extension < 0 ? xml.root.children.length : extension,
      0,
      [`<p xmlns="${ns}"/>`]
    );
    return this.paragraphs.at(-1)!;
  }
  clear(): void {
    const xml = this.#xml;
    if (protectedEquationNodes(xml.root).size > 0)
      throw new OfficeError(
        "unsupported-edit",
        "Whole text replacement cannot remove equations or their fallbacks.",
        "validate-intent"
      );
    const first = this.paragraphs[0];
    if (!first) {
      this.add_paragraph();
      return;
    }
    first.clear();
    let current = this.#xml;
    const indexes = current.root.children.flatMap((node, index) =>
      node.name.localName === "p" && drawingNamespaces.includes(node.name.namespace) ? [index] : []
    );
    for (const index of indexes.slice(1).reverse())
      current = current.spliceChildren(current.root, index, 1, []);
    this.#xml = current;
    this.#paragraphs = [first];
  }
  get margin_left(): Length {
    return new Pt(readFrameFormatting(this.#xml.root).marginLeft ?? 7.2);
  }
  set margin_left(value: Length) {
    if (!(value instanceof Length)) invalid();
    this.#xml = applyFrameFormatting(this.#xml, this.#xml.root, {
      marginLeft: value.emu === 91440 ? null : value.pt
    });
  }
  get margin_right(): Length {
    return new Pt(readFrameFormatting(this.#xml.root).marginRight ?? 7.2);
  }
  set margin_right(value: Length) {
    if (!(value instanceof Length)) invalid();
    this.#xml = applyFrameFormatting(this.#xml, this.#xml.root, {
      marginRight: value.emu === 91440 ? null : value.pt
    });
  }
  get margin_top(): Length {
    return new Pt(readFrameFormatting(this.#xml.root).marginTop ?? 3.6);
  }
  set margin_top(value: Length) {
    if (!(value instanceof Length)) invalid();
    this.#xml = applyFrameFormatting(this.#xml, this.#xml.root, {
      marginTop: value.emu === 45720 ? null : value.pt
    });
  }
  get margin_bottom(): Length {
    return new Pt(readFrameFormatting(this.#xml.root).marginBottom ?? 3.6);
  }
  set margin_bottom(value: Length) {
    if (!(value instanceof Length)) invalid();
    this.#xml = applyFrameFormatting(this.#xml, this.#xml.root, {
      marginBottom: value.emu === 45720 ? null : value.pt
    });
  }
  get word_wrap(): boolean | null {
    return readFrameFormatting(this.#xml.root).wrap;
  }
  set word_wrap(value: boolean | null) {
    this.#xml = applyFrameFormatting(this.#xml, this.#xml.root, { wrap: value });
  }
  get auto_size(): MSO_AUTO_SIZE | null {
    const v = readFrameFormatting(this.#xml.root).autofit;
    return v === null ? null : ({ none: 0, shape: 1, text: 2 } as const)[v];
  }
  set auto_size(value: MSO_AUTO_SIZE | null) {
    if (value !== null && (typeof value !== "number" || ![0, 1, 2].includes(value))) invalid();
    this.#xml = applyFrameFormatting(this.#xml, this.#xml.root, { autofit: value });
  }
  get vertical_anchor(): MSO_VERTICAL_ANCHOR | null {
    const v = readFrameFormatting(this.#xml.root).verticalAnchor;
    if (v === "just" || v === "dist")
      throw new OfficeError(
        "unsupported-profile",
        "Extended frame anchor has no model enum value.",
        "parse"
      );
    return v === null ? null : ({ top: 1, middle: 3, bottom: 4 } as const)[v as "top"];
  }
  set vertical_anchor(value: MSO_VERTICAL_ANCHOR | null) {
    if (value !== null && (typeof value !== "number" || ![1, 3, 4].includes(value))) invalid();
    this.#xml = applyFrameFormatting(this.#xml, this.#xml.root, { verticalAnchor: value });
  }
  get columns(): number {
    return readFrameFormatting(this.#xml.root).columns ?? 1;
  }
  set columns(value: number) {
    this.#xml = applyFrameFormatting(this.#xml, this.#xml.root, { columns: value });
  }
  get vertical_text(): string | null {
    return readFrameFormatting(this.#xml.root).verticalText;
  }
  set vertical_text(value: Exclude<TextFrameFormatting["verticalText"], undefined>) {
    this.#xml = applyFrameFormatting(this.#xml, this.#xml.root, { verticalText: value });
  }
  get rotation(): number {
    return readFrameFormatting(this.#xml.root).rotation ?? 0;
  }
  set rotation(value: number) {
    this.#xml = applyFrameFormatting(this.#xml, this.#xml.root, { rotation: value });
  }
  get text(): string {
    const body = this.#xml.root;
    const texts = (node: XmlElement): string => {
      if (node.name.localName === "br" && drawingNamespaces.includes(node.name.namespace))
        return "\v";
      if (node.name.localName === "t" && drawingNamespaces.includes(node.name.namespace)) {
        const raw = this.#xml.markup(node);
        return decodeText(raw);
      }
      return node.children.map(texts).join("");
    };
    return body.children
      .filter((n) => n.name.localName === "p" && drawingNamespaces.includes(n.name.namespace))
      .map(texts)
      .join("\n");
  }
  set text(value: string) {
    this.#xml = applyFrameFormatting(this.#xml, this.#xml.root, { text: value });
    this.#paragraphs = [];
  }
}

function decodeText(markup: string): string {
  let result = "";
  const parser = new SaxesParser({ xmlns: false });
  parser.on("text", (value) => {
    result += value;
  });
  parser.on("cdata", (value) => {
    result += value;
  });
  parser.write(markup).close();
  return result;
}

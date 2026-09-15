import {
  archiveSettings,
  InputTypeError,
  InvalidValueError,
  type DocumentArchive
} from "./archive.js";
import { validateDocxInvocation } from "./command.js";
import { DocxUsageError } from "./argument-json.js";
import { closedRecord, encodeLocation, type Location } from "./location-token.js";
import { openDocumentLocations } from "./locations.js";
import { resolveDocxSelection } from "./simple-selection.js";
import { DocumentXmlEditor, UnsupportedEditError } from "./xml-write.js";
import { parseDocumentXml, type XmlElement } from "./package-xml.js";
import { documentDialects, dialectForNamespace, type DocumentDialect } from "./dialect.js";
import { assertOutsideRevisionRanges } from "./revision-markup.js";
import {
  assertDocumentEditable,
  publishDocumentArchive,
  type PublicationContext,
  type PublicationInput
} from "./publication.js";
import { LocationIndex } from "./location-index.js";
import { measurePackageResourceSerialization } from "./ancillary-resources.js";
import { xmlValue } from "./create-content.js";
import type { DocxOperationArguments } from "./operation-types.js";
import type { DocumentBudget } from "./budget.js";
export interface ImageLayoutRequest {
  readonly operation: "images.set";
  readonly options: DocxOperationArguments<"images.set">;
  readonly input?: PublicationInput;
}
export interface ImageLayoutData {
  readonly changed: boolean;
  readonly changes: readonly {
    readonly kind: "set";
    readonly before: Location<"image">;
    readonly after: Location<"image">;
  }[];
  readonly output: {
    readonly path: string | null;
    readonly bytes: number;
    readonly sha256: string;
  } | null;
  readonly dryRun: boolean;
}
export interface ImageLayoutContext extends PublicationContext {
  readonly admitPublication?: (planned: ImageLayoutData) => undefined;
}
const attr = (node: XmlElement, name: string) =>
  node.attributes.find((value) => value.namespace === "" && value.localName === name)?.value;
const horizontalFrames = [
  "page",
  "margin",
  "column",
  "character",
  "leftMargin",
  "rightMargin",
  "insideMargin",
  "outsideMargin"
];
const verticalFrames = [
  "page",
  "margin",
  "paragraph",
  "line",
  "topMargin",
  "bottomMargin",
  "insideMargin",
  "outsideMargin"
];
const horizontalAlign = ["left", "right", "center", "inside", "outside"],
  verticalAlign = ["top", "bottom", "center", "inside", "outside"];
const wraps = {
  none: "wrapNone",
  square: "wrapSquare",
  tight: "wrapTight",
  through: "wrapThrough",
  "top-bottom": "wrapTopAndBottom"
};
const wrapSides = ["bothSides", "left", "right", "largest"];
const decorativeNamespace = "http://schemas.microsoft.com/office/drawing/2017/decorative";
function unsupported(): never {
  throw new UnsupportedEditError("Selected image metadata cannot be edited coherently.");
}
function nativeToken(value: string | undefined): string | undefined {
  if (value === undefined) return undefined;
  let start = 0,
    end = value.length;
  while (start < end && " \t\r\n".includes(value[start]!)) start++;
  while (end > start && " \t\r\n".includes(value[end - 1]!)) end--;
  return value.slice(start, end);
}
function integer(value: string | undefined, min: number, max: number): number {
  const token = nativeToken(value);
  if (
    token === undefined ||
    token.length === 0 ||
    token.length > 32 ||
    [...token].some(
      (char, index) => !(char >= "0" && char <= "9") && !(index === 0 && ["-", "+"].includes(char))
    )
  )
    unsupported();
  const result = Number(token);
  if (!Number.isSafeInteger(result) || result < min || result > max) unsupported();
  return result;
}
function boolean(value: string | undefined): boolean {
  const token = nativeToken(value);
  if (token === "1" || token === "true") return true;
  if (token === "0" || token === "false") return false;
  return unsupported();
}

function one(
  parent: XmlElement,
  namespace: string,
  name: string,
  optional = false
): XmlElement | undefined {
  const matches = parent.children.filter(
    (node) => node.namespace === namespace && node.localName === name
  );
  if (matches.length > 1 || (!optional && !matches.length)) unsupported();
  return matches[0];
}
function rounded(value: number, min: number, max: number): number {
  if (!Number.isFinite(value) || (min === 1 ? value <= 0 : value < min) || value > max)
    throw new InvalidValueError("Image layout value exceeds its native range.");
  const result = Math.sign(value) * Math.round(Math.abs(value));
  if (!Number.isSafeInteger(result) || result < min || result > max)
    throw new InvalidValueError("Rounded image layout value exceeds its native range.");
  return result;
}
function length(
  value: { readonly value: number; readonly unit: string },
  min: number,
  max: number
): number {
  return rounded(
    value.value *
      ({ emu: 1, in: 914400, cm: 360000, mm: 36000, pt: 12700 } as Record<string, number>)[
        value.unit
      ]!,
    min,
    max
  );
}
interface Picture {
  frame: XmlElement;
  picture: XmlElement;
  fill: XmlElement;
  blip: XmlElement;
  transform: XmlElement;
  extent: XmlElement;
  innerExtent: XmlElement;
  docPr: XmlElement;
  frameProperties: XmlElement | undefined;
  pictureProperties: XmlElement;
}
function picture(frame: XmlElement, dialect: DocumentDialect, budget: DocumentBudget): Picture {
  const ns = documentDialects[dialect],
    graphic = one(frame, ns.a, "graphic")!,
    data = one(graphic, ns.a, "graphicData")!,
    pic = one(data, ns.pic, "pic")!;
  if (data.children.length !== 1 || attr(data, "uri") !== ns.pic) unsupported();
  const fill = one(pic, ns.pic, "blipFill")!,
    blip = one(fill, ns.a, "blip")!,
    sp = one(pic, ns.pic, "spPr")!,
    transform = one(sp, ns.a, "xfrm")!,
    nv = one(pic, ns.pic, "nvPicPr")!;
  if (
    transform.children.some(
      (node) => node.namespace === ns.a && ["chOff", "chExt"].includes(node.localName)
    )
  )
    unsupported();
  budget.charge(
    "work",
    frame.children.length + pic.children.length + fill.children.length + transform.children.length
  );
  return {
    frame,
    picture: pic,
    fill,
    blip,
    transform,
    extent: one(frame, ns.wp, "extent")!,
    innerExtent: one(transform, ns.a, "ext")!,
    docPr: one(frame, ns.wp, "docPr")!,
    frameProperties: one(frame, ns.wp, "cNvGraphicFramePr", true),
    pictureProperties: one(nv, ns.pic, "cNvPicPr")!
  };
}
function polygon(node: XmlElement, wp: string, budget: DocumentBudget): void {
  const start = one(node, wp, "start")!,
    lines = node.children.filter((child) => child.namespace === wp && child.localName === "lineTo");
  if (lines.length < 2 || node.children.length !== lines.length + 1 || node.children[0] !== start)
    unsupported();
  budget.charge("work", lines.length + 1);
  budget.check("matches", lines.length + 1);
  for (const point of [start, ...lines]) {
    integer(attr(point, "x"), -27273042329600, 27273042316900);
    integer(attr(point, "y"), -27273042329600, 27273042316900);
    if (point.children.length) unsupported();
  }
}
function put(
  xml: DocumentXmlEditor,
  node: XmlElement,
  values: Readonly<Record<string, string>>,
  budget: DocumentBudget
): void {
  const numeric = [
    "cx",
    "cy",
    "rot",
    "l",
    "r",
    "t",
    "b",
    "relativeHeight",
    "distT",
    "distB",
    "distL",
    "distR"
  ];
  const logical = ["allowOverlap", "behindDoc", "noChangeAspect", "flipH", "flipV", "val"];
  const changes = Object.entries(values).filter(([name, value]) => {
    const previous = attr(node, name);
    if (previous === value) return false;
    if (logical.includes(name) && previous !== undefined)
      return boolean(previous) !== boolean(value);
    if (numeric.includes(name) && previous !== undefined) {
      const token = nativeToken(previous)!;
      if (
        token.length > 0 &&
        token.length <= 32 &&
        [...token].every(
          (char, index) =>
            (char >= "0" && char <= "9") || (index === 0 && ["-", "+"].includes(char))
        ) &&
        Number.isSafeInteger(Number(token))
      )
        return Number(token) !== Number(value);
    }
    return true;
  });
  if (!changes.length) return;
  if (changes.every(([name]) => attr(node, name) !== undefined)) {
    for (const [name, value] of changes) xml.setAttribute(node, name, value);
    return;
  }
  const source = xml.sourceXml(node),
    namespaceBytes = [...node.namespaces].reduce(
      (sum, [name, value]) => sum + name.length + value.length * 6 + 12,
      0
    ),
    missing: [string, string][] = [];
  budget.charge("retainedBytes", namespaceBytes * 12 + source.length * 8);
  budget.charge("work", namespaceBytes * 8 + source.length * 4);
  const prefix = `<h${[...node.namespaces]
      .filter(([name]) => name !== "xml")
      .map(([name, value]) => ` xmlns${name ? ":" + name : ""}="${xmlValue(value)}"`)
      .join("")}>`,
    fragment = new DocumentXmlEditor(
      new TextEncoder().encode(prefix + source + "</h>"),
      {},
      undefined,
      budget
    ),
    target = fragment.root.children[0]!;
  for (const [name, value] of changes) {
    if (attr(node, name) !== undefined) fragment.setAttribute(target, name, value);
    else missing.push([name, value]);
  }
  let markup = new TextDecoder().decode(fragment.serialize()).slice(prefix.length, -4),
    quote = "",
    end = -1;
  for (let index = 1; index < markup.length; index++) {
    const char = markup[index]!;
    if (quote) {
      if (char === quote) quote = "";
    } else if (char === '"' || char === "'") quote = char;
    else if (char === ">") {
      end = index;
      break;
    }
  }
  if (end < 0) unsupported();
  const extraSize = missing.reduce(
    (sum, [name, value]) => sum + name.length + value.length * 6 + 4,
    0
  );
  budget.check("xmlPartBytes", source.length + extraSize);
  budget.charge("retainedBytes", extraSize * 12);
  budget.charge("work", extraSize * 8);
  const insertion = markup[end - 1] === "/" ? end - 1 : end,
    extra = missing.map(([name, value]) => ` ${name}="${xmlValue(value)}"`).join("");
  markup = markup.slice(0, insertion) + extra + markup.slice(insertion);
  xml.replaceElement(node, markup);
}

/** Edits bounded physical picture metadata without acquiring or replacing media. */
export async function setDocumentImageLayout(
  input: Uint8Array,
  request: ImageLayoutRequest,
  context: ImageLayoutContext
): Promise<ImageLayoutData> {
  if (!request || ![Object.prototype, null].includes(Object.getPrototypeOf(request)))
    throw new InputTypeError("Expected closed image layout data.");
  closedRecord(request, ["operation", "options", "input"]);
  if (request.operation !== "images.set") throw new DocxUsageError("Expected image layout set.");
  if (request.input !== undefined) {
    if (!request.input || ![Object.prototype, null].includes(Object.getPrototypeOf(request.input)))
      throw new InputTypeError("Expected a closed input identity.");
    closedRecord(request.input, ["path", "stat"]);
    if (
      !request.input.stat ||
      ![Object.prototype, null].includes(Object.getPrototypeOf(request.input.stat))
    )
      throw new InputTypeError("Expected a closed file stat.");
    closedRecord(request.input.stat, [
      "type",
      "size",
      "allocatedBytes",
      "ioBlockSize",
      "preferredIoBlockSize",
      "mode",
      "mtimeMs",
      "atimeMs",
      "ctimeMs",
      "birthtimeMs",
      "revision",
      "identityScope",
      "ino",
      "dev",
      "rdevMajor",
      "rdevMinor",
      "nlink",
      "uid",
      "gid"
    ]);
    request = { ...request, input: { path: request.input.path, stat: { ...request.input.stat } } };
  }
  const settings = archiveSettings(context),
    invocation = validateDocxInvocation(
      {
        operation: "images.set",
        inputs: [request.input?.path ?? "document"],
        options: request.options
      },
      settings.budget
    ),
    options = invocation.options as DocxOperationArguments<"images.set">,
    budget = settings.budget.lower(
      Object.fromEntries((options.limit ?? []).map((item) => [item.name, item.value]))
    ),
    scoped = { ...settings, budget };
  const document = await openDocumentLocations(input, scoped),
    selected = resolveDocxSelection(document, invocation),
    archive = document.snapshot();
  assertDocumentEditable(archive, scoped);
  const main = document.list("story", { scope: "body" })[0]!.value.part,
    dialect = dialectForNamespace(
      parseDocumentXml(
        archive.members.find((member) => "/" + member.name === main)!.bytes,
        {},
        budget
      ).root.namespace
    )!,
    ns = documentDialects[dialect],
    staged = new Map<string, Uint8Array>();
  const plans: { before: Location<"image">; framePath: readonly number[]; changed: boolean }[] = [];
  const anchorFields = [
    "x",
    "y",
    "relativeTo",
    "horizontalRelativeFrom",
    "verticalRelativeFrom",
    "horizontalAlignment",
    "verticalAlignment",
    "wrap",
    "wrapText",
    "wrapPolygon",
    "distanceTop",
    "distanceBottom",
    "distanceLeft",
    "distanceRight",
    "allowOverlap",
    "behindText",
    "zOrder"
  ];
  for (const before of selected) {
    if (before.kind !== "image" || before.value.range !== null) unsupported();
    const member = archive.members.find((item) => "/" + item.name === before.value.part)!,
      xml = new DocumentXmlEditor(member.bytes, {}, undefined, budget);
    let node = xml.root;
    const ancestors = [node];
    for (const index of before.value.path) {
      node = node.children[index]!;
      ancestors.push(node);
    }
    const frameIndex = ancestors.findIndex(
      (value) => value.namespace === ns.wp && ["inline", "anchor"].includes(value.localName)
    );
    if (frameIndex < 0) unsupported();
    const frame = ancestors[frameIndex]!,
      p = picture(frame, dialect, budget);
    if (node !== p.blip) unsupported();
    if (
      ancestors.some(
        (value) =>
          value.namespace === ns.w &&
          (["ins", "del", "moveFrom", "moveTo"].includes(value.localName) ||
            value.children.some(
              (child) =>
                child.namespace === ns.w &&
                ["pPr", "tcPr"].includes(child.localName) &&
                child.children.some((property) => property.localName.endsWith("Change"))
            ))
      )
    )
      unsupported();
    assertOutsideRevisionRanges(xml.root, node, budget, xml.compatibility.branches);
    if (
      frame.localName === "inline" &&
      anchorFields.some((key) => (options as Record<string, unknown>)[key] !== undefined)
    )
      unsupported();
    const resizing = options.width !== undefined || options.height !== undefined;
    if (resizing) {
      const x = integer(attr(p.extent, "cx"), 1, 2147483647),
        y = integer(attr(p.extent, "cy"), 1, 2147483647);
      if (
        x !== integer(attr(p.innerExtent, "cx"), 1, 2147483647) ||
        y !== integer(attr(p.innerExtent, "cy"), 1, 2147483647)
      )
        unsupported();
    }
    const existingAlt = attr(p.docPr, "descr") ?? "",
      decorative: XmlElement[] = [];
    const scan = (value: XmlElement) => {
      budget.charge("work", 1);
      if (value.namespace === decorativeNamespace && value.localName === "decorative")
        decorative.push(value);
      value.children.forEach(scan);
    };
    scan(p.docPr);
    if (decorative.length > 1) unsupported();
    const state =
        options.decorative ?? (decorative.length ? boolean(attr(decorative[0]!, "val")) : false),
      alt = options.alt ?? existingAlt;
    if (state && alt.length)
      throw new DocxUsageError("Decorative content conflicts with retained nonempty alt text.");
    plans.push({
      before: before as Location<"image">,
      framePath: before.value.path.slice(0, frameIndex),
      changed: false
    });
  }
  for (const plan of plans) {
    const name = plan.before.value.part.slice(1),
      member = archive.members.find((item) => item.name === name)!;
    const edit = (action: (xml: DocumentXmlEditor, p: Picture) => void) => {
      const before = staged.get(name) ?? member.bytes,
        xml = new DocumentXmlEditor(before, {}, undefined, budget);
      let frame = xml.root;
      for (const index of plan.framePath) frame = frame.children[index]!;
      const p = picture(frame, dialect, budget);
      action(xml, p);
      const after = xml.serialize();
      budget.charge("work", Math.max(before.length, after.length));
      if (before.length !== after.length || before.some((byte, index) => byte !== after[index]))
        plan.changed = true;
      staged.set(name, after);
    };
    for (const [field, native, min, max] of [
      ["zOrder", "relativeHeight", 0, 4294967295],
      ["distanceTop", "distT", 0, 4294967295],
      ["distanceBottom", "distB", 0, 4294967295],
      ["distanceLeft", "distL", 0, 4294967295],
      ["distanceRight", "distR", 0, 4294967295]
    ] as const) {
      const value = options[field];
      if (value === undefined) continue;
      const numeric =
        typeof value === "number" ? rounded(value, min, max) : length(value, min, max);
      edit((xml, p) => put(xml, p.frame, { [native]: String(numeric) }, budget));
    }
    for (const [field, native] of [
      ["allowOverlap", "allowOverlap"],
      ["behindText", "behindDoc"]
    ] as const)
      if (options[field] !== undefined)
        edit((xml, p) => put(xml, p.frame, { [native]: options[field] ? "1" : "0" }, budget));
    for (const horizontal of [true, false]) {
      const offset = horizontal ? options.x : options.y,
        alignment = horizontal ? options.horizontalAlignment : options.verticalAlignment,
        relative =
          options.relativeTo ??
          (horizontal ? options.horizontalRelativeFrom : options.verticalRelativeFrom);
      if (offset === undefined && alignment === undefined && relative === undefined) continue;
      edit((xml, p) => {
        if (attr(p.frame, "simplePos") !== undefined && boolean(attr(p.frame, "simplePos")))
          unsupported();
        const axis = one(p.frame, ns.wp, horizontal ? "positionH" : "positionV")!,
          choice = axis.children;
        if (
          choice.length !== 1 ||
          choice[0]!.namespace !== ns.wp ||
          !["align", "posOffset"].includes(choice[0]!.localName)
        )
          unsupported();
        const frames = horizontal ? horizontalFrames : verticalFrames,
          aligns = horizontal ? horizontalAlign : verticalAlign;
        if (!frames.includes(attr(axis, "relativeFrom") ?? "")) unsupported();
        if (choice[0]!.localName === "align") {
          if (!aligns.includes(choice[0]!.text)) unsupported();
        } else integer(choice[0]!.text, -2147483648, 2147483647);
        if (relative !== undefined) put(xml, axis, { relativeFrom: relative }, budget);
      });
      if (offset !== undefined || alignment !== undefined)
        edit((xml, p) => {
          const axis = one(p.frame, ns.wp, horizontal ? "positionH" : "positionV")!,
            choice = axis.children[0]!,
            markup =
              offset !== undefined
                ? `<wp:posOffset xmlns:wp="${ns.wp}">${length(offset, -2147483648, 2147483647)}</wp:posOffset>`
                : `<wp:align xmlns:wp="${ns.wp}">${alignment}</wp:align>`;
          if (
            (offset !== undefined &&
              choice.localName === "posOffset" &&
              integer(choice.text, -2147483648, 2147483647) ===
                length(offset, -2147483648, 2147483647)) ||
            (alignment !== undefined && choice.localName === "align" && choice.text === alignment)
          )
            return;
          const target = offset === undefined ? "align" : "posOffset";
          if (
            choice.localName === target &&
            choice.content.length === 1 &&
            choice.content[0]!.kind === "text"
          )
            xml.setText(
              choice.content[0]!,
              offset === undefined ? alignment! : String(length(offset, -2147483648, 2147483647))
            );
          else xml.replaceElement(choice, markup);
        });
    }
    const wrapFields = [
      "wrap",
      "wrapText",
      "wrapPolygon",
      "distanceTop",
      "distanceBottom",
      "distanceLeft",
      "distanceRight"
    ];
    if (wrapFields.some((key) => (options as Record<string, unknown>)[key] !== undefined))
      edit((xml, p) => {
        const choices = p.frame.children.filter(
          (node) => node.namespace === ns.wp && Object.values(wraps).includes(node.localName)
        );
        if (choices.length !== 1) unsupported();
        const current = choices[0]!,
          mode =
            options.wrap ??
            (Object.keys(wraps).find(
              (key) => wraps[key as keyof typeof wraps] === current.localName
            ) as keyof typeof wraps),
          resultName = wraps[mode],
          sideMode = ["square", "tight", "through"].includes(mode),
          tight = ["tight", "through"].includes(mode);
        if (
          (options.wrapText !== undefined && !sideMode) ||
          (options.wrapPolygon !== undefined && !tight)
        )
          throw new DocxUsageError("Inapplicable wrap metadata.");
        const text = options.wrapText ?? attr(current, "wrapText");
        if (sideMode && !wrapSides.includes(text ?? "")) unsupported();
        const existing = one(current, ns.wp, "wrapPolygon", true);
        if (existing) polygon(existing, ns.wp, budget);
        if (tight && !options.wrapPolygon && !existing) unsupported();
        const attrs: Record<string, string> = {};
        if (sideMode) attrs.wrapText = text!;
        for (const attribute of current.attributes) {
          if (attribute.namespace === "http://www.w3.org/2000/xmlns/") {
            attrs[attribute.name] = attribute.value;
            continue;
          }
          if (
            attribute.namespace !== "" ||
            !["wrapText", "distT", "distB", "distL", "distR"].includes(attribute.localName)
          )
            unsupported();
          if (attribute.localName.startsWith("dist")) {
            const allowed =
              mode === "square" ||
              (["tight", "through"].includes(mode)
                ? ["distL", "distR"].includes(attribute.localName)
                : mode === "top-bottom" && ["distT", "distB"].includes(attribute.localName));
            if (!allowed) {
              const field = (
                {
                  distT: "distanceTop",
                  distB: "distanceBottom",
                  distL: "distanceLeft",
                  distR: "distanceRight"
                } as const
              )[attribute.localName as "distT" | "distB" | "distL" | "distR"];
              if (
                options[field] === undefined &&
                integer(attribute.value, 0, 4294967295) !==
                  integer(attr(p.frame, attribute.localName), 0, 4294967295)
              )
                unsupported();
              continue;
            }
            attrs[attribute.localName] = attribute.value;
          }
        }
        for (const [field, native] of [
          ["distanceTop", "distT"],
          ["distanceBottom", "distB"],
          ["distanceLeft", "distL"],
          ["distanceRight", "distR"]
        ] as const) {
          if (options[field] !== undefined && attrs[native] !== undefined)
            attrs[native] = String(length(options[field]!, 0, 4294967295));
        }
        const children = current.children.filter((node) => node !== existing);
        if (
          children.some((node) => node.namespace !== ns.wp || node.localName !== "effectExtent") ||
          (children.length && !(mode === "square" || mode === "top-bottom"))
        )
          unsupported();
        let childMarkup = children.map((node) => xml.sourceXml(node)).join("");
        if (tight) {
          if (options.wrapPolygon) {
            const points = [options.wrapPolygon.start, ...options.wrapPolygon.lineTo];
            budget.check("matches", points.length);
            budget.charge("retainedBytes", points.length * 512);
            budget.charge("work", points.length * 128);
            childMarkup = `<wp:wrapPolygon xmlns:wp="${ns.wp}" edited="1"><wp:start x="${points[0]!.x}" y="${points[0]!.y}"/>${points
              .slice(1)
              .map((point) => `<wp:lineTo x="${point.x}" y="${point.y}"/>`)
              .join("")}</wp:wrapPolygon>`;
          } else childMarkup += xml.sourceXml(existing!);
        }
        if (resultName === current.localName && options.wrapPolygon === undefined) {
          put(
            xml,
            current,
            Object.fromEntries(Object.entries(attrs).filter(([key]) => !key.startsWith("xmlns"))),
            budget
          );
          return;
        }
        const values = Object.entries(attrs)
          .map(([key, value]) => ` ${key}="${xmlValue(value)}"`)
          .join("");
        xml.replaceElement(
          current,
          `<wp:${resultName}${attrs["xmlns:wp"] === undefined ? ` xmlns:wp="${ns.wp}"` : ""}${values}>${childMarkup}</wp:${resultName}>`
        );
      });
    const resize = options.width !== undefined || options.height !== undefined;
    if (resize) {
      let x = 0,
        y = 0,
        crop: [number, number, number, number] | undefined;
      edit((xml, p) => {
        const oldX = integer(attr(p.extent, "cx"), 1, 2147483647),
          oldY = integer(attr(p.extent, "cy"), 1, 2147483647),
          width = options.width === undefined ? undefined : length(options.width, 1, 2147483647),
          height = options.height === undefined ? undefined : length(options.height, 1, 2147483647);
        x = width ?? rounded((height! * oldX) / oldY, 1, 2147483647);
        y = height ?? rounded((width! * oldY) / oldX, 1, 2147483647);
        if (options.fit === "contain") {
          const scale = Math.min(x / oldX, y / oldY);
          x = rounded(oldX * scale, 1, 2147483647);
          y = rounded(oldY * scale, 1, 2147483647);
        }
        if (options.fit === "cover") {
          const scale = Math.max(x / oldX, y / oldY),
            h = Math.round((1 - x / (oldX * scale)) * 50000),
            v = Math.round((1 - y / (oldY * scale)) * 50000);
          if (h * 2 >= 100000 || v * 2 >= 100000) unsupported();
          crop = [h, h, v, v];
        } else if (options.fit) crop = [0, 0, 0, 0];
        put(xml, p.extent, { cx: String(x), cy: String(y) }, budget);
      });
      edit((xml, p) => put(xml, p.innerExtent, { cx: String(x), cy: String(y) }, budget));
      if (crop)
        edit((xml, p) => {
          const node = one(p.fill, ns.a, "srcRect", true),
            values = {
              l: String(crop![0]),
              r: String(crop![1]),
              t: String(crop![2]),
              b: String(crop![3])
            };
          if (node) put(xml, node, values, budget);
          else
            xml.insertChildren(
              p.fill,
              `<a:srcRect xmlns:a="${ns.a}" l="${values.l}" r="${values.r}" t="${values.t}" b="${values.b}"/>`,
              p.fill.children[p.fill.children.indexOf(p.blip) + 1]
            );
        });
    }
    const cropKeys = ["cropLeft", "cropRight", "cropTop", "cropBottom"] as const;
    if (cropKeys.some((key) => options[key] !== undefined))
      edit((xml, p) => {
        const node = one(p.fill, ns.a, "srcRect", true),
          names = ["l", "r", "t", "b"],
          merged = names.map((name) =>
            node && attr(node, name) !== undefined ? integer(attr(node, name), 0, 100000) : 0
          ),
          values: Record<string, string> = {};
        for (let index = 0; index < 4; index++) {
          const value = options[cropKeys[index]!];
          if (value !== undefined) {
            merged[index] = value * 100000;
            values[names[index]!] = String(Math.round(merged[index]!));
          }
        }
        if (
          merged[0]! + merged[1]! >= 100000 ||
          merged[2]! + merged[3]! >= 100000 ||
          Math.round(merged[0]!) + Math.round(merged[1]!) >= 100000 ||
          Math.round(merged[2]!) + Math.round(merged[3]!) >= 100000
        )
          throw new DocxUsageError("Merged opposing crops must leave a nonempty source.");
        if (node) put(xml, node, values, budget);
        else {
          const all = names
            .map((name, index) => `${name}="${Math.round(merged[index]!)}"`)
            .join(" ");
          xml.insertChildren(
            p.fill,
            `<a:srcRect xmlns:a="${ns.a}" ${all}/>`,
            p.fill.children[p.fill.children.indexOf(p.blip) + 1]
          );
        }
      });
    const transformValues: Record<string, string> = {};
    if (options.rotation !== undefined)
      transformValues.rot = String(rounded(options.rotation * 60000, -21600000, 21600000));
    if (options.flipHorizontal !== undefined)
      transformValues.flipH = options.flipHorizontal ? "1" : "0";
    if (options.flipVertical !== undefined)
      transformValues.flipV = options.flipVertical ? "1" : "0";
    if (Object.keys(transformValues).length)
      edit((xml, p) => put(xml, p.transform, transformValues, budget));
    if (options.lockAspect !== undefined) {
      edit((xml, p) => {
        if (!p.frameProperties) {
          xml.insertChildren(
            p.frame,
            `<wp:cNvGraphicFramePr xmlns:wp="${ns.wp}"><a:graphicFrameLocks xmlns:a="${ns.a}" noChangeAspect="${options.lockAspect ? "1" : "0"}"/></wp:cNvGraphicFramePr>`,
            one(p.frame, ns.a, "graphic")
          );
          return;
        }
        const lock = one(p.frameProperties, ns.a, "graphicFrameLocks", true);
        if (lock) put(xml, lock, { noChangeAspect: options.lockAspect ? "1" : "0" }, budget);
        else
          xml.insertChildren(
            p.frameProperties,
            `<a:graphicFrameLocks xmlns:a="${ns.a}" noChangeAspect="${options.lockAspect ? "1" : "0"}"/>`
          );
      });
      edit((xml, p) => {
        const lock = one(p.pictureProperties, ns.a, "picLocks", true);
        if (lock) put(xml, lock, { noChangeAspect: options.lockAspect ? "1" : "0" }, budget);
        else
          xml.insertChildren(
            p.pictureProperties,
            `<a:picLocks xmlns:a="${ns.a}" noChangeAspect="${options.lockAspect ? "1" : "0"}"/>`,
            p.pictureProperties.children[0]
          );
      });
    }
    if (options.alt !== undefined)
      edit((xml, p) => put(xml, p.docPr, { descr: options.alt! }, budget));
    if (options.decorative !== undefined)
      edit((xml, p) => {
        const nodes: XmlElement[] = [];
        const visit = (node: XmlElement) => {
          budget.charge("work", 1);
          if (node.namespace === decorativeNamespace && node.localName === "decorative")
            nodes.push(node);
          node.children.forEach(visit);
        };
        visit(p.docPr);
        if (nodes.length > 1) unsupported();
        if (nodes[0]) put(xml, nodes[0], { val: options.decorative ? "1" : "0" }, budget);
        else if (options.decorative) {
          const list = one(p.docPr, ns.a, "extLst", true),
            markup = `<a:ext xmlns:a="${ns.a}" uri="{C183D7F6-B498-43B3-948B-1728B52AA6E4}"><d:decorative xmlns:d="${decorativeNamespace}" val="1"/></a:ext>`;
          if (list) xml.insertChildren(list, markup);
          else xml.insertChildren(p.docPr, `<a:extLst xmlns:a="${ns.a}">${markup}</a:extLst>`);
        }
      });
  }
  budget.charge(
    "retainedBytes",
    archive.comment.length +
      archive.members.reduce(
        (sum, member) => sum + (staged.get(member.name) ?? member.bytes).length + 128,
        0
      )
  );
  budget.charge(
    "work",
    archive.members.reduce((sum, member) => sum + member.bytes.length, 0)
  );
  const candidate: DocumentArchive = {
    comment: new Uint8Array(archive.comment),
    members: archive.members.map((member) => ({
      ...member,
      bytes: new Uint8Array(staged.get(member.name) ?? member.bytes),
      modified: new Date(member.modified)
    }))
  };
  const index = new LocationIndex(candidate, settings.limits, main.slice(1), dialect, budget),
    changes: ImageLayoutData["changes"][number][] = [];
  for (const plan of plans.filter((plan) => plan.changed)) {
    const entries = index.entries.filter(
      (entry) =>
        entry.kind === "image" &&
        entry.part === plan.before.value.part &&
        plan.framePath.every((part, index) => entry.path[index] === part)
    );
    if (entries.length !== 1) unsupported();
    const entry = entries[0]!,
      value = {
        ...plan.before.value,
        path: entry.path,
        generation: plan.before.value.generation + 1
      },
      after: Location<"image"> = {
        kind: "image",
        value,
        token: encodeLocation(value),
        positions: entry.positions
      };
    changes.push({ kind: "set", before: plan.before, after });
  }
  const planned: ImageLayoutData = {
    changed: changes.length > 0,
    changes,
    dryRun: options.dryRun ?? false,
    output: options.dryRun
      ? null
      : {
          path: options.inPlace
            ? (request.input?.path ?? null)
            : options.output === "-"
              ? null
              : (options.output ?? null),
          bytes: settings.limits.maxArchiveBytes,
          sha256: "0".repeat(64)
        }
  };
  if (options.json) {
    const size =
      measurePackageResourceSerialization(
        {
          version: 1,
          operation: "images.set",
          ok: true,
          data: planned,
          affected: changes.length,
          locations: changes.map((change) => change.after),
          warnings: [],
          errors: []
        },
        budget
      ) + 1;
    budget.check("serializedOutput", size);
    budget.charge("retainedBytes", size * 8);
    budget.charge("work", size * 8);
  }
  if (context.admitPublication) {
    const result = context.admitPublication(planned);
    if (result !== undefined) {
      if (result && typeof (result as Promise<unknown>).then === "function")
        void Promise.resolve(result).catch(() => {});
      throw new InputTypeError("Image layout admission must be synchronous.");
    }
  }
  const result = await publishDocumentArchive(
    candidate,
    {
      ...(request.input ? { input: request.input } : {}),
      ...(options.output === undefined ? {} : { output: options.output }),
      ...(options.inPlace === undefined ? {} : { inPlace: options.inPlace }),
      ...(options.force === undefined ? {} : { force: options.force }),
      ...(options.dryRun === undefined ? {} : { dryRun: options.dryRun }),
      ...(options.json === undefined ? {} : { json: options.json })
    },
    { ...context, budget },
    undefined,
    changes.length === 0 ? input : undefined
  );
  return {
    ...planned,
    output: result.published.length
      ? {
          path: result.published[0]!.path,
          bytes: result.published[0]!.bytes,
          sha256: result.archiveSha256!
        }
      : null
  };
}

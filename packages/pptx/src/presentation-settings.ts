import { scaleDrawingCanvas } from "./settings-scaling.js";
import { readBinary } from "./bytes.js";
import type { BinaryInput } from "./contracts.js";
import { OfficeError } from "./errors.js";
import { parseContentTypes } from "./content-types.js";
import { readPackage } from "./package-reader.js";
import { writePackageArchive } from "./package-writer.js";
import { relativePartReference } from "./package-uri.js";
import { readRelationshipGraph } from "./relationships.js";
import type { SelectionContext } from "./selectors.js";
import { parseXmlPart, type XmlElement, type XmlMerge, type XmlPart } from "./xml.js";
import { validatePresentation } from "./validation.js";

export interface PresentationSettings {
  readonly printProperties: { readonly part: string; readonly xml: string } | null;
  readonly viewProperties: { readonly part: string; readonly xml: string } | null;
  readonly width: number | null;
  readonly height: number | null;
  readonly orientation: "portrait" | "landscape" | null;
  readonly notesWidth: number | null;
  readonly notesHeight: number | null;
  readonly notesOrientation: "portrait" | "landscape" | null;
  readonly slideNumberStart: number;
  readonly loop: boolean;
  readonly showType: "speaker" | "window" | "kiosk";
}
export interface MutatePresentationSettingsOptions {
  readonly width?: number;
  readonly height?: number;
  readonly orientation?: "portrait" | "landscape";
  readonly notesWidth?: number;
  readonly notesHeight?: number;
  readonly notesOrientation?: "portrait" | "landscape";
  readonly slideNumberStart?: number;
  readonly loop?: boolean;
  readonly showType?: "speaker" | "window" | "kiosk";
  readonly scaleContent?: boolean;
}
const dialects = [
  {
    p: "http://schemas.openxmlformats.org/presentationml/2006/main",
    r: "http://schemas.openxmlformats.org/officeDocument/2006/relationships"
  },
  {
    p: "http://purl.oclc.org/ooxml/presentationml/main",
    r: "http://purl.oclc.org/ooxml/officeDocument/relationships"
  }
];
function escapeAttribute(value: string): string {
  return [...value].map((c) => ({ "&": "&amp;", "<": "&lt;", '"': "&quot;" })[c] ?? c).join("");
}
function invalid(message: string): never {
  throw new OfficeError("invalid-value", message, "usage");
}
function unsupported(message: string): never {
  throw new OfficeError("unsupported-edit", message, "validate-intent");
}
function attr(node: XmlElement, localName: string) {
  return node.attributes.find((a) => a.name.namespace === "" && a.name.localName === localName)
    ?.value;
}
function child(node: XmlElement, name: string) {
  const found = node.children.filter(
    (c) => c.name.namespace === node.name.namespace && c.name.localName === name
  );
  if (found.length > 1)
    throw new OfficeError("invalid-opc", "Duplicate presentation setting.", "index");
  return found[0];
}
function numeric(value: string | undefined): number | null {
  if (value === undefined) return null;
  const text = value.trim();
  if (
    !text ||
    [...text].some((c, i) => !(c >= "0" && c <= "9") && !(i === 0 && (c === "-" || c === "+"))) ||
    !Number.isSafeInteger(Number(text))
  )
    throw new OfficeError("invalid-opc", "Invalid numeric presentation setting.", "index");
  return Number(text);
}
async function load(input: BinaryInput, context: SelectionContext) {
  if (!context?.xmlLimits || !context.relationshipLimits)
    invalid("Explicit XML and relationship limits are required.");
  const source = await readBinary(input, context);
  const reader = await readPackage(source, context);
  const limits = {
    ...context.xmlLimits,
    ...context.relationshipLimits,
    maxBytes: Math.min(context.xmlLimits.maxBytes, context.relationshipLimits.maxBytes),
    maxEntries: context.archiveLimits.maxMembers
  };
  if (!validatePresentation(reader, limits).valid)
    throw new OfficeError(
      "invalid-opc",
      "Settings require a valid presentation graph.",
      "validate-intent"
    );
  const types = parseContentTypes(reader.get("/[Content_Types].xml"), limits);
  const graph = readRelationshipGraph(reader, context.relationshipLimits);
  const main = graph
    .outgoing("/")
    .find((e) => dialects.some((d) => e.type === `${d.r}/officeDocument`))!.targetPart!;
  const document = parseXmlPart(reader.get(main), context.xmlLimits);
  const dialect = dialects.find((d) => d.p === document.root.name.namespace)!;
  const properties = graph.outgoing(main).filter((e) => e.type === `${dialect.r}/presProps`);
  if (properties.length > 1 || properties.some((e) => e.external))
    throw new OfficeError("invalid-opc", "Ambiguous presentation properties.", "index");
  const propertyPart = properties[0]?.targetPart ?? null;
  if (
    propertyPart &&
    types.get(propertyPart) !==
      "application/vnd.openxmlformats-officedocument.presentationml.presProps+xml"
  )
    throw new OfficeError("invalid-opc", "Invalid presentation properties content type.", "index");
  const propertyDocument = propertyPart
    ? parseXmlPart(reader.get(propertyPart), context.xmlLimits)
    : null;
  if (
    propertyDocument &&
    (propertyDocument.root.name.namespace !== dialect.p ||
      propertyDocument.root.name.localName !== "presentationPr")
  )
    throw new OfficeError("invalid-opc", "Invalid presentation properties root.", "index");
  return { source, reader, limits, graph, main, document, dialect, propertyPart, propertyDocument };
}
function settings(
  document: XmlElement,
  properties: XmlElement | undefined
): Omit<PresentationSettings, "printProperties" | "viewProperties"> {
  const slide = child(document, "sldSz"),
    notes = child(document, "notesSz");
  const width = slide ? numeric(attr(slide, "cx")) : null,
    height = slide ? numeric(attr(slide, "cy")) : null;
  const notesWidth = notes ? numeric(attr(notes, "cx")) : null,
    notesHeight = notes ? numeric(attr(notes, "cy")) : null;
  const show = properties && child(properties, "showPr");
  const loop = show && attr(show, "loop")?.trim();
  if (loop !== undefined && !["0", "1", "true", "false"].includes(loop.trim()))
    throw new OfficeError("invalid-opc", "Invalid slideshow loop setting.", "index");
  const modes = show ? ["present", "browse", "kiosk"].filter((n) => child(show, n)) : [];
  if (modes.length > 1) throw new OfficeError("invalid-opc", "Ambiguous slideshow mode.", "index");
  const slideNumberStart = numeric(attr(document, "firstSlideNum")) ?? 1;
  if (slideNumberStart < -2147483648 || slideNumberStart > 2147483647)
    throw new OfficeError("invalid-opc", "Invalid slide numbering value.", "index");
  return {
    width,
    height,
    orientation:
      width === null || height === null ? null : width >= height ? "landscape" : "portrait",
    notesWidth,
    notesHeight,
    notesOrientation:
      notesWidth === null || notesHeight === null
        ? null
        : notesWidth >= notesHeight
          ? "landscape"
          : "portrait",
    slideNumberStart,
    loop: loop === "1" || loop === "true",
    showType: modes[0] === "browse" ? "window" : modes[0] === "kiosk" ? "kiosk" : "speaker"
  };
}
export async function readPresentationSettings(
  input: BinaryInput,
  context: SelectionContext
): Promise<PresentationSettings> {
  const loaded = await load(input, context);
  const { graph, main, dialect, reader, limits, propertyDocument, propertyPart } = loaded;
  const views = graph.outgoing(main).filter((edge) => edge.type === `${dialect.r}/viewProps`);
  if (views.length > 1 || views.some((edge) => edge.external))
    throw new OfficeError("invalid-opc", "Ambiguous view properties.", "index");
  const viewPart = views[0]?.targetPart;
  let viewProperties: PresentationSettings["viewProperties"] = null;
  if (viewPart) {
    const types = parseContentTypes(reader.get("/[Content_Types].xml"), limits);
    if (
      types.get(viewPart) !==
      "application/vnd.openxmlformats-officedocument.presentationml.viewProps+xml"
    )
      throw new OfficeError("invalid-opc", "Invalid view properties content type.", "index");
    const view = parseXmlPart(reader.get(viewPart), context.xmlLimits);
    if (view.root.name.namespace !== dialect.p || view.root.name.localName !== "viewPr")
      throw new OfficeError("invalid-opc", "Invalid view properties root.", "index");
    viewProperties = { part: viewPart, xml: view.markup(view.root, true) };
  }
  const print = propertyDocument && child(propertyDocument.root, "prnPr");
  return {
    ...settings(loaded.document.root, propertyDocument?.root),
    printProperties: print
      ? { part: propertyPart!, xml: propertyDocument!.markup(print, true) }
      : null,
    viewProperties
  };
}
export function applyPresentationCanvasSettings(
  document: XmlPart,
  options: Pick<
    MutatePresentationSettingsOptions,
    | "width"
    | "height"
    | "orientation"
    | "notesWidth"
    | "notesHeight"
    | "notesOrientation"
    | "slideNumberStart"
  >,
  propertyDocument?: XmlPart | null
): XmlPart {
  const pending = [document.root, ...(propertyDocument ? [propertyDocument.root] : [])];
  while (pending.length) {
    const node = pending.pop()!;
    if (
      node.name.namespace === "http://schemas.openxmlformats.org/markup-compatibility/2006" ||
      (node.name.namespace === document.root.name.namespace &&
        node.name.localName === "modifyVerifier")
    )
      unsupported("Protected or conditional presentation settings cannot be changed.");
    pending.push(...node.children);
  }
  const previous = settings(document.root, propertyDocument?.root);
  const pn = (localName: string) => ({ namespace: document.root.name.namespace, localName });
  const dimensions: { name: ReturnType<typeof pn>; merge: XmlMerge }[] = [];
  for (const [name, w, h, o, pw, ph] of [
    ["sldSz", options.width, options.height, options.orientation, previous.width, previous.height],
    [
      "notesSz",
      options.notesWidth,
      options.notesHeight,
      options.notesOrientation,
      previous.notesWidth,
      previous.notesHeight
    ]
  ] as const) {
    if (w === undefined && h === undefined && o === undefined) continue;
    let width = w ?? pw,
      height = h ?? ph;
    if (width === null || height === null)
      invalid("Both dimensions are required when canvas dimensions are absent.");
    if (o === "portrait" && width === height)
      invalid("Square dimensions have landscape orientation.");
    if (o && (o === "landscape" ? width < height : width > height)) {
      if (w !== undefined || h !== undefined)
        invalid("Explicit dimensions contradict orientation.");
      [width, height] = [height, width];
    }
    const slideSize = name === "sldSz";
    if (
      [width, height].some(
        (value) =>
          !Number.isSafeInteger(value) ||
          value < (slideSize ? 914400 : 0) ||
          value > (slideSize ? 51206400 : 27273042316900)
      )
    )
      invalid("Resulting canvas dimensions are outside supported edit bounds.");
    dimensions.push({
      name: pn(name),
      merge: {
        attributes: [
          { namespace: "", localName: "cx", value: String(width) },
          { namespace: "", localName: "cy", value: String(height) }
        ]
      }
    });
  }
  if (dimensions.length || options.slideNumberStart !== undefined)
    document = document.merge(document.root, {
      attributes:
        options.slideNumberStart === undefined
          ? []
          : [
              { namespace: "", localName: "firstSlideNum", value: String(options.slideNumberStart) }
            ],
      children: {
        sequence: [
          "sldMasterIdLst",
          "notesMasterIdLst",
          "handoutMasterIdLst",
          "sldIdLst",
          "sldSz",
          "notesSz",
          "smartTags",
          "embeddedFontLst",
          "custShowLst",
          "photoAlbum",
          "custDataLst",
          "kinsoku",
          "defaultTextStyle",
          "modifyVerifier",
          "extLst"
        ].map(pn),
        upsert: dimensions
      }
    });
  return document;
}

export async function mutatePresentationSettings(
  input: BinaryInput,
  options: MutatePresentationSettingsOptions,
  context: SelectionContext
): Promise<Uint8Array> {
  const keys = [
    "width",
    "height",
    "orientation",
    "notesWidth",
    "notesHeight",
    "notesOrientation",
    "slideNumberStart",
    "loop",
    "showType",
    "scaleContent"
  ];
  if (
    !options ||
    typeof options !== "object" ||
    ![Object.prototype, null].includes(Object.getPrototypeOf(options)) ||
    Object.keys(options).some((k) => !keys.includes(k))
  )
    invalid("Invalid presentation settings object.");
  if (
    !Object.entries(options).some(([key, value]) => key !== "scaleContent" && value !== undefined)
  )
    invalid("At least one setting is required.");
  for (const key of ["orientation", "notesOrientation"] as const)
    if (options[key] !== undefined && !["portrait", "landscape"].includes(options[key]))
      invalid("Invalid orientation.");
  for (const key of ["width", "height", "notesWidth", "notesHeight"] as const) {
    const value = options[key];
    const slide = key === "width" || key === "height";
    if (
      value !== undefined &&
      (!Number.isSafeInteger(value) ||
        value < (slide ? 914400 : 0) ||
        value > (slide ? 51206400 : 27273042316900))
    )
      invalid("Invalid EMU dimensions.");
  }
  if (
    options.slideNumberStart !== undefined &&
    (!Number.isSafeInteger(options.slideNumberStart) ||
      options.slideNumberStart < -2147483648 ||
      options.slideNumberStart > 2147483647)
  )
    invalid("Slide numbering requires a signed 32-bit integer.");
  for (const value of [options.loop, options.scaleContent])
    if (value !== undefined && typeof value !== "boolean") invalid("Expected a boolean setting.");
  if (options.showType !== undefined && !["speaker", "window", "kiosk"].includes(options.showType))
    invalid("Invalid slideshow type.");
  const loaded = await load(input, context);
  const { reader, graph, main, dialect, limits, source } = loaded;
  const pn = (localName: string) => ({ namespace: dialect.p, localName });
  const types = parseContentTypes(reader.get("/[Content_Types].xml"), limits);
  for (const name of reader.names) {
    if (name === "/[Content_Types].xml") continue;
    const type = types.get(name).toLowerCase();
    if (
      type.includes("digital-signature") ||
      type.includes("macroenabled") ||
      type.includes("vbaproject")
    )
      unsupported("Signed and macro-enabled packages cannot be changed.");
  }
  for (const owner of ["/", ...graph.parts])
    if (
      graph
        .outgoing(owner)
        .some((e) => e.type.includes("/digital-signature/") || e.type.endsWith("/vbaProject"))
    )
      unsupported("Signed and macro-enabled packages cannot be changed.");
  const previous = settings(loaded.document.root, loaded.propertyDocument?.root);
  const document = applyPresentationCanvasSettings(
    loaded.document,
    options,
    loaded.propertyDocument
  );
  const changes = new Map<string, Uint8Array>([[main, document.bytes()]]);
  if (options.scaleContent) {
    if (
      options.width === undefined &&
      options.height === undefined &&
      options.orientation === undefined
    )
      invalid("Content scaling requires a slide canvas change.");
    const next = settings(document.root, loaded.propertyDocument?.root);
    if (!previous.width || !previous.height || !next.width || !next.height)
      unsupported("Content scaling requires complete nonzero slide dimensions.");
    const sx = next.width / previous.width,
      sy = next.height / previous.height;
    for (const name of reader.names) {
      if (name === "/[Content_Types].xml") continue;
      const type = types.get(name);
      if (
        ["slide", "slideLayout", "slideMaster"].some(
          (kind) =>
            type === `application/vnd.openxmlformats-officedocument.presentationml.${kind}+xml`
        )
      ) {
        const drawing = parseXmlPart(reader.get(name), context.xmlLimits);
        changes.set(name, scaleDrawingCanvas(drawing, sx, sy).bytes());
      }
    }
  }

  if (options.loop !== undefined || options.showType !== undefined) {
    let propertyPart = loaded.propertyPart;
    let properties = loaded.propertyDocument;
    if (!propertyPart) {
      const folder = main.slice(0, main.lastIndexOf("/"));
      propertyPart = `${folder}/presProps.xml`;
      let suffix = 1;
      while (reader.names.some((n) => n.toLowerCase() === propertyPart!.toLowerCase()))
        propertyPart = `${folder}/presProps${suffix++}.xml`;
      properties = parseXmlPart(
        new TextEncoder().encode(`<p:presentationPr xmlns:p="${dialect.p}"/>`),
        context.xmlLimits
      );
      const relationshipPart = `${folder}/_rels/${main.slice(main.lastIndexOf("/") + 1)}.rels`;
      let rels = parseXmlPart(
        reader.names.includes(relationshipPart)
          ? reader.get(relationshipPart)
          : new TextEncoder().encode(
              '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"/>'
            ),
        context.xmlLimits
      );
      const ids = new Set(graph.outgoing(main).map((e) => e.id));
      let id = 1;
      while (ids.has(`rId${id}`)) id++;
      rels = rels.spliceChildren(rels.root, rels.root.children.length, 0, [
        `<Relationship xmlns="http://schemas.openxmlformats.org/package/2006/relationships" Id="rId${id}" Type="${dialect.r}/presProps" Target="${escapeAttribute(relativePartReference(propertyPart, folder || "/"))}"/>`
      ]);
      changes.set(relationshipPart, rels.bytes());
      let content = parseXmlPart(reader.get("/[Content_Types].xml"), context.xmlLimits);
      content = content.spliceChildren(content.root, content.root.children.length, 0, [
        `<Override xmlns="http://schemas.openxmlformats.org/package/2006/content-types" PartName="${escapeAttribute(propertyPart)}" ContentType="application/vnd.openxmlformats-officedocument.presentationml.presProps+xml"/>`
      ]);
      changes.set("/[Content_Types].xml", content.bytes());
    }
    const mode =
      options.showType &&
      { speaker: "present", window: "browse", kiosk: "kiosk" }[options.showType];
    properties = properties!.merge(properties!.root, {
      children: {
        sequence: ["htmlPubPr", "webPr", "prnPr", "showPr", "clrMru", "extLst"].map(pn),
        upsert: [
          {
            name: pn("showPr"),
            merge: {
              attributes:
                options.loop === undefined
                  ? []
                  : [{ namespace: "", localName: "loop", value: options.loop ? "1" : "0" }],
              ...(mode
                ? {
                    children: {
                      sequence: [
                        "present",
                        "browse",
                        "kiosk",
                        "sldAll",
                        "sldRg",
                        "custShow",
                        "penClr",
                        "extLst"
                      ].map(pn),
                      remove: ["present", "browse", "kiosk"].filter((n) => n !== mode).map(pn),
                      upsert: [{ name: pn(mode), merge: {} }]
                    }
                  }
                : {})
            }
          }
        ]
      }
    });
    changes.set(propertyPart, properties.bytes());
  }
  if (
    [...changes].every(
      ([name, bytes]) =>
        reader.names.includes(name) &&
        (() => {
          const original = reader.get(name);
          return (
            bytes.length === original.length &&
            bytes.every((value, index) => value === original[index])
          );
        })()
    )
  )
    return source;
  const output = await writePackageArchive(
    [...new Set([...reader.names, ...changes.keys()])].map((name) => ({
      name: name.slice(1),
      bytes: changes.get(name) ?? reader.get(name)
    })),
    context,
    { compression: "auto", source }
  );
  if (!validatePresentation(await readPackage(output, context), limits).valid)
    throw new OfficeError(
      "invalid-opc",
      "Changed settings fail graph validation.",
      "validate-result"
    );
  return output;
}

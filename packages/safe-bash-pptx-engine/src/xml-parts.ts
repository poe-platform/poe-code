import { validateXmlViewReplacement } from "./xml-view-validation.js";
import { SaxesParser } from "saxes";
import { readBinary } from "./bytes.js";
import { parseContentTypes } from "./content-types.js";
import type { BinaryInput } from "./contracts.js";
import { OfficeError } from "./errors.js";
import { readPackage, type PackageContext, type PackageReader } from "./package-reader.js";
import { partName } from "./package-uri.js";
import { writePackageArchive } from "./package-writer.js";
import { readRelationshipGraph } from "./relationships.js";
import { validatePresentation, type ValidationLimits } from "./validation.js";
import { parseXmlPart, type XmlPart } from "./xml.js";

export interface XmlPartContext extends PackageContext {
  readonly validationLimits: ValidationLimits;
}
export interface XmlPartData {
  readonly part: string;
  readonly bytes: Uint8Array;
  readonly xml: string;
  readonly format: "original" | "pretty";
}
const namespaces = [
  "http://schemas.openxmlformats.org/presentationml/2006/main",
  "http://purl.oclc.org/ooxml/presentationml/main"
];
const relationshipNamespaces = [
  "http://schemas.openxmlformats.org/officeDocument/2006/relationships",
  "http://purl.oclc.org/ooxml/officeDocument/relationships"
];
const sequences: Readonly<Record<string, readonly string[]>> = {
  presentation: [
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
  ],
  sld: ["cSld", "clrMapOvr", "transition", "timing", "extLst"],
  cSld: ["bg", "spTree", "custDataLst", "controls", "extLst"],
  nvGrpSpPr: ["cNvPr", "cNvGrpSpPr", "nvPr"],
  sp: ["nvSpPr", "spPr", "style", "txBody", "extLst"],
  pic: ["nvPicPr", "blipFill", "spPr", "style", "extLst"],
  graphicFrame: ["nvGraphicFramePr", "xfrm", "graphic", "extLst"]
};
function unsupported(message: string): never {
  throw new OfficeError("unsupported-edit", message, "validate-intent");
}
function select(reader: PackageReader, requested: string, context: XmlPartContext) {
  const part = partName(requested, false);
  if (part !== requested || !reader.names.includes(part))
    throw new OfficeError(
      "missing-selection",
      "An exact existing package part is required.",
      "select"
    );
  const contentType =
    part === "/[Content_Types].xml"
      ? "application/xml"
      : parseContentTypes(reader.get("/[Content_Types].xml"), context.validationLimits)
          .get(part)
          .split(";", 1)[0]!
          .trim()
          .toLowerCase();
  if (
    contentType !== "application/xml" &&
    contentType !== "text/xml" &&
    !contentType.endsWith("+xml")
  )
    throw new OfficeError("unsupported-profile", "The selected part is not XML.", "select");
  const bytes = reader.get(part);
  return { part, bytes, contentType, document: parseXmlPart(bytes, context.validationLimits) };
}
function decode(bytes: Uint8Array): string {
  const little = (bytes[0] === 255 && bytes[1] === 254) || (bytes[0] === 60 && bytes[1] === 0);
  const big = (bytes[0] === 254 && bytes[1] === 255) || (bytes[0] === 0 && bytes[1] === 60);
  return new TextDecoder(little ? "utf-16le" : big ? "utf-16be" : "utf-8", { fatal: true }).decode(
    bytes
  );
}
function namespaceDeclarations(document: XmlPart): string {
  const entries: string[] = [];
  const parser = new SaxesParser({ xmlns: true });
  parser.on("opentag", (tag) => entries.push(JSON.stringify(Object.entries(tag.ns).sort())));
  parser.write(decode(document.bytes())).close();
  return JSON.stringify(entries);
}
function pretty(document: XmlPart, maximum: number): string {
  const source = document.markup(document.root);
  interface Span {
    start: number;
    openEnd: number;
    closeStart: number;
    end: number;
    mixed: boolean;
    children: Span[];
  }
  const stack: Span[] = [];
  let root: Span | undefined;
  let start = 0;
  const parser = new SaxesParser({ xmlns: true });
  parser.on("opentagstart", () => {
    start = source.lastIndexOf("<", parser.position - 1);
  });
  parser.on("opentag", () => {
    const node: Span = {
      start,
      openEnd: parser.position,
      closeStart: parser.position,
      end: parser.position,
      mixed: false,
      children: []
    };
    if (stack.length) stack.at(-1)!.children.push(node);
    else root = node;
    stack.push(node);
  });
  parser.on("text", (text) => {
    if (text.trim() && stack.length) stack.at(-1)!.mixed = true;
  });
  for (const event of ["comment", "cdata", "processinginstruction"] as const)
    parser.on(event, () => {
      if (stack.length) stack.at(-1)!.mixed = true;
    });
  parser.on("closetag", () => {
    const node = stack.pop()!;
    node.end = parser.position;
    node.closeStart = source.lastIndexOf("<", parser.position - 1);
  });
  parser.write(source).close();
  const render = (node: Span, depth: number): string => {
    if (node.mixed || !node.children.length) return source.slice(node.start, node.end);
    const result = [
      source.slice(node.start, node.openEnd),
      ...node.children.map((child) => `\n${"  ".repeat(depth + 1)}${render(child, depth + 1)}`),
      `\n${"  ".repeat(depth)}${source.slice(node.closeStart, node.end)}`
    ].join("");
    if (new TextEncoder().encode(result).length > maximum)
      throw new OfficeError("resource-limit", "Pretty XML byte limit exceeded.", "serialize");
    return result;
  };
  return render(root!, 0);
}
export async function getXmlPart(
  input: BinaryInput,
  part: string,
  context: XmlPartContext,
  options: { readonly pretty?: boolean } = {}
): Promise<XmlPartData> {
  if (
    Object.keys(options).some((key) => key !== "pretty") ||
    (options.pretty !== undefined && typeof options.pretty !== "boolean")
  )
    throw new OfficeError("invalid-value", "Invalid XML display options.", "usage");
  const selected = select(await readPackage(input, context), part, context);
  return Object.freeze({
    part: selected.part,
    bytes: selected.bytes,
    xml: options.pretty
      ? pretty(selected.document, context.validationLimits.maxBytes)
      : decode(selected.bytes),
    format: options.pretty ? "pretty" : "original"
  });
}

export async function replaceXmlPart(
  input: BinaryInput,
  part: string,
  replacement: BinaryInput,
  context: XmlPartContext
): Promise<Uint8Array> {
  const source = await readBinary(input, context);
  const reader = await readPackage(source, context);
  const bytes = await readBinary(replacement, context, {
    maxBytes: context.validationLimits.maxBytes
  });
  const candidate = validateXmlViewReplacement(
    reader,
    part,
    bytes,
    context,
    validateXmlPartReplacement
  );
  const original = reader.get(part);
  if (bytes.length === original.length && bytes.every((byte, index) => byte === original[index]))
    return source;
  return writePackageArchive(
    reader.names.map((name) => ({ name: name.slice(1), bytes: candidate.get(name) })),
    context,
    { compression: "auto", source }
  );
}

export function validateXmlPartReplacement(
  reader: PackageReader,
  part: string,
  bytes: Uint8Array,
  context: XmlPartContext
): PackageReader {
  const selected = select(reader, part, context);
  const graph = readRelationshipGraph(reader, context.validationLimits);
  const contentTypes = parseContentTypes(
    reader.get("/[Content_Types].xml"),
    context.validationLimits
  );
  let nodes = 0;
  let total = 0;
  for (const name of reader.names) {
    context.signal?.throwIfAborted();
    if (name === "/[Content_Types].xml") continue;
    const type = contentTypes.get(name).split(";", 1)[0]!.trim().toLowerCase();
    if (
      type.includes("digital-signature") ||
      type.includes("macroenabled") ||
      type.includes("vbaproject") ||
      name.toLowerCase().startsWith("/_xmlsignatures/")
    )
      unsupported("Signed and macro-enabled packages cannot be changed.");
    if (type.endsWith("+xml") || type === "application/xml" || type === "text/xml") {
      const data = reader.get(name);
      total += data.length;
      if (total > context.validationLimits.maxBytes || nodes >= context.validationLimits.maxNodes)
        throw new OfficeError("resource-limit", "Package XML inspection limit exceeded.", "index");
      const document = parseXmlPart(data, {
        ...context.validationLimits,
        maxNodes: context.validationLimits.maxNodes - nodes
      });
      nodes += document.nodeCount;
      const pending = [document.root];
      while (pending.length) {
        const node = pending.pop()!;
        for (const attribute of node.attributes)
          if (
            relationshipNamespaces.includes(attribute.name.namespace) &&
            !graph.outgoing(name).some((edge) => edge.id === attribute.value)
          )
            throw new OfficeError(
              "invalid-opc",
              "XML references an absent relationship.",
              "validate-intent"
            );
        if (namespaces.includes(node.name.namespace) && node.name.localName === "modifyVerifier")
          unsupported("Protected presentations cannot be changed.");
        pending.push(...node.children);
      }
    }
  }
  for (const owner of ["/", ...graph.parts])
    if (
      graph
        .outgoing(owner)
        .some(
          (edge) => edge.type.includes("/digital-signature/") || edge.type.endsWith("/vbaProject")
        )
    )
      unsupported("Signed and macro-enabled packages cannot be changed.");
  const root = selected.document.root;
  const expected = new Map([
    [
      "application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml",
      "presentation"
    ],
    [
      "application/vnd.openxmlformats-officedocument.presentationml.template.main+xml",
      "presentation"
    ],
    [
      "application/vnd.openxmlformats-officedocument.presentationml.slideshow.main+xml",
      "presentation"
    ],
    ["application/vnd.openxmlformats-officedocument.presentationml.slide+xml", "sld"]
  ]).get(selected.contentType);
  if (!expected)
    unsupported(
      "Replacement supports presentation and slide XML with unchanged element structure."
    );
  const changed = parseXmlPart(bytes, context.validationLimits);
  for (const size of changed.root.children.filter(
    (node) => node.name.namespace === changed.root.name.namespace && node.name.localName === "sldSz"
  )) {
    for (const axis of ["cx", "cy"]) {
      const value = size.attributes.find(
        (attribute) => !attribute.name.namespace && attribute.name.localName === axis
      )?.value;
      const number = Number(value);
      if (
        !value ||
        [...value].some((character) => character < "0" || character > "9") ||
        !Number.isSafeInteger(number) ||
        number < 914400 ||
        number > 51206400
      )
        throw new OfficeError(
          "invalid-opc",
          "Invalid authored slide dimensions.",
          "validate-result"
        );
    }
  }
  if (changed.root.name.localName !== expected || root.name.localName !== expected)
    throw new OfficeError(
      "invalid-opc",
      "XML root does not match the content type.",
      "validate-result"
    );
  if (
    !namespaces.includes(root.name.namespace) ||
    root.name.namespace !== changed.root.name.namespace
  )
    unsupported("XML replacement must preserve the presentation dialect.");
  if (namespaceDeclarations(selected.document) !== namespaceDeclarations(changed))
    unsupported("XML replacement must preserve namespace declarations.");
  const pending = [{ before: root, after: changed.root }];
  const understood = [
    root.name.namespace,
    namespaces.indexOf(root.name.namespace) === 0
      ? "http://schemas.openxmlformats.org/drawingml/2006/main"
      : "http://purl.oclc.org/ooxml/drawingml/main"
  ];
  const edges = graph.outgoing(part);
  while (pending.length) {
    const { before, after } = pending.pop()!;
    if (
      before.name.namespace !== after.name.namespace ||
      before.name.localName !== after.name.localName ||
      before.children.length !== after.children.length
    )
      unsupported("XML replacement must preserve element names and sequence.");
    if (
      !understood.includes(after.name.namespace) ||
      ["graphicData", "ext"].includes(after.name.localName)
    ) {
      if (selected.document.markup(before) !== changed.markup(after))
        unsupported("Opaque XML content must remain unchanged.");
      continue;
    }
    for (const attribute of [...before.attributes, ...after.attributes]) {
      if (!attribute.name.namespace) continue;
      const matches = (item: typeof attribute) =>
        item.name.namespace === attribute.name.namespace &&
        item.name.localName === attribute.name.localName;
      const left = before.attributes.find(matches);
      const right = after.attributes.find(matches);
      if (
        right &&
        relationshipNamespaces.includes(attribute.name.namespace) &&
        !edges.some((edge) => edge.id === right.value)
      )
        throw new OfficeError(
          "invalid-opc",
          "XML references an absent relationship.",
          "validate-result"
        );
      if (left?.value !== right?.value)
        unsupported("Namespaced XML attributes must remain unchanged.");
    }
    if (namespaces.includes(after.name.namespace) && after.name.localName === "modifyVerifier")
      unsupported("Protection changes are unsupported.");
    const order =
      after.name.namespace === root.name.namespace ? sequences[after.name.localName] : undefined;
    if (order) {
      let previous = -1;
      for (const child of after.children) {
        const rank = order.indexOf(child.name.localName);
        if (rank < 0 || rank <= previous) unsupported("Unsupported XML child sequence.");
        previous = rank;
      }
    }
    for (const attribute of after.attributes) {
      if (
        relationshipNamespaces.includes(attribute.name.namespace) &&
        attribute.name.namespace !== relationshipNamespaces[namespaces.indexOf(root.name.namespace)]
      )
        unsupported("XML replacement must preserve relationship dialect.");
    }
    after.children.forEach((child, index) =>
      pending.push({ before: before.children[index]!, after: child })
    );
  }
  const candidate: PackageReader = {
    names: reader.names,
    has: reader.has,
    get: (name) => (name === part ? new Uint8Array(bytes) : reader.get(name)),
    relsXmlFor: reader.relsXmlFor
  };
  if (!validatePresentation(candidate, context.validationLimits).valid)
    throw new OfficeError(
      "invalid-opc",
      "Replacement fails presentation graph validation.",
      "validate-result"
    );
  return candidate;
}

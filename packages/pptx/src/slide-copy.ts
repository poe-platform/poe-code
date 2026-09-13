import { readMemberships } from "./memberships.js";
import { remapCopiedXml } from "./slide-copy-xml.js";
import { readBinary } from "./bytes.js";
import type { BinaryInput } from "./contracts.js";
import { OfficeError } from "./errors.js";
import { parseContentTypes } from "./content-types.js";
import { readPackage } from "./package-reader.js";
import { writePackageArchive } from "./package-writer.js";
import { asciiKey, relativePartReference } from "./package-uri.js";
import { readRelationshipGraph } from "./relationships.js";
import {
  readSelectionIndex,
  SelectionError,
  type SelectionContext,
  type SelectionQuery
} from "./selectors.js";
import { parseXmlPart, type XmlElement, type XmlPart } from "./xml.js";
import { validatePresentation } from "./validation.js";

export interface DuplicateSlidesOptions {
  readonly selection: SelectionQuery | readonly SelectionQuery[];
  readonly position: number;
  readonly allowEmpty?: boolean;
}
const dialects = [
  {
    p: "http://schemas.openxmlformats.org/presentationml/2006/main",
    a: "http://schemas.openxmlformats.org/drawingml/2006/main",
    c: "http://schemas.openxmlformats.org/drawingml/2006/chart",
    r: "http://schemas.openxmlformats.org/officeDocument/2006/relationships"
  },
  {
    p: "http://purl.oclc.org/ooxml/presentationml/main",
    a: "http://purl.oclc.org/ooxml/drawingml/main",
    c: "http://purl.oclc.org/ooxml/drawingml/chart",
    r: "http://purl.oclc.org/ooxml/officeDocument/relationships"
  }
];
const relNamespace = "http://schemas.openxmlformats.org/package/2006/relationships";
const contentNamespace = "http://schemas.openxmlformats.org/package/2006/content-types";
function attr(node: XmlElement, name: string, namespace = "") {
  return node.attributes.find((x) => x.name.localName === name && x.name.namespace === namespace)
    ?.value;
}
function relPart(owner: string) {
  const slash = owner.lastIndexOf("/");
  return `${owner.slice(0, slash)}/_rels/${owner.slice(slash + 1)}.rels`;
}
function unsupported(): never {
  throw new OfficeError(
    "unsupported-edit",
    "Slide copying cannot safely remap this structure or dependency.",
    "validate-intent"
  );
}
function elements(xml: XmlPart) {
  const result: { node: XmlElement; path: number[] }[] = [];
  const visit = (node: XmlElement, path: number[]) => {
    result.push({ node, path });
    node.children.forEach((child, i) => visit(child, [...path, i]));
  };
  visit(xml.root, []);
  return result;
}
function escape(value: string) {
  return value
    .split("&")
    .join("&amp;")
    .split('"')
    .join("&quot;")
    .split("<")
    .join("&lt;")
    .split("\r")
    .join("&#13;")
    .split("\n")
    .join("&#10;")
    .split("\t")
    .join("&#9;");
}

export async function duplicateSlides(
  input: BinaryInput,
  options: DuplicateSlidesOptions,
  context: SelectionContext
): Promise<Uint8Array> {
  if (
    !options ||
    typeof options !== "object" ||
    ![Object.prototype, null].includes(Object.getPrototypeOf(options)) ||
    Object.keys(options).some((key) => !["selection", "position", "allowEmpty"].includes(key)) ||
    !Number.isSafeInteger(options.position) ||
    options.position < 1 ||
    (options.allowEmpty !== undefined && typeof options.allowEmpty !== "boolean")
  )
    throw new OfficeError("invalid-value", "Invalid slide copying options.", "usage");
  if (!context?.xmlLimits || !context.relationshipLimits)
    throw new OfficeError(
      "invalid-value",
      "Explicit XML and relationship limits are required.",
      "usage"
    );
  const queries: readonly SelectionQuery[] = Array.isArray(options.selection)
    ? options.selection
    : [options.selection as SelectionQuery];
  if (!queries.length) throw new SelectionError("invalid-selection");
  if (queries.length > context.relationshipLimits.maxParts)
    throw new OfficeError("resource-limit", "Too many slide selections.", "usage");
  for (const q of queries)
    if (
      !q ||
      typeof q !== "object" ||
      (q.kind !== undefined && q.kind !== "slide") ||
      (q.scope !== undefined && q.scope !== "slides") ||
      (!q.all &&
        q.token === undefined &&
        q.id === undefined &&
        q.name === undefined &&
        q.position === undefined)
    )
      throw new SelectionError("invalid-selection");
  const source = await readBinary(input, context);
  const reader = await readPackage(source, context);
  const limits = {
    ...context.xmlLimits,
    ...context.relationshipLimits,
    maxBytes: Math.min(context.xmlLimits.maxBytes, context.relationshipLimits.maxBytes),
    maxEntries: context.archiveLimits.maxMembers
  };
  const types = parseContentTypes(reader.get("/[Content_Types].xml"), limits);
  const graph = readRelationshipGraph(reader, context.relationshipLimits);
  for (const name of reader.names) {
    if (name === "/[Content_Types].xml") continue;
    const type = types.get(name).toLowerCase();
    if (
      type.includes("digital-signature") ||
      type.includes("macroenabled") ||
      type.includes("vbaproject") ||
      asciiKey(name).startsWith("/_xmlsignatures/")
    )
      unsupported();
  }
  for (const owner of ["/", ...graph.parts])
    if (
      graph
        .outgoing(owner)
        .some(
          (edge) => edge.type.includes("/digital-signature/") || edge.type.endsWith("/vbaProject")
        )
    )
      unsupported();
  if (!validatePresentation(reader, limits).valid)
    throw new OfficeError(
      "invalid-opc",
      "Slide copying requires a valid presentation graph.",
      "validate-intent"
    );
  const index = await readSelectionIndex(source, context);
  if (options.position > index.slides.length + 1)
    throw new OfficeError(
      "invalid-value",
      "Insertion position is outside the slide list.",
      "usage"
    );
  const selected: string[] = [];
  for (const query of queries) {
    try {
      for (const record of index.select(query)) {
        if (record.kind !== "slide" || selected.includes(record.part))
          throw new SelectionError("invalid-selection");
        selected.push(record.part);
      }
    } catch (error) {
      if (
        !(
          error instanceof SelectionError &&
          error.code === "missing-selection" &&
          options.allowEmpty
        )
      )
        throw error;
    }
  }
  const main = graph
    .outgoing("/")
    .find((edge) => dialects.some((d) => edge.type === `${d.r}/officeDocument`))!.targetPart!;
  let presentation = parseXmlPart(reader.get(main), context.xmlLimits);
  const d = dialects.find((value) => value.p === presentation.root.name.namespace)!;
  for (const { node } of elements(presentation))
    if (
      node.name.localName === "modifyVerifier" ||
      node.name.namespace === "http://schemas.openxmlformats.org/markup-compatibility/2006"
    )
      unsupported();
  if (!selected.length) return source;
  const sections = await readMemberships(source, "sections", context);
  const containingSection = sections.find(
    (section) => section.slides[0]! < options.position && section.slides.at(-1)! >= options.position
  );
  const list = presentation.root.children.find(
    (node) => node.name.namespace === d.p && node.name.localName === "sldIdLst"
  )!;
  if (list.children.some((node) => node.name.namespace !== d.p || node.name.localName !== "sldId"))
    unsupported();
  const usedNames = new Set(reader.names.map(asciiKey));
  const changes = new Map<string, Uint8Array>();
  const allocate = (part: string) => {
    const dot = part.lastIndexOf(".");
    const stem = dot > part.lastIndexOf("/") ? part.slice(0, dot) : part;
    const suffix = part.slice(stem.length);
    let n = 1,
      name: string;
    do {
      name = `${stem}-copy${n++}${suffix}`;
    } while (usedNames.has(asciiKey(name)) || usedNames.has(asciiKey(relPart(name))));
    usedNames.add(asciiKey(name));
    usedNames.add(asciiKey(relPart(name)));
    return name;
  };
  let manifest = parseXmlPart(reader.get("/[Content_Types].xml"), context.xmlLimits);
  let mainRels = parseXmlPart(reader.get(relPart(main)), context.xmlLimits);
  const usedSlideIds = new Set(index.slides.map((slide) => Number(slide.id)));
  const usedRelIds = new Set(graph.outgoing(main).map((edge) => edge.id));
  let nextSlideId = Math.max(255, ...usedSlideIds) + 1;
  let nextRelId = 1;
  const inserted: string[] = [];
  const insertedIds: number[] = [];
  let copiedBytes = 0,
    copiedParts = 0,
    copiedRelationships = 0;
  for (const slide of selected) {
    context.signal?.throwIfAborted();
    const copies = new Map<string, string>([[slide, allocate(slide)]]);
    const pending = [slide];
    for (let cursor = 0; cursor < pending.length; cursor++) {
      const owner = pending[cursor]!;
      for (const edge of graph.outgoing(owner)) {
        const kind = edge.type.startsWith(`${d.r}/`) ? edge.type.slice(d.r.length + 1) : "";
        if (edge.external) {
          if (!["hyperlink", "image", "audio", "video"].includes(kind)) unsupported();
          continue;
        }
        if (!edge.targetPart || edge.target.includes("#") || edge.target.includes("?"))
          unsupported();
        const targetType = types.get(edge.targetPart);
        const expectedTypes: Record<string, string> = {
          slide: "application/vnd.openxmlformats-officedocument.presentationml.slide+xml",
          slideLayout:
            "application/vnd.openxmlformats-officedocument.presentationml.slideLayout+xml",
          notesSlide: "application/vnd.openxmlformats-officedocument.presentationml.notesSlide+xml",
          notesMaster:
            "application/vnd.openxmlformats-officedocument.presentationml.notesMaster+xml",
          theme: "application/vnd.openxmlformats-officedocument.theme+xml",
          chart: "application/vnd.openxmlformats-officedocument.drawingml.chart+xml",
          package: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
        };
        if (expectedTypes[kind] && targetType !== expectedTypes[kind]) unsupported();
        if (
          ["image", "audio", "video"].includes(kind) &&
          (!targetType.startsWith(`${kind}/`) || graph.outgoing(edge.targetPart).length)
        )
          unsupported();
        if (kind === "hyperlink") unsupported();
        const clone =
          ["notesSlide", "chart"].includes(kind) ||
          (kind === "package" &&
            types.get(owner) ===
              "application/vnd.openxmlformats-officedocument.drawingml.chart+xml");
        if (
          !clone &&
          ![
            "slideLayout",
            "notesMaster",
            "theme",
            "image",
            "audio",
            "video",
            "slide",
            "hyperlink"
          ].includes(kind)
        )
          unsupported();
        if (clone && !copies.has(edge.targetPart)) {
          copies.set(edge.targetPart, allocate(edge.targetPart));
          pending.push(edge.targetPart);
        }
      }
      if (pending.length + copiedParts > context.relationshipLimits.maxParts)
        throw new OfficeError("resource-limit", "Copied part limit exceeded.", "validate-intent");
    }
    for (const [original, copy] of copies) {
      context.signal?.throwIfAborted();
      copiedParts++;
      const bytes = reader.get(original);
      copiedBytes += bytes.length;
      if (copiedBytes > context.archiveLimits.maxTotalBytes)
        throw new OfficeError("resource-limit", "Copied byte limit exceeded.", "validate-intent");
      const edges = graph.outgoing(original);
      copiedRelationships += edges.length;
      if (copiedRelationships > context.relationshipLimits.maxRelationships)
        throw new OfficeError(
          "resource-limit",
          "Copied relationship limit exceeded.",
          "validate-intent"
        );
      const oldIds = new Set(edges.map((edge) => edge.id));
      const ids = new Map<string, string>();
      let next = 1;
      for (const edge of edges) {
        while (oldIds.has(`rId${next}`)) next++;
        ids.set(edge.id, `rId${next++}`);
      }
      const type = types.get(original);
      if (type.endsWith("+xml") || type === "application/xml" || type === "text/xml") {
        changes.set(
          copy,
          remapCopiedXml(bytes, edges, ids, { xmlLimits: context.xmlLimits, dialect: d })
        );
      } else {
        if (edges.length) unsupported();
        changes.set(copy, new Uint8Array(bytes));
      }
      if (edges.length) {
        let rels = parseXmlPart(reader.get(relPart(original)), context.xmlLimits);
        for (let i = 0; i < rels.root.children.length; i++) {
          const node = rels.root.children[i]!;
          const edge = edges.find((edge) => edge.id === attr(node, "Id"))!;
          const target = edge.external
            ? edge.target
            : relativePartReference(
                copies.get(edge.targetPart!) ?? edge.targetPart!,
                copy.slice(0, copy.lastIndexOf("/"))
              );
          rels = rels.merge(node, {
            attributes: [
              { namespace: "", localName: "Id", value: ids.get(edge.id)! },
              { namespace: "", localName: "Target", value: target }
            ]
          });
        }
        changes.set(relPart(copy), rels.bytes());
      }
      manifest = manifest.spliceChildren(manifest.root, manifest.root.children.length, 0, [
        `<Override xmlns="${contentNamespace}" PartName="${escape(copy)}" ContentType="${escape(type)}"/>`
      ]);
    }
    if (nextSlideId > 2147483647) nextSlideId = 256;
    while (usedSlideIds.has(nextSlideId)) nextSlideId++;
    if (nextSlideId > 2147483647)
      throw new OfficeError("resource-limit", "Slide IDs exhausted.", "validate-intent");
    usedSlideIds.add(nextSlideId);
    while (usedRelIds.has(`rId${nextRelId}`)) nextRelId++;
    const id = `rId${nextRelId++}`;
    usedRelIds.add(id);
    insertedIds.push(nextSlideId);
    inserted.push(
      `<p:sldId xmlns="" xmlns:p="${d.p}" xmlns:r="${d.r}" id="${nextSlideId++}" r:id="${id}"/>`
    );
    mainRels = mainRels.spliceChildren(mainRels.root, mainRels.root.children.length, 0, [
      `<Relationship xmlns="${relNamespace}" Id="${id}" Type="${d.r}/slide" Target="${escape(relativePartReference(copies.get(slide)!, main.slice(0, main.lastIndexOf("/"))))}"/>`
    ]);
  }
  presentation = presentation.spliceChildren(list, options.position - 1, 0, inserted);
  if (containingSection) {
    const sectionNamespace = "http://schemas.microsoft.com/office/powerpoint/2010/main";
    const section = elements(presentation).find(
      ({ node }) =>
        node.name.namespace === sectionNamespace &&
        node.name.localName === "section" &&
        attr(node, "id") === containingSection.id
    )!.node;
    const members = section.children.find(
      (node) => node.name.namespace === sectionNamespace && node.name.localName === "sldIdLst"
    )!;
    presentation = presentation.spliceChildren(
      members,
      options.position - containingSection.slides[0]!,
      0,
      insertedIds.map((id) => `<s:sldId xmlns:s="${sectionNamespace}" id="${id}"/>`)
    );
  }
  changes.set(main, presentation.bytes());
  changes.set(relPart(main), mainRels.bytes());
  changes.set("/[Content_Types].xml", manifest.bytes());
  const names = [
    ...reader.names,
    ...[...changes.keys()].filter((name) => !reader.names.includes(name))
  ];
  const output = await writePackageArchive(
    names.map((name) => ({ name: name.slice(1), bytes: changes.get(name) ?? reader.get(name) })),
    context,
    { compression: "auto", source }
  );
  if (!validatePresentation(await readPackage(output, context), limits).valid)
    throw new OfficeError("invalid-opc", "Copied slides fail graph validation.", "validate-result");
  return output;
}

import { SaxesParser } from "saxes";
import { readBinary } from "./bytes.js";
import type { BinaryInput } from "./contracts.js";
import { parseContentTypes } from "./content-types.js";
import { OfficeError } from "./errors.js";
import { readPackage } from "./package-reader.js";
import { writePackageArchive } from "./package-writer.js";
import { asciiKey, relativePartReference } from "./package-uri.js";
import { readRelationshipGraph } from "./relationships.js";
import { readSelectionIndex, type SelectionContext } from "./selectors.js";
import { remapCopiedXml } from "./slide-copy-xml.js";
import { parseXmlPart, type XmlElement } from "./xml.js";
import { validatePresentation } from "./validation.js";

export interface ImportSlidesOptions {
  readonly sourceSlides: readonly number[];
  readonly position?: number;
  readonly themePolicy?: "source" | "destination";
  readonly dimensionPolicy?: "reject" | "destination";
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
function unsupported(message: string): never {
  throw new OfficeError("unsupported-edit", message, "validate-intent");
}

function textDefaults(
  xml: ReturnType<typeof parseXmlPart>,
  dialect: (typeof dialects)[number]
): string {
  const tokens: string[] = [];
  const parser = new SaxesParser({ xmlns: true });
  let depth = 0;
  parser.on("opentag", (tag) => {
    if (tag.uri === dialect.p && tag.local === "defaultTextStyle") {
      if (depth || tokens.length)
        unsupported("Import cannot resolve duplicate presentation text defaults.");
      depth = 1;
    } else if (depth) depth++;
    if (
      depth &&
      ((depth > 1 && tag.uri !== dialect.a) ||
        tag.local === "extLst" ||
        Object.values(tag.attributes).some(
          (attribute) =>
            attribute.uri &&
            !["http://www.w3.org/2000/xmlns/", "http://www.w3.org/XML/1998/namespace"].includes(
              attribute.uri
            )
        ))
    )
      unsupported(
        "Import cannot establish equivalence of extended or linked presentation text defaults."
      );
    if (depth)
      tokens.push(
        JSON.stringify([
          tag.uri,
          tag.local,
          Object.values(tag.attributes)
            .filter((attribute) => attribute.uri !== "http://www.w3.org/2000/xmlns/")
            .map((attribute) => [attribute.uri, attribute.local, attribute.value])
            .sort((left, right) =>
              JSON.stringify(left) < JSON.stringify(right)
                ? -1
                : JSON.stringify(left) > JSON.stringify(right)
                  ? 1
                  : 0
            )
        ])
      );
  });
  parser.on("text", (value) => {
    if (depth && value.trim()) tokens.push(JSON.stringify(value));
  });
  parser.on("cdata", (value) => {
    if (depth) tokens.push(JSON.stringify(value));
  });
  parser.on("closetag", () => {
    if (depth) {
      tokens.push("/");
      depth--;
    }
  });
  parser.write(xml.markup(xml.root)).close();
  return JSON.stringify(tokens);
}

export async function importSlides(
  destination: BinaryInput,
  source: BinaryInput,
  options: ImportSlidesOptions,
  context: SelectionContext
): Promise<Uint8Array> {
  if (
    !options ||
    typeof options !== "object" ||
    ![Object.prototype, null].includes(Object.getPrototypeOf(options)) ||
    Object.keys(options).some(
      (key) => !["sourceSlides", "position", "themePolicy", "dimensionPolicy"].includes(key)
    ) ||
    !Array.isArray(options.sourceSlides) ||
    !options.sourceSlides.length ||
    (options.position !== undefined &&
      (!Number.isSafeInteger(options.position) || options.position < 1)) ||
    (options.themePolicy !== undefined &&
      !["source", "destination"].includes(options.themePolicy)) ||
    (options.dimensionPolicy !== undefined &&
      !["reject", "destination"].includes(options.dimensionPolicy))
  )
    throw new OfficeError("invalid-value", "Invalid slide import options.", "usage");
  if (!context?.xmlLimits || !context.relationshipLimits)
    throw new OfficeError(
      "invalid-value",
      "Explicit XML and relationship limits are required.",
      "usage"
    );
  if (options.themePolicy === "destination")
    unsupported("Import currently requires source theme preservation.");
  if (options.sourceSlides.length > context.relationshipLimits.maxParts)
    throw new OfficeError("resource-limit", "Too many source slide selections.", "usage");
  options = { ...options, sourceSlides: Array.from(options.sourceSlides) };
  if (
    options.sourceSlides.some((value) => !Number.isSafeInteger(value) || value < 1) ||
    new Set(options.sourceSlides).size !== options.sourceSlides.length
  )
    throw new OfficeError("invalid-value", "Invalid source slide selection.", "usage");
  const destinationBytes = await readBinary(destination, context);
  const sourceBytes = await readBinary(source, context);
  const destinationReader = await readPackage(destinationBytes, context);
  const sourceReader = await readPackage(sourceBytes, context);
  const limits = {
    ...context.xmlLimits,
    ...context.relationshipLimits,
    maxBytes: Math.min(context.xmlLimits.maxBytes, context.relationshipLimits.maxBytes),
    maxEntries: context.archiveLimits.maxMembers
  };
  const destinationGraph = readRelationshipGraph(destinationReader, context.relationshipLimits);
  const sourceGraph = readRelationshipGraph(sourceReader, context.relationshipLimits);
  for (const reader of [destinationReader, sourceReader]) {
    const types = parseContentTypes(reader.get("/[Content_Types].xml"), limits);
    for (const name of reader.names) {
      if (name === "/[Content_Types].xml") continue;
      const type = asciiKey(types.get(name));
      if (
        type.includes("digital-signature") ||
        type.includes("macroenabled") ||
        type.includes("vbaproject") ||
        asciiKey(name).startsWith("/_xmlsignatures/")
      )
        unsupported("Import does not modify signed or macro-enabled packages.");
    }
    if (!validatePresentation(reader, limits).valid)
      throw new OfficeError(
        "invalid-opc",
        "Slide import requires valid presentation graphs.",
        "validate-intent"
      );
  }
  for (const graph of [destinationGraph, sourceGraph])
    for (const owner of ["/", ...graph.parts])
      if (
        graph
          .outgoing(owner)
          .some(
            (edge) => edge.type.includes("/digital-signature/") || edge.type.endsWith("/vbaProject")
          )
      )
        unsupported("Import does not modify signed or macro-enabled packages.");
  const destinationIndex = await readSelectionIndex(destinationBytes, context);
  const sourceIndex = await readSelectionIndex(sourceBytes, context);
  const position = options.position ?? destinationIndex.slides.length + 1;
  if (
    position > destinationIndex.slides.length + 1 ||
    options.sourceSlides.some((value) => value > sourceIndex.slides.length)
  )
    throw new OfficeError("invalid-value", "Slide position is outside the slide list.", "usage");
  const selected = options.sourceSlides.map((value) => sourceIndex.slides[value - 1]!.part);
  const destinationMain = destinationGraph
    .outgoing("/")
    .find((edge) => dialects.some((d) => edge.type === `${d.r}/officeDocument`))!.targetPart!;
  const sourceMain = sourceGraph
    .outgoing("/")
    .find((edge) => dialects.some((d) => edge.type === `${d.r}/officeDocument`))!.targetPart!;
  let presentation = parseXmlPart(destinationReader.get(destinationMain), context.xmlLimits);
  const sourcePresentation = parseXmlPart(sourceReader.get(sourceMain), context.xmlLimits);
  const d = dialects.find((value) => value.p === presentation.root.name.namespace)!;
  if (sourcePresentation.root.name.namespace !== d.p)
    unsupported("Import requires matching XML dialects.");
  for (const xml of [presentation, sourcePresentation]) {
    const pending = [xml.root];
    while (pending.length) {
      const node = pending.pop()!;
      if (
        node.name.localName === "modifyVerifier" ||
        node.name.namespace === "http://schemas.openxmlformats.org/markup-compatibility/2006"
      )
        unsupported("Import cannot safely update this presentation structure.");
      pending.push(...node.children);
    }
  }
  if (textDefaults(presentation, d) !== textDefaults(sourcePresentation, d))
    unsupported("Import requires equivalent presentation-wide text defaults.");
  if (
    [presentation, sourcePresentation].some((xml) =>
      xml.root.children.some(
        (node) => node.name.namespace === d.p && node.name.localName === "embeddedFontLst"
      )
    )
  )
    unsupported("Import cannot yet resolve presentation-wide embedded fonts.");
  if (options.dimensionPolicy !== "destination")
    for (const name of ["sldSz", "notesSz"]) {
      const left = presentation.root.children.find(
        (node) => node.name.namespace === d.p && node.name.localName === name
      );
      const right = sourcePresentation.root.children.find(
        (node) => node.name.namespace === d.p && node.name.localName === name
      );
      if (
        !left ||
        !right ||
        ["cx", "cy"].some((key) => Number(attr(left, key)) !== Number(attr(right, key)))
      )
        unsupported(
          "Slide or notes dimensions differ; explicitly select destination dimensions to retain source geometry without scaling."
        );
    }
  const types = parseContentTypes(sourceReader.get("/[Content_Types].xml"), limits);
  const expectedTypes: Record<string, string> = {
    slide: "application/vnd.openxmlformats-officedocument.presentationml.slide+xml",
    slideLayout: "application/vnd.openxmlformats-officedocument.presentationml.slideLayout+xml",
    slideMaster: "application/vnd.openxmlformats-officedocument.presentationml.slideMaster+xml",
    notesSlide: "application/vnd.openxmlformats-officedocument.presentationml.notesSlide+xml",
    notesMaster: "application/vnd.openxmlformats-officedocument.presentationml.notesMaster+xml",
    theme: "application/vnd.openxmlformats-officedocument.theme+xml",
    themeOverride: "application/vnd.openxmlformats-officedocument.themeOverride+xml",
    chart: "application/vnd.openxmlformats-officedocument.drawingml.chart+xml",
    package: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
  };
  const closure = [...selected];
  const visited = new Set(selected);
  for (let cursor = 0; cursor < closure.length; cursor++) {
    const owner = closure[cursor]!;
    for (const edge of sourceGraph.outgoing(owner)) {
      const kind = edge.type.startsWith(`${d.r}/`) ? edge.type.slice(d.r.length + 1) : "";
      if (edge.external) {
        if (!["hyperlink", "image", "audio", "video"].includes(kind))
          unsupported("Import encountered an unsupported external relationship.");
        continue;
      }
      if (!edge.targetPart || edge.target.includes("#") || edge.target.includes("?"))
        unsupported("Import cannot remap this part target.");
      const type = types.get(edge.targetPart);
      if (
        expectedTypes[kind]
          ? type !== expectedTypes[kind]
          : !["image", "audio", "video"].includes(kind)
      )
        unsupported("Import encountered an unsupported dependency type.");
      if (
        ["image", "audio", "video"].includes(kind) &&
        (!type.startsWith(`${kind}/`) || sourceGraph.outgoing(edge.targetPart).length)
      )
        unsupported("Import media must have a matching type and no package relationships.");
      if (kind === "package" && types.get(owner) !== expectedTypes.chart)
        unsupported("Import supports embedded workbooks only as chart dependencies.");
      if (kind === "slide" && !selected.includes(edge.targetPart))
        unsupported("Import requires selecting every internally linked source slide.");
      if (!visited.has(edge.targetPart)) {
        visited.add(edge.targetPart);
        closure.push(edge.targetPart);
      }
    }
    if (closure.length + destinationGraph.parts.length > context.relationshipLimits.maxParts)
      throw new OfficeError("resource-limit", "Imported part limit exceeded.", "validate-intent");
  }
  const notesMasters = closure.filter((name) => types.get(name) === expectedTypes.notesMaster);
  if (
    notesMasters.length > 1 ||
    (notesMasters.length &&
      destinationGraph.outgoing(destinationMain).some((edge) => edge.type === `${d.r}/notesMaster`))
  )
    unsupported("Import cannot preserve competing notes masters in one presentation.");
  const usedNames = new Set(destinationReader.names.map(asciiKey));
  const copies = new Map<string, string>();
  for (const part of closure) {
    const dot = part.lastIndexOf(".");
    const stem = dot > part.lastIndexOf("/") ? part.slice(0, dot) : part;
    const suffix = part.slice(stem.length);
    let count = 1;
    let name: string;
    do {
      name = `${stem}-import${count++}${suffix}`;
    } while (usedNames.has(asciiKey(name)) || usedNames.has(asciiKey(relPart(name))));
    usedNames.add(asciiKey(name));
    usedNames.add(asciiKey(relPart(name)));
    copies.set(part, name);
  }
  const usedLayoutIds = new Set<number>();
  for (const name of destinationGraph.parts) {
    if (!destinationGraph.incoming(name).some((edge) => edge.type === `${d.r}/slideMaster`))
      continue;
    const xml = parseXmlPart(destinationReader.get(name), context.xmlLimits);
    for (const list of xml.root.children.filter(
      (node) => node.name.namespace === d.p && node.name.localName === "sldLayoutIdLst"
    ))
      for (const node of list.children) usedLayoutIds.add(Number(attr(node, "id")));
  }
  let nextLayoutId = 2147483648;
  const changes = new Map<string, Uint8Array>();
  let manifest = parseXmlPart(destinationReader.get("/[Content_Types].xml"), context.xmlLimits);
  for (const original of closure) {
    context.signal?.throwIfAborted();
    const copy = copies.get(original)!;
    const bytes = sourceReader.get(original);
    const edges = sourceGraph.outgoing(original);
    const oldIds = new Set(edges.map((edge) => edge.id));
    const ids = new Map<string, string>();
    let next = 1;
    for (const edge of edges) {
      while (oldIds.has(`rId${next}`)) next++;
      ids.set(edge.id, `rId${next++}`);
    }
    const type = types.get(original);
    if (type.endsWith("+xml") || type === "application/xml" || type === "text/xml") {
      const xml = parseXmlPart(bytes, context.xmlLimits);
      const pending = [xml.root];
      while (pending.length) {
        const node = pending.pop()!;
        if (node.name.namespace === d.a && ["tbl", "tableStyleId"].includes(node.name.localName))
          unsupported("Import cannot yet resolve presentation-wide table styles.");
        pending.push(...node.children);
      }
      changes.set(
        copy,
        remapCopiedXml(bytes, edges, ids, {
          xmlLimits: context.xmlLimits,
          dialect: d,
          allocateLayoutId: () => {
            while (usedLayoutIds.has(nextLayoutId)) nextLayoutId++;
            if (nextLayoutId > 4294967295)
              throw new OfficeError("resource-limit", "Layout IDs exhausted.", "validate-intent");
            usedLayoutIds.add(nextLayoutId);
            return String(nextLayoutId++);
          }
        })
      );
    } else {
      if (edges.length) unsupported("Import cannot remap relationships inside this binary part.");
      changes.set(copy, bytes);
    }
    if (edges.length) {
      let rels = parseXmlPart(sourceReader.get(relPart(original)), context.xmlLimits);
      for (let index = 0; index < rels.root.children.length; index++) {
        const node = rels.root.children[index]!;
        const edge = edges.find((value) => value.id === attr(node, "Id"))!;
        const target = edge.external
          ? edge.target
          : relativePartReference(
              copies.get(edge.targetPart!)!,
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
  let mainRels = parseXmlPart(destinationReader.get(relPart(destinationMain)), context.xmlLimits);
  const usedRelIds = new Set(destinationGraph.outgoing(destinationMain).map((edge) => edge.id));
  let nextRelId = 1;
  const register = (name: string, kind: string) => {
    while (usedRelIds.has(`rId${nextRelId}`)) nextRelId++;
    const id = `rId${nextRelId++}`;
    usedRelIds.add(id);
    mainRels = mainRels.spliceChildren(mainRels.root, mainRels.root.children.length, 0, [
      `<Relationship xmlns="${relNamespace}" Id="${id}" Type="${d.r}/${kind}" Target="${escape(relativePartReference(copies.get(name)!, destinationMain.slice(0, destinationMain.lastIndexOf("/"))))}"/>`
    ]);
    return id;
  };
  const updateList = (name: string, fragments: string[], insertion?: number) => {
    if (!fragments.length) return;
    const list = presentation.root.children.find(
      (node) => node.name.namespace === d.p && node.name.localName === name
    );
    if (list) {
      if (
        list.children.some(
          (node) => node.name.namespace !== d.p || node.name.localName !== name.slice(0, -3)
        )
      )
        unsupported("Import cannot update an extended presentation list.");
      presentation = presentation.spliceChildren(
        list,
        insertion ?? list.children.length,
        0,
        fragments
      );
    } else {
      const order = [
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
      ];
      const index = presentation.root.children.findIndex(
        (node) => order.indexOf(node.name.localName) > order.indexOf(name)
      );
      presentation = presentation.spliceChildren(
        presentation.root,
        index < 0 ? presentation.root.children.length : index,
        0,
        [`<p:${name} xmlns:p="${d.p}" xmlns:r="${d.r}">${fragments.join("")}</p:${name}>`]
      );
    }
  };
  const usedMasterIds = new Set(
    presentation.root.children
      .filter((node) => node.name.namespace === d.p && node.name.localName === "sldMasterIdLst")
      .flatMap((list) => list.children.map((node) => Number(attr(node, "id"))))
  );
  let nextMasterId = 2147483648;
  updateList(
    "sldMasterIdLst",
    closure
      .filter((name) => types.get(name) === expectedTypes.slideMaster)
      .map((name) => {
        while (usedMasterIds.has(nextMasterId)) nextMasterId++;
        if (nextMasterId > 4294967295)
          throw new OfficeError("resource-limit", "Master IDs exhausted.", "validate-intent");
        usedMasterIds.add(nextMasterId);
        return `<p:sldMasterId xmlns:p="${d.p}" xmlns:r="${d.r}" id="${nextMasterId++}" r:id="${register(name, "slideMaster")}"/>`;
      })
  );
  updateList(
    "notesMasterIdLst",
    notesMasters.map(
      (name) =>
        `<p:notesMasterId xmlns:p="${d.p}" xmlns:r="${d.r}" r:id="${register(name, "notesMaster")}"/>`
    )
  );
  const usedSlideIds = new Set(destinationIndex.slides.map((slide) => Number(slide.id)));
  let nextSlideId = 256;
  updateList(
    "sldIdLst",
    selected.map((name) => {
      while (usedSlideIds.has(nextSlideId)) nextSlideId++;
      if (nextSlideId > 2147483647)
        throw new OfficeError("resource-limit", "Slide IDs exhausted.", "validate-intent");
      usedSlideIds.add(nextSlideId);
      return `<p:sldId xmlns:p="${d.p}" xmlns:r="${d.r}" id="${nextSlideId++}" r:id="${register(name, "slide")}"/>`;
    }),
    position - 1
  );
  changes.set(destinationMain, presentation.bytes());
  changes.set(relPart(destinationMain), mainRels.bytes());
  changes.set("/[Content_Types].xml", manifest.bytes());
  const names = [
    ...destinationReader.names,
    ...[...changes.keys()].filter((name) => !destinationReader.has(name))
  ];
  const output = await writePackageArchive(
    names.map((name) => ({
      name: name.slice(1),
      bytes: changes.get(name) ?? destinationReader.get(name)
    })),
    context,
    { compression: "auto", source: destinationBytes }
  );
  if (!validatePresentation(await readPackage(output, context), limits).valid)
    throw new OfficeError(
      "invalid-opc",
      "Imported presentation fails graph validation.",
      "validate-result"
    );
  return output;
}

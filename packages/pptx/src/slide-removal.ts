import { readBinary } from "./bytes.js";
import type { BinaryInput } from "./contracts.js";
import { OfficeError } from "./errors.js";
import { parseContentTypes } from "./content-types.js";
import { readPackage } from "./package-reader.js";
import { writePackageArchive } from "./package-writer.js";
import { asciiKey } from "./package-uri.js";
import { readRelationshipGraph } from "./relationships.js";
import {
  readSelectionIndex,
  SelectionError,
  type SelectionContext,
  type SelectionQuery
} from "./selectors.js";
import { parseXmlPart, type XmlElement, type XmlPart } from "./xml.js";
import { validatePresentation } from "./validation.js";

export interface RemoveSlidesOptions {
  readonly selection: SelectionQuery | readonly SelectionQuery[];
  readonly allowEmpty?: boolean;
  readonly referencePolicy?: "remove";
}
const sectionNamespace = "http://schemas.microsoft.com/office/powerpoint/2010/main";
const dialects = [
  {
    p: "http://schemas.openxmlformats.org/presentationml/2006/main",
    a: "http://schemas.openxmlformats.org/drawingml/2006/main",
    r: "http://schemas.openxmlformats.org/officeDocument/2006/relationships"
  },
  {
    p: "http://purl.oclc.org/ooxml/presentationml/main",
    a: "http://purl.oclc.org/ooxml/drawingml/main",
    r: "http://purl.oclc.org/ooxml/officeDocument/relationships"
  }
];
function attr(node: XmlElement, localName: string, namespace = "") {
  return node.attributes.find(
    (a) => a.name.localName === localName && a.name.namespace === namespace
  )?.value;
}
function relPart(owner: string) {
  const slash = owner.lastIndexOf("/");
  return `${owner.slice(0, slash)}/_rels/${owner.slice(slash + 1)}.rels`;
}
function dangling(): never {
  throw new OfficeError(
    "dangling-reference",
    "Slide removal has unresolved references or requires an explicit removal policy.",
    "validate-intent"
  );
}
function prune(document: XmlPart, removed: Set<XmlElement>): XmlPart {
  const paths: number[][] = [];
  const visit = (node: XmlElement, path: number[]) => {
    if (removed.has(node)) {
      paths.push(path);
      return;
    }
    node.children.forEach((child, i) => visit(child, [...path, i]));
  };
  visit(document.root, []);
  for (const path of paths.reverse()) {
    let parent = document.root;
    for (const i of path.slice(0, -1)) parent = parent.children[i]!;
    document = document.spliceChildren(parent, path.at(-1)!, 1, []);
  }
  return document;
}

export async function removeSlides(
  input: BinaryInput,
  options: RemoveSlidesOptions,
  context: SelectionContext
): Promise<Uint8Array> {
  if (
    !options ||
    typeof options !== "object" ||
    ![Object.prototype, null].includes(Object.getPrototypeOf(options)) ||
    Object.keys(options).some(
      (key) => !["selection", "allowEmpty", "referencePolicy"].includes(key)
    ) ||
    (options.referencePolicy !== undefined && options.referencePolicy !== "remove") ||
    (options.allowEmpty !== undefined && typeof options.allowEmpty !== "boolean")
  )
    throw new OfficeError("invalid-value", "Invalid slide removal options.", "usage");
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
      throw new OfficeError(
        "unsupported-edit",
        "Signed and macro-enabled packages cannot be changed.",
        "validate-intent"
      );
  }
  for (const owner of ["/", ...graph.parts])
    if (
      graph
        .outgoing(owner)
        .some(
          (edge) => edge.type.includes("/digital-signature/") || edge.type.endsWith("/vbaProject")
        )
    )
      throw new OfficeError(
        "unsupported-edit",
        "Signed and macro-enabled packages cannot be changed.",
        "validate-intent"
      );
  if (!validatePresentation(reader, limits).valid)
    throw new OfficeError(
      "invalid-opc",
      "Slide removal requires a valid presentation graph.",
      "validate-intent"
    );
  const index = await readSelectionIndex(source, context);
  const ids = new Set<string>(),
    slides = new Set<string>();
  for (const query of queries) {
    try {
      for (const record of index.select(query)) {
        if (record.kind !== "slide" || ids.has(record.id))
          throw new SelectionError("invalid-selection");
        ids.add(record.id);
        slides.add(record.part);
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
  const presentation = parseXmlPart(reader.get(main), context.xmlLimits);
  const d = dialects.find((value) => value.p === presentation.root.name.namespace)!;
  const deleted = new Set(slides);
  for (const part of slides)
    for (const edge of graph.outgoing(part)) {
      if (
        edge.targetPart &&
        ["notesSlide", "comments"].some((kind) => edge.type === `${d.r}/${kind}`) &&
        types.get(edge.targetPart) ===
          `application/vnd.openxmlformats-officedocument.presentationml.${edge.type.endsWith("/comments") ? "comments" : "notesSlide"}+xml`
      )
        deleted.add(edge.targetPart);
    }
  // Shared dependents stay alive, including their outbound references.
  let changed = true;
  while (changed) {
    changed = false;
    for (const part of deleted)
      if (!slides.has(part) && graph.incoming(part).some((edge) => !deleted.has(edge.owner))) {
        deleted.delete(part);
        changed = true;
      }
  }
  const removedEdges = new Map<string, Set<string>>();
  for (const part of deleted)
    for (const edge of graph.incoming(part)) {
      if (deleted.has(edge.owner)) continue;
      if (edge.owner !== main || edge.type !== `${d.r}/slide` || !slides.has(part)) {
        if (
          !slides.has(part) ||
          edge.type !== `${d.r}/slide` ||
          options.referencePolicy !== "remove"
        )
          dangling();
      }
      const set = removedEdges.get(edge.owner) ?? new Set<string>();
      set.add(edge.id);
      removedEdges.set(edge.owner, set);
    }
  const mainEdges = removedEdges.get(main) ?? new Set<string>();
  const changes = new Map<string, Uint8Array>();
  for (const part of graph.parts) {
    context.signal?.throwIfAborted();
    if (deleted.has(part)) continue;
    const type = types.get(part);
    const edges = removedEdges.get(part) ?? new Set<string>();
    if (!type.endsWith("+xml") && type !== "application/xml" && type !== "text/xml") {
      if (edges.size) dangling();
      continue;
    }
    const document =
      part === main ? presentation : parseXmlPart(reader.get(part), context.xmlLimits);
    const removed = new Set<XmlElement>();
    const references = new Set<string>();
    const visit = (node: XmlElement, parent?: XmlElement) => {
      const ns = node.name.namespace,
        local = node.name.localName;
      if (ns === d.p && local === "modifyVerifier")
        throw new OfficeError(
          "unsupported-edit",
          "Protected presentations cannot be changed.",
          "validate-intent"
        );
      if (!slides.size) {
        node.children.forEach((child) => visit(child, node));
        return;
      }
      if ([d.p, d.a].includes(document.root.name.namespace)) {
        if (![d.p, d.a, sectionNamespace].includes(ns)) dangling();
        for (const attribute of node.attributes)
          if (
            attribute.name.namespace &&
            ![
              d.r,
              "http://www.w3.org/XML/1998/namespace",
              "http://schemas.openxmlformats.org/markup-compatibility/2006"
            ].includes(attribute.name.namespace)
          )
            dangling();
      }
      if (ns === "http://schemas.openxmlformats.org/markup-compatibility/2006") dangling();
      if (
        local === "ext" &&
        (ns === d.p ||
          (ns === d.a &&
            (parent?.name.localName === "extLst" || attr(node, "uri") !== undefined))) &&
        !(
          ns === d.p &&
          part === main &&
          attr(node, "uri") === "{521415D9-36F7-43E2-AB2F-B90AF26B5E84}" &&
          node.children.length === 1 &&
          node.children[0]!.name.namespace === sectionNamespace &&
          node.children[0]!.name.localName === "sectionLst"
        )
      )
        dangling();
      if (ns === sectionNamespace) {
        const structure: Record<string, { parent: string; child?: string; attributes: string[] }> =
          {
            sectionLst: { parent: "ext", child: "section", attributes: [] },
            section: { parent: "sectionLst", child: "sldIdLst", attributes: ["name", "id"] },
            sldIdLst: { parent: "section", child: "sldId", attributes: [] },
            sldId: { parent: "sldIdLst", attributes: ["id"] }
          };
        const rule = structure[local];
        if (
          part !== main ||
          !rule ||
          parent?.name.localName !== rule.parent ||
          parent.name.namespace !== (local === "sectionLst" ? d.p : sectionNamespace) ||
          node.children.some(
            (child) =>
              child.name.namespace !== sectionNamespace || child.name.localName !== rule.child
          ) ||
          node.attributes.some(
            (attribute) =>
              attribute.name.namespace || !rule.attributes.includes(attribute.name.localName)
          )
        )
          dangling();
        if (local === "sldId" && !index.slides.some((slide) => slide.id === attr(node, "id")))
          dangling();
      }
      if (
        (ns === d.a || ns === d.p) &&
        local === "extLst" &&
        node.children.length &&
        !(
          part === main &&
          ns === d.p &&
          parent === document.root &&
          node.children.every(
            (child) => child.name.namespace === d.p && child.name.localName === "ext"
          )
        )
      )
        dangling();
      const relation = attr(node, "id", d.r);
      if (
        part === main &&
        ns === d.p &&
        local === "sldId" &&
        parent?.name.localName === "sldIdLst" &&
        ids.has(attr(node, "id") ?? "")
      ) {
        removed.add(node);
        if (relation) references.add(relation);
        return;
      }
      const membership =
        part === main &&
        ((ns === d.p &&
          local === "sld" &&
          parent?.name.localName === "sldLst" &&
          mainEdges.has(relation ?? "")) ||
          (ns === sectionNamespace && local === "sldId" && ids.has(attr(node, "id") ?? "")));
      if (membership) {
        if (options.referencePolicy !== "remove") dangling();
        removed.add(node);
        return;
      }
      for (const attribute of node.attributes)
        if (attribute.name.namespace === d.r && edges.has(attribute.value)) {
          if (
            ns !== d.a ||
            !["hlinkClick", "hlinkHover"].includes(local) ||
            attribute.name.localName !== "id" ||
            options.referencePolicy !== "remove"
          )
            dangling();
          references.add(attribute.value);
          removed.add(node);
        }
      const action = attr(node, "action");
      if (
        action &&
        ![
          "ppaction://hlinkshowjump",
          "ppaction://hlinksldjump",
          "ppaction://customshow",
          "ppaction://hlinkfile",
          "ppaction://hlinkpres",
          "ppaction://ole",
          "ppaction://macro",
          "ppaction://program",
          "ppaction://media"
        ].includes(action.split("?")[0]!)
      )
        dangling();

      if (action?.startsWith("ppaction://hlinkshowjump")) {
        if (action !== "ppaction://hlinkshowjump?jump=endshow") {
          const owner = index.slides.findIndex((slide) => slide.part === part);
          const targets: Record<string, number> = {
            "ppaction://hlinkshowjump?jump=firstslide": 0,
            "ppaction://hlinkshowjump?jump=lastslide": index.slides.length - 1,
            "ppaction://hlinkshowjump?jump=nextslide": owner + 1,
            "ppaction://hlinkshowjump?jump=previousslide": owner - 1
          };
          const target = targets[action];
          if (owner < 0 || target === undefined || !index.slides[target]) dangling();
          if (slides.has(index.slides[target]!.part)) {
            if (
              options.referencePolicy !== "remove" ||
              ns !== d.a ||
              !["hlinkClick", "hlinkHover"].includes(local)
            )
              dangling();
            removed.add(node);
          }
        }
      }

      if (
        action &&
        (action.startsWith("ppaction://customshow") ||
          (action.startsWith("ppaction://hlinksldjump") &&
            (!relation ||
              !graph
                .outgoing(part)
                .some(
                  (edge) => edge.id === relation && edge.type === `${d.r}/slide` && !edge.external
                ))))
      )
        dangling();
      node.children.forEach((child) => visit(child, node));
      if (
        node.children.length &&
        node.children.every((child) => removed.has(child)) &&
        ((ns === sectionNamespace && ["sectionLst", "section", "sldIdLst"].includes(local)) ||
          (ns === d.p && ["custShowLst", "custShow", "sldLst", "ext", "extLst"].includes(local)))
      )
        removed.add(node);
    };
    visit(document.root);
    for (const edge of edges) if (!references.has(edge)) dangling();
    if (removed.size) changes.set(part, prune(document, removed).bytes());
  }
  if (!slides.size) return source;
  for (const [owner, ids] of removedEdges) {
    const name = relPart(owner);
    const document = parseXmlPart(reader.get(name), context.xmlLimits);
    changes.set(
      name,
      prune(
        document,
        new Set(document.root.children.filter((node) => ids.has(attr(node, "Id") ?? "")))
      ).bytes()
    );
  }
  const manifest = parseXmlPart(reader.get("/[Content_Types].xml"), context.xmlLimits);
  const deletedKeys = new Set([...deleted].map(asciiKey));
  changes.set(
    "/[Content_Types].xml",
    prune(
      manifest,
      new Set(
        manifest.root.children.filter(
          (node) =>
            node.name.localName === "Override" &&
            deletedKeys.has(asciiKey(attr(node, "PartName") ?? ""))
        )
      )
    ).bytes()
  );
  for (const part of [...deleted]) deleted.add(relPart(part));
  const output = await writePackageArchive(
    reader.names
      .filter((name) => !deleted.has(name))
      .map((name) => ({ name: name.slice(1), bytes: changes.get(name) ?? reader.get(name) })),
    context,
    { compression: "auto", source }
  );
  if (!validatePresentation(await readPackage(output, context), limits).valid)
    throw new OfficeError(
      "invalid-opc",
      "Removed slides fail graph validation.",
      "validate-result"
    );
  return output;
}

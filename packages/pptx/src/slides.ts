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
  type SelectionQuery,
  type SelectionRecord
} from "./selectors.js";
import { parseXmlPart, type XmlElement } from "./xml.js";
import { validatePresentation } from "./validation.js";

export interface PlaceholderText {
  readonly type: string;
  readonly index?: number;
  readonly text: string;
}
export interface AddSlideOptions {
  readonly layout: string;
  readonly position?: number;
  readonly name?: string;
  readonly hidden?: boolean;
  readonly followMasterBackground?: boolean;
  readonly title?: string;
  readonly body?: string;
  readonly placeholders?: readonly PlaceholderText[];
}
export interface MutateSlidesOptions {
  readonly selection: SelectionQuery | readonly SelectionQuery[];
  readonly position?: number;
  readonly name?: string;
  readonly hidden?: boolean;
  readonly allowEmpty?: boolean;
}
const contentNamespace = "http://schemas.openxmlformats.org/package/2006/content-types";
const packageRelationships = "http://schemas.openxmlformats.org/package/2006/relationships";
const textPlaceholderTypes = ["title", "ctrTitle", "subTitle", "body", "obj"];
const typePrefix = "application/vnd.openxmlformats-officedocument.presentationml.";
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
function invalid(message: string): never {
  throw new OfficeError("invalid-value", message, "usage");
}
function unsupported(message: string): never {
  throw new OfficeError("unsupported-edit", message, "validate-intent");
}
function attr(node: XmlElement, name: string, namespace = ""): string | undefined {
  return node.attributes.find((x) => x.name.namespace === namespace && x.name.localName === name)
    ?.value;
}
function child(
  node: XmlElement | undefined,
  name: string,
  namespace: string
): XmlElement | undefined {
  const matches =
    node?.children.filter((x) => x.name.namespace === namespace && x.name.localName === name) ?? [];
  if (matches.length > 1)
    throw new OfficeError("ambiguous-selection", "Ambiguous presentation structure.", "select");
  return matches[0];
}
function boundedXml(values: Iterable<string>, maximum: number): string {
  const chunks: string[] = [];
  let bytes = 0;
  for (const value of values) {
    bytes += new TextEncoder().encode(value).length;
    if (bytes > maximum)
      throw new OfficeError("resource-limit", "Authored slide XML exceeds limits.", "serialize");
    chunks.push(value);
  }
  return chunks.join("");
}

function fields(value: unknown, allowed: readonly string[]): void {
  if (
    !value ||
    typeof value !== "object" ||
    ![Object.prototype, null].includes(Object.getPrototypeOf(value)) ||
    Object.keys(value).some((key) => !allowed.includes(key))
  )
    invalid("Expected a structured slide insertion object.");
}
function escape(text: string, maximum: number): string {
  if (typeof text !== "string") invalid("Expected text.");
  if (text.length > maximum)
    throw new OfficeError("resource-limit", "Slide text exceeds limits.", "usage");
  let result = "";
  for (const ch of text) {
    const code = ch.codePointAt(0)!;
    if (
      (code < 32 && ![9, 10, 13].includes(code)) ||
      (code >= 0xd800 && code <= 0xdfff) ||
      code === 0xfffe ||
      code === 0xffff
    )
      invalid("Text contains an invalid XML character.");
    result +=
      (
        {
          "&": "&amp;",
          "<": "&lt;",
          ">": "&gt;",
          '"': "&quot;",
          "\r": "&#13;",
          "\n": "&#10;",
          "\t": "&#9;"
        } as Record<string, string>
      )[ch] ?? ch;
    if (result.length > maximum)
      throw new OfficeError("resource-limit", "Slide text exceeds limits.", "usage");
  }
  return result;
}
function relationshipPart(owner: string): string {
  const slash = owner.lastIndexOf("/");
  return `${owner.slice(0, slash)}/_rels/${owner.slice(slash + 1)}.rels`;
}

export async function addSlide(
  input: BinaryInput,
  options: AddSlideOptions,
  context: SelectionContext
): Promise<Uint8Array> {
  fields(options, [
    "layout",
    "position",
    "name",
    "hidden",
    "followMasterBackground",
    "title",
    "body",
    "placeholders"
  ]);
  if (typeof options.layout !== "string" || !options.layout)
    invalid("An explicit layout is required.");
  if (
    options.position !== undefined &&
    (!Number.isSafeInteger(options.position) || options.position < 1)
  )
    invalid("Invalid insertion position.");
  for (const value of [options.hidden, options.followMasterBackground])
    if (value !== undefined && typeof value !== "boolean")
      invalid("Expected a boolean slide setting.");
  for (const value of [options.name, options.title, options.body])
    if (value !== undefined && typeof value !== "string") invalid("Expected slide text.");
  if (options.placeholders !== undefined && !Array.isArray(options.placeholders))
    invalid("Expected placeholder assignments.");
  for (const value of options.placeholders ?? []) {
    fields(value, ["type", "index", "text"]);
    if (
      typeof value.type !== "string" ||
      !value.type ||
      typeof value.text !== "string" ||
      (value.index !== undefined &&
        (!Number.isSafeInteger(value.index) || value.index < 0 || value.index > 4294967295))
    )
      invalid("Invalid placeholder assignment.");
  }
  if (!context?.xmlLimits || !context.relationshipLimits)
    invalid("Explicit XML and relationship limits are required.");
  let textBytes = 0;
  for (const value of [
    options.layout,
    options.name,
    options.title,
    options.body,
    ...(options.placeholders ?? []).map((item) => item.text)
  ]) {
    if (value === undefined) continue;
    textBytes += value.length;
    if (textBytes > context.xmlLimits.maxBytes)
      throw new OfficeError("resource-limit", "Slide text exceeds limits.", "usage");
  }
  if ((options.placeholders?.length ?? 0) > context.xmlLimits.maxNodes)
    throw new OfficeError("resource-limit", "Too many placeholder assignments.", "usage");
  const source = await readBinary(input, context);
  const reader = await readPackage(source, context);
  const validationLimits = {
    ...context.xmlLimits,
    ...context.relationshipLimits,
    maxBytes: Math.min(context.xmlLimits.maxBytes, context.relationshipLimits.maxBytes),
    maxEntries: context.archiveLimits.maxMembers
  };
  const types = parseContentTypes(reader.get("/[Content_Types].xml"), validationLimits);
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
      unsupported("Signed and macro-enabled packages cannot be changed.");
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
  if (!validatePresentation(reader, validationLimits).valid)
    throw new OfficeError(
      "invalid-opc",
      "Slide insertion requires a valid presentation graph.",
      "validate-intent"
    );
  const main = graph
    .outgoing("/")
    .find((edge) => dialects.some((d) => edge.type === `${d.r}/officeDocument`))!.targetPart!;
  let presentation = parseXmlPart(reader.get(main), context.xmlLimits);
  const d = dialects.find((value) => value.p === presentation.root.name.namespace)!;
  const presentationNodes = [presentation.root];
  while (presentationNodes.length) {
    const node = presentationNodes.pop()!;
    if (node.name.namespace === d.p && node.name.localName === "modifyVerifier")
      unsupported("Protected presentations cannot be changed.");
    if (node.name.namespace === "http://schemas.openxmlformats.org/markup-compatibility/2006")
      unsupported("Conditional presentation structure cannot be changed.");
    presentationNodes.push(...node.children);
  }
  const list = child(presentation.root, "sldIdLst", d.p);
  const ids =
    list?.children.filter(
      (node) => node.name.namespace === d.p && node.name.localName === "sldId"
    ) ?? [];
  const position = options.position ?? ids.length + 1;
  if (position > ids.length + 1) invalid("Insertion position is outside the slide list.");
  if (list && ids.length !== list.children.length) unsupported("Unsupported slide-list content.");
  const candidates = graph.parts
    .filter((name) => types.get(name) === `${typePrefix}slideLayout+xml`)
    .filter((name) => {
      if (options.layout.startsWith("/")) return name === options.layout;
      const document = parseXmlPart(reader.get(name), context.xmlLimits);
      return attr(child(document.root, "cSld", d.p) ?? document.root, "name") === options.layout;
    });
  if (candidates.length !== 1)
    throw new OfficeError(
      candidates.length ? "ambiguous-selection" : "missing-selection",
      "Layout must resolve to exactly one existing part.",
      "select"
    );
  const layout = candidates[0]!;
  const layoutDocument = parseXmlPart(reader.get(layout), context.xmlLimits);
  if (layoutDocument.root.name.namespace !== d.p)
    unsupported("Layout dialect must match the presentation.");
  const masters = graph
    .outgoing(layout)
    .filter((edge) => edge.type === `${d.r}/slideMaster` && !edge.external);
  const masterEdges = graph
    .outgoing(main)
    .filter(
      (edge) => edge.type === `${d.r}/slideMaster` && edge.targetPart === masters[0]?.targetPart
    );
  const masterList = child(presentation.root, "sldMasterIdLst", d.p);
  if (
    masters.length !== 1 ||
    masterEdges.length !== 1 ||
    masterList?.children.filter(
      (node) =>
        node.name.namespace === d.p &&
        node.name.localName === "sldMasterId" &&
        attr(node, "id", d.r) === masterEdges[0]!.id
    ).length !== 1
  )
    throw new OfficeError(
      "invalid-opc",
      "Layout must bind one registered master.",
      "validate-intent"
    );
  const tree = child(child(layoutDocument.root, "cSld", d.p)!, "spTree", d.p)!;
  const placeholders: {
    type: string;
    index: number;
    name: string;
    attributes: string;
    text?: string;
  }[] = [];
  const keys = new Set<number>();
  for (const node of tree.children) {
    if (node.name.namespace !== d.p) unsupported("Unsupported layout drawing content.");
    if (node.name.localName !== "sp") {
      if (
        !["nvGrpSpPr", "grpSpPr", "pic", "graphicFrame", "cxnSp", "grpSp"].includes(
          node.name.localName
        )
      )
        unsupported("Unsupported layout drawing content.");
      continue;
    }
    const nv = child(node, "nvSpPr", d.p)!;
    const nvPr = child(nv, "nvPr", d.p)!;
    if (!nv || !nvPr)
      throw new OfficeError(
        "invalid-opc",
        "Layout shape is missing required nonvisual properties.",
        "index"
      );
    const ph = child(nvPr, "ph", d.p);
    if (!ph) continue;
    const type = attr(ph, "type") ?? "obj";
    const rawIndex = attr(ph, "idx") ?? "0";
    if (!rawIndex.trim() || [...rawIndex.trim()].some((ch) => ch < "0" || ch > "9"))
      throw new OfficeError("invalid-opc", "Invalid placeholder index.", "index");
    const index = Number(rawIndex);
    if (!Number.isSafeInteger(index) || index > 4294967295)
      throw new OfficeError("invalid-opc", "Invalid placeholder index.", "index");
    const key = index;
    if (keys.has(key))
      throw new OfficeError("ambiguous-selection", "Duplicate layout placeholder key.", "select");
    keys.add(key);
    if (["dt", "ftr", "sldNum"].includes(type)) continue;
    if (
      ph.attributes.some(
        (attribute) =>
          attribute.name.namespace ||
          !["type", "idx", "sz", "orient", "hasCustomPrompt"].includes(attribute.name.localName)
      )
    )
      unsupported("Unsupported placeholder attributes.");
    placeholders.push({
      type,
      index,
      name: attr(child(nv, "cNvPr", d.p)!, "name") ?? "",
      attributes: ph.attributes
        .map(
          (attribute) =>
            ` ${attribute.name.localName}="${escape(attribute.value, context.xmlLimits.maxBytes)}"`
        )
        .join("")
    });
  }
  const assignments = [
    ...(options.title === undefined ? [] : [{ types: ["title", "ctrTitle"], text: options.title }]),
    ...(options.body === undefined
      ? []
      : [{ types: ["body", "obj", "subTitle"], text: options.body }]),
    ...(options.placeholders ?? []).map((value) => ({
      types: [value.type],
      index: value.index,
      text: value.text
    }))
  ];
  const assigned = new Set<object>();
  for (const assignment of assignments) {
    const matches = placeholders.filter(
      (ph) =>
        assignment.types.includes(ph.type) &&
        (!("index" in assignment) ||
          assignment.index === undefined ||
          ph.index === assignment.index)
    );
    if (matches.length !== 1)
      throw new OfficeError(
        matches.length ? "ambiguous-selection" : "missing-selection",
        "Placeholder must resolve to exactly one type/index match.",
        "select"
      );
    if (assigned.has(matches[0]!))
      throw new OfficeError(
        "ambiguous-selection",
        "Placeholder is assigned more than once.",
        "select"
      );
    if (!textPlaceholderTypes.includes(matches[0]!.type))
      unsupported("Rich-content placeholders cannot be populated as text.");
    assigned.add(matches[0]!);
    matches[0]!.text = assignment.text;
  }
  const maximum = context.xmlLimits.maxBytes;
  const shapeXml = boundedXml(
    (function* () {
      for (const [i, ph] of placeholders.entries()) {
        yield `<p:sp><p:nvSpPr><p:cNvPr id="${i + 2}" name="${escape(ph.name, maximum)}"/><p:cNvSpPr><a:spLocks noGrp="1"/></p:cNvSpPr><p:nvPr><p:ph${ph.attributes}/></p:nvPr></p:nvSpPr><p:spPr/>`;
        if (!textPlaceholderTypes.includes(ph.type)) {
          yield "</p:sp>";
          continue;
        }
        yield "<p:txBody><a:bodyPr/><a:lstStyle/>";
        for (const paragraph of (ph.text ?? "").split("\n")) {
          yield "<a:p>";
          let first = true;
          for (const run of paragraph.split("\v")) {
            if (!first) yield "<a:br/>";
            first = false;
            yield `<a:r><a:t>${escape(run, maximum)}</a:t></a:r>`;
          }
          yield "</a:p>";
        }
        yield "</p:txBody></p:sp>";
      }
    })(),
    maximum
  );
  const slideXml = `<p:sld xmlns:p="${d.p}" xmlns:a="${d.a}" xmlns:r="${d.r}"${options.hidden === undefined ? "" : ` show="${options.hidden ? "0" : "1"}"`}><p:cSld${options.name === undefined ? "" : ` name="${escape(options.name, maximum)}"`}>${options.followMasterBackground === false ? "<p:bg><p:bgPr><a:noFill/><a:effectLst/></p:bgPr></p:bg>" : ""}<p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr/>${shapeXml}</p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sld>`;
  const names = new Set(reader.names.map(asciiKey));
  let number = 1;
  let slide: string;
  do {
    slide = `/ppt/slides/slide${number++}.xml`;
  } while (names.has(asciiKey(slide)) || names.has(asciiKey(relationshipPart(slide))));
  const usedIds = new Set(ids.map((node) => Number(attr(node, "id"))));
  let slideId = 255;
  for (const id of usedIds) slideId = Math.max(slideId, id);
  slideId++;
  if (slideId > 2147483647) {
    slideId = 256;
    while (usedIds.has(slideId)) slideId++;
    if (slideId > 2147483647)
      throw new OfficeError("resource-limit", "Slide IDs exhausted.", "validate-intent");
  }
  const relIds = new Set(graph.outgoing(main).map((edge) => edge.id));
  let relNumber = 1;
  while (relIds.has(`rId${relNumber}`)) relNumber++;
  const relId = `rId${relNumber}`;
  const idXml = `<p:sldId xmlns="" xmlns:p="${d.p}" xmlns:r="${d.r}" id="${slideId}" r:id="${relId}"/>`;
  if (list) presentation = presentation.spliceChildren(list, position - 1, 0, [idXml]);
  else {
    const firstFollowing = presentation.root.children.findIndex(
      (node) =>
        !["sldMasterIdLst", "notesMasterIdLst", "handoutMasterIdLst"].includes(node.name.localName)
    );
    presentation = presentation.spliceChildren(
      presentation.root,
      firstFollowing < 0 ? presentation.root.children.length : firstFollowing,
      0,
      [`<p:sldIdLst xmlns="" xmlns:p="${d.p}">${idXml}</p:sldIdLst>`]
    );
  }
  const mainRels = parseXmlPart(reader.get(relationshipPart(main)), context.xmlLimits);
  const changedRels = mainRels.spliceChildren(mainRels.root, mainRels.root.children.length, 0, [
    `<Relationship xmlns="${packageRelationships}" Id="${relId}" Type="${d.r}/slide" Target="${escape(relativePartReference(slide, main.slice(0, main.lastIndexOf("/"))), maximum)}"/>`
  ]);
  const manifest = parseXmlPart(reader.get("/[Content_Types].xml"), context.xmlLimits);
  const changedManifest = manifest.spliceChildren(manifest.root, manifest.root.children.length, 0, [
    `<Override xmlns="${contentNamespace}" PartName="${slide}" ContentType="${typePrefix}slide+xml"/>`
  ]);
  const changes = new Map<string, Uint8Array>([
    [main, presentation.bytes()],
    [relationshipPart(main), changedRels.bytes()],
    ["/[Content_Types].xml", changedManifest.bytes()],
    [slide, new TextEncoder().encode(slideXml)],
    [
      relationshipPart(slide),
      new TextEncoder().encode(
        `<Relationships xmlns="${packageRelationships}"><Relationship Id="rId1" Type="${d.r}/slideLayout" Target="${escape(relativePartReference(layout, slide.slice(0, slide.lastIndexOf("/"))), maximum)}"/></Relationships>`
      )
    ]
  ]);
  for (const bytes of changes.values()) parseXmlPart(bytes, context.xmlLimits);
  const output = await writePackageArchive(
    [...reader.names, slide, relationshipPart(slide)].map((name) => ({
      name: name.slice(1),
      bytes: changes.get(name) ?? reader.get(name)
    })),
    context,
    { compression: "auto", source }
  );
  if (!validatePresentation(await readPackage(output, context), validationLimits).valid)
    throw new OfficeError(
      "invalid-opc",
      "Inserted slide fails graph validation.",
      "validate-result"
    );
  return output;
}

export async function mutateSlides(
  input: BinaryInput,
  options: MutateSlidesOptions,
  context: SelectionContext
): Promise<Uint8Array> {
  fields(options, ["selection", "position", "name", "hidden", "allowEmpty"]);
  if ([options.position, options.name, options.hidden].every((value) => value === undefined))
    invalid("At least one slide update is required.");
  if (
    options.position !== undefined &&
    (!Number.isSafeInteger(options.position) || options.position < 1)
  )
    invalid("Invalid final slide position.");
  if (options.name !== undefined && typeof options.name !== "string")
    invalid("Expected a slide label.");
  for (const value of [options.hidden, options.allowEmpty])
    if (value !== undefined && typeof value !== "boolean")
      invalid("Expected a boolean slide setting.");
  if (!context?.xmlLimits || !context.relationshipLimits)
    invalid("Explicit XML and relationship limits are required.");
  if (options.name !== undefined) escape(options.name, context.xmlLimits.maxBytes);
  const queries: readonly SelectionQuery[] = Array.isArray(options.selection)
    ? options.selection
    : [options.selection as SelectionQuery];
  if (!queries.length) throw new SelectionError("invalid-selection");
  if (queries.length > context.relationshipLimits.maxParts)
    throw new OfficeError("resource-limit", "Too many slide selections.", "usage");
  for (const query of queries)
    if (
      !query ||
      typeof query !== "object" ||
      (query.kind !== undefined && query.kind !== "slide") ||
      (query.scope !== undefined && query.scope !== "slides") ||
      (!query.all &&
        query.token === undefined &&
        query.id === undefined &&
        query.name === undefined &&
        query.position === undefined)
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
    context.signal?.throwIfAborted();
    if (name === "/[Content_Types].xml") continue;
    const type = types.get(name).toLowerCase();
    if (
      type.includes("digital-signature") ||
      type.includes("macroenabled") ||
      type.includes("vbaproject") ||
      asciiKey(name).startsWith("/_xmlsignatures/")
    )
      unsupported("Signed and macro-enabled packages cannot be changed.");
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
  if (!validatePresentation(reader, limits).valid)
    throw new OfficeError(
      "invalid-opc",
      "Slide editing requires a valid presentation graph.",
      "validate-intent"
    );
  const index = await readSelectionIndex(source, context);
  const selected: SelectionRecord[] = [];
  const identities = new Set<string>();
  for (const query of queries) {
    let records: readonly SelectionRecord[];
    try {
      records = index.select(query);
    } catch (error) {
      if (
        error instanceof SelectionError &&
        error.code === "missing-selection" &&
        options.allowEmpty
      )
        continue;
      throw error;
    }
    for (const record of records) {
      if (record.kind !== "slide" || identities.has(record.id))
        throw new SelectionError("invalid-selection");
      identities.add(record.id);
      selected.push(record);
    }
  }
  if (
    options.position !== undefined &&
    options.position > index.slides.length - selected.length + 1
  )
    invalid("Final position is outside the remaining slide list.");
  const main = graph
    .outgoing("/")
    .find((edge) => dialects.some((d) => edge.type === `${d.r}/officeDocument`))!.targetPart!;
  let presentation = parseXmlPart(reader.get(main), context.xmlLimits);
  const d = dialects.find((value) => value.p === presentation.root.name.namespace)!;
  const pending = [presentation.root];
  while (pending.length) {
    const node = pending.pop()!;
    if (node.name.namespace === d.p && node.name.localName === "modifyVerifier")
      unsupported("Protected presentations cannot be changed.");
    if (node.name.namespace === "http://schemas.openxmlformats.org/markup-compatibility/2006")
      unsupported("Conditional presentation structure cannot be changed.");
    pending.push(...node.children);
  }
  const changes = new Map<string, Uint8Array>();
  if (selected.length && options.position !== undefined) {
    const list = child(presentation.root, "sldIdLst", d.p)!;
    if (
      list.children.some((node) => node.name.namespace !== d.p || node.name.localName !== "sldId")
    )
      unsupported("Unsupported slide-list content.");
    const ordered = index.slides.filter((slide) => !identities.has(slide.id));
    ordered.splice(options.position - 1, 0, ...selected);
    if (ordered.some((slide, i) => slide.id !== index.slides[i]!.id)) {
      const ids = new Map(index.slides.map((slide, i) => [slide.id, list.children[i]!]));
      presentation = presentation.reorderChildren(
        list,
        ordered.map((slide) => ids.get(slide.id)!)
      );
      changes.set(main, presentation.bytes());
    }
  }
  for (const selectedSlide of selected) {
    context.signal?.throwIfAborted();
    let document = parseXmlPart(reader.get(selectedSlide.part), context.xmlLimits);
    let changed = false;
    if (options.name !== undefined) {
      const common = child(document.root, "cSld", d.p);
      if (!common) unsupported("Conditional slide labels cannot be changed.");
      if ((attr(common, "name") ?? "") !== options.name) {
        document = document.merge(common, {
          attributes: [{ namespace: "", localName: "name", value: options.name || null }]
        });
        changed = true;
      }
    }
    if (options.hidden !== undefined) {
      const show = attr(document.root, "show")?.trim();
      if (show !== undefined && !["0", "1", "true", "false"].includes(show))
        throw new OfficeError("invalid-opc", "Invalid slide visibility.", "validate-intent");
      if ((show === "0" || show === "false") !== options.hidden) {
        document = document.merge(document.root, {
          attributes: [{ namespace: "", localName: "show", value: options.hidden ? "0" : "1" }]
        });
        changed = true;
      }
    }
    if (changed) changes.set(selectedSlide.part, document.bytes());
  }
  if (!changes.size) return source;
  const output = await writePackageArchive(
    reader.names.map((name) => ({
      name: name.slice(1),
      bytes: changes.get(name) ?? reader.get(name)
    })),
    context,
    { compression: "auto", source }
  );
  if (!validatePresentation(await readPackage(output, context), limits).valid)
    throw new OfficeError(
      "invalid-opc",
      "Changed slides fail graph validation.",
      "validate-result"
    );
  return output;
}

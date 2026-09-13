import { readBinary } from "./bytes.js";
import type { BinaryInput } from "./contracts.js";
import type { PresentationTextShape } from "./creation.js";
import { OfficeError } from "./errors.js";
import { readPackage } from "./package-reader.js";
import { writePackageArchive } from "./package-writer.js";
import { relativePartReference } from "./package-uri.js";
import { readSelectionIndex, type SelectionContext } from "./selectors.js";
import { parseXmlPart, type XmlElement, type XmlPart } from "./xml.js";
import { validatePresentation } from "./validation.js";

export interface MasterRecord {
  readonly part: string;
  readonly name: string;
  readonly layouts: readonly string[];
  readonly affectedSlides: readonly number[];
}
export interface SharedEditResult {
  readonly bytes: Uint8Array;
  readonly part: string;
  readonly affectedSlides: readonly number[];
}
export interface MasterBackground {
  readonly color: string;
}
export interface AddMasterOptions {
  readonly scope: "masters" | "shared";
  readonly name: string;
  readonly theme?: string;
  readonly text?: string;
  readonly shapes?: readonly PresentationTextShape[];
  readonly background?: MasterBackground | null;
}
export interface MutateMasterOptions {
  readonly scope: "masters" | "shared";
  readonly master: string;
  readonly name?: string;
  readonly shape?: string;
  readonly shapeId?: string;
  readonly text?: string;
  readonly shapes?: readonly PresentationTextShape[];
  readonly background?: MasterBackground | null;
}
export interface AssociateLayoutOptions {
  readonly scope: "layouts" | "shared";
  readonly layout: string;
  readonly master: string;
}
const relns = "http://schemas.openxmlformats.org/package/2006/relationships";
function invalid(message: string): never {
  throw new OfficeError("invalid-value", message, "usage");
}
function attr(node: XmlElement, name: string) {
  return node.attributes.find((x) => x.name.localName === name && x.name.namespace === "")?.value;
}
function child(node: XmlElement, name: string, ns = node.name.namespace) {
  const found = node.children.filter((x) => x.name.localName === name && x.name.namespace === ns);
  if (found.length > 1) invalid("Ambiguous shared structure.");
  return found[0];
}
function required(node: XmlElement, name: string) {
  const found = child(node, name);
  if (!found)
    throw new OfficeError("unsupported-edit", "Unsupported shared structure.", "validate-intent");
  return found;
}
function fields(value: unknown, allowed: readonly string[], scopes: readonly string[]): void {
  if (
    !value ||
    typeof value !== "object" ||
    ![Object.prototype, null].includes(Object.getPrototypeOf(value)) ||
    Object.keys(value).some((x) => !allowed.includes(x)) ||
    !scopes.includes((value as { scope: string }).scope)
  )
    invalid("Explicit shared resource scope and valid options are required.");
}
function escape(value: string) {
  if (typeof value !== "string") invalid("Expected text.");
  return value
    .split("&")
    .join("&amp;")
    .split("<")
    .join("&lt;")
    .split(">")
    .join("&gt;")
    .split('"')
    .join("&quot;")
    .split("\r")
    .join("&#13;")
    .split("\n")
    .join("&#10;")
    .split("\t")
    .join("&#9;");
}
function relPart(part: string) {
  const i = part.lastIndexOf("/");
  return `${part.slice(0, i)}/_rels/${part.slice(i + 1)}.rels`;
}
function unique<T>(items: readonly T[], message: string): T {
  if (items.length !== 1)
    throw new OfficeError(
      items.length ? "ambiguous-selection" : "missing-selection",
      message,
      "select"
    );
  return items[0]!;
}
async function load(input: BinaryInput, context: SelectionContext, mutation = true) {
  const source = await readBinary(input, context);
  const reader = await readPackage(source, context);
  const index = await readSelectionIndex(source, context);
  const limits = {
    ...context.xmlLimits,
    ...context.relationshipLimits,
    maxBytes: Math.min(context.xmlLimits.maxBytes, context.relationshipLimits.maxBytes),
    maxEntries: context.archiveLimits.maxMembers
  };
  if (!validatePresentation(reader, limits).valid)
    throw new OfficeError("invalid-opc", "Invalid presentation graph.", "validate-intent");
  const main = unique(
    index.inventory.relationships.filter(
      (x) => x.owner === "/" && x.type.endsWith("/officeDocument") && !x.external
    ),
    "Expected presentation."
  ).targetPart!;
  const presentation = parseXmlPart(reader.get(main), context.xmlLimits);
  const p = presentation.root.name.namespace;
  const strict = p === "http://purl.oclc.org/ooxml/presentationml/main";
  const a = strict
    ? "http://purl.oclc.org/ooxml/drawingml/main"
    : "http://schemas.openxmlformats.org/drawingml/2006/main";
  const r = strict
    ? "http://purl.oclc.org/ooxml/officeDocument/relationships"
    : "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
  for (const edge of mutation ? index.inventory.relationships : [])
    if (edge.type.includes("/digital-signature/") || edge.type.endsWith("/vbaProject"))
      throw new OfficeError(
        "unsupported-edit",
        "Signed or macro packages cannot be edited.",
        "validate-intent"
      );
  const pending = mutation ? [presentation.root] : [];
  while (pending.length) {
    const n = pending.pop()!;
    if (n.name.localName === "modifyVerifier" && n.name.namespace === p)
      throw new OfficeError("unsupported-edit", "Protected presentation.", "validate-intent");
    pending.push(...n.children);
  }
  const changes = new Map<string, Uint8Array>();
  const doc = (part: string) =>
    parseXmlPart(changes.get(part) ?? reader.get(part), context.xmlLimits);
  const save = (part: string, xml: XmlPart) => changes.set(part, xml.bytes());
  const affected = (part: string) =>
    index.inventory.slides
      .filter((x) => x.master === part || x.layout === part)
      .map((x) => x.position);
  async function finish(
    part: string,
    affectedSlides: readonly number[]
  ): Promise<SharedEditResult> {
    const names = new Set([...reader.names, ...changes.keys()]);
    const bytes = await writePackageArchive(
      [...names].map((name) => ({
        name: name.slice(1),
        bytes: changes.get(name) ?? reader.get(name)
      })),
      context,
      { compression: "auto", source }
    );
    if (!validatePresentation(await readPackage(bytes, context), limits).valid)
      throw new OfficeError(
        "invalid-opc",
        "Shared edit failed graph validation.",
        "validate-result"
      );
    return { bytes, part, affectedSlides };
  }
  return { source, reader, index, main, p, a, r, doc, save, changes, affected, finish };
}
export async function readMasters(
  input: BinaryInput,
  context: SelectionContext
): Promise<readonly MasterRecord[]> {
  const s = await load(input, context, false);
  return s.index.inventory.masters.map((part) => ({
    part,
    name: attr(required(s.doc(part).root, "cSld"), "name") ?? "",
    layouts: s.index.inventory.relationships
      .filter((x) => x.owner === part && x.type.endsWith("/slideLayout") && !x.external)
      .map((x) => x.targetPart!),
    affectedSlides: s.affected(part)
  }));
}
function masterPart(s: Awaited<ReturnType<typeof load>>, selector: string) {
  if (s.index.inventory.masters.includes(selector)) return selector;
  return unique(
    s.index.inventory.masters.filter(
      (part) =>
        part === selector || (attr(required(s.doc(part).root, "cSld"), "name") ?? "") === selector
    ),
    "Select one master."
  );
}

function nextRel(xml: XmlPart) {
  let i = 1;
  const ids = xml.root.children.map((x) => attr(x, "Id"));
  while (ids.includes(`rId${i}`)) i++;
  return `rId${i}`;
}
function editContent(
  xml: XmlPart,
  options: Pick<
    MutateMasterOptions,
    "name" | "shape" | "shapeId" | "text" | "shapes" | "background"
  >,
  p: string,
  a: string,
  maximum: number,
  maximumNodes: number
): XmlPart {
  if (options.shapes !== undefined && !Array.isArray(options.shapes))
    invalid("Expected shapes array.");
  if ((options.shapes?.length ?? 0) > maximumNodes)
    throw new OfficeError("resource-limit", "Shape collection exceeds XML node limits.", "usage");
  for (const shape of options.shapes ?? [])
    if (!shape || typeof shape !== "object") invalid("Invalid text shape.");
  const texts = [
    options.name,
    options.text,
    ...(options.shapes ?? []).flatMap((shape) => [shape.name, shape.text])
  ];
  let size = 0;
  for (const text of texts)
    if (text !== undefined) {
      if (typeof text !== "string") invalid("Expected text.");
      size += text.length;
      if (size > maximum)
        throw new OfficeError("resource-limit", "Authored text exceeds XML limits.", "usage");
    }
  if (options.name !== undefined)
    xml = xml.merge(required(xml.root, "cSld"), {
      attributes: [{ namespace: "", localName: "name", value: options.name }]
    });
  if (options.background !== undefined) {
    const common = required(xml.root, "cSld"),
      bg = child(common, "bg");
    if (
      options.background !== null &&
      (!options.background ||
        Object.keys(options.background).some((x) => x !== "color") ||
        typeof options.background.color !== "string" ||
        options.background.color.length !== 6 ||
        [...options.background.color].some((x) => !"0123456789abcdefABCDEF".includes(x)))
    )
      invalid("Background color must contain six hexadecimal digits.");
    const properties = bg && child(bg, "bgPr");
    if (options.background === null) {
      if (bg) xml = xml.spliceChildren(common, common.children.indexOf(bg), 1, []);
    } else if (properties) {
      const fills = properties.children.filter(
        (n) =>
          n.name.namespace === a &&
          ["noFill", "solidFill", "gradFill", "blipFill", "pattFill", "grpFill"].includes(
            n.name.localName
          )
      );
      if (fills.length > 1) invalid("Ambiguous background fill.");
      xml = xml.spliceChildren(
        properties,
        fills[0] ? properties.children.indexOf(fills[0]) : 0,
        fills.length,
        [`<a:solidFill xmlns:a="${a}"><a:srgbClr val="${options.background.color}"/></a:solidFill>`]
      );
    } else if (bg) {
      const reference = child(bg, "bgRef");
      xml = xml.spliceChildren(
        bg,
        reference ? bg.children.indexOf(reference) : 0,
        reference ? 1 : 0,
        [
          `<p:bgPr xmlns:p="${p}" xmlns:a="${a}"><a:solidFill><a:srgbClr val="${options.background.color}"/></a:solidFill><a:effectLst/></p:bgPr>`
        ]
      );
    } else {
      xml = xml.spliceChildren(common, 0, 0, [
        `<p:bg xmlns:p="${p}" xmlns:a="${a}"><p:bgPr><a:solidFill><a:srgbClr val="${options.background.color}"/></a:solidFill><a:effectLst/></p:bgPr></p:bg>`
      ]);
    }
  }
  if (options.text !== undefined) {
    if (
      (!options.shape && !options.shapeId) ||
      (options.shape !== undefined && options.shapeId !== undefined)
    )
      invalid("Master text requires exactly one selected text shape.");
    const tree = required(required(xml.root, "cSld"), "spTree");
    const shape = unique(
      tree.children.filter((n) => {
        if (n.name.localName !== "sp" || n.name.namespace !== p) return false;
        const props = child(n, "nvSpPr");
        const id = props && child(props, "cNvPr");
        return (
          id &&
          (options.shapeId !== undefined
            ? attr(id, "id") === options.shapeId
            : attr(id, "name") === options.shape)
        );
      }),
      "Select one master text shape."
    );
    const body = required(shape, "txBody");
    if (
      body.children.some(
        (n) => n.name.namespace !== a || !["bodyPr", "lstStyle", "p"].includes(n.name.localName)
      )
    )
      throw new OfficeError("unsupported-edit", "Unsupported text body.", "validate-intent");
    const start = body.children.findIndex((n) => n.name.localName === "p");
    xml = xml.spliceChildren(
      body,
      start < 0 ? body.children.length : start,
      start < 0 ? 0 : body.children.length - start,
      paragraphs(options.text, a)
    );
  }
  if (options.shapes !== undefined) {
    if (!Array.isArray(options.shapes)) invalid("Expected shapes array.");
    for (const shape of options.shapes) {
      if (
        !shape ||
        Object.keys(shape).some((x) => !["name", "x", "y", "width", "height", "text"].includes(x))
      )
        invalid("Invalid text shape.");
      for (const key of ["x", "y", "width", "height"] as const)
        if (
          !Number.isSafeInteger(shape[key]) ||
          Math.abs(shape[key]) > 27273042316900 ||
          (["width", "height"].includes(key) && shape[key] <= 0)
        )
          invalid("Invalid shape geometry.");
      const tree = required(required(xml.root, "cSld"), "spTree");
      const ids: number[] = [];
      const pending = [tree];
      while (pending.length) {
        const node = pending.pop()!;
        if (node.name.namespace === p && node.name.localName === "cNvPr")
          ids.push(Number(attr(node, "id")));
        pending.push(...node.children);
      }
      const id = ids.reduce((maximum, id) => Math.max(maximum, id), 0) + 1;
      if (id > 4294967295) invalid("No shape identity available.");
      xml = xml.spliceChildren(tree, tree.children.length, 0, [
        `<p:sp xmlns:p="${p}" xmlns:a="${a}"><p:nvSpPr><p:cNvPr id="${id}" name="${escape(shape.name ?? "")}"/><p:cNvSpPr txBox="1"/><p:nvPr/></p:nvSpPr><p:spPr><a:xfrm><a:off x="${shape.x}" y="${shape.y}"/><a:ext cx="${shape.width}" cy="${shape.height}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom><a:noFill/></p:spPr><p:txBody><a:bodyPr/><a:lstStyle/>${paragraphs(shape.text, a).join("")}</p:txBody></p:sp>`
      ]);
    }
  }
  return xml;
}
function paragraphs(text: string, a: string) {
  if (typeof text !== "string") invalid("Expected text.");
  return text.split("\n").map(
    (line) =>
      `<a:p xmlns:a="${a}">${line
        .split("\v")
        .map((t) => `<a:r><a:t>${escape(t)}</a:t></a:r>`)
        .join("<a:br/>")}<a:endParaRPr/></a:p>`
  );
}
export async function mutateMaster(
  input: BinaryInput,
  options: MutateMasterOptions,
  context: SelectionContext
): Promise<SharedEditResult> {
  fields(
    options,
    ["scope", "master", "name", "shape", "shapeId", "text", "shapes", "background"],
    ["masters", "shared"]
  );
  const s = await load(input, context),
    part = masterPart(s, options.master);
  s.save(
    part,
    editContent(
      s.doc(part),
      options,
      s.p,
      s.a,
      context.xmlLimits.maxBytes,
      context.xmlLimits.maxNodes
    )
  );
  return s.finish(part, s.affected(part));
}
export async function addMaster(
  input: BinaryInput,
  options: AddMasterOptions,
  context: SelectionContext
): Promise<SharedEditResult> {
  fields(
    options,
    ["scope", "name", "theme", "text", "shapes", "background"],
    ["masters", "shared"]
  );
  if (typeof options.name !== "string" || !options.name) invalid("Master name is required.");
  if (options.name.length > context.xmlLimits.maxBytes)
    throw new OfficeError("resource-limit", "Master name exceeds XML limits.", "usage");
  if (options.shapes !== undefined && !Array.isArray(options.shapes))
    invalid("Expected shapes array.");
  if (
    (options.shapes?.length ?? 0) + (options.text === undefined ? 0 : 1) >
    context.xmlLimits.maxNodes
  )
    throw new OfficeError("resource-limit", "Shape collection exceeds XML node limits.", "usage");
  const s = await load(input, context);
  const theme = unique(
    s.index.inventory.themes.filter((x) => options.theme === undefined || x === options.theme),
    "Select one theme."
  );
  let i = 1;
  while (
    s.reader.names.some((x) =>
      [
        `/ppt/slidemasters/slidemaster${i}.xml`,
        `/ppt/slidemasters/_rels/slidemaster${i}.xml.rels`
      ].includes(x.toLowerCase())
    )
  )
    i++;
  const part = `/ppt/slideMasters/slideMaster${i}.xml`;
  let xml = parseXmlPart(
    new TextEncoder().encode(
      `<p:sldMaster xmlns:p="${s.p}" xmlns:a="${s.a}" xmlns:r="${s.r}"><p:cSld name="${escape(options.name)}"><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr/></p:spTree></p:cSld><p:clrMap bg1="lt1" tx1="dk1" bg2="lt2" tx2="dk2" accent1="accent1" accent2="accent2" accent3="accent3" accent4="accent4" accent5="accent5" accent6="accent6" hlink="hlink" folHlink="folHlink"/><p:txStyles><p:titleStyle/><p:bodyStyle/><p:otherStyle/></p:txStyles></p:sldMaster>`
    ),
    context.xmlLimits
  );
  const shapes = [
    ...(options.shapes ?? []),
    ...(options.text === undefined
      ? []
      : [{ name: "Text", x: 0, y: 0, width: 914400, height: 914400, text: options.text }])
  ];
  xml = editContent(
    xml,
    { shapes, ...(options.background === undefined ? {} : { background: options.background }) },
    s.p,
    s.a,
    context.xmlLimits.maxBytes,
    context.xmlLimits.maxNodes
  );
  s.save(part, xml);
  s.changes.set(
    relPart(part),
    new TextEncoder().encode(
      `<Relationships xmlns="${relns}"><Relationship Id="rId1" Type="${s.r}/theme" Target="${escape(relativePartReference(theme, part.slice(0, part.lastIndexOf("/"))))}"/></Relationships>`
    )
  );
  const relations = s.doc(relPart(s.main)),
    rid = nextRel(relations);
  s.save(
    relPart(s.main),
    relations.spliceChildren(relations.root, relations.root.children.length, 0, [
      `<Relationship xmlns="${relns}" Id="${rid}" Type="${s.r}/slideMaster" Target="${escape(relativePartReference(part, s.main.slice(0, s.main.lastIndexOf("/"))))}"/>`
    ])
  );
  let pres = s.doc(s.main);
  if (!child(pres.root, "sldMasterIdLst"))
    pres = pres.spliceChildren(pres.root, 0, 0, [`<p:sldMasterIdLst xmlns:p="${s.p}"/>`]);
  const list = required(pres.root, "sldMasterIdLst"),
    id =
      list.children.reduce((maximum, x) => Math.max(maximum, Number(attr(x, "id"))), 2147483647) +
      1;
  if (id > 4294967295) invalid("No master identity available.");
  s.save(
    s.main,
    pres.spliceChildren(list, list.children.length, 0, [
      `<p:sldMasterId xmlns:p="${s.p}" xmlns:r="${s.r}" id="${id}" r:id="${rid}"/>`
    ])
  );
  const types = s.doc("/[Content_Types].xml");
  s.save(
    "/[Content_Types].xml",
    types.spliceChildren(types.root, types.root.children.length, 0, [
      `<Override xmlns="${types.root.name.namespace}" PartName="${part}" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideMaster+xml"/>`
    ])
  );
  return s.finish(part, []);
}
export async function associateLayout(
  input: BinaryInput,
  options: AssociateLayoutOptions,
  context: SelectionContext
): Promise<SharedEditResult> {
  fields(options, ["scope", "layout", "master"], ["layouts", "shared"]);
  const s = await load(input, context),
    master = masterPart(s, options.master);
  const layout = unique(
    s.index.inventory.layouts.filter((x) =>
      s.index.inventory.layouts.includes(options.layout)
        ? x === options.layout
        : (attr(required(s.doc(x).root, "cSld"), "name") ?? "") === options.layout
    ),
    "Select one layout."
  );
  const backlinks = s.index.inventory.relationships.filter(
    (x) => x.owner === layout && x.type === `${s.r}/slideMaster` && !x.external
  );
  if (backlinks.length > 1) invalid("Layout has ambiguous master associations.");
  if (backlinks[0]?.targetPart === master)
    return { bytes: s.source, part: layout, affectedSlides: [] };
  let retainedId: number | undefined;
  for (const old of s.index.inventory.masters) {
    const edges = s.index.inventory.relationships.filter(
      (x) => x.owner === old && x.targetPart === layout && x.type === `${s.r}/slideLayout`
    );
    for (const edge of edges) {
      let xml = s.doc(old);
      const list = child(xml.root, "sldLayoutIdLst");
      if (list) {
        const node = list.children.find((x) =>
          x.attributes.some(
            (a) => a.name.namespace === s.r && a.name.localName === "id" && a.value === edge.id
          )
        );
        if (node) {
          retainedId = Number(attr(node, "id"));
          xml = xml.spliceChildren(list, list.children.indexOf(node), 1, []);
          s.save(old, xml);
        }
      }
      const rel = s.doc(relPart(old));
      const node = rel.root.children.find((x) => attr(x, "Id") === edge.id)!;
      s.save(relPart(old), rel.spliceChildren(rel.root, rel.root.children.indexOf(node), 1, []));
    }
  }
  const layoutRels = s.doc(relPart(layout));
  const old = backlinks[0];
  if (old) {
    const node = layoutRels.root.children.find((x) => attr(x, "Id") === old.id)!;
    s.save(
      relPart(layout),
      layoutRels.merge(node, {
        attributes: [
          {
            namespace: "",
            localName: "Target",
            value: relativePartReference(master, layout.slice(0, layout.lastIndexOf("/")))
          }
        ]
      })
    );
  } else
    s.save(
      relPart(layout),
      layoutRels.spliceChildren(layoutRels.root, layoutRels.root.children.length, 0, [
        `<Relationship xmlns="${relns}" Id="${nextRel(layoutRels)}" Type="${s.r}/slideMaster" Target="${escape(relativePartReference(master, layout.slice(0, layout.lastIndexOf("/"))))}"/>`
      ])
    );
  const rel = s.doc(relPart(master)),
    rid = nextRel(rel);
  s.save(
    relPart(master),
    rel.spliceChildren(rel.root, rel.root.children.length, 0, [
      `<Relationship xmlns="${relns}" Id="${rid}" Type="${s.r}/slideLayout" Target="${escape(relativePartReference(layout, master.slice(0, master.lastIndexOf("/"))))}"/>`
    ])
  );
  let xml = s.doc(master);
  if (!child(xml.root, "sldLayoutIdLst")) {
    const map = required(xml.root, "clrMap");
    xml = xml.spliceChildren(xml.root, xml.root.children.indexOf(map) + 1, 0, [
      `<p:sldLayoutIdLst xmlns:p="${s.p}"/>`
    ]);
  }
  const list = required(xml.root, "sldLayoutIdLst"),
    id =
      retainedId ??
      list.children.reduce((maximum, x) => Math.max(maximum, Number(attr(x, "id"))), 2147483648) +
        1;
  if (id > 4294967295) invalid("No layout identity available.");
  s.save(
    master,
    xml.spliceChildren(list, list.children.length, 0, [
      `<p:sldLayoutId xmlns:p="${s.p}" xmlns:r="${s.r}" id="${id}" r:id="${rid}"/>`
    ])
  );
  return s.finish(layout, s.affected(layout));
}

export interface MutateMasterShapeOptions {
  readonly scope: "masters" | "shared";
  readonly master: string;
  readonly shape?: string;
  readonly shapeId?: string;
  readonly name?: string;
  readonly text?: string;
  readonly x?: number;
  readonly y?: number;
  readonly width?: number;
  readonly height?: number;
}
export async function mutateMasterShape(
  input: BinaryInput,
  options: MutateMasterShapeOptions,
  context: SelectionContext
): Promise<SharedEditResult> {
  fields(
    options,
    ["scope", "master", "shape", "shapeId", "name", "text", "x", "y", "width", "height"],
    ["masters", "shared"]
  );
  if (
    (!options.shape && !options.shapeId) ||
    (options.shape !== undefined && options.shapeId !== undefined)
  )
    invalid("Exactly one shape name or identity is required.");
  for (const key of ["x", "y", "width", "height"] as const) {
    const value = options[key];
    if (
      value !== undefined &&
      (!Number.isSafeInteger(value) ||
        Math.abs(value) > 27273042316900 ||
        (["width", "height"].includes(key) && value <= 0))
    )
      invalid("Invalid shape geometry.");
  }
  const s = await load(input, context),
    part = masterPart(s, options.master);
  let xml = s.doc(part);
  function selected() {
    const tree = required(required(xml.root, "cSld"), "spTree");
    return unique(
      tree.children.filter((n) => {
        const props = child(n, "nvSpPr");
        const id = props && child(props, "cNvPr");
        return (
          n.name.namespace === s.p &&
          n.name.localName === "sp" &&
          id &&
          (options.shapeId !== undefined
            ? attr(id, "id") === options.shapeId
            : attr(id, "name") === options.shape)
        );
      }),
      "Select one master shape."
    );
  }
  const shape = selected(),
    id = attr(required(required(shape, "nvSpPr"), "cNvPr"), "id")!;
  const properties = required(shape, "spPr");
  const geom = child(properties, "prstGeom", s.a);
  if (!geom || attr(geom, "prst") !== "rect" || child(properties, "custGeom", s.a))
    throw new OfficeError(
      "unsupported-edit",
      "Only rectangular text shapes support this edit.",
      "validate-intent"
    );
  if (options.text !== undefined)
    xml = editContent(
      xml,
      { shapeId: id, text: options.text },
      s.p,
      s.a,
      context.xmlLimits.maxBytes,
      context.xmlLimits.maxNodes
    );
  if (options.name !== undefined) {
    const node = required(required(selected(), "nvSpPr"), "cNvPr");
    xml = xml.merge(node, {
      attributes: [{ namespace: "", localName: "name", value: options.name }]
    });
  }
  const tree = required(required(xml.root, "cSld"), "spTree");
  const current = tree.children.find((n) => {
    const props = child(n, "nvSpPr");
    const identity = props && child(props, "cNvPr");
    return identity && attr(identity, "id") === id;
  })!;
  const spPr = required(current, "spPr");
  if ([options.x, options.y, options.width, options.height].some((x) => x !== undefined)) {
    const transform = child(spPr, "xfrm", s.a);
    if (!transform)
      throw new OfficeError(
        "unsupported-edit",
        "Shape has no explicit transform.",
        "validate-intent"
      );
    if (
      transform.attributes.some(
        (x) => !["rot", "flipH", "flipV"].includes(x.name.localName) || x.name.namespace !== ""
      ) ||
      transform.children.some(
        (x) => x.name.namespace !== s.a || !["off", "ext"].includes(x.name.localName)
      )
    )
      throw new OfficeError("unsupported-edit", "Unsupported shape transform.", "validate-intent");
    xml = xml.merge(transform, {
      children: {
        sequence: [
          { namespace: s.a, localName: "off" },
          { namespace: s.a, localName: "ext" }
        ],
        upsert: [
          {
            name: { namespace: s.a, localName: "off" },
            merge: {
              attributes: (
                [
                  ["x", options.x],
                  ["y", options.y]
                ] as const
              )
                .filter((pair) => pair[1] !== undefined)
                .map(([localName, value]) => ({ namespace: "", localName, value: String(value) }))
            }
          },
          {
            name: { namespace: s.a, localName: "ext" },
            merge: {
              attributes: (
                [
                  ["cx", options.width],
                  ["cy", options.height]
                ] as const
              )
                .filter((pair) => pair[1] !== undefined)
                .map(([localName, value]) => ({ namespace: "", localName, value: String(value) }))
            }
          }
        ]
      }
    });
  }
  s.save(part, xml);
  return s.finish(part, s.affected(part));
}

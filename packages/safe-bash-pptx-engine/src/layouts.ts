import type { BinaryInput } from "./contracts.js";
import { OfficeError } from "./errors.js";
import {
  loadShared,
  invalid,
  attr,
  child,
  required,
  fields,
  escape,
  relPart,
  unique,
  masterPart,
  nextRel,
  editContent,
  associateLayout,
  type SharedEditResult
} from "./masters.js";
import { relativePartReference } from "./package-uri.js";
import { SelectionError, type SelectionContext, type SelectionQuery } from "./selectors.js";
import { parseXmlPart, type XmlElement, type XmlPart } from "./xml.js";
export interface LayoutPlaceholder {
  readonly type?: string;
  readonly index?: number;
  readonly name?: string;
  readonly text?: string;
  readonly x?: number;
  readonly y?: number;
  readonly width?: number;
  readonly height?: number;
}
export interface LayoutPlaceholderRecord {
  readonly shapeId: string;
  readonly type: string;
  readonly index: number;
  readonly name: string;
  readonly x: number | null;
  readonly y: number | null;
  readonly width: number | null;
  readonly height: number | null;
  readonly provenance: Readonly<Record<"x" | "y" | "width" | "height", "layout" | "master" | null>>;
}
export interface LayoutRecord {
  readonly part: string;
  readonly id: string;
  readonly master: string;
  readonly name: string;
  readonly type: string;
  readonly preserve: boolean;
  readonly showMasterShapes: boolean;
  readonly matchingName: string;
  readonly placeholders: readonly LayoutPlaceholderRecord[];
  readonly affectedSlides: readonly number[];
}
interface LayoutProperties {
  readonly name?: string;
  readonly type?: string;
  readonly preserve?: boolean;
  readonly showMasterShapes?: boolean;
  readonly matchingName?: string;
}
export interface AddLayoutOptions extends LayoutProperties {
  readonly scope: "layouts" | "shared";
  readonly master: string;
  readonly name: string;
  readonly text?: string;
  readonly placeholders?: readonly LayoutPlaceholder[];
}
export interface MutateLayoutOptions extends LayoutProperties {
  readonly scope: "layouts" | "shared";
  readonly layout: string;
  readonly master?: string;
  readonly shape?: string;
  readonly shapeId?: string;
  readonly text?: string;
}
export interface RemoveLayoutOptions {
  readonly scope: "layouts" | "shared";
  readonly layout: string;
}
export interface ApplyLayoutOptions {
  readonly selection: SelectionQuery | readonly SelectionQuery[];
  readonly layout: string;
  readonly placeholderPolicy: "type-index" | "reject-unmatched";
  readonly allowEmpty?: boolean;
}
const relationships = "http://schemas.openxmlformats.org/package/2006/relationships";
const types = [
  "title",
  "tx",
  "twoColTx",
  "tbl",
  "txAndChart",
  "chartAndTx",
  "dgm",
  "chart",
  "txAndClipArt",
  "clipArtAndTx",
  "titleOnly",
  "blank",
  "txAndObj",
  "objAndTx",
  "objOnly",
  "obj",
  "txAndMedia",
  "mediaAndTx",
  "objOverTx",
  "txOverObj",
  "txAndTwoObj",
  "twoObjAndTx",
  "twoObjOverTx",
  "fourObj",
  "vertTx",
  "clipArtAndVertTx",
  "vertTitleAndTx",
  "vertTitleAndTxOverChart",
  "twoObj",
  "objAndTwoObj",
  "twoObjAndObj",
  "cust",
  "secHead",
  "twoTxTwoObj",
  "objTx"
];
const placeholderTypes = [
  "title",
  "body",
  "ctrTitle",
  "subTitle",
  "dt",
  "sldNum",
  "ftr",
  "hdr",
  "obj",
  "chart",
  "tbl",
  "clipArt",
  "dgm",
  "media",
  "sldImg",
  "pic"
];
function layoutPart(s: Awaited<ReturnType<typeof loadShared>>, selector: string) {
  return unique(
    s.index.inventory.layouts.filter((x) =>
      s.index.inventory.layouts.includes(selector)
        ? x === selector
        : attr(required(s.doc(x).root, "cSld"), "name") === selector
    ),
    "Select one layout."
  );
}
function placeholders(xml: XmlPart) {
  const result: {
    shape: XmlElement;
    ph: XmlElement;
    id: string;
    name: string;
    type: string;
    index: number;
  }[] = [];
  const tree = required(required(xml.root, "cSld"), "spTree");
  for (const shape of tree.children) {
    const nv = shape.children.find(
      (x) =>
        x.name.namespace === xml.root.name.namespace &&
        ["nvSpPr", "nvPicPr", "nvGraphicFramePr"].includes(x.name.localName)
    );
    if (!nv) continue;
    const props = child(nv, "nvPr");
    const ph = props && child(props, "ph");
    if (!ph) continue;
    const raw = attr(ph, "idx") ?? "0";
    const index = Number(raw);
    if (
      !raw.trim() ||
      [...raw.trim()].some((x) => x < "0" || x > "9") ||
      !Number.isSafeInteger(index) ||
      index < 0 ||
      index > 4294967295
    )
      invalid("Invalid placeholder index.");
    const type = attr(ph, "type") ?? "obj";
    if (!placeholderTypes.includes(type)) invalid("Unsupported placeholder type.");
    const id = required(nv, "cNvPr");
    result.push({ shape, ph, id: attr(id, "id")!, name: attr(id, "name") ?? "", type, index });
  }
  return result;
}
function unambiguous(items: ReturnType<typeof placeholders>) {
  const keys = new Set<number>();
  for (const item of items) {
    if (keys.has(item.index)) throw new SelectionError("ambiguous-selection");
    keys.add(item.index);
  }
}
function properties(xml: XmlPart, options: LayoutProperties) {
  if (options.type !== undefined && !types.includes(options.type))
    invalid("Unsupported layout type.");
  for (const value of [options.preserve, options.showMasterShapes])
    if (value !== undefined && typeof value !== "boolean")
      invalid("Expected boolean layout property.");
  for (const value of [options.name, options.matchingName])
    if (value !== undefined && typeof value !== "string") invalid("Expected layout text.");
  return xml.merge(xml.root, {
    attributes: [
      ...(["type", "preserve", "matchingName"] as const)
        .filter((k) => options[k] !== undefined)
        .map((k) => ({ namespace: "", localName: k, value: String(options[k]) })),
      ...(options.showMasterShapes === undefined
        ? []
        : [{ namespace: "", localName: "showMasterSp", value: String(options.showMasterShapes) }])
    ]
  });
}
export async function readLayouts(
  input: BinaryInput,
  context: SelectionContext
): Promise<readonly LayoutRecord[]> {
  const s = await loadShared(input, context, false);
  const ordered: string[] = [];
  for (const master of s.index.inventory.masters) {
    const list = child(s.doc(master).root, "sldLayoutIdLst");
    for (const node of list?.children ?? []) {
      const rid = node.attributes.find(
        (a) => a.name.namespace === s.r && a.name.localName === "id"
      )?.value;
      const edge = unique(
        s.index.inventory.relationships.filter(
          (x) =>
            x.owner === master && x.id === rid && x.type.endsWith("/slideLayout") && !x.external
        ),
        "Select registered layout."
      );
      ordered.push(edge.targetPart!);
    }
  }
  return ordered.map((part) => {
    const edge = unique(
      s.index.inventory.relationships.filter(
        (x) => x.owner === part && x.type.endsWith("/slideMaster") && !x.external
      ),
      "Select layout master."
    );
    const master = edge.targetPart!;
    const forward = unique(
      s.index.inventory.relationships.filter(
        (x) => x.owner === master && x.targetPart === part && x.type.endsWith("/slideLayout")
      ),
      "Select registered layout."
    );
    const masterXml = s.doc(master);
    const list = required(masterXml.root, "sldLayoutIdLst");
    const id = unique(
      list.children.filter((x) =>
        x.attributes.some(
          (a) => a.name.namespace === s.r && a.name.localName === "id" && a.value === forward.id
        )
      ),
      "Select layout identity."
    );
    const xml = s.doc(part);
    const inherited = placeholders(masterXml);
    return {
      part,
      id: attr(id, "id")!,
      master,
      name: attr(required(xml.root, "cSld"), "name") ?? "",
      type: attr(xml.root, "type") ?? "cust",
      preserve: ["true", "1"].includes(attr(xml.root, "preserve") ?? "false"),
      showMasterShapes: !["false", "0"].includes(attr(xml.root, "showMasterSp") ?? "true"),
      matchingName: attr(xml.root, "matchingName") ?? "",
      affectedSlides: s.affected(part),
      placeholders: placeholders(xml).map((item) => {
        const baseType =
          item.type === "ctrTitle"
            ? "title"
            : ["chart", "tbl", "clipArt", "dgm", "media", "obj", "pic", "subTitle"].includes(
                  item.type
                )
              ? "body"
              : item.type;
        const bases = inherited.filter((x) => x.type === baseType);
        if (bases.length > 1) throw new SelectionError("ambiguous-selection");
        const provenance = {} as Record<"x" | "y" | "width" | "height", "layout" | "master" | null>;
        const geometry = {} as Record<"x" | "y" | "width" | "height", number | null>;
        for (const [key, element, attribute] of [
          ["x", "off", "x"],
          ["y", "off", "y"],
          ["width", "ext", "cx"],
          ["height", "ext", "cy"]
        ] as const) {
          let value: number | null = null;
          provenance[key] = null;
          for (const [shape, origin] of [
            [item.shape, "layout"],
            [bases[0]?.shape, "master"]
          ] as const) {
            if (!shape) continue;
            const sp = child(shape, "spPr");
            const transform =
              shape.name.localName === "graphicFrame"
                ? child(shape, "xfrm", s.p)
                : sp && child(sp, "xfrm", s.a);
            const node = transform && child(transform, element, s.a);
            const raw = node && attr(node, attribute);
            if (raw !== undefined) {
              const digits = raw.startsWith("-") || raw.startsWith("+") ? raw.slice(1) : raw;
              value = Number(raw);
              if (
                !digits ||
                [...digits].some((ch) => ch < "0" || ch > "9") ||
                !Number.isSafeInteger(value) ||
                Math.abs(value) > 27273042316900 ||
                (["width", "height"].includes(key) && value < 0)
              )
                invalid("Invalid placeholder geometry.");
              provenance[key] = origin;
              break;
            }
          }
          geometry[key] = value;
        }
        return {
          shapeId: item.id,
          type: item.type,
          index: item.index,
          name: item.name,
          ...geometry,
          provenance
        };
      })
    };
  });
}
export async function addLayout(
  input: BinaryInput,
  options: AddLayoutOptions,
  context: SelectionContext
): Promise<SharedEditResult> {
  fields(
    options,
    [
      "scope",
      "master",
      "name",
      "text",
      "placeholders",
      "type",
      "preserve",
      "showMasterShapes",
      "matchingName"
    ],
    ["layouts", "shared"]
  );
  if (!options.name || typeof options.name !== "string") invalid("Layout name required.");
  if (options.placeholders !== undefined && !Array.isArray(options.placeholders))
    invalid("Expected placeholder array.");
  if ((options.placeholders?.length ?? 0) > context.xmlLimits.maxNodes)
    throw new OfficeError("resource-limit", "Too many placeholders.", "usage");
  const s = await loadShared(input, context);
  const master = masterPart(s, options.master);
  let i = 1;
  while (
    s.reader.names.some((x) =>
      [
        `/ppt/slidelayouts/slidelayout${i}.xml`,
        `/ppt/slidelayouts/_rels/slidelayout${i}.xml.rels`
      ].includes(x.toLowerCase())
    )
  )
    i++;
  const part = `/ppt/slideLayouts/slideLayout${i}.xml`;
  let xml = parseXmlPart(
    new TextEncoder().encode(
      `<p:sldLayout xmlns:p="${s.p}" xmlns:a="${s.a}" xmlns:r="${s.r}"><p:cSld name="${escape(options.name)}"><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr/></p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sldLayout>`
    ),
    context.xmlLimits
  );
  xml = properties(xml, options);
  for (const ph of options.placeholders ?? []) {
    if (
      !ph ||
      typeof ph !== "object" ||
      Object.keys(ph).some(
        (k) => !["type", "index", "name", "text", "x", "y", "width", "height"].includes(k)
      )
    )
      invalid("Invalid placeholder declaration.");
    if (ph.type !== undefined && !placeholderTypes.includes(ph.type))
      invalid("Invalid placeholder type.");
    if (
      ph.index !== undefined &&
      (!Number.isSafeInteger(ph.index) || ph.index < 0 || ph.index > 4294967295)
    )
      invalid("Invalid placeholder index.");
    for (const key of ["x", "y", "width", "height"] as const)
      if (
        ph[key] !== undefined &&
        (!Number.isSafeInteger(ph[key]) ||
          Math.abs(ph[key]!) > 27273042316900 ||
          (["width", "height"].includes(key) && ph[key]! < 0))
      )
        invalid("Invalid placeholder geometry.");
    for (const value of [ph.text, ph.name])
      if (value !== undefined && typeof value !== "string") invalid("Expected placeholder text.");
    if (
      ph.text !== undefined &&
      !["title", "ctrTitle", "subTitle", "body", "obj"].includes(ph.type ?? "obj")
    )
      throw new OfficeError(
        "unsupported-edit",
        "Rich placeholders do not accept text coercion.",
        "validate-intent"
      );
    const tree = required(required(xml.root, "cSld"), "spTree");
    const id = tree.children.length;
    const off =
      ph.x === undefined && ph.y === undefined ? "" : `<a:off x="${ph.x ?? 0}" y="${ph.y ?? 0}"/>`;
    const ext =
      ph.width === undefined && ph.height === undefined
        ? ""
        : `<a:ext cx="${ph.width ?? 0}" cy="${ph.height ?? 0}"/>`;
    xml = xml.spliceChildren(tree, tree.children.length, 0, [
      `<p:sp xmlns:p="${s.p}" xmlns:a="${s.a}"><p:nvSpPr><p:cNvPr id="${id}" name="${escape(ph.name ?? "")}"/><p:cNvSpPr/><p:nvPr><p:ph${ph.type === undefined ? "" : ` type="${ph.type}"`}${ph.index === undefined ? "" : ` idx="${ph.index}"`}/></p:nvPr></p:nvSpPr><p:spPr>${off || ext ? `<a:xfrm>${off}${ext}</a:xfrm>` : ""}</p:spPr><p:txBody><a:bodyPr/><a:lstStyle/><a:p><a:r><a:t>${escape(ph.text ?? "")}</a:t></a:r></a:p></p:txBody></p:sp>`
    ]);
  }
  unambiguous(placeholders(xml));
  if (options.text !== undefined)
    xml = editContent(
      xml,
      { shapes: [{ name: "Text", text: options.text, x: 0, y: 0, width: 914400, height: 914400 }] },
      s.p,
      s.a,
      context.xmlLimits.maxBytes,
      context.xmlLimits.maxNodes
    );
  s.save(part, xml);
  s.changes.set(
    relPart(part),
    new TextEncoder().encode(
      `<Relationships xmlns="${relationships}"><Relationship Id="rId1" Type="${s.r}/slideMaster" Target="${escape(relativePartReference(master, part.slice(0, part.lastIndexOf("/"))))}"/></Relationships>`
    )
  );
  let mx = s.doc(master);
  if (!child(mx.root, "sldLayoutIdLst")) {
    const map = required(mx.root, "clrMap");
    mx = mx.spliceChildren(mx.root, mx.root.children.indexOf(map) + 1, 0, [
      `<p:sldLayoutIdLst xmlns:p="${s.p}"/>`
    ]);
  }
  let max = 2147483648;
  for (const m of s.index.inventory.masters) {
    const list = child(s.doc(m).root, "sldLayoutIdLst");
    for (const node of list?.children ?? []) max = Math.max(max, Number(attr(node, "id")));
  }
  if (max >= 4294967295) invalid("No layout identity available.");
  const rel = s.doc(relPart(master));
  const rid = nextRel(rel);
  const list = required(mx.root, "sldLayoutIdLst");
  s.save(
    master,
    mx.spliceChildren(list, list.children.length, 0, [
      `<p:sldLayoutId xmlns:p="${s.p}" xmlns:r="${s.r}" id="${max + 1}" r:id="${rid}"/>`
    ])
  );
  s.save(
    relPart(master),
    rel.spliceChildren(rel.root, rel.root.children.length, 0, [
      `<Relationship xmlns="${relationships}" Id="${rid}" Type="${s.r}/slideLayout" Target="${escape(relativePartReference(part, master.slice(0, master.lastIndexOf("/"))))}"/>`
    ])
  );
  const ct = s.doc("/[Content_Types].xml");
  s.save(
    "/[Content_Types].xml",
    ct.spliceChildren(ct.root, ct.root.children.length, 0, [
      `<Override xmlns="${ct.root.name.namespace}" PartName="${part}" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideLayout+xml"/>`
    ])
  );
  return s.finish(part, []);
}
export async function mutateLayout(
  input: BinaryInput,
  options: MutateLayoutOptions,
  context: SelectionContext
): Promise<SharedEditResult> {
  fields(
    options,
    [
      "scope",
      "layout",
      "name",
      "master",
      "shape",
      "shapeId",
      "text",
      "type",
      "preserve",
      "showMasterShapes",
      "matchingName"
    ],
    ["layouts", "shared"]
  );
  const s = await loadShared(input, context);
  const part = layoutPart(s, options.layout);
  s.save(
    part,
    editContent(
      properties(s.doc(part), options),
      options,
      s.p,
      s.a,
      context.xmlLimits.maxBytes,
      context.xmlLimits.maxNodes
    )
  );
  const result = await s.finish(part, s.affected(part));
  if (options.master === undefined) return result;
  const associated = await associateLayout(
    result.bytes,
    { scope: options.scope, layout: part, master: options.master },
    context
  );
  return { ...associated, affectedSlides: s.affected(part) };
}
export async function removeLayout(
  input: BinaryInput,
  options: RemoveLayoutOptions,
  context: SelectionContext
): Promise<SharedEditResult> {
  fields(options, ["scope", "layout"], ["layouts", "shared"]);
  const s = await loadShared(input, context);
  const part = layoutPart(s, options.layout);
  const inbound = s.index.inventory.relationships.filter(
    (x) => !x.external && x.targetPart === part
  );
  if (
    inbound.some(
      (x) => !s.index.inventory.masters.includes(x.owner) || !x.type.endsWith("/slideLayout")
    )
  )
    throw new OfficeError(
      "unsupported-edit",
      "Referenced layouts cannot be removed.",
      "validate-intent"
    );
  for (const edge of inbound) {
    const xml = s.doc(edge.owner);
    const list = required(xml.root, "sldLayoutIdLst");
    const node = unique(
      list.children.filter((x) =>
        x.attributes.some(
          (a) => a.name.namespace === s.r && a.name.localName === "id" && a.value === edge.id
        )
      ),
      "Select layout identity."
    );
    s.save(edge.owner, xml.spliceChildren(list, list.children.indexOf(node), 1, []));
    const rel = s.doc(relPart(edge.owner));
    const rnode = unique(
      rel.root.children.filter((x) => attr(x, "Id") === edge.id),
      "Select layout relationship."
    );
    s.save(
      relPart(edge.owner),
      rel.spliceChildren(rel.root, rel.root.children.indexOf(rnode), 1, [])
    );
  }
  const ct = s.doc("/[Content_Types].xml");
  const node = unique(
    ct.root.children.filter((x) => attr(x, "PartName") === part),
    "Select layout content type."
  );
  s.save("/[Content_Types].xml", ct.spliceChildren(ct.root, ct.root.children.indexOf(node), 1, []));
  s.deleted.add(part);
  s.deleted.add(relPart(part));
  return s.finish(part, []);
}
export async function applyLayout(
  input: BinaryInput,
  options: ApplyLayoutOptions,
  context: SelectionContext
): Promise<SharedEditResult> {
  if (
    !options ||
    Object.keys(options).some(
      (k) => !["selection", "layout", "placeholderPolicy", "allowEmpty"].includes(k)
    ) ||
    !["type-index", "reject-unmatched"].includes(options.placeholderPolicy) ||
    (options.allowEmpty !== undefined && typeof options.allowEmpty !== "boolean")
  )
    invalid("Explicit placeholder policy required.");
  const s = await loadShared(input, context);
  const part = layoutPart(s, options.layout);
  const target = placeholders(s.doc(part));
  unambiguous(target);
  const queries = Array.isArray(options.selection) ? options.selection : [options.selection];
  if (!queries.length) throw new SelectionError("invalid-selection");
  const selected = new Map<string, number>();
  for (const query of queries) {
    if (
      !query ||
      (query.kind !== undefined && query.kind !== "slide") ||
      (query.scope !== undefined && query.scope !== "slides") ||
      (!query.all && !query.token && !query.id && !query.name && !query.position)
    )
      throw new SelectionError("invalid-selection");
    let records;
    try {
      records = s.index.select(query);
    } catch (error) {
      if (
        options.allowEmpty &&
        error instanceof SelectionError &&
        error.code === "missing-selection"
      )
        continue;
      throw error;
    }
    for (const record of records) {
      if (record.kind !== "slide" || selected.has(record.part))
        throw new SelectionError("invalid-selection");
      selected.set(record.part, record.position);
    }
  }
  for (const slide of selected.keys()) {
    const local = placeholders(s.doc(slide));
    unambiguous(local);
    for (const item of local)
      if (
        !target.some((x) => x.type === item.type && x.index === item.index) &&
        options.placeholderPolicy === "reject-unmatched"
      )
        throw new SelectionError("missing-selection");
    const edge = unique(
      s.index.inventory.relationships.filter(
        (x) => x.owner === slide && x.type.endsWith("/slideLayout") && !x.external
      ),
      "Select slide layout."
    );
    if (edge.targetPart === part) continue;
    const rel = s.doc(relPart(slide));
    const node = unique(
      rel.root.children.filter((x) => attr(x, "Id") === edge.id),
      "Select slide layout relationship."
    );
    s.save(
      relPart(slide),
      rel.merge(node, {
        attributes: [
          {
            namespace: "",
            localName: "Target",
            value: relativePartReference(part, slide.slice(0, slide.lastIndexOf("/")))
          }
        ]
      })
    );
  }
  if (!s.changes.size) return { bytes: s.source, part, affectedSlides: [] };
  return s.finish(
    part,
    [...selected.entries()]
      .filter(([slide]) => s.changes.has(relPart(slide)))
      .map(([, position]) => position)
      .sort((a, b) => a - b)
  );
}

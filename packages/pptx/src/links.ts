import { readBinary } from "./bytes.js";
import type { BinaryInput, Location } from "./contracts.js";
import { OfficeError } from "./errors.js";
import { parseContentTypes } from "./content-types.js";
import { readPackage, type PackageReader } from "./package-reader.js";
import { relativePartReference } from "./package-uri.js";
import { writePackageArchive } from "./package-writer.js";
import { readRelationshipGraph, type RelationshipEdge } from "./relationships.js";
import { readSelectionIndex, type SelectionContext, type SelectionQuery } from "./selectors.js";
import { parseXmlPart, type XmlElement, type XmlPart } from "./xml.js";

export type LinkAction =
  | "hyperlink"
  | "slide"
  | "next-slide"
  | "previous-slide"
  | "first-slide"
  | "last-slide"
  | "last-slide-viewed"
  | "end-show";
export interface LinkOptions {
  readonly selection: SelectionQuery;
  readonly path?: readonly number[];
  readonly trigger?: "click" | "hover";
}
export interface SetLinkOptions extends LinkOptions {
  readonly url?: string;
  readonly targetSlide?: number;
  readonly action?: LinkAction;
}
export interface LinkData {
  readonly part: string;
  readonly path: readonly number[];
  readonly location: Location;
  readonly shapeId: string | null;
  readonly trigger: "click" | "hover";
  readonly relationshipId: string | null;
  readonly targetReference: string | null;
  readonly url: string | null;
  readonly targetSlide: number | null;
  readonly action: string | null;
  readonly kind: "url" | "slide" | "navigation" | "custom-show" | "unsupported";
  readonly requiresSanitization: boolean;
}
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
const jumps = {
  "next-slide": "nextslide",
  "previous-slide": "previousslide",
  "first-slide": "firstslide",
  "last-slide": "lastslide",
  "last-slide-viewed": "lastslideviewed",
  "end-show": "endshow"
} as const;
const relNamespace = "http://schemas.openxmlformats.org/package/2006/relationships";
function invalid(message: string): never {
  throw new OfficeError("invalid-value", message, "usage");
}
function unsupported(message: string): never {
  throw new OfficeError("unsupported-edit", message, "validate-intent");
}
function attr(node: XmlElement, name: string, namespace = "") {
  return node.attributes.find((a) => a.name.namespace === namespace && a.name.localName === name)
    ?.value;
}
function relPart(part: string) {
  const slash = part.lastIndexOf("/");
  return `${part.slice(0, slash)}/_rels/${part.slice(slash + 1)}.rels`;
}
function elements(root: XmlElement) {
  const result: { node: XmlElement; path: number[]; shapeId: string | null }[] = [];
  const visit = (node: XmlElement, path: number[], shapeId: string | null) => {
    if (
      dialects.some((d) => node.name.namespace === d.p) &&
      ["sp", "pic", "graphicFrame", "cxnSp", "grpSp"].includes(node.name.localName)
    ) {
      const identity = node.children
        .flatMap((n) => n.children)
        .find((n) => n.name.namespace === node.name.namespace && n.name.localName === "cNvPr");
      shapeId = identity ? (attr(identity, "id") ?? null) : shapeId;
    }
    result.push({ node, path, shapeId });
    node.children.forEach((child, i) => visit(child, [...path, i], shapeId));
  };
  visit(root, [], null);
  return result;
}
function at(xml: XmlPart, path: readonly number[]) {
  let node = xml.root;
  for (const i of path) {
    if (!Number.isSafeInteger(i) || i < 0 || !node.children[i]) invalid("Invalid link node path.");
    node = node.children[i]!;
  }
  return node;
}
export function isOrdinaryLinkUrl(url: string) {
  if (
    typeof url !== "string" ||
    !url ||
    url.trim() !== url ||
    [...url].some((c) => c.charCodeAt(0) < 32) ||
    url.includes("\\")
  )
    return false;
  const colon = url.indexOf(":");
  const boundary = [url.indexOf("/"), url.indexOf("?"), url.indexOf("#")].filter((i) => i >= 0);
  if (colon < 0 || boundary.some((i) => i < colon)) return true;
  return ["http", "https", "mailto", "ftp", "ftps", "tel"].includes(
    url.slice(0, colon).toLowerCase()
  );
}
function classify(
  node: XmlElement,
  edges: readonly RelationshipEdge[],
  r: string,
  slides: readonly { part: string }[],
  owner: string,
  showIds: readonly string[]
) {
  const action = attr(node, "action") ?? null;
  const relationshipId = attr(node, "id", r) || null;
  const edge = edges.find((e) => e.id === relationshipId);
  let kind: LinkData["kind"] = "unsupported",
    url: string | null = null,
    targetSlide: number | null = null;
  if (!action && !relationshipId) kind = "url";
  else if (
    (!action || action === "ppaction://hlinkfile") &&
    edge?.type === `${r}/hyperlink` &&
    edge.external
  ) {
    url = edge.target;
    if (isOrdinaryLinkUrl(url) && !action) kind = "url";
  } else if (
    action === "ppaction://hlinksldjump" &&
    edge?.type === `${r}/slide` &&
    !edge.external
  ) {
    const position = slides.findIndex((s) => s.part === edge.targetPart);
    if (position >= 0) {
      kind = "slide";
      targetSlide = position + 1;
    }
  } else if (
    !relationshipId &&
    Object.values(jumps).some((j) => action === `ppaction://hlinkshowjump?jump=${j}`)
  ) {
    kind = "navigation";
    const position = slides.findIndex((s) => s.part === owner);
    const target = {
      nextslide: position + 2,
      previousslide: position,
      firstslide: 1,
      lastslide: slides.length
    }[action!.split("=")[1] as "nextslide"];
    if (target !== undefined && target >= 1 && target <= slides.length) targetSlide = target;
  } else if (!relationshipId && action?.split("?")[0] === "ppaction://customshow")
    kind = "custom-show";
  let validShow = false;
  if (kind === "custom-show" && action) {
    const query = new URLSearchParams(action.slice(action.indexOf("?") + 1));
    const id = query.get("id");
    const keys: string[] = [];
    query.forEach((_value, key) => keys.push(key));
    validShow =
      action.includes("?") &&
      id !== null &&
      query.getAll("id").length === 1 &&
      [...id].every((c) => c >= "0" && c <= "9") &&
      showIds.includes(id) &&
      keys.every((k) => ["id", "return"].includes(k)) &&
      query.getAll("return").length <= 1 &&
      (query.get("return") === null || ["true", "false", "1", "0"].includes(query.get("return")!));
  }
  return {
    action,
    relationshipId,
    targetReference: edge?.target ?? null,
    url,
    targetSlide,
    kind,
    requiresSanitization: kind === "unsupported" || (kind === "custom-show" && !validShow)
  };
}
async function load(input: BinaryInput, context: SelectionContext) {
  if (!context?.xmlLimits || !context.relationshipLimits)
    invalid("Explicit XML and relationship limits are required.");
  const source = await readBinary(input, context);
  const reader = await readPackage(source, context);
  const graph = readRelationshipGraph(reader, context.relationshipLimits);
  const index = await readSelectionIndex(source, context);
  const main = graph
    .outgoing("/")
    .find((e) => dialects.some((d) => e.type === `${d.r}/officeDocument`))?.targetPart;
  const showIds = main
    ? elements(parseXmlPart(reader.get(main), context.xmlLimits).root)
        .filter(
          ({ node }) =>
            dialects.some((d) => node.name.namespace === d.p) && node.name.localName === "custShow"
        )
        .map(({ node }) => attr(node, "id") ?? "")
    : [];
  return { source, reader: reader as PackageReader, graph, index, showIds };
}
type LinkState = Awaited<ReturnType<typeof load>>;
function readLinks(
  state: LinkState,
  selection: SelectionQuery | undefined,
  context: SelectionContext
): readonly LinkData[] {
  const selected = selection ? state.index.select(selection) : state.index.slides;
  const result: LinkData[] = [];
  for (const part of new Set(selected.map((s) => s.part))) {
    const xml = parseXmlPart(state.reader.get(part), context.xmlLimits);
    const d = dialects.find((d) => d.p === xml.root.name.namespace);
    if (!d) continue;
    for (const { node, path, shapeId } of elements(xml.root)) {
      if (
        node.name.namespace !== d.a ||
        !["hlinkClick", "hlinkHover", "hlinkMouseOver"].includes(node.name.localName)
      )
        continue;
      const parent = at(xml, path.slice(0, -1));
      const isShape = parent.name.namespace === d.p && parent.name.localName === "cNvPr";
      const isRun =
        parent.name.namespace === d.a &&
        ["rPr", "defRPr", "endParaRPr"].includes(parent.name.localName);
      const scoped =
        (node.name.localName === "hlinkClick" && (isShape || isRun)) ||
        (node.name.localName === "hlinkHover" && isShape) ||
        (node.name.localName === "hlinkMouseOver" && isRun);
      const record = selected.find(
        (s) => s.part === part && (s.kind !== "object" || s.id === shapeId)
      );
      if (!record) continue;
      result.push(
        Object.freeze({
          part,
          path,
          location:
            state.index.objects.find((o) => o.part === part && o.id === shapeId)?.location ??
            record.location,
          shapeId,
          trigger: node.name.localName === "hlinkClick" ? "click" : "hover",
          ...classify(
            node,
            state.graph.outgoing(part),
            d.r,
            state.index.slides,
            part,
            state.showIds
          ),
          ...(!scoped ? { kind: "unsupported" as const, requiresSanitization: true } : {})
        })
      );
    }
  }
  return Object.freeze(result);
}
function prepareChange(
  state: LinkState,
  options: SetLinkOptions & { readonly sanitize?: boolean },
  context: SelectionContext,
  remove: boolean
): Map<string, Uint8Array> {
  if (context.signal?.aborted) throw new OfficeError("cancelled", "Operation cancelled.", "mutate");
  const allowed = remove
    ? ["selection", "path", "trigger", "sanitize"]
    : ["selection", "path", "trigger", "url", "targetSlide", "action"];
  if (!options || Object.keys(options).some((k) => !allowed.includes(k)))
    invalid("Invalid link options.");
  if (options.trigger !== undefined && !["click", "hover"].includes(options.trigger))
    invalid("Invalid link trigger.");
  if (options.sanitize !== undefined && typeof options.sanitize !== "boolean")
    invalid("Sanitize must be explicit boolean.");
  const { reader, graph, index } = state;
  const types = parseContentTypes(reader.get("/[Content_Types].xml"), {
    ...context.xmlLimits,
    maxEntries: context.archiveLimits.maxMembers
  });
  for (const name of reader.names) {
    if (name === "/[Content_Types].xml") continue;
    const type = types.get(name).toLowerCase();
    if (
      type.includes("macroenabled") ||
      type.includes("vbaproject") ||
      type.includes("digital-signature")
    )
      unsupported("Signed and macro-enabled presentations cannot be edited.");
  }
  const main = graph
    .outgoing("/")
    .find((e) => dialects.some((d) => e.type === `${d.r}/officeDocument`))?.targetPart;
  if (
    main &&
    elements(parseXmlPart(reader.get(main), context.xmlLimits).root).some(
      ({ node }) => node.name.localName === "modifyVerifier"
    )
  )
    unsupported("Protected presentations cannot be edited.");
  const selected = index.select(options.selection);
  if (selected.length !== 1 || selected[0]!.kind !== "object")
    invalid("Select exactly one owning shape.");
  const record = selected[0]!;
  let xml = parseXmlPart(reader.get(record.part), context.xmlLimits);
  const d = dialects.find((d) => d.p === xml.root.name.namespace);
  if (!d) unsupported("Unsupported drawing dialect.");
  const candidates = elements(xml.root).filter(
    ({ node }) =>
      node.name.namespace === d.p &&
      node.name.localName === "cNvPr" &&
      attr(node, "id") === record.id
  );
  if (candidates.length !== 1) unsupported("Shape identity is ambiguous.");
  let parentPath = candidates[0]!.path;
  if (options.path !== undefined) {
    if (!Array.isArray(options.path)) invalid("Invalid link node path.");
    parentPath = [...options.path];
    const entry = elements(xml.root).find(
      (e) => e.path.length === parentPath.length && e.path.every((v, i) => v === parentPath[i])
    );
    if (
      !entry ||
      entry.shapeId !== record.id ||
      !(
        (entry.node.name.namespace === d.a &&
          ["rPr", "defRPr", "endParaRPr"].includes(entry.node.name.localName)) ||
        (entry.node.name.namespace === d.p &&
          entry.node.name.localName === "cNvPr" &&
          attr(entry.node, "id") === record.id)
      )
    )
      invalid("Link path must select run properties within its owning shape.");
  }
  let parent = at(xml, parentPath);
  const localName =
    (options.trigger ?? "click") === "click"
      ? "hlinkClick"
      : parent.name.namespace === d.a
        ? "hlinkMouseOver"
        : "hlinkHover";
  const links = parent.children.filter(
    (n) =>
      n.name.namespace === d.a &&
      (n.name.localName === localName ||
        ((options.trigger ?? "click") === "hover" &&
          ["hlinkHover", "hlinkMouseOver"].includes(n.name.localName)))
  );
  if (links.length > 1) unsupported("Duplicate link nodes cannot be edited.");
  const old = links[0];
  if (
    old &&
    (old.name.localName !== localName ||
      classify(old, graph.outgoing(record.part), d.r, index.slides, record.part, state.showIds)
        .requiresSanitization) &&
    !(remove && options.sanitize)
  )
    unsupported("Unsupported action requires explicit sanitization before replacement.");
  if (remove && !old) return new Map();
  if (
    !remove &&
    old &&
    classify(old, graph.outgoing(record.part), d.r, index.slides, record.part, state.showIds)
      .kind === "custom-show"
  )
    unsupported("Custom-show links are preserve-only; explicitly remove before replacement.");
  if (!remove && old) {
    const previous = classify(
      old,
      graph.outgoing(record.part),
      d.r,
      index.slides,
      record.part,
      state.showIds
    );
    if (
      (options.url !== undefined && previous.kind === "url" && previous.url === options.url) ||
      (options.targetSlide !== undefined &&
        previous.kind === "slide" &&
        previous.targetSlide === options.targetSlide) ||
      (options.action !== undefined &&
        Object.hasOwn(jumps, options.action) &&
        previous.action ===
          `ppaction://hlinkshowjump?jump=${jumps[options.action as keyof typeof jumps]}`)
    )
      return new Map();
  }
  const relName = relPart(record.part);
  let rels = parseXmlPart(
    reader.has(relName)
      ? reader.get(relName)
      : new TextEncoder().encode(`<Relationships xmlns="${relNamespace}"/>`),
    context.xmlLimits
  );
  let relationshipId: string | null = null,
    action: string | null = null;
  if (!remove) {
    if (options.url !== undefined || options.targetSlide !== undefined) {
      const target = options.url ?? index.slides[options.targetSlide! - 1]?.part;
      if (!target)
        throw new OfficeError("missing-selection", "Target slide does not exist.", "select");
      const existing = graph
        .outgoing(record.part)
        .find(
          (edge) =>
            edge.type === `${d.r}/${options.url !== undefined ? "hyperlink" : "slide"}` &&
            (options.url !== undefined
              ? edge.external && edge.target === target
              : !edge.external && edge.targetPart === target)
        );
      if (existing) relationshipId = existing.id;
      else {
        const ids = new Set(graph.outgoing(record.part).map((e) => e.id));
        let i = 1;
        while (ids.has(`rId${i}`)) i++;
        relationshipId = `rId${i}`;
        rels = rels.spliceChildren(rels.root, rels.root.children.length, 0, [
          `<Relationship xmlns="${relNamespace}"/>`
        ]);
        rels = rels.merge(rels.root.children.at(-1)!, {
          attributes: [
            { namespace: "", localName: "Id", value: relationshipId },
            {
              namespace: "",
              localName: "Type",
              value: `${d.r}/${options.url !== undefined ? "hyperlink" : "slide"}`
            },
            {
              namespace: "",
              localName: "Target",
              value:
                options.url ??
                relativePartReference(
                  target,
                  record.part.slice(0, record.part.lastIndexOf("/")) || "/"
                )
            },
            ...(options.url !== undefined
              ? [{ namespace: "", localName: "TargetMode", value: "External" }]
              : [])
          ]
        });
      }
      if (options.targetSlide !== undefined) action = "ppaction://hlinksldjump";
    } else action = `ppaction://hlinkshowjump?jump=${jumps[options.action as keyof typeof jumps]}`;
  }
  const oldId = old ? attr(old, "id", d.r) : undefined;
  if (remove) {
    xml = xml.spliceChildren(parent, parent.children.indexOf(old!), 1, []);
  } else {
    if (!old) {
      const rank = localName === "hlinkClick" ? 0 : 1;
      const insert = parent.children.findIndex(
        (n) =>
          n.name.namespace === d.a &&
          (n.name.localName === "rtl" ||
            n.name.localName === "extLst" ||
            (rank === 0 && ["hlinkHover", "hlinkMouseOver"].includes(n.name.localName)))
      );
      xml = xml.spliceChildren(parent, insert < 0 ? parent.children.length : insert, 0, [
        `<a:${localName} xmlns:a="${d.a}"/>`
      ]);
      parent = at(xml, parentPath);
    }
    const current = parent.children.find(
      (n) => n.name.namespace === d.a && n.name.localName === localName
    )!;
    xml = xml.merge(current, {
      attributes: [
        { namespace: d.r, localName: "id", value: relationshipId },
        { namespace: "", localName: "action", value: action }
      ]
    });
  }
  if (
    oldId &&
    !elements(xml.root).some(({ node }) =>
      node.attributes.some((a) => a.name.namespace === d.r && a.value === oldId)
    )
  ) {
    const position = rels.root.children.findIndex((n) => attr(n, "Id") === oldId);
    if (position >= 0) rels = rels.spliceChildren(rels.root, position, 1, []);
  }
  return new Map([
    [record.part, xml.bytes()],
    [relName, rels.bytes()]
  ]);
}
function validateSet(options: SetLinkOptions): void {
  if (!options) invalid("Invalid link options.");
  {
    const payloads =
      Number(options.url !== undefined) +
      Number(options.targetSlide !== undefined) +
      Number(options.action !== undefined && Object.hasOwn(jumps, options.action));
    if (payloads !== 1) invalid("Provide exactly one URL, slide target or navigation action.");
    if (
      options.url !== undefined &&
      (!isOrdinaryLinkUrl(options.url) ||
        (options.action !== undefined && options.action !== "hyperlink"))
    )
      invalid("Invalid or unsafe URL action.");
    if (
      options.targetSlide !== undefined &&
      (!Number.isSafeInteger(options.targetSlide) ||
        options.targetSlide < 1 ||
        (options.action !== undefined && options.action !== "slide"))
    )
      invalid("Invalid slide target action.");
  }
}
export interface LinkSession {
  readonly slides: readonly { readonly part: string }[];
  list(selection?: SelectionQuery): readonly LinkData[];
  getPart(part: string): XmlPart;
  set(options: SetLinkOptions): void;
  remove(options: LinkOptions & { readonly sanitize?: boolean }): void;
  save(): Promise<Uint8Array>;
}
export async function openLinkSession(
  input: BinaryInput,
  context: SelectionContext
): Promise<LinkSession> {
  const state = await load(input, context);
  const original = state.reader;
  const changed = new Map<string, Uint8Array>();
  const apply = (updates: Map<string, Uint8Array>) => {
    const merged = new Map([...changed, ...updates]);
    const names = [...new Set([...original.names, ...merged.keys()])];
    const candidate: PackageReader = {
      names,
      has: (name) => merged.has(name) || original.has(name),
      get: (name) => merged.get(name)?.slice() ?? original.get(name),
      relsXmlFor: (owner) => merged.get(relPart(owner))?.slice() ?? original.relsXmlFor(owner)
    };
    const graph = readRelationshipGraph(candidate, context.relationshipLimits);
    for (const [name, bytes] of updates) changed.set(name, bytes);
    state.reader = candidate;
    state.graph = graph;
  };
  return Object.freeze({
    slides: Object.freeze(state.index.slides.map((slide) => Object.freeze({ part: slide.part }))),
    list(selection?: SelectionQuery) {
      if (context.signal?.aborted)
        throw new OfficeError("cancelled", "Operation cancelled.", "index");
      return readLinks(state, selection, context);
    },
    getPart(part: string) {
      if (context.signal?.aborted)
        throw new OfficeError("cancelled", "Operation cancelled.", "index");
      if (!state.index.slides.some((slide) => slide.part === part))
        invalid("Select an owning slide part.");
      return parseXmlPart(state.reader.get(part), context.xmlLimits);
    },
    set(options: SetLinkOptions) {
      validateSet(options);
      apply(prepareChange(state, options, context, false));
    },
    remove(options: LinkOptions & { readonly sanitize?: boolean }) {
      apply(prepareChange(state, options, context, true));
    },
    async save() {
      if (context.signal?.aborted)
        throw new OfficeError("cancelled", "Operation cancelled.", "serialize");
      if (!changed.size) return state.source.slice();
      return writePackageArchive(
        state.reader.names.map((name) => ({ name: name.slice(1), bytes: state.reader.get(name) })),
        context,
        { compression: "auto", source: state.source }
      );
    }
  });
}
export async function listLinks(
  input: BinaryInput,
  options: { readonly selection?: SelectionQuery },
  context: SelectionContext
): Promise<readonly LinkData[]> {
  if (!options || Object.keys(options).some((k) => k !== "selection"))
    invalid("Invalid link selection.");
  const state = await load(input, context);
  return readLinks(state, options.selection, context);
}
export async function setLink(
  input: BinaryInput,
  options: SetLinkOptions,
  context: SelectionContext
): Promise<Uint8Array> {
  validateSet(options);
  const session = await openLinkSession(input, context);
  session.set(options);
  return session.save();
}
export async function removeLink(
  input: BinaryInput,
  options: LinkOptions & { readonly sanitize?: boolean },
  context: SelectionContext
): Promise<Uint8Array> {
  const session = await openLinkSession(input, context);
  session.remove(options);
  return session.save();
}

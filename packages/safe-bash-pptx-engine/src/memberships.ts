import { readBinary } from "./bytes.js";
import type { BinaryInput } from "./contracts.js";
import { OfficeError } from "./errors.js";
import { parseContentTypes } from "./content-types.js";
import { readPackage } from "./package-reader.js";
import { writePackageArchive } from "./package-writer.js";
import { readRelationshipGraph } from "./relationships.js";
import { SelectionError, type SelectionContext } from "./selectors.js";
import { parseXmlPart, type XmlElement, type XmlPart } from "./xml.js";
import { validatePresentation } from "./validation.js";
export type MembershipKind = "sections" | "shows";
export interface MembershipRecord {
  readonly id: string;
  readonly name: string;
  readonly position: number;
  readonly slides: readonly number[];
}
export interface MembershipSelection {
  readonly ids?: readonly string[];
  readonly id?: string;
  readonly name?: string;
  readonly position?: number;
  readonly all?: boolean;
}
export interface MutateMembershipsOptions {
  readonly action: "add" | "set" | "remove";
  readonly selection?: MembershipSelection;
  readonly name?: string;
  readonly slides?: readonly number[];
  readonly position?: number;
  readonly allowEmpty?: boolean;
}
const sectionNamespace = "http://schemas.microsoft.com/office/powerpoint/2010/main";
const sectionExtension = "{521415D9-36F7-43E2-AB2F-B90AF26B5E84}";
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
function fail(code: "invalid-value" | "unsupported-edit" | "invalid-opc", message: string): never {
  throw new OfficeError(code, message, code === "invalid-value" ? "usage" : "validate-intent");
}
function attr(node: XmlElement, name: string, namespace = "") {
  return node.attributes.find((a) => a.name.namespace === namespace && a.name.localName === name)
    ?.value;
}
function children(node: XmlElement, name: string, namespace: string) {
  return node.children.filter(
    (child) => child.name.namespace === namespace && child.name.localName === name
  );
}
function only(node: XmlElement, name: string, namespace: string) {
  const found = children(node, name, namespace);
  if (found.length > 1) fail("unsupported-edit", "Ambiguous membership structure.");
  return found[0];
}
function locate(xml: XmlPart, kind: MembershipKind) {
  const p = xml.root.name.namespace;
  if (kind === "shows") return only(xml.root, "custShowLst", p);
  const extensions = only(xml.root, "extLst", p);
  const matching =
    extensions?.children.filter((node) => attr(node, "uri")?.toUpperCase() === sectionExtension) ??
    [];
  if (matching.length > 1) fail("unsupported-edit", "Multiple section extensions.");
  const extension = matching[0];
  if (
    extensions?.children.some(
      (node) =>
        node !== extension && node.children.some((child) => child.name.localName === "sectionLst")
    )
  )
    fail("unsupported-edit", "Unsupported section extension identity.");
  if (!extension) return undefined;
  if (
    extension.name.namespace !== p ||
    extension.name.localName !== "ext" ||
    extension.children.length !== 1
  )
    fail("unsupported-edit", "Unsupported section extension structure.");
  const list = only(extension, "sectionLst", sectionNamespace);
  if (!list) fail("unsupported-edit", "Unsupported section extension namespace.");
  return list;
}
function inspect(xml: XmlPart, kind: MembershipKind) {
  const d = dialects.find((value) => value.p === xml.root.name.namespace);
  if (!d) fail("unsupported-edit", "Unsupported presentation namespace.");
  const slideList = only(xml.root, "sldIdLst", d.p);
  const slides = slideList ? children(slideList, "sldId", d.p) : [];
  const ids = slides.map((node) => attr(node, "id")!);
  const rels = slides.map((node) => attr(node, "id", d.r)!);
  const list = locate(xml, kind);
  const ns = kind === "sections" ? sectionNamespace : d.p;
  const itemName = kind === "sections" ? "section" : "custShow";
  if (list?.children.some((node) => node.name.namespace !== ns || node.name.localName !== itemName))
    fail("unsupported-edit", "Unsupported membership list content.");
  const seen = new Set<string>();
  const sectionSlides = new Set<number>();
  const records = (list?.children ?? []).map((node, i): MembershipRecord => {
    const id = attr(node, "id"),
      name = attr(node, "name");
    if (id === undefined || !id || name === undefined)
      fail("invalid-opc", "Membership identities and names must be present.");
    let identity = id.toUpperCase();
    if (kind === "shows") {
      if (
        ![...id].every((character) => character >= "0" && character <= "9") ||
        !Number.isSafeInteger(Number(id)) ||
        Number(id) > 4294967295
      )
        fail("invalid-opc", "Invalid custom show identity.");
      identity = String(Number(id));
    } else {
      const segments = id.slice(1, -1).split("-");
      if (
        !id.startsWith("{") ||
        !id.endsWith("}") ||
        segments.length !== 5 ||
        segments.some(
          (segment, i) =>
            segment.length !== [8, 4, 4, 4, 12][i] ||
            [...segment].some((character) => !"0123456789ABCDEF".includes(character.toUpperCase()))
        )
      )
        fail("invalid-opc", "Invalid section identity.");
    }
    if (seen.has(identity)) fail("invalid-opc", "Membership identities must be unique.");
    seen.add(identity);
    if (
      kind === "sections" &&
      (node.attributes.some(
        (a) =>
          a.name.namespace !== "http://www.w3.org/2000/xmlns/" &&
          (a.name.namespace !== "" || !["id", "name"].includes(a.name.localName))
      ) ||
        node.children.some(
          (child) =>
            child.name.namespace !== sectionNamespace || child.name.localName !== "sldIdLst"
        ))
    )
      fail("unsupported-edit", "Unsupported section extension content.");
    const members = only(node, kind === "sections" ? "sldIdLst" : "sldLst", ns);
    if (!members) fail("unsupported-edit", "Missing membership slide list.");
    if (
      kind === "sections" &&
      members.attributes.some((a) => a.name.namespace !== "http://www.w3.org/2000/xmlns/")
    )
      fail("unsupported-edit", "Unsupported section list attributes.");
    const positions = members.children.map((member) => {
      if (
        member.name.namespace !== ns ||
        member.name.localName !== (kind === "sections" ? "sldId" : "sld")
      )
        fail("unsupported-edit", "Unsupported membership slide entry.");
      if (
        kind === "sections" &&
        (member.children.length ||
          member.attributes.some(
            (a) =>
              a.name.namespace !== "http://www.w3.org/2000/xmlns/" &&
              (a.name.namespace !== "" || a.name.localName !== "id")
          ))
      )
        fail("unsupported-edit", "Unsupported section member extension.");
      const position =
        kind === "sections"
          ? ids.indexOf(attr(member, "id") ?? "")
          : rels.indexOf(attr(member, "id", d.r) ?? "");
      if (position < 0) fail("invalid-opc", "Membership references an absent slide.");
      return position + 1;
    });
    if (kind === "sections")
      for (const [j, position] of positions.entries()) {
        if (sectionSlides.has(position) || (j > 0 && position !== positions[j - 1]! + 1))
          fail("unsupported-edit", "Existing sections must be contiguous and nonoverlapping.");
        sectionSlides.add(position);
      }
    return { id, name, position: i + 1, slides: positions };
  });
  return { d, ids, rels, list, ns, records };
}
async function load(input: BinaryInput, context: SelectionContext) {
  if (!context?.xmlLimits || !context.relationshipLimits)
    fail("invalid-value", "Explicit XML and relationship limits are required.");
  const source = await readBinary(input, context);
  const reader = await readPackage(source, context);
  const graph = readRelationshipGraph(reader, context.relationshipLimits);
  const main = graph
    .outgoing("/")
    .find((edge) => dialects.some((d) => edge.type === `${d.r}/officeDocument`))?.targetPart;
  if (!main) fail("invalid-opc", "Presentation relationship is missing.");
  return { source, reader, graph, main, xml: parseXmlPart(reader.get(main), context.xmlLimits) };
}
export async function readMemberships(
  input: BinaryInput,
  kind: MembershipKind,
  context: SelectionContext
): Promise<readonly MembershipRecord[]> {
  if (!["sections", "shows"].includes(kind)) fail("invalid-value", "Unknown membership resource.");
  return inspect((await load(input, context)).xml, kind).records;
}
function fields(value: unknown, allowed: readonly string[]) {
  if (
    !value ||
    typeof value !== "object" ||
    ![Object.prototype, null].includes(Object.getPrototypeOf(value)) ||
    Object.keys(value).some((key) => !allowed.includes(key))
  )
    fail("invalid-value", "Invalid membership options.");
}
export async function mutateMemberships(
  input: BinaryInput,
  kind: MembershipKind,
  options: MutateMembershipsOptions,
  context: SelectionContext
): Promise<Uint8Array> {
  fields(options, ["action", "selection", "name", "slides", "position", "allowEmpty"]);
  if (!["sections", "shows"].includes(kind) || !["add", "set", "remove"].includes(options.action))
    fail("invalid-value", "Unknown membership operation.");
  if (options.name !== undefined && typeof options.name !== "string")
    fail("invalid-value", "Membership name must be text.");
  if (options.allowEmpty !== undefined && typeof options.allowEmpty !== "boolean")
    fail("invalid-value", "allowEmpty must be boolean.");
  if (
    options.position !== undefined &&
    (!Number.isSafeInteger(options.position) || options.position < 1)
  )
    fail("invalid-value", "Invalid membership position.");
  if (
    options.action === "add" &&
    (options.name === undefined || options.slides === undefined || options.selection !== undefined)
  )
    fail("invalid-value", "Creation requires a name and slide membership.");
  if (
    options.action === "set" &&
    options.name === undefined &&
    options.slides === undefined &&
    options.position === undefined
  )
    fail("invalid-value", "At least one membership update is required.");
  if (
    options.action === "remove" &&
    [options.name, options.slides, options.position].some((value) => value !== undefined)
  )
    fail("invalid-value", "Removal cannot include updates.");
  if (options.selection !== undefined) {
    fields(options.selection, ["id", "ids", "name", "position", "all"]);
    const q = options.selection;
    if (
      (q.ids !== undefined &&
        (!Array.isArray(q.ids) ||
          new Set(q.ids).size !== q.ids.length ||
          q.ids.some((id) => typeof id !== "string" || !id))) ||
      (q.id !== undefined && (typeof q.id !== "string" || !q.id)) ||
      (q.name !== undefined && (typeof q.name !== "string" || !q.name)) ||
      (q.position !== undefined && (!Number.isSafeInteger(q.position) || q.position < 1)) ||
      (q.all !== undefined && typeof q.all !== "boolean") ||
      (!q.all &&
        q.ids === undefined &&
        q.id === undefined &&
        q.name === undefined &&
        q.position === undefined)
    )
      throw new SelectionError("invalid-selection");
  } else if (options.action !== "add") throw new SelectionError("invalid-selection");
  const loaded = await load(input, context);
  let xml = loaded.xml;
  const { source, reader, graph, main } = loaded;
  const limits = {
    ...context.xmlLimits,
    ...context.relationshipLimits,
    maxBytes: Math.min(context.xmlLimits.maxBytes, context.relationshipLimits.maxBytes),
    maxEntries: context.archiveLimits.maxMembers
  };
  const types = parseContentTypes(reader.get("/[Content_Types].xml"), limits);
  for (const name of reader.names) {
    if (name === "/[Content_Types].xml") continue;
    const type = types.get(name).toLowerCase();
    if (
      type.includes("digital-signature") ||
      type.includes("macroenabled") ||
      type.includes("vbaproject") ||
      name.toLowerCase().startsWith("/_xmlsignatures/")
    )
      fail("unsupported-edit", "Signed and macro-enabled presentations cannot be changed.");
  }
  for (const owner of ["/", ...graph.parts])
    if (
      graph
        .outgoing(owner)
        .some(
          (edge) => edge.type.includes("/digital-signature/") || edge.type.endsWith("/vbaProject")
        )
    )
      fail("unsupported-edit", "Signed and macro-enabled presentations cannot be changed.");
  if (!validatePresentation(reader, limits).valid)
    fail("invalid-opc", "Membership editing requires a valid presentation graph.");
  const pending = [xml.root];
  while (pending.length) {
    const node = pending.pop()!;
    if (
      node.name.localName === "modifyVerifier" ||
      node.name.namespace === "http://schemas.openxmlformats.org/markup-compatibility/2006"
    )
      fail(
        "unsupported-edit",
        "Protected or conditional presentation structures cannot be changed."
      );
    pending.push(...node.children);
  }
  if (options.name !== undefined)
    xml.merge(xml.root, {
      attributes: [{ namespace: "", localName: "name", value: options.name }]
    });
  const state = inspect(xml, kind);
  const q = options.selection;
  const selected =
    options.action === "add"
      ? []
      : state.records.filter(
          (record) =>
            (!q?.id || record.id === q.id) &&
            (q?.ids === undefined || q.ids.includes(record.id)) &&
            (q?.name === undefined || record.name === q.name) &&
            (q?.position === undefined || record.position === q.position)
        );
  if (selected.length > 1 && !q?.all) throw new SelectionError("ambiguous-selection");
  if (options.slides !== undefined) {
    if (
      !Array.isArray(options.slides) ||
      !options.slides.length ||
      new Set(options.slides).size !== options.slides.length ||
      options.slides.some(
        (position) => !Number.isSafeInteger(position) || position < 1 || position > state.ids.length
      )
    )
      fail("invalid-value", "Membership requires unique existing slide positions.");
    if (
      kind === "sections" &&
      options.slides.some((position, i) => i > 0 && position !== options.slides![i - 1]! + 1)
    )
      fail("invalid-value", "Section members must be ordered and contiguous.");
  }
  if (kind === "sections") {
    const used = new Set<number>();
    const records = state.records.filter(
      (record) => options.action !== "remove" || !selected.includes(record)
    );
    const memberships = records.map((record) =>
      selected.includes(record) && options.slides !== undefined ? options.slides : record.slides
    );
    if (options.action === "add") memberships.push(options.slides!);
    for (const members of memberships)
      for (const [i, slide] of members.entries()) {
        if (used.has(slide) || (i > 0 && slide !== members[i - 1]! + 1))
          fail("invalid-value", "Section members must be contiguous and nonoverlapping.");
        used.add(slide);
      }
    for (const node of state.list?.children ?? []) {
      if (
        node.children.some(
          (child) =>
            child.name.namespace !== sectionNamespace || child.name.localName !== "sldIdLst"
        )
      )
        fail("unsupported-edit", "Unsupported section extension content.");
    }
  }
  const finalCount = state.records.length + (options.action === "add" ? 1 : 0);
  if (
    options.position !== undefined &&
    options.position > finalCount - selected.length + (options.action === "add" ? 0 : 1)
  )
    fail("invalid-value", "Membership position is outside the list.");
  if (options.action !== "add" && !selected.length) {
    if (options.allowEmpty) return source;
    throw new SelectionError("missing-selection");
  }

  if (kind === "shows" && options.action === "remove") {
    const removedIds = new Set(selected.map((record) => Number(record.id)));
    const dangling = (): never => {
      throw new OfficeError(
        "dangling-reference",
        "Custom show removal would leave an active or unsupported show reference.",
        "validate-intent"
      );
    };
    const checkId = (id: string | undefined) => {
      if (
        id === undefined ||
        !id ||
        [...id].some((character) => character < "0" || character > "9") ||
        !Number.isSafeInteger(Number(id)) ||
        Number(id) > 4294967295 ||
        removedIds.has(Number(id))
      )
        dangling();
    };
    for (const name of reader.names) {
      context.signal?.throwIfAborted();
      if (name === "/[Content_Types].xml") continue;
      const type = types.get(name).toLowerCase();
      if (!type.endsWith("+xml") && !type.endsWith("/xml")) continue;
      const doc = name === main ? xml : parseXmlPart(reader.get(name), context.xmlLimits);
      const nodes: { node: XmlElement; parent?: XmlElement }[] = [{ node: doc.root }];
      while (nodes.length) {
        const { node, parent } = nodes.pop()!;
        if (
          node.name.namespace === state.d.p &&
          node.name.localName === "custShow" &&
          parent?.name.localName !== "custShowLst"
        )
          checkId(attr(node, "id"));
        for (const attribute of node.attributes) {
          if (
            attribute.name.localName !== "action" ||
            !attribute.value.toLowerCase().startsWith("ppaction://customshow")
          )
            continue;
          let action: URL;
          try {
            action = new URL(attribute.value);
          } catch {
            dangling();
          }
          if (
            action!.hostname !== "customshow" ||
            action!.pathname ||
            action!.hash ||
            action!.username ||
            action!.password ||
            action!.port
          )
            dangling();
          const ids = action!.searchParams.getAll("id");
          if (ids.length !== 1) dangling();
          action!.searchParams.forEach((_value, key) => {
            if (!["id", "return"].includes(key)) dangling();
          });
          checkId(ids[0]);
        }
        nodes.push(...node.children.map((child) => ({ node: child, parent: node })));
      }
    }
  }
  if (options.action === "add") {
    if (!locate(xml, kind)) {
      if (kind === "shows") {
        const preceding = [
          "sldMasterIdLst",
          "notesMasterIdLst",
          "handoutMasterIdLst",
          "sldIdLst",
          "sldSz",
          "notesSz",
          "smartTags",
          "embeddedFontLst"
        ];
        const following = xml.root.children.findIndex(
          (node) => !preceding.includes(node.name.localName)
        );
        xml = xml.spliceChildren(
          xml.root,
          following < 0 ? xml.root.children.length : following,
          0,
          [`<p:custShowLst xmlns:p="${state.d.p}"/>`]
        );
      } else {
        let ext = only(xml.root, "extLst", state.d.p);
        if (!ext) {
          xml = xml.spliceChildren(xml.root, xml.root.children.length, 0, [
            `<p:extLst xmlns:p="${state.d.p}"/>`
          ]);
          ext = only(xml.root, "extLst", state.d.p)!;
        }
        xml = xml.spliceChildren(ext, ext.children.length, 0, [
          `<p:ext xmlns:p="${state.d.p}" uri="${sectionExtension}"><s:sectionLst xmlns:s="${sectionNamespace}"/></p:ext>`
        ]);
      }
    }
    let number = kind === "shows" ? 0 : 1;
    const idFor = (n: number) =>
      kind === "shows"
        ? String(n)
        : `{00000000-0000-0000-0000-${n.toString(16).toUpperCase().padStart(12, "0")}}`;
    const used = new Set(
      state.records.map((record) =>
        kind === "shows" ? String(Number(record.id)) : record.id.toUpperCase()
      )
    );
    while (used.has(idFor(number))) number++;
    if (number > 4294967295)
      throw new OfficeError(
        "resource-limit",
        "Membership identities exhausted.",
        "validate-intent"
      );
    const list = locate(xml, kind)!;
    const element =
      kind === "shows"
        ? `<p:custShow xmlns:p="${state.d.p}" name="" id="${idFor(number)}"><p:sldLst/></p:custShow>`
        : `<s:section xmlns:s="${sectionNamespace}" name="" id="${idFor(number)}"><s:sldIdLst/></s:section>`;
    xml = xml.spliceChildren(
      list,
      options.position === undefined ? list.children.length : options.position - 1,
      0,
      [element]
    );
    const record: MembershipRecord = { id: idFor(number), name: "", position: 0, slides: [] };
    selected.push(record);
  }
  for (const record of selected) {
    let list = locate(xml, kind)!;
    const index = list.children.findIndex((node) => attr(node, "id") === record.id);
    if (options.action === "remove") {
      xml = xml.spliceChildren(list, index, 1, []);
      continue;
    }
    let node = list.children[index]!;
    if (options.name !== undefined) {
      xml = xml.merge(node, {
        attributes: [{ namespace: "", localName: "name", value: options.name }]
      });
      list = locate(xml, kind)!;
      node = list.children[index]!;
    }
    if (options.slides !== undefined) {
      const members = only(node, kind === "shows" ? "sldLst" : "sldIdLst", state.ns)!;
      if (
        members.attributes.some((a) => a.name.namespace !== "http://www.w3.org/2000/xmlns/") ||
        members.children.some(
          (child) =>
            child.children.length ||
            child.attributes.some(
              (a) =>
                a.name.namespace !== "http://www.w3.org/2000/xmlns/" &&
                !(
                  a.name.localName === "id" &&
                  a.name.namespace === (kind === "shows" ? state.d.r : "")
                )
            )
        )
      )
        fail("unsupported-edit", "Unsupported membership entry extension.");
      xml = xml.spliceChildren(
        members,
        0,
        members.children.length,
        options.slides.map((position) => {
          const member = parseXmlPart(
            new TextEncoder().encode(
              kind === "shows"
                ? `<p:sld xmlns:p="${state.d.p}" xmlns:r="${state.d.r}" r:id=""/>`
                : `<s:sldId xmlns:s="${sectionNamespace}" id=""/>`
            ),
            context.xmlLimits
          );
          const edited = member.merge(member.root, {
            attributes: [
              {
                namespace: kind === "shows" ? state.d.r : "",
                localName: "id",
                value: (kind === "shows" ? state.rels : state.ids)[position - 1]!
              }
            ]
          });
          return edited.markup(edited.root);
        })
      );
    }
  }
  if (options.action === "set" && options.position !== undefined) {
    const list = locate(xml, kind)!;
    const ids = new Set(selected.map((record) => record.id));
    const moving = list.children.filter((node) => ids.has(attr(node, "id")!));
    const ordered = list.children.filter((node) => !ids.has(attr(node, "id")!));
    ordered.splice(options.position - 1, 0, ...moving);
    xml = xml.reorderChildren(list, ordered);
  }
  const remaining = locate(xml, kind);
  if (remaining && !remaining.children.length) {
    if (kind === "shows")
      xml = xml.spliceChildren(xml.root, xml.root.children.indexOf(remaining), 1, []);
    else {
      const ext = only(xml.root, "extLst", state.d.p)!;
      const index = ext.children.findIndex((node) => node.children.includes(remaining));
      xml = xml.spliceChildren(ext, index, 1, []);
      const remainingExtensions = only(xml.root, "extLst", state.d.p)!;
      if (
        !remainingExtensions.children.length &&
        remainingExtensions.attributes.every(
          (a) => a.name.namespace === "http://www.w3.org/2000/xmlns/"
        )
      )
        xml = xml.spliceChildren(xml.root, xml.root.children.indexOf(remainingExtensions), 1, []);
    }
  }
  const original = reader.get(main),
    changed = xml.bytes();
  if (
    original.length === changed.length &&
    original.every((value, index) => value === changed[index])
  )
    return source;
  const output = await writePackageArchive(
    reader.names.map((name) => ({
      name: name.slice(1),
      bytes: name === main ? xml.bytes() : reader.get(name)
    })),
    context,
    { compression: "auto", source }
  );
  if (!validatePresentation(await readPackage(output, context), limits).valid)
    fail("invalid-opc", "Changed memberships fail graph validation.");
  return output;
}

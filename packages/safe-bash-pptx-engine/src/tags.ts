import type { BinaryInput, Location } from "./contracts.js";
import { OfficeError } from "./errors.js";
import { attr, child, escape, invalid, loadShared, nextRel, relPart } from "./masters.js";
import { relativePartReference } from "./package-uri.js";
import { decodeSelectionToken, SelectionError, type SelectionContext, type SelectionQuery } from "./selectors.js";
import { parseXmlPart } from "./xml.js";

export interface TagRecord {
  readonly name: string;
  readonly value: string;
  readonly part: string;
  readonly owner: string;
  readonly slide: number | null;
  readonly selector: string;
  readonly location: Location;
}
export interface TagOptions {
  readonly scope?: "slides" | "presentation";
  readonly selection?: SelectionQuery;
  readonly name?: string;
  readonly value?: string;
  readonly allowEmpty?: boolean;
}
type State = Awaited<ReturnType<typeof loadShared>>;
const relns = "http://schemas.openxmlformats.org/package/2006/relationships";

function validate(options: TagOptions, action?: string) {
  if (!options || ![Object.prototype, null].includes(Object.getPrototypeOf(options)) ||
    Object.keys(options).some((key) => !["scope", "selection", "name", "value", "allowEmpty"].includes(key)) ||
    (options.scope !== undefined && !["presentation", "slides"].includes(options.scope)) ||
    (options.allowEmpty !== undefined && typeof options.allowEmpty !== "boolean")) invalid("Invalid tag options.");
  if (options.scope === "presentation" && options.selection && Object.keys(options.selection).some((key) => key !== "all" && key !== "token")) invalid("Presentation tags do not accept slide selectors.");
  if (action === "add" && (options.name === undefined || options.value === undefined)) invalid("New tags require name and value.");
  if (action === "set" && options.name === undefined && options.value === undefined) invalid("A tag edit requires name or value.");
  for (const value of [options.name, options.value]) {
    if (value === undefined) continue;
    if (typeof value !== "string") invalid("Tag fields require strings.");
    for (const c of value) {
      const n = c.codePointAt(0)!;
      if ((n < 32 && ![9, 10, 13].includes(n)) || (n >= 0xd800 && n <= 0xdfff) || n === 0xfffe || n === 0xffff) invalid("Tag fields require XML characters.");
    }
  }
  if (options.name === "") invalid("Tag names cannot be empty.");
  if (!action && (options.name !== undefined || options.value !== undefined || options.allowEmpty !== undefined)) invalid("Tag reads accept selection and scope only.");
  if (action === "remove" && (options.name !== undefined || options.value !== undefined)) invalid("Tag removal does not accept edit fields.");
}
function owners(s: State, options: TagOptions) {
  if (options.scope === "presentation") return [{ part: s.main, slide: null }];
  const selection = options.selection;
  return (selection ? s.index.select({ kind: "slide", ...selection }) : s.index.slides).map((record) => {
    if (record.kind !== "slide") throw new SelectionError("invalid-selection");
    return { part: record.part, slide: record.position };
  });
}
function association(s: State, owner: string) {
  const doc = s.doc(owner);
  const base = owner === s.main ? doc.root : child(doc.root, "cSld");
  if (!base) invalid("Tag owner lacks common slide data.");
  const list = child(base, "custDataLst");
  const tags = list ? child(list, "tags") : undefined;
  if (!tags) return undefined;
  const id = tags.attributes.find((a) => a.name.namespace === s.r && a.name.localName === "id")?.value;
  const edges = s.index.inventory.relationships.filter((e) => e.owner === owner && e.id === id && e.type === `${s.r}/tags` && !e.external);
  if (edges.length !== 1 || !edges[0]!.targetPart) invalid("Invalid tag association.");
  return edges[0]!.targetPart;
}
function records(s: State, options: TagOptions): TagRecord[] {
  let token: Location | undefined;
  if (options.selection?.token) {
    if (Object.keys(options.selection).some((key) => key !== "token")) throw new SelectionError("invalid-selection");
    token = decodeSelectionToken(options.selection.token);
    if (token.fingerprint !== s.index.fingerprint) throw new SelectionError("stale-selection");
    if (token.scope !== "slides" && token.scope !== "presentation") throw new SelectionError("invalid-selection");
    if (options.scope !== undefined && options.scope !== token.scope) throw new SelectionError("invalid-selection");
  }
  const selected = owners(s, token ? { scope: token.scope as "slides" | "presentation" } : options);
  const result = selected.flatMap((owner) => {
    const part = association(s, owner.part);
    if (!part) return [];
    const doc = s.doc(part);
    if (doc.root.name.namespace !== s.p || doc.root.name.localName !== "tagLst") invalid("Invalid tag list.");
    return doc.root.children.flatMap((node, index) => {
      if (node.name.namespace !== s.p || node.name.localName !== "tag") return [];
      const name = attr(node, "name"), value = attr(node, "val");
      if (name === undefined || value === undefined) invalid("Tag requires name and value attributes.");
      const location: Location = { fingerprint: s.index.fingerprint, scope: owner.slide === null ? "presentation" : "slides", owner: owner.part, objectId: `tag:${part}:${index}`, coordinateSystem: "identity" };
      return [{ name, value, part, owner: owner.part, slide: owner.slide, selector: JSON.stringify(location), location }];
    });
  });
  return token ? result.filter((r) => r.selector === options.selection!.token) : result;
}
export async function readTags(input: BinaryInput, options: TagOptions, context: SelectionContext): Promise<readonly TagRecord[]> {
  validate(options);
  return records(await loadShared(input, context, false), options);
}
function createAssociation(s: State, owner: string, context: SelectionContext) {
  let n = 1;
  while (s.reader.has(`/ppt/tags/tag${n}.xml`) || s.changes.has(`/ppt/tags/tag${n}.xml`)) n++;
  const part = `/ppt/tags/tag${n}.xml`;
  s.save(part, parseXmlPart(new TextEncoder().encode(`<p:tagLst xmlns:p="${s.p}"/>`), context.xmlLimits));
  const types = s.doc("/[Content_Types].xml");
  s.save("/[Content_Types].xml", types.spliceChildren(types.root, types.root.children.length, 0, [`<Override xmlns="${types.root.name.namespace}" PartName="${part}" ContentType="application/vnd.openxmlformats-officedocument.presentationml.tags+xml"/>`]));
  const relName = relPart(owner);
  const rels = s.reader.has(relName) ? s.doc(relName) : parseXmlPart(new TextEncoder().encode(`<Relationships xmlns="${relns}"/>`), context.xmlLimits);
  const id = nextRel(rels);
  s.save(relName, rels.spliceChildren(rels.root, rels.root.children.length, 0, [`<Relationship xmlns="${relns}" Id="${id}" Type="${s.r}/tags" Target="${escape(relativePartReference(part, owner.slice(0, owner.lastIndexOf("/"))))}"/>`]));
  let doc = s.doc(owner);
  let base = owner === s.main ? doc.root : child(doc.root, "cSld")!;
  let list = child(base, "custDataLst");
  if (!list) {
    const order = owner === s.main ? ["sldMasterIdLst", "notesMasterIdLst", "handoutMasterIdLst", "sldIdLst", "sldSz", "notesSz", "smartTags", "embeddedFontLst", "custShowLst", "photoAlbum", "custDataLst", "kinsoku", "defaultTextStyle", "modifyVerifier", "extLst"] : ["bg", "spTree", "custDataLst", "controls", "extLst"];
    doc = doc.merge(base, { children: { sequence: order.map((localName) => ({ namespace: s.p, localName })), upsert: [{ name: { namespace: s.p, localName: "custDataLst" }, merge: {} }] } });
    base = owner === s.main ? doc.root : child(doc.root, "cSld")!;
    list = child(base, "custDataLst")!;
  }
  s.save(owner, doc.spliceChildren(list, list.children.length, 0, [`<p:tags xmlns:p="${s.p}" xmlns:r="${s.r}" r:id="${id}"/>`]));
  return part;
}
export async function mutateTags(input: BinaryInput, action: "add" | "set" | "remove", options: TagOptions, context: SelectionContext): Promise<{ bytes: Uint8Array; affected: number; locations: readonly Location[] }> {
  if (!["add", "set", "remove"].includes(action)) invalid("Invalid tag action.");
  validate(options, action);
  if ((options.name?.length ?? 0) + (options.value?.length ?? 0) > context.xmlLimits.maxBytes) throw new OfficeError("resource-limit", "Tag exceeds XML limits.", "usage");
  if (!options.selection && options.scope !== "presentation") throw new SelectionError("missing-selection");
  const s = await loadShared(input, context);
  const existing = records(s, options);
  const locations: Location[] = [];
  if (action === "add") {
    if (options.selection?.token) throw new SelectionError("invalid-selection");
    const selected = owners(s, options);
    if (!selected.length && !options.allowEmpty) throw new SelectionError("missing-selection");
    for (const owner of selected) {
      if (existing.some((r) => r.owner === owner.part && r.name === options.name)) invalid("Duplicate tag name.");
      const part = association(s, owner.part) ?? createAssociation(s, owner.part, context);
      if (s.index.inventory.relationships.filter((e) => e.targetPart === part).length > 1) throw new OfficeError("unsupported-edit", "Shared tag lists cannot be edited.", "validate-intent");
      const doc = s.doc(part);
      const location: Location = { fingerprint: s.index.fingerprint, scope: owner.slide === null ? "presentation" : "slides", owner: owner.part, objectId: `tag:${part}:${doc.root.children.length}`, coordinateSystem: "identity" };
      s.save(part, doc.spliceChildren(doc.root, doc.root.children.length, 0, [`<p:tag xmlns:p="${s.p}" name="${escape(options.name!)}" val="${escape(options.value!)}"/>`]));
      locations.push(location);
    }
  } else {
    if (!existing.length && !options.allowEmpty) throw new SelectionError("missing-selection");
    if (existing.length > 1 && !options.selection?.all) throw new SelectionError("ambiguous-selection");
    if (options.name !== undefined) {
      const all = records(s, { scope: existing[0]?.location.scope as "slides" | "presentation" });
      for (const record of existing) if (all.some((r) => r.owner === record.owner && r.name === options.name && r.selector !== record.selector)) invalid("Duplicate tag name.");
      if (existing.some((r, i) => existing.slice(0, i).some((v) => v.owner === r.owner))) invalid("Duplicate tag name.");
    }
    for (const record of [...existing].reverse()) {
      if (s.index.inventory.relationships.filter((e) => e.targetPart === record.part).length > 1) throw new OfficeError("unsupported-edit", "Shared tag lists cannot be edited.", "validate-intent");
      const doc = s.doc(record.part);
      const index = Number(record.location.objectId!.slice(record.location.objectId!.lastIndexOf(":") + 1));
      const node = doc.root.children[index]!;
      if (action === "remove" && (node.children.length || node.attributes.some(a => a.name.namespace !== "" || !["name", "val"].includes(a.name.localName)))) throw new OfficeError("unsupported-edit", "Decorated tags are preserved on removal.", "validate-intent");
      s.save(record.part, action === "remove" ? doc.spliceChildren(doc.root, index, 1, []) : doc.merge(doc.root.children[index]!, { attributes: [...(options.name === undefined ? [] : [{ namespace: "", localName: "name", value: options.name }]), ...(options.value === undefined ? [] : [{ namespace: "", localName: "val", value: options.value }])] }));
      locations.push(record.location);
    }
  }
  const result = await s.finish(s.main, []);
  return { bytes: result.bytes, affected: locations.length, locations };
}

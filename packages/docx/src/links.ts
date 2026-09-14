import { archiveSettings, type ArchiveContext, type DocumentArchive } from "./archive.js";
import { DocxUsageError } from "./argument-json.js";
import { validateDocxInvocation } from "./command.js";
import { xmlValue } from "./create-content.js";
import { dialectForNamespace, documentDialects } from "./dialect.js";
import { addressKey, LocationIndex } from "./location-index.js";
import { closedRecord, encodeLocation, type Location } from "./location-token.js";
import { openDocumentLocations } from "./locations.js";
import type { DocxOperationArguments } from "./operation-types.js";
import { DocumentPackage } from "./package.js";
import { parseDocumentXml, type XmlElement } from "./package-xml.js";
import { paragraphTextRun } from "./paragraph-content.js";
import { assertDocumentEditable, publishDocumentArchive, type PublicationContext, type PublicationInput } from "./publication.js";
import { runElementOpen } from "./run-properties.js";
import { resolveDocxSelection } from "./simple-selection.js";
import { DocumentXmlEditor, UnsupportedEditError } from "./xml-write.js";

export type LinkEditOperation = "links.add" | "links.set" | "links.remove";
export type LinkEditRequest = { [K in LinkEditOperation]: { readonly operation: K; readonly options: DocxOperationArguments<K>; readonly input?: PublicationInput } }[LinkEditOperation];
export interface LinkEditData {
  readonly changed: boolean;
  readonly changes: readonly { readonly kind: "insert" | "target" | "unwrap" | "remove"; readonly before: Location; readonly after: Location }[];
  readonly output: { readonly path: string | null; readonly bytes: number; readonly sha256: string } | null;
  readonly dryRun: boolean;
}
export interface LinkListData {
  readonly items: readonly { readonly location: Location<"link">; readonly text: string; readonly address: string; readonly fragment: string; readonly url: string; readonly history: boolean; readonly contains_page_break: boolean }[];
}
const relationshipsNamespace = "http://schemas.openxmlformats.org/package/2006/relationships";
const attribute = (node: XmlElement | undefined, namespace: string, name: string) => node?.attributes.find(a => a.namespace === namespace && a.localName === name)?.value;

/** Noncreating, inert link inventory with distinct stored address and anchor values. */
export async function inspectDocumentLinks(input: Uint8Array, options: DocxOperationArguments<"links.list">, context: ArchiveContext): Promise<LinkListData> {
  const settings = archiveSettings(context);
  const invocation = validateDocxInvocation({ operation: "links.list", inputs: ["document"], options }, settings.budget);
  const budget = settings.budget.lower(Object.fromEntries((options.limit ?? []).map(item => [item.name, item.value])));
  const document = await openDocumentLocations(input, { ...settings, budget });
  const selected = resolveDocxSelection(document, invocation);
  budget.check("matches", selected.length);
  const archive = document.snapshot();
  const graph = new DocumentPackage(archive, settings.limits, budget);
  const roots = new Map<string, XmlElement>();
  const items: LinkListData["items"][number][] = [];
  for (const location of selected) {
    await budget.checkpoint();
    let root = roots.get(location.value.part);
    if (!root) { root = parseDocumentXml(graph.getPart(location.value.part).bytes, {}, budget).root; roots.set(location.value.part, root); }
    let node = root;
    for (const i of location.value.path) node = node.children[i]!;
    const { w, r } = documentDialects[dialectForNamespace(node.namespace)!];
    const id = attribute(node, r, "id");
    const edge = id === undefined ? undefined : graph.relationships(location.value.part).find(e => e.rId === id);
    if (edge && (edge.reltype !== r + "/hyperlink" || !edge.is_external)) throw new UnsupportedEditError("Link target relationship must be external or use an internal anchor.");
    const address = edge?.target_ref ?? "", fragment = attribute(node, w, "anchor") ?? "";
    let text = "", contains_page_break = false;
    const visit = (current: XmlElement) => {
      budget.charge("work", 1);
      if (current.namespace !== w) return;
      if (current.localName === "t") text += current.text;
      else if (current.localName === "tab") text += "\t";
      else if (current.localName === "cr" || current.localName === "br" && (!attribute(current, w, "type") || attribute(current, w, "type") === "textWrapping")) text += "\n";
      else if (current.localName === "lastRenderedPageBreak") contains_page_break = true;
      else if (["hyperlink", "r"].includes(current.localName)) for (const child of current.children) visit(child);
    };
    visit(node);
    items.push({ location: location as Location<"link">, text, address, fragment, url: address ? address + (fragment ? "#" + fragment : "") : "", history: !["0", "false", "off"].includes(attribute(node, w, "history") ?? "true"), contains_page_break });
  }
  const data = { items };
  budget.check("serializedOutput", new TextEncoder().encode(JSON.stringify({ version: 1, operation: "links.list", ok: true, data, affected: 0, locations: items.map(i => i.location), warnings: [], errors: [] }) + "\n").length);
  return data;
}

/** Link edits preserve label XML and collect only unused relationships in their owner. */
export async function editDocumentLinks(input: Uint8Array, request: LinkEditRequest, context: PublicationContext): Promise<LinkEditData> {
  closedRecord(request, ["operation", "options", "input"]);
  if (!["links.add", "links.set", "links.remove"].includes(request.operation)) throw new DocxUsageError("Expected a link editing operation.");
  const settings = archiveSettings(context);
  const invocation = validateDocxInvocation({ operation: request.operation, inputs: [request.input?.path ?? "document"], options: request.options }, settings.budget);
  const options = invocation.options as DocxOperationArguments<"links.add"> & DocxOperationArguments<"links.remove">;
  const budget = settings.budget.lower(Object.fromEntries((options.limit ?? []).map(item => [item.name, item.value])));
  const document = await openDocumentLocations(input, { ...settings, budget });
  const selected = resolveDocxSelection(document, invocation);
  budget.check("matches", selected.length);
  let archive = document.snapshot();
  assertDocumentEditable(archive, { ...settings, budget });
  const main = document.list("story", { scope: "body" })[0]!.value.part.slice(1);
  const dialect = dialectForNamespace(parseDocumentXml(archive.members.find(m => m.name === main)!.bytes, {}, budget).root.namespace)!;
  const { w, r } = documentDialects[dialect];
  const members = new Map(archive.members.map(m => [m.name, m]));
  const grouped = new Map<string, Location[]>();
  for (const location of selected) grouped.set(location.value.part, [...grouped.get(location.value.part) ?? [], location]);
  const updates: { before: Location; path: readonly number[]; kind: LinkEditData["changes"][number]["kind"]; locationKind: "link" | "paragraph" }[] = [];
  for (const [part, locations] of grouped) {
    const name = part.slice(1), member = members.get(name)!;
    let xml = new DocumentXmlEditor(member.bytes, {}, undefined, budget);
    const split = name.lastIndexOf("/");
    const relName = name.slice(0, split + 1) + "_rels/" + name.slice(split + 1) + ".rels";
    const relMember = members.get(relName);
    let rels = new DocumentXmlEditor(relMember?.bytes ?? new TextEncoder().encode(`<Relationships xmlns="${relationshipsNamespace}"/>`), {}, undefined, budget);
    const retired = new Set<string>(), reserved = new Set<string>();
    const references = (root: XmlElement) => {
      const ids = new Set<string>();
      const visit = (node: XmlElement) => {
        budget.charge("work", 1);
        for (const a of node.attributes) if (a.namespace === r) ids.add(a.value);
        for (const child of node.children) visit(child);
      };
      visit(root); return ids;
    };
    for (const id of references(xml.root)) reserved.add(id);
    for (const edge of rels.root.children) reserved.add(attribute(edge, "", "Id")!);
    // Descending paths keep every not-yet-edited input address stable during unwrapping.
    locations.sort((a, b) => {
      const left = a.value.path, right = b.value.path;
      for (let i = 0; i < Math.min(left.length, right.length); i++) if (left[i] !== right[i]) return right[i]! - left[i]!;
      return right.length - left.length;
    });
    for (const before of locations) {
      await budget.checkpoint();
      let node = xml.root, parent = node;
      const ancestors = [node];
      for (const position of before.value.path) { parent = node; node = node.children[position]!; ancestors.push(node); }
      if (ancestors.some(n => n.namespace === w && ["ins", "del", "moveFrom", "moveTo", "sdt", "fldSimple"].includes(n.localName))) throw new UnsupportedEditError("Links inside tracked or controlled content require dedicated operations.");
      const adding = request.operation === "links.add";
      if (node.namespace !== w || (adding ? node.localName !== "p" : node.localName !== "hyperlink" || parent.namespace !== w || parent.localName !== "p")) throw new UnsupportedEditError("Link insertion requires a paragraph; link edits require a direct paragraph hyperlink.");
      const oldId = attribute(node, r, "id"), anchor = attribute(node, w, "anchor");
      const oldEdge = rels.root.children.find(e => attribute(e, "", "Id") === oldId);
      if (oldEdge && (attribute(oldEdge, "", "Type") !== r + "/hyperlink" || attribute(oldEdge, "", "TargetMode") !== "External")) throw new UnsupportedEditError("Unsupported link relationship.");
      if (!adding && request.operation === "links.set" && attribute(node, w, "docLocation") === undefined && (options.target !== undefined ? attribute(oldEdge, "", "Target") === options.target && anchor === undefined : anchor === options.bookmark && oldId === undefined)) continue;
      let destination = "";
      if (request.operation !== "links.remove") {
        if (options.target !== undefined) {
          const edge = rels.root.children.find(e => attribute(e, "", "Type") === r + "/hyperlink" && attribute(e, "", "TargetMode") === "External" && attribute(e, "", "Target") === options.target);
          let id = edge && attribute(edge, "", "Id");
          if (!id) {
            let n = 1; while (reserved.has("rId" + n)) { budget.charge("work", 1); n++; }
            id = "rId" + n; reserved.add(id);
            rels.insertChildren(rels.root, `<Relationship xmlns="${relationshipsNamespace}" Id="${id}" Type="${r}/hyperlink" Target="${xmlValue(options.target)}" TargetMode="External"/>`);
            rels = new DocumentXmlEditor(rels.serialize(), {}, undefined, budget);
          }
          destination = ` xmlns:lr="${r}" lr:id="${id}"`;
        } else destination = ` xmlns:lw="${w}" lw:anchor="${xmlValue(options.bookmark!)}"`;
      }
      if (adding) {
        const path = [...before.value.path, node.children.length];
        xml.insertChildren(node, `<lh:hyperlink xmlns:lh="${w}"${destination}>${paragraphTextRun(w, options.text)}</lh:hyperlink>`);
        updates.push({ before, path, kind: "insert", locationKind: "link" });
      } else if (request.operation === "links.set") {
        const open = runElementOpen({ ...node, attributes: node.attributes.filter(a => !(a.namespace === r && a.localName === "id") && !(a.namespace === w && ["anchor", "docLocation"].includes(a.localName))) });
        // Prefixes are chosen from the existing bindings to avoid shadowing label namespaces.
        const targetAttribute = options.target !== undefined ? { namespace: r, name: "id", value: attribute(rels.root.children.find(e => attribute(e, "", "Type") === r + "/hyperlink" && attribute(e, "", "TargetMode") === "External" && attribute(e, "", "Target") === options.target)!, "", "Id")! } : { namespace: w, name: "anchor", value: options.bookmark! };
        let prefix = [...node.namespaces].find(([p, ns]) => p && ns === targetAttribute.namespace)?.[0];
        if (!prefix) { prefix = "link"; while (node.namespaces.has(prefix)) prefix += "x"; }
        const declaration = node.namespaces.get(prefix) === targetAttribute.namespace ? "" : ` xmlns:${prefix}="${targetAttribute.namespace}"`;
        xml.replaceElement(node, open.slice(0, -1) + declaration + ` ${prefix}:${targetAttribute.name}="${xmlValue(targetAttribute.value)}">` + xml.sourceXml(node, new Map(), true) + `</${node.name}>`);
        updates.push({ before, path: before.value.path, kind: "target", locationKind: "link" });
      } else {
        const bindingsChanged = [...node.namespaces].some(([prefix, uri]) => parent.namespaces.get(prefix) !== uri);
        const inherited = node.attributes.filter(a => a.namespace === "http://www.w3.org/XML/1998/namespace" && ["space", "lang"].includes(a.localName));
        const label = options.deleteContent ? "" : xml.sourceXml(node, bindingsChanged || inherited.length ? new Map(node.children.map(child => {
          const attributes = [...child.attributes, ...inherited.filter(a => !child.attributes.some(b => b.namespace === a.namespace && b.localName === a.localName))];
          return [child, runElementOpen({ ...child, attributes }) + xml.sourceXml(child, new Map(), true) + `</${child.name}>`];
        })) : new Map(), true);
        xml.replaceElement(node, label);
        updates.push({ before, path: before.value.path.slice(0, -1), kind: options.deleteContent ? "remove" : "unwrap", locationKind: "paragraph" });
      }
      if (oldId) retired.add(oldId);
      xml = new DocumentXmlEditor(xml.serialize(), {}, undefined, budget);
    }
    const used = references(xml.root);
    for (const edge of rels.root.children) if (retired.has(attribute(edge, "", "Id")!) && !used.has(attribute(edge, "", "Id")!)) rels.replaceElement(edge, "");
    members.set(name, { ...member, bytes: xml.serialize() });
    if (relMember || rels.root.children.length) members.set(relName, { ...(relMember ?? { name: relName, directory: false, modified: new Date("1980-01-01T00:00:00Z") }), bytes: rels.serialize() });
  }
  archive = { ...archive, members: [...members.values()] } satisfies DocumentArchive;
  const index = new LocationIndex(archive, settings.limits, main, dialect, budget);
  const changes = updates.sort((a, b) => selected.indexOf(a.before) - selected.indexOf(b.before)).map(({ before, path, kind, locationKind }) => {
    const entry = index.byAddress.get(addressKey({ ...before.value, path }))?.find(e => e.kind === locationKind);
    if (!entry) throw new UnsupportedEditError("Link edit could not resolve its resulting location.");
    const value = { ...before.value, generation: 1, path, range: null };
    const after = { kind: locationKind, value, token: encodeLocation(value), positions: entry.positions } as Location;
    return { kind, before, after };
  });
  const publication = { ...(request.input ? { input: request.input } : {}), ...(options.output === undefined ? {} : { output: options.output }), ...(options.inPlace === undefined ? {} : { inPlace: options.inPlace }), ...(options.force === undefined ? {} : { force: options.force }), ...(options.dryRun === undefined ? {} : { dryRun: options.dryRun }), ...(options.json === undefined ? {} : { json: options.json }) };
  const prospective = { changed: changes.length > 0, changes, dryRun: options.dryRun ?? false, output: options.dryRun ? null : { path: options.inPlace ? request.input?.path ?? null : options.output === "-" ? null : options.output ?? null, bytes: settings.limits.maxArchiveBytes, sha256: "0".repeat(64) } };
  budget.check("serializedOutput", new TextEncoder().encode(JSON.stringify({ version: 1, operation: request.operation, ok: true, data: prospective, affected: changes.length, locations: changes.map(c => c.after), warnings: [], errors: [] }) + "\n").length);
  const result = await publishDocumentArchive(archive, publication, { ...context, budget });
  return { changed: changes.length > 0, changes, dryRun: options.dryRun ?? false, output: result.published.length ? { path: result.published[0]!.path, bytes: result.published[0]!.bytes, sha256: result.archiveSha256! } : null };
}

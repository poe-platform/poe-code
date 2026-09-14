import { archiveSettings, type ArchiveContext, type DocumentArchive } from "./archive.js";
import { readDocumentArchive } from "./admission.js";
import { DocxUsageError } from "./argument-json.js";
import { DocumentBudget } from "./budget.js";
import { updateBookmarkReferences } from "./bookmark-references.js";
import { validateDocxInvocation } from "./command.js";
import { xmlValue } from "./create-content.js";
import { dialectForNamespace } from "./dialect.js";
import { closedRecord, encodeLocation, type Location } from "./location-token.js";
import { openDocumentLocations } from "./locations.js";
import type { DocxOperationArguments } from "./operation-types.js";
import { DocumentPackage } from "./package.js";
import type { XmlElement } from "./package-xml.js";
import { splitParagraphContent } from "./paragraph-content.js";
import { assertDocumentEditable, publishDocumentArchive, type PublicationContext, type PublicationInput } from "./publication.js";
import { runElementOpen } from "./run-properties.js";
import { resolveDocxSelection } from "./simple-selection.js";
import { DocumentXmlEditor, UnsupportedEditError } from "./xml-write.js";

export type BookmarkEditOperation = "bookmarks.add" | "bookmarks.set" | "bookmarks.remove";
export type BookmarkEditRequest = { [K in BookmarkEditOperation]: { readonly operation: K; readonly options: DocxOperationArguments<K>; readonly input?: PublicationInput } }[BookmarkEditOperation];
export interface BookmarkEditData {
  readonly changed: boolean;
  readonly changes: readonly { readonly kind: "insert" | "rename" | "remove"; readonly before: Location; readonly after: Location }[];
  readonly output: { readonly path: string | null; readonly bytes: number; readonly sha256: string } | null;
  readonly dryRun: boolean;
}
export interface BookmarkListData {
  readonly items: readonly { readonly location: Location<"bookmark">; readonly name: string; readonly id: string; readonly end: { readonly part: string; readonly path: readonly number[] } | null; readonly issues: readonly string[] }[];
  readonly issues: readonly string[];
}
interface Marker { part: string; path: readonly number[]; node: XmlElement; parent: XmlElement; container: XmlElement; order: number; id: string; name: string; issues: string[]; end?: Marker }
const attr = (node: XmlElement, name: string) => node.attributes.find(a => a.namespace === node.namespace && a.localName === name)?.value;
const identity = (part: string, path: readonly number[]) => JSON.stringify([part, path]);
function validName(name: string): boolean {
  const letter = (c: string) => c >= "A" && c <= "Z" || c >= "a" && c <= "z";
  return name.length > 0 && name.length <= 40 && (letter(name[0]!) || name[0] === "_") && [...name].every(c => letter(c) || c >= "0" && c <= "9" || c === "_");
}

/** Inspect raw stored ranges, including inactive markup and otherwise unselected parts. */
function inventory(editors: ReadonlyMap<string, DocumentXmlEditor>, budget: DocumentBudget) {
  const starts: Marker[] = [], ends: Marker[] = [], issues: string[] = [];
  const report = (marker: Marker, issue: string) => { marker.issues.push(issue); issues.push(`${marker.part}: ${issue} (${marker.id})`); };
  for (const [part, editor] of editors) {
    let order = 0;
    const fieldDepth = new Map<XmlElement, number>();
    const visit = (node: XmlElement, parent: XmlElement, path: readonly number[], container: XmlElement, unsafe: boolean) => {
      budget.charge("work", 1);
      const word = dialectForNamespace(node.namespace) !== undefined;
      if (word && ["body", "hdr", "ftr", "footnote", "endnote", "comment", "tc", "txbxContent"].includes(node.localName)) container = node;
      if (word && node.localName === "fldChar") {
        const depth = fieldDepth.get(container) ?? 0;
        if (attr(node, "fldCharType") === "begin") fieldDepth.set(container, depth + 1);
        else if (attr(node, "fldCharType") === "end") fieldDepth.set(container, Math.max(0, depth - 1));
      }
      unsafe ||= word && ["ins", "del", "moveFrom", "moveTo", "sdt", "fldSimple", "hyperlink"].includes(node.localName);
      if (word && ["bookmarkStart", "bookmarkEnd"].includes(node.localName)) {
        const raw = attr(node, "id") ?? "";
        const valid = raw.length > 0 && [...raw].every(c => c >= "0" && c <= "9") && Number.isSafeInteger(Number(raw));
        const marker: Marker = { part, path, node, parent, container, order: order++, id: valid ? String(Number(raw)) : raw, name: attr(node, "name") ?? "", issues: [] };
        (node.localName === "bookmarkStart" ? starts : ends).push(marker);
        if (!valid) report(marker, "invalid-id");
        if (unsafe || (fieldDepth.get(container) ?? 0) > 0 || parent.namespace !== node.namespace || parent.localName !== "p" || node.children.length || node.content.some(c => c.kind !== "text" || c.text.trim()) || attr(node, "colFirst") !== undefined || attr(node, "colLast") !== undefined) report(marker, "illegal-boundary");
        if (node.localName === "bookmarkStart" && !validName(marker.name)) report(marker, "invalid-name");
      }
      node.children.forEach((child, index) => visit(child, node, [...path, index], container, unsafe));
    };
    visit(editor.root, editor.root, [], editor.root, false);
  }
  const startsById = new Map<string, Marker[]>(), endsById = new Map<string, Marker[]>(), names = new Map<string, Marker[]>();
  for (const marker of starts) { startsById.set(marker.id, [...startsById.get(marker.id) ?? [], marker]); names.set(marker.name, [...names.get(marker.name) ?? [], marker]); }
  for (const marker of ends) endsById.set(marker.id, [...endsById.get(marker.id) ?? [], marker]);
  for (const group of names.values()) if (group.length > 1) for (const marker of group) report(marker, "duplicate-name");
  for (const id of new Set([...startsById.keys(), ...endsById.keys()])) {
    const left = startsById.get(id) ?? [], right = endsById.get(id) ?? [];
    if (left.length > 1 || right.length > 1) for (const marker of [...left, ...right]) report(marker, "duplicate-id");
    if (!left.length) for (const marker of right) report(marker, "missing-start");
    if (!right.length) for (const marker of left) report(marker, "missing-end");
    if (left.length !== 1 || right.length !== 1) continue;
    const start = left[0]!, end = right[0]!;
    start.end = end;
    if (start.part !== end.part || start.container !== end.container) report(start, "illegal-boundary");
    else if (end.order < start.order) report(start, "end-before-start");
  }
  // A sorted sweep detects nested overlaps as well as non-nested crossings.
  for (const part of editors.keys()) {
    const active: Marker[] = [];
    for (const marker of [...starts, ...ends].filter(m => m.part === part).sort((a, b) => a.order - b.order)) {
      budget.charge("work", active.length + 1);
      if (marker.node.localName === "bookmarkStart") {
        if (marker.end) {
          for (const previous of active) {
            const issue = previous.end!.order < marker.end.order ? "crossing" : "overlap";
            report(previous, issue); report(marker, issue);
          }
          active.push(marker);
        }
      } else {
        const position = active.findIndex(m => m.end === marker);
        if (position >= 0) active.splice(position, 1);
      }
    }
  }
  return { starts, ends, issues };
}

function xmlEditors(archive: DocumentArchive, settings: ReturnType<typeof archiveSettings>, budget: DocumentBudget) {
  const graph = new DocumentPackage(archive, settings.limits, budget);
  return new Map(graph.parts.filter(p => p.content_type.toLowerCase().endsWith("+xml") || ["application/xml", "text/xml"].includes(p.content_type.toLowerCase()))
    .map(p => [p.partname, new DocumentXmlEditor(p.bytes, {}, undefined, budget)]));
}

export async function inspectDocumentBookmarks(input: Uint8Array, options: DocxOperationArguments<"bookmarks.list">, context: ArchiveContext): Promise<BookmarkListData> {
  const settings = archiveSettings(context);
  const invocation = validateDocxInvocation({ operation: "bookmarks.list", inputs: ["document"], options }, settings.budget);
  const budget = settings.budget.lower(Object.fromEntries((options.limit ?? []).map(item => [item.name, item.value])));
  const archive = await readDocumentArchive(input, { ...settings, budget });
  const found = inventory(xmlEditors(archive, settings, budget), budget);
  if (found.issues.length) {
    const data: BookmarkListData = { items: [], issues: found.issues };
    budget.check("serializedOutput", new TextEncoder().encode(JSON.stringify({ version: 1, operation: "bookmarks.list", ok: true, data, affected: 0, locations: [], warnings: [], errors: [] }) + "\n").length);
    return data;
  }
  const document = await openDocumentLocations(input, { ...settings, budget });
  const selected = resolveDocxSelection(document, invocation);
  budget.check("matches", selected.length);
  const markers = new Map(found.starts.map(m => [identity(m.part, m.path), m]));
  const items = selected.map(location => {
    const marker = markers.get(identity(location.value.part, location.value.path));
    if (!marker) throw new UnsupportedEditError("Bookmark start cannot be resolved.");
    return { location: location as Location<"bookmark">, name: marker.name, id: marker.id, end: marker.end ? { part: marker.end.part, path: marker.end.path } : null, issues: marker.issues };
  });
  const data = { items, issues: found.issues };
  budget.check("serializedOutput", new TextEncoder().encode(JSON.stringify({ version: 1, operation: "bookmarks.list", ok: true, data, affected: 0, locations: selected, warnings: [], errors: [] }) + "\n").length);
  return data;
}

function insertRange(editor: DocumentXmlEditor, p: XmlElement, from: number, to: number, id: string, name: string, budget: DocumentBudget): void {
  if (p.localName !== "p" || from >= to) throw new UnsupportedEditError("Bookmark creation requires a nonempty paragraph text range.");
  const markers = new Set(["bookmarkStart", "bookmarkEnd", "commentRangeStart", "commentRangeEnd", "proofErr", "permStart", "permEnd"]);
  const patches = new Map<XmlElement, string>();
  let offset = 0, began = false, ended = false;
  const start = `<bm:bookmarkStart xmlns:bm="${p.namespace}" bm:id="${id}" bm:name="${xmlValue(name)}"/>`;
  const end = `<bm:bookmarkEnd xmlns:bm="${p.namespace}" bm:id="${id}"/>`;
  for (const child of p.children) {
    budget.charge("work", 1);
    if (child.namespace === p.namespace && (child.localName === "pPr" || markers.has(child.localName))) continue;
    if (child.namespace !== p.namespace || child.localName !== "r") throw new UnsupportedEditError("Bookmark creation requires simple runs without fields, links or controlled content.");
    const count = child.children.reduce((sum, leaf) => sum + (leaf.localName === "rPr" ? 0 : leaf.localName === "t" ? [...leaf.text].length : 1), 0);
    // The existing scalar splitter validates supported run leaves and preserves formatting.
    const single = { ...p, children: [child], content: [child] };
    splitParagraphContent(editor, single, 0);
    const left = Math.max(0, Math.min(count, from - offset));
    const right = Math.max(0, Math.min(count, to - offset));
    const startHere: boolean = !began && from >= offset && from < offset + count;
    const endHere: boolean = !ended && to > offset && to <= offset + count;
    if (startHere || endHere) {
      let content = "";
      if (startHere && endHere) {
        const [prefix, rest] = splitParagraphContent(editor, single, left);
        const temporary = new DocumentXmlEditor(new TextEncoder().encode(runElementOpen(p) + rest + `</${p.name}>`), {}, undefined, budget);
        const [middle, suffix] = splitParagraphContent(temporary, temporary.root, right - left);
        content = prefix + start + middle + end + suffix;
      } else if (startHere) { const [prefix, suffix] = splitParagraphContent(editor, single, left); content = prefix + start + suffix; }
      else { const [prefix, suffix] = splitParagraphContent(editor, single, right); content = prefix + end + suffix; }
      patches.set(child, content);
      began ||= startHere; ended ||= endHere;
    }
    offset += count;
  }
  if (!began || !ended) throw new UnsupportedEditError("Bookmark range exceeds admitted paragraph text.");
  editor.replaceElement(p, runElementOpen(p) + editor.sourceXml(p, patches, true) + `</${p.name}>`);
}

export async function editDocumentBookmarks(input: Uint8Array, request: BookmarkEditRequest, context: PublicationContext): Promise<BookmarkEditData> {
  closedRecord(request, ["operation", "options", "input"]);
  if (!["bookmarks.add", "bookmarks.set", "bookmarks.remove"].includes(request.operation)) throw new DocxUsageError("Expected a bookmark editing operation.");
  const settings = archiveSettings(context);
  const invocation = validateDocxInvocation({ operation: request.operation, inputs: [request.input?.path ?? "document"], options: request.options }, settings.budget);
  const options = invocation.options as DocxOperationArguments<"bookmarks.set"> & DocxOperationArguments<"bookmarks.remove">;
  const budget = settings.budget.lower(Object.fromEntries((options.limit ?? []).map(item => [item.name, item.value])));
  const document = await openDocumentLocations(input, { ...settings, budget });
  const selected = resolveDocxSelection(document, invocation);
  budget.check("matches", selected.length);
  let archive = document.snapshot();
  assertDocumentEditable(archive, { ...settings, budget });
  const editors = xmlEditors(archive, settings, budget);
  const found = inventory(editors, budget);
  if (found.issues.length) throw new UnsupportedEditError("Bookmark structure is unsafe: " + found.issues.join("; "));
  const before = selected[0]!;
  if (selected.length !== 1) throw new UnsupportedEditError("Bookmark edits require exactly one selection.");
  const editor = editors.get(before.value.part)!;
  let node = editor.root;
  const ancestors = [node];
  for (const index of before.value.path) { node = node.children[index]!; ancestors.push(node); }
  if (ancestors.some(n => dialectForNamespace(n.namespace) && ["ins", "del", "moveFrom", "moveTo", "sdt", "fldSimple", "hyperlink"].includes(n.localName))) throw new UnsupportedEditError("Bookmark edits cannot cross tracked or controlled content.");
  const adding = request.operation === "bookmarks.add", removing = request.operation === "bookmarks.remove";
  const marker = found.starts.find(m => identity(m.part, m.path) === identity(before.value.part, before.value.path));
  if (!adding && !marker) throw new UnsupportedEditError("Bookmark selection cannot be resolved.");
  if (!removing && (!validName(options.name) || found.starts.some(m => m !== marker && m.name === options.name))) throw new UnsupportedEditError("Bookmark names must be legal and unique across the document.");
  let changed = true;
  if (adding) {
    const range = before.value.range;
    if (!range) throw new UnsupportedEditError("Bookmark creation requires a selected text range.");
    const used = new Set(found.starts.map(m => m.id));
    let id = 0; while (used.has(String(id))) { budget.charge("work", 1); id++; }
    insertRange(editor, node, range.start, range.end, String(id), options.name, budget);
  } else if (!removing && marker!.name === options.name) changed = false;
  else {
    updateBookmarkReferences(editors, marker!.name, removing ? null : options.name, options.references, budget);
    if (removing) {
      editor.replaceElement(marker!.node, "");
      editors.get(marker!.end!.part)!.replaceElement(marker!.end!.node, "");
    } else editor.setAttribute(marker!.node, { namespace: marker!.node.namespace, localName: "name" }, options.name);
  }
  archive = { ...archive, members: archive.members.map(member => {
    const xml = editors.get("/" + member.name); return xml ? { ...member, bytes: xml.serialize() } : member;
  }) };
  const finalEditors = xmlEditors(archive, settings, budget), finalInventory = inventory(finalEditors, budget);
  if (finalInventory.issues.length) throw new UnsupportedEditError("Bookmark mutation would create overlapping or invalid ranges.");
  let after = before;
  if (changed) {
    const path = removing ? before.value.path.slice(0, -1) : finalInventory.starts.find(m => m.name === options.name)!.path;
    const value = { ...before.value, generation: before.value.generation + 1, path, range: null };
    after = { kind: removing ? "paragraph" : "bookmark", value, token: encodeLocation(value), positions: before.positions } as Location;
  }
  const changes: BookmarkEditData["changes"] = changed ? [{ kind: adding ? "insert" : removing ? "remove" : "rename", before, after }] : [];
  const publication = { ...(request.input ? { input: request.input } : {}), ...(options.output === undefined ? {} : { output: options.output }), ...(options.inPlace === undefined ? {} : { inPlace: options.inPlace }), ...(options.force === undefined ? {} : { force: options.force }), ...(options.dryRun === undefined ? {} : { dryRun: options.dryRun }), ...(options.json === undefined ? {} : { json: options.json }) };
  const prospective = { changed, changes, dryRun: options.dryRun ?? false, output: options.dryRun ? null : { path: options.inPlace ? request.input?.path ?? null : options.output === "-" ? null : options.output ?? null, bytes: settings.limits.maxArchiveBytes, sha256: "0".repeat(64) } };
  budget.check("serializedOutput", new TextEncoder().encode(JSON.stringify({ version: 1, operation: request.operation, ok: true, data: prospective, affected: changes.length, locations: changes.map(c => c.after), warnings: [], errors: [] }) + "\n").length);
  const result = await publishDocumentArchive(archive, publication, { ...context, budget });
  return { changed, changes, dryRun: options.dryRun ?? false, output: result.published.length ? { path: result.published[0]!.path, bytes: result.published[0]!.bytes, sha256: result.archiveSha256! } : null };
}

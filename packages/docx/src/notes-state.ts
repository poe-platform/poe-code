import { archiveSettings, type ArchiveContext } from "./archive.js";
import { documentDialects, dialectForNamespace } from "./dialect.js";
import { type Location } from "./location-token.js";
import { openDocumentLocations } from "./locations.js";
import { DocumentPackage } from "./package.js";
import { InvalidPackageError, type XmlElement } from "./package-xml.js";
import { DocumentXmlEditor } from "./xml-write.js";

export type NoteKind = "footnote" | "endnote";
export interface NoteNumbering { readonly format: string; readonly start: number; readonly restart: string }
export interface NoteReference {
  readonly kind: NoteKind;
  readonly id: number;
  readonly node: XmlElement;
  readonly editor: DocumentXmlEditor;
  readonly path: readonly number[];
  readonly part: string;
  readonly location: Location | undefined;
  readonly safe: boolean;
}
export interface NoteRecord {
  readonly kind: NoteKind;
  readonly id: number;
  readonly type: string;
  readonly node: XmlElement;
  readonly editor: DocumentXmlEditor;
  readonly part: string;
  readonly location: Location | undefined;
  readonly references: NoteReference[];
}
export function noteAttribute(node: XmlElement, name: string): string | undefined {
  return node.attributes.find(a => a.namespace === node.namespace && a.localName === name)?.value;
}
function idOf(node: XmlElement): number {
  const raw = noteAttribute(node, "id");
  const digits = raw?.startsWith("-") || raw?.startsWith("+") ? raw.slice(1) : raw;
  if (!digits || [...digits].some(c => c < "0" || c > "9") || !Number.isSafeInteger(Number(raw)) || Number(raw) < -1)
    throw new InvalidPackageError("Note IDs must be bounded integers with an explicit value.");
  return Number(raw);
}
function numbering(node: XmlElement | undefined, kind: NoteKind, fallback: NoteNumbering): NoteNumbering {
  const properties = node?.children.filter(n => n.namespace === node.namespace && n.localName === kind + "Pr") ?? [];
  if (properties.length > 1) throw new InvalidPackageError("Duplicate note numbering properties.");
  const values = (name: string) => {
    const nodes = properties[0]?.children.filter(n => n.namespace === properties[0]!.namespace && n.localName === name) ?? [];
    if (nodes.length > 1) throw new InvalidPackageError("Duplicate note numbering rule.");
    const value = nodes[0] && noteAttribute(nodes[0], "val");
    if (nodes.length && !value) throw new InvalidPackageError("Note numbering rules require a value.");
    return value;
  };
  const start = values("numStart"), restart = values("numRestart");
  if (start !== undefined && (!start || [...start].some(c => c < "0" || c > "9") || !Number.isSafeInteger(Number(start)) || Number(start) < 1))
    throw new InvalidPackageError("Note numbering start must be a positive integer.");
  if (restart !== undefined && !["continuous", "eachSect", "eachPage"].includes(restart)) throw new InvalidPackageError("Unknown note numbering restart rule.");
  return { format: values("numFmt") ?? fallback.format, start: start === undefined ? fallback.start : Number(start), restart: restart ?? fallback.restart };
}

/** Raw reference census includes inactive branches and other parts for safe ownership decisions. */
export async function openNotes(input: Uint8Array, context: ArchiveContext) {
  const settings = archiveSettings(context), budget = settings.budget;
  const document = await openDocumentLocations(input, settings), archive = document.snapshot();
  const main = document.list("story", { scope: "body" })[0]!.value.part;
  const graph = new DocumentPackage(archive, settings.limits, budget);
  const editors = new Map<string, DocumentXmlEditor>();
  for (const part of graph.parts) if (part.content_type.endsWith("+xml") || part.content_type === "application/xml" || part.content_type === "text/xml") {
    if (part.partname.endsWith(".rels")) continue;
    editors.set(part.partname, new DocumentXmlEditor(part.bytes, {}, undefined, budget));
  }
  const mainEditor = editors.get(main)!;
  const dialect = dialectForNamespace(mainEditor.root.namespace)!, w = documentDialects[dialect].w, r = documentDialects[dialect].r;
  const edges = graph.relationships(main);
  const records: NoteRecord[] = [], references: NoteReference[] = [];
  const parts = new Map<NoteKind, string>();
  const stories = document.list("story", { scope: "all-stories" });
  const annotations = document.list("annotation", { scope: "all-stories" });
  const annotationMap = new Map(annotations.map(location => [location.value.part + ":" + location.value.path.join("."), location]));
  for (const kind of ["footnote", "endnote"] as const) {
    const matches = edges.filter(e => e.reltype === r + "/" + kind + "s");
    if (matches.length > 1 || matches.some(e => e.is_external)) throw new InvalidPackageError("Notes require one internal owning relationship per kind.");
    if (!matches.length) continue;
    const part = matches[0]!.target_part.partname, editor = editors.get(part);
    if (!editor || editor.root.namespace !== w || editor.root.localName !== kind + "s") throw new InvalidPackageError("Note part has an invalid root.");
    parts.set(kind, part);
    const used = new Set<number>(), types = new Set<string>();
    for (const node of editor.root.children) {
      budget.charge("work", 1);
      if (node.namespace !== w || node.localName !== kind) continue;
      const id = idOf(node), type = noteAttribute(node, "type") ?? "normal";
      if (used.has(id)) throw new InvalidPackageError("Duplicate note ID in its owning part.");
      used.add(id);
      if (!["normal", "separator", "continuationSeparator", "continuationNotice"].includes(type) || type === "normal" && id < 0)
        throw new InvalidPackageError("Invalid note type or reserved ID.");
      if (type !== "normal" && types.has(type)) throw new InvalidPackageError("Duplicate special note type.");
      types.add(type);
      const location = stories.find(s => s.value.part === part && s.value.story === part + "#" + kind + ":" + noteAttribute(node, "id"));
      records.push({ kind, id, type, node, editor, part, location, references: [] });
    }
  }
  const byId = new Map(records.map(record => [record.kind + ":" + record.id, record]));
  for (const [part, editor] of editors) {
    const visit = (node: XmlElement, path: readonly number[], ancestors: readonly XmlElement[]) => {
      budget.charge("work", 1);
      if (node.namespace === w && ["footnoteReference", "endnoteReference"].includes(node.localName)) {
        const kind: NoteKind = node.localName === "footnoteReference" ? "footnote" : "endnote", id = idOf(node);
        const record = byId.get(kind + ":" + id);
        if (!record || record.type !== "normal") throw new InvalidPackageError("Note reference has no normal note body.");
        const parent = ancestors.at(-1);
        const location = parent?.namespace === w && parent.localName === "r" ? annotationMap.get(part + ":" + path.join(".")) : undefined;
        const reference = { kind, id, node, editor, path, part, location, safe: !!location && ancestors.every(n => n.namespace === w && !["sdt", "ins", "del", "moveFrom", "moveTo", "fldSimple"].includes(n.localName)) };
        references.push(reference); record.references.push(reference);
      }
      node.children.forEach((child, i) => visit(child, [...path, i], [...ancestors, node]));
    };
    visit(editor.root, [], []);
  }
  const defaults = { format: "decimal", start: 1, restart: "continuous" };
  const settingsEdges = edges.filter(e => e.reltype === r + "/settings" && !e.is_external);
  if (settingsEdges.length > 1) throw new InvalidPackageError("Duplicate settings parts.");
  const settingsNode = settingsEdges[0] && editors.get(settingsEdges[0].target_part.partname)?.root;
  const global = { footnote: numbering(settingsNode, "footnote", defaults), endnote: numbering(settingsNode, "endnote", defaults) };
  const sections = document.list("section").map(location => {
    let node = mainEditor.root;
    for (const i of location.value.path) node = node.children[i]!;
    return { section: location.positions.section!, footnote: numbering(node, "footnote", global.footnote), endnote: numbering(node, "endnote", global.endnote) };
  });
  return { document, archive, main, graph, editors, dialect, w, r, records, references, parts, numbering: { document: global, sections } };
}

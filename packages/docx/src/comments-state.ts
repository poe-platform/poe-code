import { archiveSettings, type ArchiveContext } from "./archive.js";
import { documentDialects, dialectForNamespace } from "./dialect.js";
import { openDocumentLocations } from "./locations.js";
import { DocumentPackage } from "./package.js";
import { InvalidPackageError, type XmlElement } from "./package-xml.js";
import { DocumentXmlEditor } from "./xml-write.js";

export const commentAttribute = (node: XmlElement, name: string) => node.attributes.find(a => a.namespace === node.namespace && a.localName === name)?.value;
export interface CommentMarker {
  readonly id: number; readonly node: XmlElement; readonly parent: XmlElement;
  readonly editor: DocumentXmlEditor; readonly part: string; readonly path: readonly number[];
  readonly order: number; readonly container: XmlElement; readonly safe: boolean;
}
function idOf(node: XmlElement): number {
  const raw = commentAttribute(node, "id");
  if (!raw || [...raw].some(c => c < "0" || c > "9") || !Number.isSafeInteger(Number(raw)))
    throw new InvalidPackageError("Comment IDs require nonnegative safe integers.");
  return Number(raw);
}

/** Census includes inactive content so edits cannot leave hidden references behind. */
export async function openComments(input: Uint8Array, context: ArchiveContext) {
  const settings = archiveSettings(context), budget = settings.budget;
  const document = await openDocumentLocations(input, settings), archive = document.snapshot();
  const main = document.list("story", { scope: "body" })[0]!.value.part;
  const graph = new DocumentPackage(archive, settings.limits, budget);
  const editors = new Map(graph.parts.filter(p => p.content_type.endsWith("+xml") || ["application/xml", "text/xml"].includes(p.content_type))
    .map(p => [p.partname, new DocumentXmlEditor(p.bytes, {}, undefined, budget)]));
  const dialect = dialectForNamespace(editors.get(main)!.root.namespace)!;
  const { w, r } = documentDialects[dialect];
  const edges = graph.relationships(main).filter(e => e.reltype === r + "/comments");
  if (edges.length > 1 || edges.some(e => e.is_external)) throw new InvalidPackageError("Comments require one internal owning relationship.");
  const part = edges[0]?.target_part.partname;
  const editor = part ? editors.get(part) : undefined;
  if (part && (!editor || editor.root.namespace !== w || editor.root.localName !== "comments" || graph.getPart(part).content_type !== "application/vnd.openxmlformats-officedocument.wordprocessingml.comments+xml"))
    throw new InvalidPackageError("Invalid comments part.");
  const markers: CommentMarker[] = [];
  for (const [name, xml] of editors) {
    let order = 0;
    const depth = new Map<XmlElement, number>();
    const visit = (node: XmlElement, parent: XmlElement, path: readonly number[], container: XmlElement, unsafe: boolean) => {
      budget.charge("work", 1);
      if (node.namespace === w && ["body", "hdr", "ftr", "footnote", "endnote", "comment", "tc", "txbxContent"].includes(node.localName)) container = node;
      unsafe ||= node.namespace !== w || ["hdr", "ftr", "comment", "sdt", "ins", "del", "moveFrom", "moveTo", "fldSimple", "hyperlink", "customXml"].includes(node.localName);
      if (node.namespace === w && node.localName === "fldChar") {
        const kind = commentAttribute(node, "fldCharType"), current = depth.get(container) ?? 0;
        if (kind === "begin") depth.set(container, current + 1);
        if (kind === "end") depth.set(container, Math.max(0, current - 1));
      }
      if (node.namespace === w && ["commentRangeStart", "commentRangeEnd", "commentReference"].includes(node.localName)) {
        const reference = node.localName === "commentReference";
        markers.push({ id: idOf(node), node, parent, editor: xml, part: name, path, order, container,
          safe: !unsafe && !(depth.get(container) ?? 0) && parent.namespace === w && parent.localName === (reference ? "r" : "p") && !node.children.length && !node.content.some(c => c.kind !== "text" || c.text.trim()) });
      }
      order++;
      node.children.forEach((child, i) => visit(child, node, [...path, i], container, unsafe));
    };
    visit(xml.root, xml.root, [], xml.root, false);
  }
  const locations = document.list("story", { scope: "comments" });
  const records = (editor?.root.children ?? []).filter(n => n.namespace === w && n.localName === "comment").map(node => {
    const id = idOf(node), owned = markers.filter(m => m.id === id);
    const starts = owned.filter(m => m.node.localName === "commentRangeStart");
    const ends = owned.filter(m => m.node.localName === "commentRangeEnd");
    const refs = owned.filter(m => m.node.localName === "commentReference");
    const issues: string[] = [];
    if (!owned.length) issues.push("deleted-anchor");
    else if (starts.length !== 1 || ends.length !== 1 || refs.length !== 1 || starts[0]!.part !== ends[0]!.part || starts[0]!.part !== refs[0]!.part || starts[0]!.container !== ends[0]!.container || starts[0]!.container !== refs[0]!.container || starts[0]!.order >= ends[0]!.order || ends[0]!.order >= refs[0]!.order) issues.push("inconsistent-range");
    if (owned.some(m => !m.safe)) issues.push("unsafe-anchor");
    return { id, node, editor: editor!, part: part!, markers: owned, start: starts[0], end: ends[0], reference: refs[0], issues,
      location: locations.find(l => l.value.part === part && l.value.story === part + "#comment:" + commentAttribute(node, "id")) };
  });
  const ids = new Set<number>();
  for (const record of records) {
    if (ids.has(record.id)) throw new InvalidPackageError("Duplicate comment body ID.");
    ids.add(record.id);
  }
  for (const record of records) if (record.start && record.end) {
    if (records.some(other => other !== record && other.start && other.end && other.start.part === record.start!.part && other.start.order < record.end!.order && record.start!.order < other.end.order)) record.issues.push("overlapping-comments");
  }
  const issues = [...new Set([...records.flatMap(n => n.issues), ...markers.some(m => !ids.has(m.id)) ? ["missing-body"] : []])];
  const modern = graph.parts.some(p => ["commentsExtended", "commentsIds", "commentsExtensible", "people"].some(kind => p.content_type.toLowerCase().includes(kind.toLowerCase())));
  return { document, archive, main, graph, editors, dialect, w, r, part, records, markers, issues, modern, budget };
}

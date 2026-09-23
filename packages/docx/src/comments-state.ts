import { inventoryCommentExtensions, commentParagraphNamespace } from "./comment-extensions.js";
import { compatibilityContainers, documentCompatibilityProfile } from "./compatibility.js";
import { archiveSettings, type ArchiveContext } from "./archive.js";
import { documentDialects, dialectForNamespace } from "./dialect.js";
import { openDocumentLocations } from "./locations.js";
import { parseMediaType } from "./media-type.js";
import { DocumentPackage } from "./package.js";
import { InvalidPackageError, isXmlContentType, type XmlElement } from "./package-xml.js";
import { DocumentXmlEditor } from "./xml-write.js";
import { activeXmlChildren } from "./xml-active-children.js";
import { storedCommentId } from "./comment-id.js";
import { commentStoryParts } from "./comment-stories.js";

export const commentAttribute = (node: XmlElement, name: string) => node.attributes.find(a => a.namespace === node.namespace && a.localName === name)?.value;
export interface CommentMarker {
  readonly id: number; readonly node: XmlElement; readonly parent: XmlElement;
  readonly editor: DocumentXmlEditor; readonly part: string; readonly path: readonly number[];
  readonly order: number; readonly container: XmlElement; readonly safe: boolean;
}
function idOf(node: XmlElement): number {
  const id = storedCommentId(commentAttribute(node, "id"));
  if (id === null)
    throw new InvalidPackageError("Comment IDs require nonnegative safe integers.");
  return id;
}

/** Census includes inactive content so edits cannot leave hidden references behind. */
export async function openComments(input: Uint8Array, context: ArchiveContext) {
  const settings = archiveSettings(context), budget = settings.budget;
  const document = await openDocumentLocations(input, settings), archive = document.snapshot();
  const main = document.list("story", { scope: "body" })[0]!.value.part;
  const graph = new DocumentPackage(archive, settings.limits, budget);
  const editors = new Map(graph.parts.filter(p => isXmlContentType(p.content_type))
    .map(p => [p.partname, new DocumentXmlEditor(p.bytes, {}, undefined, budget)]));
  const dialect = dialectForNamespace(editors.get(main)!.root.namespace)!;
  const { w, r } = documentDialects[dialect];
  const edges = graph.relationships(main).filter(e => e.reltype === r + "/comments");
  if (edges.length > 1 || edges.some(e => e.is_external)) throw new InvalidPackageError("Comments require one internal owning relationship.");
  const part = edges[0]?.target_part.partname;
  const extensions = inventoryCommentExtensions(graph, editors, budget);
  if (part && extensions.length) editors.set(part, new DocumentXmlEditor(graph.getPart(part).bytes, {}, { ...documentCompatibilityProfile, understoodNamespaces: [...documentCompatibilityProfile.understoodNamespaces, commentParagraphNamespace] }, budget));
  const editor = part ? editors.get(part) : undefined;
  if (part && (!editor || editor.root.namespace !== w || editor.root.localName !== "comments" || parseMediaType(graph.getPart(part).content_type) !== "application/vnd.openxmlformats-officedocument.wordprocessingml.comments+xml"))
    throw new InvalidPackageError("Invalid comments part.");
  const markers: CommentMarker[] = [];
  const stories = commentStoryParts(graph, main, part, w, r, name => editors.get(name)!.root, budget);
  for (const [name, xml] of editors) {
    if (!stories.has(name)) continue;
    const children = activeXmlChildren(xml, budget);
    const containers = new Set(xml.compatibility[compatibilityContainers]);
    const parents = new Map<XmlElement, XmlElement>();
    const active = [xml.root];
    while (active.length) {
      const node = active.pop()!;
      budget.charge("work", 1);
      const nested = children(node);
      budget.charge("retainedBytes", nested.length * 32);
      for (const child of nested) { parents.set(child, node); active.push(child); }
    }
    let order = 0;
    const depth = new Map<XmlElement, number>();
    budget.charge("retainedBytes", 80);
    const path: number[] = [];
    const frames = [{ node: xml.root, parent: xml.root, container: xml.root, unsafe: xml.root.localName === "glossaryDocument", next: -1 }];
    while (frames.length) {
      budget.charge("work", 1);
      const frame = frames.at(-1)!;
      if (frame.next === -1) {
        const { node, parent } = frame;
        if (node.namespace === w && ["body", "hdr", "ftr", "footnote", "endnote", "comment", "tc", "txbxContent"].includes(node.localName)) frame.container = node;
        frame.unsafe ||= !containers.has(node) && (node.namespace !== w || ["hdr", "ftr", "comment", "sdt", "ins", "del", "moveFrom", "moveTo", "fldSimple", "hyperlink", "customXml"].includes(node.localName) ||
          ["footnote", "endnote"].includes(node.localName) && (commentAttribute(node, "type") ?? "normal") !== "normal");
        if (node.namespace === w && node.localName === "fldChar" && parents.has(node)) {
          const kind = commentAttribute(node, "fldCharType"), current = depth.get(frame.container) ?? 0;
          if (kind === "begin" || kind === "end") {
            if (!depth.has(frame.container)) budget.charge("retainedBytes", 24);
            depth.set(frame.container, kind === "begin" ? current + 1 : Math.max(0, current - 1));
          }
        }
        if (node.namespace === w && ["commentRangeStart", "commentRangeEnd", "commentReference"].includes(node.localName)) {
          const reference = node.localName === "commentReference";
          const logicalParent = parents.get(node);
          budget.charge("work", path.length);
          budget.charge("retainedBytes", 192 + path.length * 8);
          markers.push({ id: idOf(node), node, parent, editor: xml, part: name, path: [...path], order, container: frame.container,
            safe: !frame.unsafe && !(depth.get(frame.container) ?? 0) && logicalParent?.namespace === w && logicalParent.localName === (reference ? "r" : "p") && !node.children.length && !node.content.some(c => c.kind !== "text" || c.text.trim()) });
        }
        order++;
        frame.next = 0;
      } else if (frame.next < frame.node.children.length) {
        const index = frame.next++;
        budget.charge("retainedBytes", 88);
        path.push(index);
        frames.push({ node: frame.node.children[index]!, parent: frame.node, container: frame.container, unsafe: frame.unsafe, next: -1 });
      } else {
        frames.pop();
        path.pop();
      }
    }
  }
  const locations = document.list("story", { scope: "comments" });
  const bodies = editor ? activeXmlChildren(editor, budget)(editor.root) : [];
  const records = bodies.filter(n => n.namespace === w && n.localName === "comment").map(node => {
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
  const modern = extensions.length > 0;
  return { document, archive, main, graph, editors, dialect, w, r, part, records, markers, issues, modern, extensions, budget };
}

import { commentExtensionParts } from "./comment-extension-parts.js";
import { parseMediaType } from "./media-type.js";
import type { DocumentBudget } from "./budget.js";
import type { DocumentPackage, PackagePart } from "./package.js";
import type { XmlElement } from "./package-xml.js";
import { UnsupportedEditError, DocumentXmlEditor } from "./xml-write.js";
import type { openComments } from "./comments-state.js";
import { documentDialects, dialectForNamespace } from "./dialect.js";

export const commentParagraphNamespace = "http://schemas.microsoft.com/office/word/2010/wordml";
const xmlns = "http://www.w3.org/2000/xmlns/";
const attribute = (node: XmlElement, name: string, namespace = node.namespace) => node.attributes.find(a => a.namespace === namespace && a.localName === name)?.value;
function hex(value: string | undefined): string | undefined {
  return value?.length === 8 && [...value].every(c => "0123456789abcdefABCDEF".includes(c)) ? value.toUpperCase() : undefined;
}
/** Raw XML views do not implement the review utility's metadata synchronization. */
export function assertLiveCommentExtensionPartPreserved(graph: DocumentPackage, part: PackagePart, bytes: Uint8Array, budget: DocumentBudget): void {
  budget.charge("work", bytes.length + 1);
  if (part.bytes.length === bytes.length && part.bytes.every((byte, index) => byte === bytes[index])) return;
  const refuse = (): never => { throw new UnsupportedEditError("Modern comment metadata cannot be synchronized safely for this edit."); };
  if (commentExtensionParts.some(descriptor => descriptor.contentType.toLowerCase() === parseMediaType(part.content_type))) refuse();
  const owners = ["/", ...graph.parts.filter(owner => owner.partname !== "/[Content_Types].xml" &&
    parseMediaType(owner.content_type) !== "application/vnd.openxmlformats-package.relationships+xml").map(owner => owner.partname)];
  budget.charge("retainedBytes", owners.length * 8);
  for (const owner of owners) for (const edge of graph.relationships(owner)) {
    budget.charge("work", 1 + commentExtensionParts.length);
    if (!edge.is_external && commentExtensionParts.some(descriptor => descriptor.relationship === edge.reltype) && edge.target_part.partname === part.partname) refuse();
  }
}
/** Live model writes do not implement the utility editor's thread synchronization. */
export function assertLiveCommentMetadataPreserved(previous: DocumentXmlEditor, next: DocumentXmlEditor, part: string,
  graph: () => DocumentPackage, budget: DocumentBudget): void {
  const dialect = dialectForNamespace(previous.root.namespace);
  if (!dialect || previous.root.localName !== "comments" || previous.sourceXml(previous.root) === next.sourceXml(next.root)) return;
  const package_ = graph();
  if (parseMediaType(package_.getPart(part).content_type) !== "application/vnd.openxmlformats-officedocument.wordprocessingml.comments+xml") return;
  const owners = package_.parts.filter(owner => owner.partname !== "/[Content_Types].xml" &&
    parseMediaType(owner.content_type) !== "application/vnd.openxmlformats-package.relationships+xml").filter(owner => package_.relationships(owner.partname).some(edge =>
    edge.reltype === documentDialects[dialect].r + "/comments" && !edge.is_external && edge.target_part.partname === part));
  const declarations = owners.flatMap(owner => package_.relationships(owner.partname).flatMap(edge => {
    const descriptor = commentExtensionParts.find(candidate => candidate.relationship === edge.reltype);
    return descriptor ? [{ edge, descriptor }] : [];
  }));
  if (!declarations.length) return;
  const physical = (root: XmlElement): XmlElement[] => {
    const result: XmlElement[] = [], pending = [root];
    budget.charge("retainedBytes", 192);
    while (pending.length) {
      const node = pending.pop()!;
      budget.charge("work", 1); budget.charge("retainedBytes", 8 + node.children.length * 8);
      result.push(node);
      for (let index = node.children.length - 1; index >= 0; index--) pending.push(node.children[index]!);
    }
    return result;
  };
  const word = previous.root.namespace;
  const before = physical(previous.root).filter(node => node.namespace === word && node.localName === "comment");
  const after = physical(next.root).filter(node => node.namespace === word && node.localName === "comment");
  const contextChanged = JSON.stringify(previous.root.attributes) !== JSON.stringify(next.root.attributes);
  const byId = (nodes: readonly XmlElement[]) => {
    const result = new Map<string | undefined, XmlElement[]>();
    for (const node of nodes) {
      budget.charge("work", 1); budget.charge("retainedBytes", 40);
      const id = attribute(node, "id"), matches = result.get(id) ?? [];
      matches.push(node); result.set(id, matches);
    }
    return result;
  };
  const beforeById = byId(before), afterById = byId(after);
  const changed = [
    ...before.filter(node => {
      const matches = afterById.get(attribute(node, "id")) ?? [];
      budget.charge("work", 1);
      return contextChanged || matches.length !== 1 || previous.sourceXml(node) !== next.sourceXml(matches[0]!);
    }),
    ...after.filter(node => {
      const matches = beforeById.get(attribute(node, "id")) ?? [];
      budget.charge("work", 1);
      return contextChanged || matches.length !== 1 || next.sourceXml(node) !== previous.sourceXml(matches[0]!);
    })
  ];
  if (!changed.length) return;
  const refuse = (): never => { throw new UnsupportedEditError("Live comment mutation cannot preserve its modern metadata; use only separately verified review operations."); };
  if (owners.length !== 1 || new Set(declarations.map(item => item.descriptor.kind)).size !== declarations.length) refuse();
  const paragraphIds = new Set<string>(), authors = new Set<string>();
  for (const comment of changed) {
    authors.add(attribute(comment, "author") ?? "");
    for (const node of physical(comment)) {
      const raw = attribute(node, "paraId", commentParagraphNamespace);
      if (raw === undefined) continue;
      const id = hex(raw); if (!id) refuse(); paragraphIds.add(id!);
    }
  }
  for (const { edge, descriptor } of declarations) {
    if (edge.is_external || edge.fragment || parseMediaType(edge.target_part.content_type) !== descriptor.contentType.toLowerCase()) refuse();
    // The bounded editor retains its original encoding while parsing the declaration.
    const editor = new DocumentXmlEditor(edge.target_part.bytes, {}, undefined, budget);
    if (editor.root.namespace !== descriptor.namespace || editor.root.localName !== descriptor.root ||
      editor.root.children.some(node => node.namespace !== descriptor.namespace || node.localName !== descriptor.entry)) refuse();
    if (descriptor.kind === "commentsExtensible" && !declarations.some(item => item.descriptor.kind === "commentsIds")) refuse();
    for (const node of editor.root.children) {
      budget.charge("work", 1);
      if (descriptor.kind === "people") {
        const author = attribute(node, "author"); if (author === undefined || authors.has(author)) refuse();
      } else if (["commentsExtended", "commentsIds"].includes(descriptor.kind)) {
        const id = hex(attribute(node, "paraId")); if (!id || paragraphIds.has(id)) refuse();
      }
    }
  }
}
export interface CommentExtensionInfo {
  readonly part: string;
  readonly kind: string;
  readonly namespace: string;
  readonly entries: readonly { readonly path: readonly number[]; readonly name: string; readonly namespace: string; readonly attributes: readonly { readonly name: string; readonly namespace: string; readonly value: string }[] }[];
}
export function inventoryCommentExtensions(graph: DocumentPackage, editors: ReadonlyMap<string, DocumentXmlEditor>, budget: DocumentBudget): CommentExtensionInfo[] {
  const result: CommentExtensionInfo[] = [];
  const relationships = ["/", ...graph.parts.filter(p => p.content_type.toLowerCase() !== "application/vnd.openxmlformats-package.relationships+xml").map(p => p.partname)].flatMap(owner => graph.relationships(owner));
  for (const part of graph.parts) {
    const type = parseMediaType(part.content_type);
    const root = editors.get(part.partname)?.root;
    const descriptor = commentExtensionParts.find(e => e.contentType.toLowerCase() === type ||
      root?.namespace === e.namespace && root.localName === e.root || relationships.some(r => r.reltype === e.relationship && !r.is_external && r.target_part === part));
    if (!descriptor && !["commentsExtended", "commentsIds", "commentsExtensible", "people"].some(k => type.includes(k.toLowerCase()))) continue;
    const entries: CommentExtensionInfo["entries"][number][] = [];
    if (root) {
      const path: number[] = [];
      const frames = [{ node: root, next: -1 }];
      budget.charge("retainedBytes", 32);
      while (frames.length) {
        budget.charge("work", 1);
        const frame = frames.at(-1)!;
        if (frame.next === -1) {
          const node = frame.node;
          budget.charge("work", 1 + node.attributes.length + path.length);
          budget.charge("retainedBytes", 192 + path.length * 8 + node.attributes.length * 72);
          entries.push({ path: [...path], name: node.localName, namespace: node.namespace, attributes: node.attributes.filter(a => a.namespace !== xmlns).map(a => ({ name: a.localName, namespace: a.namespace, value: a.value })) });
          frame.next = 0;
        } else if (frame.next < frame.node.children.length) {
          const index = frame.next++;
          budget.charge("retainedBytes", 40);
          path.push(index);
          frames.push({ node: frame.node.children[index]!, next: -1 });
        } else {
          frames.pop();
          path.pop();
        }
      }
    }
    result.push({ part: part.partname, kind: descriptor?.kind ?? "unknown", namespace: root?.namespace ?? "", entries });
  }
  return result;
}

type State = Awaited<ReturnType<typeof openComments>>;
/** Preflight the complete selection before staging any dependent metadata deletion. */
export function synchronizeCommentExtensions(state: State, selected: State["records"], remove: boolean): void {
  if (!state.extensions.length || !selected.length) return;
  const refuse = (): never => { throw new UnsupportedEditError("Comment extension metadata cannot be synchronized safely."); };
  const checkShape = (node: XmlElement, names: readonly string[], children = false) => {
    state.budget.charge("work", 1 + node.attributes.length);
    if (node.attributes.some(a => a.namespace !== xmlns && (a.namespace !== node.namespace || !names.includes(a.localName))) ||
      !children && node.children.length || node.content.some(c => c.kind !== "element" && (c.kind !== "text" || c.text.trim()))) refuse();
  };
  const owners = new Map<string, State["records"][number]>();
  const allParagraphs = new Set<string>();
  for (const record of state.records) {
    const paragraphs: XmlElement[] = [];
    const pending = [record.node];
    state.budget.charge("retainedBytes", 8);
    while (pending.length) {
      const node = pending.pop()!;
      state.budget.charge("work", 1);
      if (node.namespace === state.w && node.localName === "p") {
        paragraphs.push(node);
        const raw = attribute(node, "paraId", commentParagraphNamespace);
        if (raw !== undefined) {
          const id = hex(raw);
          if (!id || parseInt(id, 16) <= 0 || parseInt(id, 16) >= 0x80000000 || allParagraphs.has(id)) refuse();
          allParagraphs.add(id!);
        }
      }
      state.budget.charge("retainedBytes", node.children.length * 8);
      for (let index = node.children.length - 1; index >= 0; index--) pending.push(node.children[index]!);
    }
    const last = paragraphs.at(-1);
    const id = last && hex(attribute(last, "paraId", commentParagraphNamespace));
    if (id) owners.set(id, record);
  }
  for (const record of selected) {
    const pending = [record.node];
    state.budget.charge("retainedBytes", 8);
    while (pending.length) {
      const node = pending.pop()!;
      state.budget.charge("work", 1 + node.attributes.length);
      if (node.attributes.some(a => a.namespace === commentParagraphNamespace &&
        (node.namespace !== state.w || node.localName !== "p" || remove && !["paraId", "textId"].includes(a.localName)))) refuse();
      if (!remove && node.namespace === state.w && (["footnoteRef", "endnoteRef"].includes(node.localName) ||
        node.localName === "p" && attribute(node, "textId", commentParagraphNamespace) !== undefined)) refuse();
      state.budget.charge("retainedBytes", node.children.length * 8);
      for (let index = node.children.length - 1; index >= 0; index--) pending.push(node.children[index]!);
    }
  }
  const selectedNodes = new Set(selected.map(r => r.node));
  const affected = (id: string) => selectedNodes.has(owners.get(id)!.node);
  const groups = new Map<string, { editor: DocumentXmlEditor; nodes: readonly XmlElement[] }>();
  for (const info of state.extensions) {
    const descriptor = commentExtensionParts.find(e => e.kind === info.kind);
    const editor = state.editors.get(info.part);
    if (!descriptor || !editor || groups.has(info.kind) || parseMediaType(state.graph.getPart(info.part).content_type) !== descriptor.contentType.toLowerCase() ||
      editor.root.namespace !== descriptor.namespace || editor.root.localName !== descriptor.root) refuse();
    const edges = state.graph.relationships(state.main).filter(e => e.reltype === descriptor!.relationship);
    if (edges.length !== 1 || edges[0]!.is_external || edges[0]!.fragment || edges[0]!.target_part.partname !== info.part) refuse();
    checkShape(editor!.root, [], true);
    if (editor!.root.children.some(n => n.namespace !== descriptor!.namespace || n.localName !== descriptor!.entry)) refuse();
    groups.set(info.kind, { editor: editor!, nodes: editor!.root.children });
  }
  const byParagraph = (kind: string) => {
    const map = new Map<string, XmlElement>();
    for (const node of groups.get(kind)?.nodes ?? []) {
      const id = hex(attribute(node, "paraId"));
      if (!id || !owners.has(id) || map.has(id)) refuse();
      map.set(id!, node);
    }
    return map;
  };
  const threads = byParagraph("commentsExtended"), ids = byParagraph("commentsIds");
  const durable = new Map<string, string>();
  for (const [id, node] of ids) {
    const value = hex(attribute(node, "durableId"));
    if (!value || parseInt(value, 16) <= 0 || parseInt(value, 16) >= 0x7fffffff || durable.has(value)) refuse();
    durable.set(value!, id);
  }
  const parents = new Map<string, string>();
  for (const [id, node] of threads) {
    const raw = attribute(node, "paraIdParent");
    if (raw !== undefined) {
      const parent = hex(raw);
      if (!parent || !threads.has(parent) || parent === id) refuse();
      parents.set(id, parent!);
      if (remove && affected(parent!) && !affected(id)) refuse();
    }
    const done = attribute(node, "done");
    if (done !== undefined && !["0", "1", "true", "false", "on", "off"].includes(done)) refuse();
  }
  for (const id of parents.keys()) {
    const seen = new Set<string>();
    let current: string | undefined = id;
    while (current) {
      state.budget.charge("work", 1);
      if (seen.has(current)) refuse();
      seen.add(current); current = parents.get(current);
    }
  }
  const deletions: { editor: DocumentXmlEditor; node: XmlElement }[] = [];
  for (const [kind, entries, names] of [["commentsExtended", threads, ["paraId", "paraIdParent", "done"]], ["commentsIds", ids, ["paraId", "durableId"]]] as const) {
    for (const [id, node] of entries) if (affected(id)) {
      checkShape(node, names);
      if (remove) deletions.push({ editor: groups.get(kind)!.editor, node });
    }
  }
  const seenDurable = new Set<string>();
  for (const node of groups.get("commentsExtensible")?.nodes ?? []) {
    const id = hex(attribute(node, "durableId"));
    if (!id || !durable.has(id) || seenDurable.has(id)) refuse();
    seenDurable.add(id!);
    if (!affected(durable.get(id!)!)) continue;
    checkShape(node, ["durableId", "dateUtc", "intelligentPlaceholder"]);
    const placeholder = attribute(node, "intelligentPlaceholder");
    if (placeholder !== undefined && (!["0", "false", "off"].includes(placeholder) || parents.has(durable.get(id!)!))) refuse();
    if (remove) deletions.push({ editor: groups.get("commentsExtensible")!.editor, node });
  }
  if (!remove) {
    for (const record of selected) if (record.node.children.length !== 1 || record.node.children[0]!.localName !== "p") refuse();
  } else {
    // A person can also be owned by a revision, including inactive review markup.
    const authors = new Set<string>();
    const unverifiedAuthors = new Set<string>();
    for (const editor of state.editors.values()) {
      const pending = [editor.root];
      state.budget.charge("retainedBytes", 8);
      while (pending.length) {
        const node = pending.pop()!;
        state.budget.charge("work", 1);
        if (selectedNodes.has(node)) continue;
        const author = attribute(node, "author", state.w);
        if (author !== undefined) {
          const verified = node.namespace === state.w && ["comment", "ins", "del", "moveFrom", "moveTo", "rPrChange", "pPrChange", "sectPrChange", "tblPrChange", "trPrChange", "tcPrChange", "tblGridChange", "numberingChange", "cellIns", "cellDel", "cellMerge", "tblPrExChange"].includes(node.localName) ||
            node.namespace === commentParagraphNamespace && ["conflictIns", "conflictDel"].includes(node.localName);
          (verified ? authors : unverifiedAuthors).add(author);
        }
        state.budget.charge("retainedBytes", node.children.length * 8);
        for (let index = node.children.length - 1; index >= 0; index--) pending.push(node.children[index]!);
      }
    }
    const removedAuthors = new Set(selected.map(r => attribute(r.node, "author", state.w) ?? ""));
    for (const node of groups.get("people")?.nodes ?? []) {
      const author = attribute(node, "author");
      if (author === undefined) refuse();
      if (!removedAuthors.has(author!) || authors.has(author!)) continue;
      if (unverifiedAuthors.has(author!)) refuse();
      checkShape(node, ["author"], true);
      if (node.children.length > 1) refuse();
      for (const child of node.children) {
        if (child.namespace !== node.namespace || child.localName !== "presenceInfo") refuse();
        checkShape(child, ["providerId", "userId"]);
      }
      deletions.push({ editor: groups.get("people")!.editor, node });
    }
  }
  for (const { editor, node } of deletions) editor.replaceElement(node, "");
}

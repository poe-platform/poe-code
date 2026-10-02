import { parseStoredDateTime } from "./stored-date-time.js";
import { requireComparisonOperand } from "./comparison-operand.js";
import { snapshotSequence } from "./numeric-index.js";
import { InputTypeError, InvalidValueError } from "./archive.js";
import { OwnershipError } from "./model-errors.js";
import { activeModelChildren } from "./model-active-children.js";
import { activeXmlChildren } from "./xml-active-children.js";
import type { ModelStore, ModelRef } from "./model-store.js";
import { sectionAttribute as commentAttribute } from "./section-properties.js";
import { xmlValue } from "./create-content.js";
import { paragraphTextRun } from "./paragraph-content.js";
import { runElementOpen } from "./run-properties.js";
import type { XmlElement } from "./package-xml.js";
import { WD_STYLE_TYPE, type Length } from "./formatting-values.js";
import { DocumentXmlEditor, UnsupportedEditError } from "./xml-write.js";
import { documentDialects, dialectForNamespace } from "./dialect.js";
import { commentStoryParts } from "./comment-stories.js";
import { DocumentPackage } from "./package.js";
import { nextCommentId, storedCommentId } from "./comment-id.js";
import { hyperlinkHistory } from "./hyperlink-history.js";
import { provisionNamedStyles } from "./styles-model.js";

function text(value: unknown): asserts value is string {
  if (typeof value !== "string") throw new InputTypeError("Expected comment text.");
}
function id(node: XmlElement): number {
  const value = storedCommentId(commentAttribute(node, "id"));
  if (value === null)
    throw new InvalidValueError("Expected a nonnegative comment ID.");
  return value;
}
export class Comments implements Iterable<Comment> {
  constructor(
    readonly store: ModelStore,
    readonly ref: ModelRef
  ) {}
  private get nodes(): readonly XmlElement[] {
    const node = this.store.node(this.ref);
    return activeModelChildren(this.store, this.ref.part)(node)
      .filter((n) => n.namespace === node.namespace && n.localName === "comment");
  }
  get length(): number {
    return this.nodes.length;
  }
  *[Symbol.iterator](): Iterator<Comment> {
    for (const node of this.nodes)
      yield new Comment(this.store, this.store.ref(this.ref.part, node));
  }
  get(comment_id: number): Comment | null {
    if (!Number.isSafeInteger(comment_id) || comment_id < 0)
      throw new InputTypeError("Expected a nonnegative comment ID.");
    const node = this.nodes.find((n) => id(n) === comment_id);
    return node ? new Comment(this.store, this.store.ref(this.ref.part, node)) : null;
  }
  add_comment(value = "", author = "", initials: string | null = ""): Comment {
    const timestamp = this.store.context.timestamp;
    if (timestamp === undefined) throw new InputTypeError("Comment creation requires an explicit context timestamp.");
    parseStoredDateTime(timestamp.toISOString(), "xsd");
    text(value);
    text(author);
    if (initials !== null) text(initials);
    return this.store.transaction(() => {
      const next = nextCommentId(this.nodes.map(id), this.store.context.budget);
      const styles = this.store.stylesForStory(this.ref.part);
      const [style, reference] = styles[provisionNamedStyles]([
        { name: "Comment Text", type: WD_STYLE_TYPE.PARAGRAPH },
        { name: "Comment Reference", type: WD_STYLE_TYPE.CHARACTER }
      ]);
      if (!style || !reference) throw new InvalidValueError("Comment styles require scoped definitions.");
      const paragraphStyleId = styles.get_style_id(style, WD_STYLE_TYPE.PARAGRAPH) ?? style.style_id;
      const referenceStyleId = styles.get_style_id(reference, WD_STYLE_TYPE.CHARACTER) ?? reference.style_id;
      if (paragraphStyleId === null || referenceStyleId === null)
        throw new InvalidValueError("Comment styles require scoped definition IDs.");
      this.store.change(this.ref.part, (xml) => {
        const root = this.store.node(this.ref);
        const paragraphs = value.split("\n").map((line, index) =>
          `<cm:p><cm:pPr><cm:pStyle cm:val="${xmlValue(paragraphStyleId)}"/></cm:pPr>${index === 0 ? `<cm:r><cm:rPr><cm:rStyle cm:val="${xmlValue(referenceStyleId)}"/></cm:rPr><cm:annotationRef/></cm:r>` : ""}${line ? paragraphTextRun(root.namespace, line) : ""}</cm:p>`).join("");
        xml.insertChildren(root,
          `<cm:comment xmlns:cm="${root.namespace}" cm:id="${next}" cm:author="${xmlValue(author)}" cm:date="${timestamp.toISOString()}"${initials === null ? "" : ` cm:initials="${xmlValue(initials)}"`}>${paragraphs}</cm:comment>`);
      });
      return this.get(next)!;
    });
  }
}
export class Comment {
  constructor(
    readonly store: ModelStore,
    readonly ref: ModelRef
  ) {}
  get part() {
    this.store.node(this.ref);
    return this.store.part(this.ref.part, true);
  }
  get element() {
    return this.store.element(this.ref);
  }
  equals(other: unknown): boolean {
    requireComparisonOperand(other);
    this.store.node(this.ref);
    return (
      other instanceof Comment &&
      other.store === this.store &&
      this.store.node(this.ref) === other.store.node(other.ref)
    );
  }
  get comment_id(): number {
    return id(this.store.node(this.ref));
  }
  get timestamp(): Date | null {
    const raw = commentAttribute(this.store.node(this.ref), "date");
    if (raw === undefined) return null;
    try { return parseStoredDateTime(raw, "xsd"); } catch (error) { if (error instanceof InvalidValueError) return null; throw error; }
  }
  get author(): string {
    return commentAttribute(this.store.node(this.ref), "author") ?? "";
  }
  set author(value: string) {
    text(value);
    this.attribute("author", value);
  }
  get initials(): string | null {
    return commentAttribute(this.store.node(this.ref), "initials") ?? null;
  }
  set initials(value: string | null) {
    if (value !== null) text(value);
    this.attribute("initials", value);
  }
  private attribute(name: string, value: string | null): void {
    this.store.change(this.ref.part, (xml) => {
      const node = this.store.node(this.ref);
      xml.setQualifiedAttribute(node, { namespace: node.namespace, localName: name }, value);
    });
  }
  get paragraphs() {
    const node = this.store.node(this.ref);
    return snapshotSequence(activeModelChildren(this.store, this.ref.part)(node)
      .filter((n) => n.namespace === node.namespace && n.localName === "p")
      .map((n) => this.store.paragraph(this.store.ref(this.ref.part, n))));
  }
  get tables() {
    const node = this.store.node(this.ref);
    return snapshotSequence(activeModelChildren(this.store, this.ref.part)(node)
      .filter((n) => n.namespace === node.namespace && n.localName === "tbl")
      .map((n) => this.store.table(this.store.ref(this.ref.part, n))));
  }
  get text(): string {
    return this.paragraphs.map((paragraph) => paragraph.text).join("\n");
  }
  iter_inner_content() {
    return this.store.blocks(this.ref);
  }
  add_paragraph(value = "", style?: Parameters<ModelStore["addParagraph"]>[2]) {
    text(value);
    return this.store.transaction(() => {
      // Establish that the comment body is editable before resolving dependent styles.
      const paragraph = this.store.addParagraph(this.ref, value);
      paragraph.style = style ?? "Comment Text";
      return paragraph;
    });
  }
  add_table(rows: number, cols: number, width: Length) {
    return this.store.addTable(this.ref, rows, cols, width);
  }
}
export class Hyperlink {
  constructor(
    readonly store: ModelStore,
    readonly ref: ModelRef
  ) {}
  get part() {
    this.store.node(this.ref);
    return this.store.part(this.ref.part);
  }
  get element() {
    return this.store.element(this.ref);
  }
  get address(): string {
    const node = this.store.node(this.ref),
      dialect = dialectForNamespace(node.namespace);
    if (!dialect) throw new InvalidValueError("Expected a document hyperlink namespace.");
    const r = documentDialects[dialect].r,
      attr = node.attributes.find((a) => a.localName === "id" && a.namespace === r);
    if (!attr) return "";
    const edge = this.part.rels.at(attr.value);
    if (!edge.is_external || edge.reltype !== r + "/hyperlink")
      throw new InvalidValueError("Expected an external hyperlink relationship.");
    return edge.target_ref;
  }
  get fragment(): string {
    return commentAttribute(this.store.node(this.ref), "anchor") ?? "";
  }
  get url(): string {
    const address = this.address;
    return address ? address + (this.fragment ? "#" + this.fragment : "") : "";
  }
  get runs() {
    const node = this.store.node(this.ref);
    return snapshotSequence(activeModelChildren(this.store, this.ref.part)(node)
      .filter((n) => n.namespace === node.namespace && n.localName === "r")
      .map((n) => this.store.run(this.store.ref(this.ref.part, n))));
  }
  get text(): string {
    return this.runs.map((r) => r.text).join("");
  }
  get contains_page_break(): boolean {
    const node = this.store.node(this.ref),
      children = activeModelChildren(this.store, this.ref.part),
      budget = this.store.context.budget,
      pending = [node];
    budget.charge("retainedBytes", 8);
    while (pending.length) {
      const current = pending.pop()!;
      budget.charge("work", 1);
      if (current.namespace !== node.namespace) continue;
      if (current.localName === "lastRenderedPageBreak") return true;
      const nested = children(current);
      budget.charge("work", nested.length);
      budget.charge("retainedBytes", nested.length * 8);
      for (let index = nested.length - 1; index >= 0; index--) pending.push(nested[index]!);
    }
    return false;
  }
  get history(): boolean {
    return hyperlinkHistory(commentAttribute(this.store.node(this.ref), "history"));
  }
}
export class RenderedPageBreak {
  constructor(
    readonly store: ModelStore,
    readonly ref: ModelRef,
    readonly paragraphRef: ModelRef
  ) {}
  get part() {
    this.store.node(this.ref);
    return this.store.part(this.ref.part);
  }
  get preceding_paragraph_fragment() {
    return this.fragment(true);
  }
  get following_paragraph_fragment() {
    return this.fragment(false);
  }
  private fragment(preceding: boolean) {
    const xml = this.store.xml(this.ref.part),
      p = this.store.node(this.paragraphRef),
      marker = this.store.node(this.ref);
    const children = activeModelChildren(this.store, this.ref.part);
    const budget = this.store.context.budget;
    const parents = new Map<XmlElement, XmlElement>();
    const pending = [p];
    let activeMarker = false;
    budget.charge("retainedBytes", 8);
    while (pending.length) {
      const node = pending.pop()!;
      budget.charge("work", 1);
      if (node.namespace !== p.namespace) continue;
      if (node === marker && node.localName === "lastRenderedPageBreak") activeMarker = true;
      const nested = children(node);
      budget.charge("work", nested.length);
      budget.charge("retainedBytes", nested.length * 24);
      for (let index = nested.length - 1; index >= 0; index--) {
        parents.set(nested[index]!, node);
        pending.push(nested[index]!);
      }
    }
    if (!activeMarker)
      throw new UnsupportedEditError(
        "Fragment extraction requires an active cached break in its paragraph."
      );
    const ancestors = new Set<XmlElement>();
    const hyperlinkPath = new Set<XmlElement>();
    let owner = marker, hyperlinkBoundary: XmlElement | undefined;
    for (let node: XmlElement | undefined = marker; node && node !== p; node = parents.get(node)) {
      budget.charge("work", 1);
      budget.charge("retainedBytes", 8);
      ancestors.add(node);
      if (!hyperlinkBoundary) {
        budget.charge("retainedBytes", 8);
        hyperlinkPath.add(node);
        if (node.localName === "hyperlink") hyperlinkBoundary = node;
      }
      owner = node;
    }
    if (owner === marker && !parents.has(marker))
      throw new InvalidValueError("Cached break is not in its paragraph.");
    const paragraphChildren = children(p);
    const properties = paragraphChildren.find((n) => n.namespace === p.namespace && n.localName === "pPr");
    const content = paragraphChildren.filter((n) => n !== properties),
      index = content.indexOf(owner);
    const standalone = (node: XmlElement): string =>
      runElementOpen(node) + (node.content.length ? xml.sourceXml(node, new Map(), true) : "") + `</${node.name}>`;
    const hyperlink = owner === hyperlinkBoundary;
    const chunks: string[] = [];
    const frames: (XmlElement | string)[] = [owner];
    budget.charge("retainedBytes", 8);
    while (frames.length) {
      const frame = frames.pop()!;
      budget.charge("work", 1);
      if (typeof frame === "string") {
        chunks.push(frame);
        continue;
      }
      if (frame === marker || frame === hyperlinkBoundary && !preceding) continue;
      if (!ancestors.has(frame)) {
        chunks.push(standalone(frame));
        continue;
      }
      chunks.push(runElementOpen(frame));
      const selected: XmlElement[] = [];
      let seen = false;
      for (const child of children(frame)) {
        budget.charge("work", 1);
        if (ancestors.has(child)) {
          selected.push(child);
          seen = true;
        } else if (hyperlinkBoundary && hyperlinkPath.has(frame) ||
          (child.namespace === frame.namespace && child.localName === "rPr") ||
          (preceding ? !seen : seen)) selected.push(child);
      }
      budget.charge("retainedBytes", (selected.length + 1) * 8);
      frames.push(`</${frame.name}>`);
      for (let childIndex = selected.length - 1; childIndex >= 0; childIndex--)
        frames.push(selected[childIndex]!);
    }
    const patchedOwner = chunks.join("");
    const fragment = content
      .slice(preceding ? 0 : index + (hyperlink ? 1 : 0), preceding ? index + 1 : undefined)
      .map((n) => n === owner ? patchedOwner : standalone(n))
      .join("");
    const candidate =
      runElementOpen(p) + (properties ? standalone(properties) : "") + fragment + `</${p.name}>`;
    budget.charge("retainedBytes", candidate.length * 2);
    const parsed = new DocumentXmlEditor(new TextEncoder().encode(candidate), {}, undefined, budget);
    const fragmentChildren = activeXmlChildren(parsed, budget);
    const meaningful = fragmentChildren(parsed.root).filter((n) => n.localName !== "pPr");
    budget.charge("retainedBytes", meaningful.length * 8);
    let hasContent = false;
    while (meaningful.length) {
      const node = meaningful.pop()!;
      budget.charge("work", 1);
      if (node.namespace === p.namespace &&
        ["t", "tab", "ptab", "noBreakHyphen", "softHyphen", "br", "cr", "drawing", "pict", "object"].includes(node.localName)) {
        hasContent = true;
        break;
      }
      const nested = fragmentChildren(node);
      budget.charge("retainedBytes", nested.length * 8);
      for (const child of nested) meaningful.push(child);
    }
    if (!hasContent) return null;
    return this.store.detachedParagraph(candidate, this.ref.part);
  }
}

/** Validates all endpoints before creating a body; selected endpoints span intervening runs. */
function validateCommentRange(
  store: ModelStore,
  runs: import("./block-model.js").Run | readonly import("./block-model.js").Run[]
) {
  const selected = Array.isArray(runs) ? runs : [runs];
  if (!selected.length)
    throw new UnsupportedEditError("Comment endpoints require runs from this document.");
  if (selected.some((run) => !run || typeof run !== "object" || !run.store || !run.ref))
    throw new InputTypeError("Expected comment run endpoints.");
  if (selected.some((run) => run.store !== store))
    throw new OwnershipError("Comment endpoints require runs from this document.");
  const first = selected[0]!,
    last = selected[selected.length - 1]!;
  if (selected.some((run) => run.ref.part !== first.ref.part)) {
    const owner = store.documentOwnerForStory(first.ref.part);
    if (selected.some((run) => store.documentOwnerForStory(run.ref.part) !== owner))
      throw new OwnershipError("Comment endpoints require the same document owner.");
    throw new UnsupportedEditError("Comment endpoints cannot cross stories.");
  }
  const xml = store.xml(first.ref.part),
    firstNode = store.node(first.ref),
    lastNode = store.node(last.ref);
  const children = activeModelChildren(store, first.ref.part);
  const ordered: {
    node: XmlElement;
    parent: XmlElement;
    container: XmlElement;
    safe: boolean;
    order: number;
  }[] = [];
  let order = 0,
    fieldDepth = 0;
  const pending = [{ node: xml.root, parent: xml.root, container: xml.root, safe: true }];
  store.context.budget.charge("retainedBytes", 64);
  while (pending.length) {
    const { node, parent } = pending.at(-1)!;
    let { container, safe } = pending.pop()!;
    store.context.budget?.charge("work", 1);
    if (
      ["body", "tc", "footnote", "endnote", "txbxContent", "hdr", "ftr", "comment"].includes(
        node.localName
      )
    )
      container = node;
    safe &&=
      node.namespace === xml.root.namespace &&
      ![
        "hdr",
        "ftr",
        "comment",
        "sdt",
        "ins",
        "del",
        "moveFrom",
        "moveTo",
        "hyperlink",
        "fldSimple",
        "customXml"
      ].includes(node.localName);
    if (node.namespace === xml.root.namespace && node.localName === "fldChar") {
      const type = commentAttribute(node, "fldCharType");
      if (type === "begin") fieldDepth++;
      if (type === "end") fieldDepth = Math.max(0, fieldDepth - 1);
    }
    store.context.budget.charge("retainedBytes", 64);
    ordered.push({ node, parent, container, safe: safe && !fieldDepth, order: order++ });
    if (node.namespace === xml.root.namespace) {
      const selected = children(node);
      store.context.budget.charge("retainedBytes", selected.length * 64);
      for (let index = selected.length - 1; index >= 0; index--)
        pending.push({ node: selected[index]!, parent: node, container, safe });
    }
  }
  const start = ordered.find((n) => n.node === firstNode),
    end = ordered.find((n) => n.node === lastNode);
  if (
    !start ||
    !end ||
    firstNode.localName !== "r" ||
    lastNode.localName !== "r" ||
    start.order > end.order ||
    start.container !== end.container ||
    start.parent.localName !== "p" ||
    end.parent.localName !== "p"
  )
    throw new UnsupportedEditError(
      "Comment endpoints require an ordered run range within one container."
    );
  const finalDescendants = new Set<XmlElement>();
  const finalRun = [lastNode];
  store.context.budget.charge("retainedBytes", 8);
  while (finalRun.length) {
    const node = finalRun.pop()!;
    store.context.budget.charge("work", 1);
    const nested = children(node);
    store.context.budget.charge("retainedBytes", 24 + nested.length * 8);
    finalDescendants.add(node);
    for (const child of nested) finalRun.push(child);
  }
  const endOrder = ordered.filter((n) => finalDescendants.has(n.node)).at(-1)!.order;
  const span = ordered.filter((n) => n.order >= start.order && n.order <= endOrder);
  if (
    !start.safe ||
    !end.safe ||
    span.some(
      (n) =>
        !n.safe ||
        ["commentRangeStart", "commentRangeEnd", "commentReference", "fldChar"].includes(
          n.node.localName
        )
    )
  )
    throw new UnsupportedEditError("Comment anchors cannot cross controlled or annotated content.");
  let depth = 0;
  for (const item of ordered) {
    if (item.node.namespace === xml.root.namespace && item.node.localName === "commentRangeStart") depth++;
    if (item.order === start.order && depth)
      throw new UnsupportedEditError("Comment ranges cannot overlap existing comments.");
    if (item.node.namespace === xml.root.namespace && item.node.localName === "commentRangeEnd") depth = Math.max(0, depth - 1);
  }
  const allRuns = span.filter((n) => n.node.localName === "r");
  if (
    !allRuns.length ||
    !allRuns.some((n) =>
      children(n.node).some((c) => c.namespace === xml.root.namespace &&
        (c.localName === "t" ? c.text.length > 0 :
          ["tab", "ptab", "noBreakHyphen", "softHyphen", "br", "cr", "drawing", "pict"].includes(c.localName)))
    )
  )
    throw new UnsupportedEditError("Comment anchors require nonempty run content.");
  // Every selected run belongs to the affected anchor span, including runs
  // between the endpoints. Preflight their physical payloads before allocating
  // comments, relationships or styles; unselected siblings retain their owners.
  store.context.budget.charge("retainedBytes", allRuns.length * 32);
  const physical = allRuns.map(({ node }) => ({ node, index: -1 }));
  while (physical.length) {
    const frame = physical.at(-1)!;
    if (frame.index === -1) {
      store.context.budget.charge("work", 1 + frame.node.attributes.length);
      if (!xml.compatibility.canEdit(frame.node) || frame.node.attributes.some(attribute =>
        attribute.namespace !== "http://www.w3.org/2000/xmlns/" && !xml.compatibility.canEdit(attribute)))
        throw new UnsupportedEditError("Comment anchors cannot relocate opaque run ownership.");
      frame.index = 0;
    }
    const child = frame.node.children[frame.index++];
    if (!child) physical.pop();
    else {
      store.context.budget.charge("retainedBytes", 32);
      physical.push({ node: child, index: -1 });
    }
  }
  return { first, last };
}
function applyCommentRange(
  store: ModelStore,
  first: import("./block-model.js").Run,
  last: import("./block-model.js").Run,
  commentId: number
): void {
  const owner = store.documentOwnerForStory(first.ref.part);
  const dialect = dialectForNamespace(store.xml(owner).root.namespace)!;
  const graph = new DocumentPackage(store.snapshot(), store.context.limits, store.context.budget);
  let referenceStyleId = "CommentReference";
  if (graph.relationships(owner).some(edge => edge.reltype === documentDialects[dialect].r + "/styles")) {
    const styles = store.stylesForStory(first.ref.part);
    if (styles.has("Comment Reference")) {
      const reference = styles.at("Comment Reference");
      const scoped = styles.get_style_id(reference, WD_STYLE_TYPE.CHARACTER) ?? reference.style_id;
      if (scoped === null) throw new InvalidValueError("Comment reference styles require a scoped definition ID.");
      referenceStyleId = scoped;
    }
  }
  store.change(first.ref.part, (editor) => {
    const begin = store.node(first.ref),
      finish = store.node(last.ref),
      w = begin.namespace;
    const beginMarkup = `<cm:commentRangeStart xmlns:cm="${w}" cm:id="${commentId}"/>`,
      endMarkup = `<cm:commentRangeEnd xmlns:cm="${w}" cm:id="${commentId}"/><cm:r xmlns:cm="${w}"><cm:rPr><cm:rStyle cm:val="${xmlValue(referenceStyleId)}"/></cm:rPr><cm:commentReference cm:id="${commentId}"/></cm:r>`;
    if (begin === finish)
      editor.replaceElement(begin, beginMarkup + editor.sourceXml(begin) + endMarkup);
    else {
      editor.replaceElement(begin, beginMarkup + editor.sourceXml(begin));
      editor.replaceElement(finish, editor.sourceXml(finish) + endMarkup);
    }
  });
}

export function bindCommentRange(
  store: ModelStore,
  runs: import("./block-model.js").Run | readonly import("./block-model.js").Run[],
  value = "",
  author = "",
  initials: string | null = "",
  documentPart?: string
): Comment {
  text(value);
  text(author);
  if (initials !== null) text(initials);
  const { first, last } = validateCommentRange(store, runs);
  if (documentPart !== undefined && store.documentOwnerForStory(first.ref.part) !== documentPart)
    throw new OwnershipError("Comment endpoints require runs owned by the receiving document.");
  const comment = new Comments(store, store.ensureComments(store.documentOwnerForStory(first.ref.part))).add_comment(value, author, initials);
  applyCommentRange(store, first, last, comment.comment_id);
  return comment;
}

/** Anchors an existing comment body after validating its complete run range. */
export function markCommentRange(
  store: ModelStore,
  first: import("./block-model.js").Run,
  last: import("./block-model.js").Run,
  comment_id: number
): void {
  if (!Number.isSafeInteger(comment_id) || comment_id < 0)
    throw new InputTypeError("Expected a nonnegative comment ID.");
  validateCommentRange(store, [first, last]);
  const owner = store.documentOwnerForStory(first.ref.part),
    main = store.xml(owner).root,
    dialect = dialectForNamespace(main.namespace)!;
  const edges = [...store.part(owner).rels.values()].filter(
    (edge) => edge.reltype === documentDialects[dialect].r + "/comments"
  );
  if (edges.length !== 1 || edges[0]!.is_external)
    throw new UnsupportedEditError("Comment anchoring requires an existing comment body.");
  const part = edges[0]!.target_part.partname.toString(),
    container = store.ref(part, store.xml(part).root),
    comment = new Comments(store, container).get(comment_id);
  if (!comment)
    throw new UnsupportedEditError("Comment anchoring requires an existing comment body.");
  const graph = new DocumentPackage(store.snapshot(), store.context.limits, store.context.budget);
  const stories = commentStoryParts(graph, owner, part, documentDialects[dialect].w,
    documentDialects[dialect].r, name => store.xml(name).root, store.context.budget);
  for (const story of stories) {
    store.context.budget.charge("retainedBytes", 8);
    const pending = [store.xml(story).root];
    while (pending.length) {
      const node = pending.pop()!;
      store.context.budget.charge("work", 1);
      if (node.namespace === documentDialects[dialect].w &&
        ["commentRangeStart", "commentRangeEnd", "commentReference"].includes(node.localName) &&
        storedCommentId(commentAttribute(node, "id")) === comment_id)
        throw new UnsupportedEditError("Comment body already has an anchor.");
      store.context.budget.charge("retainedBytes", node.children.length * 8);
      for (let index = node.children.length - 1; index >= 0; index--) pending.push(node.children[index]!);
    }
  }
  applyCommentRange(store, first, last, comment_id);
}

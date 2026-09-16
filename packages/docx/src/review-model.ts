import { InputTypeError, InvalidValueError } from "./archive.js";
import type { ModelStore, ModelRef } from "./model-store.js";
import { sectionAttribute as commentAttribute } from "./section-properties.js";
import { xmlValue } from "./create-content.js";
import { validateDocxValue } from "./operation-schema.js";
import { paragraphTextRun } from "./paragraph-content.js";
import { runElementOpen } from "./run-properties.js";
import type { XmlElement } from "./package-xml.js";
import type { Length } from "./formatting-values.js";
import { DocumentXmlEditor, UnsupportedEditError } from "./xml-write.js";
import { documentDialects, dialectForNamespace } from "./dialect.js";

function text(value: unknown): asserts value is string {
  if (typeof value !== "string") throw new InputTypeError("Expected comment text.");
}
function id(node: XmlElement): number {
  const raw = commentAttribute(node, "id");
  if (!raw || [...raw].some((c) => c < "0" || c > "9") || !Number.isSafeInteger(Number(raw)))
    throw new InvalidValueError("Expected a nonnegative comment ID.");
  return Number(raw);
}
export class Comments implements Iterable<Comment> {
  constructor(
    readonly store: ModelStore,
    readonly ref: ModelRef
  ) {}
  private get nodes(): readonly XmlElement[] {
    const node = this.store.node(this.ref);
    return node.children.filter((n) => n.namespace === node.namespace && n.localName === "comment");
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
    text(value);
    text(author);
    if (initials !== null) text(initials);
    const used = new Set(this.nodes.map(id));
    let next = 0;
    while (used.has(next)) next++;
    const timestamp = this.store.context.timestamp.toISOString();
    this.store.change(this.ref.part, (xml) => {
      const root = this.store.node(this.ref);
      xml.insertChildren(
        root,
        `<cm:comment xmlns:cm="${root.namespace}" cm:id="${next}" cm:author="${xmlValue(author)}" cm:date="${timestamp}"${initials === null ? "" : ` cm:initials="${xmlValue(initials)}"`}><cm:p>${paragraphTextRun(root.namespace, value)}</cm:p></cm:comment>`
      );
    });
    return this.get(next)!;
  }
}
export class Comment {
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
  equals(other: unknown): boolean {
    return (
      other instanceof Comment &&
      other.store === this.store &&
      other.ref.part === this.ref.part &&
      other.ref.id === this.ref.id
    );
  }
  get comment_id(): number {
    return id(this.store.node(this.ref));
  }
  get timestamp(): Date | null {
    const raw = commentAttribute(this.store.node(this.ref), "date");
    if (raw === undefined) return null;
    const date = new Date(raw);
    if (!validateDocxValue("UTC instant", raw) || !Number.isFinite(date.getTime()))
      throw new InvalidValueError("Expected a valid comment timestamp.");
    return date;
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
    return node.children
      .filter((n) => n.namespace === node.namespace && n.localName === "p")
      .map((n) => this.store.paragraph(this.store.ref(this.ref.part, n)));
  }
  get tables() {
    const node = this.store.node(this.ref);
    return node.children
      .filter((n) => n.namespace === node.namespace && n.localName === "tbl")
      .map((n) => this.store.table(this.store.ref(this.ref.part, n)));
  }
  get text(): string {
    return this.paragraphs.map((paragraph) => paragraph.text).join("\n");
  }
  iter_inner_content() {
    return this.store.blocks(this.ref);
  }
  add_paragraph(value = "", style?: Parameters<ModelStore["addParagraph"]>[2]) {
    text(value);
    return this.store.addParagraph(this.ref, value, style);
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
    return node.children
      .filter((n) => n.namespace === node.namespace && n.localName === "r")
      .map((n) => this.store.run(this.store.ref(this.ref.part, n)));
  }
  get text(): string {
    return this.runs.map((r) => r.text).join("");
  }
  get contains_page_break(): boolean {
    const node = this.store.node(this.ref),
      visit = (n: XmlElement): boolean =>
        (n.namespace === node.namespace && n.localName === "lastRenderedPageBreak") ||
        n.children.some(visit);
    return visit(node);
  }
  get history(): boolean {
    const value = commentAttribute(this.store.node(this.ref), "history");
    if (value === undefined || ["0", "false", "off"].includes(value)) return false;
    if (["1", "true", "on"].includes(value)) return true;
    throw new InvalidValueError("Expected a hyperlink history flag.");
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
    const breaks: XmlElement[] = [];
    const collect = (n: XmlElement): void => {
      if (n.namespace === p.namespace && n.localName === "lastRenderedPageBreak") breaks.push(n);
      for (const child of n.children) collect(child);
    };
    collect(p);
    if (breaks[0] !== marker)
      throw new UnsupportedEditError(
        "Fragment extraction requires the first cached break in its paragraph."
      );
    const contains = (n: XmlElement): boolean => n === marker || n.children.some(contains);
    const owner = p.children.find(contains);
    if (!owner) throw new InvalidValueError("Cached break is not in its paragraph.");
    const properties = p.children.find((n) => n.namespace === p.namespace && n.localName === "pPr");
    const content = p.children.filter((n) => n !== properties),
      index = content.indexOf(owner),
      patches = new Map<XmlElement, string>();
    let fragment = "";
    if (owner.localName === "hyperlink") {
      const removeMarker = (node: XmlElement): string =>
        node === marker
          ? ""
          : !contains(node)
            ? xml.sourceXml(node)
            : runElementOpen(node) + node.children.map(removeMarker).join("") + `</${node.name}>`;
      patches.set(owner, removeMarker(owner));
      fragment = content
        .slice(preceding ? 0 : index + 1, preceding ? index + 1 : undefined)
        .map((n) => patches.get(n) ?? xml.sourceXml(n))
        .join("");
    } else {
      const split = (node: XmlElement): string => {
        if (node === marker) return "";
        if (!contains(node)) return xml.sourceXml(node);
        let seen = false,
          inner = "";
        for (const child of node.children) {
          const has = contains(child);
          if (has) {
            inner += split(child);
            seen = true;
          } else if (
            (child.namespace === node.namespace && child.localName === "rPr") ||
            (preceding ? !seen : seen)
          )
            inner += xml.sourceXml(child);
        }
        return runElementOpen(node) + inner + `</${node.name}>`;
      };
      patches.set(owner, split(owner));
      fragment = content
        .slice(preceding ? 0 : index, preceding ? index + 1 : undefined)
        .map((n) => patches.get(n) ?? xml.sourceXml(n))
        .join("");
    }
    const candidate =
      runElementOpen(p) + (properties ? xml.sourceXml(properties) : "") + fragment + `</${p.name}>`;
    const meaningful = (n: XmlElement): boolean =>
      (n.namespace === p.namespace &&
        ["t", "tab", "br", "cr", "drawing", "pict", "object"].includes(n.localName)) ||
      n.children.some(meaningful);
    const parsed = new DocumentXmlEditor(new TextEncoder().encode(candidate));
    if (!parsed.root.children.some((n) => n.localName !== "pPr" && meaningful(n))) return null;
    return this.store.detachedParagraph(candidate, this.ref.part);
  }
}

/** Validates all endpoints before creating a body; selected endpoints span intervening runs. */
function validateCommentRange(
  store: ModelStore,
  runs: import("./block-model.js").Run | readonly import("./block-model.js").Run[]
) {
  const selected = Array.isArray(runs) ? runs : [runs];
  if (!selected.length || selected.some((run) => !run || run.store !== store))
    throw new UnsupportedEditError("Comment endpoints require runs from this document.");
  const first = selected[0]!,
    last = selected[selected.length - 1]!;
  if (selected.some((run) => run.ref.part !== first.ref.part))
    throw new UnsupportedEditError("Comment endpoints cannot cross stories.");
  const xml = store.xml(first.ref.part),
    firstNode = store.node(first.ref),
    lastNode = store.node(last.ref);
  const ordered: {
    node: XmlElement;
    parent: XmlElement;
    container: XmlElement;
    safe: boolean;
    order: number;
  }[] = [];
  let order = 0,
    fieldDepth = 0;
  const visit = (node: XmlElement, parent: XmlElement, container: XmlElement, safe: boolean) => {
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
    if (node.localName === "fldChar") {
      const type = commentAttribute(node, "fldCharType");
      if (type === "begin") fieldDepth++;
      if (type === "end") fieldDepth = Math.max(0, fieldDepth - 1);
    }
    ordered.push({ node, parent, container, safe: safe && !fieldDepth, order: order++ });
    for (const child of node.children) visit(child, node, container, safe);
  };
  visit(xml.root, xml.root, xml.root, true);
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
  const finalRun = (node: XmlElement): void => {
    finalDescendants.add(node);
    for (const child of node.children) finalRun(child);
  };
  finalRun(lastNode);
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
    if (item.node.localName === "commentRangeStart") depth++;
    if (item.order === start.order && depth)
      throw new UnsupportedEditError("Comment ranges cannot overlap existing comments.");
    if (item.node.localName === "commentRangeEnd") depth = Math.max(0, depth - 1);
  }
  const allRuns = span.filter((n) => n.node.localName === "r");
  if (
    !allRuns.length ||
    !allRuns.some((n) =>
      n.node.children.some((c) => ["t", "tab", "br", "cr", "drawing", "pict"].includes(c.localName))
    )
  )
    throw new UnsupportedEditError("Comment anchors require nonempty run content.");
  return { first, last };
}
function applyCommentRange(
  store: ModelStore,
  first: import("./block-model.js").Run,
  last: import("./block-model.js").Run,
  commentId: number
): void {
  store.change(first.ref.part, (editor) => {
    const begin = store.node(first.ref),
      finish = store.node(last.ref),
      w = begin.namespace;
    const beginMarkup = `<cm:commentRangeStart xmlns:cm="${w}" cm:id="${commentId}"/>`,
      endMarkup = `<cm:commentRangeEnd xmlns:cm="${w}" cm:id="${commentId}"/><cm:r xmlns:cm="${w}"><cm:commentReference cm:id="${commentId}"/></cm:r>`;
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
  initials: string | null = ""
): Comment {
  text(value);
  text(author);
  if (initials !== null) text(initials);
  const { first, last } = validateCommentRange(store, runs);
  const comment = new Comments(store, store.ensureComments()).add_comment(value, author, initials);
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
  const main = store.xml(store.mainPart).root,
    dialect = dialectForNamespace(main.namespace)!;
  const edges = [...store.part(store.mainPart).rels.values()].filter(
    (edge) => edge.reltype === documentDialects[dialect].r + "/comments"
  );
  if (edges.length !== 1 || edges[0]!.is_external)
    throw new UnsupportedEditError("Comment anchoring requires an existing comment body.");
  const part = edges[0]!.target_part.partname.toString(),
    container = store.ref(part, store.xml(part).root),
    comment = new Comments(store, container).get(comment_id);
  if (!comment)
    throw new UnsupportedEditError("Comment anchoring requires an existing comment body.");
  const visit = (node: XmlElement): boolean =>
    (["commentRangeStart", "commentRangeEnd", "commentReference"].includes(node.localName) &&
      commentAttribute(node, "id") === String(comment_id)) ||
    node.children.some(visit);
  if (
    store
      .snapshot()
      .members.some(
        (member) => member.name.endsWith(".xml") && visit(store.xml("/" + member.name).root)
      )
  )
    throw new UnsupportedEditError("Comment body already has an anchor.");
  applyCommentRange(store, first, last, comment_id);
}

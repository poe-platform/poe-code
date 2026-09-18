import { DocumentView } from "./document-model.js";
import { Settings } from "./settings-model.js";
import { Comments } from "./review-model.js";
import { originalModelDefaults } from "./default-model-styles.js";
import type { DocumentArchive } from "./archive.js";
import { InputTypeError, archiveSettings, type ArchiveLimits } from "./archive.js";
import type { AdmittedModelContext } from "./model-context.js";
import { appendBodyBlocks, DocumentXmlEditor, UnsupportedEditError } from "./xml-write.js";
import { parseDocumentXml, type XmlElement } from "./package-xml.js";
import { PackageView, XmlPartView, StoryPart, DocumentPartView, StylesPart, packagePart, type SettingsPart, type CommentsPart, packageOwnerCheckpoint } from "./package-view.js";
import { bindXmlElementView, type XmlElementView } from "./xml-element-view.js";
import { validateDocumentArchive, SemanticValidationError } from "./validation.js";
import { StaleHandleError } from "./model-errors.js";
import { Paragraph, Run } from "./block-model.js";
import { Table } from "./table-model.js";
import {
  assertDocumentEditable,
  PublicationError,
  publishDocumentArchive,
  publicationGenerationGuard
} from "./publication.js";
import { modelOutput, type DocumentOutput, type DocumentSaveOptions, type ModelPublicationSource } from "./model-output.js";
import { paragraphTextRun, replaceParagraphContent } from "./paragraph-content.js";
import { renderContent, xmlValue } from "./create-content.js";
import { documentDialects, dialectForNamespace } from "./dialect.js";
import { runElementOpen } from "./run-properties.js";
import { DocumentPackage } from "./package.js";
import { asciiKey, normalizePartName, relativePartTarget } from "./part-uri.js";
import {
  bindDocumentStyles,
  styleOwnerCheckpoints,
  type Styles,
  type TableStyle,
  type ParagraphStyle
} from "./styles-model.js";
import { WD_STYLE_TYPE } from "./formatting-values.js";
import { addDocumentStylesPart } from "./styles-part.js";
import type { Length } from "./formatting-values.js";
import { activeModelChildren } from "./model-active-children.js";
import { findRelationshipPart } from "./relationship-part.js";
import { documentTypes } from "./admission.js";
import { parseMediaType } from "./media-type.js";

export interface ModelRef {
  readonly part: string;
  readonly id: number;
}
interface Handle {
  ref: ModelRef;
  part: string;
  node: XmlElement | null;
  identity: object;
}

/** Shared admitted state; all model writes use the loss-preserving XML editor. */
export class ModelStore {
  readonly package: PackageView;
  private mainPartName: string;
  get mainPart(): string { return this.mainPartName; }
  private boundStyles: Styles | undefined;
  private boundDocument: DocumentView | undefined;
  private readonly documents = new WeakMap<DocumentPartView, DocumentView>();
  get document(): DocumentView { return this.boundDocument ??= new DocumentView(this); }
  nativeDocument(part: DocumentPartView): DocumentView {
    if (part.package !== this.package) throw new InputTypeError("Expected this package's document owner.");
    const name = part.partname.toString();
    if (this.memberName(name) === this.memberName(this.mainPart)) return this.document;
    let document = this.documents.get(part);
    if (!document) { document = new DocumentView(this, name); this.documents.set(part, document); }
    return document;
  }
  private styleBindingToken: object | null = null;
  private archive: DocumentArchive;
  private readonly editors = new Map<string, DocumentXmlEditor>();
  private readonly handles = new Map<number, Handle>();
  private readonly objects = new Map<number, object>();
  private readonly elements = new Map<number, XmlElementView>();
  private nextId = 0;
  revision = 0;
  private publishing = false;
  private transactionDepth = 0;
  constructor(
    archive: DocumentArchive,
    readonly context: AdmittedModelContext,
    mainPart: string,
    private readonly source?: ModelPublicationSource
  ) {
    this.archive = archive;
    this.mainPartName = mainPart.startsWith("/") ? mainPart : "/" + mainPart;
    this.package = new PackageView({
      model: this,
      context,
      snapshot: () => this.snapshot(),
      version: () => this.revision,
      writable: () => this.writable(),
      stage: (candidate, rename) => {
        context.budget.charge(
          "retainedBytes",
          (this.archive.members.length + candidate.members.length) * 96
        );
        const current = new Map(
          this.snapshot().members.map((member) => ["/" + member.name, member.bytes])
        );
        const from = rename ? "/" + this.memberName(rename.from) : undefined;
        if (rename && from) current.set(rename.to, current.get(from)!);
        const unchanged = new Set(
          candidate.members
            .filter((member) => {
              const previous = current.get("/" + member.name);
              context.budget.charge("work", member.bytes.length + 1);
              return (
                previous?.length === member.bytes.length &&
                previous.every((byte, index) => byte === member.bytes[index])
              );
            })
            .map((member) => "/" + member.name)
        );
        if (rename && from) {
          const editor = this.editors.get(from);
          if (editor) { this.editors.delete(from); this.editors.set(rename.to, editor); }
          for (const handle of this.handles.values()) if (handle.part === from) handle.part = rename.to;
          if ("/" + this.memberName(this.mainPart) === from) this.mainPartName = rename.to;
        }
        this.archive = candidate;
        for (const part of this.editors.keys()) if (!unchanged.has(part)) this.editors.delete(part);
        for (const handle of this.handles.values())
          if (!unchanged.has(handle.ref.part)) handle.node = null;
        this.revision++;
      },
      save: (output, options) => this.save(output, options)
    });
    const dialect = dialectForNamespace(this.xml(this.mainPart).root.namespace)!;
    const stylePart = new DocumentPackage(this.snapshot(), context.limits, context.budget)
      .relationships(this.mainPart)
      .find((edge) => edge.reltype === documentDialects[dialect].r + "/styles" && !edge.is_external)
      ?.target_part.partname;
    if (stylePart) this.bindStyles(stylePart);
  }
  private bindStyles(partname: string): void {
    const token = Object.freeze({});
    this.styleBindingToken = token;
    const valid = () => {
      if (this.styleBindingToken !== token)
        throw new StaleHandleError("The styles owner is detached.");
    };
    this.boundStyles = bindDocumentStyles({
      context: this.context,
      package: this.package,
      partname,
      read: () => {
        valid();
        return this.xml(partname).serialize();
      },
      write: (bytes) => {
        valid();
        this.setPart(partname, bytes);
      },
      writable: () => {
        valid();
        this.writable();
      }
    });
  }
  nativeStyles(part: StylesPart): Styles {
    if (part.package !== this.package) throw new InputTypeError("Expected this document's styles part.");
    return bindDocumentStyles({
      context: this.context, package: this.package, partname: part.partname.toString(), part,
      read: () => this.xml(part.partname.toString()).serialize(),
      write: bytes => this.setPart(part.partname.toString(), bytes),
      writable: () => { void part.content_type; this.writable(); }
    });
  }
  nativeSettings(part: SettingsPart): Settings {
    if (part.package !== this.package) throw new InputTypeError("Expected this document's settings part.");
    return new Settings(this, part.partname.toString());
  }
  nativeComments(part: CommentsPart): Comments {
    if (part.package !== this.package) throw new InputTypeError("Expected this document's comments part.");
    const name = part.partname.toString(), root = this.xml(name).root;
    if (root.localName !== "comments" || root.namespace !== this.xml(this.mainPart).root.namespace)
      throw new InputTypeError("Expected an owned comments root.");
    return new Comments(this, this.ref(name, root));
  }
  stylesForDocument(owner: string): Styles {
    if (this.memberName(owner) === this.memberName(this.mainPart)) return this.styles;
    const graph = new DocumentPackage(this.snapshot(), this.context.limits, this.context.budget);
    const dialect = dialectForNamespace(this.xml(owner).root.namespace)!;
    const edges = graph.relationships(owner).filter(edge => edge.reltype === documentDialects[dialect].r + "/styles");
    if (edges.length > 1 || edges[0]?.is_external) throw new UnsupportedEditError("Expected one internal styles owner.");
    let name = edges[0]?.target_part.partname;
    if (!name) name = this.transaction(() => {
      const added = addDocumentStylesPart(this.snapshot(), { mainPart: this.memberName(owner), dialect, package: graph }, originalModelDefaults(documentDialects[dialect].w), this.context.budget);
      this.archive = added.archive;
      const rel = findRelationshipPart(graph, owner, this.context.budget);
      if (rel) this.editors.delete("/" + rel.name);
      this.editors.delete("/[Content_Types].xml");
      this.revision++;
      return "/" + added.name;
    });
    const part = this.part(name);
    if (!(part instanceof StylesPart)) throw new InputTypeError("Expected a native styles part.");
    return part.styles;
  }
  stylesForStory(part: string): Styles {
    return this.stylesForDocument(this.documentOwnerForStory(part));
  }
  documentOwnerForStory(part: string): string {
    const root = this.xml(part).root;
    if (root.localName === "document") return part;
    const role = root.localName === "hdr" ? "header" : root.localName === "ftr" ? "footer" : root.localName;
    const dialect = dialectForNamespace(root.namespace);
    if (!dialect) throw new InputTypeError("Expected a native story namespace.");
    const graph = new DocumentPackage(this.snapshot(), this.context.limits, this.context.budget);
    const target = asciiKey(normalizePartName(part));
    const owners = graph.parts.filter(owner => Object.values(documentTypes).includes(parseMediaType(owner.content_type)))
      .filter(owner => graph.relationships(owner.partname).some(edge => !edge.is_external &&
        edge.reltype === documentDialects[dialect].r + "/" + role && asciiKey(edge.target_part.partname) === target));
    if (owners.length > 1) {
      const definitions = owners.map(owner => graph.relationships(owner.partname)
        .filter(edge => edge.reltype === documentDialects[dialect].r + "/styles"));
      if (definitions.some(edges => edges.length !== 1 || edges[0]!.is_external) ||
          new Set(definitions.map(edges => asciiKey(edges[0]!.target_part.partname))).size !== 1)
        throw new UnsupportedEditError("The story has ambiguous document style ownership.");
    }
    return owners[0]?.partname ?? this.mainPart;
  }
  withStyleDefinitions<T>(resolve: (styles: Styles) => T, owner = this.mainPart): T {
    owner = this.documentOwnerForStory(owner);
    if (this.memberName(owner) === this.memberName(this.mainPart) && this.boundStyles) return resolve(this.boundStyles);
    const graph = new DocumentPackage(this.snapshot(), this.context.limits, this.context.budget);
    const dialect = dialectForNamespace(this.xml(owner).root.namespace)!;
    if (graph.relationships(owner).some(edge => edge.reltype === documentDialects[dialect].r + "/styles"))
      return resolve(this.stylesForDocument(owner));
    return this.transaction(() => resolve(this.stylesForDocument(owner)));
  }
  get styles(): Styles {
    if (!this.boundStyles) {
      this.writable();
      const dialect = dialectForNamespace(this.xml(this.mainPart).root.namespace)!;
      const added = addDocumentStylesPart(
        this.snapshot(),
        {
          mainPart: this.mainPart.slice(1),
          dialect,
          package: new DocumentPackage(this.snapshot(), this.context.limits, this.context.budget)
        },
        originalModelDefaults(documentDialects[dialect].w),
        this.context.budget
      );
      this.archive = added.archive;
      this.editors.delete(
        "/" + this.memberName(this.mainPart.slice(0, this.mainPart.lastIndexOf("/") + 1) +
          "_rels/" +
          this.mainPart.slice(this.mainPart.lastIndexOf("/") + 1) +
          ".rels")
      );
      this.editors.delete("/[Content_Types].xml");
      this.revision++;
      this.bindStyles("/" + added.name);
    }
    return this.boundStyles!;
  }

  writable(): void {
    this.context.budget.check("work", 0);
    if (this.publishing) throw new PublicationError("conflict", "Model publication is committing.");
    if (!this.transactionDepth) assertDocumentEditable(this.snapshot(), this.context);
  }
  transaction<T>(action: () => T): T {
    this.writable();
    const archive = this.snapshot(),
      editors = new Map(this.editors),
      revision = this.revision,
      mainPart = this.mainPart,
      boundStyles = this.boundStyles,
      styleBindingToken = this.styleBindingToken;
    const restoreStyles = boundStyles && styleOwnerCheckpoints.get(boundStyles)?.();
    const restorePackage = this.package[packageOwnerCheckpoint]();
    const handles = new Map([...this.handles].map(([id, handle]) => [id, { ...handle }]));
    this.transactionDepth++;
    try {
      const result = action();
      if (this.transactionDepth === 1) {
        const report = validateDocumentArchive(this.snapshot(), {}, this.context.budget);
        if (!report.valid) throw new SemanticValidationError(report.diagnostics);
      }
      return result;
    } catch (error) {
      this.archive = archive;
      this.editors.clear();
      for (const [part, xml] of editors) this.editors.set(part, xml);
      this.handles.clear();
      for (const [id, handle] of handles) this.handles.set(id, handle);
      this.revision = revision;
      this.mainPartName = mainPart;
      this.boundStyles = boundStyles;
      this.styleBindingToken = styleBindingToken;
      restoreStyles?.();
      restorePackage();
      throw error;
    } finally {
      this.transactionDepth--;
    }
  }
  assertReplaceable(node: XmlElement): void {
    const visit = (child: XmlElement) => {
      this.context.budget.charge("work", 1);
      if (
        child.namespace !== node.namespace ||
        [
          "drawing",
          "pict",
          "object",
          "fldSimple",
          "fldChar",
          "instrText",
          "footnoteReference",
          "endnoteReference",
          "commentRangeStart",
          "commentRangeEnd",
          "commentReference",
          "bookmarkStart",
          "bookmarkEnd",
          "permStart",
          "permEnd",
          "ins",
          "del",
          "moveFrom",
          "moveTo"
        ].includes(child.localName)
      )
        throw new UnsupportedEditError(
          "Whole text replacement cannot discard independently owned content."
        );
      for (const nested of child.children) visit(nested);
    };
    visit(node);
  }
  deletePart(part: string): void {
    this.writable();
    const name = this.memberName(part);
    this.archive = this.snapshot();
    this.archive = {
      ...this.archive,
      members: this.archive.members.filter((member) => member.name !== name)
    };
    this.editors.delete("/" + name);
    for (const handle of this.handles.values())
      if (handle.ref.part === "/" + name) handle.node = null;
    this.revision++;
  }
  snapshot(): DocumentArchive {
    return {
      comment: this.archive.comment.slice(),
      members: this.archive.members.map((member) => ({
        ...member,
        bytes: this.editors.get("/" + member.name)?.serialize() ?? member.bytes.slice(),
        modified: new Date(member.modified.getTime())
      }))
    };
  }
  private memberName(part: string): string {
    const name = part.startsWith("/") ? part.slice(1) : part;
    const key = asciiKey(name) === "[content_types].xml" ? "/[content_types].xml" : asciiKey(normalizePartName("/" + name));
    for (const member of this.archive.members) {
      this.context.budget.charge("work", 1 + member.name.length);
      if (member.directory) continue;
      const candidate = asciiKey(member.name) === "[content_types].xml" ? "/[content_types].xml" : asciiKey(normalizePartName("/" + member.name));
      if (key === candidate) return member.name;
    }
    return name;
  }
  xml(part: string): DocumentXmlEditor {
    part = "/" + this.memberName(part);
    let xml = this.editors.get(part);
    if (!xml) {
      const member = this.archive.members.find((member) => "/" + member.name === part);
      if (!member) throw new StaleHandleError("The part is no longer attached.");
      xml = new DocumentXmlEditor(member.bytes, {}, undefined, this.context.budget);
      this.editors.set(part, xml);
    }
    return xml;
  }
  ref(part: string, node: XmlElement): ModelRef {
    part = "/" + this.memberName(part);
    for (const handle of this.handles.values())
      if (handle.ref.part === part && handle.node === node) return handle.ref;
    this.context.budget.charge("retainedBytes", 192);
    const id = this.nextId++, handles = this.handles;
    const ref = Object.freeze({ get part() { return handles.get(id)?.part ?? part; }, id });
    this.handles.set(ref.id, { ref, part, node, identity: Object.freeze({}) });
    return ref;
  }
  node(ref: ModelRef): XmlElement {
    this.context.budget.check("work", 0);
    const handle = this.handles.get(ref.id);
    if (handle?.ref !== ref || !handle.node)
      throw new StaleHandleError("The model handle is detached.");
    return handle.node;
  }
  identity(ref: ModelRef): object {
    this.node(ref);
    return this.handles.get(ref.id)!.identity;
  }
  invalidateDescendants(ref: ModelRef): void {
    const root = this.node(ref);
    const descendants = new Set<XmlElement>();
    const visit = (node: XmlElement) => {
      for (const child of node.children) {
        descendants.add(child);
        visit(child);
      }
    };
    visit(root);
    for (const handle of this.handles.values())
      if (handle.node && descendants.has(handle.node)) handle.node = null;
  }
  change(part: string, action: (xml: DocumentXmlEditor) => void): void {
    this.writable();
    part = "/" + this.memberName(part);
    const old = this.xml(part);
    const candidate = new DocumentXmlEditor(old.serialize(), {}, undefined, this.context.budget);
    // Callbacks resolve against the current owner editor; publication occurs only after successful serialization.
    this.editors.set(part, candidate);
    const oldToCandidate = new Map<XmlElement, XmlElement>();
    const pair = (left: XmlElement, right: XmlElement) => {
      oldToCandidate.set(left, right);
      left.children.forEach((child, index) => {
        if (right.children[index]) pair(child, right.children[index]!);
      });
    };
    pair(old.root, candidate.root);
    const retained = [...this.handles.values()].filter((handle) => handle.ref.part === part);
    const prior = retained.map((handle) => handle.node);
    retained.forEach((handle) => {
      if (handle.node) handle.node = oldToCandidate.get(handle.node) ?? null;
    });
    const replacements = new Map<XmlElement, readonly XmlElement[]>();
    const insertions = new Map<XmlElement, { before: XmlElement | undefined; count: number }[]>();
    const fragment = (node: XmlElement, markup: string): readonly XmlElement[] => {
      const namespaces = [...node.namespaces]
        .filter(([prefix]) => prefix !== "xml")
        .map(([prefix, value]) => ` ${prefix ? "xmlns:" + prefix : "xmlns"}="${xmlValue(value)}"`)
        .join("");
      return parseDocumentXml(
        new TextEncoder().encode(`<fragment${namespaces}>${markup}</fragment>`),
        {},
        this.context.budget
      ).root.children;
    };
    const replace = candidate.replaceElement.bind(candidate),
      insert = candidate.insertChildren.bind(candidate);
    candidate.replaceElement = (node, markup) => {
      const children = fragment(node, markup);
      replace(node, markup);
      replacements.set(node, children);
    };
    candidate.insertChildren = (node, markup, before) => {
      const children = fragment(node, markup);
      insert(node, markup, before);
      const list = insertions.get(node) ?? [];
      list.push({ before, count: children.length });
      insertions.set(node, list);
    };
    const appendBody = candidate[appendBodyBlocks].bind(candidate);
    candidate[appendBodyBlocks] = (body, markup) => {
      const path = appendBody(body, markup);
      let parent = candidate.root;
      for (const index of path.slice(0, -1)) parent = parent.children[index]!;
      const children = fragment(parent, markup);
      const list = insertions.get(parent) ?? [];
      list.push({before: parent.children[path.at(-1)!], count: children.length});
      insertions.set(parent, list);
      return path;
    };
    try {
      action(candidate);
      const bytes = candidate.serialize();
      const next = new DocumentXmlEditor(bytes, {}, undefined, this.context.budget);
      const map = new Map<XmlElement, XmlElement>();
      const reconcile = (left: XmlElement, right: XmlElement) => {
        this.context.budget.charge("work", 1);
        map.set(left, right);
        const oldChildren = left.children,
          newChildren = right.children;
        if (!replacements.has(left)) {
          let position = 0;
          for (const child of oldChildren) {
            position += (insertions.get(left) ?? [])
              .filter((item) => item.before === child)
              .reduce((count, item) => count + item.count, 0);
            const roots = replacements.get(child);
            if (roots) {
              const offset = roots.findIndex(
                (root) => root.namespace === child.namespace && root.localName === child.localName
              );
              if (offset >= 0 && newChildren[position + offset])
                reconcile(child, newChildren[position + offset]!);
              position += roots.length;
            } else {
              if (newChildren[position]) reconcile(child, newChildren[position]!);
              position++;
            }
          }
          return;
        }
        const used = new Set<number>();
        const matched = new Map<number, number>();
        // Unchanged siblings retain their ordered identities inside a replaced owner.
        let floor = 0;
        oldChildren.forEach((child, i) => {
          const source = candidate.sourceXml(child);
          let j = floor;
          for (; j < newChildren.length; j++) {
            this.context.budget.charge("work", 1);
            if (source === next.sourceXml(newChildren[j]!)) break;
          }
          if (j < newChildren.length) {
            matched.set(i, j);
            used.add(j);
            floor = j + 1;
          }
        });
        oldChildren.forEach((child, i) => {
          let j = matched.get(i);
          if (
            j === undefined &&
            ["p", "tbl", "tr", "tc", "sectPr", "tblGrid", "gridCol", "pPr", "rPr"].includes(
              child.localName
            ) &&
            oldChildren.length === newChildren.length &&
            !used.has(i) &&
            child.localName === newChildren[i]?.localName &&
            child.namespace === newChildren[i]?.namespace
          ) {
            j = i;
            used.add(i);
          }
          if (j !== undefined) {
            if (candidate.sourceXml(child) !== next.sourceXml(newChildren[j]!))
              replacements.set(child, [newChildren[j]!]);
            reconcile(child, newChildren[j]!);
          }
        });
      };
      reconcile(candidate.root, next.root);
      for (const handle of retained) if (handle.node) handle.node = map.get(handle.node) ?? null;
      this.editors.set(part, next);
      this.revision++;
    } catch (error) {
      this.editors.set(part, old);
      retained.forEach((handle, index) => {
        handle.node = prior[index]!;
      });
      throw error;
    }
  }
  tableStyle(id: string | null, owner: string): TableStyle | null {
    return this.stylesForStory(owner).get_by_id(id, WD_STYLE_TYPE.TABLE) as TableStyle | null;
  }
  tableStyleId(value: string | TableStyle | null, owner: string): string | null {
    return this.stylesForStory(owner).get_style_id(value, WD_STYLE_TYPE.TABLE);
  }
  part(part: string, story: true): StoryPart;
  part(part: string): XmlPartView;
  part(part: string, story = false): XmlPartView {
    const name = normalizePartName(part.startsWith("/") ? part : "/" + part);
    const view = this.package[packagePart](name);
    if (!(view instanceof XmlPartView)) throw new StaleHandleError("The XML part is detached.");
    if (story && !(view instanceof StoryPart)) throw new InputTypeError("Expected a native story part owner.");
    return view;
  }
  element(ref: ModelRef): XmlElementView {
    this.node(ref);
    let view = this.elements.get(ref.id);
    if (!view) {
      view = bindXmlElementView({
        budget: this.context.budget,
        read: () => this.xml(ref.part),
        resolve: () => this.node(ref),
        change: (action) => this.transaction(() => this.change(ref.part, action)),
        removeRoot: () => this.transaction(() => this.change(ref.part, xml => xml.replaceElement(this.node(ref), "")))
      });
      this.elements.set(ref.id, view);
    }
    return view;
  }
  paragraph(ref: ModelRef): Paragraph {
    let view = this.objects.get(ref.id);
    if (!view) {
      view = new Paragraph(this, ref);
      this.objects.set(ref.id, view);
    }
    return view as Paragraph;
  }
  run(ref: ModelRef): Run {
    let view = this.objects.get(ref.id);
    if (!view) {
      view = new Run(this, ref);
      this.objects.set(ref.id, view);
    }
    return view as Run;
  }
  table(ref: ModelRef): Table {
    let view = this.objects.get(ref.id);
    if (!view) {
      view = new Table(this, ref);
      this.objects.set(ref.id, view);
    }
    return view as Table;
  }
  *blocks(ref: ModelRef): IterableIterator<Paragraph | Table> {
    const node = this.node(ref);
    for (const child of activeModelChildren(this, ref.part)(node)) {
      this.context.budget.charge("work", 1);
      if (child.namespace !== node.namespace) continue;
      if (child.localName === "p") yield this.paragraph(this.ref(ref.part, child));
      if (child.localName === "tbl") yield this.table(this.ref(ref.part, child));
    }
  }
  addParagraph(ref: ModelRef, text = "", style?: string | ParagraphStyle | null): Paragraph {
    if (typeof text !== "string") throw new InputTypeError("Expected paragraph text.");
    const styleId =
      style === undefined || style === null
        ? null
        : this.stylesForStory(ref.part).get_style_id(style, WD_STYLE_TYPE.PARAGRAPH);
    const node = this.node(ref);
    const count = node.children.length;
    let insertedPath: readonly number[] | undefined;
    this.change(ref.part, (xml) => {
      const parent = this.node(ref);
      const markup = `<bm:p xmlns:bm="${parent.namespace}">${styleId ? `<bm:pPr><bm:pStyle bm:val="${xmlValue(styleId)}"/></bm:pPr>` : ""}${text ? paragraphTextRun(parent.namespace, text) : ""}</bm:p>`;
      if (parent.localName === "body") { insertedPath = xml[appendBodyBlocks](parent, markup); return; }
      const section = parent.children.find(
        (child) => child.namespace === parent.namespace && child.localName === "sectPr"
      );
      xml.insertChildren(
        parent,
        markup,
        section
      );
    });
    if (insertedPath) {
      let inserted = this.xml(ref.part).root;
      for (const index of insertedPath) inserted = inserted.children[index]!;
      return this.paragraph(this.ref(ref.part, inserted));
    }
    const parent = this.node(ref);
    const child = parent.children[Math.min(count, parent.children.length - 1)]!;
    const inserted =
      child.localName === "sectPr" ? parent.children[parent.children.indexOf(child) - 1]! : child;
    return this.paragraph(this.ref(ref.part, inserted));
  }
  addTable(ref: ModelRef, rows: number, cols: number, width?: Length): Table {
    if (![rows, cols].every((value) => Number.isSafeInteger(value) && value > 0))
      throw new RangeError("Expected positive table dimensions.");
    const parent = this.node(ref);
    const section = parent.children.find(
      (child) => child.localName === "sectPr" && child.namespace === parent.namespace
    );
    const insertionIndex = section ? parent.children.indexOf(section) : parent.children.length;
    let insertedPath: readonly number[] | undefined;
    const markup = renderContent(
      {
        version: 1,
        blocks: [
          {
            kind: "table",
            rows: Array.from({ length: rows }, () =>
              Array.from({ length: cols }, () => ({ blocks: [] }))
            ),
            ...(width ? { width: { value: width.emu, unit: "emu" } } : {})
          }
        ]
      },
      parent.namespace,
      this.context.budget,
      undefined,
      width?.twips
    ).body;
    this.change(ref.part, (xml) => {
      const owner = this.node(ref);
      if (owner.localName === "body") { insertedPath = xml[appendBodyBlocks](owner, markup); return; }
      xml.insertChildren(
        owner,
        markup + (owner.localName === "tc" ? `<bm:p xmlns:bm="${owner.namespace}"/>` : ""),
        owner.children.find(
          (child) => child.localName === "sectPr" && child.namespace === owner.namespace
        )
      );
    });
    if (insertedPath) {
      let inserted = this.xml(ref.part).root;
      for (const index of insertedPath) inserted = inserted.children[index]!;
      return this.table(this.ref(ref.part, inserted));
    }
    const node = this.node(ref);
    const table = node.children[insertionIndex]!;
    return this.table(this.ref(ref.part, table));
  }
  cellText(ref: ModelRef, text: string): void {
    if (typeof text !== "string") throw new InputTypeError("Expected cell text.");
    this.change(ref.part, (xml) => {
      const cell = this.node(ref);
      if (cell.children.some((child) => child.localName !== "tcPr" && child.localName !== "p"))
        throw new UnsupportedEditError("Whole cell text cannot discard rich blocks.");
      const props = cell.children.find((child) => child.localName === "tcPr");
      const paragraphs = cell.children.filter((child) => child.localName === "p");
      for (const p of paragraphs) replaceParagraphContent(xml, p, "", "", this.context.budget);
      xml.replaceElement(
        cell,
        runElementOpen(cell) +
          (props ? xml.sourceXml(props) : "") +
          `<bm:p xmlns:bm="${cell.namespace}">${paragraphTextRun(cell.namespace, text)}</bm:p></${cell.name}>`
      );
    });
    this.invalidateDescendants(ref);
  }
  setPart(part: string, bytes: Uint8Array, contentType?: string): void {
    if (!this.transactionDepth) {
      this.transaction(() => this.setPart(part, bytes, contentType));
      return;
    }
    this.writable();
    const name = this.memberName(part);
    this.archive = this.snapshot();
    const found = this.archive.members.find((member) => member.name === name);
    if (found) {
      this.archive = {
        ...this.archive,
        members: this.archive.members.map((member) =>
          member === found ? { ...member, bytes: bytes.slice() } : member
        )
      };
      this.editors.delete("/" + name);
      for (const handle of this.handles.values())
        if (handle.ref.part === "/" + name) handle.node = null;
    } else
      this.archive = {
        ...this.archive,
        members: [
          ...this.archive.members,
          {
            name,
            bytes: bytes.slice(),
            directory: false,
            modified: new Date("1980-01-01T00:00:00Z")
          }
        ]
      };
    this.revision++;
    if (contentType)
      this.change("/[Content_Types].xml", (xml) => {
        if (
          !xml.root.children.some((child) =>
            child.attributes.some((a) => a.localName === "PartName" && a.value === "/" + name)
          )
        )
          xml.insertChildren(
            xml.root,
            `<Override xmlns="${xml.root.namespace}" PartName="/${xmlValue(name)}" ContentType="${xmlValue(contentType)}"/>`
          );
      });
  }
  ensureComments(owner = this.mainPart): ModelRef {
    if (!this.transactionDepth) return this.transaction(() => this.ensureComments(owner));
    const graph = new DocumentPackage(this.snapshot(), this.context.limits, this.context.budget);
    const r = documentDialects[dialectForNamespace(this.xml(owner).root.namespace)!].r;
    const edges = graph
      .relationships(owner)
      .filter((edge) => edge.reltype === r + "/comments");
    if (edges.length > 1 || edges[0]?.is_external)
      throw new UnsupportedEditError("Expected one internal comments part.");
    let part = edges[0]?.target_part.partname;
    if (!part) {
      part = graph.allocatePartName(
        owner.slice(0, owner.lastIndexOf("/") + 1) + "comments",
        ".xml"
      );
      const w = this.xml(owner).root.namespace;
      this.setPart(
        part,
        new TextEncoder().encode(`<bm:comments xmlns:bm="${w}"/>`),
        "application/vnd.openxmlformats-officedocument.wordprocessingml.comments+xml"
      );
      const relationshipPart = findRelationshipPart(graph, owner, this.context.budget);
      const relName = relationshipPart ? "/" + relationshipPart.name :
        owner.slice(0, owner.lastIndexOf("/") + 1) +
        "_rels/" +
        owner.slice(owner.lastIndexOf("/") + 1) +
        ".rels";
      if (!relationshipPart)
        this.setPart(
          relName,
          new TextEncoder().encode(
            '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"/>'
          )
        );
      this.change(relName, (xml) =>
        xml.insertChildren(
          xml.root,
          `<Relationship xmlns="${xml.root.namespace}" Id="${graph.allocateRelationshipId(owner)}" Type="${r}/comments" Target="${relativePartTarget(owner, part!)}"/>`
        )
      );
    }
    return this.ref(part, this.xml(part).root);
  }
  detachedParagraph(xml: string, part: string): Paragraph {
    const snapshot = this.snapshot(),
      root = this.xml(this.mainPart).root;
    const bytes = new TextEncoder().encode(
      `<bm:document xmlns:bm="${root.namespace}"><bm:body>${xml}<bm:sectPr/></bm:body></bm:document>`
    );
    const archive = {
      ...snapshot,
      members: snapshot.members.map((member) =>
        "/" + member.name === this.mainPart ? { ...member, bytes } : member
      )
    };
    const detached = new ModelStore(archive, this.context, this.mainPart),
      body = detached.xml(this.mainPart).root.children[0]!;
    const result = detached.paragraph(detached.ref(this.mainPart, body.children[0]!));
    Object.defineProperty(result, "part", { get: () => this.part(part) });
    return result;
  }
  async publish(
    options: import("./publication.js").PublicationOptions,
    context: import("./publication.js").PublicationContext
  ) {
    const revision = this.revision,
      caller = archiveSettings(context);
    const signal = AbortSignal.any([this.context.signal, caller.signal]);
    const limits = Object.fromEntries(
      Object.entries(this.context.limits).map(([key, value]) => [
        key,
        Math.min(value, caller.limits[key as keyof ArchiveLimits])
      ])
    ) as unknown as ArchiveLimits;
    const budget = this.context.budget.lower(
      Object.fromEntries(
        Object.entries(this.context.budget.limits).map(([key, value]) => [
          key,
          Math.min(value, caller.budget.limits[key as keyof typeof caller.budget.limits])
        ])
      ),
      signal
    );
    return publishDocumentArchive(this.snapshot(), options, {
      ...context,
      limits,
      signal,
      budget,
      encoding: { order: "input", compression: "store" },
      [publicationGenerationGuard]: () => {
        if (this.publishing || revision !== this.revision)
          throw new PublicationError("conflict", "Model changed before publication.");
        this.publishing = true;
        return () => {
          this.publishing = false;
        };
      }
    });
  }
  async save(output: DocumentOutput, options: DocumentSaveOptions = {}): Promise<void> {
    const target = modelOutput(output, options, this.context, this.source);
    const revision = this.revision;
    await publishDocumentArchive(
      this.snapshot(),
      target.options,
      {
        ...this.context,
        ...target,
        encoding: { order: "input", compression: "store" },
        [publicationGenerationGuard]: () => {
          if (this.publishing || revision !== this.revision)
            throw new PublicationError("conflict", "Model changed before publication.");
          this.publishing = true;
          return () => {
            this.publishing = false;
          };
        }
      }
    );
  }
}

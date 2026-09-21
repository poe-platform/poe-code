import { originalModelDefaults } from "./default-model-styles.js";
import type { DocumentArchive } from "./archive.js";
import { InputTypeError, archiveSettings, type ArchiveLimits } from "./archive.js";
import type { AdmittedModelContext } from "./model-context.js";
import { DocumentXmlEditor, UnsupportedEditError } from "./xml-write.js";
import { parseDocumentXml, type XmlElement } from "./package-xml.js";
import { PackageView, XmlPartView, packageOwnerCheckpoint } from "./package-view.js";
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
import type { ArchiveSink } from "./archive-write.js";
import { paragraphTextRun, replaceParagraphContent, paragraphReferenceMarkers, paragraphAnnotationMarkers } from "./paragraph-content.js";
import { renderContent, xmlValue } from "./create-content.js";
import { documentDialects, dialectForNamespace } from "./dialect.js";
import { runElementOpen } from "./run-properties.js";
import { DocumentPackage } from "./package.js";
import { relativePartTarget } from "./part-uri.js";
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

export interface ModelRef {
  readonly part: string;
  readonly id: number;
}
interface Handle {
  ref: ModelRef;
  node: XmlElement | null;
  identity: object;
}

/** Shared admitted state; all model writes use the loss-preserving XML editor. */
export class ModelStore {
  readonly package: PackageView;
  readonly mainPart: string;
  private boundStyles: Styles | undefined;
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
    mainPart: string
  ) {
    this.archive = archive;
    this.mainPart = mainPart.startsWith("/") ? mainPart : "/" + mainPart;
    this.package = new PackageView({
      context,
      snapshot: () => this.snapshot(),
      version: () => this.revision,
      writable: () => this.writable(),
      stage: (candidate) => {
        context.budget.charge(
          "retainedBytes",
          (this.archive.members.length + candidate.members.length) * 96
        );
        const current = new Map(
          this.snapshot().members.map((member) => ["/" + member.name, member.bytes])
        );
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
        this.archive = candidate;
        for (const part of this.editors.keys()) if (!unchanged.has(part)) this.editors.delete(part);
        for (const handle of this.handles.values())
          if (!unchanged.has(handle.ref.part)) handle.node = null;
        this.revision++;
      },
      save: (sink) => this.save(sink)
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
        this.mainPart.slice(0, this.mainPart.lastIndexOf("/") + 1) +
          "_rels/" +
          this.mainPart.slice(this.mainPart.lastIndexOf("/") + 1) +
          ".rels"
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
    const name = part.startsWith("/") ? part.slice(1) : part;
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
  xml(part: string): DocumentXmlEditor {
    part = part.startsWith("/") ? part : "/" + part;
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
    part = part.startsWith("/") ? part : "/" + part;
    for (const handle of this.handles.values())
      if (handle.ref.part === part && handle.node === node) return handle.ref;
    this.context.budget.charge("retainedBytes", 192);
    const ref = Object.freeze({ part, id: this.nextId++ });
    this.handles.set(ref.id, { ref, node, identity: Object.freeze({}) });
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
  change(
    part: string,
    action: (xml: DocumentXmlEditor) => void,
    discarded: readonly ModelRef[] = []
  ): void {
    this.writable();
    const old = this.xml(part);
    const detached = new Set<XmlElement>();
    const discard = (node: XmlElement): void => {
      this.context.budget.charge("work", 1);
      if (
        node.namespace === old.root.namespace &&
        (paragraphReferenceMarkers.has(node.localName) || paragraphAnnotationMarkers.has(node.localName))
      )
        return;
      detached.add(node);
      for (const child of node.children) discard(child);
    };
    for (const ref of discarded) discard(this.node(ref));
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
    const detachedCandidates = new Set([...detached].map((node) => oldToCandidate.get(node)));
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
      // Retained annotations may move when destructive assignment replaces their container.
      const retainedMarkers = (root: XmlElement): XmlElement[] => {
        const result: XmlElement[] = [];
        const visit = (node: XmlElement): void => {
          this.context.budget.charge("work", 1);
          if (
            node.namespace === root.namespace &&
            (paragraphReferenceMarkers.has(node.localName) || paragraphAnnotationMarkers.has(node.localName))
          )
            result.push(node);
          for (const child of node.children) visit(child);
        };
        visit(root);
        return result;
      };
      if (discarded.length) {
        const previous = retainedMarkers(candidate.root),
          current = retainedMarkers(next.root);
        if (previous.length === current.length)
          previous.forEach((node, index) => {
            const replacement = current[index]!;
            if (candidate.sourceXml(node) === next.sourceXml(replacement))
              map.set(node, replacement);
          });
      }
      for (const handle of retained)
        if (handle.node)
          handle.node = detachedCandidates.has(handle.node) ? null : (map.get(handle.node) ?? null);
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
  tableStyle(id: string | null): TableStyle | null {
    return this.styles.get_by_id(id, WD_STYLE_TYPE.TABLE) as TableStyle | null;
  }
  tableStyleId(value: string | TableStyle | null): string | null {
    return this.styles.get_style_id(value, WD_STYLE_TYPE.TABLE);
  }
  part(part: string): XmlPartView {
    const view = this.package.parts.find((view) => view.partname.toString() === part);
    if (!(view instanceof XmlPartView)) throw new StaleHandleError("The XML part is detached.");
    return view;
  }
  element(ref: ModelRef): XmlElementView {
    this.node(ref);
    let view = this.elements.get(ref.id);
    if (!view) {
      view = bindXmlElementView({
        budget: this.context.budget,
        child: (node) => this.element(this.ref(ref.part, node)),
        read: () => this.xml(ref.part),
        resolve: () => this.node(ref),
        change: (action) => this.transaction(() => this.change(ref.part, action)),
        removeRoot: () =>
          this.transaction(() =>
            this.change(ref.part, (xml) => xml.replaceElement(this.node(ref), ""))
          )
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
    for (const child of node.children) {
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
        : this.styles.get_style_id(style, WD_STYLE_TYPE.PARAGRAPH);
    const node = this.node(ref);
    const count = node.children.length;
    this.change(ref.part, (xml) => {
      const parent = this.node(ref);
      const section = parent.children.find(
        (child) => child.namespace === parent.namespace && child.localName === "sectPr"
      );
      xml.insertChildren(
        parent,
        `<bm:p xmlns:bm="${parent.namespace}">${styleId ? `<bm:pPr><bm:pStyle bm:val="${xmlValue(styleId)}"/></bm:pPr>` : ""}${text ? paragraphTextRun(parent.namespace, text) : ""}</bm:p>`,
        section
      );
    });
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
      xml.insertChildren(
        owner,
        markup + (owner.localName === "tc" ? `<bm:p xmlns:bm="${owner.namespace}"/>` : ""),
        owner.children.find(
          (child) => child.localName === "sectPr" && child.namespace === owner.namespace
        )
      );
    });
    const node = this.node(ref);
    const table = node.children[insertionIndex]!;
    return this.table(this.ref(ref.part, table));
  }
  cellText(ref: ModelRef, text: string): void {
    if (typeof text !== "string") throw new InputTypeError("Expected cell text.");
    const owner = this.node(ref);
    const discarded = owner.children
      .filter(child => child.namespace === owner.namespace && child.localName === "p")
      .map(child => this.ref(ref.part, child));
    this.change(ref.part, (xml) => {
      const cell = this.node(ref);
      if (cell.children.some((child) => child.localName !== "tcPr" && child.localName !== "p"))
        throw new UnsupportedEditError("Whole cell text cannot discard rich blocks.");
      const props = cell.children.find((child) => child.localName === "tcPr");
      const paragraphs = cell.children.filter((child) => child.localName === "p");
      const namespaces = new Map(cell.namespaces);
      const rangeMarkers: Record<string, readonly [string, boolean]> = {
        bookmarkStart: ["bookmark", true], bookmarkEnd: ["bookmark", false],
        commentRangeStart: ["comment", true], commentRangeEnd: ["comment", false],
        permStart: ["permission", true], permEnd: ["permission", false]
      };
      const ranges = new Set<string>();
      const content = paragraphs.map((p, index) => {
        for (const marker of p.children) {
          this.context.budget.charge("work", 1);
          if (marker.namespace !== cell.namespace) continue;
          const range = rangeMarkers[marker.localName];
          const attribute = (name: string) => marker.attributes.find(a =>
            a.namespace === cell.namespace && a.localName === name)?.value;
          const proof = marker.localName === "proofErr" ? attribute("type") : undefined;
          const family = range?.[0] ?? (proof === "spellStart" || proof === "spellEnd" ? "spell" :
            proof === "gramStart" || proof === "gramEnd" ? "grammar" : undefined);
          if (!family) {
            if (marker.localName === "proofErr")
              throw new UnsupportedEditError("Whole cell text cannot relocate malformed annotation markers.");
            continue;
          }
          const id = range ? attribute("id") : "proof";
          const start = range ? range[1] : proof === "spellStart" || proof === "gramStart";
          const key = `${family}:${id}`;
          if (id === undefined || (start ? ranges.has(key) : !ranges.has(key)))
            throw new UnsupportedEditError("Whole cell text cannot relocate malformed annotation markers.");
          if (start) ranges.add(key);
          else ranges.delete(key);
        }
        for (const [prefix, namespace] of p.namespaces) {
          if (namespaces.has(prefix) && namespaces.get(prefix) !== namespace)
            throw new UnsupportedEditError("Whole cell text cannot relocate conflicting namespace scopes.");
          namespaces.set(prefix, namespace);
        }
        const replacement = replaceParagraphContent(xml, p, "", index === 0 ? text : "");
        return replacement.slice(runElementOpen(p).length, -(`</${p.name}>`.length));
      }).join("");
      if (ranges.size)
        throw new UnsupportedEditError("Whole cell text cannot relocate unmatched annotation markers.");
      const declarations = [...namespaces].filter(([prefix]) => prefix !== "xml")
        .map(([prefix, namespace]) => ` ${prefix ? `xmlns:${prefix}` : "xmlns"}="${xmlValue(namespace)}"`).join("");
      const prefix = [...namespaces].find(([name, namespace]) => name && namespace === cell.namespace)?.[0];
      const name = prefix ? `${prefix}:p` : "p";
      xml.replaceElement(
        cell,
        runElementOpen(cell) +
          (props ? xml.sourceXml(props) : "") +
          `<${name}${declarations}>${content || paragraphTextRun(cell.namespace, text)}</${name}></${cell.name}>`
      );
    }, discarded);
  }
  setPart(part: string, bytes: Uint8Array, contentType?: string): void {
    if (!this.transactionDepth) {
      this.transaction(() => this.setPart(part, bytes, contentType));
      return;
    }
    this.writable();
    const name = part.startsWith("/") ? part.slice(1) : part;
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
  ensureComments(): ModelRef {
    if (!this.transactionDepth) return this.transaction(() => this.ensureComments());
    const graph = new DocumentPackage(this.snapshot(), this.context.limits, this.context.budget);
    const r = documentDialects[dialectForNamespace(this.xml(this.mainPart).root.namespace)!].r;
    const edges = graph
      .relationships(this.mainPart)
      .filter((edge) => edge.reltype === r + "/comments");
    if (edges.length > 1 || edges[0]?.is_external)
      throw new UnsupportedEditError("Expected one internal comments part.");
    let part = edges[0]?.target_part.partname;
    if (!part) {
      part = graph.allocatePartName(
        this.mainPart.slice(0, this.mainPart.lastIndexOf("/") + 1) + "comments",
        ".xml"
      );
      const w = this.xml(this.mainPart).root.namespace;
      this.setPart(
        part,
        new TextEncoder().encode(`<bm:comments xmlns:bm="${w}"/>`),
        "application/vnd.openxmlformats-officedocument.wordprocessingml.comments+xml"
      );
      const relName =
        this.mainPart.slice(0, this.mainPart.lastIndexOf("/") + 1) +
        "_rels/" +
        this.mainPart.slice(this.mainPart.lastIndexOf("/") + 1) +
        ".rels";
      if (!this.archive.members.some((member) => "/" + member.name === relName))
        this.setPart(
          relName,
          new TextEncoder().encode(
            '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"/>'
          )
        );
      this.change(relName, (xml) =>
        xml.insertChildren(
          xml.root,
          `<Relationship xmlns="${xml.root.namespace}" Id="${graph.allocateRelationshipId(this.mainPart)}" Type="${r}/comments" Target="${relativePartTarget(this.mainPart, part!)}"/>`
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
        if (revision !== this.revision)
          throw new PublicationError("conflict", "Model changed before publication.");
        this.publishing = true;
        return () => {
          this.publishing = false;
        };
      }
    });
  }
  async save(sink: ArchiveSink): Promise<void> {
    if (!sink || typeof sink.write !== "function")
      throw new InputTypeError("Expected an explicit byte sink.");
    const revision = this.revision;
    await publishDocumentArchive(
      this.snapshot(),
      { output: "-" },
      {
        ...this.context,
        stdout: sink,
        encoding: { order: "input", compression: "store" },
        [publicationGenerationGuard]: () => {
          if (revision !== this.revision)
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

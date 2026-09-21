import { revisionInfo } from "./revision-markup.js";
import { DocumentBudget } from "./budget.js";
import { MarkupCompatibility, compatibilityProfileForPart, documentCompatibilityProfile, type CompatibilityContent } from "./compatibility.js";
import { documentDialects, type DocumentDialect } from "./dialect.js";
import { InvalidValueError, type ArchiveLimits, type DocumentArchive } from "./archive.js";
import { DocumentPackage } from "./package.js";
import { InvalidPackageError, isXmlContentType, parseDocumentXml, type XmlElement } from "./package-xml.js";
import { SelectionError, type LocationKind, type LocationPositions } from "./location-token.js";
import { tableRows } from "./table-rows.js";
import { collectShapeCarriers, type ShapeCarrier } from "./shape-carriers.js";

export type DocumentScope = "body" | "headers" | "footers" | "footnotes" | "endnotes" | "comments" | "text-boxes" | "all-stories";
export const documentScopes: readonly DocumentScope[] = Object.freeze([
  "body", "headers", "footers", "footnotes", "endnotes", "comments", "text-boxes", "all-stories"
]);
export interface StoryReference {
  readonly section: number;
  readonly variant: "default" | "first" | "even";
  readonly story: string;
  readonly part: string;
}
export interface LocationEntry {
  kind: LocationKind;
  part: string;
  story: string;
  path: readonly number[];
  positions: LocationPositions;
  scope?: DocumentScope;
  node?: XmlElement;
  wordNamespace?: string;
}
export function pathContains(parent: readonly number[], child: readonly number[]): boolean {
  return parent.length <= child.length && parent.every((n, i) => child[i] === n);
}
export function addressKey(value: { part: string; story: string; path: readonly number[] }): string {
  return JSON.stringify([value.part, value.story, value.path]);
}
function decimal(value: string | undefined, minimum: number): number {
  if (value === undefined || !value || [...value].some(c => c < "0" || c > "9"))
    throw new InvalidPackageError("Invalid logical table coordinate.");
  const n = Number(value);
  if (!Number.isSafeInteger(n) || n < minimum) throw new InvalidPackageError("Invalid logical table coordinate.");
  return n;
}
export function cellCoordinates(value: string): { row: number; column: number } {
  if (typeof value !== "string" || value.length > 32) throw new InvalidValueError("Expected a logical cell coordinate.");
  let offset = 0;
  let column = 0;
  while (offset < value.length && value[offset]! >= "A" && value[offset]! <= "Z") {
    column = column * 26 + value.charCodeAt(offset++) - 64;
    if (!Number.isSafeInteger(column)) throw new InvalidValueError("Cell coordinate is out of range.");
  }
  const tail = value.slice(offset);
  if (!column || !tail || tail[0] === "0" || [...tail].some(c => c < "0" || c > "9") ||
    !Number.isSafeInteger(Number(tail))) throw new InvalidValueError("Expected an uppercase one-based cell coordinate.");
  return { row: Number(tail), column };
}
function cellLabel(row: number, column: number): string {
  let label = "";
  while (column) { column--; label = String.fromCharCode(65 + column % 26) + label; column = Math.floor(column / 26); }
  return label + row;
}

interface PhysicalPath {
  readonly parent?: PhysicalPath;
  readonly index: number;
  readonly length: number;
  order: number;
  value?: readonly number[];
}

function materializedPath(path: PhysicalPath): readonly number[] {
  if (path.value) return path.value;
  const value = new Array<number>(path.length);
  let current = path;
  for (let index = value.length - 1; index >= 0; index--) {
    value[index] = current.index;
    current = current.parent!;
  }
  return path.value = Object.freeze(value);
}

export class LocationIndex {
  readonly entries: LocationEntry[] = [];
  readonly references: StoryReference[] = [];
  readonly imageTargets = new Map<XmlElement, string>();
  readonly shapeCarriers = new Map<XmlElement, ShapeCarrier>();
  readonly shapeBodies = new Map<XmlElement, readonly XmlElement[]>();
  readonly #roots = new Map<string, XmlElement>();
  readonly #nodeEntries = new Map<XmlElement | undefined, LocationEntry[]>();
  readonly byAddress = {
    get: (key: string): LocationEntry[] | undefined => {
      let address: unknown;
      try { address = JSON.parse(key); } catch { return undefined; }
      if (!Array.isArray(address) || address.length !== 3) return undefined;
      const [part, story, path] = address as unknown[];
      if (typeof part !== "string" || typeof story !== "string" || !Array.isArray(path)) return undefined;
      this.#budget.charge("work", path.length + 1);
      let node = this.#roots.get(part);
      for (const index of path as unknown[]) {
        if (typeof index !== "number" || !Number.isSafeInteger(index) || index < 0) return undefined;
        node = node?.children[index];
        if (!node) return undefined;
      }
      const entries = this.#nodeEntries.get(node)?.filter(entry => entry.part === part && entry.story === story);
      return entries?.length ? entries : undefined;
    }
  };
  readonly children = new Map<XmlElement, readonly XmlElement[]>();
  readonly #paths = new Map<XmlElement, PhysicalPath>();
  readonly #w: string;
  readonly #budget: DocumentBudget;
  readonly #grids = new Map<XmlElement, Map<string, XmlElement>>();

  constructor(archive: DocumentArchive, limits: ArchiveLimits, mainPart: string, dialect: DocumentDialect, budget: DocumentBudget, graph = new DocumentPackage(archive, limits, budget), parsedRoots: ReadonlyMap<string, XmlElement> = new Map()) {
    this.#budget = budget;
    const { w, r, a } = documentDialects[dialect];
    this.#w = w;
    const roots = this.#roots;
    let physicalOrder = 0;
    const branches = new Map<XmlElement, XmlElement | undefined>();
    const bodyRoots = new Set<XmlElement>();
    const bodyWords = new Map<XmlElement, string>();
    const contentTypes = archive.members.find(member => member.name.toLowerCase() === "[content_types].xml")!;
    const parts = [...graph.parts, { ...contentTypes, partname: "/[Content_Types].xml", content_type: "application/xml" }];
    for (const part of parts.sort((a, b) => a.partname < b.partname ? -1 : a.partname > b.partname ? 1 : 0)) {
      let root: XmlElement | undefined;
      if (isXmlContentType(part.content_type)) {
        root = parsedRoots.get(part.partname) ?? parseDocumentXml(part.bytes, {}, budget).root;
        roots.set(part.partname, root);
        budget.charge("retainedBytes", 64);
        const raw: { node: XmlElement; path: PhysicalPath }[] = [{ node: root, path: { index: 0, length: 0, order: 0 } }];
        while (raw.length) {
          const { node, path } = raw.pop()!;
          budget.charge("work", 1);
          path.order = physicalOrder++;
          this.#paths.set(node, path);
          for (let i = node.children.length - 1; i >= 0; i--) {
            budget.charge("work", path.length + 1);
            budget.charge("retainedBytes", 64 + (path.length + 1) * 8);
            raw.push({ node: node.children[i]!, path: { parent: path, index: i, length: path.length + 1, order: 0 } });
          }
        }
        const effective = (content: readonly CompatibilityContent[]): void => {
          const pending = [{ content, index: 0, owner: undefined as XmlElement | undefined, nodes: [] as XmlElement[] }];
          while (pending.length) {
            const frame = pending.at(-1)!;
            if (frame.index >= frame.content.length) {
              pending.pop();
              if (frame.owner) {
                this.children.set(frame.owner, frame.nodes);
                pending.at(-1)?.nodes.push(frame.owner);
              }
              continue;
            }
            const child = frame.content[frame.index++]!;
            budget.charge("work", 1);
            if (!("source" in child) || child.disposition !== "understood") continue;
            pending.push({ content: child.content, index: 0, owner: child.source, nodes: [] });
          }
        };
        const compatibility = new MarkupCompatibility(root, compatibilityProfileForPart(part.partname), budget);
        for (const branch of compatibility.branches) branches.set(branch.alternateContent, branch.selected);
        effective(compatibility.content);
        const census = collectShapeCarriers(root, dialect, budget, branches);
        for (const body of census.bodyRoots) { budget.charge("retainedBytes", 32); bodyRoots.add(body); }
        for (const carrier of census.carriers) {
          budget.charge("retainedBytes", 96 + carrier.bodies.length * 32);
          budget.charge("work", 1 + carrier.bodies.length);
          this.shapeCarriers.set(carrier.node, carrier);
          this.shapeBodies.set(carrier.node, carrier.bodies.map(body => body.node));
          for (const body of carrier.bodies) bodyWords.set(body.node, body.wordNamespace);
        }
        const nativeCarriers = new Map<XmlElement, XmlElement[]>();
        // Native image carriers remain inert read locations; namespace recognition
        // here never changes compatibility branch selection or text understanding.
        const carriers: { node: XmlElement; owner: XmlElement | undefined }[] = [{ node: root, owner: undefined }];
        while (carriers.length) {
          const { node, owner } = carriers.pop()!;
          budget.charge("work", 1);
          if (node.namespace === "http://schemas.openxmlformats.org/markup-compatibility/2006" && node.localName === "AlternateContent") {
            const selected = branches.get(node);
            if (selected) { budget.charge("retainedBytes", 32); carriers.push({ node: selected, owner }); }
            continue;
          }
          if (node.namespace === "urn:schemas-microsoft-com:vml" && node.localName === "imagedata" && owner) {
            const pending = nativeCarriers.get(owner) ?? [];
            if (!nativeCarriers.has(owner)) nativeCarriers.set(owner, pending);
            budget.charge("retainedBytes", 16);
            pending.push(node);
            this.children.set(node, []);
            continue;
          }
          if (this.shapeCarriers.has(node) && !this.children.has(node)) {
            this.children.set(node, []);
            if (owner) this.children.set(owner, [...this.children.get(owner) ?? [], node]);
          }
          if (bodyWords.has(node) && !this.children.has(node) && owner) {
            effective(new MarkupCompatibility(node, documentCompatibilityProfile, budget).content);
            this.children.set(owner, [...this.children.get(owner) ?? [], node]);
          }
          if (!bodyRoots.has(node) && node.namespace === w && node.localName === "txbxContent" && !this.children.has(node) && owner) {
            effective(new MarkupCompatibility(node, documentCompatibilityProfile, budget).content);
            this.children.set(owner, [...this.children.get(owner) ?? [], node]);
          }
          const next = this.children.has(node) ? node : owner;
          for (let i = node.children.length - 1; i >= 0; i--) {
            budget.charge("retainedBytes", 32);
            carriers.push({ node: node.children[i]!, owner: next });
          }
        }
        for (const [owner, pending] of nativeCarriers) {
          const initial = this.children.get(owner) ?? [];
          budget.charge("work", initial.length + pending.length);
          budget.charge("retainedBytes", (initial.length + pending.length) * 32);
          const merged = [...new Set([...initial, ...pending])];
          merged.sort((a, b) => {
            const left = this.#paths.get(a)!, right = this.#paths.get(b)!;
            budget.charge("work", Math.min(left.length, right.length) + 1);
            return left.order - right.order;
          });
          this.children.set(owner, merged);
        }
      }
      this.#add({ kind: "part", part: part.partname, story: part.partname, path: { index: 0, length: 0, order: 0 }, positions: {}, ...(root ? { node: root } : {}) });
    }
    const main = graph.getPart("/" + mainPart).partname;
    const mainRoot = roots.get(main)!;
    const body = this.named(mainRoot, "body")[0];
    if (!body) throw new InvalidPackageError("Document body is missing.");
    const pendingBoxes: { node: XmlElement; part: string }[] = [];
    const seen = new Set<string>();
    const story = (part: string, node: XmlElement, scope: DocumentScope, suffix: string, positions: LocationPositions = {}) => {
      const id = part + "#" + suffix;
      if (seen.has(id)) return;
      seen.add(id);
      this.#add({ kind: "story", part, story: id, path: this.#paths.get(node)!, node, scope, positions, ...(bodyWords.has(node) ? { wordNamespace: bodyWords.get(node)! } : {}) });
      const entryStart = this.entries.length;
      const counts = { paragraph: 0, table: 0, image: 0, shape: 0, run: 0, link: 0, bookmark: 0, field: 0, control: 0 };
      let bodySection = 1;
      const catalog = [{ current: node, inherited: positions, exit: false }];
      while (catalog.length) {
        const frame = catalog.pop()!, current = frame.current;
        let inherited = frame.inherited;
        if (frame.exit) {
          const properties = this.named(current, "pPr")[0];
          if (properties && this.named(properties, "sectPr").length) bodySection++;
          continue;
        }
        budget.charge("work", 1);
        if (current !== node && (bodyRoots.has(current) || current.namespace === w && current.localName === "txbxContent")) {
          if (bodyWords.has(current) || !bodyRoots.has(current)) pendingBoxes.push({ node: current, part });
          continue;
        }
        if (scope === "body" && current !== node) inherited = { ...inherited, section: bodySection };
        let kind: LocationKind | undefined;
        let pos = inherited;
        if (current.namespace === w) {
          if (current.localName === "p") { kind = "paragraph"; counts.run = 0; pos = { ...inherited, paragraph: ++counts.paragraph }; }
          else if (current.localName === "r") { kind = "run"; pos = { ...inherited, run: ++counts.run }; }
          else if (current.localName === "hyperlink") { kind = "link"; pos = { ...inherited, link: ++counts.link }; }
          else if (current.localName === "sdt") { kind = "control"; pos = { ...inherited, control: ++counts.control }; }
          else if (current.localName === "fldSimple" || current.localName === "fldChar" && this.attr(current, "fldCharType") === "begin") { kind = "field"; pos = { ...inherited, field: ++counts.field }; }
          else if (current.localName === "tbl") { kind = "table"; pos = { ...inherited, table: ++counts.table }; }
          else if (current.localName === "tc") kind = "cell";
          else if (current.localName === "bookmarkStart") { kind = "bookmark"; pos = { ...inherited, bookmark: ++counts.bookmark }; }
          else if (["comment", "commentRangeStart", "footnoteReference", "endnoteReference"].includes(current.localName)) kind = "annotation";
        }
        if ((current.namespace === a && current.localName === "blip") ||
          (current.namespace === "urn:schemas-microsoft-com:vml" && current.localName === "imagedata")) {
          kind = "image"; pos = { ...inherited, image: ++counts.image };
        }
        if (this.shapeCarriers.has(current)) { kind = "shape"; pos = { ...inherited, shape: ++counts.shape }; }
        if (kind === "bookmark") this.#add({ kind: "annotation", part, story: id, path: this.#paths.get(current)!, node: current, scope, positions: inherited });
        if (kind) this.#add({ kind, part, story: id, path: this.#paths.get(current)!, node: current, scope, positions: pos });
        if (scope === "body" && current.namespace === w && current.localName === "p") catalog.push({ current, inherited: pos, exit: true });
        const active = this.children.get(current) ?? [];
        for (let index = active.length - 1; index >= 0; index--) catalog.push({ current: active[index]!, inherited: pos, exit: false });
      }
      const owners = this.entries.slice(entryStart);
      budget.charge("work", owners.length);
      budget.charge("retainedBytes", owners.length * 64);
      const indexed = new Set(owners.filter(e => e.kind === "annotation").map(e => e.node));
      const ownerPositions = new Map(owners.map(e => [e.node, e.positions]));
      const inventory: { current: XmlElement; inherited: LocationPositions }[] = [{ current: node, inherited: positions }];
      while (inventory.length) {
        const { current, inherited } = inventory.pop()!;
        budget.charge("work", 1);
        if (current !== node && (bodyRoots.has(current) || current.namespace === w && current.localName === "txbxContent")) continue;
        const positions = ownerPositions.get(current) ?? inherited;
        if (revisionInfo(current) && !indexed.has(current)) this.#add({ kind: "annotation", part, story: id, path: this.#paths.get(current)!, node: current, scope, positions });
        if (branches.has(current)) {
          const selected = branches.get(current);
          if (selected) { budget.charge("retainedBytes", 32); inventory.push({ current: selected, inherited: positions }); }
        } else for (let i = current.children.length - 1; i >= 0; i--) {
          budget.charge("retainedBytes", 32);
          inventory.push({ current: current.children[i]!, inherited: positions });
        }
      }
      const ordered = this.entries.splice(entryStart);
      budget.charge("retainedBytes", ordered.length * 8);
      ordered.sort((a, b) => {
        const left = this.#paths.get(a.node!)!, right = this.#paths.get(b.node!)!;
        budget.charge("work", left.length + right.length + 1);
        return left.order - right.order;
      });
      for (const entry of ordered) this.entries.push(entry);
    };
    story(main, body, "body", "body");
    const sections: XmlElement[] = [], sectionScan = [body];
    budget.charge("retainedBytes", 8);
    while (sectionScan.length) {
      const node = sectionScan.pop()!;
      budget.charge("work", 1);
      if (bodyRoots.has(node) || node.namespace === w && node.localName === "txbxContent") continue;
      if (node.namespace === w && node.localName === "sectPr") {
        budget.charge("retainedBytes", 8);
        sections.push(node);
      }
      const children = this.children.get(node) ?? [];
      budget.charge("work", children.length);
      budget.charge("retainedBytes", children.length * 8);
      for (let i = children.length - 1; i >= 0; i--) sectionScan.push(children[i]!);
    }
    const sectionNodes: XmlElement[] = [];
    for (const child of this.named(body, "p")) {
      const properties = this.named(child, "pPr")[0];
      if (properties) sectionNodes.push(...this.named(properties, "sectPr"));
    }
    sectionNodes.push(this.named(body, "sectPr")[0] ?? body);
    sectionNodes.forEach((node, i) => this.#add({ kind: "section", part: main, story: main + "#body#sections", path: this.#paths.get(node)!, node, scope: "body", positions: { section: i + 1 } }));
    const edges = graph.relationships(main);
    for (const kind of ["header", "footer"] as const) {
      const inherited = new Map<string, string>();
      sections.forEach((section, i) => {
        for (const variant of ["default", "first", "even"] as const) {
          const refs = this.named(section, kind + "Reference").filter(n => this.attr(n, "type") === variant);
          if (refs.length > 1) throw new SelectionError("ambiguous-selection");
          if (refs[0]) {
            const id = this.attr(refs[0], "id", r);
            const edge = edges.find(e => e.rId === id && e.reltype === r + "/" + kind && !e.is_external);
            if (!edge) throw new InvalidPackageError("Story reference cannot be resolved.");
            inherited.set(variant, edge.target_part.partname);
          }
          const part = inherited.get(variant);
          if (part) {
            budget.charge("retainedBytes", 256);
            this.references.push(Object.freeze({ part, story: part + "#" + kind, section: i + 1, variant }));
            story(part, roots.get(part)!, kind === "header" ? "headers" : "footers", kind, { section: i + 1 });
          }
        }
      });
    }
    for (const kind of ["footnote", "endnote", "comment"] as const) {
      const parts = [...new Set(edges.filter(e => !e.is_external && e.reltype === r + "/" + kind + "s").map(e => e.target_part.partname))].sort();
      for (const part of parts) {
        const nodes = this.named(roots.get(part)!, kind).filter(n => {
          const id = Number(this.attr(n, "id"));
          return kind === "comment" || (Number.isSafeInteger(id) && id >= 0 && (!this.attr(n, "type") || this.attr(n, "type") === "normal"));
        }).sort((a, b) => Number(this.attr(a, "id")) - Number(this.attr(b, "id")));
        nodes.forEach((node, i) => story(part, node, kind === "comment" ? "comments" : kind === "footnote" ? "footnotes" : "endnotes",
          kind + ":" + this.attr(node, "id"), kind === "comment" ? { comment: i + 1 } : { note: i + 1 }));
      }
    }
    const visitBox = (box: { node: XmlElement; part: string }) => {
      const start = pendingBoxes.length;
      story(box.part, box.node, "text-boxes", "text-box:" + materializedPath(this.#paths.get(box.node)!).join("."));
      for (const nested of pendingBoxes.splice(start)) visitBox(nested);
    };
    for (const box of pendingBoxes) visitBox(box);
    const relationships = new Map([...new Set(this.entries.filter(entry => entry.kind === "image").map(entry => entry.part))].map(part => [part, graph.relationships(part)]));
    for (const entry of this.entries) {
      if (entry.kind !== "image") continue;
      const node = entry.node!;
      const id = this.attr(node, node.localName === "blip" ? "embed" : "id", r);
      const edges = relationships.get(entry.part) ?? [];
      budget.charge("work", edges.length);
      const edge = edges.find(edge => edge.rId === id && edge.reltype === r + "/image" && !edge.is_external);
      if (edge) this.imageTargets.set(node, edge.target_part.partname);
    }
  }

  #add(entry: Omit<LocationEntry, "path"> & { path: PhysicalPath }): void {
    this.#budget.charge("retainedBytes", 256 + entry.path.length * 8 + entry.part.length * 2 + entry.story.length * 2);
    const path = entry.path;
    const location: LocationEntry = { ...entry, get path() { return materializedPath(path); } };
    this.entries.push(location);
    let existing = this.#nodeEntries.get(entry.node);
    if (!existing) this.#nodeEntries.set(entry.node, existing = []);
    existing.push(location);
  }

  attr(node: XmlElement, name: string, namespace = this.#w): string | undefined {
    this.#budget.charge("work", node.attributes.length);
    return node.attributes.find(a => a.namespace === namespace && a.localName === name)?.value;
  }
  named(node: XmlElement, name: string): XmlElement[] {
    return (this.children.get(node) ?? []).filter(child => child.namespace === this.#w && child.localName === name);
  }

  validRange(entry: LocationEntry, start: number, end: number): boolean {
    if (!entry.node || (entry.kind !== "paragraph" && entry.kind !== "run")) return false;
    let length = 0;
    let unsupported = false;
    const barriers: number[] = [];
    const visit = (node: XmlElement) => {
      this.#budget.charge("work", 1);
      if (node.namespace !== this.#w) { unsupported = true; return; }
      const name = node.localName;
      if (name === "pPr" || name === "rPr" || name === "lastRenderedPageBreak") return;
      if ((name === "footnoteRef" && entry.scope === "footnotes" || name === "endnoteRef" && entry.scope === "endnotes" || name === "annotationRef" && entry.scope === "comments") && !node.children.length && !node.text.trim()) return;
      if (["bookmarkStart", "bookmarkEnd", "commentRangeStart", "commentRangeEnd", "commentReference", "proofErr", "permStart", "permEnd"].includes(name) && !node.children.length && !node.text.trim()) return;
      if (name === "t") {
        this.#budget.charge("work", node.text.length);
        for (let i = 0; i < node.text.length; length++) i += node.text.codePointAt(i)! > 0xffff ? 2 : 1;
        return;
      }
      if (name === "tab" || name === "ptab" || name === "noBreakHyphen" || name === "softHyphen" || name === "cr" || (name === "br" && (!this.attr(node, "type") || this.attr(node, "type") === "textWrapping"))) { length++; return; }
      if (!["p", "r", "hyperlink"].includes(name)) { unsupported = true; return; }
      if (name === "hyperlink") barriers.push(length);
      for (const child of this.children.get(node) ?? []) visit(child);
      if (name === "hyperlink") barriers.push(length);
    };
    visit(entry.node);
    return !unsupported && end <= length && !barriers.some(offset => start < offset && end > offset);
  }

  cell(table: LocationEntry, coordinate: string): LocationEntry {
    const { row, column } = cellCoordinates(coordinate);
    const node = table.node!;
    let grid = this.#grids.get(node);
    if (!grid) {
      grid = new Map();
      const columns = this.named(this.named(node, "tblGrid")[0]!, "gridCol").length;
      const rows = tableRows(node, node => node, node => this.children.get(node) ?? [], this.#budget);
      this.#budget.table(rows.length, columns);
      let above = new Map<number, { node: XmlElement; start: number; span: number }>();
      rows.forEach((tr, i) => {
        for (const owner of [tr, ...this.named(tr, "trPr"), ...this.named(tr, "tc").flatMap(tc => [tc, ...this.named(tc, "tcPr")])]) {
          for (const name of ["trPr", "tcPr", "gridBefore", "gridAfter", "gridSpan", "vMerge", "hMerge"])
            if (this.named(owner, name).length > 1) throw new InvalidPackageError("Duplicate logical table property.");
        }
        const props = this.named(tr, "trPr")[0];
        const before = props && this.named(props, "gridBefore")[0];
        const after = props && this.named(props, "gridAfter")[0];
        let cursor = before ? decimal(this.attr(before, "val"), 0) : 0;
        const next = new Map<number, { node: XmlElement; start: number; span: number }>();
        for (const tc of this.named(tr, "tc")) {
          const props = this.named(tc, "tcPr")[0];
          const spanNode = props && this.named(props, "gridSpan")[0];
          const span = spanNode ? decimal(this.attr(spanNode, "val"), 1) : 1;
          if (cursor + span > columns) throw new InvalidPackageError("Table cell exceeds its logical grid.");
          const merge = props && this.named(props, "vMerge")[0];
          const legacy = props && this.named(props, "hMerge")[0];
          if (legacy) throw new SelectionError("ambiguous-selection");
          const mergeValue = merge && this.attr(merge, "val");
          let anchor = { node: tc, start: cursor, span };
          if (merge && mergeValue !== "restart") {
            if (mergeValue !== undefined && mergeValue !== "continue") throw new InvalidPackageError("Invalid vertical table merge.");
            const previous = above.get(cursor);
            if (!previous || previous.start !== cursor || previous.span !== span) throw new SelectionError("ambiguous-selection");
            anchor = previous;
          }
          for (let c = cursor; c < cursor + span; c++) {
            this.#budget.charge("work", 1);
            this.#budget.charge("retainedBytes", 64);
            grid!.set(cellLabel(i + 1, c + 1), anchor.node);
            if (merge) next.set(c, anchor);
          }
          cursor += span;
        }
        if (cursor + (after ? decimal(this.attr(after, "val"), 0) : 0) !== columns)
          throw new InvalidPackageError("Table row disagrees with its logical grid.");
        above = next;
      });
      this.#grids.set(node, grid);
    }
    const target = grid.get(cellLabel(row, column));
    if (!target) throw new SelectionError("missing-selection");
    const key = addressKey({ ...table, path: materializedPath(this.#paths.get(target)!) });
    const entry = this.byAddress.get(key)?.find(e => e.kind === "cell");
    if (!entry) throw new SelectionError("missing-selection");
    const anchor = [...grid].find(([, value]) => value === target)![0];
    return { ...entry, positions: { ...entry.positions, cell: anchor } };
  }
}

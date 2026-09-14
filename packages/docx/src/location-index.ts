import { DocumentBudget } from "./budget.js";
import { MarkupCompatibility, documentCompatibilityProfile, type CompatibilityContent } from "./compatibility.js";
import { documentDialects, type DocumentDialect } from "./dialect.js";
import { InvalidValueError, type ArchiveLimits, type DocumentArchive } from "./archive.js";
import { DocumentPackage } from "./package.js";
import { InvalidPackageError, parseDocumentXml, type XmlElement } from "./package-xml.js";
import { SelectionError, type LocationKind, type LocationPositions } from "./location-token.js";

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

export class LocationIndex {
  readonly entries: LocationEntry[] = [];
  readonly references: StoryReference[] = [];
  readonly imageTargets = new Map<XmlElement, string>();
  readonly byAddress = new Map<string, LocationEntry[]>();
  readonly children = new Map<XmlElement, readonly XmlElement[]>();
  readonly #paths = new Map<XmlElement, readonly number[]>();
  readonly #w: string;
  readonly #budget: DocumentBudget;
  readonly #grids = new Map<XmlElement, Map<string, XmlElement>>();

  constructor(archive: DocumentArchive, limits: ArchiveLimits, mainPart: string, dialect: DocumentDialect, budget: DocumentBudget) {
    this.#budget = budget;
    const { w, r, a } = documentDialects[dialect];
    this.#w = w;
    const graph = new DocumentPackage(archive, limits, budget);
    const roots = new Map<string, XmlElement>();
    const contentTypes = archive.members.find(member => member.name.toLowerCase() === "[content_types].xml")!;
    const parts = [...graph.parts, { ...contentTypes, partname: "/[Content_Types].xml", content_type: "application/xml" }];
    for (const part of parts.sort((a, b) => a.partname < b.partname ? -1 : a.partname > b.partname ? 1 : 0)) {
      const xml = part.content_type.toLowerCase();
      let root: XmlElement | undefined;
      if (xml.endsWith("+xml") || xml === "application/xml" || xml === "text/xml") {
        root = parseDocumentXml(part.bytes, {}, budget).root;
        roots.set(part.partname, root);
        const raw = (node: XmlElement, path: readonly number[]) => {
          budget.charge("work", 1);
          budget.charge("retainedBytes", 64 + path.length * 8);
          this.#paths.set(node, path);
          node.children.forEach((child, i) => raw(child, [...path, i]));
        };
        raw(root, []);
        const effective = (content: readonly CompatibilityContent[]): XmlElement[] => {
          const result: XmlElement[] = [];
          for (const child of content) {
            budget.charge("work", 1);
            if (!("source" in child) || child.disposition !== "understood") continue;
            this.children.set(child.source, effective(child.content));
            result.push(child.source);
          }
          return result;
        };
        effective(new MarkupCompatibility(root, documentCompatibilityProfile, budget).content);
      }
      this.#add({ kind: "part", part: part.partname, story: part.partname, path: [], positions: {}, ...(root ? { node: root } : {}) });
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
      this.#add({ kind: "story", part, story: id, path: this.#paths.get(node)!, node, scope, positions });
      const counts = { paragraph: 0, table: 0, image: 0, run: 0 };
      let bodySection = 1;
      const visit = (current: XmlElement, inherited: LocationPositions) => {
        budget.charge("work", 1);
        if (current !== node && current.namespace === w && current.localName === "txbxContent") {
          pendingBoxes.push({ node: current, part });
          return;
        }
        if (scope === "body" && current !== node) inherited = { ...inherited, section: bodySection };
        let kind: LocationKind | undefined;
        let pos = inherited;
        if (current.namespace === w) {
          if (current.localName === "p") { kind = "paragraph"; counts.run = 0; pos = { ...inherited, paragraph: ++counts.paragraph }; }
          else if (current.localName === "r") { kind = "run"; pos = { ...inherited, run: ++counts.run }; }
          else if (current.localName === "tbl") { kind = "table"; pos = { ...inherited, table: ++counts.table }; }
          else if (current.localName === "tc") kind = "cell";
          else if (["comment", "bookmarkStart", "commentRangeStart", "ins", "del", "moveFrom", "moveTo"].includes(current.localName)) kind = "annotation";
        }
        if ((current.namespace === a && current.localName === "blip") ||
          (current.namespace === "urn:schemas-microsoft-com:vml" && current.localName === "imagedata")) {
          kind = "image"; pos = { ...inherited, image: ++counts.image };
        }
        if (kind) this.#add({ kind, part, story: id, path: this.#paths.get(current)!, node: current, scope, positions: pos });
        for (const child of this.children.get(current) ?? []) visit(child, pos);
        if (scope === "body" && current.namespace === w && current.localName === "p") {
          const properties = this.named(current, "pPr")[0];
          if (properties && this.named(properties, "sectPr").length) bodySection++;
        }
      };
      visit(node, positions);
    };
    story(main, body, "body", "body");
    const walk = (node: XmlElement): XmlElement[] => {
      budget.charge("work", 1);
      return [node, ...(this.children.get(node) ?? []).flatMap(walk)];
    };
    const sections = walk(body).filter(n => n.namespace === w && n.localName === "sectPr");
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
      const parts = [...new Set(edges.filter(e => !e.is_external && e.reltype === r + "/" + kind + "s").map(e => e.target_part.partname))];
      for (const part of parts) {
        const nodes = this.named(roots.get(part)!, kind).filter(n => {
          const id = Number(this.attr(n, "id"));
          return kind === "comment" || (id > 0 && !this.attr(n, "type"));
        }).sort((a, b) => Number(this.attr(a, "id")) - Number(this.attr(b, "id")));
        nodes.forEach((node, i) => story(part, node, kind === "comment" ? "comments" : kind === "footnote" ? "footnotes" : "endnotes",
          kind + ":" + this.attr(node, "id"), kind === "comment" ? { comment: i + 1 } : { note: i + 1 }));
      }
    }
    const visitBox = (box: { node: XmlElement; part: string }) => {
      const start = pendingBoxes.length;
      story(box.part, box.node, "text-boxes", "text-box:" + this.#paths.get(box.node)!.join("."));
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

  #add(entry: LocationEntry): void {
    this.#budget.charge("retainedBytes", 256 + entry.path.length * 8 + entry.part.length * 2 + entry.story.length * 2);
    this.entries.push(entry);
    const key = addressKey(entry);
    const existing = this.byAddress.get(key) ?? [];
    existing.push(entry);
    this.byAddress.set(key, existing);
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
      if (name === "t") {
        this.#budget.charge("work", node.text.length);
        for (let i = 0; i < node.text.length; length++) i += node.text.codePointAt(i)! > 0xffff ? 2 : 1;
        return;
      }
      if (name === "tab" || name === "cr" || (name === "br" && (!this.attr(node, "type") || this.attr(node, "type") === "textWrapping"))) { length++; return; }
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
      const rows = this.named(node, "tr");
      this.#budget.table(rows.length, columns);
      let above = new Map<number, { node: XmlElement; start: number; span: number }>();
      rows.forEach((tr, i) => {
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
    const key = addressKey({ ...table, path: this.#paths.get(target)! });
    const entry = this.byAddress.get(key)?.find(e => e.kind === "cell");
    if (!entry) throw new SelectionError("missing-selection");
    const anchor = [...grid].find(([, value]) => value === target)![0];
    return { ...entry, positions: { ...entry.positions, cell: anchor } };
  }
}

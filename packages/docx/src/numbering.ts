import type { DocumentBudget } from "./budget.js";
import { xmlValue } from "./create-content.js";
import type { XmlElement } from "./package-xml.js";
import { parseDocumentXml } from "./package-xml.js";
import { runElementOpen } from "./run-properties.js";
import { DocumentXmlEditor, UnsupportedEditError } from "./xml-write.js";

export const numberingFormats = ["bullet", "decimal", "lowerLetter", "upperLetter", "lowerRoman", "upperRoman"] as const;
export function numberingAttribute(node: XmlElement | undefined, name = "val"): string | undefined {
  return node?.attributes.find(a => a.namespace === node.namespace && a.localName === name)?.value;
}
export function numberingChild(node: XmlElement | undefined, name: string): XmlElement | undefined {
  const children = node?.children.filter(c => c.namespace === node.namespace && c.localName === name) ?? [];
  if (children.length > 1) throw new UnsupportedEditError("Duplicate numbering properties are ambiguous.");
  return children[0];
}
function integer(value: string | undefined, maximum = Number.MAX_SAFE_INTEGER): number {
  if (!value || ![...value].every(c => c >= "0" && c <= "9") || !Number.isSafeInteger(Number(value)) || Number(value) > maximum)
    throw new UnsupportedEditError("Numbering requires bounded nonnegative integer identifiers and levels.");
  return Number(value);
}
interface ResolvedNumbering {
  readonly num: XmlElement;
  readonly definition: XmlElement;
  readonly levels: ReadonlyMap<number, XmlElement>;
  readonly overrides: ReadonlyMap<number, XmlElement>;
  readonly starts: ReadonlyMap<number, XmlElement>;
}

/** Resolve only affected graphs; untouched schemes and picture resources stay opaque. */
export class NumberingGraph {
  readonly abstracts = new Map<number, XmlElement[]>();
  readonly instances = new Map<number, XmlElement[]>();
  readonly newAbstracts: string[] = [];
  readonly newInstances: string[] = [];
  readonly rebindings = new Map<XmlElement, string>();
  readonly #roots: XmlElement[] = [];
  readonly #restarts = new Map<XmlElement, { id: number; position: number; starts: Map<number, number> }>();
  readonly reservedInstances = new Set<number>();
  readonly reservedAbstracts = new Set<number>();
  constructor(readonly xml: DocumentXmlEditor, readonly styles: XmlElement | undefined, readonly budget: DocumentBudget) {
    if (xml.root.localName !== "numbering") throw new UnsupportedEditError("Expected a numbering root.");
    for (const node of xml.root.children) {
      budget.charge("work", 1);
      if (node.namespace !== xml.root.namespace) continue;
      if (node.localName === "abstractNum" || node.localName === "num") {
        const abstract = node.localName === "abstractNum";
        const id = integer(numberingAttribute(node, abstract ? "abstractNumId" : "numId"));
        const map = abstract ? this.abstracts : this.instances;
        map.set(id, [...(map.get(id) ?? []), node]);
        (abstract ? this.reservedAbstracts : this.reservedInstances).add(id);
      }
    }
  }
  reserve(root: XmlElement): void {
    this.#roots.push(root);
    const visit = (node: XmlElement): void => {
      this.budget.charge("work", 1);
      if (node.namespace === this.xml.root.namespace && ["numId", "abstractNumId"].includes(node.localName)) {
        const value = numberingAttribute(node);
        if (value !== undefined) (node.localName === "numId" ? this.reservedInstances : this.reservedAbstracts).add(integer(value));
      }
      node.children.forEach(visit);
    };
    visit(root);
  }
  style(id: string, type: string): XmlElement {
    const found = this.styles?.children.filter(n => n.namespace === this.xml.root.namespace && n.localName === "style" && numberingAttribute(n, "styleId") === id) ?? [];
    if (found.length !== 1 || numberingAttribute(found[0], "type") !== type) throw new UnsupportedEditError("Numbering style reference is missing or ambiguous.");
    return found[0]!;
  }
  paragraph(node: XmlElement): { id: number; level: number } | undefined {
    let props = numberingChild(node, "pPr");
    let id: string | undefined;
    const level = numberingAttribute(numberingChild(numberingChild(props, "numPr"), "ilvl"));
    const seen = new Set<string>();
    let style = numberingAttribute(numberingChild(props, "pStyle"));
    if (style === undefined) {
      const defaults = this.styles?.children.filter(n => n.namespace === node.namespace && n.localName === "style" && numberingAttribute(n, "type") === "paragraph" && ["1", "true", "on"].includes(numberingAttribute(n, "default") ?? "")) ?? [];
      if (defaults.length > 1) throw new UnsupportedEditError("Ambiguous default paragraph style.");
      style = numberingAttribute(defaults[0], "styleId");
    }
    for (;;) {
      this.budget.charge("work", 1);
      const numbering = numberingChild(props, "numPr");
      id ??= numberingAttribute(numberingChild(numbering, "numId"));
      if (style === undefined) break;
      if (seen.has(style)) throw new UnsupportedEditError("Paragraph numbering style cycle.");
      seen.add(style);
      const definition = this.style(style, "paragraph");
      props = numberingChild(definition, "pPr");
      style = numberingAttribute(numberingChild(definition, "basedOn"));
    }
    if (id === undefined || integer(id) === 0) return undefined;
    if (level !== undefined) return { id: integer(id), level: integer(level, 8) };
    if (seen.size) {
      const resolved = this.resolve(integer(id));
      for (const style of seen) {
        const matches = [...resolved.levels].filter(([, n]) => numberingAttribute(numberingChild(n, "pStyle")) === style);
        if (matches.length > 1) throw new UnsupportedEditError("A paragraph style maps to multiple numbering levels.");
        if (matches.length === 1) return { id: integer(id), level: matches[0]![0] };
      }
    }
    return { id: integer(id), level: 0 };
  }
  resolve(id: number, seen = new Set<number>()): ResolvedNumbering {
    this.budget.charge("work", 1);
    if (seen.has(id) || seen.size >= this.budget.limits.xmlDepth) throw new UnsupportedEditError("Cyclic or excessively deep numbering style links.");
    seen.add(id);
    const instances = this.instances.get(id);
    if (id === 0 || instances?.length !== 1) throw new UnsupportedEditError("Numbering instance is missing or ambiguous.");
    const num = instances[0]!;
    this.attributes(num, ["numId"]);
    const definitions = this.abstracts.get(integer(numberingAttribute(numberingChild(num, "abstractNumId"))));
    if (definitions?.length !== 1) throw new UnsupportedEditError("Abstract numbering definition is missing or ambiguous.");
    let definition = definitions[0]!;
    this.attributes(definition, ["abstractNumId"]);
    const link = numberingAttribute(numberingChild(definition, "numStyleLink"));
    let inherited: ResolvedNumbering | undefined;
    if (link !== undefined) {
      const style = this.style(link, "numbering");
      const reference = numberingChild(numberingChild(numberingChild(style, "pPr"), "numPr"), "numId");
      inherited = this.resolve(integer(numberingAttribute(reference)), seen);
      definition = inherited.definition;
    }
    const styleLink = numberingAttribute(numberingChild(definition, "styleLink"));
    if (styleLink !== undefined) this.style(styleLink, "numbering");
    const levels = new Map<number, XmlElement>();
    for (const node of definition.children) {
      this.budget.charge("work", 1);
      if (node.namespace !== definition.namespace) throw new UnsupportedEditError("Extended numbering definitions cannot be edited.");
      if (node.localName !== "lvl") {
        if (!["nsid", "multiLevelType", "tmpl", "name", "styleLink"].includes(node.localName)) throw new UnsupportedEditError("Unsupported numbering definition cannot be edited.");
        continue;
      }
      const index = integer(numberingAttribute(node, "ilvl"), 8);
      if (levels.has(index)) throw new UnsupportedEditError("Duplicate numbering levels.");
      this.validateLevel(node, index);
      levels.set(index, node);
    }
    if (inherited) for (const [index, node] of inherited.levels) levels.set(index, node);
    const overrides = new Map(inherited?.overrides);
    const starts = new Map(inherited?.starts);
    const local = new Set<number>();
    for (const node of num.children) {
      this.budget.charge("work", 1);
      if (node.namespace !== num.namespace || !["abstractNumId", "lvlOverride"].includes(node.localName)) throw new UnsupportedEditError("Unsupported numbering instance cannot be edited.");
      if (node.localName !== "lvlOverride") continue;
      this.attributes(node, ["ilvl"]);
      const index = integer(numberingAttribute(node, "ilvl"), 8);
      if (local.has(index) || !levels.has(index)) throw new UnsupportedEditError("Duplicate or unresolved numbering override.");
      local.add(index);
      const start = numberingChild(node, "startOverride");
      if (start) { integer(numberingAttribute(start)); starts.set(index, start); }
      const level = numberingChild(node, "lvl");
      if (level) this.validateLevel(level, index);
      if (node.children.some(c => c.namespace !== node.namespace || !["startOverride", "lvl"].includes(c.localName))) throw new UnsupportedEditError("Unsupported numbering override.");
      overrides.set(index, node);
    }
    for (const [index, node] of overrides) {
      const level = numberingChild(node, "lvl");
      if (level) levels.set(index, level);
    }
    return { num, definition, levels, overrides, starts };
  }
  private attributes(node: XmlElement, allowed: readonly string[]): void {
    if (node.attributes.some(a => a.namespace !== "http://www.w3.org/2000/xmlns/" && (a.namespace !== node.namespace || !allowed.includes(a.localName)))) throw new UnsupportedEditError("Unverified numbering attributes cannot be interpreted.");
  }
  validateLevel(node: XmlElement, index: number): void {
    this.attributes(node, ["ilvl", "tentative"]);
    if (integer(numberingAttribute(node, "ilvl"), 8) !== index) throw new UnsupportedEditError("Override level differs from its owner.");
    const format = numberingAttribute(numberingChild(node, "numFmt"));
    if (!numberingFormats.includes(format as typeof numberingFormats[number]) || !numberingChild(node, "lvlText")) throw new UnsupportedEditError("Unsupported numbering scheme cannot be edited.");
    for (const child of node.children) {
      if (child.namespace !== node.namespace || !["start", "numFmt", "lvlRestart", "pStyle", "isLgl", "suff", "lvlText", "lvlJc", "pPr", "rPr"].includes(child.localName)) throw new UnsupportedEditError("Picture bullets and extended numbering remain opaque.");
      numberingChild(node, child.localName);
      if (!["pPr", "rPr"].includes(child.localName)) this.attributes(child, child.localName === "lvlText" ? ["val", "null"] : ["val"]);
    }
    const start = numberingChild(node, "start");
    if (start) integer(numberingAttribute(start));
    const restart = numberingChild(node, "lvlRestart");
    if (restart && integer(numberingAttribute(restart), 9) > index) throw new UnsupportedEditError("Invalid numbering restart dependency.");
    const style = numberingAttribute(numberingChild(node, "pStyle"));
    if (style !== undefined) this.style(style, "paragraph");
  }
  allocate(abstract: boolean): number {
    const reserved = abstract ? this.reservedAbstracts : this.reservedInstances;
    let id = abstract ? 0 : 1;
    while (reserved.has(id)) { this.budget.charge("work", 1); id++; }
    if (!Number.isSafeInteger(id)) throw new UnsupportedEditError("Numbering identifier space exhausted.");
    reserved.add(id);
    return id;
  }
  private definitionXml(formats: readonly string[], id: number): string {
    const levels = formats.map((kind, i) => `<nl:lvl nl:ilvl="${i}"><nl:start nl:val="1"/><nl:numFmt nl:val="${kind}"/><nl:lvlText nl:val="${kind === 'bullet' ? '•' : '%' + (i + 1) + '.'}"/></nl:lvl>`).join("");
    return `<nl:abstractNum xmlns:nl="${this.xml.root.namespace}" nl:abstractNumId="${id}"><nl:multiLevelType nl:val="multilevel"/>${levels}</nl:abstractNum>`;
  }
  private signature(node: XmlElement, root = false): string {
    this.budget.charge("work", 1 + node.attributes.length + node.content.length);
    const value = JSON.stringify([node.namespace, node.localName,
      node.attributes.filter(a => a.namespace !== "http://www.w3.org/2000/xmlns/" && !(root && a.namespace === node.namespace && a.localName === "abstractNumId")).map(a => [a.namespace, a.localName, a.value]).sort(),
      node.content.map(c => c.kind === "element" ? this.signature(c) : c)]);
    this.budget.charge("retainedBytes", value.length * 2);
    this.budget.charge("work", value.length);
    return value;
  }
  private abstract(formats: readonly string[]): number {
    const original = parseDocumentXml(new TextEncoder().encode(this.definitionXml(formats, 0)), {}, this.budget).root;
    const expected = this.signature(original, true);
    // Compare the complete semantics; a matching format alone cannot justify abstract reuse.
    for (const [id, definitions] of this.abstracts) {
      if (definitions.length === 1 && this.signature(definitions[0]!, true) === expected) return id;
    }
    const id = this.allocate(true);
    this.newAbstracts.push(this.definitionXml(formats, id));
    return id;
  }
  create(kind: typeof numberingFormats[number], start: number, level: number): number {
    const w = this.xml.root.namespace;
    const abstractId = this.abstract(Array.from({ length: 9 }, () => kind));
    const id = this.allocate(false);
    this.newInstances.push(`<nl:num xmlns:nl="${w}" nl:numId="${id}"><nl:abstractNumId nl:val="${abstractId}"/>${start === 1 ? '' : `<nl:lvlOverride nl:ilvl="${level}"><nl:startOverride nl:val="${start}"/></nl:lvlOverride>`}</nl:num>`);
    return id;
  }
  mixUnusedLevel(graph: ResolvedNumbering, level: number, kind: typeof numberingFormats[number]): boolean {
    const reference = numberingChild(graph.num, "abstractNumId")!;
    if (integer(numberingAttribute(reference)) !== integer(numberingAttribute(graph.definition, "abstractNumId")) || numberingChild(graph.overrides.get(level), "lvl")) return false;
    const formats = Array.from({ length: 9 }, (_, i) => numberingAttribute(numberingChild(graph.levels.get(i), "numFmt")) ?? "");
    if (formats.some(format => !numberingFormats.includes(format as typeof numberingFormats[number]))) return false;
    const template = parseDocumentXml(new TextEncoder().encode(this.definitionXml(formats, 0)), {}, this.budget).root;
    if (this.signature(graph.definition, true) !== this.signature(template, true)) return false;
    const id = integer(numberingAttribute(graph.num, "numId"));
    let used = false;
    const visit = (node: XmlElement, ancestors: readonly XmlElement[]): void => {
      this.budget.charge("work", 1);
      if (node.namespace === this.xml.root.namespace && node.localName === "p") {
        const binding = this.paragraph(node);
        if (binding?.id === id && binding.level === level) used = true;
      }
      if (node.namespace === this.xml.root.namespace && node.localName === "numId" && integer(numberingAttribute(node)) === id && ancestors.at(-3)?.localName !== "p") used = true;
      if (!used) for (const child of node.children) visit(child, [...ancestors, node]);
    };
    for (const root of this.#roots) { if (used) break; visit(root, []); }
    if (used) return false;
    formats[level] = kind;
    const abstractId = this.abstract(formats);
    this.rebindings.set(graph.num, this.xml.sourceXml(graph.num, new Map([[reference,
      `<nl:abstractNumId xmlns:nl="${this.xml.root.namespace}" nl:val="${abstractId}"/>`]])));
    return true;
  }
  restart(graph: ResolvedNumbering, level: number, start: number): number {
    let draft = this.#restarts.get(graph.num);
    if (!draft) {
      draft = { id: this.allocate(false), position: this.newInstances.length, starts: new Map() };
      this.#restarts.set(graph.num, draft);
      this.newInstances.push("");
    }
    draft.starts.set(level, start);
    const id = draft.id, w = this.xml.root.namespace;
    const overrides = new Map<number, string>();
    const all = new Set([...graph.overrides.keys(), ...draft.starts.keys()]);
    for (const index of all) {
      const old = graph.overrides.get(index);
      const startNode = graph.starts.get(index);
      const startXml = draft.starts.has(index) ? `<nl:startOverride xmlns:nl="${w}" nl:val="${draft.starts.get(index)}"/>` : startNode ? this.xml.sourceXml(startNode) : "";
      const effective = graph.levels.get(index)!;
      const definitionLevel = graph.definition.children.find(n => n.namespace === w && n.localName === "lvl" && integer(numberingAttribute(n, "ilvl"), 8) === index);
      const levelXml = effective !== definitionLevel ? this.xml.sourceXml(effective) : "";
      if (old) {
        const priorStart = numberingChild(old, "startOverride"), priorLevel = numberingChild(old, "lvl");
        const patches = new Map<XmlElement, string>();
        if (priorStart) patches.set(priorStart, startXml);
        if (priorLevel) patches.set(priorLevel, (priorStart ? "" : startXml) + levelXml);
        const tail = (priorStart || priorLevel ? "" : startXml) + (priorLevel ? "" : levelXml);
        overrides.set(index, runElementOpen(old) + this.xml.sourceXml(old, patches, true) + tail + `</${old.name}>`);
      } else overrides.set(index, `<nl:lvlOverride xmlns:nl="${w}" nl:ilvl="${index}">${startXml}${levelXml}</nl:lvlOverride>`);
    }
    // Materializing an instance preserves effective linked overrides and leaves the style graph untouched.
    this.newInstances[draft.position] = `<nl:num xmlns:nl="${w}" nl:numId="${id}"><nl:abstractNumId nl:val="${xmlValue(numberingAttribute(graph.definition, "abstractNumId")!)}"/>${[...overrides].sort(([a], [b]) => a - b).map(([, xml]) => xml).join('')}</nl:num>`;
    return id;
  }
  flush(): Uint8Array {
    const additions = this.newAbstracts.join("");
    const instances = this.newInstances.join("");
    if (!additions && !instances && !this.rebindings.size) return this.xml.serialize();
    const root = this.xml.root;
    const firstNum = root.children.find(c => c.namespace === root.namespace && ["num", "numIdMacAtCleanup"].includes(c.localName));
    const cleanup = numberingChild(root, "numIdMacAtCleanup");
    const patches = new Map<XmlElement, string>(this.rebindings);
    if (firstNum) patches.set(firstNum, additions + (patches.get(firstNum) ?? this.xml.sourceXml(firstNum)));
    if (cleanup) patches.set(cleanup, (firstNum === cleanup ? additions : "") + instances + this.xml.sourceXml(cleanup));
    const content = this.xml.sourceXml(root, patches, true) + (firstNum ? "" : additions) + (cleanup ? "" : instances);
    const source = new TextDecoder().decode(this.xml.serialize());
    const originalRoot = this.xml.sourceXml(root);
    const offset = source.indexOf(originalRoot);
    if (offset < 0 || source.indexOf(originalRoot, offset + 1) !== -1) throw new UnsupportedEditError("Ambiguous lexical numbering root.");
    const rewritten = source.slice(0, offset) + runElementOpen(root) + content + `</${root.name}>` + source.slice(offset + originalRoot.length);
    const editor = new DocumentXmlEditor(new TextEncoder().encode(rewritten), {}, undefined, this.budget);
    this.budget.charge("insertedNodes", parseDocumentXml(new TextEncoder().encode(`<root${[...root.namespaces].filter(([p]) => p !== "xml").map(([p, uri]) => ` ${p ? "xmlns:" + p : "xmlns"}="${xmlValue(uri)}"`).join("")}>${additions}${instances}</root>`), {}, this.budget).root.children.reduce((total, n) => total + countNodes(n), 0));
    return editor.serialize();
  }
}
function countNodes(node: XmlElement): number { return 1 + node.children.reduce((n, child) => n + countNodes(child), 0); }

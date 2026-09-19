import { InvalidValueError } from "./archive.js";
import type { DocxOperationArguments } from "./operation-types.js";
import { selectNamedStyles } from "./style-names.js";
import { mergeStyleChildren } from "./style-properties.js";
import { paragraphUnits, paragraphProperties } from "./paragraph-properties.js";
import { plainLength } from "./formatting-values.js";
import type { DocumentBudget } from "./budget.js";
import { xmlValue } from "./create-content.js";
import type { XmlElement, XmlAttribute } from "./package-xml.js";
import { parseDocumentXml } from "./package-xml.js";
import { runElementOpen } from "./run-properties.js";
import { DocumentXmlEditor, sourceRootEnvelope, UnsupportedEditError } from "./xml-write.js";
import { activeXmlChildren } from "./xml-active-children.js";
import { MarkupCompatibility, type CompatibilityContent } from "./compatibility.js";

export const numberingFormats = ["bullet", "decimal", "lowerLetter", "upperLetter", "lowerRoman", "upperRoman"] as const;
export function numberingAttribute(node: XmlElement | undefined, name = "val"): string | undefined {
  return node?.attributes.find(a => a.namespace === node.namespace && a.localName === name)?.value;
}
export function numberingChild(node: XmlElement | undefined, name: string): XmlElement | undefined {
  const children = node?.children.filter(c => c.namespace === node.namespace && c.localName === name) ?? [];
  if (children.length > 1) throw new UnsupportedEditError("Duplicate numbering properties are ambiguous.");
  return children[0];
}
function nonnegativeInteger(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const digits = value[0] === "+" || value[0] === "-" ? value.slice(1) : value;
  const number = Number(value);
  return digits && [...digits].every(c => c >= "0" && c <= "9") && Number.isSafeInteger(number) && number >= 0 ? number : undefined;
}
function integer(value: string | undefined, maximum = Number.MAX_SAFE_INTEGER): number {
  const number = nonnegativeInteger(value);
  if (number === undefined || number > maximum)
    throw new UnsupportedEditError("Numbering requires bounded nonnegative integer identifiers and levels.");
  return number;
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
  readonly #children = new WeakMap<XmlElement, readonly XmlElement[]>();
  readonly #attributes = new WeakMap<XmlElement, readonly XmlAttribute[]>();
  readonly #scalarText = new WeakSet<XmlElement>();
  readonly #restarts = new Map<XmlElement, { id: number; position: number; starts: Map<number, number> }>();
  readonly reservedInstances = new Set<number>();
  readonly reservedAbstracts = new Set<number>();
  constructor(readonly xml: DocumentXmlEditor, readonly styles: XmlElement | undefined, readonly budget: DocumentBudget) {
    if (xml.root.localName !== "numbering") throw new UnsupportedEditError("Expected a numbering root.");
    this.project(xml.root);
    if (styles) this.project(styles);
    for (const node of this.children(xml.root)) {
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
  project(root: XmlElement): void {
    if (root.namespace !== this.xml.root.namespace || this.#children.has(root)) return;
    const collect = (content: readonly CompatibilityContent[]): void => {
      for (const item of content) if ("source" in item) {
        if (item.disposition !== "understood") continue;
        this.budget.charge("work", 1 + item.content.length);
        this.budget.charge("retainedBytes", 96 + item.content.length * 8);
        this.#children.set(item.source, item.content.filter(node => "source" in node).map(node => node.source));
        this.#attributes.set(item.source, item.attributes);
        for (const token of item.content) if (!('source' in token) && (token.kind === "text" || token.kind === "cdata")) {
          this.budget.charge("work", token.text.length);
          for (const char of token.text) if (!" \t\r\n".includes(char)) { this.#scalarText.add(item.source); break; }
        }
        collect(item.content);
      }
    };
    collect(new MarkupCompatibility(root, undefined, this.budget).content);
  }
  children(node: XmlElement | undefined): readonly XmlElement[] {
    this.budget.charge("work", 1);
    return node ? this.#children.get(node) ?? [] : [];
  }
  child(node: XmlElement | undefined, name: string): XmlElement | undefined {
    const children = this.children(node).filter(child => child.namespace === node!.namespace && child.localName === name);
    if (children.length > 1) throw new UnsupportedEditError("Duplicate numbering properties are ambiguous.");
    return children[0];
  }
  reserve(root: XmlElement): void {
    this.#roots.push(root);
    this.project(root);
    const visit = (node: XmlElement): void => {
      this.budget.charge("work", 1);
      if (node.namespace === this.xml.root.namespace && ["numId", "abstractNumId"].includes(node.localName)) {
        const value = numberingAttribute(node);
        if (value !== undefined) {
          const id = nonnegativeInteger(value);
          if (id !== undefined) (node.localName === "numId" ? this.reservedInstances : this.reservedAbstracts).add(id);
          else if (this.#children.has(node)) integer(value);
        }
      }
      // Stored definitions also reserve IDs, including inactive/opaque branches.
      // Invalid inert spellings stay opaque; this is not semantic admission.
      if (node.namespace === this.xml.root.namespace && ["num", "abstractNum"].includes(node.localName)) {
        const abstract = node.localName === "abstractNum";
        const id = nonnegativeInteger(numberingAttribute(node, abstract ? "abstractNumId" : "numId"));
        if (id !== undefined) (abstract ? this.reservedAbstracts : this.reservedInstances).add(id);
      }
      node.children.forEach(visit);
    };
    visit(root);
  }
  style(id: string, type: string): XmlElement {
    const found = this.children(this.styles).filter(n => n.namespace === this.xml.root.namespace && n.localName === "style" && numberingAttribute(n, "styleId") === id);
    if (found.length !== 1 || (numberingAttribute(found[0], "type") ?? "paragraph") !== type) throw new UnsupportedEditError("Numbering style reference is missing or ambiguous.");
    return found[0]!;
  }
  paragraph(node: XmlElement): { id: number; level: number } | undefined {
    let props = this.child(node, "pPr");
    let id: string | undefined;
    const level = numberingAttribute(this.child(this.child(props, "numPr"), "ilvl"));
    const seen = new Set<string>();
    let style = numberingAttribute(this.child(props, "pStyle"));
    if (style === undefined) {
      const defaults = this.children(this.styles).filter(n => n.namespace === node.namespace && n.localName === "style" && (numberingAttribute(n, "type") ?? "paragraph") === "paragraph" && ["1", "true", "on"].includes(numberingAttribute(n, "default") ?? ""));
      if (defaults.length > 1) throw new UnsupportedEditError("Ambiguous default paragraph style.");
      style = numberingAttribute(defaults[0], "styleId");
    }
    for (;;) {
      this.budget.charge("work", 1);
      const numbering = this.child(props, "numPr");
      if (numbering) {
        this.attributes(numbering, []);
        for (const reference of this.children(numbering)) {
          if (reference.namespace !== node.namespace || !["numId", "ilvl"].includes(reference.localName)) throw new UnsupportedEditError("Unsupported paragraph numbering content cannot be interpreted.");
          this.child(numbering, reference.localName);
          this.scalar(reference, ["val"]);
          integer(numberingAttribute(reference), reference.localName === "ilvl" ? 8 : Number.MAX_SAFE_INTEGER);
        }
      }
      id ??= numberingAttribute(this.child(numbering, "numId"));
      if (style === undefined) break;
      if (seen.has(style)) throw new UnsupportedEditError("Paragraph numbering style cycle.");
      seen.add(style);
      const definition = this.style(style, "paragraph");
      props = this.child(definition, "pPr");
      style = numberingAttribute(this.child(definition, "basedOn"));
    }
    if (id === undefined || integer(id) === 0) return undefined;
    if (level !== undefined) return { id: integer(id), level: integer(level, 8) };
    if (seen.size) {
      const resolved = this.resolve(integer(id));
      for (const style of seen) {
        const matches = [...resolved.levels].filter(([, n]) => numberingAttribute(this.child(n, "pStyle")) === style);
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
    const reference = this.child(num, "abstractNumId");
    if (reference) this.scalar(reference, ["val"]);
    const definitions = this.abstracts.get(integer(numberingAttribute(reference)));
    if (definitions?.length !== 1) throw new UnsupportedEditError("Abstract numbering definition is missing or ambiguous.");
    let definition = definitions[0]!;
    this.attributes(definition, ["abstractNumId"]);
    const link = numberingAttribute(this.child(definition, "numStyleLink"));
    let inherited: ResolvedNumbering | undefined;
    if (link !== undefined) {
      const style = this.style(link, "numbering");
      const reference = this.child(this.child(this.child(style, "pPr"), "numPr"), "numId");
      inherited = this.resolve(integer(numberingAttribute(reference)), seen);
      definition = inherited.definition;
    }
    const styleLink = numberingAttribute(this.child(definition, "styleLink"));
    if (styleLink !== undefined) this.style(styleLink, "numbering");
    const levels = new Map<number, XmlElement>();
    for (const node of this.children(definition)) {
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
    for (const node of this.children(num)) {
      this.budget.charge("work", 1);
      if (node.namespace !== num.namespace || !["abstractNumId", "lvlOverride"].includes(node.localName)) throw new UnsupportedEditError("Unsupported numbering instance cannot be edited.");
      if (node.localName !== "lvlOverride") continue;
      this.attributes(node, ["ilvl"]);
      const index = integer(numberingAttribute(node, "ilvl"), 8);
      if (local.has(index) || !levels.has(index)) throw new UnsupportedEditError("Duplicate or unresolved numbering override.");
      local.add(index);
      const start = this.child(node, "startOverride");
      if (start) {
        this.scalar(start, ["val"]);
        integer(numberingAttribute(start));
        starts.set(index, start);
      }
      const level = this.child(node, "lvl");
      if (level) this.validateLevel(level, index);
      if (this.children(node).some(c => c.namespace !== node.namespace || !["startOverride", "lvl"].includes(c.localName))) throw new UnsupportedEditError("Unsupported numbering override.");
      overrides.set(index, node);
    }
    for (const [index, node] of overrides) {
      const level = this.child(node, "lvl");
      if (level) levels.set(index, level);
    }
    for (const start of levels.keys()) {
      const seen = new Set<number>(); let current: number | undefined = start;
      while (current !== undefined && levels.has(current)) {
        this.budget.charge("work", 1);
        if (seen.has(current)) throw new UnsupportedEditError("Cyclic numbering restart dependency.");
        seen.add(current);
        const restart = this.child(levels.get(current), "lvlRestart"), ordinal = restart ? integer(numberingAttribute(restart), 9) : 0;
        current = ordinal === 0 ? undefined : ordinal - 1;
      }
    }
    return { num, definition, levels, overrides, starts };
  }
  private attributes(node: XmlElement, allowed: readonly string[]): void {
    if ((this.#attributes.get(node) ?? node.attributes).some(a => a.namespace !== "http://www.w3.org/2000/xmlns/" && (a.namespace !== node.namespace || !allowed.includes(a.localName)))) throw new UnsupportedEditError("Unverified numbering attributes cannot be interpreted.");
  }
  private scalar(node: XmlElement, allowed: readonly string[]): void {
    this.attributes(node, allowed);
    if (this.children(node).length || this.#scalarText.has(node)) throw new UnsupportedEditError("Active content in a scalar numbering property cannot be interpreted.");
  }
  validateLevel(node: XmlElement, index: number): void {
    this.attributes(node, ["ilvl", "tentative"]);
    if (integer(numberingAttribute(node, "ilvl"), 8) !== index) throw new UnsupportedEditError("Override level differs from its owner.");
    const format = numberingAttribute(this.child(node, "numFmt"));
    if (!numberingFormats.includes(format as typeof numberingFormats[number]) || !this.child(node, "lvlText")) throw new UnsupportedEditError("Unsupported numbering scheme cannot be edited.");
    for (const child of this.children(node)) {
      if (child.namespace !== node.namespace || !["start", "numFmt", "lvlRestart", "pStyle", "isLgl", "suff", "lvlText", "lvlJc", "pPr", "rPr"].includes(child.localName)) throw new UnsupportedEditError("Picture bullets and extended numbering remain opaque.");
      this.child(node, child.localName);
      if (!["pPr", "rPr"].includes(child.localName)) this.scalar(child, child.localName === "lvlText" ? ["val", "null"] : ["val"]);
    }
    const start = this.child(node, "start");
    if (start) integer(numberingAttribute(start));
    const restart = this.child(node, "lvlRestart");
    if (restart) integer(numberingAttribute(restart), 9);
    const style = numberingAttribute(this.child(node, "pStyle"));
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
  /** Fork the selected occurrence; retain every effective unedited level and source graph. */
  setLevels(graph: ResolvedNumbering, options: DocxOperationArguments<"lists.levels.set">): number {
    const w = this.xml.root.namespace, children = (node: XmlElement) => this.children(node);
    const scalar = (name: string, value: string | number) => `<nl:${name} xmlns:nl="${w}" nl:val="${xmlValue(String(value))}"/>`;
    const styleId = (name: string, type: string): string => {
      const matches = selectNamedStyles(this.children(this.styles).filter(node => node.namespace === w && node.localName === "style"), name, children, this.budget);
      if (matches.length !== 1 || (numberingAttribute(matches[0], "type") ?? "paragraph") !== type) throw new InvalidValueError("Expected one named style of the required numbering relationship type.");
      const id = numberingAttribute(matches[0], "styleId");
      if (!id) throw new UnsupportedEditError("Numbering styles require a stored style ID.");
      this.style(id, type); return id;
    };
    let changed = false;
    const supplied = new Map((options.levels ?? []).map(level => [level.level, level]));
    const restarts = new Map<number, number | null>();
    const levelMarkup = new Map<number, string>();
    const levelOrder = "start numFmt lvlRestart pStyle isLgl suff lvlText lvlJc pPr rPr".split(" ");
    for (const index of new Set([...graph.levels.keys(), ...supplied.keys()])) {
      this.budget.charge("work", 1);
      const old = graph.levels.get(index), patch = supplied.get(index);
      const source = old ? this.xml : new DocumentXmlEditor(new TextEncoder().encode(`<nl:lvl xmlns:nl="${w}" nl:ilvl="${index}"/>`), {}, undefined, this.budget);
      const node = old ?? source.root, updates = new Map<string, string>();
      const oldRestart = old && this.child(old, "lvlRestart"), restart = patch?.restartAfter === undefined ? oldRestart ? integer(numberingAttribute(oldRestart), 9) - 1 : null : patch.restartAfter;
      restarts.set(index, restart === -1 ? null : restart);
      if (patch) {
        changed ||= !old || Number(numberingAttribute(graph.starts.get(index) ?? this.child(old, "start")) ?? 1) !== patch.start || numberingAttribute(this.child(old, "numFmt")) !== patch.format || numberingAttribute(this.child(old, "lvlText")) !== patch.text;
        updates.set("start", scalar("start", patch.start)); updates.set("numFmt", scalar("numFmt", patch.format)); updates.set("lvlText", scalar("lvlText", patch.text));
        if (patch.restartAfter !== undefined) changed ||= patch.restartAfter !== (oldRestart ? Number(numberingAttribute(oldRestart)) - 1 : null);
        if (patch.paragraphStyle !== undefined) changed ||= styleId(patch.paragraphStyle, "paragraph") !== numberingAttribute(this.child(old, "pStyle"));
        if (patch.restartAfter !== undefined) updates.set("lvlRestart", patch.restartAfter === null ? "" : scalar("lvlRestart", patch.restartAfter + 1));
        if (patch.paragraphStyle !== undefined) updates.set("pStyle", scalar("pStyle", styleId(patch.paragraphStyle, "paragraph")));
        if (patch.indent !== undefined || patch.hanging !== undefined) {
          const hanging = patch.hanging === undefined ? undefined : paragraphUnits(plainLength(patch.hanging), 1);
          const props = paragraphProperties(source, node, {
            ...(patch.indent === undefined ? {} : { leftIndent: { value: paragraphUnits(plainLength(patch.indent), 1), unit: "emu" as const } }),
            ...(hanging === undefined ? {} : { firstLineIndent: { value: -hanging, unit: "emu" as const } })
          }, undefined, old ? children : undefined);
          const previous = old && this.child(old, "pPr"); changed ||= props !== (previous ? source.sourceXml(previous) : ""); updates.set("pPr", props);
        }
      } else if (graph.starts.has(index)) updates.set("start", scalar("start", numberingAttribute(graph.starts.get(index))!));
      const markup = mergeStyleChildren(source, node, updates, levelOrder, {}, old ? children : undefined);
      const envelope = runElementOpen({ ...node, attributes: [] }) + markup + `</${node.name}>`;
      const editor = new DocumentXmlEditor(new TextEncoder().encode(envelope), {}, undefined, this.budget);
      levelMarkup.set(index, old ? this.fragment(old, editor.sourceXml(editor.root.children[0]!, new Map(), true)) : markup);
    }
    for (const start of restarts.keys()) {
      const seen = new Set<number>(); let current: number | null | undefined = start;
      while (current !== null && current !== undefined && restarts.has(current)) {
        this.budget.charge("work", 1);
        if (seen.has(current)) throw new InvalidValueError("List restart dependencies cannot contain cycles.");
        seen.add(current); current = restarts.get(current);
      }
    }
    const priorLink = this.child(graph.definition, "styleLink");
    if (options.numberingStyle !== undefined) changed ||= (options.numberingStyle === null ? undefined : styleId(options.numberingStyle, "numbering")) !== numberingAttribute(priorLink);
    if (!changed) return integer(numberingAttribute(graph.num, "numId"));
    const id = this.allocate(false), abstractId = this.allocate(true), definitionPatches = new Map<XmlElement, string>();
    const originalLevels = new Set<number>();
    for (const old of this.children(graph.definition)) if (old.namespace === w && old.localName === "lvl") {
      const index = integer(numberingAttribute(old, "ilvl"), 8); originalLevels.add(index); definitionPatches.set(old, levelMarkup.get(index)!);
    }
    const link = this.child(graph.definition, "styleLink"), newLink = options.numberingStyle === undefined ? undefined : options.numberingStyle === null ? "" : scalar("styleLink", styleId(options.numberingStyle, "numbering"));
    if (link && newLink !== undefined) definitionPatches.set(link, newLink);
    const firstLevel = this.children(graph.definition).find(node => node.namespace === w && node.localName === "lvl");
    if (!link && newLink && firstLevel) definitionPatches.set(firstLevel, newLink + definitionPatches.get(firstLevel)!);
    const addedLevels = [...levelMarkup].filter(([index]) => !originalLevels.has(index)).sort(([a], [b]) => a - b).map(([,markup]) => markup).join("");
    const definition = this.fragment(graph.definition, this.xml.sourceXml(graph.definition, definitionPatches, true) + (link || firstLevel || newLink === undefined ? "" : newLink) + addedLevels);
    const definitionEditor = new DocumentXmlEditor(new TextEncoder().encode(definition), {}, undefined, this.budget);
    this.newAbstracts.push(mergeStyleChildren(definitionEditor, definitionEditor.root, new Map(), [], { abstractNumId: String(abstractId) }));
    const numPatches = new Map<XmlElement, string>([[this.child(graph.num, "abstractNumId")!, scalar("abstractNumId", abstractId)]]);
    for (const override of this.children(graph.num)) if (override.namespace === w && override.localName === "lvlOverride") numPatches.set(override, mergeStyleChildren(this.xml, override, new Map([["startOverride", ""], ["lvl", ""]]), ["startOverride", "lvl"], {}, children));
    const num = this.fragment(graph.num, this.xml.sourceXml(graph.num, numPatches, true)), numEditor = new DocumentXmlEditor(new TextEncoder().encode(num), {}, undefined, this.budget);
    this.newInstances.push(mergeStyleChildren(numEditor, numEditor.root, new Map(), [], { numId: String(id) }));
    return id;
  }
  mixUnusedLevel(graph: ResolvedNumbering, level: number, kind: typeof numberingFormats[number]): boolean {
    const reference = this.child(graph.num, "abstractNumId")!;
    if (integer(numberingAttribute(reference)) !== integer(numberingAttribute(graph.definition, "abstractNumId")) || this.child(graph.overrides.get(level), "lvl")) return false;
    const formats = Array.from({ length: 9 }, (_, i) => numberingAttribute(this.child(graph.levels.get(i), "numFmt")) ?? "");
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
      if (node.namespace === this.xml.root.namespace && node.localName === "numId" && nonnegativeInteger(numberingAttribute(node)) === id &&
        (!this.#children.has(node) || ancestors.at(-3)?.localName !== "p")) used = true;
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
      const startXml = startNode ? this.fragment(startNode, this.xml.sourceXml(startNode, new Map(), true), draft.starts.get(index))
        : draft.starts.has(index) ? `<nl:startOverride xmlns:nl="${w}" nl:val="${draft.starts.get(index)}"/>` : "";
      const effective = graph.levels.get(index)!;
      const definitionLevel = this.children(graph.definition).find(n => n.namespace === w && n.localName === "lvl" && integer(numberingAttribute(n, "ilvl"), 8) === index);
      const levelXml = effective === definitionLevel ? "" : effective === this.child(old, "lvl") ? this.xml.sourceXml(effective)
        : this.fragment(effective, this.xml.sourceXml(effective, new Map(), true));
      if (old) {
        const priorStart = this.child(old, "startOverride"), priorLevel = this.child(old, "lvl");
        const patches = new Map<XmlElement, string>();
        if (priorStart) patches.set(priorStart, startXml);
        if (priorLevel) patches.set(priorLevel, (priorStart ? "" : startXml) + levelXml);
        const tail = (priorStart || priorLevel ? "" : startXml) + (priorLevel ? "" : levelXml);
        const rewrite = (node: XmlElement): string | undefined => {
          this.budget.charge("work", 1);
          if (patches.has(node)) return patches.get(node)!;
          const changed = new Map<XmlElement, string>();
          for (const child of node.children) {
            const replacement = rewrite(child);
            if (replacement !== undefined) changed.set(child, replacement);
          }
          return changed.size ? this.xml.sourceXml(node, changed) : undefined;
        };
        const direct = new Map<XmlElement, string>();
        for (const child of old.children) {
          const replacement = rewrite(child);
          if (replacement !== undefined) direct.set(child, replacement);
        }
        overrides.set(index, this.fragment(old, this.xml.sourceXml(old, direct, true) + tail));
      } else overrides.set(index, `<nl:lvlOverride xmlns:nl="${w}" nl:ilvl="${index}">${startXml}${levelXml}</nl:lvlOverride>`);
    }
    // Materializing an instance preserves effective linked overrides and leaves the style graph untouched.
    this.newInstances[draft.position] = `<nl:num xmlns:nl="${w}" nl:numId="${id}"><nl:abstractNumId nl:val="${xmlValue(numberingAttribute(graph.definition, "abstractNumId")!)}"/>${[...overrides].sort(([a], [b]) => a - b).map(([, xml]) => xml).join('')}</nl:num>`;
    return id;
  }
  /** Bind inherited compatibility names before relocating a numbering fragment. */
  private fragment(node: XmlElement, content: string, value?: number): string {
    const chain: XmlElement[] = [];
    const find = (current: XmlElement): boolean => {
      this.budget.charge("work", 1);
      chain.push(current);
      if (current === node || current.children.some(find)) return true;
      chain.pop();
      return false;
    };
    if (!find(this.xml.root)) throw new UnsupportedEditError("Numbering fragment has no source owner.");
    const mc = "http://schemas.openxmlformats.org/markup-compatibility/2006";
    const bindings = new Map(node.namespaces), controls = new Map<string, Set<string>>();
    const prefixFor = (uri: string): string => {
      this.budget.charge("work", bindings.size);
      for (const [prefix, namespace] of bindings) if (prefix && namespace === uri) return prefix;
      let index = 0;
      while (bindings.has(`ctx${index}`)) { this.budget.charge("work", 1); index++; }
      const prefix = `ctx${index}`; bindings.set(prefix, uri); return prefix;
    };
    for (const ancestor of chain) for (const attribute of ancestor.attributes) {
      this.budget.charge("work", 1 + attribute.value.length);
      if (attribute.namespace !== mc) continue;
      const values = controls.get(attribute.localName) ?? new Set<string>();
      // XML whitespace, not host-language whitespace, separates prefix/QName lists.
      for (const token of attribute.value.split("\t").join(" ").split("\r").join(" ").split("\n").join(" ").split(" ").filter(Boolean)) {
        const [prefix, local] = token.split(":");
        const uri = ancestor.namespaces.get(prefix!);
        if (!uri) throw new UnsupportedEditError("Unbound numbering compatibility name.");
        values.add(prefixFor(uri) + (local === undefined ? "" : ":" + local));
      }
      controls.set(attribute.localName, values);
    }
    const attributes = node.attributes.filter(attribute => attribute.namespace !== mc).map(attribute => value !== undefined && attribute.namespace === node.namespace && attribute.localName === "val" ? { ...attribute, value: String(value) } : attribute);
    for (const [localName, values] of controls) attributes.push({ name: prefixFor(mc) + ":" + localName, namespace: mc, localName, value: [...values].join(" ") });
    const result = runElementOpen({ ...node, namespaces: bindings, attributes }) + content + `</${node.name}>`;
    this.budget.charge("retainedBytes", result.length * 2);
    this.budget.charge("work", result.length);
    return result;
  }
  flush(): Uint8Array {
    const additions = this.newAbstracts.join("");
    const instances = this.newInstances.join("");
    if (!additions && !instances && !this.rebindings.size) return this.xml.serialize();
    const root = this.xml.root;
    const active = new Set(activeXmlChildren(this.xml, this.budget)(root));
    const alternatives = new Set(this.xml.compatibility.branches.map(branch => branch.alternateContent));
    this.budget.charge("retainedBytes", 128 + (active.size + alternatives.size) * 16);
    const ranks = new Map<XmlElement, number[]>();
    const collect = (node: XmlElement, found: Set<number>, alternate = false): void => {
      this.budget.charge("work", 1);
      if (node.namespace === root.namespace) {
        const rank = ["numPicBullet", "abstractNum", "num", "numIdMacAtCleanup"].indexOf(node.localName);
        if (rank >= 0) { if (alternate || active.has(node)) found.add(rank); return; }
      }
      // Retain order for every stored branch of an exposed alternative; ignored
      // XML outside those alternatives cannot create numbering-order authority.
      for (const child of node.children) collect(child, found, alternate || alternatives.has(node));
    };
    for (const node of root.children) {
      const found = new Set<number>();
      collect(node, found);
      this.budget.charge("retainedBytes", 96 + found.size * 16);
      ranks.set(node, [...found]);
    }
    const boundary = (rank: number): XmlElement | undefined => {
      const node = root.children.find(node => ranks.get(node)!.some(value => value > rank));
      if (node && ranks.get(node)!.some(value => value < rank))
        throw new UnsupportedEditError("Numbering insertion would split a retained compatibility representation.");
      return node;
    };
    const firstNum = additions ? boundary(1) : undefined;
    const cleanup = instances ? boundary(2) : undefined;
    const patches = new Map<XmlElement, string>(this.rebindings);
    if (firstNum) patches.set(firstNum, additions + (patches.get(firstNum) ?? this.xml.sourceXml(firstNum)));
    if (cleanup) patches.set(cleanup, (firstNum === cleanup ? additions : "") + instances + (this.rebindings.get(cleanup) ?? this.xml.sourceXml(cleanup)));
    const content = this.xml.sourceXml(root, patches, true) + (firstNum ? "" : additions) + (cleanup ? "" : instances);
    const original = this.xml.serialize();
    const encoding = original[0] === 0xff && original[1] === 0xfe ? "UTF-16LE"
      : original[0] === 0xfe && original[1] === 0xff ? "UTF-16BE" : "UTF-8";
    const [prolog, epilog] = this.xml[sourceRootEnvelope]();
    const rewritten = prolog + runElementOpen(root) + content + `</${root.name}>` + epilog;
    this.budget.check("xmlPartBytes", rewritten.length * (encoding === "UTF-8" ? 1 : 2));
    this.budget.charge("retainedBytes", rewritten.length * 3);
    this.budget.charge("work", rewritten.length * 3);
    let bytes: Uint8Array;
    if (encoding === "UTF-8") bytes = new TextEncoder().encode(rewritten);
    else {
      bytes = new Uint8Array(rewritten.length * 2);
      const view = new DataView(bytes.buffer);
      for (let index = 0; index < rewritten.length; index++) view.setUint16(index * 2, rewritten.charCodeAt(index), encoding === "UTF-16LE");
    }
    const editor = new DocumentXmlEditor(bytes, {}, undefined, this.budget);
    this.budget.charge("insertedNodes", parseDocumentXml(new TextEncoder().encode(`<root${[...root.namespaces].filter(([p]) => p !== "xml").map(([p, uri]) => ` ${p ? "xmlns:" + p : "xmlns"}="${xmlValue(uri)}"`).join("")}>${additions}${instances}</root>`), {}, this.budget).root.children.reduce((total, n) => total + countNodes(n), 0));
    return editor.serialize();
  }
}
function countNodes(node: XmlElement): number { return 1 + node.children.reduce((n, child) => n + countNodes(child), 0); }

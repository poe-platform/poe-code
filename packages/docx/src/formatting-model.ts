import { plainLength, Pt, Twips, Length } from "./formatting-values.js";
import { BoundsError, StaleHandleError } from "./model-errors.js";
import { numericSequence } from "./numeric-index.js";
import { InputTypeError, InvalidValueError } from "./archive.js";
import type { DocxEnumValue, DocxLength, DocxOperationArguments, DocxTabStop } from "./operation-types.js";
import type { XmlElement } from "./package-xml.js";
import { DocumentXmlEditor } from "./xml-write.js";
import { formattedRunProperties, runElementOpen, underline, highlights, themes } from "./run-properties.js";
import { paragraphProperties, paragraphUnits, alignments as paragraphAlignments } from "./paragraph-properties.js";
import { validateDocxValue } from "./operation-schema.js";

/** An admitted owner fragment. Its caller retains package ownership and publication authority. */
export interface FormattingXmlOwner { getXml(): string; setXml(xml: string): void; readonly part?: unknown; readonly identity?: unknown }
function editor(owner: FormattingXmlOwner): DocumentXmlEditor { return new DocumentXmlEditor(new TextEncoder().encode(owner.getXml())); }
function child(node: XmlElement, name: string): XmlElement | undefined { return node.children.find(c => c.namespace === node.namespace && c.localName === name); }
function attr(node: XmlElement | undefined, name = "val"): string | undefined { return node?.attributes.find(a => a.namespace === node.namespace && a.localName === name)?.value; }
function update(owner: FormattingXmlOwner, kind: "r" | "p", values: DocxOperationArguments<"runs.set"> | DocxOperationArguments<"paragraphs.set">): void {
  const xml = editor(owner), root = xml.root;
  if (root.localName !== kind) throw new TypeError("Formatting requires the matching admitted owner element.");
  const props = child(root, kind + "Pr");
  let replacement = kind === "r" ? formattedRunProperties(xml, root, values as DocxOperationArguments<"runs.set">) : paragraphProperties(xml, root, values as DocxOperationArguments<"paragraphs.set">);
  if (!replacement) replacement = `<fmt:${kind}Pr xmlns:fmt="${root.namespace}"/>`;
  const patches = new Map<XmlElement, string>(); if (props) patches.set(props, replacement);
  owner.setXml(runElementOpen(root) + (props ? "" : replacement) + xml.sourceXml(root, patches, true) + `</${root.name}>`);
}
function tri(value: unknown): asserts value is boolean | null { if (value !== null && typeof value !== "boolean") throw new TypeError("Expected true, false or null."); }
function storedLength(value: string): Length {
  const suffix = value.slice(-2), multiplier = ({ in: 914400, cm: 360000, mm: 36000, pt: 12700, pc: 152400, pi: 152400 } as Readonly<Record<string, number>>)[suffix];
  if (multiplier !== undefined) return Length(Number(value.slice(0, -2)) * multiplier);
  if (!value.trim() || !Number.isSafeInteger(Number(value))) throw new TypeError("Invalid stored paragraph length.");
  return Twips(Number(value));
}
function booleanValue(node: XmlElement | undefined): boolean | null {
  if (!node) return null;
  const value = attr(node);
  if (value === undefined || ["1", "true", "on"].includes(value)) return true;
  if (["0", "false", "off"].includes(value)) return false;
  throw new TypeError("Invalid boolean formatting value.");
}
const fontFlags = {
  all_caps: ["allCaps", "caps"], bold: ["bold", "b"], complex_script: ["complexScriptEnabled", "cs"], cs_bold: ["csBold", "bCs"], cs_italic: ["csItalic", "iCs"], double_strike: ["doubleStrike", "dstrike"], emboss: ["emboss", "emboss"], hidden: ["hidden", "vanish"], imprint: ["imprint", "imprint"], italic: ["italic", "i"], math: ["math", "oMath"], no_proof: ["noProof", "noProof"], outline: ["outline", "outline"], rtl: ["rtl", "rtl"], shadow: ["shadow", "shadow"], small_caps: ["smallCaps", "smallCaps"], snap_to_grid: ["snapToGrid", "snapToGrid"], spec_vanish: ["specVanish", "specVanish"], strike: ["strike", "strike"], web_hidden: ["webHidden", "webHidden"]
} as const;
export class Font {
  declare all_caps: boolean | null;
  declare bold: boolean | null;
  declare complex_script: boolean | null;
  declare cs_bold: boolean | null;
  declare cs_italic: boolean | null;
  declare double_strike: boolean | null;
  declare emboss: boolean | null;
  declare hidden: boolean | null;
  declare imprint: boolean | null;
  declare italic: boolean | null;
  declare math: boolean | null;
  declare no_proof: boolean | null;
  declare outline: boolean | null;
  declare rtl: boolean | null;
  declare shadow: boolean | null;
  declare small_caps: boolean | null;
  declare snap_to_grid: boolean | null;
  declare spec_vanish: boolean | null;
  declare strike: boolean | null;
  declare web_hidden: boolean | null;

  private readonly colorFormat: ColorFormat;
  constructor(readonly owner: FormattingXmlOwner) { this.colorFormat = new ColorFormat(owner); }
  get color(): ColorFormat { return this.colorFormat; }
  get part(): unknown { return this.owner.part ?? null; }
  equals(other: unknown): boolean { return other instanceof Font && (this.owner.identity ?? this.owner) === (other.owner.identity ?? other.owner); }
  get element(): XmlElement { return editor(this.owner).root; }
  private property(name: string): XmlElement | undefined { const props = child(this.element, "rPr"); return props && child(props, name); }
  get name(): string | null { return attr(this.property("rFonts"), "ascii") ?? null; }
  set name(value: string | null) { if (value !== null && typeof value !== "string") throw new TypeError("Expected a font name or null."); update(this.owner, "r", { font: value }); }
  get size(): Length | null { const value = attr(this.property("sz")); return value === undefined ? null : Pt(Number(value) / 2); }
  set size(value: DocxLength | null) { value = value === null ? null : plainLength(value); if (value !== null && !validateDocxValue("Length", value)) throw new TypeError("Expected a font length or null."); update(this.owner, "r", { size: value === null ? null : { value: paragraphUnits(value, 1), unit: "emu" } }); }
  get underline(): boolean | DocxEnumValue<"WD_UNDERLINE"> | null {
    const value = attr(this.property("u")); if (value === undefined) return null;
    if (value === "single") return true; if (value === "none") return false;
    const name = Object.keys(underline).find(key => underline[key as keyof typeof underline] === value) as keyof typeof underline | undefined;
    if (!name) throw new TypeError("Invalid underline value."); return { enum: "WD_UNDERLINE", name };
  }
  set underline(value: boolean | DocxEnumValue<"WD_UNDERLINE"> | null) { if (!validateDocxValue("boolean | WD_UNDERLINE | null", value) || value !== null && typeof value === "object" && !Object.hasOwn(underline, value.name)) throw new TypeError("Invalid underline value."); update(this.owner, "r", { underline: value }); }
  get highlight_color(): DocxEnumValue<"WD_COLOR_INDEX"> | null {
    const value = attr(this.property("highlight")); if (value === undefined) return null;
    const name = Object.keys(highlights).find(key => highlights[key as keyof typeof highlights] === value) as keyof typeof highlights | undefined;
    if (!name) throw new TypeError("Invalid highlight color."); return { enum: "WD_COLOR_INDEX", name };
  }
  set highlight_color(value: DocxEnumValue<"WD_COLOR_INDEX"> | null) { if (!validateDocxValue("WD_COLOR_INDEX | null", value) || value !== null && !Object.hasOwn(highlights, value.name)) throw new TypeError("Invalid highlight color."); update(this.owner, "r", { highlight: value }); }
  get superscript(): boolean | null { const value = attr(this.property("vertAlign")); return value === undefined ? null : value === "superscript"; }
  set superscript(value: boolean | null) { this.baseline("superscript", value); }
  get subscript(): boolean | null { const value = attr(this.property("vertAlign")); return value === undefined ? null : value === "subscript"; }
  set subscript(value: boolean | null) { this.baseline("subscript", value); }
  private baseline(mode: "subscript" | "superscript", value: boolean | null): void {
    tri(value);
    if (value === false && attr(this.property("vertAlign")) !== mode) { if (!child(this.element, "rPr")) update(this.owner, "r", {}); return; }
    update(this.owner, "r", { baseline: value === true ? mode : null });
  }
}
for (const [name, [option, tag]] of Object.entries(fontFlags)) Object.defineProperty(Font.prototype, name, {
  get(this: Font) { const props = child(this.element, "rPr"); return booleanValue(props && child(props, tag)); },
  set(this: Font, value: boolean | null) { tri(value); update(this.owner, "r", { [option]: value }); }, enumerable: true
});

const paragraphFlags = { keep_with_next: ["keepWithNext", "keepNext"], keep_together: ["keepTogether", "keepLines"], widow_control: ["widowControl", "widowControl"], page_break_before: ["pageBreakBefore", "pageBreakBefore"] } as const;
export class ParagraphFormat {
  declare keep_with_next: boolean | null;
  declare keep_together: boolean | null;
  declare widow_control: boolean | null;
  declare page_break_before: boolean | null;

  private tabs?: TabStops;
  constructor(readonly owner: FormattingXmlOwner) {}
  get tab_stops(): TabStops { if (!child(this.element, "pPr")) update(this.owner, "p", {}); return this.tabs ??= new TabStops(this.owner); }
  get part(): unknown { return this.owner.part ?? null; }
  equals(other: unknown): boolean { return other instanceof ParagraphFormat && (this.owner.identity ?? this.owner) === (other.owner.identity ?? other.owner); }
  get element(): XmlElement { return editor(this.owner).root; }
  private property(name: string): XmlElement | undefined { const props = child(this.element, "pPr"); return props && child(props, name); }
  get alignment(): DocxEnumValue<"WD_PARAGRAPH_ALIGNMENT"> | null {
    const value = attr(this.property("jc")); if (value === undefined) return null;
    const normalized = value === "start" ? "left" : value === "end" ? "right" : value;
    const name = Object.keys(paragraphAlignments).find(key => paragraphAlignments[key as keyof typeof paragraphAlignments] === normalized) as keyof typeof paragraphAlignments | undefined;
    if (!name) throw new TypeError("Invalid paragraph alignment."); return { enum: "WD_PARAGRAPH_ALIGNMENT", name };
  }
  set alignment(value: DocxEnumValue<"WD_PARAGRAPH_ALIGNMENT"> | null) { if (!validateDocxValue("WD_PARAGRAPH_ALIGNMENT | null", value)) throw new TypeError("Invalid paragraph alignment."); update(this.owner, "p", { alignment: value }); }
  get right_indent(): Length | null { const node = this.property("ind"), value = attr(node, "end") ?? attr(node, "right"); return value === undefined ? null : storedLength(value); }
  set right_indent(value: DocxLength | null) { this.length("rightIndent", value); }
  get first_line_indent(): Length | null { const node = this.property("ind"), hanging = attr(node, "hanging"), first = attr(node, "firstLine"); return hanging !== undefined ? Twips(-storedLength(hanging).emu / 635) : first === undefined ? null : storedLength(first); }
  set first_line_indent(value: DocxLength | null) { this.length("firstLineIndent", value); }
  get space_before(): Length | null { const value = attr(this.property("spacing"), "before"); return value === undefined ? null : storedLength(value); }
  set space_before(value: DocxLength | null) { this.length("spaceBefore", value); }
  get space_after(): Length | null { const value = attr(this.property("spacing"), "after"); return value === undefined ? null : storedLength(value); }
  set space_after(value: DocxLength | null) { this.length("spaceAfter", value); }
  private length(option: "rightIndent" | "firstLineIndent" | "spaceBefore" | "spaceAfter", value: DocxLength | null): void { value = value === null ? null : plainLength(value); if (!validateDocxValue("Length | null", value)) throw new TypeError("Expected a length or null."); update(this.owner, "p", { [option]: value }); }
  get line_spacing(): Length | number | null { const node = this.property("spacing"), value = attr(node, "line"); return value === undefined ? null : ["exact", "atLeast"].includes(attr(node, "lineRule") ?? "auto") ? storedLength(value) : Number(value) / 240; }
  set line_spacing(value: DocxLength | number | null) { value = value !== null && typeof value === "object" ? plainLength(value) : value; if (!validateDocxValue("Length | finite number | null", value)) throw new TypeError("Invalid line spacing."); update(this.owner, "p", { lineSpacing: value, ...(value !== null && typeof value === "object" && this.line_spacing_rule?.name === "AT_LEAST" ? { lineSpacingRule: { enum: "WD_LINE_SPACING", name: "AT_LEAST" } as const } : {}) }); }
  get line_spacing_rule(): DocxEnumValue<"WD_LINE_SPACING"> | null {
    const node = this.property("spacing"), rule = attr(node, "lineRule"), line = attr(node, "line"); if (line === undefined && rule === undefined) return null;
    const name = rule === "exact" ? "EXACTLY" : rule === "atLeast" ? "AT_LEAST" : line === "240" ? "SINGLE" : line === "360" ? "ONE_POINT_FIVE" : line === "480" ? "DOUBLE" : "MULTIPLE";
    return { enum: "WD_LINE_SPACING", name };
  }
  set line_spacing_rule(value: DocxEnumValue<"WD_LINE_SPACING"> | null) { if (!validateDocxValue("WD_LINE_SPACING | null", value)) throw new TypeError("Invalid line spacing rule."); update(this.owner, "p", { lineSpacingRule: value }); }
  get left_indent(): Length | null { const props = child(this.element, "pPr"), ind = props && child(props, "ind"); const value = attr(ind, "start") ?? attr(ind, "left"); return value === undefined ? null : storedLength(value); }
  set left_indent(value: DocxLength | null) { value = value === null ? null : plainLength(value); if (value !== null && !validateDocxValue("Length", value)) throw new TypeError("Expected a length or null."); update(this.owner, "p", { leftIndent: value as DocxOperationArguments<"paragraphs.set">["leftIndent"] }); }
}
for (const [name, [option, tag]] of Object.entries(paragraphFlags)) Object.defineProperty(ParagraphFormat.prototype, name, {
  get(this: ParagraphFormat) { const props = child(this.element, "pPr"); return booleanValue(props && child(props, tag)); },
  set(this: ParagraphFormat, value: boolean | null) { tri(value); update(this.owner, "p", { [option]: value }); }, enumerable: true
});
const alignments = { left: "LEFT", start: "START", center: "CENTER", right: "RIGHT", end: "END", decimal: "DECIMAL", bar: "BAR", list: "LIST", clear: "CLEAR", num: "NUM" } as const;
const leaders = { none: "SPACES", dot: "DOTS", hyphen: "DASHES", underscore: "LINES", heavy: "HEAVY", middleDot: "MIDDLE_DOT" } as const;
interface StopRecord { id: number; value: DocxTabStop }
const tabCollections = new WeakMap<object, TabStops>();
export class TabStops implements Iterable<TabStop> {
  readonly [index: number]: TabStop;
  private snapshot = "";
  private tabSnapshot = "";
  private records: StopRecord[] = [];
  private nextId = 0;
  constructor(readonly owner: FormattingXmlOwner) {
    const identity = owner.identity;
    const key = identity !== null && typeof identity === "object" ? identity : owner;
    const existing = tabCollections.get(key);
    if (existing) return existing;
    const collection = numericSequence(this);
    tabCollections.set(key, collection);
    return collection;
  }
  get element(): XmlElement { const root = editor(this.owner).root; return child(root, "pPr") ?? root; }
  get part(): unknown { return this.owner.part ?? null; }
  equals(other: unknown): boolean { return other instanceof TabStops && (this.owner.identity ?? this.owner) === (other.owner.identity ?? other.owner); }
  elementFor(id: number): XmlElement { this.refresh(); const index = this.records.findIndex(record => record.id === id); if (index < 0) throw new StaleHandleError("Tab stop handle is no longer valid."); return child(this.element, "tabs")!.children.filter(node => node.namespace === this.element.namespace && node.localName === "tab")[index]!; }

  private refresh(): void {
    const source = this.owner.getXml(); if (source === this.snapshot) return;
    const xml = editor(this.owner), root = xml.root, props = child(root, "pPr"), tabs = props && child(props, "tabs");
    const tabXml = tabs ? xml.sourceXml(tabs) : "";
    if (tabXml === this.tabSnapshot) { this.snapshot = source; return; }
    this.tabSnapshot = tabXml;
    this.records = (tabs?.children.filter(c => c.namespace === root.namespace && c.localName === "tab") ?? []).map(node => {
      const position = Number(attr(node, "pos"));
      const alignment = alignments[attr(node)! as keyof typeof alignments], leader = leaders[(attr(node, "leader") ?? "none") as keyof typeof leaders];
      if (!Number.isSafeInteger(position) || !alignment || !leader) throw new TypeError("Invalid tab stop properties.");
      return { id: this.nextId++, value: { position: { value: position, unit: "twip" }, alignment: { enum: "WD_TAB_ALIGNMENT", name: alignment }, leader: { enum: "WD_TAB_LEADER", name: leader } } };
    });
    this.snapshot = source;
  }
  private remember(): void {
    this.snapshot = this.owner.getXml(); const xml = editor(this.owner), props = child(xml.root, "pPr"), tabs = props && child(props, "tabs"); this.tabSnapshot = tabs ? xml.sourceXml(tabs) : "";
  }
  get length(): number { this.refresh(); return this.records.length; }
  at(index: number): TabStop { this.refresh(); const record = this.records[this.index(index)]; return new TabStop(this, record!.id); }
  private index(index: number): number { if (!Number.isSafeInteger(index)) throw new InputTypeError("Expected an integer tab index."); const resolved = index < 0 ? this.records.length + index : index; if (resolved < 0 || resolved >= this.records.length) throw new BoundsError("Tab stop index is out of range."); return resolved; }
  *[Symbol.iterator](): IterableIterator<TabStop> { this.refresh(); for (const record of [...this.records]) yield new TabStop(this, record.id); }
  add_tab_stop(position: DocxLength, alignment: DocxEnumValue<"WD_TAB_ALIGNMENT"> = { enum: "WD_TAB_ALIGNMENT", name: "LEFT" }, leader: DocxEnumValue<"WD_TAB_LEADER"> = { enum: "WD_TAB_LEADER", name: "SPACES" }): TabStop {
    this.refresh(); const value = { position: plainLength(position), alignment, leader };
    if (!validateDocxValue("{position: Length; alignment?: WD_TAB_ALIGNMENT; leader?: WD_TAB_LEADER}", value)) throw new TypeError("Expected valid tab stop properties.");
    update(this.owner, "p", { tabStopAdd: value });
    const record = { id: this.nextId++, value: { ...value, position: { value: paragraphUnits(position), unit: "twip" as const } } };
    this.records.push(record); this.records.sort((a, b) => a.value.position.value - b.value.position.value); this.remember();
    return new TabStop(this, record.id);
  }
  declare delete: (index: number) => void;
  remove(index: number): void { this.refresh(); const resolved = this.index(index); update(this.owner, "p", { tabStopDelete: resolved }); this.records.splice(resolved, 1); this.remember(); }
  clear_all(): void { update(this.owner, "p", { tabStopsClear: true }); this.records = []; this.remember(); }
  value(id: number): DocxTabStop { this.refresh(); const record = this.records.find(r => r.id === id); if (!record) throw new StaleHandleError("Tab stop handle is no longer valid."); return structuredClone(record.value); }
  change(id: number, patch: Partial<DocxTabStop>): void {
    this.refresh(); const index = this.records.findIndex(r => r.id === id); if (index < 0) throw new StaleHandleError("Tab stop handle is no longer valid.");
    const value = { ...this.records[index]!.value, ...patch, ...(patch.position !== undefined ? { position: plainLength(patch.position) } : {}) };
    if (!validateDocxValue("{position: Length; alignment?: WD_TAB_ALIGNMENT; leader?: WD_TAB_LEADER}", value)) throw new TypeError("Expected valid tab stop properties.");
    const xml = editor(this.owner), props = child(xml.root, "pPr")!, tabs = child(props, "tabs")!;
    const node = tabs.children.filter(c => c.namespace === tabs.namespace && c.localName === "tab")[index]!;
    const values: Record<string, string | null> = {};
    if (patch.position !== undefined) values.pos = String(paragraphUnits(value.position));
    if (patch.alignment !== undefined) values.val = Object.keys(alignments).find(key => alignments[key as keyof typeof alignments] === value.alignment!.name)!;
    if (patch.leader !== undefined) values.leader = value.leader!.name === "SPACES" ? null : Object.keys(leaders).find(key => leaders[key as keyof typeof leaders] === value.leader!.name)!;
    let prefix = "tf"; while (node.namespaces.has(prefix) && node.namespaces.get(prefix) !== node.namespace) prefix += "f";
    const attributes = [...node.attributes.filter(attribute => attribute.namespace !== node.namespace || !Object.hasOwn(values, attribute.localName)), ...Object.entries(values).filter(([, text]) => text !== null).map(([name, text]) => ({ name: prefix + ":" + name, localName: name, namespace: node.namespace, value: text! }))];
    const changed = runElementOpen({ ...node, namespaces: new Map([...node.namespaces, [prefix, node.namespace]]), attributes }) + xml.sourceXml(node, new Map(), true) + `</${node.name}>`;
    const changedTabs = runElementOpen(tabs) + xml.sourceXml(tabs, new Map([[node, changed]]), true) + `</${tabs.name}>`;
    const changedProps = runElementOpen(props) + xml.sourceXml(props, new Map([[tabs, changedTabs]]), true) + `</${props.name}>`;
    let source = runElementOpen(xml.root) + xml.sourceXml(xml.root, new Map([[props, changedProps]]), true) + `</${xml.root.name}>`;
    if (patch.position !== undefined) {
      const moved = new DocumentXmlEditor(new TextEncoder().encode(source)), pPr = child(moved.root, "pPr")!, container = child(pPr, "tabs")!;
      const stops = container.children.filter(c => c.namespace === container.namespace && c.localName === "tab"), moving = stops[index]!;
      const next = stops.find((stop, offset) => offset !== index && Number(attr(stop, "pos")) > paragraphUnits(value.position));
      const changes = new Map<XmlElement, string>([[moving, ""]]), markup = moved.sourceXml(moving);
      if (next) changes.set(next, markup + moved.sourceXml(next));
      const updatedTabs = runElementOpen(container) + moved.sourceXml(container, changes, true) + (next ? "" : markup) + `</${container.name}>`;
      const updatedProps = runElementOpen(pPr) + moved.sourceXml(pPr, new Map([[container, updatedTabs]]), true) + `</${pPr.name}>`;
      source = runElementOpen(moved.root) + moved.sourceXml(moved.root, new Map([[pPr, updatedProps]]), true) + `</${moved.root.name}>`;
    }
    this.owner.setXml(source);
        const record = { id, value: { ...value, position: { value: paragraphUnits(value.position), unit: "twip" as const } } };
    if (patch.position !== undefined) { this.records.splice(index, 1); this.records.push(record); this.records.sort((a, b) => a.value.position.value - b.value.position.value); }
    else this.records[index] = record;
    this.remember();
  }
}
Object.defineProperty(TabStops.prototype, "delete", { value: TabStops.prototype.remove });
export class TabStop {
  constructor(private readonly collection: TabStops, private readonly id: number) {}
  get element(): XmlElement { return this.collection.elementFor(this.id); }
  get part(): unknown { this.collection.value(this.id); return this.collection.part; }
  equals(other: unknown): boolean { this.collection.value(this.id); if (!(other instanceof TabStop)) return false; other.collection.value(other.id); return this.collection.equals(other.collection) && this.id === other.id; }
  get position(): Length { return Twips(paragraphUnits(this.collection.value(this.id).position)); }
  set position(value: DocxLength) { this.collection.change(this.id, { position: value }); }
  get alignment(): DocxEnumValue<"WD_TAB_ALIGNMENT"> { return this.collection.value(this.id).alignment!; }
  set alignment(value: DocxEnumValue<"WD_TAB_ALIGNMENT">) { this.collection.change(this.id, { alignment: value }); }
  get leader(): DocxEnumValue<"WD_TAB_LEADER"> { return this.collection.value(this.id).leader!; }
  set leader(value: DocxEnumValue<"WD_TAB_LEADER"> | null) { this.collection.change(this.id, { leader: value ?? { enum: "WD_TAB_LEADER", name: "SPACES" } }); }
}

export class RGBColor implements Iterable<number> {
  readonly [index: number]: number;
  readonly length = 3;
  private readonly values: readonly [number, number, number];
  constructor(red: number, green: number, blue: number) {
    if ([red, green, blue].some(value => typeof value !== "number" || !Number.isInteger(value))) throw new InputTypeError("RGB components must be integers.");
    if ([red, green, blue].some(value => value < 0 || value > 255)) throw new InvalidValueError("RGB components must be between zero and 255.");
    this.values = Object.freeze([red, green, blue]); Object.freeze(this);
    return numericSequence(this);
  }
  static from_string(value: string): RGBColor { if (!validateDocxValue("RGBColor", value)) throw new InputTypeError("Expected six hexadecimal color digits."); return new RGBColor(...[0, 2, 4].map(offset => Number.parseInt(value.slice(offset, offset + 2), 16)) as [number, number, number]); }
  toString(): string { return this.values.map(value => value.toString(16).padStart(2, "0")).join("").toUpperCase(); }
  *[Symbol.iterator](): IterableIterator<number> { yield* this.values; }
  at(index: number): number { if (!Number.isSafeInteger(index)) throw new InputTypeError("Expected an integer component index."); const value = this.values.at(index); if (value === undefined) throw new BoundsError("Color component index is out of range."); return value; }
  toArray(): readonly [number, number, number] { return this.values; }
  slice(start = 0, end = 3): readonly number[] { if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end)) throw new InputTypeError("Expected integer slice bounds."); return this.values.slice(start, end); }
  count(value: number): number { return this.values.filter(item => item === value).length; }
  index(value: number, start = 0, stop = 3): number {
    if (!Number.isSafeInteger(start) || !Number.isSafeInteger(stop)) throw new InputTypeError("Expected integer component bounds.");
    const first = Math.min(3, Math.max(0, start < 0 ? 3 + start : start)), end = Math.min(3, Math.max(0, stop < 0 ? 3 + stop : stop));
    for (let index = first; index < end; index++) if (this.values[index] === value) return index;
    throw new InvalidValueError("Color component was not found.");
  }
  includes(value: number): boolean { return this.values.includes(value); }
  *reversed(): IterableIterator<number> { for (let index = this.values.length - 1; index >= 0; index--) yield this.values[index]!; }
  equals(other: unknown): boolean { return other instanceof RGBColor && this.values.every((value, index) => value === other.values[index]); }
}
export class ColorFormat {
  constructor(readonly owner: FormattingXmlOwner) {}
  get part(): unknown { return this.owner.part ?? null; }
  equals(other: unknown): boolean { return other instanceof ColorFormat && (this.owner.identity ?? this.owner) === (other.owner.identity ?? other.owner); }
  get element(): XmlElement { return editor(this.owner).root; }
  private node(): XmlElement | undefined { const props = child(this.element, "rPr"); return props && child(props, "color"); }
  get rgb(): RGBColor | null { const value = attr(this.node()); return value === undefined || value === "auto" ? null : RGBColor.from_string(value); }
  set rgb(value: RGBColor | null) { if (value !== null && !(value instanceof RGBColor)) throw new TypeError("Expected RGBColor or null."); if (value === null && !this.node()) return; update(this.owner, "r", { color: value === null ? null : value.toString() }); }
  get theme_color(): DocxEnumValue<"MSO_THEME_COLOR"> | null {
    const value = attr(this.node(), "themeColor"); if (value === undefined) return null;
    const name = Object.keys(themes).find(key => themes[key as keyof typeof themes] === value) as keyof typeof themes | undefined;
    if (!name) throw new TypeError("Invalid theme color."); return { enum: "MSO_THEME_COLOR", name };
  }
  set theme_color(value: DocxEnumValue<"MSO_THEME_COLOR"> | null) { if (!validateDocxValue("MSO_THEME_COLOR | null", value) || value !== null && !Object.hasOwn(themes, value.name)) throw new TypeError("Invalid theme color."); if (value === null && !this.node()) return; if (value !== null && !this.node()) {
      let source = this.owner.getXml(); const staged = { getXml: () => source, setXml: (xml: string) => { source = xml; } };
      update(staged, "r", { color: "000000" }); update(staged, "r", { themeColor: value }); this.owner.setXml(source);
    } else update(this.owner, "r", value === null ? { color: null } : { themeColor: value }); }
  get type(): DocxEnumValue<"MSO_COLOR_TYPE"> | null { const node = this.node(); return node === undefined ? null : { enum: "MSO_COLOR_TYPE", name: attr(node, "themeColor") !== undefined ? "THEME" : attr(node) === "auto" ? "AUTO" : "RGB" }; }
}

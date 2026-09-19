import { storedBoolean } from "./stored-lexical.js";
import { bindXmlElementView, type XmlElementView, type XmlViewBinding } from "./xml-element-view.js";
import { storedMeasure } from "./stored-measure.js";
import { InvalidDocumentError } from "./document-error.js";
import { DocumentBudget } from "./budget.js";
import { plainLength, Twips, Length, enumFamilies, type EnumMember } from "./formatting-values.js";
import { BoundsError, StaleHandleError } from "./model-errors.js";
import { numericSequence, snapshotSequence } from "./numeric-index.js";
import { InputTypeError, InvalidValueError } from "./archive.js";
import type { DocxEnumValue, DocxLength, DocxOperationArguments, DocxTabStop } from "./operation-types.js";
import type { XmlElement } from "./package-xml.js";
import { DocumentXmlEditor, UnsupportedEditError, replaceNativeTabCollectionXml } from "./xml-write.js";
import { formattedRunProperties, runElementOpen, underline, highlights, themes } from "./run-properties.js";
import { paragraphProperties, paragraphUnits, tabAlignmentXml, newTabStopXml, alignments as paragraphAlignments } from "./paragraph-properties.js";
import { validateDocxValue } from "./operation-schema.js";
import { assertFormattingHistoryEditable } from "./revision-markup.js";
import { activeXmlChildren } from "./xml-active-children.js";
import type { ModelStore, ModelRef } from "./model-store.js";

/** An admitted owner fragment. Its caller retains package ownership and publication authority. */
export interface FormattingXmlOwner {
  getXml(): string;
  setXml(xml: string): void;
  readonly part?: unknown;
  readonly identity?: unknown;
  readonly budget?: DocumentBudget;
}
/** Internal live bindings, not exported by the public barrel. */
export const formattingXmlOwners = new WeakMap<FormattingXmlOwner, XmlViewBinding>();
/** Internal live binding retains inherited compatibility scope and model mutation ownership. */
export function modelFormattingOwner(store: ModelStore, ref: ModelRef): FormattingXmlOwner {
  const owner: FormattingXmlOwner = {
    budget: store.context.budget,
    get part() { store.node(ref); return store.part(ref.part); },
    get identity() { return store.identity(ref); },
    getXml: () => new TextDecoder().decode(store.element(ref).serialize()),
    setXml: source => store.change(ref.part, xml => xml.replaceElement(store.node(ref), source))
  };
  formattingXmlOwners.set(owner, {
    budget: store.context.budget,
    read: () => store.xml(ref.part),
    resolve: () => store.node(ref),
    change: action => store.change(ref.part, action)
  });
  return owner;
}
const ownerBudgets = new WeakMap<object, DocumentBudget>();
function ownerBudget(owner: FormattingXmlOwner): DocumentBudget {
  if (owner.budget) return owner.budget;
  const identity = owner.identity, key = identity !== null && typeof identity === "object" ? identity : owner;
  let budget = ownerBudgets.get(key);
  if (!budget) { budget = new DocumentBudget(); ownerBudgets.set(key, budget); }
  return budget;
}
function editor(owner: FormattingXmlOwner): DocumentXmlEditor { return new DocumentXmlEditor(new TextEncoder().encode(owner.getXml()), {}, undefined, ownerBudget(owner)); }
function readView(owner: FormattingXmlOwner, fragment?: DocumentXmlEditor, root?: XmlElement) {
  const binding = formattingXmlOwners.get(owner), xml = fragment ?? binding?.read() ?? editor(owner);
  const view = { xml, root: root ?? (fragment ? xml.root : binding?.resolve(xml) ?? xml.root) };
  return { ...view, children: activeXmlChildren(view.xml, ownerBudget(owner)) };
}
const ownerXmlViews = new WeakMap<object, Map<string, XmlElementView>>();
function ownerView(owner: FormattingXmlOwner, key = "root", resolve: (xml: DocumentXmlEditor, root: XmlElement) => XmlElement = (ignoredXml, root) => root, changed?: () => void, removeRoot?: () => void): XmlElementView {
  const identity = owner.identity, bindingKey = identity !== null && typeof identity === "object" ? identity : owner;
  let views = ownerXmlViews.get(bindingKey);
  if (!views) { views = new Map(); ownerXmlViews.set(bindingKey, views); }
  let view = views.get(key);
  if (!view) {
    const budget = ownerBudget(owner), binding = formattingXmlOwners.get(owner);
    view = bindXmlElementView({
      budget,
      ...(removeRoot ? {removeRoot} : {}),
      read: binding?.read ?? (() => editor(owner)),
      resolve: xml => resolve(xml, binding?.resolve(xml) ?? xml.root),
      change: action => {
        if (binding) binding.change(action);
        else { const xml = editor(owner); action(xml); owner.setXml(new TextDecoder().decode(xml.serialize())); }
        changed?.();
      }
    });
    views.set(key, view);
  }
  return view;
}
function child(node: XmlElement, name: string, children: (node: XmlElement) => readonly XmlElement[] = node => node.children): XmlElement | undefined { return children(node).find(c => c.namespace === node.namespace && c.localName === name); }
function property(owner: FormattingXmlOwner, kind: "rPr" | "pPr", name: string): XmlElement | undefined {
  const view = readView(owner), props = child(view.root, kind, view.children);
  return props && child(props, name, view.children);
}
function attr(node: XmlElement | undefined, name = "val"): string | undefined { return node?.attributes.find(a => a.namespace === node.namespace && a.localName === name)?.value; }
function update(owner: FormattingXmlOwner, kind: "r" | "p", values: DocxOperationArguments<"runs.set"> | DocxOperationArguments<"paragraphs.set">): void {
  const binding = formattingXmlOwners.get(owner);
  if (binding) {
    binding.change(xml => {
      const root = binding.resolve(xml), children = activeXmlChildren(xml, ownerBudget(owner)), props = child(root, kind + "Pr", children);
      assertFormattingHistoryEditable(xml.root, root, children, ownerBudget(owner));
      let replacement = kind === "r" ? formattedRunProperties(xml, root, values as DocxOperationArguments<"runs.set">, children) : paragraphProperties(xml, root, values as DocxOperationArguments<"paragraphs.set">, undefined, children, null);
      // Formatting setters retain or materialize their documented property owner.
      if (!replacement) replacement = props ? runElementOpen(props) + `</${props.name}>` : `<fmt:${kind}Pr xmlns:fmt="${root.namespace}"/>`;
      const tab = kind === "p" ? (values as DocxOperationArguments<"paragraphs.set">).tabStopAdd : undefined, tabs = props && child(props, "tabs", children);
      if (tab && tabs) { xml[replaceNativeTabCollectionXml](props!, replacement, tabs, newTabStopXml(root.namespace, tab, null), paragraphUnits(tab.position)); return; }
      if (props) { if (replacement !== xml.sourceXml(props)) xml.replaceElement(props, replacement); }
      else if (replacement) xml.insertChildren(root, replacement, root.children[0]);
    });
    return;
  }
  const xml = editor(owner), root = xml.root;
  if (root.localName !== kind) throw new TypeError("Formatting requires the matching admitted owner element.");
  assertFormattingHistoryEditable(xml.root, root, activeXmlChildren(xml, ownerBudget(owner)), ownerBudget(owner));
  const props = child(root, kind + "Pr");
  let replacement = kind === "r" ? formattedRunProperties(xml, root, values as DocxOperationArguments<"runs.set">) : paragraphProperties(xml, root, values as DocxOperationArguments<"paragraphs.set">, undefined, undefined, null);
  if (!replacement) replacement = `<fmt:${kind}Pr xmlns:fmt="${root.namespace}"/>`;
  const patches = new Map<XmlElement, string>(); if (props) patches.set(props, replacement);
  owner.setXml(runElementOpen(root) + (props ? "" : replacement) + xml.sourceXml(root, patches, true) + `</${root.name}>`);
}
function tri(value: unknown): asserts value is boolean | null { if (value !== null && typeof value !== "boolean") throw new InputTypeError("Expected true, false or null."); }
function booleanValue(node: XmlElement | undefined): boolean | null {
  if (!node) return null;
  return storedBoolean(attr(node) ?? "1", "Invalid boolean formatting value.");
}
function storedFormattingToken(node: XmlElement | undefined, attribute: string, values: readonly string[], message: string, required = false): string | undefined {
  const value = attr(node, attribute);
  if (node && required && value === undefined || value !== undefined && !values.includes(value)) throw new InvalidDocumentError(message);
  return value;
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
  constructor(readonly owner: FormattingXmlOwner) { void owner.identity; this.colorFormat = new ColorFormat(owner); }
  get color(): ColorFormat { void this.owner.identity; return this.colorFormat; }
  get part(): unknown { return this.owner.part ?? null; }
  equals(other: unknown): boolean { return other instanceof Font && (this.owner.identity ?? this.owner) === (other.owner.identity ?? other.owner); }
  get element(): XmlElementView { return ownerView(this.owner); }
  get name(): string | null { return attr(property(this.owner, "rPr", "rFonts"), "ascii") ?? null; }
  set name(value: string | null) { if (value !== null && typeof value !== "string") throw new InputTypeError("Expected a font name or null."); update(this.owner, "r", { font: value }); }
  get size(): Length | null { const node = property(this.owner, "rPr", "sz"), value = attr(node); if (node && value === undefined) throw new InvalidDocumentError("Missing stored font size."); return value === undefined ? null : storedMeasure(value, "half-point"); }
  set size(value: DocxLength | null) { value = value === null ? null : plainLength(value); if (value !== null && !validateDocxValue("Length", value)) throw new InputTypeError("Expected a font length or null."); update(this.owner, "r", { size: value === null ? null : { value: paragraphUnits(value, 1), unit: "emu" } }); }
  get underline(): boolean | EnumMember<"WD_UNDERLINE"> | null {
    const value = attr(property(this.owner, "rPr", "u")); if (value === undefined) return null;
    if (value === "single") return true; if (value === "none") return false;
    const name = Object.keys(underline).find(key => underline[key as keyof typeof underline] === value) as keyof typeof underline | undefined;
    if (!name) throw new InvalidDocumentError("Invalid underline value."); return enumFamilies.WD_UNDERLINE[name];
  }
  set underline(value: boolean | DocxEnumValue<"WD_UNDERLINE"> | null) { if (!validateDocxValue("boolean | WD_UNDERLINE | null", value) || value !== null && typeof value === "object" && !Object.hasOwn(underline, value.name)) throw new InputTypeError("Invalid underline value."); update(this.owner, "r", { underline: value }); }
  get highlight_color(): EnumMember<"WD_COLOR_INDEX"> | null {
    const node = property(this.owner, "rPr", "highlight"), value = attr(node); if (!node) return null;
    if (value === undefined) throw new InvalidDocumentError("Missing stored highlight color.");
    const name = Object.keys(highlights).find(key => highlights[key as keyof typeof highlights] === value) as keyof typeof highlights | undefined;
    if (!name) throw new InvalidDocumentError("Invalid highlight color."); return enumFamilies.WD_COLOR_INDEX[name];
  }
  set highlight_color(value: DocxEnumValue<"WD_COLOR_INDEX"> | null) { if (!validateDocxValue("WD_COLOR_INDEX | null", value) || value !== null && !Object.hasOwn(highlights, value.name)) throw new InputTypeError("Invalid highlight color."); update(this.owner, "r", { highlight: value }); }
  get superscript(): boolean | null { const value = storedFormattingToken(property(this.owner, "rPr", "vertAlign"), "val", ["baseline", "superscript", "subscript"], "Invalid vertical alignment.", true); return value === undefined ? null : value === "superscript"; }
  set superscript(value: boolean | null) { this.baseline("superscript", value); }
  get subscript(): boolean | null { const value = storedFormattingToken(property(this.owner, "rPr", "vertAlign"), "val", ["baseline", "superscript", "subscript"], "Invalid vertical alignment.", true); return value === undefined ? null : value === "subscript"; }
  set subscript(value: boolean | null) { this.baseline("subscript", value); }
  private baseline(mode: "subscript" | "superscript", value: boolean | null): void {
    tri(value);
    update(this.owner, "r", { baseline: value === true ? mode : value === false ? "baseline" : null });
  }
}
for (const [name, [option, tag]] of Object.entries(fontFlags)) Object.defineProperty(Font.prototype, name, {
  get(this: Font) { return booleanValue(property(this.owner, "rPr", tag)); },
  set(this: Font, value: boolean | null) { tri(value); update(this.owner, "r", { [option]: value }); }, enumerable: true
});

const paragraphFlags = { keep_with_next: ["keepWithNext", "keepNext"], keep_together: ["keepTogether", "keepLines"], widow_control: ["widowControl", "widowControl"], page_break_before: ["pageBreakBefore", "pageBreakBefore"] } as const;
export class ParagraphFormat {
  declare keep_with_next: boolean | null;
  declare keep_together: boolean | null;
  declare widow_control: boolean | null;
  declare page_break_before: boolean | null;

  private tabs?: TabStops;
  constructor(readonly owner: FormattingXmlOwner) { void owner.identity; }
  get tab_stops(): TabStops { const view = readView(this.owner); if (!child(view.root, "pPr", view.children)) update(this.owner, "p", {}); return this.tabs ??= new TabStops(this.owner); }
  get part(): unknown { return this.owner.part ?? null; }
  equals(other: unknown): boolean { return other instanceof ParagraphFormat && (this.owner.identity ?? this.owner) === (other.owner.identity ?? other.owner); }
  get element(): XmlElementView { return ownerView(this.owner); }
  get alignment(): EnumMember<"WD_PARAGRAPH_ALIGNMENT"> | null {
    const node = property(this.owner, "pPr", "jc"), value = attr(node); if (!node) return null;
    if (value === undefined) throw new InvalidDocumentError("Missing stored paragraph alignment.");
    const normalized = value === "start" ? "left" : value === "end" ? "right" : value;
    const name = Object.keys(paragraphAlignments).find(key => paragraphAlignments[key as keyof typeof paragraphAlignments] === normalized) as keyof typeof paragraphAlignments | undefined;
    if (!name) throw new InvalidDocumentError("Invalid paragraph alignment."); return enumFamilies.WD_PARAGRAPH_ALIGNMENT[name];
  }
  set alignment(value: DocxEnumValue<"WD_PARAGRAPH_ALIGNMENT"> | null) { if (!validateDocxValue("WD_PARAGRAPH_ALIGNMENT | null", value)) throw new InputTypeError("Invalid paragraph alignment."); update(this.owner, "p", { alignment: value }); }
  get right_indent(): Length | null { const node = property(this.owner, "pPr", "ind"), value = attr(node, "end") ?? attr(node, "right"); return value === undefined ? null : storedMeasure(value); }
  set right_indent(value: DocxLength | null) { this.length("rightIndent", value); }
  get first_line_indent(): Length | null { const node = property(this.owner, "pPr", "ind"), hanging = attr(node, "hanging"), first = attr(node, "firstLine"); return hanging !== undefined ? Twips(-storedMeasure(hanging, "unsigned-twip").emu / 635) : first === undefined ? null : storedMeasure(first, "unsigned-twip"); }
  set first_line_indent(value: DocxLength | null) { this.length("firstLineIndent", value); }
  get space_before(): Length | null { const value = attr(property(this.owner, "pPr", "spacing"), "before"); return value === undefined ? null : storedMeasure(value, "unsigned-twip"); }
  set space_before(value: DocxLength | null) { this.length("spaceBefore", value); }
  get space_after(): Length | null { const value = attr(property(this.owner, "pPr", "spacing"), "after"); return value === undefined ? null : storedMeasure(value, "unsigned-twip"); }
  set space_after(value: DocxLength | null) { this.length("spaceAfter", value); }
  private length(option: "rightIndent" | "firstLineIndent" | "spaceBefore" | "spaceAfter", value: DocxLength | null): void { value = value === null ? null : plainLength(value); if (!validateDocxValue("Length | null", value)) throw new InputTypeError("Expected a length or null."); update(this.owner, "p", { [option]: value }); }
  get line_spacing(): Length | number | null { const node = property(this.owner, "pPr", "spacing"), value = attr(node, "line"), rule = storedFormattingToken(node, "lineRule", ["auto", "exact", "atLeast"], "Invalid line spacing rule."); return value === undefined ? null : ["exact", "atLeast"].includes(rule ?? "auto") ? storedMeasure(value) : storedMeasure(value).emu / 152400; }
  set line_spacing(value: DocxLength | number | null) { value = value !== null && typeof value === "object" ? plainLength(value) : value; if (!validateDocxValue("Length | finite number | null", value)) throw new InputTypeError("Invalid line spacing."); update(this.owner, "p", { lineSpacing: value, ...(value !== null && typeof value === "object" && this.line_spacing_rule?.name === "AT_LEAST" ? { lineSpacingRule: { enum: "WD_LINE_SPACING", name: "AT_LEAST" } as const } : {}) }); }
  get line_spacing_rule(): EnumMember<"WD_LINE_SPACING"> | null {
    const node = property(this.owner, "pPr", "spacing"), rule = storedFormattingToken(node, "lineRule", ["auto", "exact", "atLeast"], "Invalid line spacing rule."), line = attr(node, "line"); if (line === undefined && rule === undefined) return null;
    const emu = line === undefined ? undefined : storedMeasure(line).emu;
    const name = rule === "exact" ? "EXACTLY" : rule === "atLeast" ? "AT_LEAST" : emu === 152400 ? "SINGLE" : emu === 228600 ? "ONE_POINT_FIVE" : emu === 304800 ? "DOUBLE" : "MULTIPLE";
    return enumFamilies.WD_LINE_SPACING[name];
  }
  set line_spacing_rule(value: DocxEnumValue<"WD_LINE_SPACING"> | null) { if (!validateDocxValue("WD_LINE_SPACING | null", value)) throw new InputTypeError("Invalid line spacing rule."); update(this.owner, "p", { lineSpacingRule: value }); }
  get left_indent(): Length | null { const ind = property(this.owner, "pPr", "ind"); const value = attr(ind, "start") ?? attr(ind, "left"); return value === undefined ? null : storedMeasure(value); }
  set left_indent(value: DocxLength | null) { value = value === null ? null : plainLength(value); if (value !== null && !validateDocxValue("Length", value)) throw new InputTypeError("Expected a length or null."); update(this.owner, "p", { leftIndent: value as DocxOperationArguments<"paragraphs.set">["leftIndent"] }); }
}
for (const [name, [option, tag]] of Object.entries(paragraphFlags)) Object.defineProperty(ParagraphFormat.prototype, name, {
  get(this: ParagraphFormat) { return booleanValue(property(this.owner, "pPr", tag)); },
  set(this: ParagraphFormat, value: boolean | null) { tri(value); update(this.owner, "p", { [option]: value }); }, enumerable: true
});
const alignments = { left: "LEFT", start: "START", center: "CENTER", right: "RIGHT", end: "END", decimal: "DECIMAL", bar: "BAR", list: "LIST", clear: "CLEAR", num: "NUM" } as const;
const leaders = { none: "SPACES", dot: "DOTS", hyphen: "DASHES", underscore: "LINES", heavy: "HEAVY", middleDot: "MIDDLE_DOT" } as const;
interface StopRecord { id: number; value: DocxTabStop }
const tabCollections = new WeakMap<object, TabStops>();
export class TabStops implements Iterable<TabStop> {
  readonly [index: number]: TabStop;
  private snapshot = "";
  private readRoot: XmlElement | undefined;
  private tabSnapshot = "";
  private records: StopRecord[] = [];
  private retainXmlIds = false;
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
  get element(): XmlElementView { return ownerView(this.owner, "tabs", (xml, root) => child(root, "pPr", readView(this.owner, xml, root).children) ?? root); }
  get part(): unknown { return this.owner.part ?? null; }
  equals(other: unknown): boolean { return other instanceof TabStops && (this.owner.identity ?? this.owner) === (other.owner.identity ?? other.owner); }
  elementFor(id: number, xml?: DocumentXmlEditor, ownerRoot?: XmlElement): XmlElement {
    if (!xml || !this.retainXmlIds) this.refresh();
    const index = this.records.findIndex(record => record.id === id);
    if (index < 0) throw new StaleHandleError("Tab stop handle is no longer valid.");
    const view = readView(this.owner, xml, ownerRoot), root = child(view.root, "pPr", view.children) ?? view.root;
    const tabs = child(root, "tabs", view.children);
    const node = tabs && view.children(tabs).filter(node => node.namespace === root.namespace && node.localName === "tab")[index];
    if (!node) throw new StaleHandleError("Tab stop handle is no longer valid.");
    return node;
  }

  private refresh(): void {
    const source = this.owner.getXml(), view = readView(this.owner);
    if (source === this.snapshot && view.root === this.readRoot) return;
    this.readRoot = view.root;
    const { xml, root, children } = view, props = child(root, "pPr", children), tabs = props && child(props, "tabs", children);
    const tabXml = tabs ? xml.sourceXml(tabs) : "";
    if (tabXml === this.tabSnapshot) { this.snapshot = source; return; }
    const nodes = tabs ? children(tabs).filter(c => c.namespace === root.namespace && c.localName === "tab") : [];
    const retained = this.retainXmlIds && nodes.length === this.records.length ? this.records : undefined;
    this.records = nodes.map((node, index) => {
      const position = storedMeasure(attr(node, "pos") ?? "", "twip", "Invalid tab stop properties.").emu / 635;
      const alignment = alignments[attr(node)! as keyof typeof alignments], leader = leaders[(attr(node, "leader") ?? "none") as keyof typeof leaders];
      if (!alignment || !leader) throw new InvalidDocumentError("Invalid tab stop properties.");
      return { id: retained?.[index]?.id ?? this.nextId++, value: { position: { value: position, unit: "twip" }, alignment: { enum: "WD_TAB_ALIGNMENT", name: alignment }, leader: { enum: "WD_TAB_LEADER", name: leader } } };
    });
    this.retainXmlIds = false;
    this.tabSnapshot = tabXml;
    this.snapshot = source;
  }
  private remember(): void {
    this.snapshot = this.owner.getXml(); const view = readView(this.owner), props = child(view.root, "pPr", view.children), tabs = props && child(props, "tabs", view.children);
    this.readRoot = view.root; this.tabSnapshot = tabs ? view.xml.sourceXml(tabs) : "";
  }
  xmlChanged(): void { this.retainXmlIds = true; }
  removeXml(id: number): void {
    this.refresh();
    const index = this.records.findIndex(record => record.id === id);
    if (index < 0) throw new StaleHandleError("Tab stop handle is no longer valid.");
    const binding = formattingXmlOwners.get(this.owner);
    if (binding) binding.change(xml => xml.replaceElement(this.elementFor(id, xml, binding.resolve(xml)), ""));
    else {
      const xml = editor(this.owner);
      xml.replaceElement(this.elementFor(id, xml, xml.root), "");
      this.owner.setXml(new TextDecoder().decode(xml.serialize()));
    }
    this.records.splice(index, 1);
    this.remember();
  }
  get length(): number { this.refresh(); return this.records.length; }
  at(index: number): TabStop { this.refresh(); const record = this.records[this.index(index)]; return new TabStop(this, record!.id); }
  private index(index: number): number { if (!Number.isSafeInteger(index)) throw new InputTypeError("Expected an integer tab index."); const resolved = index < 0 ? this.records.length + index : index; if (resolved < 0 || resolved >= this.records.length) throw new BoundsError("Tab stop index is out of range."); return resolved; }
  *[Symbol.iterator](): IterableIterator<TabStop> { this.refresh(); for (const record of [...this.records]) yield new TabStop(this, record.id); }
  add_tab_stop(position: DocxLength, alignment: DocxEnumValue<"WD_TAB_ALIGNMENT"> = { enum: "WD_TAB_ALIGNMENT", name: "LEFT" }, leader: DocxEnumValue<"WD_TAB_LEADER"> = { enum: "WD_TAB_LEADER", name: "SPACES" }): TabStop {
    this.refresh(); const value = { position: plainLength(position), alignment, leader };
    if (!validateDocxValue("{position: Length; alignment?: WD_TAB_ALIGNMENT; leader?: WD_TAB_LEADER}", value)) throw new InputTypeError("Expected valid tab stop properties.");
    const nativeAlignment = tabAlignmentXml(readView(this.owner).root.namespace, alignment.name);
    update(this.owner, "p", { tabStopAdd: value });
    const record = { id: this.nextId++, value: { ...value, alignment: { enum: "WD_TAB_ALIGNMENT" as const, name: alignments[nativeAlignment as keyof typeof alignments] }, position: { value: paragraphUnits(position), unit: "twip" as const } } };
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
    if (!validateDocxValue("{position: Length; alignment?: WD_TAB_ALIGNMENT; leader?: WD_TAB_LEADER}", value)) throw new InputTypeError("Expected valid tab stop properties.");
    const nativeAlignment = patch.alignment === undefined ? undefined : tabAlignmentXml(readView(this.owner).root.namespace, patch.alignment.name);
    const binding = formattingXmlOwners.get(this.owner);
    const apply = (xml: DocumentXmlEditor, root: XmlElement) => {
      const children = activeXmlChildren(xml, ownerBudget(this.owner)), props = child(root, "pPr", children), tabs = props && child(props, "tabs", children);
      const stops = tabs ? children(tabs).filter(node => node.namespace === tabs.namespace && node.localName === "tab") : [], node = stops[index];
      if (!tabs || !node || !xml.compatibility.canEdit(node)) throw new UnsupportedEditError("The tab stop is inside preserved compatibility content.");
      const values: Record<string, string | null> = {};
      if (patch.position !== undefined) values.pos = String(paragraphUnits(value.position));
      if (nativeAlignment !== undefined) values.val = nativeAlignment;
      if (patch.leader !== undefined) values.leader = value.leader!.name === "SPACES" ? null : Object.keys(leaders).find(key => leaders[key as keyof typeof leaders] === value.leader!.name)!;
      let prefix = [...node.namespaces].find(([name, namespace]) => name && namespace === node.namespace)?.[0] ?? "tf";
      while (node.namespaces.has(prefix) && node.namespaces.get(prefix) !== node.namespace) prefix += "f";
      const attributes = [...node.attributes.filter(attribute => attribute.namespace !== node.namespace || !Object.hasOwn(values, attribute.localName)), ...Object.entries(values).filter(([, text]) => text !== null).map(([name, text]) => ({name: prefix + ":" + name, localName: name, namespace: node.namespace, value: text!}))];
      const changed = runElementOpen({...node, namespaces: new Map([...node.namespaces, [prefix, node.namespace]]), attributes}) + xml.sourceXml(node, new Map(), true) + `</${node.name}>`;
      if (patch.position === undefined) xml.replaceElement(node, changed);
      else {
        const next = stops.find((stop, offset) => offset !== index && storedMeasure(attr(stop, "pos") ?? "").emu > paragraphUnits(value.position) * 635);
        const changes = new Map<XmlElement, string>([[node, ""]]);
        if (next) changes.set(next, changed + xml.sourceXml(next));
        xml[replaceNativeTabCollectionXml](tabs, runElementOpen(tabs) + xml.sourceXml(tabs, changes, true) + (next ? "" : changed) + `</${tabs.name}>`, tabs, changed, paragraphUnits(value.position), node);
      }
    };
    if (binding) binding.change(xml => apply(xml, binding.resolve(xml)));
    else {
      const xml = editor(this.owner); apply(xml, xml.root); this.owner.setXml(new TextDecoder().decode(xml.serialize()));
    }
        const record = { id, value: { ...value, ...(nativeAlignment === undefined ? {} : {alignment: { enum: "WD_TAB_ALIGNMENT" as const, name: alignments[nativeAlignment as keyof typeof alignments] }}), position: { value: paragraphUnits(value.position), unit: "twip" as const } } };
    if (patch.position !== undefined) { this.records.splice(index, 1); this.records.push(record); this.records.sort((a, b) => a.value.position.value - b.value.position.value); }
    else this.records[index] = record;
    this.remember();
  }
}
Object.defineProperty(TabStops.prototype, "delete", { value: TabStops.prototype.remove });
export class TabStop {
  constructor(private readonly collection: TabStops, private readonly id: number) {}
  get element(): XmlElementView {
    void this.collection.value(this.id);
    return ownerView(this.collection.owner, `tab:${this.id}`, (xml, root) => this.collection.elementFor(this.id, xml, root), () => this.collection.xmlChanged(), () => this.collection.removeXml(this.id));
  }
  get part(): unknown { this.collection.value(this.id); return this.collection.part; }
  equals(other: unknown): boolean { this.collection.value(this.id); if (!(other instanceof TabStop)) return false; other.collection.value(other.id); return this.collection.equals(other.collection) && this.id === other.id; }
  get position(): Length { return Twips(paragraphUnits(this.collection.value(this.id).position, 1) / 635); }
  set position(value: DocxLength) {
    if (value === undefined) throw new InputTypeError("Expected a tab position length.");
    this.collection.change(this.id, { position: value });
  }
  get alignment(): EnumMember<"WD_TAB_ALIGNMENT"> { return enumFamilies.WD_TAB_ALIGNMENT[this.collection.value(this.id).alignment!.name]; }
  set alignment(value: DocxEnumValue<"WD_TAB_ALIGNMENT">) {
    if (value === undefined) throw new InputTypeError("Expected a tab alignment.");
    this.collection.change(this.id, { alignment: value });
  }
  get leader(): EnumMember<"WD_TAB_LEADER"> { return enumFamilies.WD_TAB_LEADER[this.collection.value(this.id).leader!.name]; }
  set leader(value: DocxEnumValue<"WD_TAB_LEADER"> | null) {
    if (value === undefined) throw new InputTypeError("Expected a tab leader or explicit null reset.");
    this.collection.change(this.id, { leader: value ?? { enum: "WD_TAB_LEADER", name: "SPACES" } });
  }
}

function assertRgbSearchValue(value: unknown): asserts value is number {
  if (typeof value !== "number" || !Number.isFinite(value)) throw new InputTypeError("Expected a finite numeric color search value.");
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
  toArray(): readonly [number, number, number] { return snapshotSequence(this.values) as readonly [number, number, number]; }
  slice(start = 0, end = 3): readonly number[] { if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end)) throw new InputTypeError("Expected integer slice bounds."); return snapshotSequence(this.values.slice(start, end)); }
  count(value: number): number { assertRgbSearchValue(value); return this.values.filter(item => item === value).length; }
  index(value: number, start = 0, stop = 3): number {
    assertRgbSearchValue(value);
    if (!Number.isSafeInteger(start) || !Number.isSafeInteger(stop)) throw new InputTypeError("Expected integer component bounds.");
    const first = Math.min(3, Math.max(0, start < 0 ? 3 + start : start)), end = Math.min(3, Math.max(0, stop < 0 ? 3 + stop : stop));
    for (let index = first; index < end; index++) if (this.values[index] === value) return index;
    throw new InvalidValueError("Color component was not found.");
  }
  includes(value: number): boolean { assertRgbSearchValue(value); return this.values.includes(value); }
  *reversed(): IterableIterator<number> { for (let index = this.values.length - 1; index >= 0; index--) yield this.values[index]!; }
  equals(other: unknown): boolean { return other instanceof RGBColor && this.values.every((value, index) => value === other.values[index]); }
}
export class ColorFormat {
  constructor(readonly owner: FormattingXmlOwner) {}
  get part(): unknown { return this.owner.part ?? null; }
  equals(other: unknown): boolean { return other instanceof ColorFormat && (this.owner.identity ?? this.owner) === (other.owner.identity ?? other.owner); }
  get element(): XmlElementView { return ownerView(this.owner); }
  get rgb(): RGBColor | null { const value = attr(property(this.owner, "rPr", "color")); if (value === undefined || value === "auto") return null; if (!validateDocxValue("RGBColor", value)) throw new InvalidDocumentError("Invalid stored RGB color."); return RGBColor.from_string(value); }
  set rgb(value: RGBColor | null) { if (value !== null && !(value instanceof RGBColor)) throw new InputTypeError("Expected RGBColor or null."); if (value === null && !property(this.owner, "rPr", "color")) return; update(this.owner, "r", { color: value === null ? null : value.toString() }); }
  get theme_color(): EnumMember<"MSO_THEME_COLOR"> | null {
    const value = attr(property(this.owner, "rPr", "color"), "themeColor"); if (value === undefined) return null;
    const name = Object.keys(themes).find(key => themes[key as keyof typeof themes] === value) as keyof typeof themes | undefined;
    if (!name) throw new InvalidDocumentError("Invalid theme color."); return enumFamilies.MSO_THEME_COLOR[name];
  }
  set theme_color(value: DocxEnumValue<"MSO_THEME_COLOR"> | null) { if (!validateDocxValue("MSO_THEME_COLOR | null", value) || value !== null && !Object.hasOwn(themes, value.name)) throw new InputTypeError("Invalid theme color."); if (value === null && !property(this.owner, "rPr", "color")) return; if (value !== null && !property(this.owner, "rPr", "color")) {
      update(this.owner, "r", { color: "000000", themeColor: value });
    } else update(this.owner, "r", value === null ? { color: null } : { themeColor: value }); }
  get type(): EnumMember<"MSO_COLOR_TYPE"> | null { const node = property(this.owner, "rPr", "color"); return node === undefined ? null : enumFamilies.MSO_COLOR_TYPE[attr(node, "themeColor") !== undefined ? "THEME" : attr(node) === "auto" ? "AUTO" : "RGB"]; }
}

import { MissingKeyError, StaleHandleError } from "./model-errors.js";
import { archiveSettings, type ArchiveContext, type DocumentArchive } from "./archive.js";
import { readDocumentArchive } from "./admission.js";
import type { ArchiveSink } from "./archive-write.js";
import { createDocumentArchive } from "./create.js";
import { documentDialects } from "./dialect.js";
import { runElementOpen } from "./run-properties.js";
import { xmlValue } from "./create-content.js";
import { Font, ParagraphFormat, type FormattingXmlOwner } from "./formatting-model.js";
import { styleAttribute as attr, styleChild as child, styleToggle, styleInteger, mergeStyleChildren } from "./style-properties.js";
import { styleDisplayName, styleStoredName } from "./style-names.js";
import { addDocumentStylesPart } from "./styles-part.js";
import { editLatentStyles, readLatentStyles } from "./latent-styles.js";
import type { DocxEnumValue } from "./operation-types.js";
import type { XmlElement } from "./package-xml.js";
import { DocumentXmlEditor } from "./xml-write.js";
import { assertDocumentEditable, publishDocumentArchive, type PublicationOptions, type PublicationContext } from "./publication.js";

import { WD_STYLE_TYPE } from "./formatting-values.js";
export { WD_STYLE_TYPE } from "./formatting-values.js";
const types = { PARAGRAPH: "paragraph", CHARACTER: "character", TABLE: "table", LIST: "numbering" };
function typeName(type: DocxEnumValue<"WD_STYLE_TYPE">): string {
  if (!type || type.enum !== "WD_STYLE_TYPE" || !Object.hasOwn(types, type.name)) throw new TypeError("Expected a style type.");
  return types[type.name];
}
const order = "name aliases basedOn next link autoRedefine hidden uiPriority semiHidden unhideWhenUsed qFormat locked personal personalCompose personalReply rsid pPr rPr tblPr trPr tcPr tblStylePr".split(" ");
function tri(value: unknown): asserts value is boolean | null { if (value !== null && typeof value !== "boolean") throw new TypeError("Expected true, false or null."); }
function nullableInteger(value: unknown): asserts value is number | null { if (value !== null && (!Number.isSafeInteger(value) || (value as number) < 0)) throw new RangeError("Expected a nonnegative safe integer or null."); }

class StyleStore {
  revision = 0;
  readonly tokens: number[];
  readonly latentTokens: number[];
  nextLatentToken: number;
  private nextToken: number;
  private cachedEditor: DocumentXmlEditor | undefined;
  readonly warnings: { readonly code: string }[] = [];
  readonly part: StylePartView;
  private readonly identities = new Map<string, object>();
  identity(token: number, kind: string): object { const key = `${token}:${kind}`; let id = this.identities.get(key); if (!id) { id = Object.freeze({}); this.identities.set(key, id); } return id; }
  constructor(public source: string, readonly context: ArchiveContext, readonly writable: () => void, partname: string) {
    this.part = new StylePartView(this, partname);
    this.tokens = this.nodes(this.editor()).map((_, i) => i);
    this.nextToken = this.tokens.length;
    this.latentTokens = (readLatentStyles(this.editor().root)?.entries ?? []).map((_, index) => index);
    this.nextLatentToken = this.latentTokens.length;
  }
  editor(): DocumentXmlEditor { if (!this.cachedEditor) { const settings = archiveSettings(this.context); this.cachedEditor = new DocumentXmlEditor(new TextEncoder().encode(this.source), {}, undefined, settings.budget); } return this.cachedEditor; }
  nodes(xml: DocumentXmlEditor): XmlElement[] { return xml.root.children.filter(n => n.namespace === xml.root.namespace && n.localName === "style"); }
  node(xml: DocumentXmlEditor, token: number): XmlElement {
    const index = this.tokens.indexOf(token), node = this.nodes(xml)[index];
    if (!node) throw new StaleHandleError("The style handle is no longer valid.");
    return node;
  }
  change(action: (xml: DocumentXmlEditor) => void): void {
    this.writable();
    const xml = this.editor(); try {
      action(xml);
      const source = new TextDecoder().decode(xml.serialize());
      if (source !== this.source) this.revision++;
      this.source = source;
    } finally { this.cachedEditor = undefined; }
  }
  add(markup: string): number {
    this.change(xml => xml.insertChildren(xml.root, markup));
    const token = this.nextToken++; this.tokens.push(token); return token;
  }
  remove(token: number): void {
    this.change(xml => xml.replaceElement(this.node(xml, token), ""));
    this.tokens.splice(this.tokens.indexOf(token), 1);
  }
}

/** Internal mutation state for batch accounting; not part of the public barrel. */
export const styleModelMutations = new WeakMap<Styles, { readonly revision: number }>();

/** Read-only part metadata with owned byte snapshots; edits use the live model. */
export class StylePartView {
  readonly content_type = "application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml";
  constructor(private readonly store: StyleStore, readonly partname: string) { Object.freeze(this); }
  get blob(): Uint8Array { return new TextEncoder().encode(this.store.source); }
  get element(): XmlElement { return this.store.editor().root; }
}

export class Styles implements Iterable<BaseStyle> {
  constructor(private readonly store: StyleStore) {}
  get element(): XmlElement { return this.store.editor().root; }
  get part(): StylePartView { return this.store.part; }
  equals(other: unknown): boolean { return other instanceof Styles && other.store === this.store; }
  get length(): number { return this.store.tokens.length; }
  *[Symbol.iterator](): Iterator<BaseStyle> { for (const token of [...this.store.tokens]) yield this.wrap(token); }
  private wrap(token: number): BaseStyle {
    const xml = this.store.editor(), kind = attr(this.store.node(xml, token), "type");
    return kind === "table" ? new TableStyle(this.store, token, this) : kind === "paragraph" ? new ParagraphStyle(this.store, token, this) : kind === "character" ? new CharacterStyle(this.store, token, this) : new BaseStyle(this.store, token, this);
  }
  has(name: string): boolean {
    if (typeof name !== "string") throw new TypeError("Styles are keyed by name.");
    return [...this].some(style => style.name !== null && styleStoredName(style.name) === styleStoredName(name));
  }
  at(name: string): BaseStyle {
    if (typeof name !== "string") throw new TypeError("Styles are keyed by name.");
    const matches = [...this].filter(style => style.name !== null && styleStoredName(style.name) === styleStoredName(name));
    if (matches.length === 1) return matches[0]!;
    if (matches.length > 1) throw new RangeError("Style name is ambiguous.");
    const byId = [...this].find(style => style.style_id === name);
    if (!byId) throw new MissingKeyError("Style name was not found.");
    this.store.warnings.push({ code: "deprecated-style-id-lookup" });
    return byId;
  }
  add_style(name: string, style_type: typeof WD_STYLE_TYPE.PARAGRAPH, builtin?: boolean): ParagraphStyle;
  add_style(name: string, style_type: typeof WD_STYLE_TYPE.TABLE, builtin?: boolean): TableStyle;
  add_style(name: string, style_type: typeof WD_STYLE_TYPE.CHARACTER, builtin?: boolean): CharacterStyle;
  add_style(name: string, style_type: DocxEnumValue<"WD_STYLE_TYPE">, builtin?: boolean): BaseStyle;
  add_style(name: string, style_type: DocxEnumValue<"WD_STYLE_TYPE">, builtin = false): BaseStyle {
    if (typeof name !== "string" || !name.length || typeof builtin !== "boolean") throw new TypeError("Expected a style name and builtin flag.");
    const type = typeName(style_type);
    if (this.has(name)) throw new RangeError("The style name already exists.");
    const ids = new Set([...this].map(s => s.style_id));
    let serial = 1; while (ids.has(`Style${serial}`)) serial++;
    const namespace = this.element.namespace;
    return this.wrap(this.store.add(`<st:style xmlns:st="${namespace}" st:type="${type}" st:styleId="Style${serial}"${builtin ? "" : ' st:customStyle="1"'}><st:name st:val="${xmlValue(styleStoredName(name))}"/></st:style>`));
  }
  default(style_type: DocxEnumValue<"WD_STYLE_TYPE">): BaseStyle | null {
    const type = typeName(style_type);
    return [...this].filter(s => attr(s.element, "type") === type && ["1", "true", "on"].includes(attr(s.element, "default") ?? "0")).at(-1) ?? null;
  }
  get_by_id(style_id: string | null, style_type: DocxEnumValue<"WD_STYLE_TYPE">): BaseStyle | null {
    if (style_id !== null && typeof style_id !== "string") throw new TypeError("Expected a style ID or null.");
    const type = typeName(style_type);
    if (style_id === null || style_id === "") return this.default(style_type);
    return [...this].find(s => s.style_id === style_id && attr(s.element, "type") === type) ?? this.default(style_type);
  }
  get_style_id(style_or_name: BaseStyle | string | null, style_type: DocxEnumValue<"WD_STYLE_TYPE">): string | null {
    typeName(style_type);
    if (style_or_name === null) return null;
    const style = typeof style_or_name === "string" ? this.at(style_or_name) : style_or_name;
    if (!(style instanceof BaseStyle) || style.collection !== this || style.type.name !== style_type.name) throw new TypeError("Expected an owned style of the requested type.");
    return style.style_id === this.default(style_type)?.style_id ? null : style.style_id;
  }
  get latent_styles(): LatentStyles {
    if (!child(this.element, "latentStyles")) this.store.change(xml => xml.insertChildren(xml.root, `<st:latentStyles xmlns:st="${xml.root.namespace}"/>`, this.store.nodes(xml)[0]));
    return new LatentStyles(this.store);
  }
}

export class BaseStyle {
  constructor(protected readonly store: StyleStore, protected readonly token: number, readonly collection: Styles) {}
  get element(): XmlElement { const xml = this.store.editor(); return this.store.node(xml, this.token); }
  get part(): StylePartView { void this.element; return this.store.part; }
  equals(other: unknown): boolean { void this.element; return other instanceof BaseStyle && other.store === this.store && other.token === this.token; }
  protected setValue(tag: string, value: string | null): void {
    this.store.change(xml => { const node = this.store.node(xml, this.token); xml.replaceElement(node, mergeStyleChildren(xml, node, new Map([[tag, value === null ? "" : `<st:${tag} xmlns:st="${node.namespace}" st:val="${xmlValue(value)}"/>`]]), order)); });
  }
  protected setAttribute(name: string, value: string | null): void {
    this.store.change(xml => { const node = this.store.node(xml, this.token); xml.replaceElement(node, mergeStyleChildren(xml, node, new Map(), order, { [name]: value })); });
  }
  get name(): string | null { const value = attr(child(this.element, "name"), "val"); return value === undefined ? null : styleDisplayName(value); }
  set name(value: string | null) { if (value !== null && typeof value !== "string") throw new TypeError("Expected a style name or null."); this.setValue("name", value); }
  get style_id(): string | null { return attr(this.element, "styleId") ?? null; }
  set style_id(value: string | null) { if (value !== null && typeof value !== "string") throw new TypeError("Expected a style ID or null."); this.setAttribute("styleId", value); }
  get type(): DocxEnumValue<"WD_STYLE_TYPE"> {
    const type = attr(this.element, "type") ?? "paragraph";
    const key = (Object.keys(types) as (keyof typeof types)[]).find(k => types[k] === type);
    if (!key) throw new TypeError("Unknown style type.");
    return WD_STYLE_TYPE[key];
  }
  get builtin(): boolean { return !["1", "true", "on"].includes(attr(this.element, "customStyle") ?? "0"); }
  get priority(): number | null { return styleInteger(attr(child(this.element, "uiPriority"), "val")); }
  set priority(value: number | null) { nullableInteger(value); this.setValue("uiPriority", value === null ? null : String(value)); }
  get hidden(): boolean { return this.flag("semiHidden"); }
  set hidden(value: boolean | null) { tri(value); this.setValue("semiHidden", value ? "1" : null); }
  get locked(): boolean { return this.flag("locked"); }
  set locked(value: boolean | null) { tri(value); this.setValue("locked", value ? "1" : null); }
  get quick_style(): boolean { return this.flag("qFormat"); }
  set quick_style(value: boolean | null) { tri(value); this.setValue("qFormat", value ? "1" : null); }
  get unhide_when_used(): boolean { return this.flag("unhideWhenUsed"); }
  set unhide_when_used(value: boolean | null) { tri(value); this.setValue("unhideWhenUsed", value ? "1" : null); }
  private flag(tag: string): boolean { return styleToggle(child(this.element, tag)) ?? false; }
  delete(): void { this.store.remove(this.token); }
}

export class CharacterStyle extends BaseStyle {
  protected formattingOwner(kind: "r" | "p"): FormattingXmlOwner {
    const { store, token } = this;
    return { get part() {
      store.node(store.editor(), token);
      return store.part;
    }, get identity() {
      store.node(store.editor(), token);
      return store.identity(token, kind);
    }, getXml: () => {
      const xml = this.store.editor(), node = this.store.node(xml, this.token), props = child(node, kind + "Pr");
      return `<st:${kind} xmlns:st="${node.namespace}">${props ? runElementOpen(props) + xml.sourceXml(props, new Map(), true) + `</${props.name}>` : ""}</st:${kind}>`;
    }, setXml: source => {
      const fragment = new DocumentXmlEditor(new TextEncoder().encode(source));
      const props = child(fragment.root, kind + "Pr");
      this.store.change(xml => { const node = this.store.node(xml, this.token); xml.replaceElement(node, mergeStyleChildren(xml, node, new Map([[kind + "Pr", props ? runElementOpen(props) + fragment.sourceXml(props, new Map(), true) + `</${props.name}>` : ""]]), order)); });
    } };
  }
  get font(): Font { return new Font(this.formattingOwner("r")); }
  get base_style(): BaseStyle | null { const id = attr(child(this.element, "basedOn"), "val"); return id === undefined ? null : [...this.collection].find(s => s.style_id === id) ?? null; }
  set base_style(value: BaseStyle | null) {
    if (value !== null && (!(value instanceof BaseStyle) || value.collection !== this.collection || value.type.name !== this.type.name)) throw new TypeError("Expected a base style from this document of the same type.");
    const visited = new Set<string | null>();
    let next = value;
    while (next) {
      if (next.style_id === this.style_id || visited.has(next.style_id)) throw new RangeError("A style base cannot form a cycle.");
      visited.add(next.style_id); next = next instanceof CharacterStyle ? next.base_style : null;
    }
    this.setValue("basedOn", value?.style_id ?? null);
  }
}
export class ParagraphStyle extends CharacterStyle {
  get paragraph_format(): ParagraphFormat { return new ParagraphFormat(this.formattingOwner("p")); }
  get next_paragraph_style(): BaseStyle {
    const id = attr(child(this.element, "next"), "val");
    return [...this.collection].find(s => s.style_id === id && s.type.name === "PARAGRAPH") ?? this;
  }
  set next_paragraph_style(value: BaseStyle | null) {
    if (value !== null && (!(value instanceof BaseStyle) || value.collection !== this.collection || value.type.name !== "PARAGRAPH")) throw new TypeError("Expected an owned paragraph style.");
    this.setValue("next", value?.style_id === this.style_id ? null : value?.style_id ?? null);
  }
}
export class TableStyle extends ParagraphStyle {}
export { TableStyle as _TableStyle, BaseStyle as _NumberingStyle };

export class LatentStyles implements Iterable<LatentStyle> {
  constructor(private readonly store: StyleStore) {}
  get element(): XmlElement { const node = child(this.store.editor().root, "latentStyles"); if (!node) throw new RangeError("Latent styles are no longer available."); return node; }
  get part(): StylePartView { return this.store.part; }
  equals(other: unknown): boolean { return other instanceof LatentStyles && other.store === this.store; }
  private info() { return readLatentStyles(this.store.editor().root)!; }
  get length(): number { return this.info().entries.length; }
  *[Symbol.iterator](): Iterator<LatentStyle> { for (const token of [...this.store.latentTokens]) yield new LatentStyle(this, token); }
  has(name: string): boolean { if (typeof name !== "string") throw new TypeError("Latent styles are keyed by name."); return this.info().entries.some(s => styleStoredName(s.name) === styleStoredName(name)); }
  at(name: string): LatentStyle {
    if (typeof name !== "string") throw new TypeError("Latent styles are keyed by name.");
    const index = this.info().entries.findIndex(entry => styleStoredName(entry.name) === styleStoredName(name));
    if (index < 0) throw new MissingKeyError("Latent style name was not found.");
    return new LatentStyle(this, this.store.latentTokens[index]!);
  }
  add_latent_style(name: string): LatentStyle {
    if (typeof name !== "string" || !name.length) throw new TypeError("Expected a latent style name.");
    this.store.change(xml => { const node = child(xml.root, "latentStyles")!; xml.insertChildren(node, `<st:lsdException xmlns:st="${node.namespace}" st:name="${xmlValue(styleStoredName(name))}"/>`); });
    const token = this.store.nextLatentToken++; this.store.latentTokens.push(token);
    return new LatentStyle(this, token);
  }
  entry(token: number) {
    const index = this.store.latentTokens.indexOf(token), entry = this.info().entries[index];
    if (!entry) throw new StaleHandleError("The latent style handle is no longer valid.");
    return entry;
  }
  node(token: number, xml = this.store.editor()): XmlElement {
    const index = this.store.latentTokens.indexOf(token), node = child(xml.root, "latentStyles")?.children.filter(n => n.namespace === xml.root.namespace && n.localName === "lsdException")[index];
    if (!node) throw new StaleHandleError("The latent style handle is no longer valid.");
    return node;
  }
  change(token: number, key: string, value: boolean | number | null): void {
    const names: Record<string, string> = { hidden: "semiHidden", locked: "locked", quickStyle: "qFormat", unhideWhenUsed: "unhideWhenUsed", priority: "uiPriority" };
    this.store.change(xml => { const node = this.node(token, xml); xml.replaceElement(node, mergeStyleChildren(xml, node, new Map(), [], { [names[key]!]: value === null ? null : typeof value === "boolean" ? String(Number(value)) : String(value) })); });
  }
  remove(token: number): void {
    this.store.change(xml => { xml.replaceElement(this.node(token, xml), ""); });
    this.store.latentTokens.splice(this.store.latentTokens.indexOf(token), 1);
  }
  private setDefault(key: string, value: boolean | number | null): void { this.store.change(xml => { editLatentStyles(xml, "styles.latent.defaults.set", { [key]: value }); }); }
  get default_to_hidden(): boolean { return this.info().defaults.defaultToHidden; }
  set default_to_hidden(value: boolean) { if (typeof value !== "boolean") throw new TypeError("Expected a boolean."); this.setDefault("defaultToHidden", value); }
  get default_to_locked(): boolean { return this.info().defaults.defaultToLocked; }
  set default_to_locked(value: boolean) { if (typeof value !== "boolean") throw new TypeError("Expected a boolean."); this.setDefault("defaultToLocked", value); }
  get default_to_quick_style(): boolean { return this.info().defaults.defaultToQuickStyle; }
  set default_to_quick_style(value: boolean) { if (typeof value !== "boolean") throw new TypeError("Expected a boolean."); this.setDefault("defaultToQuickStyle", value); }
  get default_to_unhide_when_used(): boolean { return this.info().defaults.defaultToUnhideWhenUsed; }
  set default_to_unhide_when_used(value: boolean) { if (typeof value !== "boolean") throw new TypeError("Expected a boolean."); this.setDefault("defaultToUnhideWhenUsed", value); }
  get default_priority(): number | null { return this.info().defaults.defaultPriority; }
  set default_priority(value: number | null) { nullableInteger(value); this.setDefault("defaultPriority", value); }
  get load_count(): number | null { return this.info().defaults.loadCount; }
  set load_count(value: number | null) { nullableInteger(value); this.setDefault("loadCount", value); }
}
export class LatentStyle {
  constructor(private readonly collection: LatentStyles, private readonly token: number) {}
  get name(): string { return this.collection.entry(this.token).name; }
  get part(): StylePartView { void this.name; return this.collection.part; }
  get element(): XmlElement { return this.collection.node(this.token); }
  equals(other: unknown): boolean { void this.name; return other instanceof LatentStyle && this.collection.equals(other.collection) && this.token === other.token; }
  get priority(): number | null { return this.collection.entry(this.token).priority; }
  set priority(value: number | null) { nullableInteger(value); this.collection.change(this.token, "priority", value); }
  get hidden(): boolean | null { return this.collection.entry(this.token).hidden; }
  set hidden(value: boolean | null) { tri(value); this.collection.change(this.token, "hidden", value); }
  get locked(): boolean | null { return this.collection.entry(this.token).locked; }
  set locked(value: boolean | null) { tri(value); this.collection.change(this.token, "locked", value); }
  get quick_style(): boolean | null { return this.collection.entry(this.token).quickStyle; }
  set quick_style(value: boolean | null) { tri(value); this.collection.change(this.token, "quickStyle", value); }
  get unhide_when_used(): boolean | null { return this.collection.entry(this.token).unhideWhenUsed; }
  set unhide_when_used(value: boolean | null) { tri(value); this.collection.change(this.token, "unhideWhenUsed", value); }
  delete(): void { this.collection.remove(this.token); }
}

export { LatentStyle as _LatentStyle };

/** Async admission with synchronous live styles and explicit validated publication. */
export async function openDocumentStyleModel(input: Uint8Array | undefined, context: ArchiveContext) {
  const settings = archiveSettings(context);
  const admitted = input === undefined ? await createDocumentArchive({}, settings) : await readDocumentArchive(input, settings);
  const edges = admitted.package.relationships("/" + admitted.mainPart).filter(e => e.reltype === `${documentDialects[admitted.dialect].r}/styles`);
  if (edges.length > 1 || edges[0]?.is_external) throw new RangeError("Expected one internal styles part.");
  let archive: DocumentArchive = admitted;
  let part = edges[0]?.target_part.name;
  const createdStylesPart = part === undefined;
  if (!part) { const result = addDocumentStylesPart(admitted, admitted, "", settings.budget); archive = result.archive; part = result.name; }
  const stylesPart = part;
  const store = new StyleStore(new TextDecoder().decode(archive.members.find(m => m.name === stylesPart)!.bytes), settings, () => assertDocumentEditable(admitted, settings), "/" + stylesPart);
  store.revision = createdStylesPart ? 1 : 0;
  const styles = new Styles(store);
  styleModelMutations.set(styles, store);
  const snapshot = (): DocumentArchive => ({ ...archive, members: archive.members.map(m => m.name === stylesPart ? { ...m, bytes: new TextEncoder().encode(store.source) } : m) });
  return { styles, get warnings(): readonly { readonly code: string }[] { return store.warnings.slice(); }, async save(sink: ArchiveSink): Promise<void> {
    assertDocumentEditable(admitted, settings);
    await publishDocumentArchive(snapshot(), { output: "-" }, { ...settings, stdout: sink, encoding: { order: "input", compression: "store" } });
  }, async publish(options: PublicationOptions, publication: PublicationContext) {
    assertDocumentEditable(admitted, settings);
    return publishDocumentArchive(snapshot(), options, { ...publication, ...settings });
  } };
}

import { admitDocumentModel } from "./model-admission.js";
import { PackageView, StylesPart, packageBindStyles, packageAdmitImages } from "./package-view.js";
import { bindXmlElementView, type XmlElementView } from "./xml-element-view.js";
import { budgetSharesReservations } from "./budget.js";
import { type DocumentModelContext } from "./model-context.js";
import { type DocumentModelInput } from "./model-input.js";
import { MissingKeyError, StaleHandleError, OwnershipError } from "./model-errors.js";
import { archiveSettings, InputTypeError, InvalidValueError, type ArchiveContext, type DocumentArchive } from "./archive.js";
import { modelOutput, type DocumentOutput, type DocumentSaveOptions } from "./model-output.js";
import { documentDialects } from "./dialect.js";
import { runElementOpen } from "./run-properties.js";
import { renderContent, xmlValue } from "./create-content.js";
import { Font, ParagraphFormat, formattingXmlOwners, type FormattingXmlOwner } from "./formatting-model.js";
import { activeXmlChildren } from "./xml-active-children.js";
import { styleAttribute as attr, styleChild as child, styleToggle, styleInteger, mergeStyleChildren } from "./style-properties.js";
import { styleDisplayName, styleStoredName } from "./style-names.js";
import { addDocumentStylesPart } from "./styles-part.js";
import { editLatentStyles, readLatentStyles } from "./latent-styles.js";
import type { DocxEnumValue } from "./operation-types.js";
import { parseDocumentXml, type XmlElement } from "./package-xml.js";
import { DocumentXmlEditor, replaceActiveStyleXml } from "./xml-write.js";
import { assertDocumentEditable, publishDocumentArchive, PublicationError, publicationGenerationGuard, type PublicationOptions, type PublicationContext } from "./publication.js";

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
  activePublications = 0;
  readonly tokens: number[];
  readonly latentTokens: number[];
  nextLatentToken: number;
  private nextToken: number;
  private cachedEditor: DocumentXmlEditor | undefined;
  readonly warnings: { readonly code: string }[] = [];
  readonly part: StylesPart;
  private readonly views = new Map<string, XmlElementView>();
  xmlView(key: string, resolve: (xml: DocumentXmlEditor) => XmlElement, removeRoot?: () => void): XmlElementView {
    let view = this.views.get(key);
    if (!view) {
      const budget = archiveSettings(this.context).budget;
      let originalChildren: (node: XmlElement) => readonly XmlElement[] = node => node.children;
      view = bindXmlElementView({ budget, read: () => this.editor(), resolve, change: action => this.change(xml => {
        originalChildren = activeXmlChildren(xml, budget);
        action(xml);
      }),
        ...(removeRoot ? { removeRoot } : {}),
        inserted: (parent, node, index) => {
          if (node.kind !== "element" || node.name.namespaceURI !== parent.namespace) return;
          const styles = parent.localName === "styles" && node.name.localName === "style";
          const latent = parent.localName === "latentStyles" && node.name.localName === "lsdException";
          if (!styles && !latent) return;
          const preceding = new Set<XmlElement>(), pending = parent.children.slice(0, index);
          while (pending.length) { const current = pending.pop()!; budget.charge("work", 1); preceding.add(current); pending.push(...current.children); }
          const position = originalChildren(parent).filter(n => n.namespace === parent.namespace && n.localName === node.name.localName && preceding.has(n)).length;
          if (styles) this.tokens.splice(position, 0, this.nextToken++);
          else this.latentTokens.splice(position, 0, this.nextLatentToken++);
        },
        removed: (parent, node) => {
          if (parent?.localName === "styles" && node.localName === "style" && node.namespace === parent.namespace) this.tokens.splice(originalChildren(parent).filter(n => n.localName === "style" && n.namespace === parent.namespace).indexOf(node), 1);
          if (parent?.localName === "latentStyles" && node.localName === "lsdException" && node.namespace === parent.namespace) this.latentTokens.splice(originalChildren(parent).filter(n => n.localName === "lsdException" && n.namespace === parent.namespace).indexOf(node), 1);
        }
      });
      this.views.set(key, view);
    }
    return view;
  }
  private readonly identities = new Map<string, object>();
  identity(token: number, kind: string): object { const key = `${token}:${kind}`; let id = this.identities.get(key); if (!id) { id = Object.freeze({}); this.identities.set(key, id); } return id; }
  constructor(public source: Uint8Array, readonly context: ArchiveContext, readonly writable: () => void, partname: string, ownerPackage: PackageView, part?: StylesPart) {
    this.part = part ?? new StylePartView(this, partname, ownerPackage);
    this.tokens = this.nodes(this.editor()).map((_, i) => i);
    this.nextToken = this.tokens.length;
    const xml = this.editor();
    this.latentTokens = (readLatentStyles(xml.root, undefined, activeXmlChildren(xml, archiveSettings(context).budget))?.entries ?? []).map((_, index) => index);
    this.nextLatentToken = this.latentTokens.length;
    if (part) part[packageBindStyles](new Styles(this), () => this.xmlView("styles-root", xml => xml.root));
  }
  editor(): DocumentXmlEditor { if (!this.cachedEditor) { const settings = archiveSettings(this.context); this.cachedEditor = new DocumentXmlEditor(this.source, {}, undefined, settings.budget); } return this.cachedEditor; }
  readChild(node: XmlElement, name: string): XmlElement | undefined { return child(node, name, activeXmlChildren(this.editor(), archiveSettings(this.context).budget)); }
  nodes(xml: DocumentXmlEditor): XmlElement[] { return activeXmlChildren(xml, archiveSettings(this.context).budget)(xml.root).filter(n => n.namespace === xml.root.namespace && n.localName === "style"); }
  node(xml: DocumentXmlEditor, token: number): XmlElement {
    const index = this.tokens.indexOf(token), node = this.nodes(xml)[index];
    if (!node) throw new StaleHandleError("The style handle is no longer valid.");
    return node;
  }
  change(action: (xml: DocumentXmlEditor) => void): void {
    if (this.activePublications) throw new PublicationError("conflict", "Model publication is committing.");
    this.writable();
    const xml = this.editor(); try {
      action(xml);
      const source = xml.serialize(), previous = this.source;
      archiveSettings(this.context).budget.charge("work", source.length);
      if (source.length !== previous.length || source.some((byte, index) => byte !== previous[index])) this.revision++;
      this.source = source;
    } finally { this.cachedEditor = undefined; }
  }
  checkpoint(): () => void {
    const tokens = this.tokens.slice(), latentTokens = this.latentTokens.slice(), revision = this.revision, warningCount = this.warnings.length;
    return () => { this.tokens.splice(0, this.tokens.length, ...tokens); this.latentTokens.splice(0, this.latentTokens.length, ...latentTokens); this.revision = revision; this.warnings.length = warningCount; this.cachedEditor = undefined; };
  }
  add(markup: string): number {
    this.change(xml => xml.insertChildren(xml.root, markup));
    const token = this.nextToken++; this.tokens.push(token); return token;
  }
  remove(token: number): void {
    this.change(xml => xml[replaceActiveStyleXml](this.node(xml, token), ""));
    this.tokens.splice(this.tokens.indexOf(token), 1);
  }
}

/** Internal mutation state for batch accounting; not part of the public barrel. */
export const styleOwnerCheckpoints = new WeakMap<Styles, () => () => void>();
export const styleModelMutations = new WeakMap<Styles, { readonly revision: number }>();

/** Internal shared heading allocation; retains the live styles owner. */
export const resolveHeadingStyle = Symbol("resolve-heading-style");

/** Read-only part metadata with owned byte snapshots; edits use the live model. */
export class StylePartView extends StylesPart {
  #styles: Styles | undefined;
  static override default(owner: PackageView): StylePartView {
    if (!(owner instanceof PackageView)) throw new InputTypeError("Expected an admitted owner package.");
    const edges = [...owner.main_document_part.rels.values()].filter(edge => Object.values(documentDialects).some(dialect => edge.reltype === `${dialect.r}/styles`) && !edge.is_external);
    if (edges.length !== 1 || !(edges[0]!.target_part instanceof StylePartView)) throw new InvalidValueError("Expected the live styles part of this owner.");
    return edges[0]!.target_part as StylePartView;
  }
  override get styles(): Styles { return this.#styles ??= new Styles(this.store); }
  constructor(private readonly store: StyleStore, partname: string, ownerPackage: PackageView) { super(ownerPackage, partname); Object.freeze(this); }
  override get blob(): Uint8Array {
    const bytes = this.store.source, budget = archiveSettings(this.store.context).budget;
    budget.charge("work", bytes.length); budget.charge("retainedBytes", bytes.length);
    return new Uint8Array(bytes);
  }
  override get element(): XmlElementView { return this.store.xmlView("styles-root", xml => xml.root); }
}

export class Styles implements Iterable<BaseStyle> {
  constructor(private readonly store: StyleStore) {}
  private get rawElement(): XmlElement { return this.store.editor().root; }
  get element(): XmlElementView { return this.store.xmlView("styles-root", xml => xml.root); }
  get part(): StylesPart { return this.store.part; }
  equals(other: unknown): boolean { return other instanceof Styles && other.store === this.store; }
  get length(): number { return this.store.tokens.length; }
  *[Symbol.iterator](): Iterator<BaseStyle> { for (const token of [...this.store.tokens]) yield this.wrap(token); }
  private wrap(token: number): BaseStyle {
    const xml = this.store.editor(), kind = attr(this.store.node(xml, token), "type") ?? "paragraph";
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
  [resolveHeadingStyle](level: number): ParagraphStyle {
    const budget = archiveSettings(this.store.context).budget;
    const root = this.rawElement;
    const rendered = renderContent({version: 1, blocks: [{kind: "paragraph", level}]}, root.namespace, budget, root);
    if (rendered.styles) return this.wrap(this.store.add(rendered.styles)) as ParagraphStyle;
    const paragraph = parseDocumentXml(new TextEncoder().encode(rendered.body), {}, budget).root;
    const id = attr(child(child(paragraph, "pPr"), "pStyle"), "val");
    const style = [...this].find(style => style.style_id === id);
    if (!(style instanceof ParagraphStyle)) throw new InvalidValueError("Expected the allocated paragraph heading style.");
    return style;
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
    const namespace = this.rawElement.namespace;
    return this.wrap(this.store.add(`<st:style xmlns:st="${namespace}" st:type="${type}" st:styleId="Style${serial}"${builtin ? "" : ' st:customStyle="1"'}><st:name st:val="${xmlValue(styleStoredName(name))}"/></st:style>`));
  }
  default(style_type: DocxEnumValue<"WD_STYLE_TYPE">): BaseStyle | null {
    const type = typeName(style_type);
    return [...this].filter(s => types[s.type.name as keyof typeof types] === type && ["1", "true", "on"].includes([...s.element.attributes].find(([name]) => name.namespaceURI === s.element.namespace && name.localName === "default")?.[1] ?? "0")).at(-1) ?? null;
  }
  get_by_id(style_id: string | null, style_type: DocxEnumValue<"WD_STYLE_TYPE">): BaseStyle | null {
    if (style_id !== null && typeof style_id !== "string") throw new TypeError("Expected a style ID or null.");
    const type = typeName(style_type);
    if (style_id === null || style_id === "") return this.default(style_type);
    return [...this].find(s => s.style_id === style_id && types[s.type.name as keyof typeof types] === type) ?? this.default(style_type);
  }
  get_style_id(style_or_name: BaseStyle | string | null, style_type: DocxEnumValue<"WD_STYLE_TYPE">): string | null {
    typeName(style_type);
    if (style_or_name === null) return null;
    const style = typeof style_or_name === "string" ? this.at(style_or_name) : style_or_name;
    if (!(style instanceof BaseStyle)) throw new InputTypeError("Expected a style of the requested type.");
    if (style.collection !== this) throw new OwnershipError("Expected an owned style.");
    if (style.type.name !== style_type.name) throw new InputTypeError("Expected a style of the requested type.");
    return style.style_id === this.default(style_type)?.style_id ? null : style.style_id;
  }
  get latent_styles(): LatentStyles {
    if (!this.store.readChild(this.rawElement, "latentStyles")) this.store.change(xml => xml.insertChildren(xml.root, `<st:latentStyles xmlns:st="${xml.root.namespace}"/>`, this.store.nodes(xml)[0]));
    return new LatentStyles(this.store);
  }
}

export class BaseStyle {
  constructor(protected readonly store: StyleStore, protected readonly token: number, readonly collection: Styles) {}
  protected get rawElement(): XmlElement { const xml = this.store.editor(); return this.store.node(xml, this.token); }
  get element(): XmlElementView { void this.rawElement; return this.store.xmlView(`style:${this.token}`, xml => this.store.node(xml, this.token), () => this.delete()); }
  get part(): StylesPart { void this.rawElement; return this.store.part; }
  equals(other: unknown): boolean { void this.rawElement; return other instanceof BaseStyle && other.store === this.store && other.token === this.token; }
  protected setValue(tag: string, value: string | null): void {
    this.store.change(xml => { const node = this.store.node(xml, this.token); xml[replaceActiveStyleXml](node, mergeStyleChildren(xml, node, new Map([[tag, value === null ? "" : `<st:${tag} xmlns:st="${node.namespace}" st:val="${xmlValue(value)}"/>`]]), order)); });
  }
  protected setAttribute(name: string, value: string | null): void {
    this.store.change(xml => { const node = this.store.node(xml, this.token); xml[replaceActiveStyleXml](node, mergeStyleChildren(xml, node, new Map(), order, { [name]: value })); });
  }
  get name(): string | null { const value = attr(this.store.readChild(this.rawElement, "name"), "val"); return value === undefined ? null : styleDisplayName(value); }
  set name(value: string | null) { if (value !== null && typeof value !== "string") throw new TypeError("Expected a style name or null."); this.setValue("name", value); }
  get style_id(): string | null { return attr(this.rawElement, "styleId") ?? null; }
  set style_id(value: string | null) { if (value !== null && typeof value !== "string") throw new TypeError("Expected a style ID or null."); this.setAttribute("styleId", value); }
  get type(): DocxEnumValue<"WD_STYLE_TYPE"> {
    const type = attr(this.rawElement, "type") ?? "paragraph";
    const key = (Object.keys(types) as (keyof typeof types)[]).find(k => types[k] === type);
    if (!key) throw new TypeError("Unknown style type.");
    return WD_STYLE_TYPE[key];
  }
  get builtin(): boolean { return !["1", "true", "on"].includes(attr(this.rawElement, "customStyle") ?? "0"); }
  get priority(): number | null { return styleInteger(attr(this.store.readChild(this.rawElement, "uiPriority"), "val")); }
  set priority(value: number | null) { nullableInteger(value); this.setValue("uiPriority", value === null ? null : String(value)); }
  get hidden(): boolean { return this.flag("semiHidden"); }
  set hidden(value: boolean | null) { tri(value); this.setValue("semiHidden", value ? "1" : null); }
  get locked(): boolean { return this.flag("locked"); }
  set locked(value: boolean | null) { tri(value); this.setValue("locked", value ? "1" : null); }
  get quick_style(): boolean { return this.flag("qFormat"); }
  set quick_style(value: boolean | null) { tri(value); this.setValue("qFormat", value ? "1" : null); }
  get unhide_when_used(): boolean { return this.flag("unhideWhenUsed"); }
  set unhide_when_used(value: boolean | null) { tri(value); this.setValue("unhideWhenUsed", value ? "1" : null); }
  private flag(tag: string): boolean { return styleToggle(this.store.readChild(this.rawElement, tag)) ?? false; }
  delete(): void { this.store.remove(this.token); }
}

export class CharacterStyle extends BaseStyle {
  protected formattingOwner(kind: "r" | "p"): FormattingXmlOwner {
    const { store, token } = this;
    const owner: FormattingXmlOwner = { budget: archiveSettings(store.context).budget, get part() {
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
      this.store.change(xml => { const node = this.store.node(xml, this.token); xml[replaceActiveStyleXml](node, mergeStyleChildren(xml, node, new Map([[kind + "Pr", props ? runElementOpen(props) + fragment.sourceXml(props, new Map(), true) + `</${props.name}>` : ""]]), order)); });
    } };
    formattingXmlOwners.set(owner, {
      budget: archiveSettings(store.context).budget,
      read: () => store.editor(),
      resolve: xml => store.node(xml, token),
      change: action => store.change(action)
    });
    return owner;
  }
  get font(): Font { return new Font(this.formattingOwner("r")); }
  get base_style(): BaseStyle | null { const id = attr(this.store.readChild(this.rawElement, "basedOn"), "val"); return id === undefined ? null : [...this.collection].find(s => s.style_id === id) ?? null; }
  set base_style(value: BaseStyle | null) {
    if (value !== null) {
      if (!(value instanceof BaseStyle)) throw new InputTypeError("Expected a base style of the same type.");
      if (value.collection !== this.collection) throw new OwnershipError("Expected a base style from this document.");
      if (value.type.name !== this.type.name) throw new InputTypeError("Expected a base style of the same type.");
    }
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
    const id = attr(this.store.readChild(this.rawElement, "next"), "val");
    return [...this.collection].find(s => s.style_id === id && s.type.name === "PARAGRAPH") ?? this;
  }
  set next_paragraph_style(value: BaseStyle | null) {
    if (value !== null) {
      if (!(value instanceof BaseStyle)) throw new InputTypeError("Expected a paragraph style.");
      if (value.collection !== this.collection) throw new OwnershipError("Expected an owned paragraph style.");
      if (value.type.name !== "PARAGRAPH") throw new InputTypeError("Expected a paragraph style.");
    }
    this.setValue("next", value?.style_id === this.style_id ? null : value?.style_id ?? null);
  }
}
export class TableStyle extends ParagraphStyle {}
export { TableStyle as _TableStyle, BaseStyle as _NumberingStyle };

export class LatentStyles implements Iterable<LatentStyle> {
  constructor(private readonly store: StyleStore) {}
  private get rawElement(): XmlElement { const node = this.store.readChild(this.store.editor().root, "latentStyles"); if (!node) throw new RangeError("Latent styles are no longer available."); return node; }
  get element(): XmlElementView { void this.rawElement; return this.store.xmlView("latent-root", xml => { const node = this.store.readChild(xml.root, "latentStyles"); if (!node) throw new StaleHandleError("The XML owner is detached."); return node; }); }
  xmlView(token: number): XmlElementView { void this.entry(token); return this.store.xmlView(`latent:${token}`, xml => this.node(token, xml), () => this.remove(token)); }
  get part(): StylesPart { return this.store.part; }
  equals(other: unknown): boolean { return other instanceof LatentStyles && other.store === this.store; }
  private info() { const xml = this.store.editor(); return readLatentStyles(xml.root, undefined, activeXmlChildren(xml, archiveSettings(this.store.context).budget))!; }
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
    this.store.change(xml => { const node = this.store.readChild(xml.root, "latentStyles")!; xml.insertChildren(node, `<st:lsdException xmlns:st="${node.namespace}" st:name="${xmlValue(styleStoredName(name))}"/>`); });
    const token = this.store.nextLatentToken++; this.store.latentTokens.push(token);
    return new LatentStyle(this, token);
  }
  entry(token: number) {
    const index = this.store.latentTokens.indexOf(token), entry = this.info().entries[index];
    if (!entry) throw new StaleHandleError("The latent style handle is no longer valid.");
    return entry;
  }
  node(token: number, xml = this.store.editor()): XmlElement {
    const children = activeXmlChildren(xml, archiveSettings(this.store.context).budget), root = child(xml.root, "latentStyles", children);
    const index = this.store.latentTokens.indexOf(token), node = root && children(root).filter(n => n.namespace === xml.root.namespace && n.localName === "lsdException")[index];
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
  private setDefault(key: string, value: boolean | number | null): void { this.store.change(xml => { editLatentStyles(xml, "styles.latent.defaults.set", { [key]: value }, activeXmlChildren(xml, archiveSettings(this.store.context).budget)); }); }
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
  get part(): StylesPart { void this.name; return this.collection.part; }
  get element(): XmlElementView { return this.collection.xmlView(this.token); }
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
export async function openDocumentStyleModel(input?: DocumentModelInput | null, context?: DocumentModelContext) {
  return bindDocumentStyleModel(await admitDocumentModel(input, context));
}

/** Internal binding preserves the admitted source identity without reopening input. */
export async function bindDocumentStyleModel({ archive: admitted, settings, source }: Awaited<ReturnType<typeof admitDocumentModel>>) {
  const edges = admitted.package.relationships("/" + admitted.mainPart).filter(e => e.reltype === `${documentDialects[admitted.dialect].r}/styles`);
  if (edges.length > 1 || edges[0]?.is_external) throw new RangeError("Expected one internal styles part.");
  let archive: DocumentArchive = admitted;
  let part = edges[0]?.target_part.name;
  const createdStylesPart = part === undefined;
  if (!part) { const result = addDocumentStylesPart(admitted, admitted, "", settings.budget); archive = result.archive; part = result.name; }
  let stylesPart = part;
  let bindingReady = false;
  const packageView: PackageView = new PackageView({ context: settings, snapshot: () => bindingReady ? snapshot() : archive,
    version: () => bindingReady ? store.revision : 0,
    writable: () => { if (store.activePublications) throw new PublicationError("conflict", "Model publication is committing."); assertDocumentEditable(admitted, settings); },
    stage: (candidate, rename) => { archive = candidate; if (rename?.from === "/" + stylesPart) stylesPart = rename.to.slice(1); },
    save: async (output, options) => { await model.save(output, options); }
  });
  const store = new StyleStore(archive.members.find(m => m.name === stylesPart)!.bytes, settings, () => assertDocumentEditable(admitted, settings), "/" + stylesPart, packageView);
  store.revision = createdStylesPart ? 1 : 0;
  const styles = store.part.styles;
  styleModelMutations.set(styles, store);
  function snapshot(): DocumentArchive {
    const root = store.editor().root, ids = new Set<string>();
    for (const node of store.nodes(store.editor())) {
      const id = attr(node, "styleId"), type = attr(node, "type") ?? "paragraph";
      if (!Object.values(types).includes(type) || id !== undefined && ids.has(id)) throw new InvalidValueError("Invalid style definition graph.");
      if (id !== undefined) ids.add(id);
    }
    if (!documentDialects[admitted.dialect] || root.namespace !== documentDialects[admitted.dialect].w || root.localName !== "styles") throw new InvalidValueError("Invalid styles part root.");
    return ({ ...archive, members: archive.members.map(m => m.name === stylesPart ? { ...m, bytes: store.source } : m) });
  };
  bindingReady = true;
  const guard = () => {
    const revision = store.revision, graphRevision = packageView.revision;
    return () => {
      if (store.revision !== revision || packageView.revision !== graphRevision) throw new PublicationError("conflict", "Model changed during publication.");
      store.activePublications++;
      return () => { store.activePublications--; };
    };
  };
  const model = { styles, package: packageView, get warnings(): readonly { readonly code: string }[] { return store.warnings.slice(); }, async save(output: DocumentOutput, options: DocumentSaveOptions = {}): Promise<void> {
    const target = modelOutput(output, options, settings, source);
    assertDocumentEditable(admitted, settings);
    await publishDocumentArchive(snapshot(), target.options, { ...settings, ...target, [publicationGenerationGuard]: guard(), encoding: { order: "input", compression: "store" } });
  }, async publish(options: PublicationOptions, publication: PublicationContext) {
    assertDocumentEditable(admitted, settings);
    const caller = archiveSettings(publication);
    if (publication.budget && !settings.budget[budgetSharesReservations](caller.budget)) throw new PublicationError("unsupported-publication", "Publication must share admitted resource reservations.");
    const signal = AbortSignal.any([settings.signal, caller.signal]);
    const limits = Object.fromEntries(Object.entries(settings.limits).map(([key, value]) => [key, Math.min(value, caller.limits[key as keyof typeof caller.limits])])) as unknown as typeof settings.limits;
    const budget = settings.budget.lower(Object.fromEntries(Object.entries(settings.budget.limits).map(([key, value]) => [key, Math.min(value, caller.budget.limits[key as keyof typeof caller.budget.limits])])), signal);
    return publishDocumentArchive(snapshot(), options, { ...publication, limits, signal, budget, [publicationGenerationGuard]: guard() });
  } };
  await packageView[packageAdmitImages]();
  return model;
}

/** Internal binding for format owners sharing one admitted package state. */
export function bindDocumentStyles(owner: {
  readonly context: ArchiveContext;
  readonly package: PackageView;
  readonly partname: string;
  readonly part?: StylesPart;
  read(): Uint8Array;
  write(bytes: Uint8Array): void;
  writable(): void;
}): Styles {
  const store = new StyleStore(owner.read(), owner.context, () => owner.writable(), owner.partname, owner.package, owner.part);
  Object.defineProperty(store, "source", {
    get: () => owner.read(),
    set: (source: Uint8Array) => owner.write(source)
  });
  const styles = store.part.styles;
  styleModelMutations.set(styles, store);
  styleOwnerCheckpoints.set(styles, () => store.checkpoint());
  return styles;
}

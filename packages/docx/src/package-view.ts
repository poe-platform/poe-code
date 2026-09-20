import { styleAllocationIds } from "./style-allocation.js";
import { snapshotSequence } from "./numeric-index.js";
import { inlineImageRun } from "./inline-image-xml.js";
import type { ModelStore } from "./model-store.js";
import type { BaseStyle, Styles } from "./styles-model.js";
import type { Comments } from "./review-model.js";
import type { Settings } from "./settings-model.js";
import { originalModelDefaults } from "./default-model-styles.js";
import { parseMediaType } from "./media-type.js";
import { archiveSettings, InputTypeError, InvalidValueError, ResourceLimitError, type ArchiveContext, type ArchiveMember, type DocumentArchive } from "./archive.js";
import { DocumentPackage, type PackagePart, type PackageRelationship } from "./package.js";
import { validateDocumentArchive, SemanticValidationError } from "./validation.js";
import { MissingKeyError, StaleHandleError, OwnershipError } from "./model-errors.js";
import { PublicationError } from "./publication.js";
import { DocumentXmlEditor, editActiveRelationshipXml, UnsupportedEditError } from "./xml-write.js";
import { relationshipXmlRows, relationshipXmlIds, collapseRelationshipScalar } from "./relationship-xml.js";
import { bindXmlElementView, replaceXmlScalar, type XmlElementView } from "./xml-element-view.js";
import { PackURI } from "./pack-uri.js";
import { asciiKey, normalizePartName, relativePartTarget } from "./part-uri.js";
import { xmlValue } from "./create-content.js";
import type { DocumentOutput, DocumentSaveOptions } from "./model-output.js";
import { corePropertyKeys, corePropertyNamespace, readPropertyNodes, serializePropertyScalar, normalizePropertyDate } from "./property-values.js";
import { createPropertyPart } from "./property-part.js";
import { documentDialects, type DocumentDialect } from "./dialect.js";
import { validateDocxValue } from "./operation-schema.js";
import type { DocumentBudget } from "./budget.js";
import { isXmlContentType, parseDocumentXml } from "./package-xml.js";
import { Image, copyImageForOwner, type ImageModelInput, type ImageModelContext } from "./image-model.js";
import type { DocxEnumValue } from "./operation-types.js";
import type { DocumentModelInput } from "./model-input.js";
import { admitDocumentModel } from "./model-admission.js";
import { modelContext, type DocumentModelContext } from "./model-context.js";
import type { Length } from "./formatting-values.js";
import { activeXmlChildren } from "./xml-active-children.js";
import { documentTypes } from "./admission.js";
import { compatibilityProfileForPart } from "./compatibility.js";
import { retainedRelationshipTargets } from "./relationship-part.js";
import { embeddedFontState, UnsupportedEmbeddedFontMutationError } from "./font-resources.js";

const relNamespace = "http://schemas.openxmlformats.org/package/2006/relationships";
const relContentType = "application/vnd.openxmlformats-package.relationships+xml";
const packageRegister = Symbol("register");
/** Internal canonical lookup includes admitted unlinked parts. */
export const packagePart = Symbol("part");
/** Internal package-wide allocation reservations include admitted unlinked document declarations. */
export const packageStyleAllocationIds = Symbol("style-allocation-ids");
const packageMetadata = Symbol("metadata");
const packageRelationships = Symbol("relationships");
const packageEdges = Symbol("edges");
const packageRelationshipXml = Symbol("relationshipXml");
const packageEditRelationships = Symbol("editRelationships");
const packageNextRelationshipId = Symbol("nextRelationshipId");
const packageBindXml = Symbol("bindXml");
const packageReadXml = Symbol("read-xml");
const packageRename = Symbol("rename");
const packageValidate = Symbol("validate");
const packageAdmitPart = Symbol("admit-part");
const packageNumbering = Symbol("numbering");
const packageCreateNative = Symbol("create-native");
const packageModel = Symbol("model");
/** Internal binding for the shared styles owner; not exported from the public barrel. */
export const packageBindStyles = Symbol("bind-styles");
const packageCore = Symbol("core-properties");
const coreRead = Symbol("core-read");
const coreWrite = Symbol("core-write");
const packageImage = Symbol("image");
const packageImages = Symbol("images");
/** Internal admission hook; never a batch callback or public barrel export. */
export const packageAdmitImages = Symbol("admit-images");
/** Internal binding of a characterized image to the same admitted package bytes. */
export const packageBindImage = Symbol("bind-image");
/** Internal transaction checkpoint; preserves package and retained part identities. */
export const packageOwnerCheckpoint = Symbol("owner-checkpoint");
const packageLoadImage = Symbol("load-image");
const packageStoryImage = Symbol("story-image");
const partNames = new WeakMap<PartView, string>();
const validateNativePartType = Symbol("validate-native-part-type");
const invalidateRelationshipViews = Symbol("invalidate-relationship-views");

/** Internal binding to the admitted model; publication remains with that owner. */
export interface PackageViewBinding {
  readonly model?: ModelStore;
  readonly context: ArchiveContext;
  snapshot(): DocumentArchive;
  stage(archive: DocumentArchive, rename?: { from: string; to: string }): void;
  version(): number;
  writable(): void;
  save(output: DocumentOutput, options?: DocumentSaveOptions): Promise<void>;
}

function relationshipName(owner: string): string {
  if (owner === "/") return "_rels/.rels";
  const uri = new PackURI(owner);
  return uri.rels_uri.membername;
}

/** Live bounded graph over the same document state as style and command edits. */
export class PackageView {
  readonly #binding: PackageViewBinding;
  readonly #parts = new Map<string, PartView>();
  readonly #relationships = new Map<string, Relationships>();
  #revision = 0;
  #admitting: Pick<PackagePart, "partname" | "content_type"> | undefined;
  #cached: { version: string; archive: DocumentArchive; graph: DocumentPackage } | undefined;
  #imageParts: ImageParts | undefined;
  readonly #images = new Map<string, Image>();
  readonly #xmlReads = new WeakMap<PackagePart, DocumentXmlEditor>();
  constructor(binding: PackageViewBinding) { this.#binding = binding; }
  static async open(input: DocumentModelInput, context?: DocumentModelContext): Promise<PackageView> {
    const settings = modelContext(context);
    if (input == null) throw new InputTypeError("Expected explicit package input.");
    if (settings.template !== undefined) throw new InputTypeError("A context template conflicts with package input.");
    const admitted = await admitDocumentModel(input, settings);
    const { ModelStore } = await import("./model-store.js");
    const store = new ModelStore(admitted.archive, admitted.settings, admitted.archive.mainPart, admitted.source);
    store.package.after_unmarshal();
    return store.package;
  }
  get revision(): number { return this.#revision; }
  [packageModel](part: PartView): ModelStore {
    this[packageMetadata](part);
    if (!this.#binding.model) throw new UnsupportedEditError("This package does not have a live document model binding.");
    return this.#binding.model;
  }
  [packageOwnerCheckpoint](): () => void {
    const parts = new Map(this.#parts), relationships = new Map(this.#relationships), images = new Map(this.#images), revision = this.#revision;
    const names = new Map([...parts.values()].map(part => [part, partNames.get(part)!]));
    return () => {
      for (const part of this.#parts.values()) if (!names.has(part)) partNames.delete(part);
      this.#parts.clear(); for (const [key, part] of parts) this.#parts.set(key, part);
      for (const [part, name] of names) partNames.set(part, name);
      this.#relationships.clear(); for (const [key, value] of relationships) this.#relationships.set(key, value);
      this.#images.clear(); for (const [key, image] of images) this.#images.set(key, image);
      this.#revision = revision; this.#cached = undefined;
    };
  }
  private current(): { archive: DocumentArchive; graph: DocumentPackage } {
    const settings = archiveSettings(this.#binding.context);
    settings.budget.check("work", 0);
    const version = `${this.#revision}:${this.#binding.version()}`;
    if (!this.#cached || this.#cached.version !== version) {
      const archive = this.#binding.snapshot();
      this.#cached = { version, archive, graph: new DocumentPackage(archive, settings.limits, settings.budget) };
    }
    return this.#cached;
  }
  private relationshipMember(owner: string): ArchiveMember | undefined {
    const { archive, graph } = this.current();
    const key = asciiKey("/" + relationshipName(owner));
    archiveSettings(this.#binding.context).budget.charge("work", graph.parts.length + archive.members.length);
    const part = graph.parts.find(part => asciiKey(part.partname) === key);
    return part && archive.members.find(member => member.name === part.name);
  }
  [packageRegister](part: PartView, name: string): void {
    name = normalizePartName(name);
    if (this.#parts.has(asciiKey(name))) throw new InvalidValueError("The part already has an owner view.");
    const metadata = this.#admitting && asciiKey(this.#admitting.partname) === asciiKey(name) ? this.#admitting : this.current().graph.getPart(name);
    if (part instanceof XmlPartView) XmlPartView[validateNativePartType](part, metadata.content_type);
    partNames.set(part, name);
    this.#parts.set(asciiKey(name), part);
  }
  [packagePart](name: string, metadata: Pick<PackagePart, "partname" | "content_type"> = this.current().graph.getPart(name)): PartView {
    const key = asciiKey(metadata.partname);
    let part = this.#parts.get(key);
    if (!part) {
      const type = parseMediaType(metadata.content_type);
      part = type.startsWith("image/") ? new ImagePartView(this, metadata.partname)
        : type === "application/vnd.openxmlformats-package.core-properties+xml" ? new CorePropertiesPartView(this, metadata.partname)
        : Object.values(documentTypes).includes(type) ? new DocumentPartView(this, metadata.partname)
        : type === "application/vnd.openxmlformats-officedocument.wordprocessingml.numbering+xml" ? new NumberingPart(this, metadata.partname)
        : type === "application/vnd.openxmlformats-officedocument.wordprocessingml.header+xml" ? new HeaderPart(this, metadata.partname)
        : type === "application/vnd.openxmlformats-officedocument.wordprocessingml.footer+xml" ? new FooterPart(this, metadata.partname)
        : type === "application/vnd.openxmlformats-officedocument.wordprocessingml.comments+xml" ? new CommentsPart(this, metadata.partname)
        : type === "application/vnd.openxmlformats-officedocument.wordprocessingml.settings+xml" ? new SettingsPart(this, metadata.partname)
        : type === "application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml" ? new StylesPart(this, metadata.partname)
        : isXmlContentType(type) ? new XmlPartView(this, metadata.partname) : new PartView(this, metadata.partname);
    }
    return part;
  }
  [packageMetadata](part: PartView): PackagePart {
    if (part.package !== this) throw new OwnershipError("Expected a part owned by this package.");
    if (!partNames.has(part)) throw new StaleHandleError("The part owner is detached.");
    const metadata = this.current().graph.getPart(partNames.get(part)!);
    const budget = archiveSettings(this.#binding.context).budget;
    budget.charge("retainedBytes", metadata.bytes.length); budget.charge("work", metadata.bytes.length);
    return { ...metadata, bytes: new Uint8Array(metadata.bytes), modified: new Date(metadata.modified.getTime()) };
  }
  [packageStyleAllocationIds](): Set<string> {
    const budget = archiveSettings(this.#binding.context).budget;
    return styleAllocationIds(this.current().graph.parts, budget);
  }
  get parts(): readonly PartView[] { return snapshotSequence([...this.iter_parts()]); }
  *iter_parts(): IterableIterator<PartView> { for (const part of this.current().graph.iterParts()) yield this[packagePart](part.partname); }
  *iter_rels(): IterableIterator<RelationshipView> {
    const visited = new Set<string>(), stack = ["/"];
    while (stack.length) {
      const owner = stack.pop()!;
      if (visited.has(asciiKey(owner))) continue;
      visited.add(asciiKey(owner));
      const edges = [...this[packageRelationships](owner).values()];
      for (const edge of edges) yield edge;
      for (const edge of edges.slice().reverse()) if (!edge.is_external) stack.push(edge.target_part.partname.toString());
    }
  }
  get rels(): Relationships { return this[packageRelationships]("/"); }
  get image_parts(): ImageParts { return this.#imageParts ??= new ImageParts(this); }
  [packageImages](): readonly ImagePartView[] { return this.current().graph.parts.filter(part => asciiKey(part.content_type).startsWith("image/")).map(part => this[packagePart](part.partname) as ImagePartView); }
  [packageImage](part: ImagePartView): Image {
    const image = this.#images.get(this[packageMetadata](part).partname);
    if (!image) throw new UnsupportedEditError("This image part has no admitted bounded raster characterization.");
    return image;
  }
  [packageBindImage](part: ImagePartView, image: Image): void {
    if (!(part instanceof ImagePartView) || !(image instanceof Image)) throw new InputTypeError("Expected an owned image part and characterized image.");
    const metadata = this[packageMetadata](part), bytes = image.blob;
    if (parseMediaType(metadata.content_type) !== image.content_type || metadata.bytes.length !== bytes.length ||
        !metadata.bytes.every((byte, i) => byte === bytes[i]))
      throw new InvalidValueError("Image characterization conflicts with the owned part bytes.");
    this.#images.set(metadata.partname, image);
  }
  async [packageAdmitImages](): Promise<void> {
    for (const part of this[packageImages]()) {
      const type = parseMediaType(part.content_type);
      if (!["image/png", "image/jpeg", "image/gif", "image/bmp", "image/tiff"].includes(type)) continue;
      try {
        const image = await Image.from_blob(part.blob, this.#binding.context as ImageModelContext);
        if (image.content_type === type) this.#images.set(part.partname.toString(), image);
      } catch (error) {
        if (!(error instanceof UnsupportedEditError)) throw error;
      }
    }
  }
  async [packageLoadImage](name: string | PackURI, contentType: string, bytes: Uint8Array | Image): Promise<ImagePartView> {
    this.#binding.writable();
    const revision = this.#revision, ownerVersion = this.#binding.version();
    const image = bytes instanceof Image ? await Image[copyImageForOwner](bytes, this.#binding.context as ImageModelContext) : await Image.from_blob(bytes, this.#binding.context as ImageModelContext);
    if (revision !== this.#revision || ownerVersion !== this.#binding.version()) throw new PublicationError("conflict", "Package changed during image admission.");
    if (typeof contentType !== "string" || image.content_type !== parseMediaType(contentType)) throw new InvalidValueError("Image part content type conflicts with its byte signature.");
    const part = this[packageAdmitPart](name, contentType, image.blob) as ImagePartView;
    this.#images.set(part.partname.toString(), image);
    return part;
  }
  async get_or_add_image_part(input: ImageModelInput): Promise<ImagePartView> {
    this.#binding.writable();
    const revision = this.#revision, ownerVersion = this.#binding.version();
    const image = await Image.from_file(input, this.#binding.context as ImageModelContext);
    if (revision !== this.#revision || ownerVersion !== this.#binding.version()) throw new PublicationError("conflict", "Package changed during image admission.");
    const bytes = image.blob;
    for (const part of this[packageImages]()) {
      const candidate = part.blob;
      if (candidate.length === bytes.length && candidate.every((value, index) => value === bytes[index])) return part;
    }
    const name = this.next_partname(`/word/media/image%d.${image.ext}`);
    const part = this[packageAdmitPart](name, image.content_type, bytes) as ImagePartView;
    this.#images.set(part.partname.toString(), image);
    return part;
  }
  async [packageStoryImage](owner: StoryPart, input: ImageModelInput, prepare?: (id: string, image: Image) => XmlElementView): Promise<readonly [string, Image, XmlElementView | undefined]> {
    this.#binding.writable();
    const metadata = this[packageMetadata](owner);
    const { budget } = archiveSettings(this.#binding.context);
    const namespace = parseDocumentXml(metadata.bytes, {}, budget).root.namespace;
    const dialect = Object.values(documentDialects).find(dialect => dialect.w === namespace);
    if (!dialect) throw new InputTypeError("Expected an admitted native story owner.");
    const revision = this.#revision, ownerVersion = this.#binding.version();
    const image = await Image.from_file(input, this.#binding.context as ImageModelContext);
    if (revision !== this.#revision || ownerVersion !== this.#binding.version())
      throw new PublicationError("conflict", "Package changed during story image admission.");
    const restore = this[packageOwnerCheckpoint]();
    try {
      const bytes = image.blob, reltype = `${dialect.r}/image`, { graph } = this.current();
      for (const candidate of this[packageImages]()) {
        const existing = candidate.blob;
        if (existing.length !== bytes.length || !existing.every((value, index) => value === bytes[index])) continue;
        const retained = candidate.image;
        const edge = graph.relationships(metadata.partname).find(edge => !edge.is_external && edge.reltype === reltype && asciiKey(edge.target_part.partname) === asciiKey(candidate.partname.toString()));
        const id = edge?.rId ?? graph.allocateRelationshipId(metadata.partname);
        const fragment = prepare?.(id, retained);
        if (!edge) owner.load_rel(reltype, candidate, id);
        return Object.freeze([id, retained, fragment]);
      }
      const name = graph.allocatePartName(metadata.partname.slice(0, metadata.partname.lastIndexOf("/") + 1) + "media/image", `.${image.ext}`);
      const id = graph.allocateRelationshipId(metadata.partname);
      const fragment = prepare?.(id, image);
      this[packageAdmitPart](name, image.content_type, bytes, { owner, reltype, rId: id });
      this.#images.set(name, image);
      return Object.freeze([id, image, fragment]);
    } catch (error) {
      restore();
      throw error;
    }
  }
  get core_properties(): CoreProperties {
    const edges = [...this.rels.values()].filter(edge => edge.reltype === "http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties");
    if (edges.length > 1 || edges[0]?.is_external) throw new InvalidValueError("Expected one owned core-properties part.");
    let part: CorePropertiesPartView;
    if (edges.length) part = edges[0]!.target_part as CorePropertiesPartView;
    else {
      this.#binding.writable();
      const { archive, graph } = this.current();
      const root = this.main_document_part.element.tag;
      const dialect: DocumentDialect = root.namespaceURI === documentDialects.strict.w ? "strict" : "transitional";
      const created = createPropertyPart({ ...archive, package: graph, dialect }, "core", archiveSettings(this.#binding.context).budget);
      const context = this.#binding.context as DocumentModelContext;
      const timestamp = context.timestamp;
      if (!(timestamp instanceof Date) || !Number.isFinite(Date.prototype.getTime.call(timestamp))) throw new InputTypeError("Expected admitted core-property metadata.");
      const modified = new Date(Math.floor(Date.prototype.getTime.call(timestamp) / 1000) * 1000).toISOString();
      const metadata = new TextEncoder().encode(`<cp:coreProperties xmlns:cp="${corePropertyNamespace}" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><dc:title>Document</dc:title><cp:lastModifiedBy>${xmlValue(context.author ?? "")}</cp:lastModifiedBy><cp:revision>1</cp:revision><dcterms:modified xsi:type="dcterms:W3CDTF">${modified}</dcterms:modified></cp:coreProperties>`);
      created.archive = { ...created.archive, members: created.archive.members.map(member => member.name === created.name.slice(1) ? { ...member, bytes: metadata } : member) };
      this.commit(created.archive);
      part = this[packagePart](created.name) as CorePropertiesPartView;
    }
    if (!(part instanceof CorePropertiesPartView)) throw new InvalidValueError("Core-properties relationship has an incompatible target.");
    return part.core_properties;
  }
  [packageCore](part: XmlPartView): CoreProperties {
    return new CoreProperties(part, archiveSettings(this.#binding.context).budget);
  }
  [packageAdmitPart](name: string | PackURI, content_type: string, input: Uint8Array, relationship?: { owner: PartView; reltype: string; rId?: string }): PartView {
    this.#binding.writable();
    if (!(input instanceof Uint8Array) || typeof content_type !== "string" || !content_type) throw new InputTypeError("Expected owned part bytes and a content type.");
    name = normalizePartName(name instanceof PackURI ? name.toString() : name);
    const { archive, graph } = this.current(), settings = archiveSettings(this.#binding.context);
    if (graph.parts.some(part => asciiKey(part.partname) === asciiKey(name as string))) throw new InvalidValueError("The part name is already occupied.");
    if (input.length > settings.limits.maxEntryBytes) throw new ResourceLimitError("Part bytes exceed the admitted ceiling.");
    settings.budget.charge("retainedBytes", input.length); settings.budget.charge("work", input.length);
    const bytes = new Uint8Array(input), types = archive.members.find(member => asciiKey(member.name) === "[content_types].xml")!;
    if (isXmlContentType(content_type)) new DocumentXmlEditor(bytes, {}, undefined, settings.budget);
    const xml = new DocumentXmlEditor(types.bytes, {}, undefined, settings.budget);
    let overrides = `<Override xmlns="http://schemas.openxmlformats.org/package/2006/content-types" PartName="${xmlValue(name)}" ContentType="${xmlValue(content_type)}"/>`;
    const members = [...archive.members];
    if (relationship) {
      const owner = this[packageMetadata](relationship.owner).partname;
      const relName = relationshipName(owner);
      const existing = this.relationshipMember(owner);
      if (!existing) {
        settings.budget.charge("insertedNodes", 1);
        overrides += `<Override xmlns="http://schemas.openxmlformats.org/package/2006/content-types" PartName="/${xmlValue(relName)}" ContentType="${relContentType}"/>`;
      }
      const relXml = new DocumentXmlEditor(existing?.bytes ?? new TextEncoder().encode(`<Relationships xmlns="${relNamespace}"/>`), {}, undefined, settings.budget);
      relXml.insertChildren(relXml.root, `<Relationship xmlns="${relNamespace}" Id="${relationship.rId ?? graph.allocateRelationshipId(owner)}" Type="${xmlValue(relationship.reltype)}" Target="${xmlValue(relativePartTarget(owner, name))}"/>`);
      const member = { name: relName, bytes: relXml.serialize(), directory: false, modified: new Date("1980-01-01T00:00:00Z") };
      if (existing) members[members.indexOf(existing)] = { ...existing, bytes: member.bytes };
      else members.push(member);
    }
    xml.insertChildren(xml.root, overrides);
    members[members.indexOf(types)] = { ...types, bytes: xml.serialize() };
    members.push({ name: name.slice(1), bytes, directory: false, modified: new Date("1980-01-01T00:00:00Z") });
    const restore = this[packageOwnerCheckpoint]();
    try {
      // Bind before staging so no budgeted graph lookup can fail after the owner changes.
      this.#admitting = { partname: name, content_type };
      let part: PartView;
      try { part = this[packagePart](name, this.#admitting); }
      finally { this.#admitting = undefined; }
      this.commit({ ...archive, members });
      return part;
    } catch (error) {
      restore();
      throw error;
    }
  }
  [packageCreateNative](kind: "header" | "footer" | "comments" | "settings" | "styles", relationship?: { owner: DocumentPartView; rId: string }): XmlPartView {
    this.#binding.writable();
    const restore = this[packageOwnerCheckpoint]();
    try {
      const owner = relationship?.owner ?? this.main_document_part, root = owner.element.tag;
      const { graph } = this.current(), { budget } = archiveSettings(this.#binding.context);
      const tag = { header: "hdr", footer: "ftr", comments: "comments", settings: "settings", styles: "styles" }[kind];
      const content = kind === "header" || kind === "footer" ? "<w:p/>" : kind === "styles" ? originalModelDefaults(root.namespaceURI) : "";
      const base = owner.partname.toString();
      const name = graph.allocatePartName(base.slice(0, base.lastIndexOf("/") + 1) + kind, ".xml");
      const bytes = new TextEncoder().encode(`<w:${tag} xmlns:w="${root.namespaceURI}">${content}</w:${tag}>`);
      const parsed = parseDocumentXml(bytes, {}, budget);
      let nodes = 0; const pending = [parsed.root];
      while (pending.length) { const node = pending.pop()!; nodes++; pending.push(...node.children); }
      budget.charge("insertedNodes", nodes);
      const dialect = Object.values(documentDialects).find(dialect => dialect.w === root.namespaceURI)!;
      return this[packageAdmitPart](name, `application/vnd.openxmlformats-officedocument.wordprocessingml.${kind}+xml`, bytes,
        relationship ? { owner, rId: relationship.rId, reltype: `${dialect.r}/${kind}` } : undefined) as XmlPartView;
    } catch (error) { restore(); throw error; }
  }
  [packageNumbering](owner: DocumentPartView): NumberingPart {
    const metadata = this[packageMetadata](owner), { graph } = this.current();
    const { budget } = archiveSettings(this.#binding.context);
    const root = parseDocumentXml(metadata.bytes, {}, budget).root;
    const dialect = Object.values(documentDialects).find(dialect => dialect.w === root.namespace);
    if (!dialect || root.localName !== "document") throw new InvalidValueError("Expected a document numbering owner.");
    const reltype = `${dialect.r}/numbering`;
    const edges = graph.relationships(metadata.partname).filter(edge => edge.reltype === reltype);
    if (edges.length > 1 || edges[0]?.is_external) throw new InvalidValueError("Expected one internal numbering relationship.");
    if (edges[0]) {
      const part = this[packagePart](edges[0].target_part.partname);
      if (!(part instanceof NumberingPart) || part.element.localName !== "numbering" || part.element.namespace !== dialect.w)
        throw new InvalidValueError("Numbering ownership has an incompatible target.");
      return part;
    }
    this.#binding.writable();
    const name = graph.allocatePartName(metadata.partname.slice(0, metadata.partname.lastIndexOf("/") + 1) + "numbering", ".xml");
    budget.charge("insertedNodes", 1);
    return this[packageAdmitPart](name, "application/vnd.openxmlformats-officedocument.wordprocessingml.numbering+xml",
      new TextEncoder().encode(`<w:numbering xmlns:w="${dialect.w}"/>`), { owner, reltype }) as NumberingPart;
  }
  get main_document_part(): DocumentPartView {
    const edges = [...this.rels.values()].filter(edge => Object.values(documentDialects).some(dialect => edge.reltype === `${dialect.r}/officeDocument`) && !edge.is_external);
    if (edges.length !== 1 || !(edges[0]!.target_part instanceof DocumentPartView)) throw new InvalidValueError("Expected one XML document part.");
    return edges[0]!.target_part as DocumentPartView;
  }
  [packageRelationships](owner: string): Relationships {
    const key = owner === "/" ? "/" : asciiKey(this.current().graph.getPart(owner).partname);
    let rels = this.#relationships.get(key);
    if (!rels) { rels = new Relationships(this, owner === "/" ? null : this[packagePart](owner)); this.#relationships.set(key, rels); }
    return rels;
  }
  [packageEdges](owner: PartView | null): readonly PackageRelationship[] { return this.current().graph.relationships(owner ? this[packageMetadata](owner).partname : "/"); }
  [packageRelationshipXml](owner: PartView | null): string {
    const bytes = this.relationshipMember(owner ? this[packageMetadata](owner).partname : "/")?.bytes ?? new TextEncoder().encode(`<Relationships xmlns="${relNamespace}"/>`);
    const budget = archiveSettings(this.#binding.context).budget;
    budget.charge("work", bytes.length); budget.charge("retainedBytes", bytes.length);
    const document = parseDocumentXml(bytes, {}, budget);
    return new TextDecoder(document.encoding, { fatal: true }).decode(bytes);
  }
  [packageNextRelationshipId](owner: PartView | null): string {
    const member = this.relationshipMember(owner ? this[packageMetadata](owner).partname : "/");
    const {budget} = archiveSettings(this.#binding.context);
    const ids = member ? relationshipXmlIds(parseDocumentXml(member.bytes, {}, budget).root, budget) : new Set<string>();
    let ordinal = 1;
    while (ids.has(`rId${ordinal}`)) { budget.charge("work", 1); ordinal++; }
    return `rId${ordinal}`;
  }
  [packageEditRelationships](owner: PartView | null, rows: readonly RelationshipRow[], removeUnsharedPart?: PartView): void {
    this.#binding.writable();
    const { archive } = this.current(), settings = archiveSettings(this.#binding.context);
    const name = relationshipName(owner ? this[packageMetadata](owner).partname : "/");
    const existing = this.relationshipMember(owner ? this[packageMetadata](owner).partname : "/");
    let bytes = existing?.bytes ?? new TextEncoder().encode(`<Relationships xmlns="${relNamespace}"/>`);
    const previous = this[packageEdges](owner);
    const pending = new Map(rows.map(row => [row.rId, row]));
    if (pending.size !== rows.length) throw new InvalidValueError("Duplicate relationship IDs.");
    const removed = new Set(previous.filter(row => !pending.has(row.rId)).map(row => row.rId));
    if (owner && removed.size) {
      const metadata = this[packageMetadata](owner);
      if (isXmlContentType(metadata.content_type)) {
        const stack = [parseDocumentXml(metadata.bytes, {}, settings.budget).root];
        while (stack.length) {
          const node = stack.pop()!;
          settings.budget.charge("work", 1 + node.attributes.length + node.children.length);
          for (const attribute of node.attributes) {
            const reference = attribute.namespace === documentDialects.transitional.r ||
              attribute.namespace === documentDialects.strict.r ||
              attribute.namespace === "urn:schemas-microsoft-com:office:office" && attribute.localName === "relid";
            if (reference && removed.has(attribute.value))
              throw new UnsupportedEditError("An XML reference still requires the relationship.");
          }
          settings.budget.charge("retainedBytes", node.children.length * 8);
          for (const child of node.children) stack.push(child);
        }
      }
    }
    for (const row of previous) {
      const replacement = pending.get(row.rId);
      const changes: Partial<Record<"Type" | "Target" | "TargetMode", string | null>> = {};
      if (replacement) {
        if (replacement.reltype !== row.reltype) changes.Type = replacement.reltype;
        if (replacement.target_ref !== row.target_ref) changes.Target = replacement.target_ref;
        if (replacement.is_external !== row.is_external) changes.TargetMode = replacement.is_external ? "External" : null;
      }
      if (!replacement || Object.keys(changes).length) {
        const xml = new DocumentXmlEditor(bytes, {}, undefined, settings.budget);
        const node = relationshipXmlRows(xml.root, settings.budget).find(node => node.rId === row.rId)!.element;
        xml[editActiveRelationshipXml](node, replacement ? changes : null);
        bytes = xml.serialize();
      }
      pending.delete(row.rId);
    }
    for (const row of pending.values()) {
      const xml = new DocumentXmlEditor(bytes, {}, undefined, settings.budget);
      xml.insertChildren(xml.root, `<Relationship xmlns="${relNamespace}" Id="${xmlValue(row.rId)}" Type="${xmlValue(row.reltype)}" Target="${xmlValue(row.target_ref)}"${row.is_external ? ' TargetMode="External"' : ""}/>`);
      bytes = xml.serialize();
    }
    let members = archive.members.map(member => member === existing ? { ...member, bytes } : member);
    if (!existing) members.push({ name, bytes, directory: false, modified: new Date("1980-01-01T00:00:00Z") });
    const deleted = new Set<string>();
    if (removeUnsharedPart) {
      const metadata = this[packageMetadata](removeUnsharedPart), graph = this.current().graph;
      const excluded = [...removed].map(id => ({ owner: owner ? this[packageMetadata](owner).partname : "/", id }));
      if (!retainedRelationshipTargets(graph, settings.budget, excluded).has(asciiKey(metadata.partname))) {
        deleted.add(asciiKey(metadata.partname));
        const deletedNames = new Set([metadata.name]);
        const outgoing = this.relationshipMember(metadata.partname);
        if (outgoing) { deleted.add(asciiKey(normalizePartName("/" + outgoing.name))); deletedNames.add(outgoing.name); }
        const types = members.find(member => asciiKey(member.name) === "[content_types].xml")!;
        const xml = new DocumentXmlEditor(types.bytes, {}, undefined, settings.budget);
        for (const node of [...xml.root.children]) {
          const partname = node.attributes.find(attribute => !attribute.namespace && attribute.localName === "PartName")?.value;
          if (partname && deleted.has(asciiKey(normalizePartName(partname)))) xml.replaceElement(node, "");
        }
        members = members.filter(member => !deletedNames.has(member.name))
          .map(member => member === types ? { ...member, bytes: xml.serialize() } : member);
      }
    }
    this.commit({ ...archive, members });
    this.#relationships.get(owner ? asciiKey(owner.partname.toString()) : "/")?.[invalidateRelationshipViews](removed);
    for (const key of deleted) {
      const part = this.#parts.get(key); if (part) partNames.delete(part);
      this.#parts.delete(key); this.#relationships.delete(key);
    }
  }
  [packageBindXml](part: PartView): XmlElementView {
    return bindXmlElementView({ budget: archiveSettings(this.#binding.context).budget,
      read: () => {
        const metadata = this[packageMetadata](part);
        return new DocumentXmlEditor(metadata.bytes, {}, compatibilityProfileForPart(metadata.partname), archiveSettings(this.#binding.context).budget);
      },
      resolve: xml => xml.root,
      change: action => {
        this.#binding.writable();
        const metadata = this[packageMetadata](part), { archive, graph } = this.current();
        const { budget, limits } = archiveSettings(this.#binding.context);
        const xml = new DocumentXmlEditor(metadata.bytes, {}, compatibilityProfileForPart(metadata.partname), budget);
        action(xml);
        const bytes = xml.serialize();
        const candidate = { ...archive, members: archive.members.map(member => member.name === metadata.name ? { ...member, bytes } : member) };
        if (parseMediaType(metadata.content_type) === "application/vnd.openxmlformats-officedocument.wordprocessingml.fonttable+xml" &&
            embeddedFontState(graph, budget) !== embeddedFontState(new DocumentPackage(candidate, limits, budget), budget))
          throw new UnsupportedEmbeddedFontMutationError();
        this.commit(candidate);
      }
    });
  }
  [packageReadXml](part: PartView): { xml: DocumentXmlEditor; budget: DocumentBudget } {
    if (part.package !== this) throw new OwnershipError("Expected a part owned by this package.");
    const name = partNames.get(part);
    if (!name) throw new StaleHandleError("The part owner is detached.");
    const metadata = this.current().graph.getPart(name), budget = archiveSettings(this.#binding.context).budget;
    let xml = this.#xmlReads.get(metadata);
    if (!xml) {
      xml = new DocumentXmlEditor(metadata.bytes, {}, undefined, budget);
      this.#xmlReads.set(metadata, xml);
    }
    return { xml, budget };
  }
  private commit(archive: DocumentArchive, rename?: { from: string; to: string }): void {
    const { budget, limits } = archiveSettings(this.#binding.context);
    if (archive.members.length > limits.maxMembers) throw new ResourceLimitError("Package member count exceeds the admitted ceiling.");
    let total = 0;
    for (const member of archive.members) {
      if (member.bytes.length > limits.maxEntryBytes) throw new ResourceLimitError("Part bytes exceed the admitted ceiling.");
      if (member.name.length + 1 > limits.maxPathBytes || new TextEncoder().encode(member.name).length > limits.maxPathBytes || member.name.split("/").filter(Boolean).length > limits.maxDepth) throw new ResourceLimitError("Part path exceeds the admitted ceiling.");
      total += member.bytes.length;
      if (total > limits.maxTotalBytes) throw new ResourceLimitError("Package bytes exceed the admitted ceiling.");
    }
    new DocumentPackage(archive, limits, budget);
    const report = validateDocumentArchive(archive, {}, budget);
    if (!report.valid) throw new SemanticValidationError(report.diagnostics);
    this.#binding.stage(archive, rename);
    this.#revision++;
    this.#cached = undefined;
  }
  [packageRename](part: PartView, name: string | PackURI): void {
    this.#binding.writable();
    const metadata = this[packageMetadata](part), from = metadata.partname, to = normalizePartName(name instanceof PackURI ? name.toString() : name);
    if (from === to) return;
    const { archive, graph } = this.current(), settings = archiveSettings(this.#binding.context);
    if (graph.parts.some(existing => asciiKey(existing.partname) === asciiKey(to))) throw new InvalidValueError("The part name is already occupied.");
    const replacements = new Map<string, Uint8Array>();
    const ownedRelationships = this.relationshipMember(from);
    const renamedParts = new Map([[asciiKey(from), to]]);
    if (ownedRelationships) renamedParts.set(asciiKey(normalizePartName("/" + ownedRelationships.name)), "/" + relationshipName(to));
    const types = archive.members.find(member => asciiKey(member.name) === "[content_types].xml")!;
    const typeEditor = new DocumentXmlEditor(types.bytes, {}, undefined, settings.budget);
    let override = false;
    for (const node of typeEditor.root.children) {
      const value = node.attributes.find(attribute => attribute.localName === "PartName")?.value;
      if (value === undefined) continue;
      const destination = renamedParts.get(asciiKey(normalizePartName(value)));
      if (destination) { typeEditor.setAttribute(node, "PartName", destination); if (destination === to) override = true; }
    }
    if (!override) typeEditor.insertChildren(typeEditor.root, `<Override xmlns="http://schemas.openxmlformats.org/package/2006/content-types" PartName="${xmlValue(to)}" ContentType="${xmlValue(metadata.content_type)}"/>`);
    replacements.set(types.name, typeEditor.serialize());
    for (const owner of ["/", ...graph.parts.filter(part => asciiKey(part.content_type) !== relContentType).map(part => part.partname)]) {
      const edges = graph.relationships(owner), member = this.relationshipMember(owner);
      if (!member || !edges.some(edge => !edge.is_external && (owner === from || edge.target_part.partname === from))) continue;
      const xml = new DocumentXmlEditor(member.bytes, {}, undefined, settings.budget);
      for (const {element: node, rId} of relationshipXmlRows(xml.root, settings.budget)) {
        const edge = edges.find(edge => edge.rId === rId);
        if (!edge || edge.is_external || owner !== from && edge.target_part.partname !== from) continue;
        const target = relativePartTarget(owner === from ? to : owner, edge.target_part.partname === from ? to : edge.target_part.partname)
          + (edge.fragment === null ? "" : "#" + edge.fragment);
        xml[editActiveRelationshipXml](node, {Target: target});
      }
      replacements.set(member.name, xml.serialize());
    }
    const members = archive.members.map(member => ({ ...member,
      name: member.name === metadata.name ? to.slice(1) : member === ownedRelationships ? relationshipName(to) : member.name,
      bytes: replacements.get(member.name) ?? member.bytes
    }));
    this.commit({ ...archive, members }, { from, to });
    this.#parts.delete(asciiKey(from)); this.#parts.set(asciiKey(to), part); partNames.set(part, to);
    const image = this.#images.get(from); if (image) { this.#images.delete(from); this.#images.set(to, image); }
    const rels = this.#relationships.get(asciiKey(from));
    if (rels) { this.#relationships.delete(asciiKey(from)); this.#relationships.set(asciiKey(to), rels); }
  }
  part_related_by(reltype: string): PartView { return this.rels.part_with_reltype(reltype); }
  relate_to(part: PartView, reltype: string): string { return this.rels.get_or_add(reltype, part).rId; }
  load_rel(reltype: string, target: PartView | string, rId: string, is_external = false): void { this.rels.add_relationship(reltype, target, rId, is_external); }
  next_partname(template: string): PackURI {
    if (typeof template !== "string" || template.split("%d").length !== 2) throw new InputTypeError("Expected one numbered part-name placeholder.");
    const [prefix, suffix] = template.split("%d");
    return new PackURI(this.current().graph.allocatePartName(prefix!, suffix!));
  }
  after_unmarshal(): void { this[packageValidate](); this.#cached = undefined; void this.current(); }
  [packageValidate](): void {
    const report = validateDocumentArchive(this.#binding.snapshot(), {}, archiveSettings(this.#binding.context).budget);
    if (!report.valid) throw new SemanticValidationError(report.diagnostics);
  }
  async save(output: DocumentOutput, options?: DocumentSaveOptions): Promise<void> {
    this.#binding.writable();
    this[packageValidate]();
    await this.#binding.save(output, options);
  }
}

export class PartView {
  readonly #package: PackageView;
  constructor(owner: PackageView, name: string) { this.#package = owner; owner[packageRegister](this, name); }
  static async load(partname: string | PackURI, content_type: string, blob: Uint8Array, owner: PackageView): Promise<PartView> {
    if (!(owner instanceof PackageView)) throw new InputTypeError("Expected an admitted owner package.");
    return owner[packageAdmitPart](partname, content_type, blob);
  }
  get package(): PackageView { return this.#package; }
  get partname(): PackURI { const name = partNames.get(this); if (!name) throw new StaleHandleError("The part owner is detached."); return new PackURI(name); }
  set partname(value: string | PackURI) { this.#package[packageRename](this, value); }
  get content_type(): string { return this.#package[packageMetadata](this).content_type; }
  get blob(): Uint8Array { const bytes = this.#package[packageMetadata](this).bytes; return new Uint8Array(bytes); }
  get rels(): Relationships { return this.#package[packageRelationships](this.partname.toString()); }
  get related_parts(): ReadonlyMap<string, PartView> { return this.rels.related_parts; }
  part_related_by(reltype: string): PartView { return this.rels.part_with_reltype(reltype); }
  relate_to(target: PartView | string, reltype: string, is_external = false): string { return is_external ? this.rels.get_or_add_ext_rel(reltype, target as string) : this.rels.get_or_add(reltype, target as PartView).rId; }
  load_rel(reltype: string, target: PartView | string, rId: string, is_external = false): void { this.rels.add_relationship(reltype, target, rId, is_external); }
  drop_rel(rId: string): void { this.rels.delete(rId); }
  target_ref(rId: string): string { return this.rels.at(rId).target_ref; }
  before_marshal(): void { this.#package[packageValidate](); }
  after_unmarshal(): void { this.#package[packageMetadata](this); this.#package[packageValidate](); }
}

export class XmlPartView extends PartView {
  protected static readonly nativeTypes: readonly string[] | undefined = undefined;
  static [validateNativePartType](part: XmlPartView, contentType: string): void {
    const type = parseMediaType(contentType);
    for (const owner of [StoryPart, HeaderPart, FooterPart, CommentsPart, SettingsPart, StylesPart, DocumentPartView, NumberingPart, CorePropertiesPartView] as readonly (typeof XmlPartView)[]) {
      if (part instanceof owner && owner.nativeTypes && !owner.nativeTypes.includes(type))
        throw new InputTypeError("The native part view does not match the admitted content type.");
    }
  }
  #element: XmlElementView | undefined;
  static override async load(partname: string | PackURI, content_type: string, blob: Uint8Array, owner: PackageView): Promise<XmlPartView> {
    if (!(owner instanceof PackageView) || !isXmlContentType(content_type)) throw new InputTypeError("Expected an admitted XML owner package and content type.");
    if (this.nativeTypes && !this.nativeTypes.includes(parseMediaType(content_type)))
      throw new InputTypeError("The content type does not match the native part role.");
    return owner[packageAdmitPart](partname, content_type, blob) as XmlPartView;
  }
  get element(): XmlElementView { return this.#element ??= this.package[packageBindXml](this); }
  get part(): this { this.package[packageMetadata](this); return this; }
}

export class StoryPart extends XmlPartView {
  static override async load(partname: string | PackURI, content_type: string, blob: Uint8Array, owner: PackageView): Promise<StoryPart> {
    if (!(owner instanceof PackageView) || typeof content_type !== "string" || !this.nativeTypes.includes(parseMediaType(content_type)))
      throw new InputTypeError("Expected an admitted owner and a native story content type.");
    return owner[packageAdmitPart](partname, content_type, blob) as StoryPart;
  }
  get next_id(): number {
    const { xml, budget } = this.package[packageReadXml](this);
    let maximum = 0;
    const pending = [xml.root];
    while (pending.length) {
      const node = pending.pop()!;
      budget.charge("work", 1 + node.attributes.length + node.children.length);
      for (const attribute of node.attributes) {
        if (attribute.namespace || attribute.localName !== "id" || !attribute.value.length ||
            [...attribute.value].some(char => char < "0" || char > "9")) continue;
        const value = Number(attribute.value);
        if (!Number.isSafeInteger(value) || value >= Number.MAX_SAFE_INTEGER)
          throw new ResourceLimitError("The story identifier range is exhausted.");
        maximum = Math.max(maximum, value);
      }
      pending.push(...node.children);
    }
    return maximum + 1;
  }
  get_style(style_id: string | null, style_type: DocxEnumValue<"WD_STYLE_TYPE">): BaseStyle {
    return this.package[packageModel](this).withStyleDefinitions(styles => {
      const style = styles.get_by_id(style_id, style_type);
      if (!style) throw new MissingKeyError("The requested style type has no default definition.");
      return style;
    }, this.partname.toString());
  }
  get_style_id(style_or_name: BaseStyle | string | null, style_type: DocxEnumValue<"WD_STYLE_TYPE">): string | null {
    return this.package[packageModel](this).withStyleDefinitions(styles => styles.get_style_id(style_or_name, style_type), this.partname.toString());
  }
  async get_or_add_image(input: ImageModelInput): Promise<readonly [string, Image]> {
    this.package[packageMetadata](this);
    const [id, image] = await this.package[packageStoryImage](this, input);
    return snapshotSequence([id, image] as const) as readonly [string, Image];
  }
  async new_pic_inline(input: ImageModelInput, width?: number | Length | null, height?: number | Length | null): Promise<XmlElementView> {
    const { budget, xml: ownerXml } = this.package[packageReadXml](this);
    const dialect = Object.values(documentDialects).find(dialect => dialect.w === ownerXml.root.namespace);
    if (!dialect) throw new InputTypeError("Expected an admitted native story owner.");
    const result = await this.package[packageStoryImage](this, input, (id, image) => {
      const [cx, cy] = image.scaled_dimensions(width, height), drawingId = this.next_id;
      if (drawingId > 4294967295) throw new ResourceLimitError("The drawing identifier range is exhausted.");
      const markup = inlineImageRun(dialect, drawingId, id, { width: cx.emu, height: cy.emu, crop: "" }, { filename: image.filename }).run;
      budget.charge("retainedBytes", markup.length * 3);
      let xml = new DocumentXmlEditor(new TextEncoder().encode(markup), {}, undefined, budget);
      const resolve = (document: DocumentXmlEditor) => {
        const drawing = document.root.children.find(node => node.namespace === dialect.w && node.localName === "drawing");
        const inline = drawing?.children.find(node => node.namespace === dialect.wp && node.localName === "inline");
        if (!inline) throw new StaleHandleError("The detached picture fragment is no longer available.");
        return inline;
      };
      return bindXmlElementView({ budget,
        read: () => { this.package[packageMetadata](this); return xml; }, resolve,
        change: action => {
          this.package[packageMetadata](this);
          const candidate = new DocumentXmlEditor(xml.serialize(), {}, undefined, budget);
          action(candidate);
          xml = new DocumentXmlEditor(candidate.serialize(), {}, undefined, budget);
        }
      });
    });
    return result[2]!;
  }

  protected static override readonly nativeTypes: readonly string[] = [
    ...Object.values(documentTypes),
    "application/vnd.openxmlformats-officedocument.wordprocessingml.header+xml",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.footer+xml",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.comments+xml"
  ];
}

export class HeaderPart extends StoryPart {
  static new(owner: PackageView): HeaderPart {
    if (!(owner instanceof PackageView)) throw new InputTypeError("Expected an admitted owner package.");
    return owner[packageCreateNative]("header") as HeaderPart;
  }
  protected static override readonly nativeTypes = ["application/vnd.openxmlformats-officedocument.wordprocessingml.header+xml"];
}
export class FooterPart extends StoryPart {
  static new(owner: PackageView): FooterPart {
    if (!(owner instanceof PackageView)) throw new InputTypeError("Expected an admitted owner package.");
    return owner[packageCreateNative]("footer") as FooterPart;
  }
  protected static override readonly nativeTypes = ["application/vnd.openxmlformats-officedocument.wordprocessingml.footer+xml"];
}
export class CommentsPart extends StoryPart {
  static override async load(partname: string | PackURI, content_type: string, blob: Uint8Array, owner: PackageView): Promise<CommentsPart> {
    if (!(owner instanceof PackageView) || typeof content_type !== "string" || !this.nativeTypes.includes(parseMediaType(content_type)))
      throw new InputTypeError("Expected an admitted owner and the native part content type.");
    return owner[packageAdmitPart](partname, content_type, blob) as CommentsPart;
  }
  #comments: Comments | undefined;
  get comments(): Comments { return this.#comments ??= this.package[packageModel](this).nativeComments(this); }
  static default(owner: PackageView): CommentsPart {
    if (!(owner instanceof PackageView)) throw new InputTypeError("Expected an admitted owner package.");
    return owner[packageCreateNative]("comments") as CommentsPart;
  }
  protected static override readonly nativeTypes = ["application/vnd.openxmlformats-officedocument.wordprocessingml.comments+xml"];
}
export class SettingsPart extends XmlPartView {
  static override async load(partname: string | PackURI, content_type: string, blob: Uint8Array, owner: PackageView): Promise<SettingsPart> {
    if (!(owner instanceof PackageView) || typeof content_type !== "string" || !this.nativeTypes.includes(parseMediaType(content_type)))
      throw new InputTypeError("Expected an admitted owner and the native part content type.");
    return owner[packageAdmitPart](partname, content_type, blob) as SettingsPart;
  }
  #settings: Settings | undefined;
  get settings(): Settings { return this.#settings ??= this.package[packageModel](this).nativeSettings(this); }
  static default(owner: PackageView): SettingsPart {
    if (!(owner instanceof PackageView)) throw new InputTypeError("Expected an admitted owner package.");
    return owner[packageCreateNative]("settings") as SettingsPart;
  }
  protected static override readonly nativeTypes = ["application/vnd.openxmlformats-officedocument.wordprocessingml.settings+xml"];
}
export class StylesPart extends XmlPartView {
  static override async load(partname: string | PackURI, content_type: string, blob: Uint8Array, owner: PackageView): Promise<StylesPart> {
    if (!(owner instanceof PackageView) || typeof content_type !== "string" || !this.nativeTypes.includes(parseMediaType(content_type)))
      throw new InputTypeError("Expected an admitted owner and the native part content type.");
    return owner[packageAdmitPart](partname, content_type, blob) as StylesPart;
  }
  #styles: Styles | undefined;
  #styleElement: (() => XmlElementView) | undefined;
  [packageBindStyles](styles: Styles, element: () => XmlElementView): void {
    if (this.#styles) throw new InvalidValueError("The styles part already has a live binding.");
    this.#styles = styles; this.#styleElement = element;
  }
  get styles(): Styles { return this.#styles ?? this.package[packageModel](this).nativeStyles(this); }
  override get element(): XmlElementView { return this.#styleElement ? this.#styleElement() : super.element; }
  static default(owner: PackageView): StylesPart {
    if (!(owner instanceof PackageView)) throw new InputTypeError("Expected an admitted owner package.");
    return owner[packageCreateNative]("styles") as StylesPart;
  }
  protected static override readonly nativeTypes = ["application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"];
}

export class DocumentPartView extends StoryPart {
  async save(output: DocumentOutput, options?: DocumentSaveOptions): Promise<void> {
    this.package[packageMetadata](this);
    await this.package.save(output, options);
  }
  protected static override readonly nativeTypes = Object.values(documentTypes);
  get document() { return this.package[packageModel](this).nativeDocument(this); }
  get comments() { return this.document.comments; }
  get settings() { return this.document.settings; }
  get styles() { return this.package[packageModel](this).stylesForDocument(this.partname.toString()); }
  get inline_shapes() { return this.document.inline_shapes; }
  get core_properties() { this.package[packageMetadata](this); return this.package.core_properties; }
  add_header_part(): readonly [HeaderPart, string] {
    const rId = this.package[packageNextRelationshipId](this);
    const part = this.package[packageCreateNative]("header", { owner: this, rId }) as HeaderPart;
    return snapshotSequence([part, rId] as const) as readonly [HeaderPart, string];
  }
  add_footer_part(): readonly [FooterPart, string] {
    const rId = this.package[packageNextRelationshipId](this);
    const part = this.package[packageCreateNative]("footer", { owner: this, rId }) as FooterPart;
    return snapshotSequence([part, rId] as const) as readonly [FooterPart, string];
  }
  header_part(rId: string): HeaderPart {
    const edge = this.rels.at(rId), dialect = Object.values(documentDialects).find(dialect => dialect.w === this.element.namespace)!;
    if (edge.is_external || edge.reltype !== `${dialect.r}/header` || !(edge.target_part instanceof HeaderPart))
      throw new InvalidValueError("Expected an owned native header relationship.");
    return edge.target_part;
  }
  footer_part(rId: string): FooterPart {
    const edge = this.rels.at(rId), dialect = Object.values(documentDialects).find(dialect => dialect.w === this.element.namespace)!;
    if (edge.is_external || edge.reltype !== `${dialect.r}/footer` || !(edge.target_part instanceof FooterPart))
      throw new InvalidValueError("Expected an owned native footer relationship.");
    return edge.target_part;
  }
  drop_header_part(rId: string): void {
    const part = this.header_part(rId), rows = this.package[packageEdges](this).filter(row => row.rId !== rId);
    this.package[packageEditRelationships](this, rows, part);
  }
  static override async load(partname: string | PackURI, content_type: string, blob: Uint8Array, owner: PackageView): Promise<DocumentPartView> {
    if (typeof content_type !== "string" || !Object.values(documentTypes).includes(parseMediaType(content_type))) throw new InputTypeError("Expected a macro-free document or template content type.");
    return await super.load(partname, content_type, blob, owner) as DocumentPartView;
  }
  get numbering_part(): NumberingPart {
    return this.package[packageNumbering](this);
  }
}

export class NumberingPart extends XmlPartView {
  protected static override readonly nativeTypes = ["application/vnd.openxmlformats-officedocument.wordprocessingml.numbering+xml"];
  #definitions: _NumberingDefinitions | undefined;
  static override async load(partname: string | PackURI, content_type: string, blob: Uint8Array, owner: PackageView): Promise<NumberingPart> {
    if (typeof content_type !== "string" || parseMediaType(content_type) !== "application/vnd.openxmlformats-officedocument.wordprocessingml.numbering+xml") throw new InputTypeError("Expected the numbering content type.");
    return await super.load(partname, content_type, blob, owner) as NumberingPart;
  }
  static new(owner: PackageView): NumberingPart {
    if (!(owner instanceof PackageView)) throw new InputTypeError("Expected an admitted owner package.");
    owner[packageValidate]();
    return owner[packageNumbering](owner.main_document_part);
  }
  get numbering_definitions(): _NumberingDefinitions {
    if (this.package[packageReadXml](this).xml.root.localName !== "numbering") throw new InvalidValueError("Expected an owned numbering root.");
    return this.#definitions ??= new _NumberingDefinitions(this);
  }
}

export class _NumberingDefinitions {
  constructor(private readonly owner: NumberingPart) {}
  get length(): number {
    const { xml, budget } = this.owner.package[packageReadXml](this.owner), root = xml.root;
    if (root.localName !== "numbering" ||
        (root.namespace !== documentDialects.transitional.w && root.namespace !== documentDialects.strict.w))
      throw new InvalidValueError("Expected an owned numbering root.");
    let count = 0;
    for (const node of activeXmlChildren(xml, budget)(root)) {
      budget.charge("work", 1);
      if (node.namespace === root.namespace && node.localName === "num") count++;
    }
    return count;
  }
}

export class CorePropertiesPartView extends XmlPartView {
  protected static override readonly nativeTypes = ["application/vnd.openxmlformats-package.core-properties+xml"];
  static default(owner: PackageView): CorePropertiesPartView {
    if (!(owner instanceof PackageView)) throw new InputTypeError("Expected an admitted owner package.");
    const part = owner.core_properties.part;
    if (!(part instanceof CorePropertiesPartView)) throw new InvalidValueError("Expected an owned core-properties part.");
    return part;
  }
  static override async load(partname: string | PackURI, content_type: string, blob: Uint8Array, owner: PackageView): Promise<CorePropertiesPartView> {
    if (typeof content_type !== "string" || asciiKey(content_type) !== "application/vnd.openxmlformats-package.core-properties+xml") throw new InputTypeError("Expected the core-properties content type.");
    return await super.load(partname, content_type, blob, owner) as CorePropertiesPartView;
  }
  #properties: CoreProperties | undefined;
  get core_properties(): CoreProperties { return this.#properties ??= this.package[packageCore](this); }
}

export class ImagePartView extends PartView {
  static override async load(partname: string | PackURI, content_type: string, blob: Uint8Array, owner: PackageView): Promise<ImagePartView> {
    if (!(owner instanceof PackageView)) throw new InputTypeError("Expected an admitted owner package.");
    return owner[packageLoadImage](partname, content_type, blob);
  }
  static async from_image(image: Image, partname: string | PackURI, owner: PackageView): Promise<ImagePartView> {
    if (!(image instanceof Image) || !(owner instanceof PackageView)) throw new InputTypeError("Expected an admitted image and owner package.");
    return owner[packageLoadImage](partname, image.content_type, image);
  }
  get image(): Image { return this.package[packageImage](this); }
  get filename(): string { return this.image.filename; }
  get sha1(): string { return this.image.sha1; }
  get default_cx(): Length { return this.image.width; }
  get default_cy(): Length { return this.image.height; }
}

export class ImageParts implements Iterable<ImagePartView> {
  readonly #package: PackageView;
  constructor(owner: PackageView) { this.#package = owner; }
  get length(): number { return this.#package[packageImages]().length; }
  [Symbol.iterator](): IterableIterator<ImagePartView> { return this.#package[packageImages]()[Symbol.iterator](); }
  has(item: unknown): boolean { return this.#package[packageImages]().includes(item as ImagePartView); }
  append(item: ImagePartView): void {
    if (!(item instanceof ImagePartView)) throw new InputTypeError("Expected an image part.");
    if (item.package !== this.#package) throw new OwnershipError("Expected an image part owned by this package.");
    this.#package[packageMetadata](item);
  }
  async get_or_add_image_part(input: ImageModelInput): Promise<ImagePartView> {
    const part = await this.#package.get_or_add_image_part(input);
    if (!this.has(part)) throw new InvalidValueError("Image admission lost collection ownership.");
    return part;
  }
}


const coreStrings = ["title", "subject", "author", "keywords", "comments", "last_modified_by", "category", "content_status", "identifier", "language", "version"] as const;
const coreDates = ["created", "modified", "last_printed"] as const;
function coreKey(name: string): string { return ({ last_modified_by: "lastModifiedBy", content_status: "contentStatus", last_printed: "lastPrinted" } as Record<string, string>)[name] ?? name; }

export class CoreProperties {
  declare title: string; declare subject: string; declare author: string; declare keywords: string; declare comments: string;
  declare last_modified_by: string; declare category: string; declare content_status: string; declare identifier: string; declare language: string; declare version: string;
  declare created: Date | null; declare modified: Date | null; declare last_printed: Date | null;
  declare revision: number;
  readonly #part: XmlPartView;
  readonly #budget: DocumentBudget;
  constructor(part: XmlPartView, budget: DocumentBudget) { this.#part = part; this.#budget = budget; }
  get part(): XmlPartView { return this.#part; }
  get element(): XmlElementView { return this.#part.element; }
  [coreRead](name: string): string | number | Date | null {
    const xml = new DocumentXmlEditor(this.#part.blob, {}, undefined, this.#budget), key = coreKey(name), declaration = corePropertyKeys[key]!;
    const properties = readPropertyNodes(xml.root, "core", "transitional", this.#budget);
    const value = properties.find(property => property.name === key);
    if (declaration.type === "integer") {
      const raw = value?.node.text ?? "";
      return raw && [...raw].every(char => "0123456789".includes(char)) && Number.isSafeInteger(Number(raw)) ? Number(raw) : 0;
    }
    if (declaration.type === "date") return typeof value?.value?.value === "string" ? new Date(value.value.value) : null;
    return typeof value?.value?.value === "string" ? value.value.value : "";
  }
  [coreWrite](name: string, value: unknown): void {
    const declaration = corePropertyKeys[coreKey(name)]!;
    let text: string;
    if (declaration.type === "string") {
      if (typeof value !== "string" || !validateDocxValue("string", value)) throw new InputTypeError("Expected a core-property string.");
      if ([...value].length > 255) throw new InvalidValueError("Core-property strings exceed 255 scalar values.");
      text = value;
    } else if (declaration.type === "integer") {
      if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 1) throw new InvalidValueError("Expected a positive safe revision.");
      text = serializePropertyScalar(value, "revision");
    } else {
      if (!(value instanceof Date) || !Number.isFinite(Date.prototype.getTime.call(value))) throw new InputTypeError("Expected a valid explicit UTC Date.");
      text = normalizePropertyDate(new Date(Math.floor(Date.prototype.getTime.call(value) / 1000) * 1000).toISOString());
    }
    const view = this.#part.element;
    const matching = view.children.filter(node => node.tag.namespaceURI === declaration.namespace && node.tag.localName === declaration.localName);
    if (matching.length > 1) throw new InvalidValueError("Core property is ambiguous.");
    if (matching.length) matching[0]![replaceXmlScalar](text);
    else view.insert(view.children.length, { kind: "element", name: { namespaceURI: declaration.namespace, localName: declaration.localName },
      ...(declaration.type === "date" && declaration.namespace !== corePropertyNamespace ? { attributes: [{ name: { namespaceURI: "http://www.w3.org/2001/XMLSchema-instance", localName: "type" }, value: "dcterms:W3CDTF" }] } : {}),
      children: [{ kind: "text", text }] });
  }
}
for (const name of [...coreStrings, ...coreDates, "revision"] as const) Object.defineProperty(CoreProperties.prototype, name, {
  get(this: CoreProperties) { return this[coreRead](name); },
  set(this: CoreProperties, value: unknown) { this[coreWrite](name, value); }, enumerable: true
});

interface RelationshipRow { readonly rId: string; readonly reltype: string; readonly target_ref: string; readonly is_external: boolean }

export class RelationshipView {
  readonly #collection: Relationships;
  readonly #id: string;
  readonly #token: object;
  constructor(collection: Relationships, id: string, token: object) { this.#collection = collection; this.#id = id; this.#token = token; Object.freeze(this); }
  belongs(collection: Relationships): boolean { return this.#collection === collection; }
  belongsPackage(owner: PackageView): boolean { return this.#collection.package === owner; }
  private row(): PackageRelationship { return this.#collection.row(this.#id, this.#token); }
  get rId(): string { return this.row().rId; }
  get reltype(): string { return this.row().reltype; }
  get target_ref(): string { return this.row().target_ref; }
  get is_external(): boolean { return this.row().is_external; }
  get target_part(): PartView {
    const row = this.row();
    if (row.is_external) throw new InvalidValueError("External relationships have no owned target part.");
    return this.#collection.package[packagePart](row.target_part.partname);
  }
}

/** Relationship keys are owner-local IDs, never positional indexes. */
export class Relationships implements Iterable<string> {
  readonly #package: PackageView;
  readonly #owner: PartView | null;
  readonly #views = new Map<string, { token: object; view: RelationshipView }>();
  constructor(ownerPackage: PackageView, owner: PartView | null) { this.#package = ownerPackage; this.#owner = owner; }
  get package(): PackageView { return this.#package; }
  [invalidateRelationshipViews](ids: ReadonlySet<string>): void { for (const id of ids) this.#views.delete(id); }
  private rows(): readonly PackageRelationship[] { return this.#package[packageEdges](this.#owner); }
  row(id: string, token: object): PackageRelationship {
    const row = this.rows().find(row => row.rId === id);
    if (!row || this.#views.get(id)?.token !== token) throw new StaleHandleError("The relationship view is detached.");
    return row;
  }
  private view(row: PackageRelationship): RelationshipView {
    let record = this.#views.get(row.rId);
    if (!record) { const token = {}; record = { token, view: new RelationshipView(this, row.rId, token) }; this.#views.set(row.rId, record); }
    return record.view;
  }
  get length(): number { return this.rows().length; }
  has(id: string): boolean { if (typeof id !== "string") throw new InputTypeError("Expected a relationship ID."); return this.rows().some(row => row.rId === id); }
  get(id: string, defaultValue: RelationshipView | null = null): RelationshipView | null {
    if (typeof id !== "string") throw new InputTypeError("Expected a relationship ID.");
    if (defaultValue !== null && !(defaultValue instanceof RelationshipView)) throw new InputTypeError("Expected a relationship default or null.");
    const row = this.rows().find(row => row.rId === id);
    return row ? this.view(row) : defaultValue;
  }
  at(id: string): RelationshipView { const view = this.get(id); if (!view) throw new MissingKeyError("Relationship ID was not found."); return view; }
  *keys(): IterableIterator<string> { for (const row of this.rows()) yield row.rId; }
  *values(): IterableIterator<RelationshipView> { for (const row of this.rows()) yield this.view(row); }
  *items(): IterableIterator<readonly [string, RelationshipView]> { for (const row of this.rows()) yield snapshotSequence([row.rId, this.view(row)] as const) as readonly [string, RelationshipView]; }
  [Symbol.iterator](): IterableIterator<string> { return this.keys(); }
  get related_parts(): ReadonlyMap<string, PartView> { return new Map([...this.values()].filter(edge => !edge.is_external).map(edge => [edge.rId, edge.target_part])); }
  get xml(): string { return this.#package[packageRelationshipXml](this.#owner); }
  add_relationship(reltype: string, target: PartView | string, rId: string, is_external = false): RelationshipView {
    if (typeof reltype !== "string" || typeof rId !== "string" || !rId || typeof is_external !== "boolean") throw new InputTypeError("Expected relationship metadata.");
    reltype = collapseRelationshipScalar(reltype);
    rId = collapseRelationshipScalar(rId);
    if (this.has(rId)) throw new InvalidValueError("Relationship ID is already occupied.");
    let target_ref: string;
    if (is_external) { if (typeof target !== "string") throw new InputTypeError("Expected an inert external target string."); target_ref = collapseRelationshipScalar(target); }
    else {
      if (!(target instanceof PartView)) throw new InputTypeError("Expected a target part.");
      if (target.package !== this.#package) throw new OwnershipError("Expected a target owned by this package.");
      target_ref = relativePartTarget(this.#owner?.partname.toString() ?? "/", target.partname.toString());
    }
    this.#package[packageEditRelationships](this.#owner, [...this.rows(), { rId, reltype, target_ref, is_external }]);
    return this.at(rId);
  }
  get_or_add(reltype: string, target_part: PartView): RelationshipView {
    if (typeof reltype !== "string") throw new InputTypeError("Expected a relationship type.");
    reltype = collapseRelationshipScalar(reltype);
    if (!(target_part instanceof PartView)) throw new InputTypeError("Expected a target part.");
    if (target_part.package !== this.#package) throw new OwnershipError("Expected an owned target part.");
    const found = [...this.values()].find(row => !row.is_external && row.reltype === reltype && row.target_part === target_part);
    return found ?? this.add_relationship(reltype, target_part, this.#package[packageNextRelationshipId](this.#owner));
  }
  get_or_add_ext_rel(reltype: string, target_ref: string): string {
    if (typeof reltype !== "string" || typeof target_ref !== "string") throw new InputTypeError("Expected relationship URI strings.");
    reltype = collapseRelationshipScalar(reltype);
    target_ref = collapseRelationshipScalar(target_ref);
    const found = [...this.values()].find(row => row.is_external && row.reltype === reltype && row.target_ref === target_ref);
    return found?.rId ?? this.add_relationship(reltype, target_ref, this.#package[packageNextRelationshipId](this.#owner), true).rId;
  }
  part_with_reltype(reltype: string): PartView {
    if (typeof reltype !== "string") throw new InputTypeError("Expected a relationship type.");
    const rows = [...this.values()].filter(row => row.reltype === reltype && !row.is_external);
    if (!rows.length) throw new MissingKeyError("Relationship type was not found.");
    if (rows.length !== 1) throw new InvalidValueError("Relationship type is ambiguous.");
    return rows[0]!.target_part;
  }
  delete(id: string): void {
    this.at(id);
    this.#package[packageEditRelationships](this.#owner, this.rows().filter(row => row.rId !== id));
    this.#views.delete(id);
  }
  clear(): void { this.#package[packageEditRelationships](this.#owner, []); this.#views.clear(); }
  set(id: string, value: RelationshipView): void {
    this.#package[packageEditRelationships](this.#owner, this.assignedRows([[id, value]]));
  }
  private assignedRows(entries: Iterable<readonly [string, RelationshipView]>): RelationshipRow[] {
    if (entries == null || typeof entries === "string" || typeof entries[Symbol.iterator] !== "function") throw new InputTypeError("Expected iterable relationship entries.");
    const replacements = new Map<string, RelationshipRow>();
    for (const entry of entries) {
      if (!Array.isArray(entry) || entry.length !== 2) throw new InputTypeError("Expected a relationship key and value pair.");
      const [id, value] = entry;
      if (!(value instanceof RelationshipView) || typeof id !== "string" || id !== value.rId || replacements.has(id)) throw new InputTypeError("Expected matching relationship entries.");
      if (!value.belongsPackage(this.#package)) throw new OwnershipError("Expected same-package relationship entries.");
      let target_ref = value.target_ref;
      if (!value.is_external && !value.belongs(this)) {
        const hash = target_ref.indexOf("#");
        target_ref = relativePartTarget(this.#owner?.partname.toString() ?? "/", value.target_part.partname.toString()) + (hash < 0 ? "" : target_ref.slice(hash));
      }
      replacements.set(id, { rId: id, reltype: value.reltype, is_external: value.is_external, target_ref });
    }
    const rows: RelationshipRow[] = this.rows().map(row => replacements.get(row.rId) ?? row);
    for (const [id, row] of replacements) if (!rows.some(existing => existing.rId === id)) rows.push(row);
    return rows;
  }
  update(entries: Iterable<readonly [string, RelationshipView]>): void { this.#package[packageEditRelationships](this.#owner, this.assignedRows(entries)); }
  setdefault(id: string, value: RelationshipView): RelationshipView {
    if (!(value instanceof RelationshipView)) throw new InputTypeError("Expected a relationship default.");
    const existing = this.get(id);
    if (existing) return existing;
    this.update([[id, value]]);
    return this.at(id);
  }
  pop(id: string, fallback?: RelationshipView | null): RelationshipView | null {
    if (fallback !== undefined && fallback !== null && !(fallback instanceof RelationshipView)) throw new InputTypeError("Expected a relationship default or null.");
    const found = this.get(id);
    if (!found) {
      if (fallback !== undefined) return fallback;
      throw new MissingKeyError("Relationship ID was not found.");
    }
    this.delete(id);
    return found;
  }
  popitem(): readonly [string, RelationshipView] { const id = [...this.keys()].at(-1); if (id === undefined) throw new MissingKeyError("Relationship collection is empty."); return snapshotSequence([id, this.pop(id)!] as const) as readonly [string, RelationshipView]; }
  copy(): ReadonlyMap<string, RelationshipView> { return new Map(this.items()); }
}

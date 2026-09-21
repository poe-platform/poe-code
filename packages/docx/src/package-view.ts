import { archiveSettings, InputTypeError, InvalidValueError, ResourceLimitError, type ArchiveContext, type DocumentArchive } from "./archive.js";
import { DocumentPackage, type PackagePart, type PackageRelationship } from "./package.js";
import { validateDocumentArchive, SemanticValidationError } from "./validation.js";
import { MissingKeyError, StaleHandleError } from "./model-errors.js";
import { PublicationError } from "./publication.js";
import { DocumentXmlEditor, UnsupportedEditError } from "./xml-write.js";
import { bindXmlElementView, type XmlElementView } from "./xml-element-view.js";
import { PackURI } from "./pack-uri.js";
import { asciiKey, normalizePartName, relativePartTarget } from "./part-uri.js";
import { xmlValue } from "./create-content.js";
import type { DocumentModelOutput } from "./model-output.js";
import { corePropertyKeys, corePropertyNamespace, readPropertyNodes, serializePropertyScalar, normalizePropertyDate } from "./property-values.js";
import { createPropertyPart } from "./property-part.js";
import { documentDialects, type DocumentDialect } from "./dialect.js";
import { validateDocxValue } from "./operation-schema.js";
import type { DocumentBudget } from "./budget.js";
import { parseDocumentXml } from "./package-xml.js";
import { Image, type ImageModelInput, type ImageModelContext } from "./image-model.js";
import { acquireDocumentModelInput, type DocumentModelInput } from "./model-input.js";
import { modelContext } from "./model-context.js";
import { readDocumentArchive } from "./admission.js";
import type { DocumentModelContext } from "./model-context.js";
import type { Length } from "./formatting-values.js";
import { Comments } from "./review-model.js";
import { Settings } from "./settings-model.js";
import { inlineImageRun } from "./inline-image-xml.js";
import { runElementOpen } from "./run-properties.js";
import type { DocumentView } from "./document-model.js";
import type { bindDocumentStyles, BaseStyle, StylePartView, Styles } from "./styles-model.js";
import { originalModelDefaults } from "./default-model-styles.js";
import type { DocxEnumValue } from "./operation-types.js";

const relNamespace = "http://schemas.openxmlformats.org/package/2006/relationships";
const relContentType = "application/vnd.openxmlformats-package.relationships+xml";
const packageRegister = Symbol("register");
/** Internal resolution of admitted owned parts, including unattached defaults. */
export const packageOwnedPart = Symbol("part");
const packageMetadata = Symbol("metadata");
const packageRelationships = Symbol("relationships");
const packageEdges = Symbol("edges");
const packageRelationshipXml = Symbol("relationshipXml");
const packageEditRelationships = Symbol("editRelationships");
const packageBindXml = Symbol("bindXml");
const packageRename = Symbol("rename");
const packageValidate = Symbol("validate");
const packageAdmitPart = Symbol("admit-part");
const packageCore = Symbol("core-properties");
const coreRead = Symbol("core-read");
const coreWrite = Symbol("core-write");
const packageImage = Symbol("image");
const packageImages = Symbol("images");
const packageDocument = Symbol("document");
export const packageAdmittedImage = Symbol("admitted-image");
const packageDefaultPart = Symbol("default-part");
/** Internal original styles-part factory over the same admitted package. */
export const packageDefaultStyles = Symbol("default-styles");
/** Internal cache-only reuse of a typed styles owner. */
export const packageCachedStyles = Symbol("cached-styles");
/** Internal admission hook; never a batch callback or public barrel export. */
export const packageAdmitImages = Symbol("admit-images");
/** Internal binding of a characterized image to the same admitted package bytes. */
export const packageBindImage = Symbol("bind-image");
/** Internal transaction checkpoint; preserves package and retained part identities. */
export const packageOwnerCheckpoint = Symbol("owner-checkpoint");
/** Internal removal invalidates the owner before a name can be reused. */
export const packageInvalidatePart = Symbol("invalidate-part");
const packageLoadImage = Symbol("load-image");
const partNames = new WeakMap<PartView, string>();

/** Internal binding to the admitted model; publication remains with that owner. */
export interface PackageViewBinding {
  readonly context: ArchiveContext;
  document?(partname?: string): DocumentView;
  stylesPart?(partname: string): StylePartView;
  snapshot(): DocumentArchive;
  stage(archive: DocumentArchive, rename?: { from: string; to: string }): void;
  version(): number;
  writable(): void;
  save(sink: DocumentModelOutput): Promise<void>;
}

function relationshipName(owner: string): string {
  if (owner === "/") return "_rels/.rels";
  const uri = new PackURI(owner);
  return uri.rels_uri.membername;
}
function xmlType(type: string): boolean { return ["application/xml", "text/xml"].includes(type.toLowerCase()) || type.toLowerCase().endsWith("+xml"); }

/** Live bounded graph over the same document state as style and command edits. */
export class PackageView {
  readonly #binding: PackageViewBinding;
  readonly #parts = new Map<string, PartView>();
  readonly #relationships = new Map<string, Relationships>();
  #revision = 0;
  #cached: { version: string; archive: DocumentArchive; graph: DocumentPackage } | undefined;
  #imageParts: ImageParts | undefined;
  readonly #images = new Map<string, Image>();
  constructor(binding: PackageViewBinding) { this.#binding = binding; }
  static async open(input: DocumentModelInput, context?: DocumentModelContext): Promise<PackageView> {
    const settings = modelContext(context);
    const bytes = await acquireDocumentModelInput(input, settings);
    const archive = await readDocumentArchive(bytes, settings);
    const { bindAdmittedDocument } = await import("./document-model.js");
    const document = await bindAdmittedDocument(archive, settings);
    const owner = document.part.package;
    owner.after_unmarshal();
    return owner;
  }
  [packageCachedStyles](partname: string): Styles | undefined {
    const part = this.#parts.get(asciiKey(normalizePartName(partname)));
    return part instanceof XmlPartView && "styles" in part ? (part as StylePartView).styles : undefined;
  }
  [packageDefaultStyles](bindStyles: typeof bindDocumentStyles): StylePartView {
    const name = this.next_partname("/word/styles%d.xml").toString();
    const namespace = this.main_document_part.element.namespace;
    return this[packageAdmitPart](name, "application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml", new TextEncoder().encode(`<w:styles xmlns:w="${namespace}">${originalModelDefaults(namespace)}</w:styles>`), partname => {
      const binding: { part?: StylePartView } = {};
      binding.part = bindStyles({
      context: this.#binding.context,
      package: this,
      partname,
      read: () => this.current().graph.getPart(binding.part?.partname.toString() ?? partname).bytes,
      write: bytes => {
        this.#binding.writable();
        const { archive } = this.current();
        const metadata = this.current().graph.getPart(binding.part?.partname.toString() ?? partname);
        this.commit({ ...archive, members: archive.members.map(member => "/" + member.name === metadata.partname ? { ...member, bytes } : member) });
      },
      writable: () => this.#binding.writable()
    }).part;
      return binding.part;
    }) as StylePartView;
  }
  [packageDefaultPart](kind: "header" | "footer" | "comments" | "settings"): XmlPartView {
    this.#binding.writable();
    const namespace = this.main_document_part.element.namespace;
    const localName = ({ header: "hdr", footer: "ftr", comments: "comments", settings: "settings" })[kind];
    const name = this.next_partname(`/word/${kind}%d.xml`);
    const emptyParagraph = kind === "header" || kind === "footer" ? "<ds:p/>" : "";
    return this[packageAdmitPart](name, `application/vnd.openxmlformats-officedocument.wordprocessingml.${kind}+xml`, new TextEncoder().encode(`<ds:${localName} xmlns:ds="${namespace}">${emptyParagraph}</ds:${localName}>`)) as XmlPartView;
  }
  get revision(): number { return this.#revision; }
  [packageDocument](partname?: string): DocumentView {
    if (!this.#binding.document) throw new UnsupportedEditError("This package owner has no live document binding.");
    return this.#binding.document(partname);
  }
  [packageInvalidatePart](name: string): void {
    const key = asciiKey(normalizePartName(name));
    const part = this.#parts.get(key);
    if (part) partNames.delete(part);
    this.#parts.delete(key);
    this.#relationships.delete(key);
    this.#images.delete(normalizePartName(name));
    this.#revision++;
    this.#cached = undefined;
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
  [packageRegister](part: PartView, name: string): void {
    name = normalizePartName(name);
    if (this.#parts.has(asciiKey(name))) throw new InvalidValueError("The part already has an owner view.");
    partNames.set(part, name);
    this.#parts.set(asciiKey(name), part);
  }
  [packageOwnedPart](name: string): PartView {
    const metadata = this.current().graph.getPart(name), key = asciiKey(metadata.partname);
    let part = this.#parts.get(key);
    if (!part) {
      part = metadata.content_type.startsWith("image/") ? new ImagePartView(this, metadata.partname)
        : metadata.content_type === "application/vnd.openxmlformats-package.core-properties+xml" ? new CorePropertiesPartView(this, metadata.partname)
        : metadata.content_type === "application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml" ? new DocumentPartView(this, metadata.partname)
        : metadata.content_type === "application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml" && this.#binding.stylesPart ? this.#binding.stylesPart(metadata.partname)
        : metadata.content_type === "application/vnd.openxmlformats-officedocument.wordprocessingml.numbering+xml" ? new NumberingPart(this, metadata.partname)
        : metadata.content_type === "application/vnd.openxmlformats-officedocument.wordprocessingml.settings+xml" ? new SettingsPartView(this, metadata.partname)
        : metadata.content_type === "application/vnd.openxmlformats-officedocument.wordprocessingml.comments+xml" ? new CommentsPartView(this, metadata.partname)
        : metadata.content_type === "application/vnd.openxmlformats-officedocument.wordprocessingml.header+xml" ? new HeaderPart(this, metadata.partname)
        : metadata.content_type === "application/vnd.openxmlformats-officedocument.wordprocessingml.footer+xml" ? new FooterPart(this, metadata.partname)
        : xmlType(metadata.content_type) ? new XmlPartView(this, metadata.partname) : new PartView(this, metadata.partname);
    }
    return part;
  }
  [packageMetadata](part: PartView): PackagePart {
    if (part.package !== this || !partNames.has(part)) throw new InputTypeError("Expected a part owned by this package.");
    const metadata = this.current().graph.getPart(partNames.get(part)!);
    const budget = archiveSettings(this.#binding.context).budget;
    budget.charge("retainedBytes", metadata.bytes.length); budget.charge("work", metadata.bytes.length);
    return { ...metadata, bytes: new Uint8Array(metadata.bytes), modified: new Date(metadata.modified.getTime()) };
  }
  get parts(): readonly PartView[] { return Object.freeze([...this.iter_parts()]); }
  *iter_parts(): IterableIterator<PartView> { for (const part of this.current().graph.iterParts()) yield this[packageOwnedPart](part.partname); }
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
  [packageImages](): readonly ImagePartView[] { return this.current().graph.parts.filter(part => part.content_type.startsWith("image/")).map(part => this[packageOwnedPart](part.partname) as ImagePartView); }
  [packageImage](part: ImagePartView): Image {
    const image = this.#images.get(this[packageMetadata](part).partname);
    if (!image) throw new UnsupportedEditError("This image part has no admitted bounded raster characterization.");
    return image;
  }
  [packageBindImage](part: ImagePartView, image: Image): void {
    if (!(part instanceof ImagePartView) || !(image instanceof Image)) throw new InputTypeError("Expected an owned image part and characterized image.");
    const metadata = this[packageMetadata](part), bytes = image.blob;
    if (metadata.content_type !== image.content_type || metadata.bytes.length !== bytes.length ||
        !metadata.bytes.every((byte, i) => byte === bytes[i]))
      throw new InvalidValueError("Image characterization conflicts with the owned part bytes.");
    this.#images.set(metadata.partname, image);
  }
  async [packageAdmitImages](): Promise<void> {
    for (const part of this[packageImages]()) {
      if (!["image/png", "image/jpeg", "image/gif", "image/bmp", "image/tiff"].includes(part.content_type)) continue;
      try {
        const image = await Image.from_blob(part.blob, this.#binding.context as ImageModelContext);
        if (image.content_type === part.content_type) this.#images.set(part.partname.toString(), image);
      } catch (error) {
        if (!(error instanceof UnsupportedEditError)) throw error;
      }
    }
  }
  async [packageLoadImage](name: string | PackURI, contentType: string, bytes: Uint8Array | Image): Promise<ImagePartView> {
    this.#binding.writable();
    const revision = this.#revision, ownerVersion = this.#binding.version();
    const image = bytes instanceof Image ? await Image.from_blob(bytes.blob, this.#binding.context as ImageModelContext) : await Image.from_blob(bytes, this.#binding.context as ImageModelContext);
    if (revision !== this.#revision || ownerVersion !== this.#binding.version()) throw new PublicationError("conflict", "Package changed during image admission.");
    if (image.content_type !== contentType) throw new InvalidValueError("Image part content type conflicts with its byte signature.");
    const part = this[packageAdmitPart](name, contentType, image.blob) as ImagePartView;
    this.#images.set(part.partname.toString(), image);
    return part;
  }
  async get_or_add_image_part(input: ImageModelInput): Promise<ImagePartView> {
    this.#binding.writable();
    const revision = this.#revision, ownerVersion = this.#binding.version();
    const image = await Image.from_file(input, this.#binding.context as ImageModelContext);
    if (revision !== this.#revision || ownerVersion !== this.#binding.version()) throw new PublicationError("conflict", "Package changed during image admission.");
    return this[packageAdmittedImage](image);
  }
  [packageAdmittedImage](image: Image): ImagePartView {
    this.#binding.writable();
    const bytes = image.blob;
    for (const part of this[packageImages]()) {
      if (part.content_type !== image.content_type) continue;
      const candidate = part.blob;
      if (candidate.length === bytes.length && candidate.every((value, index) => value === bytes[index])) return part;
    }
    const name = this.next_partname(`/word/media/image%d.${image.ext}`);
    const part = this[packageAdmitPart](name, image.content_type, bytes) as ImagePartView;
    this.#images.set(part.partname.toString(), image);
    return part;
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
      const timestamp = context.timestamp ?? new Date("1980-01-01T00:00:00Z");
      if (!(timestamp instanceof Date) || !Number.isFinite(Date.prototype.getTime.call(timestamp))) throw new InputTypeError("Expected admitted core-property metadata.");
      const modified = new Date(Math.floor(Date.prototype.getTime.call(timestamp) / 1000) * 1000).toISOString();
      const metadata = new TextEncoder().encode(`<cp:coreProperties xmlns:cp="${corePropertyNamespace}" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><dc:title>Document</dc:title><cp:lastModifiedBy>${xmlValue(context.author ?? "")}</cp:lastModifiedBy><cp:revision>1</cp:revision><dcterms:modified xsi:type="dcterms:W3CDTF">${modified}</dcterms:modified></cp:coreProperties>`);
      created.archive = { ...created.archive, members: created.archive.members.map(member => member.name === created.name.slice(1) ? { ...member, bytes: metadata } : member) };
      this.commit(created.archive);
      part = this[packageOwnedPart](created.name) as CorePropertiesPartView;
    }
    if (!(part instanceof CorePropertiesPartView)) throw new InvalidValueError("Core-properties relationship has an incompatible target.");
    return part.core_properties;
  }
  [packageCore](part: XmlPartView): CoreProperties {
    return new CoreProperties(part, archiveSettings(this.#binding.context).budget);
  }
  [packageAdmitPart](name: string | PackURI, content_type: string, input: Uint8Array, bind?: (partname: string) => PartView): PartView {
    this.#binding.writable();
    if (!(input instanceof Uint8Array) || typeof content_type !== "string" || !content_type) throw new InputTypeError("Expected owned part bytes and a content type.");
    name = normalizePartName(name instanceof PackURI ? name.toString() : name);
    const { archive, graph } = this.current(), settings = archiveSettings(this.#binding.context);
    if (graph.parts.some(part => asciiKey(part.partname) === asciiKey(name as string))) throw new InvalidValueError("The part name is already occupied.");
    if (input.length > settings.limits.maxEntryBytes) throw new ResourceLimitError("Part bytes exceed the admitted ceiling.");
    settings.budget.charge("retainedBytes", input.length); settings.budget.charge("work", input.length);
    const bytes = new Uint8Array(input), types = archive.members.find(member => asciiKey(member.name) === "[content_types].xml")!;
    if (xmlType(content_type)) new DocumentXmlEditor(bytes, {}, undefined, settings.budget);
    const xml = new DocumentXmlEditor(types.bytes, {}, undefined, settings.budget);
    xml.insertChildren(xml.root, `<Override xmlns="http://schemas.openxmlformats.org/package/2006/content-types" PartName="${xmlValue(name)}" ContentType="${xmlValue(content_type)}"/>`);
    const members = archive.members.map(member => member === types ? { ...member, bytes: xml.serialize() } : member);
    members.push({ name: name.slice(1), bytes, directory: false, modified: new Date("1980-01-01T00:00:00Z") });
    this.commit({ ...archive, members });
    return bind ? bind(name) : this[packageOwnedPart](name);
  }
  get main_document_part(): DocumentPartView {
    const edges = [...this.rels.values()].filter(edge => edge.reltype.endsWith("/officeDocument") && !edge.is_external);
    if (edges.length !== 1 || !(edges[0]!.target_part instanceof DocumentPartView)) throw new InvalidValueError("Expected one XML document part.");
    return edges[0]!.target_part as DocumentPartView;
  }
  [packageRelationships](owner: string): Relationships {
    const key = owner === "/" ? "/" : asciiKey(this.current().graph.getPart(owner).partname);
    let rels = this.#relationships.get(key);
    if (!rels) { rels = new Relationships(this, owner === "/" ? null : this[packageOwnedPart](owner)); this.#relationships.set(key, rels); }
    return rels;
  }
  [packageEdges](owner: PartView | null): readonly PackageRelationship[] { return this.current().graph.relationships(owner ? this[packageMetadata](owner).partname : "/"); }
  [packageRelationshipXml](owner: PartView | null): string {
    const name = relationshipName(owner ? this[packageMetadata](owner).partname : "/");
    const bytes = this.current().archive.members.find(member => member.name === name)?.bytes ?? new TextEncoder().encode(`<Relationships xmlns="${relNamespace}"/>`);
    const budget = archiveSettings(this.#binding.context).budget;
    budget.charge("work", bytes.length); budget.charge("retainedBytes", bytes.length);
    const document = parseDocumentXml(bytes, {}, budget);
    return new TextDecoder(document.encoding, { fatal: true }).decode(bytes);
  }
  [packageEditRelationships](owner: PartView | null, rows: readonly RelationshipRow[]): void {
    this.#binding.writable();
    const { archive } = this.current(), settings = archiveSettings(this.#binding.context);
    const name = relationshipName(owner ? this[packageMetadata](owner).partname : "/");
    const existing = archive.members.find(member => member.name === name);
    let bytes = existing?.bytes ?? new TextEncoder().encode(`<Relationships xmlns="${relNamespace}"/>`);
    const previous = this[packageEdges](owner);
    const pending = new Map(rows.map(row => [row.rId, row]));
    if (pending.size !== rows.length) throw new InvalidValueError("Duplicate relationship IDs.");
    const removed = new Set(previous.filter(row => !pending.has(row.rId)).map(row => row.rId));
    if (owner && removed.size) {
      const metadata = this[packageMetadata](owner);
      if (xmlType(metadata.content_type)) {
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
      const xml = new DocumentXmlEditor(bytes, {}, undefined, settings.budget);
      const node = xml.root.children.find(node => node.attributes.some(attribute => attribute.localName === "Id" && attribute.value === row.rId))!;
      if (!replacement) xml.replaceElement(node, "");
      else {
        const values = { Type: replacement.reltype, Target: replacement.target_ref, TargetMode: replacement.is_external ? "External" : null };
        for (const [localName, value] of Object.entries(values)) {
          const old = node.attributes.find(attribute => attribute.localName === localName && !attribute.namespace)?.value ?? null;
          if (old === value) continue;
          const fieldEditor = new DocumentXmlEditor(bytes, {}, undefined, settings.budget);
          const fieldNode = fieldEditor.root.children.find(node => node.attributes.some(attribute => attribute.localName === "Id" && attribute.value === row.rId))!;
          fieldEditor.setQualifiedAttribute(fieldNode, { namespace: "", localName }, value);
          bytes = fieldEditor.serialize();
        }
      }
      if (!replacement) bytes = xml.serialize();
      pending.delete(row.rId);
    }
    for (const row of pending.values()) {
      const xml = new DocumentXmlEditor(bytes, {}, undefined, settings.budget);
      xml.insertChildren(xml.root, `<Relationship xmlns="${relNamespace}" Id="${xmlValue(row.rId)}" Type="${xmlValue(row.reltype)}" Target="${xmlValue(row.target_ref)}"${row.is_external ? ' TargetMode="External"' : ""}/>`);
      bytes = xml.serialize();
    }
    const members = archive.members.map(member => member === existing ? { ...member, bytes } : member);
    if (!existing) members.push({ name, bytes, directory: false, modified: new Date("1980-01-01T00:00:00Z") });
    this.commit({ ...archive, members });
  }
  [packageBindXml](part: PartView): XmlElementView {
    return bindXmlElementView({ budget: archiveSettings(this.#binding.context).budget,
      read: () => new DocumentXmlEditor(this[packageMetadata](part).bytes, {}, undefined, archiveSettings(this.#binding.context).budget),
      resolve: xml => xml.root,
      change: action => {
        this.#binding.writable();
        const metadata = this[packageMetadata](part), { archive } = this.current();
        const xml = new DocumentXmlEditor(metadata.bytes, {}, undefined, archiveSettings(this.#binding.context).budget);
        action(xml);
        const bytes = xml.serialize();
        this.commit({ ...archive, members: archive.members.map(member => member.name === metadata.name ? { ...member, bytes } : member) });
      }
    });
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
    const types = archive.members.find(member => asciiKey(member.name) === "[content_types].xml")!;
    const typeEditor = new DocumentXmlEditor(types.bytes, {}, undefined, settings.budget);
    let override = false;
    for (const node of typeEditor.root.children) if (node.attributes.some(attribute => attribute.localName === "PartName" && asciiKey(attribute.value) === asciiKey(from))) { typeEditor.setAttribute(node, "PartName", to); override = true; }
    if (!override) typeEditor.insertChildren(typeEditor.root, `<Override xmlns="http://schemas.openxmlformats.org/package/2006/content-types" PartName="${xmlValue(to)}" ContentType="${xmlValue(metadata.content_type)}"/>`);
    replacements.set(types.name, typeEditor.serialize());
    for (const owner of ["/", ...graph.parts.filter(part => part.content_type !== relContentType).map(part => part.partname)]) {
      const edges = graph.relationships(owner), member = archive.members.find(member => member.name === relationshipName(owner));
      if (!member || !edges.some(edge => !edge.is_external && (owner === from || edge.target_part.partname === from))) continue;
      const xml = new DocumentXmlEditor(member.bytes, {}, undefined, settings.budget);
      for (const node of xml.root.children) {
        const edge = edges.find(edge => node.attributes.some(attribute => attribute.localName === "Id" && attribute.value === edge.rId));
        if (!edge || edge.is_external || owner !== from && edge.target_part.partname !== from) continue;
        const target = relativePartTarget(owner === from ? to : owner, edge.target_part.partname === from ? to : edge.target_part.partname)
          + (edge.fragment === null ? "" : "#" + edge.fragment);
        xml.setAttribute(node, "Target", target);
      }
      replacements.set(member.name, xml.serialize());
    }
    const members = archive.members.map(member => ({ ...member,
      name: member.name === from.slice(1) ? to.slice(1) : member.name === relationshipName(from) ? relationshipName(to) : member.name,
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
  async save(sink: DocumentModelOutput): Promise<void> {
    if (!sink || typeof sink !== "object") throw new InputTypeError("Expected an explicit document output capability.");
    this.#binding.writable();
    this[packageValidate]();
    await this.#binding.save(sink);
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
  #element: XmlElementView | undefined;
  static override async load(partname: string | PackURI, content_type: string, blob: Uint8Array, owner: PackageView): Promise<XmlPartView> {
    if (!(owner instanceof PackageView) || !xmlType(content_type)) throw new InputTypeError("Expected an admitted XML owner package and content type.");
    return owner[packageAdmitPart](partname, content_type, blob) as XmlPartView;
  }
  get element(): XmlElementView { return this.#element ??= this.package[packageBindXml](this); }
  get part(): this { return this; }
}

export class StoryPart extends XmlPartView {
  get_style(style_id: string | null, style_type: DocxEnumValue<"WD_STYLE_TYPE">): BaseStyle | null {
    void this.content_type;
    const styles = this.package[packageDocument](this.partname.toString()).styles;
    return styles.get_by_id(style_id, style_type);
  }
  get_style_id(style_or_name: BaseStyle | string | null, style_type: DocxEnumValue<"WD_STYLE_TYPE">): string | null {
    void this.content_type;
    const styles = this.package[packageDocument](this.partname.toString()).styles;
    return styles.get_style_id(style_or_name, style_type);
  }
  get next_id(): number {
    let maximum = 0;
    const pending = [this.element];
    while (pending.length) {
      const node = pending.pop()!;
      for (const [name, value] of node.attributes) if (name.localName === "id" && !name.namespaceURI && value && [...value].every(char => "0123456789".includes(char))) {
        const id = Number(value);
        if (!Number.isSafeInteger(id) || id === Number.MAX_SAFE_INTEGER) throw new InvalidValueError("Story drawing ID exceeds the safe integer range.");
        maximum = Math.max(maximum, id);
      }
      pending.push(...node.children);
    }
    return maximum + 1;
  }

  async get_or_add_image(input: ImageModelInput): Promise<readonly [string, Image]> {
    const root = this.element.tag;
    const store = this.package[packageDocument]().store;
    const revision = store.revision;
    const image = await Image.from_file(input, store.context);
    void this.content_type;
    if (revision !== store.revision) throw new PublicationError("conflict", "Story changed during image admission.");
    const dialect = root.namespaceURI === documentDialects.strict.w ? documentDialects.strict : documentDialects.transitional;
    return store.transaction(() => {
      const part = this.package[packageAdmittedImage](image);
      return Object.freeze([this.relate_to(part, `${dialect.r}/image`), part.image]);
    });
  }
  async new_pic_inline(input: ImageModelInput, width?: number | Length | null, height?: number | Length | null): Promise<XmlElementView> {
    const root = this.element.tag;
    const store = this.package[packageDocument]().store;
    const revision = store.revision;
    const image = await Image.from_file(input, store.context);
    const [cx, cy] = image.scaled_dimensions(width, height);
    void this.content_type;
    if (revision !== store.revision) throw new PublicationError("conflict", "Story changed during image admission.");
    return store.transaction(() => {
      const part = this.package[packageAdmittedImage](image);
      const dialect = root.namespaceURI === documentDialects.strict.w ? documentDialects.strict : documentDialects.transitional;
      const id = this.relate_to(part, `${dialect.r}/image`);
      const budget = store.context.budget;
      const run = new DocumentXmlEditor(new TextEncoder().encode(inlineImageRun(dialect, this.next_id, id, { width: cx.emu, height: cy.emu, crop: "" }).run), {}, undefined, budget);
      const inline = run.root.children[0]!.children[0]!;
      const markup = runElementOpen(inline) + run.sourceXml(inline, new Map(), true) + `</${inline.name}>`;
      const xml = new DocumentXmlEditor(new TextEncoder().encode(markup), {}, undefined, budget);
      return bindXmlElementView({ budget, read: () => xml, resolve: editor => editor.root, change: action => action(xml) });
    });
  }

}

export class HeaderPart extends StoryPart {
  static new(owner: PackageView): HeaderPart {
    if (!(owner instanceof PackageView)) throw new InputTypeError("Expected an admitted owner package.");
    return owner[packageDefaultPart]("header") as HeaderPart;
  }
}

export class FooterPart extends StoryPart {
  static new(owner: PackageView): FooterPart {
    if (!(owner instanceof PackageView)) throw new InputTypeError("Expected an admitted owner package.");
    return owner[packageDefaultPart]("footer") as FooterPart;
  }
}

export class CommentsPartView extends StoryPart {
  static default(owner: PackageView): CommentsPartView {
    if (!(owner instanceof PackageView)) throw new InputTypeError("Expected an admitted owner package.");
    return owner[packageDefaultPart]("comments") as CommentsPartView;
  }
  #comments: Comments | undefined;
  get comments(): Comments {
    const store = this.package[packageDocument]().store;
    const partname = this.partname.toString();
    void this.content_type;
    return this.#comments ??= new Comments(store, store.ref(partname, store.xml(partname).root));
  }
}

export class SettingsPartView extends XmlPartView {
  static default(owner: PackageView): SettingsPartView {
    if (!(owner instanceof PackageView)) throw new InputTypeError("Expected an admitted owner package.");
    return owner[packageDefaultPart]("settings") as SettingsPartView;
  }
  #settings: Settings | undefined;
  get settings(): Settings {
    void this.content_type;
    const document = this.package[packageDocument]();
    const root = document.element.tag;
    const dialect = root.namespaceURI === documentDialects.strict.w ? documentDialects.strict : documentDialects.transitional;
    const edges = [...document.part.rels.values()].filter(edge => edge.reltype === `${dialect.r}/settings` && !edge.is_external);
    if (edges.length === 1 && edges[0]!.target_part === this) return document.settings;
    return this.#settings ??= new Settings(document.store, this.partname.toString());
  }
}

export class DocumentPartView extends StoryPart {
  get document(): DocumentView { return this.package[packageDocument](this.partname.toString()); }
  add_header_part(): readonly [HeaderPart, string] {
    return this.document.store.transaction(() => {
      const part = HeaderPart.new(this.package);
      const root = this.element.tag;
      const dialect = root.namespaceURI === documentDialects.strict.w ? documentDialects.strict : documentDialects.transitional;
      return Object.freeze([part, this.relate_to(part, `${dialect.r}/header`)]);
    });
  }
  add_footer_part(): readonly [FooterPart, string] {
    return this.document.store.transaction(() => {
      const part = FooterPart.new(this.package);
      const root = this.element.tag;
      const dialect = root.namespaceURI === documentDialects.strict.w ? documentDialects.strict : documentDialects.transitional;
      return Object.freeze([part, this.relate_to(part, `${dialect.r}/footer`)]);
    });
  }
  drop_header_part(rId: string): void {
    const header = this.header_part(rId);
    const store = this.document.store;
    store.transaction(() => {
      this.drop_rel(rId);
      const graph = new DocumentPackage(store.snapshot(), store.context.limits, store.context.budget);
      if (["/", ...graph.parts.filter(part => part.content_type !== relContentType).map(part => part.partname)].some(owner =>
        graph.relationships(owner).some(edge => !edge.is_external && edge.target_part.partname === header.partname.toString()))) return;
      const partname = header.partname.toString();
      const relationshipPart = new PackURI(partname).rels_uri.toString();
      store.change("/[Content_Types].xml", xml => {
        for (const child of xml.root.children) if (child.attributes.some(attr => attr.localName === "PartName" && [partname, relationshipPart].includes(attr.value))) xml.replaceElement(child, "");
      });
      if (store.snapshot().members.some(member => "/" + member.name === relationshipPart)) store.deletePart(relationshipPart);
      store.deletePart(partname);
    });
  }
  header_part(rId: string): HeaderPart {
    const part = this.rels.at(rId).target_part;
    if (!(part instanceof HeaderPart)) throw new InputTypeError("Expected an owned header relationship.");
    return part;
  }
  footer_part(rId: string): FooterPart {
    const part = this.rels.at(rId).target_part;
    if (!(part instanceof FooterPart)) throw new InputTypeError("Expected an owned footer relationship.");
    return part;
  }
  get comments() { return this.document.comments; }
  get core_properties() { return this.package.core_properties; }
  get inline_shapes() { return this.document.inline_shapes; }
  get settings() { return this.document.settings; }
  get styles() { return this.document.styles; }
  async save(sink: DocumentModelOutput): Promise<void> {
    if (!sink || typeof sink !== "object") throw new InputTypeError("Expected an explicit document output capability.");
    await this.package.save(sink);
  }
  static override async load(partname: string | PackURI, content_type: string, blob: Uint8Array, owner: PackageView): Promise<DocumentPartView> {
    if (content_type !== "application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml") throw new InputTypeError("Expected the document content type.");
    return await super.load(partname, content_type, blob, owner) as DocumentPartView;
  }
  get numbering_part(): NumberingPart {
    const root = this.element.tag;
    const dialect = root.namespaceURI === documentDialects.strict.w ? documentDialects.strict : documentDialects.transitional;
    let target: PartView;
    try { target = this.part_related_by(`${dialect.r}/numbering`); }
    catch (error) {
      if (!(error instanceof MissingKeyError)) throw error;
      throw new UnsupportedEditError("Creating a missing numbering part is not supported by this model profile.");
    }
    if (!(target instanceof NumberingPart)) throw new InvalidValueError("Numbering ownership has an incompatible target.");
    return target;
  }
}

export class NumberingPart extends XmlPartView {
  #definitions: _NumberingDefinitions | undefined;
  static override async load(partname: string | PackURI, content_type: string, blob: Uint8Array, owner: PackageView): Promise<NumberingPart> {
    if (content_type !== "application/vnd.openxmlformats-officedocument.wordprocessingml.numbering+xml") throw new InputTypeError("Expected the numbering content type.");
    return await super.load(partname, content_type, blob, owner) as NumberingPart;
  }
  static new(): NumberingPart {
    throw new UnsupportedEditError("Creating a numbering part is not supported by this model profile.");
  }
  get numbering_definitions(): _NumberingDefinitions {
    if (this.element.localName !== "numbering") throw new InvalidValueError("Expected an owned numbering root.");
    return this.#definitions ??= new _NumberingDefinitions(this);
  }
}

export class _NumberingDefinitions {
  constructor(private readonly owner: NumberingPart) {}
  get length(): number {
    const root = this.owner.element;
    if (root.localName !== "numbering" ||
        (root.tag.namespaceURI !== documentDialects.transitional.w && root.tag.namespaceURI !== documentDialects.strict.w))
      throw new InvalidValueError("Expected an owned numbering root.");
    return root.children.filter(node => node.tag.namespaceURI === root.tag.namespaceURI && node.localName === "num").length;
  }
}

export class CorePropertiesPartView extends XmlPartView {
  static default(owner: PackageView): CorePropertiesPartView {
    if (!(owner instanceof PackageView)) throw new InputTypeError("Expected an admitted owner package.");
    const part = owner.core_properties.part;
    if (!(part instanceof CorePropertiesPartView)) throw new InvalidValueError("Expected an owned core-properties part.");
    return part;
  }
  static override async load(partname: string | PackURI, content_type: string, blob: Uint8Array, owner: PackageView): Promise<CorePropertiesPartView> {
    if (content_type !== "application/vnd.openxmlformats-package.core-properties+xml") throw new InputTypeError("Expected the core-properties content type.");
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
    if (!(item instanceof ImagePartView) || item.package !== this.#package) throw new InputTypeError("Expected an image part owned by this package.");
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
    const properties = readPropertyNodes(xml.root, "core", "transitional");
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
    if (matching.length) matching[0]!.text = text;
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
    return this.#collection.package[packageOwnedPart](row.target_part.partname);
  }
}

/** Relationship keys are owner-local IDs, never positional indexes. */
export class Relationships implements Iterable<string> {
  readonly #package: PackageView;
  readonly #owner: PartView | null;
  readonly #views = new Map<string, { token: object; view: RelationshipView }>();
  constructor(ownerPackage: PackageView, owner: PartView | null) { this.#package = ownerPackage; this.#owner = owner; }
  get package(): PackageView { return this.#package; }
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
    if (defaultValue !== null) {
      if (!(defaultValue instanceof RelationshipView) || !defaultValue.belongsPackage(this.#package))
        throw new InputTypeError("Expected a relationship default owned by this package.");
      void defaultValue.rId;
    }
    const row = this.rows().find(row => row.rId === id);
    return row ? this.view(row) : defaultValue;
  }
  at(id: string): RelationshipView { const view = this.get(id); if (!view) throw new MissingKeyError("Relationship ID was not found."); return view; }
  *keys(): IterableIterator<string> { for (const row of this.rows()) yield row.rId; }
  *values(): IterableIterator<RelationshipView> { for (const row of this.rows()) yield this.view(row); }
  *items(): IterableIterator<readonly [string, RelationshipView]> { for (const row of this.rows()) yield Object.freeze([row.rId, this.view(row)] as const); }
  [Symbol.iterator](): IterableIterator<string> { return this.keys(); }
  get related_parts(): ReadonlyMap<string, PartView> { return new Map([...this.values()].filter(edge => !edge.is_external).map(edge => [edge.rId, edge.target_part])); }
  get xml(): string { return this.#package[packageRelationshipXml](this.#owner); }
  private nextId(): string { let id = 1; while (this.has(`rId${id}`)) id++; return `rId${id}`; }
  add_relationship(reltype: string, target: PartView | string, rId: string, is_external = false): RelationshipView {
    if (typeof reltype !== "string" || !reltype || typeof rId !== "string" || !rId || typeof is_external !== "boolean") throw new InputTypeError("Expected relationship metadata.");
    if (this.has(rId)) throw new InvalidValueError("Relationship ID is already occupied.");
    let target_ref: string;
    if (is_external) { if (typeof target !== "string" || !target) throw new InputTypeError("Expected an inert external target string."); target_ref = target; }
    else {
      if (!(target instanceof PartView) || target.package !== this.#package) throw new InputTypeError("Expected a target owned by this package.");
      target_ref = relativePartTarget(this.#owner?.partname.toString() ?? "/", target.partname.toString());
    }
    this.#package[packageEditRelationships](this.#owner, [...this.rows(), { rId, reltype, target_ref, is_external }]);
    return this.at(rId);
  }
  get_or_add(reltype: string, target_part: PartView): RelationshipView {
    if (!(target_part instanceof PartView) || target_part.package !== this.#package) throw new InputTypeError("Expected an owned target part.");
    const found = [...this.values()].find(row => !row.is_external && row.reltype === reltype && row.target_part === target_part);
    return found ?? this.add_relationship(reltype, target_part, this.nextId());
  }
  get_or_add_ext_rel(reltype: string, target_ref: string): string {
    const found = [...this.values()].find(row => row.is_external && row.reltype === reltype && row.target_ref === target_ref);
    return found?.rId ?? this.add_relationship(reltype, target_ref, this.nextId(), true).rId;
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
    const replacements = new Map<string, RelationshipRow>();
    for (const [id, value] of entries) {
      if (!(value instanceof RelationshipView) || !value.belongsPackage(this.#package) || typeof id !== "string" || id !== value.rId || replacements.has(id)) throw new InputTypeError("Expected matching same-package relationship entries.");
      replacements.set(id, { rId: id, reltype: value.reltype, is_external: value.is_external,
        target_ref: value.is_external ? value.target_ref : relativePartTarget(this.#owner?.partname.toString() ?? "/", value.target_part.partname.toString()) });
    }
    const rows: RelationshipRow[] = this.rows().map(row => replacements.get(row.rId) ?? row);
    for (const [id, row] of replacements) if (!rows.some(existing => existing.rId === id)) rows.push(row);
    return rows;
  }
  update(entries: Iterable<readonly [string, RelationshipView]>): void { this.#package[packageEditRelationships](this.#owner, this.assignedRows(entries)); }
  setdefault(id: string, value: RelationshipView): RelationshipView { const existing = this.get(id); if (existing) return existing; this.update([[id, value]]); return this.at(id); }
  pop(id: string, fallback?: RelationshipView | null): RelationshipView | null {
    const found = this.get(id, fallback);
    if (!this.has(id)) {
      if (fallback !== undefined) return found;
      throw new MissingKeyError("Relationship ID was not found.");
    }
    this.delete(id);
    return found;
  }
  popitem(): readonly [string, RelationshipView] { const id = [...this.keys()].at(-1); if (id === undefined) throw new MissingKeyError("Relationship collection is empty."); return Object.freeze([id, this.pop(id)!]); }
  copy(): ReadonlyMap<string, RelationshipView> { return new Map(this.items()); }
}

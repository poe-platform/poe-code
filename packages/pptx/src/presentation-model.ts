import { Image } from "./image-value.js";
import { addMedia } from "./media-editing.js";
import type { OleApplication } from "./ole-enum.js";
import { addOleObject } from "./ole-insertion.js";
import type { BinaryInput, ByteSink } from "./contracts.js";
import type { PptxPublicationRequest } from "./command-engine.js";
import { readBinary, writeBinary } from "./bytes.js";
import { createPresentation } from "./creation.js";
import { OfficeError, TypeError as ModelTypeError, ValueError } from "./errors.js";
import type { FontMetricsHandle } from "./font-metrics.js";
import { createPackageView, type PartView } from "./package-view.js";
import type { XmlElementView } from "./xml-view.js";
import { Length } from "./length.js";
import { attr, child, loadShared } from "./masters.js";
import { applyPresentationCanvasSettings } from "./presentation-settings.js";
import { CoreProperties, createPropertyPart } from "./properties.js";
import {
  Slide,
  Slides,
  preservePlaceholder,
  reparentInsertedAsset,
  type SlideShapeOwner
} from "./slide-model.js";
import { addImage, type AddImageOptions } from "./image-insertion.js";
import { insertChartIntoState, replaceChartData } from "./chart-editing.js";
import { readShape } from "./shapes.js";
import { writePackageArchive, type ArchiveMember } from "./package-writer.js";
import { Chart } from "./chart-model.js";
import { inspectWorkbook } from "./chart-workbook.js";
import { readPackage, type PackageReader } from "./package-reader.js";
import { parseRelationships } from "./relationships.js";
import { resolvePartReference, packageUri } from "./package-uri.js";
import { relPart } from "./masters.js";
import { required } from "./masters.js";
import type { SelectionContext } from "./selectors.js";

export interface PresentationContext extends Partial<SelectionContext> {
  readonly timestamp?: Date;
  readonly author?: string;
  readonly fontMetrics?: FontMetricsHandle;
}

export interface PresentationPublication {
  readonly outputPath: string;
  readonly inPlace?: boolean;
  readonly force?: boolean;
  readonly publishOutput: (
    publication: PptxPublicationRequest,
    signal?: AbortSignal
  ) => Promise<void>;
}

function contextDefaults(context: PresentationContext): PresentationContext & SelectionContext {
  if (!context || typeof context !== "object") throw new ModelTypeError("Expected model context.");
  if (context.author !== undefined && typeof context.author !== "string")
    throw new ModelTypeError("Expected author text.");
  if (
    context.timestamp !== undefined &&
    (!(context.timestamp instanceof Date) || !Number.isFinite(context.timestamp.getTime()))
  )
    throw new ValueError("Expected a valid explicit timestamp.");
  return {
    ...context,
    author: context.author ?? "",
    ...(context.timestamp === undefined
      ? {}
      : { timestamp: new Date(context.timestamp.getTime()) }),
    limits: { ...(context.limits ?? { maxBytes: 16_777_216, maxReads: 8192, chunkBytes: 65536 }) },
    archiveLimits: {
      ...(context.archiveLimits ?? {
        maxArchiveBytes: 16_777_216,
        maxEntryBytes: 8_388_608,
        maxTotalBytes: 33_554_432,
        maxMembers: 4096,
        maxPathBytes: 1024,
        maxDepth: 32,
        maxPaxBytes: 4096,
        maxTextBytes: 8_388_608,
        chunkSize: 65536
      })
    },
    xmlLimits: {
      ...(context.xmlLimits ?? { maxBytes: 8_388_608, maxNodes: 100000, maxDepth: 128 })
    },
    relationshipLimits: {
      ...(context.relationshipLimits ?? {
        maxBytes: 8_388_608,
        maxParts: 4096,
        maxRelationships: 16384
      })
    }
  };
}

function cancelled(context: SelectionContext): void {
  if (context.signal?.aborted)
    throw new OfficeError("cancelled", "Operation cancelled.", "publish");
}

type State = Awaited<ReturnType<typeof loadShared>>;

function workbookMembersReader(members: readonly ArchiveMember[]): PackageReader {
  const entries = new Map(
    members.map((member) => ["/" + member.name, new Uint8Array(member.bytes)])
  );
  const get = (name: string): Uint8Array => {
    const bytes = entries.get(name);
    if (!bytes)
      throw new OfficeError("invalid-opc", "Workbook part is missing.", "validate-intent");
    return new Uint8Array(bytes);
  };
  return {
    names: Object.freeze([...entries.keys()]),
    has: (name) => entries.has(name),
    get,
    relsXmlFor: (name) => {
      const part = name === "/" ? "/_rels/.rels" : relPart(name);
      return entries.has(part) ? get(part) : null;
    }
  };
}

export interface PresentationModel {
  readonly element: XmlElementView;
  readonly part: PartView;
  readonly core_properties: CoreProperties;
  readonly slides: Slides;
  get slide_width(): Length | null;
  set slide_width(value: Length);
  get slide_height(): Length | null;
  set slide_height(value: Length);
  save(destination?: undefined): Promise<Uint8Array>;
  save(destination: ByteSink | PresentationPublication): Promise<void>;
}

class LivePresentation implements PresentationModel {
  #part: PartView;
  readonly #slides: Slides;
  get slides(): Slides {
    return this.#slides;
  }
  #state: State;
  #context: SelectionContext;
  #inputPath: string | undefined;
  #properties: CoreProperties | undefined;
  #propertyPart: string | undefined;
  #revision = 0;
  readonly #pendingWorkbooks = new Map<string, readonly ArchiveMember[]>();
  #workbookFlush: Promise<void> | undefined;
  #publishedSource: Uint8Array;
  readonly #workbooks: Map<string, { bytes: Uint8Array; reader: PackageReader } | Error>;
  constructor(
    state: State,
    context: SelectionContext,
    inputPath?: string,
    workbooks = new Map<string, { bytes: Uint8Array; reader: PackageReader } | Error>()
  ) {
    this.#state = state;
    this.#workbooks = workbooks;
    this.#context = context;
    this.#inputPath = inputPath;
    this.#publishedSource = state.source;
    this.#part = createPackageView(state, context, () => {
      this.#revision++;
    }).get_part(state.main)!;
    const parts = state.index.inventory.relationships.filter(
      (edge) =>
        edge.owner === "/" && edge.type.endsWith("/metadata/core-properties") && !edge.external
    );
    if (parts.length > 1)
      throw new OfficeError("ambiguous-selection", "Multiple core property parts.", "select");
    this.#propertyPart = parts[0]?.targetPart ?? undefined;
    this.#slides = new Slides(
      state.index.inventory.slides.map((record) => {
        let latestBytes: Uint8Array | undefined;
        let latestXml: ReturnType<State["doc"]> | undefined;
        const owner: SlideShapeOwner = {
          part: this.#part.package.get_part(record.part)!,
          resource: (id) => {
            const edge = parseRelationships(
              state.doc(relPart(record.part)).bytes(),
              context.relationshipLimits
            ).find((edge) => edge.id === id);
            if (!edge || edge.external)
              throw new OfficeError(
                "unsupported-edit",
                "Only embedded resources are accessible.",
                "select"
              );
            const name = resolvePartReference(packageUri(record.part).baseURI, edge.target);
            const part = this.#part.package.get_part(name);
            if (!part)
              throw new OfficeError("invalid-opc", "Embedded resource is missing.", "select");
            return part;
          },
          insertAsset: async (kind, options, groupId) => {
            const revision = this.#revision;
            const geometry: Record<string, number> = {};
            for (const key of [
              "left",
              "top",
              "width",
              "height",
              "icon_width",
              "icon_height"
            ] as const) {
              const value = options[key];
              if (value === undefined || value === null) continue;
              if (!(value instanceof Length))
                throw new ValueError("Expected explicit Length geometry.");
              geometry[key] = value.emu;
            }
            if (geometry.left === undefined || geometry.top === undefined)
              throw new ValueError("Expected explicit placement.");
            const suppliedPoster =
              kind === "movie" ? options.poster_frame_image : options.icon_file;
            const posterInput =
              suppliedPoster instanceof Uint8Array
                ? new Uint8Array(suppliedPoster)
                : suppliedPoster;
            const bytes = await readBinary(options.input as BinaryInput, context);
            let poster: Image | undefined;
            if (kind !== "picture")
              poster = new Image(await readBinary(posterInput as BinaryInput, context));
            await this.#flushWorkbooks();
            if (revision !== this.#revision)
              throw new OfficeError(
                "stale-selection",
                "Presentation changed during insertion.",
                "publish"
              );
            const before = owner.read();
            const ids = new Set(
              required(required(before.root, "cSld"), "spTree").children.map(
                (node) => readShape(node).shapeId
              )
            );
            const snapshot = await state.finish(state.main, []);
            let inserted: Uint8Array;
            if (kind === "picture") {
              const image = new Image(bytes);
              inserted = await addImage(
                snapshot.bytes,
                { slide: record.position, bytes, contentType: image.content_type, ...geometry },
                context
              );
            } else if (kind === "movie") {
              inserted = await addMedia(
                snapshot.bytes,
                {
                  slide: record.position,
                  bytes,
                  contentType: options.mime_type as string,
                  kind: "video",
                  poster: { bytes: poster!.blob, contentType: poster!.content_type },
                  left: geometry.left,
                  top: geometry.top,
                  width: geometry.width!,
                  height: geometry.height!
                },
                context
              );
            } else {
              const { icon_width, icon_height, ...bounds } = geometry;
              inserted = await addOleObject(
                snapshot.bytes,
                {
                  slide: record.position,
                  bytes,
                  progId: options.prog_id as string | OleApplication,
                  iconBytes: poster!.blob,
                  iconContentType: poster!.content_type,
                  ...bounds,
                  ...(icon_width === undefined ? {} : { iconWidth: icon_width }),
                  ...(icon_height === undefined ? {} : { iconHeight: icon_height })
                },
                context
              );
            }
            const updated = await loadShared(inserted, context);
            if (revision !== this.#revision)
              throw new OfficeError(
                "stale-selection",
                "Presentation changed during insertion.",
                "publish"
              );
            const doc = updated.doc(record.part);
            const added = required(required(doc.root, "cSld"), "spTree").children.find(
              (node) => !ids.has(readShape(node).shapeId)
            );
            if (!added)
              throw new OfficeError(
                "invalid-opc",
                "Asset insertion produced no shape.",
                "validate-result"
              );
            const final =
              groupId === undefined
                ? doc
                : reparentInsertedAsset(doc, readShape(added).shapeId, groupId);
            for (const name of updated.reader.names)
              state.changes.set(name, updated.reader.get(name));
            owner.write(final);
            return readShape(added).shapeId;
          },
          read: () => {
            const bytes = state.changes.get(record.part);
            if (latestXml && bytes === latestBytes) return latestXml;
            latestBytes = bytes;
            latestXml = state.doc(record.part);
            return latestXml;
          },
          write: (xml) => {
            state.save(record.part, xml);
            latestBytes = state.changes.get(record.part);
            latestXml = xml;
            this.#revision++;
          },
          inherited: (idx) => {
            const result: ReturnType<State["doc"]>[] = [];
            const layout = record.layout ? state.doc(record.layout) : undefined;
            if (layout) result.push(layout);
            if (record.master) {
              const master = state.doc(record.master);
              const layoutShapes =
                layout && required(required(layout.root, "cSld"), "spTree").children;
              const ph = layoutShapes
                ?.map(readShape)
                .find((shape) => shape.placeholder?.idx === idx)?.placeholder;
              const category =
                ph?.type === "ctrTitle"
                  ? "title"
                  : ["tbl", "obj", "subTitle", "chart", "pic"].includes(ph?.type ?? "")
                    ? "body"
                    : ph?.type;
              const candidates = required(required(master.root, "cSld"), "spTree").children.filter(
                (node) => readShape(node).placeholder?.type === category
              );
              if (candidates.length > 1)
                throw new OfficeError(
                  "ambiguous-selection",
                  "Duplicate inherited master placeholder type.",
                  "select"
                );
              if (candidates[0]) {
                const original = master.subtree(candidates[0]);
                const nv = original.root.children.find((node) =>
                  node.name.localName.startsWith("nv")
                )!;
                const placeholder = required(required(nv, "nvPr"), "ph");
                const remapped = original.merge(placeholder, {
                  attributes: [{ namespace: "", localName: "idx", value: String(idx) }]
                });
                const tree = required(required(master.root, "cSld"), "spTree");
                result.push(
                  master.spliceChildren(tree, 0, tree.children.length, [
                    remapped.markup(remapped.root, true)
                  ])
                );
              }
            }
            return result;
          },
          chart: (shapeId) => {
            let cachedBytes: Uint8Array | undefined,
              cachedXml: ReturnType<State["doc"]> | undefined;
            const chartPart = () => {
              const shape = required(required(owner.read().root, "cSld"), "spTree").children.find(
                (node) => readShape(node).shapeId === shapeId
              );
              if (!shape || shape.name.localName !== "graphicFrame")
                throw new OfficeError("invalid-handle", "Chart frame was replaced.", "select");
              const pending = [shape];
              let relationId: string | undefined;
              while (pending.length) {
                const node = pending.pop()!;
                if (node.name.localName === "chart")
                  relationId = node.attributes.find(
                    (a) => a.name.localName === "id" && a.name.namespace === state.r
                  )?.value;
                pending.push(...node.children);
              }
              const relations = parseRelationships(
                state.doc(relPart(record.part)).bytes(),
                context.relationshipLimits
              );
              const relation = relations.find(
                (edge) => edge.id === relationId && edge.type.endsWith("/chart") && !edge.external
              );
              if (!relation)
                throw new OfficeError(
                  "invalid-handle",
                  "Chart relationship is unavailable.",
                  "select"
                );
              return resolvePartReference(packageUri(record.part).baseURI, relation.target);
            };
            return new Chart(
              () => {
                const part = chartPart(),
                  bytes = state.changes.get(part);
                if (cachedXml && cachedBytes === bytes) return cachedXml;
                cachedBytes = bytes;
                cachedXml = state.doc(part);
                return cachedXml;
              },
              (xml) => {
                state.save(chartPart(), xml);
                cachedXml = xml;
                cachedBytes = state.changes.get(chartPart());
                this.#revision++;
              },
              {
                part: () => this.#part.package.get_part(chartPart())!,
                replaceData: (data) => {
                  cancelled(context);
                  const part = chartPart();
                  const xml = state.doc(part);
                  const externalData = child(xml.root, "externalData");
                  const id = externalData?.attributes.find(
                    (attribute) =>
                      attribute.name.localName === "id" && attribute.name.namespace === state.r
                  )?.value;
                  const relations = parseRelationships(
                    state.doc(relPart(part)).bytes(),
                    context.relationshipLimits
                  );
                  const relation = relations.find(
                    (edge) => edge.id === id && edge.type.endsWith("/package") && !edge.external
                  );
                  if (!relation)
                    throw new OfficeError(
                      "unsupported-edit",
                      "Data replacement requires one owned embedded workbook.",
                      "validate-intent"
                    );
                  const workbookPart = resolvePartReference(
                    packageUri(part).baseURI,
                    relation.target
                  );
                  const owners = this.#part.package.parts.flatMap((ownerPart) =>
                    ownerPart.rels.filter(
                      (edge) =>
                        edge.mode === "internal" &&
                        resolvePartReference(
                          packageUri(ownerPart.partname).baseURI,
                          edge.target
                        ) === workbookPart
                    )
                  );
                  if (owners.length !== 1)
                    throw new OfficeError(
                      "unsupported-edit",
                      "Shared chart workbook ownership is ambiguous.",
                      "validate-intent"
                    );
                  const pending = this.#pendingWorkbooks.get(workbookPart);
                  let source: PackageReader;
                  if (pending) {
                    source = workbookMembersReader(pending);
                  } else {
                    const cached = this.#workbooks.get(workbookPart);
                    if (cached instanceof Error) throw cached;
                    if (!cached)
                      throw new OfficeError(
                        "unsupported-edit",
                        "Workbook was not admitted for synchronous replacement.",
                        "validate-intent"
                      );
                    const current =
                      state.changes.get(workbookPart) ?? state.reader.get(workbookPart);
                    if (
                      current.length !== cached.bytes.length ||
                      current.some((byte, index) => byte !== cached.bytes[index])
                    )
                      throw new OfficeError(
                        "invalid-handle",
                        "Workbook changed after admission.",
                        "select"
                      );
                    source = cached.reader;
                  }
                  const result = replaceChartData(
                    xml,
                    data,
                    context,
                    source,
                    inspectWorkbook(source, context)
                  );
                  state.save(part, result.doc);
                  this.#pendingWorkbooks.set(workbookPart, result.members);
                  cachedXml = result.doc;
                  cachedBytes = state.changes.get(part);
                  this.#revision++;
                }
              }
            );
          },
          insertChart: (shapeId, options) => {
            cancelled(context);
            const old = owner.read(),
              tree = required(required(old.root, "cSld"), "spTree"),
              previous = tree.children.find((node) => readShape(node).shapeId === shapeId);
            if (!previous || previous.name.localName !== "sp")
              throw new OfficeError("invalid-handle", "Placeholder was replaced.", "select");
            const changes = new Map(state.changes),
              workbooks = new Map<string, readonly ArchiveMember[]>();
            try {
              insertChartIntoState(
                state,
                { ...options, slide: record.position },
                context,
                (part, members) =>
                  workbooks.set(
                    part,
                    members.map((member) => ({
                      name: member.name,
                      bytes: new Uint8Array(member.bytes)
                    }))
                  )
              );
              const doc = state.doc(record.part),
                newTree = required(required(doc.root, "cSld"), "spTree"),
                originalIds = new Set(tree.children.map((node) => readShape(node).shapeId));
              const added = newTree.children.find(
                (node) => !originalIds.has(readShape(node).shapeId)
              );
              if (!added)
                throw new OfficeError(
                  "invalid-opc",
                  "Chart insertion produced no frame.",
                  "validate-result"
                );
              const replacement = preservePlaceholder(old.subtree(previous), doc.subtree(added));
              let final = doc.spliceChildren(newTree, newTree.children.indexOf(added), 1, []);
              const finalTree = required(required(final.root, "cSld"), "spTree");
              final = final.spliceChildren(finalTree, tree.children.indexOf(previous), 1, [
                replacement.markup(replacement.root, true)
              ]);
              owner.write(final);
              for (const [part, members] of workbooks) this.#pendingWorkbooks.set(part, members);
            } catch (error) {
              state.changes.clear();
              for (const [part, bytes] of changes) state.changes.set(part, bytes);
              throw error;
            }
          },
          insertRich: async (shapeId, kind, options) => {
            const revision = this.#revision;
            const old = owner.read();
            const tree = required(required(old.root, "cSld"), "spTree");
            const previous = tree.children.find((node) => readShape(node).shapeId === shapeId);
            if (!previous || previous.name.localName !== "sp")
              throw new OfficeError("invalid-handle", "Placeholder was replaced.", "select");
            if (kind === "picture") {
              const picture = options as { input: BinaryInput };
              const bytes = await readBinary(picture.input, context);
              const contentType = new Image(bytes).content_type;
              const { input: ignored, ...geometry } = picture;
              void ignored;
              options = { ...geometry, bytes, contentType };
            }
            await this.#flushWorkbooks();
            if (revision !== this.#revision)
              throw new OfficeError(
                "stale-selection",
                "Presentation changed during insertion.",
                "publish"
              );
            const snapshot = await this.#state.finish(this.#state.main, []);
            const inserted = await addImage(
              snapshot.bytes,
              { ...(options as Omit<AddImageOptions, "slide">), slide: record.position },
              context
            );
            const updated = await loadShared(inserted, context);
            if (revision !== this.#revision)
              throw new OfficeError(
                "stale-selection",
                "Presentation changed during insertion.",
                "publish"
              );
            const doc = updated.doc(record.part);
            const newTree = required(required(doc.root, "cSld"), "spTree");
            const originalIds = new Set(tree.children.map((node) => readShape(node).shapeId));
            const added = newTree.children.find(
              (node) => !originalIds.has(readShape(node).shapeId)
            );
            if (!added)
              throw new OfficeError(
                "invalid-opc",
                "Rich insertion produced no shape.",
                "validate-result"
              );
            const replacement = preservePlaceholder(old.subtree(previous), doc.subtree(added));
            let final = doc.spliceChildren(newTree, newTree.children.indexOf(added), 1, []);
            const finalTree = required(required(final.root, "cSld"), "spTree");
            final = final.spliceChildren(finalTree, tree.children.indexOf(previous), 1, [
              replacement.markup(replacement.root, true)
            ]);
            for (const name of updated.reader.names)
              state.changes.set(name, updated.reader.get(name));
            owner.write(final);
          }
        };
        return new Slide(Number(record.id), owner);
      })
    );
  }
  get part(): PartView {
    return this.#part;
  }
  get element(): XmlElementView {
    return this.#part.element;
  }
  get core_properties(): CoreProperties {
    if (!this.#properties) {
      if (!this.#propertyPart) {
        this.#propertyPart = createPropertyPart(this.#state, "core", this.#context);
        this.#revision++;
      }
      const part = this.#propertyPart;
      this.#properties = new CoreProperties(
        () => this.#state.doc(part),
        (doc) => {
          this.#state.save(part, doc);
          this.#revision++;
        }
      );
    }
    return this.#properties;
  }
  #dimension(attribute: "cx" | "cy"): Length | null {
    const doc = this.#state.doc(this.#state.main);
    const size = child(doc.root, "sldSz");
    if (!size) return null;
    const raw = attr(size, attribute);
    if (raw === undefined || !raw.length || [...raw].some((c) => c < "0" || c > "9"))
      throw new OfficeError("invalid-opc", "Invalid slide dimension.", "parse");
    return new Length(Number(raw));
  }
  #setDimension(attribute: "cx" | "cy", value: Length): void {
    if (!(value instanceof Length)) throw new ModelTypeError("Slide dimensions require a Length.");
    if (value.emu < 914400 || value.emu > 51206400)
      throw new ValueError("Slide dimensions must be between 1 and 56 inches.");
    const doc = this.#state.doc(this.#state.main);
    const missing = !child(doc.root, "sldSz");
    const propertyEdge = this.#state.index.inventory.relationships.find(
      (edge) =>
        edge.owner === this.#state.main && edge.type.endsWith("/presProps") && !edge.external
    );
    const updated = applyPresentationCanvasSettings(
      doc,
      {
        ...(missing ? { width: 9144000, height: 6858000 } : {}),
        [attribute === "cx" ? "width" : "height"]: value.emu
      },
      propertyEdge?.targetPart ? this.#state.doc(propertyEdge.targetPart) : undefined
    );
    this.#state.save(this.#state.main, updated);
    this.#revision++;
  }
  get slide_width(): Length | null {
    return this.#dimension("cx");
  }
  set slide_width(value: Length) {
    this.#setDimension("cx", value);
  }
  get slide_height(): Length | null {
    return this.#dimension("cy");
  }
  set slide_height(value: Length) {
    this.#setDimension("cy", value);
  }
  async #flushWorkbooks(): Promise<void> {
    if (this.#workbookFlush) return this.#workbookFlush;
    if (!this.#pendingWorkbooks.size) return;
    const pending = [...this.#pendingWorkbooks];
    this.#workbookFlush = (async () => {
      const encoded = await Promise.all(
        pending.map(async ([part, members]) => ({
          part,
          members,
          bytes: await writePackageArchive(members, this.#context, { compression: "store" })
        }))
      );
      for (const { part, members, bytes } of encoded)
        if (this.#pendingWorkbooks.get(part) === members) {
          this.#state.changes.set(part, bytes);
          this.#pendingWorkbooks.delete(part);
          this.#workbooks.set(part, {
            bytes: new Uint8Array(bytes),
            reader: workbookMembersReader(members)
          });
        }
    })();
    try {
      await this.#workbookFlush;
    } finally {
      this.#workbookFlush = undefined;
    }
  }
  async save(destination?: undefined): Promise<Uint8Array>;
  async save(destination: ByteSink | PresentationPublication): Promise<void>;
  async save(destination?: ByteSink | PresentationPublication): Promise<Uint8Array | void> {
    if (destination !== undefined && (!destination || typeof destination !== "object"))
      throw new ModelTypeError("Expected an explicit publication capability.");
    if (destination && "publishOutput" in destination) {
      if (
        typeof destination.publishOutput !== "function" ||
        typeof destination.outputPath !== "string" ||
        !destination.outputPath.length ||
        (destination.inPlace !== undefined && typeof destination.inPlace !== "boolean") ||
        (destination.force !== undefined && typeof destination.force !== "boolean") ||
        (destination.inPlace &&
          (!this.#inputPath || destination.outputPath !== this.#inputPath || destination.force)) ||
        (!destination.inPlace && this.#inputPath === destination.outputPath)
      )
        throw new ValueError("Invalid explicit publication destination.");
      destination = {
        outputPath: destination.outputPath,
        inPlace: destination.inPlace ?? false,
        force: destination.force ?? false,
        publishOutput: destination.publishOutput.bind(destination)
      };
    } else if (
      destination &&
      (typeof destination.write !== "function" || typeof destination.close !== "function")
    ) {
      throw new ModelTypeError("Expected an explicit byte sink.");
    }
    cancelled(this.#context);
    const revision = this.#revision;
    await this.#flushWorkbooks();
    if (revision !== this.#revision)
      throw new OfficeError(
        "stale-selection",
        "Presentation changed during serialization.",
        "publish"
      );
    const { bytes } = await this.#state.finish(this.#state.main, []);
    cancelled(this.#context);
    if (revision !== this.#revision)
      throw new OfficeError(
        "stale-selection",
        "Presentation changed during serialization.",
        "publish"
      );
    if (destination === undefined) return new Uint8Array(bytes);
    if ("publishOutput" in destination) {
      try {
        await destination.publishOutput(
          {
            ...(this.#inputPath === undefined ? {} : { inputPath: this.#inputPath }),
            outputPath: destination.outputPath,
            bytes: new Uint8Array(bytes),
            originalBytes: new Uint8Array(this.#publishedSource),
            inPlace: destination.inPlace ?? false,
            force: destination.force ?? false,
            dryRun: false
          },
          this.#context.signal
        );
        if (destination.inPlace) this.#publishedSource = new Uint8Array(bytes);
      } catch (error) {
        cancelled(this.#context);
        if (
          error &&
          typeof error === "object" &&
          "code" in error &&
          error.code === "stale-selection"
        )
          throw new OfficeError("stale-selection", "Publication source changed.", "publish");
        throw new OfficeError("io-failure", "Presentation publication failed.", "publish");
      }
      cancelled(this.#context);
      return;
    }
    await writeBinary(bytes, destination, this.#context);
  }
}

export async function Presentation(
  input?: BinaryInput | null,
  context: PresentationContext = {}
): Promise<PresentationModel> {
  const admittedContext = contextDefaults(context);
  const inputPath = input && typeof input === "object" && "path" in input ? input.path : undefined;
  const bytes =
    input === undefined || input === null
      ? await createPresentation(
          {
            width: 9144000,
            height: 6858000,
            ...(admittedContext.author === undefined ? {} : { author: admittedContext.author }),
            ...(admittedContext.timestamp === undefined
              ? {}
              : { timestamp: admittedContext.timestamp })
          },
          admittedContext
        )
      : await readBinary(input, admittedContext);
  const state = await loadShared(bytes, admittedContext);
  const chartParts = new Set(
    state.index.inventory.relationships
      .filter((edge) => edge.type.endsWith("/chart") && !edge.external)
      .map((edge) => edge.targetPart)
  );
  const workbooks = new Map<string, { bytes: Uint8Array; reader: PackageReader } | Error>();
  let workbookBytes = 0;
  let workbookMembers = 0;
  for (const edge of state.index.inventory.relationships) {
    if (
      !chartParts.has(edge.owner) ||
      !edge.type.endsWith("/package") ||
      edge.external ||
      !edge.targetPart ||
      workbooks.has(edge.targetPart)
    )
      continue;
    const bytes = state.reader.get(edge.targetPart);
    try {
      const remainingBytes = admittedContext.archiveLimits.maxTotalBytes - workbookBytes;
      const remainingMembers = admittedContext.archiveLimits.maxMembers - workbookMembers;
      if (remainingBytes < 1 || remainingMembers < 1)
        throw new OfficeError(
          "resource-limit",
          "Embedded workbook admission budget exceeded.",
          "admit"
        );
      const reader = await readPackage(bytes, {
        ...admittedContext,
        archiveLimits: {
          ...admittedContext.archiveLimits,
          maxTotalBytes: remainingBytes,
          maxEntryBytes: Math.min(admittedContext.archiveLimits.maxEntryBytes, remainingBytes),
          maxMembers: remainingMembers
        }
      });
      workbookBytes += reader.names.reduce((total, name) => total + reader.byteLength(name), 0);
      workbookMembers += reader.entryCount;
      workbooks.set(edge.targetPart, { bytes, reader });
    } catch (error) {
      if (
        error instanceof OfficeError &&
        (error.code === "cancelled" || error.code === "resource-limit")
      )
        throw error;
      if (!(error instanceof Error)) throw error;
      workbooks.set(edge.targetPart, error);
    }
  }
  return new LivePresentation(state, admittedContext, inputPath, workbooks);
}

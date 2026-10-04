import { PagedStorage } from "@poe-code/safe-fs/storage";
import type { ValueArrayStorage } from "./cos/value-parser.js";
import { PdfMergeOutlines } from "./edit/retained-merge-outlines.js";
import { walkRetainedPageLabels, type PdfRetainedPageLabel } from "./extract/retained-page-labels.js";
import { walkRetainedFormFields, type PdfRetainedFormField } from "./extract/retained-form-fields.js";
import { openStoredPdfObjectReader, type OpenStoredPdfOptions } from "./cos/stored-object-reader.js";
import type { PdfMutableObjectStore } from "./cos/mutable-object-store.js";
import { PdfRawTextIndex, type PdfRawTextIndexOptions } from "./extract/raw-text-index.js";
import { streamRawTextChunks, type PdfRawTextOptions } from "./extract/raw-text-stream.js";
import { prepareRetainedPageContent, type PdfRetainedPageEvaluationOptions } from "./content/retained-page.js";
import { evaluateRetainedContentSteps } from "./content/retained-evaluator.js";
import { PdfStagingStorage } from "./staging-budget.js";
import { annotationPageNumberSteps, extractPageAnnotationSteps, type PdfAnnotationResult } from "./content/annotations.js";
import { walkRetainedStructure, type PdfRetainedStructureItem, type PdfStructureSelection } from "./extract/retained-structure.js";
import { walkRetainedDestinations, walkRetainedUrls, type PdfRetainedDestination, type PdfRetainedUrl, type PdfUrlSelection } from "./extract/retained-links.js";
import { walkRetainedJavaScripts, type PdfRetainedJavaScript } from "./extract/retained-javascript.js";
import { walkRetainedImages, type PdfRetainedImage, type PdfImageSelection } from "./extract/retained-images.js";
import { walkRetainedFonts, type PdfRetainedFont, type PdfFontSelection } from "./extract/retained-fonts.js";
import { walkRetainedAttachments, type PdfRetainedAttachment } from "./extract/retained-attachments.js";
import { cosDict, decodePdfString, dictGet, type ByteSpan, type PdfCosDict, type PdfCosNode, type PdfCosRef, type PdfRect } from "./ast.js";
import { PdfError } from "./errors.js";
import { openPdfObjectReader, type OpenPdfObjectReaderOptions, type PdfOpenedObjectReader } from "./cos/object-reader.js";
import type { PdfIndexStorage } from "./cos/object-index.js";
import { PdfReferenceSet } from "./cos/reference-set.js";
import type { PdfFileSource } from "./source.js";

export interface PdfRetainedDocumentOptions extends OpenPdfObjectReaderOptions {
  readonly maxPages?: number;
  readonly maxPageTreeDepth?: number;
  /** Aggregate live visited-index staging for each page walk. */
  readonly maxTraversalStagingBytes?: number;
}
export type PdfStoredDocumentOptions = PdfRetainedDocumentOptions & OpenStoredPdfOptions & {
  /** Replay caller-backed logical pages when edits change the catalog tree. */
  readonly pageReferences?: () => Iterable<PdfCosRef> | AsyncIterable<PdfCosRef>;
};
export interface PdfRetainedValue {
  readonly value: PdfCosNode;
  readonly reference?: PdfCosRef;
  /** Encoded stream span in its reader's backing; stored spans are payload-relative. */
  readonly stream?: ByteSpan;
}
export interface PdfRetainedPageAttributes {
  readonly mediaBox: PdfRect;
  readonly cropBox: PdfRect;
  readonly bleedBox: PdfRect;
  readonly trimBox: PdfRect;
  readonly artBox: PdfRect;
  readonly rotation: 0 | 90 | 180 | 270;
  readonly resources: PdfCosDict;
}
function limit(value: number | undefined, name: string, fallback: number): number {
  const result = value ?? fallback;
  if (result !== Infinity && (!Number.isSafeInteger(result) || result < 0)) throw new RangeError(`Invalid ${name}`);
  return result;
}

/** Read-oriented retained document owner. Pages and payloads are visited on
 * demand; only a bounded traversal path and external duplicate indexes persist.
 * The caller owns source and values/pages it elects to retain. */
export class PdfRetainedDocument {
  readonly objects: PdfOpenedObjectReader["reader"];
  readonly crossReference: PdfOpenedObjectReader["crossReference"];
  readonly encryption: PdfOpenedObjectReader["encryption"];
  readonly depthLimit: number;
  private readonly walks = new Set<AsyncGenerator<unknown, void, void>>();
  private closing: Promise<void> | undefined;
  private constructor(private readonly opened: PdfOpenedObjectReader, private readonly storage: PdfIndexStorage,
    private readonly options: PdfRetainedDocumentOptions, private readonly controller: AbortController,
    private readonly pageReferences?: PdfStoredDocumentOptions["pageReferences"]) {
    this.objects = opened.reader; this.crossReference = opened.crossReference; this.encryption = opened.encryption;
    this.depthLimit = options.maxPageTreeDepth!;
  }

  static async open(source: PdfFileSource, storage: PdfIndexStorage, options: PdfRetainedDocumentOptions = {}): Promise<PdfRetainedDocument> {
    const maxPages = limit(options.maxPages, "maxPages", Infinity);
    const maxPageTreeDepth = limit(options.maxPageTreeDepth, "maxPageTreeDepth", 100);
    const maxTraversalStagingBytes = limit(options.maxTraversalStagingBytes, "maxTraversalStagingBytes", Infinity);
    const controller = new AbortController();
    const signal = options.signal ? AbortSignal.any([options.signal, controller.signal]) : controller.signal;
    const configured = { ...options, signal, maxPages, maxPageTreeDepth, maxTraversalStagingBytes };
    const opened = await openPdfObjectReader(source, storage, configured);
    return new PdfRetainedDocument(opened, storage, configured, controller);
  }

  /** Read an editable caller-backed graph without normalizing it through a PDF
   * save. The caller retains ownership of the store and its object identities. */
  static async openStore(store: PdfMutableObjectStore, storage: PdfIndexStorage, options: PdfStoredDocumentOptions): Promise<PdfRetainedDocument> {
    const maxPages = limit(options.maxPages, "maxPages", Infinity);
    const maxPageTreeDepth = limit(options.maxPageTreeDepth, "maxPageTreeDepth", 100);
    const maxTraversalStagingBytes = limit(options.maxTraversalStagingBytes, "maxTraversalStagingBytes", Infinity);
    const controller = new AbortController();
    const signal = options.signal ? AbortSignal.any([options.signal, controller.signal]) : controller.signal;
    const configured = { ...options, signal, maxPages, maxPageTreeDepth, maxTraversalStagingBytes };
    const opened = await openStoredPdfObjectReader(store, storage, configured);
    return new PdfRetainedDocument(opened, storage, configured, controller, options.pageReferences);
  }

  private assertOpen(): void {
    if (this.closing) throw new PdfError("E_CAPABILITY", "Retained PDF document is closed");
    this.options.signal?.throwIfAborted();
  }

  /** Resolve a bounded reference chain, retaining the final stream's identity. */
  async lookup(node: PdfCosNode | undefined, arrays: ValueArrayStorage = this.options.valueArrays ?? {}, arrayPathPrefix?: readonly string[]): Promise<PdfRetainedValue | undefined> {
    this.assertOpen();
    if (arrayPathPrefix) arrays = { ...arrays, arrayPathPrefix };
    let reference: PdfCosRef | undefined;
    const visited = new Set<number>();
    const maximum = this.options.maxRecursionDepth ?? 100;
    while (node?.kind === "ref") {
      if (visited.size >= maximum) throw new PdfError("E_LIMIT", "PDF reference depth limit exceeded");
      if (visited.has(node.objectNumber)) throw new PdfError("E_PARSE", "Circular PDF indirect reference");
      visited.add(node.objectNumber); reference = node;
      const object = await this.objects.get(node.objectNumber, node.generationNumber, arrays);
      this.assertOpen();
      if (object?.stream) return { value: object.value, reference, stream: object.stream };
      node = object?.value;
    }
    return node ? { value: node, ...(reference ? { reference } : {}) } : undefined;
  }

  async info(): Promise<Readonly<Record<string, string>>> {
    const node = (await this.lookup(this.crossReference.infoRef))?.value;
    const result: Record<string, string> = Object.create(null) as Record<string, string>;
    if (node?.kind === "dict") for (const entry of node.entries) {
      const value = (await this.lookup(entry.value))?.value;
      if (value?.kind === "string") result[entry.key.decoded] = decodePdfString(value);
      else if (value?.kind === "name") result[entry.key.decoded] = value.decoded;
    }
    return result;
  }

  /** Resolve the one-based numbering used by annotation destinations. */
  async annotationPageNumber(reference: PdfCosRef): Promise<number | undefined> {
    this.assertOpen();
    const visited = new PdfReferenceSet(this.storage, this.options.maxTraversalStagingBytes, this.options.signal);
    const work = annotationPageNumberSteps(this.crossReference.rootRef, reference, this.depthLimit);
    let failed = false;
    try {
      let step = work.next();
      while (!step.done) {
        this.assertOpen();
        const request = step.value;
        if (request.kind === "resolve") {
          const resolved = await this.lookup(request.node);
          step = work.next(resolved?.stream && resolved.value.kind === "dict"
            ? { kind: "stream", dict: resolved.value, rawBytes: new Uint8Array() } : resolved?.value);
        } else if (request.kind === "visit-page") step = work.next(await visited.add(request.reference.objectNumber));
        else throw new TypeError("Unexpected annotation page lookup request");
      }
      return step.value;
    } catch (error) { failed = true; throw error; }
    finally { work.return(undefined); await visited.close().catch(error => { if (!failed) throw error; }); }
  }

  pages(): AsyncGenerator<PdfRetainedPage, void, void> {
    async function* visit(doc: PdfRetainedDocument): AsyncGenerator<PdfRetainedPage, void, void> {
      doc.assertOpen(); doc.walks.add(work);
      const visited = new PdfReferenceSet(doc.storage, doc.options.maxTraversalStagingBytes, doc.options.signal);
      let count = 0;
      let failed = false;
      async function* walk(node: PdfCosNode | undefined, depth: number): AsyncGenerator<PdfRetainedPage, void, void> {
        doc.assertOpen();
        if (!node) return;
        if (depth > doc.depthLimit) throw new PdfError("E_LIMIT", "PDF page tree depth limit exceeded");
        if (node.kind === "ref" && !await visited.add(node.objectNumber)) return;
        const resolved = await doc.lookup(node);
        if (resolved?.value.kind !== "dict") return;
        const dict = resolved.value;
        const type = (await doc.lookup(dictGet(dict, "Type")))?.value;
        const kids = (await doc.lookup(dictGet(dict, "Kids")))?.value;
        if ((type?.kind === "name" && type.decoded === "Pages") || kids?.kind === "array") {
          if (kids?.kind === "array") for (const kid of kids.items) yield* walk(kid, depth + 1);
        } else if ((type?.kind === "name" && type.decoded === "Page") || dictGet(dict, "MediaBox") || dictGet(dict, "Contents")) {
          if (count >= Math.min(doc.options.maxPages!, Number.MAX_SAFE_INTEGER)) throw new PdfError("E_LIMIT", "PDF page count limit exceeded");
          yield new PdfRetainedPage(doc, count++, dict, node.kind === "ref" ? node : undefined);
        }
      }
      try {
        if (doc.pageReferences) {
          for await (const reference of doc.pageReferences()) {
            doc.assertOpen();
            if (count >= Math.min(doc.options.maxPages!, Number.MAX_SAFE_INTEGER)) throw new PdfError("E_LIMIT", "PDF page count limit exceeded");
            const value = (await doc.lookup(reference))?.value;
            if (value?.kind !== "dict") throw new PdfError("E_PARSE", "Missing stored PDF page");
            yield new PdfRetainedPage(doc, count++, value, reference);
          }
        } else {
          const root = (await doc.lookup(doc.crossReference.rootRef))?.value;
          if (root?.kind === "dict") yield* walk(dictGet(root, "Pages"), 0);
        }
      } catch (error) { failed = true; throw error; }
      finally {
        doc.walks.delete(work);
        try { await visited.close(); } catch (error) { if (!failed) await Promise.reject(error); }
      }
    }
    const work = visit(this);
    return work;
  }

  structure(selection: PdfStructureSelection = {}): AsyncGenerator<PdfRetainedStructureItem, void, void> {
    async function* visit(doc: PdfRetainedDocument): AsyncGenerator<PdfRetainedStructureItem, void, void> {
      doc.assertOpen(); doc.walks.add(work);
      try {
        yield* walkRetainedStructure(doc, doc.storage, { ...selection, maxDepth: doc.depthLimit,
          ...(doc.options.chunkBytes === undefined ? {} : { chunkBytes: doc.options.chunkBytes }),
          ...(doc.options.maxTraversalStagingBytes === undefined ? {} : { maxStagingBytes: doc.options.maxTraversalStagingBytes }),
          ...(doc.options.signal ? { signal: doc.options.signal } : {}),
        });
      } finally { doc.walks.delete(work); }
    }
    const work = visit(this); return work;
  }

  destinations(): AsyncGenerator<PdfRetainedDestination, void, void> {
    async function* visit(doc: PdfRetainedDocument): AsyncGenerator<PdfRetainedDestination, void, void> {
      doc.assertOpen(); doc.walks.add(work);
      try {
        yield* walkRetainedDestinations(doc, doc.storage, { maxDepth: doc.depthLimit,
          ...(doc.options.maxTraversalStagingBytes === undefined ? {} : { maxStagingBytes: doc.options.maxTraversalStagingBytes }),
          ...(doc.options.signal ? { signal: doc.options.signal } : {}),
        });
      } finally { doc.walks.delete(work); }
    }
    const work = visit(this); return work;
  }

  urls(selection: PdfUrlSelection = {}): AsyncGenerator<PdfRetainedUrl, void, void> {
    async function* visit(doc: PdfRetainedDocument): AsyncGenerator<PdfRetainedUrl, void, void> {
      doc.assertOpen(); doc.walks.add(work);
      try {
        yield* walkRetainedUrls(doc, doc.storage, { ...selection, maxDepth: doc.depthLimit,
          ...(doc.options.maxTraversalStagingBytes === undefined ? {} : { maxStagingBytes: doc.options.maxTraversalStagingBytes }),
          ...(doc.options.signal ? { signal: doc.options.signal } : {}),
        });
      } finally { doc.walks.delete(work); }
    }
    const work = visit(this); return work;
  }

  javaScripts(): AsyncGenerator<PdfRetainedJavaScript, void, void> {
    async function* visit(doc: PdfRetainedDocument): AsyncGenerator<PdfRetainedJavaScript, void, void> {
      doc.assertOpen(); doc.walks.add(work);
      try {
        yield* walkRetainedJavaScripts(doc, doc.storage, { maxDepth: doc.depthLimit,
          ...(doc.options.chunkBytes === undefined ? {} : { chunkBytes: doc.options.chunkBytes }),
          ...(doc.options.maxTraversalStagingBytes === undefined ? {} : { maxStagingBytes: doc.options.maxTraversalStagingBytes }),
          ...(doc.options.signal ? { signal: doc.options.signal } : {}),
        });
      } finally { doc.walks.delete(work); }
    }
    const work = visit(this); return work;
  }

  outlines(): AsyncGenerator<{ title: string; pageIndex: number }, void, void> {
    async function* visit(doc: PdfRetainedDocument): AsyncGenerator<{ title: string; pageIndex: number }, void, void> {
      doc.assertOpen(); doc.walks.add(work);
      const storage = new PdfStagingStorage(doc.storage, doc.options.maxTraversalStagingBytes);
      const outlines = new PdfMergeOutlines(storage, doc.options.signal!, Infinity);
      let failed = false;
      try { await outlines.append(doc, 0, true); yield* outlines.entries(); }
      catch (error) { failed = true; throw error; }
      finally { doc.walks.delete(work); await outlines.close().catch(error => { if (!failed) throw error; }); }
    }
    const work = visit(this); return work;
  }

  pageLabels(): AsyncGenerator<PdfRetainedPageLabel, void, void> {
    async function* visit(doc: PdfRetainedDocument): AsyncGenerator<PdfRetainedPageLabel, void, void> {
      doc.assertOpen(); doc.walks.add(work);
      try {
        yield* walkRetainedPageLabels(doc, doc.storage, {
          ...(doc.options.maxTraversalStagingBytes === undefined ? {} : { maxStagingBytes: doc.options.maxTraversalStagingBytes }),
          ...(doc.options.signal ? { signal: doc.options.signal } : {}),
        });
      } finally { doc.walks.delete(work); }
    }
    const work = visit(this); return work;
  }

  formFields(): AsyncGenerator<PdfRetainedFormField, void, void> {
    async function* visit(doc: PdfRetainedDocument): AsyncGenerator<PdfRetainedFormField, void, void> {
      doc.assertOpen(); doc.walks.add(work);
      try {
        yield* walkRetainedFormFields(doc, doc.storage, { maxDepth: doc.depthLimit,
          ...(doc.options.maxTraversalStagingBytes === undefined ? {} : { maxStagingBytes: doc.options.maxTraversalStagingBytes }),
          ...(doc.options.signal ? { signal: doc.options.signal } : {}),
        });
      } finally { doc.walks.delete(work); }
    }
    const work = visit(this); return work;
  }

  attachments(): AsyncGenerator<PdfRetainedAttachment, void, void> {
    async function* visit(doc: PdfRetainedDocument): AsyncGenerator<PdfRetainedAttachment, void, void> {
      doc.assertOpen(); doc.walks.add(work);
      try {
        yield* walkRetainedAttachments(doc, doc.storage, { maxDepth: doc.depthLimit,
          ...(doc.options.maxTraversalStagingBytes === undefined ? {} : { maxStagingBytes: doc.options.maxTraversalStagingBytes }),
          ...(doc.options.signal ? { signal: doc.options.signal } : {}),
        });
      } finally { doc.walks.delete(work); }
    }
    const work = visit(this); return work;
  }

  fonts(selection: PdfFontSelection = {}): AsyncGenerator<PdfRetainedFont, void, void> {
    async function* visit(doc: PdfRetainedDocument): AsyncGenerator<PdfRetainedFont, void, void> {
      doc.assertOpen(); doc.walks.add(work);
      try {
        yield* walkRetainedFonts(doc, doc.storage, { ...selection, maxDepth: doc.depthLimit,
          ...(doc.options.maxTraversalStagingBytes === undefined ? {} : { maxStagingBytes: doc.options.maxTraversalStagingBytes }),
          ...(doc.options.signal ? { signal: doc.options.signal } : {}),
        });
      } finally { doc.walks.delete(work); }
    }
    const work = visit(this); return work;
  }

  images(selection: PdfImageSelection = {}): AsyncGenerator<PdfRetainedImage, void, void> {
    async function* visit(doc: PdfRetainedDocument): AsyncGenerator<PdfRetainedImage, void, void> {
      doc.assertOpen(); doc.walks.add(work);
      try {
        yield* walkRetainedImages(doc, doc.storage, { ...selection, maxDepth: doc.depthLimit,
          ...(doc.options.chunkBytes === undefined ? {} : { chunkBytes: doc.options.chunkBytes }),
          ...(doc.options.maxDecodedBytes === undefined ? {} : { maxDecodedBytes: doc.options.maxDecodedBytes }),
          ...(doc.options.maxTraversalStagingBytes === undefined ? {} : { maxStagingBytes: doc.options.maxTraversalStagingBytes }),
          ...(doc.options.signal ? { signal: doc.options.signal } : {}),
        });
      } finally { doc.walks.delete(work); }
    }
    const work = visit(this); return work;
  }

  close(): Promise<void> {
    this.closing ??= (async () => {
      this.controller.abort(new PdfError("E_CANCELLED", "Retained PDF document is closed"));
      const results = await Promise.allSettled([...this.walks].map(walk => walk.return()));
      let failure: { error: unknown } | undefined;
      for (const result of results) if (result.status === "rejected" && result.reason !== this.controller.signal.reason) failure ??= { error: result.reason };
      try { await this.opened.close(); } catch (error) { failure ??= { error }; }
      if (failure) throw failure.error;
    })();
    return this.closing;
  }
}

export class PdfRetainedPage {
  constructor(private readonly document: PdfRetainedDocument, readonly index: number, readonly dict: PdfCosDict, readonly reference?: PdfCosRef) {}

  async attributes(): Promise<PdfRetainedPageAttributes> {
    const values = new Map<string, PdfCosNode | undefined>();
    const boxes = new Map<string, PdfRect>();
    const keys = ["MediaBox", "CropBox", "BleedBox", "TrimBox", "ArtBox", "Rotate", "Resources"];
    let current: PdfCosDict | undefined = this.dict;
    const visited = new Set<number>();
    let depth = 0;
    while (current) {
      if (depth++ > this.document.depthLimit) throw new PdfError("E_LIMIT", "PDF inherited page depth limit exceeded");
      for (const key of keys) {
        const entry = dictGet(current, key);
        if (values.has(key) || !entry) continue;
        const value = (await this.document.lookup(entry))?.value;
        if (key.endsWith("Box")) {
          const rectangle = await box(value, this.document);
          if (!rectangle) continue;
          boxes.set(key, rectangle);
        }
        values.set(key, value);
      }
      if (values.size === keys.length) break;
      const parent = dictGet(current, "Parent");
      if (parent?.kind === "ref") { if (visited.has(parent.objectNumber)) break; visited.add(parent.objectNumber); }
      const resolved = (await this.document.lookup(parent))?.value;
      current = resolved?.kind === "dict" ? resolved : undefined;
    }
    async function box(node: PdfCosNode | undefined, document: PdfRetainedDocument): Promise<PdfRect | undefined> {
      if (node?.kind !== "array" || node.items.length < 4) return undefined;
      const numbers: number[] = [];
      for (const item of node.items.slice(0, 4)) {
        const value = (await document.lookup(item))?.value;
        if (value?.kind !== "number") return undefined;
        numbers.push(value.value);
      }
      return numbers as unknown as PdfRect;
    }
    const mediaBox: PdfRect = boxes.get("MediaBox") ?? [0, 0, 612, 792];
    const cropBox = boxes.get("CropBox") ?? mediaBox;
    const rotation = values.get("Rotate");
    const resources = values.get("Resources");
    const normalizedRotation = rotation?.kind === "number" ? ((rotation.value % 360) + 360) % 360 : 0;
    return {
      mediaBox,
      cropBox,
      bleedBox: boxes.get("BleedBox") ?? cropBox,
      trimBox: boxes.get("TrimBox") ?? cropBox,
      artBox: boxes.get("ArtBox") ?? cropBox,
      rotation: normalizedRotation === 90 || normalizedRotation === 180 || normalizedRotation === 270 ? normalizedRotation : 0,
      resources: resources?.kind === "dict" ? resources : cosDict({}),
    };
  }

  /** Pull complete page paint operations, including annotation appearances and
   * widget fallback text. The caller owns results it retains. */
  async *evaluateSteps(storage: PdfIndexStorage, options: PdfRetainedPageEvaluationOptions = {}) {
    const maximum = options.maxResourceBytes ?? Infinity;
    if (maximum !== Infinity && (!Number.isSafeInteger(maximum) || maximum < 0)) throw new RangeError("Invalid maxResourceBytes");
    let admitted = 0;
    const configured = { ...options, maxResourceBytes: Infinity, onAllocation(bytes: number) {
      options.signal?.throwIfAborted();
      if (!Number.isSafeInteger(bytes) || bytes < 0 || bytes > Math.min(maximum, Number.MAX_SAFE_INTEGER) - admitted) throw new PdfError("E_LIMIT", "PDF page resource byte limit exceeded");
      options.onAllocation?.(bytes); admitted += bytes;
    } };
    const shared = new PdfStagingStorage(storage, options.maxStagingBytes);
    configured.onAllocation(256);
    const attributes = await this.attributes();
    const prepared = await prepareRetainedPageContent(this.document, this, attributes.resources, shared, configured);
    const [x0, y0, x1, y1] = attributes.mediaBox;
    yield* evaluateRetainedContentSteps(this.document, prepared, {
      pageIndex: this.index, width: Math.abs(x1 - x0), height: Math.abs(y1 - y0),
      origin: [Math.min(x0, x1), Math.min(y0, y1)], rotation: attributes.rotation, resourcesDict: prepared.resources,
    }, shared, configured);
  }

  /** Stream UTF-8 raw-mode page text; share staging with content and resource
   * evaluation so a staged line cannot exceed the enclosing scratch allowance. */
  async *streamRawText(storage: PdfIndexStorage, options: PdfRetainedPageEvaluationOptions & PdfRawTextOptions = {}): AsyncGenerator<Uint8Array, void, void> {
    const shared = new PdfStagingStorage(storage, options.maxStagingBytes);
    const operations = this.evaluateSteps(shared, options);
    async function* glyphs() {
      for await (const event of operations) {
        if (!event.insideSoftMask && event.operation.kind === "glyph") yield event.operation.value;
      }
    }
    yield* streamRawTextChunks(glyphs(), shared, options);
  }

  /** Index raw-order text geometry and strings on caller storage. The caller
   * closes the returned index after consuming its block/line/word iterators. */
  async indexRawText(storage: PdfIndexStorage, options: PdfRetainedPageEvaluationOptions & PdfRawTextIndexOptions = {}): Promise<PdfRawTextIndex> {
    const shared = new PdfStagingStorage(storage, options.maxStagingBytes);
    const owned = options.imageStorage || options.pathStorage ? undefined : new PagedStorage({ fs: shared.fs, cwd: shared.directory, env: {}, signal: options.signal ?? new AbortController().signal }, 4);
    const operations = this.evaluateSteps(shared, { ...options, ...(owned ? { pathStorage: owned } : {}), retainActualText: true });
    async function* glyphs() {
      for await (const event of operations) if (!event.insideSoftMask && event.operation.kind === "glyph") yield event.operation.value;
    }
    let index: PdfRawTextIndex | undefined;
    try {
      index = await PdfRawTextIndex.create(glyphs(), shared, options);
      await owned?.close();
      return index;
    } catch (error) {
      await index?.close().catch(() => {});
      await owned?.close().catch(() => {});
      throw error;
    }
  }

  /** Pull one annotation at a time. Destination page lookup uses the document's
   * caller-backed traversal index, without retaining a document-wide page map. */
  async *annotations(): AsyncGenerator<import("./ast.js").PdfLinkAnnotation, void, void> {
    const work = extractPageAnnotationSteps(this.dict, this.document.crossReference.rootRef, this.document.depthLimit);
    try {
      let step = work.next();
      while (!step.done) {
        const request = step.value;
        let result: PdfAnnotationResult;
        if (request.kind === "annotation") yield request.annotation;
        else if (request.kind === "resolve") {
          const resolved = await this.document.lookup(request.node);
          result = resolved?.stream && resolved.value.kind === "dict"
            ? { kind: "stream", dict: resolved.value, rawBytes: new Uint8Array() } : resolved?.value;
        }
        else if (request.kind === "page-number") result = await this.document.annotationPageNumber(request.reference);
        else throw new TypeError("Unexpected annotation request");
        step = work.next(result);
      }
    } finally { work.return(); }
  }

  /** Preserve the buffered page API's newline after each content-array stream. */
  async *streamContents(): AsyncGenerator<Uint8Array, void, void> {
    const content = await this.document.lookup(dictGet(this.dict, "Contents"));
    if (content?.stream && content.reference) yield* this.document.objects.decodeStream(content.reference.objectNumber, content.reference.generationNumber);
    else if (content?.value.kind === "array") for (const item of content.value.items) {
      const stream = await this.document.lookup(item);
      if (!stream?.stream || !stream.reference) continue;
      yield* this.document.objects.decodeStream(stream.reference.objectNumber, stream.reference.generationNumber);
      yield new Uint8Array([10]);
    }
  }
}

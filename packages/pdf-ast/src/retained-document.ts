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
export interface PdfRetainedValue {
  readonly value: PdfCosNode;
  readonly reference?: PdfCosRef;
  /** Encoded stream range in the retained input, when this is a stream. */
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
    private readonly options: PdfRetainedDocumentOptions, private readonly controller: AbortController) {
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

  private assertOpen(): void {
    if (this.closing) throw new PdfError("E_CAPABILITY", "Retained PDF document is closed");
    this.options.signal?.throwIfAborted();
  }

  /** Resolve a bounded reference chain, retaining the final stream's identity. */
  async lookup(node: PdfCosNode | undefined): Promise<PdfRetainedValue | undefined> {
    this.assertOpen();
    let reference: PdfCosRef | undefined;
    const visited = new Set<number>();
    const maximum = this.options.maxRecursionDepth ?? 100;
    while (node?.kind === "ref") {
      if (visited.size >= maximum) throw new PdfError("E_LIMIT", "PDF reference depth limit exceeded");
      if (visited.has(node.objectNumber)) throw new PdfError("E_PARSE", "Circular PDF indirect reference");
      visited.add(node.objectNumber); reference = node;
      const object = await this.objects.get(node.objectNumber, node.generationNumber);
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
        if (resolved?.value.kind !== "dict" || resolved.stream) return;
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
        const root = (await doc.lookup(doc.crossReference.rootRef))?.value;
        if (root?.kind === "dict") yield* walk(dictGet(root, "Pages"), 0);
      } catch (error) { failed = true; throw error; }
      finally {
        doc.walks.delete(work);
        try { await visited.close(); } catch (error) { if (!failed) await Promise.reject(error); }
      }
    }
    const work = visit(this);
    return work;
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
    const keys = ["MediaBox", "CropBox", "BleedBox", "TrimBox", "ArtBox", "Rotate", "Resources"];
    let current: PdfCosDict | undefined = this.dict;
    const visited = new Set<number>();
    let depth = 0;
    while (current) {
      if (depth++ > this.document.depthLimit) throw new PdfError("E_LIMIT", "PDF inherited page depth limit exceeded");
      for (const key of keys) {
        const entry = dictGet(current, key);
        if (!values.has(key) && entry) values.set(key, (await this.document.lookup(entry))?.value);
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
    const mediaBox = await box(values.get("MediaBox"), this.document) ?? [0, 0, 612, 792];
    const rotation = values.get("Rotate");
    const resources = values.get("Resources");
    const normalizedRotation = rotation?.kind === "number" ? ((rotation.value % 360) + 360) % 360 : 0;
    return {
      mediaBox,
      cropBox: await box(values.get("CropBox"), this.document) ?? mediaBox,
      bleedBox: await box(values.get("BleedBox"), this.document) ?? mediaBox,
      trimBox: await box(values.get("TrimBox"), this.document) ?? mediaBox,
      artBox: await box(values.get("ArtBox"), this.document) ?? mediaBox,
      rotation: normalizedRotation === 90 || normalizedRotation === 180 || normalizedRotation === 270 ? normalizedRotation : 0,
      resources: resources?.kind === "dict" ? resources : cosDict({}),
    };
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

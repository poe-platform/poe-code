import type { PdfMutableObjectStore } from "./cos/mutable-object-store.js";
import type { PdfIndexStorage } from "./cos/object-index.js";
import { PdfMergeOutlines } from "./edit/retained-merge-outlines.js";
import { walkRetainedAttachments, type PdfRetainedAttachment } from "./extract/retained-attachments.js";
import { walkRetainedFonts, type PdfFontSelection, type PdfRetainedFont } from "./extract/retained-fonts.js";
import { walkRetainedFormFieldDetails, type PdfRetainedFormFieldDetails } from "./extract/retained-form-field-details.js";
import { walkRetainedFormFields, type PdfRetainedFormField } from "./extract/retained-form-fields.js";
import { walkRetainedImages, type PdfImageSelection, type PdfRetainedImage } from "./extract/retained-images.js";
import { walkRetainedJavaScripts, type PdfRetainedJavaScript } from "./extract/retained-javascript.js";
import { walkRetainedDestinations, walkRetainedUrls, type PdfRetainedDestination, type PdfRetainedUrl, type PdfUrlSelection } from "./extract/retained-links.js";
import { walkRetainedPageLabels, type PdfRetainedPageLabel } from "./extract/retained-page-labels.js";
import { walkRetainedStructure, type PdfRetainedStructureItem, type PdfStructureSelection } from "./extract/retained-structure.js";
import { PdfRetainedReader, openRetainedSource, openRetainedStore, type PdfRetainedDocumentOptions, type PdfStoredDocumentOptions } from "./retained-reader.js";
import type { PdfFileSource } from "./source.js";
import { PdfStagingStorage } from "./staging-budget.js";
export { PdfRetainedPage, PdfRetainedReader, type PdfRetainedDocumentOptions, type PdfRetainedPageAttributes, type PdfRetainedValue, type PdfStoredDocumentOptions } from "./retained-reader.js";

/** Retained document reader with document-wide extraction conveniences. */
export class PdfRetainedDocument extends PdfRetainedReader {
  static override async open(source: PdfFileSource, storage: PdfIndexStorage, options: PdfRetainedDocumentOptions = {}): Promise<PdfRetainedDocument> {
    return new PdfRetainedDocument(await openRetainedSource(source, storage, options));
  }

  static async openStore(store: PdfMutableObjectStore, storage: PdfIndexStorage, options: PdfStoredDocumentOptions): Promise<PdfRetainedDocument> {
    return new PdfRetainedDocument(await openRetainedStore(store, storage, options));
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

  outlineDetails(options: { readonly includeUntitled?: boolean; readonly includeNameTitles?: boolean } = {}): AsyncGenerator<{ title: string; pageIndex: number; level: number }, void, void> {
    async function* visit(doc: PdfRetainedDocument): AsyncGenerator<{ title: string; pageIndex: number; level: number }, void, void> {
      doc.assertOpen(); doc.walks.add(work);
      const storage = new PdfStagingStorage(doc.storage, doc.options.maxTraversalStagingBytes);
      const outlines = new PdfMergeOutlines(storage, doc.options.signal!, Infinity);
      let failed = false;
      try { await outlines.append(doc, 0, options.includeUntitled ?? false, options.includeNameTitles ?? true); yield* outlines.details(); }
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

  formFieldDetails(): AsyncGenerator<PdfRetainedFormFieldDetails, void, void> {
    async function* visit(doc: PdfRetainedDocument): AsyncGenerator<PdfRetainedFormFieldDetails, void, void> {
      doc.assertOpen(); doc.walks.add(work);
      try {
        yield* walkRetainedFormFieldDetails(doc, doc.storage, { maxDepth: doc.depthLimit,
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
}

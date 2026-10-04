import { PdfRetainedDocument, copyRetainedPagesChunks, retainedCosObjects, decodePdfString, dictGet, type PdfFileSource, type PdfIndexStorage, type PdfRetainedPageSelection } from "@poe-code/pdf-ast";
import { iterateQpdfPageRange } from "./page-range.js";
import type { RetainedQpdfOptions } from "./retained.js";

export class QpdfMissingInput extends Error {
  constructor(file: string) { super(`qpdf: cannot open ${file}\n`); }
}

async function validate(document: PdfRetainedDocument, storage: PdfIndexStorage, signal: AbortSignal): Promise<number> {
  for await (const object of retainedCosObjects(document, storage, { signal })) {
    if (object.stream) for await (const ignored of object.stream.chunks) void ignored;
  }
  let count = 0; for await (const ignored of document.pages()) { void ignored; count++; }
  return count;
}

/** Consume source documents sequentially. Inactive inputs keep their acquired
 * handles, but release range caches and all document/index/decoder ownership. */
export async function* copyQpdfSelections(base: PdfRetainedDocument, source: PdfFileSource, inputs: ReadonlyMap<string, PdfFileSource | undefined>,
  storage: PdfIndexStorage, options: RetainedQpdfOptions, signal: AbortSignal): AsyncGenerator<Uint8Array, void, void> {
  await validate(base, storage, signal);
  const metadata: Record<string, string> = {};
  if (!options.emptyInput) {
    const info = (await base.lookup(base.crossReference.infoRef))?.value;
    if (info?.kind === "dict") for (const key of ["Title", "Author"]) {
      const value = (await base.lookup(dictGet(info, key)))?.value;
      const text = value?.kind === "string" ? decodePdfString(value) : value?.kind === "name" ? value.decoded : undefined;
      if (text) metadata[key] = text;
    }
  }
  await base.close(); await source.releaseCache();
  async function* selections(): AsyncGenerator<PdfRetainedPageSelection> {
    for (const spec of options.pageSpecs) {
      signal.throwIfAborted();
      const key = spec.file === "." ? options.inputFile : spec.file, input = key === undefined ? undefined : inputs.get(key);
      if (!input) throw new QpdfMissingInput(spec.file);
      let document: PdfRetainedDocument | undefined, failed = false;
      try {
        const password = spec.password ?? options.password;
        document = await PdfRetainedDocument.open(input, storage, { signal, recovery: "repair", ...(password === undefined ? {} : { password }) });
        const count = await validate(document, storage, signal);
        function* indices() { for (const page of iterateQpdfPageRange(spec.range, count)) yield page - 1; }
        yield { document, indices: indices() };
      } catch (error) { failed = true; throw error; }
      finally {
        const closed = await Promise.allSettled([document?.close()]);
        const cleared = await Promise.allSettled([input.releaseCache()]);
        if (!failed) for (const result of [...closed, ...cleared]) if (result.status === "rejected") await Promise.reject(result.reason);
      }
    }
  }
  yield* copyRetainedPagesChunks(selections(), storage, { metadata, signal });
}

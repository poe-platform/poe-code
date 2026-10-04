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
  const selected = options.collateCount !== undefined && options.pageSpecs.length > 1
    ? collatedSelections(inputs, storage, options, signal) : selections();
  yield* copyRetainedPagesChunks(selected, storage, { metadata, signal });
}

/** Keep only range cursors between batches. Reopening uses the acquired file
 * identity, so inactive documents retain neither object indexes nor decoders.
 * Each yielded batch deliberately starts a new object-copy mapping, matching
 * the ordinary qpdf collator even when pages share fonts or image resources. */
async function* collatedSelections(inputs: ReadonlyMap<string, PdfFileSource | undefined>, storage: PdfIndexStorage,
  options: RetainedQpdfOptions, signal: AbortSignal): AsyncGenerator<PdfRetainedPageSelection> {
  const states: { input: PdfFileSource; password: string | undefined; indices: Generator<number, void, void>; next: IteratorResult<number, void> }[] = [];
  for (const spec of options.pageSpecs) {
    signal.throwIfAborted();
    const key = spec.file === "." ? options.inputFile : spec.file, input = key === undefined ? undefined : inputs.get(key);
    if (!input) throw new QpdfMissingInput(spec.file);
    const password = spec.password ?? options.password;
    let document: PdfRetainedDocument | undefined, failed = false;
    try {
      document = await PdfRetainedDocument.open(input, storage, { signal, recovery: "repair", ...(password === undefined ? {} : { password }) });
      const indices = iterateQpdfPageRange(spec.range, await validate(document, storage, signal));
      states.push({ input, password, indices, next: indices.next() });
    } catch (error) { failed = true; throw error; }
    finally {
      const closed = await Promise.allSettled([document?.close()]);
      const cleared = await Promise.allSettled([input.releaseCache()]);
      if (!failed) for (const result of [...closed, ...cleared]) if (result.status === "rejected") await Promise.reject(result.reason);
    }
  }
  while (states.some(state => !state.next.done)) for (const state of states) {
    signal.throwIfAborted(); if (state.next.done) continue;
    let document: PdfRetainedDocument | undefined, failed = false;
    try {
      document = await PdfRetainedDocument.open(state.input, storage, { signal, recovery: "repair", ...(state.password === undefined ? {} : { password: state.password }) });
      function* batch() {
        for (let count = 0; count < options.collateCount! && !state.next.done; count++) {
          const page = state.next.value; state.next = state.indices.next(); yield page - 1;
        }
      }
      yield { document, indices: batch() };
    } catch (error) { failed = true; throw error; }
    finally {
      const closed = await Promise.allSettled([document?.close()]);
      const cleared = await Promise.allSettled([state.input.releaseCache()]);
      if (!failed) for (const result of [...closed, ...cleared]) if (result.status === "rejected") await Promise.reject(result.reason);
    }
  }
}

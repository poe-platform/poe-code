import { cosDict, type PdfCosDict, type PdfCosNode, type PdfCosRef, type PdfCosStream } from "../ast.js";
import { decodePdfStreamChunks } from "../cos/filter-stream.js";
import type { PdfIndexStorage } from "../cos/object-index.js";
import type { PdfRetainedDocument, PdfRetainedPage } from "../retained-document.js";
import { preparePageAppearanceSteps, type PdfAppearanceResult } from "./appearance.js";
import type { PdfContentEvent } from "./parser.js";
import { parseContentStreamEvents } from "./range-events.js";
import type { PdfRetainedEvaluationOptions } from "./retained-evaluator.js";

export interface PdfRetainedPageEvaluationOptions extends PdfRetainedEvaluationOptions {
  readonly hideAnnotations?: boolean;
}

/** Resources from all nonempty appearances precede base-page evaluation, just
 * as in the buffered API. A prepass avoids retaining an appearance plan or its
 * content: each cursor closes before the next annotation. */
export async function prepareRetainedPageContent(document: PdfRetainedDocument, page: PdfRetainedPage,
  pageResources: PdfCosDict, storage: PdfIndexStorage, options: PdfRetainedPageEvaluationOptions) {
  options.onAllocation?.(64);
  const resources = cosDict(); const identities = new WeakMap<PdfCosStream, PdfCosRef>();
  const chunkBytes = options.chunkBytes ?? 4096;
  async function resolve(node: PdfCosNode | undefined) {
    options.signal?.throwIfAborted(); options.onAllocation?.(64);
    const resolved = await document.lookup(node);
    if (resolved?.stream && resolved.reference && resolved.value.kind === "dict") {
      options.onAllocation?.(128);
      const stream: PdfCosStream = { kind: "stream", dict: resolved.value, rawBytes: new Uint8Array() };
      identities.set(stream, resolved.reference); return stream;
    }
    return resolved?.value;
  }
  function cursor(stream: PdfCosStream) {
    options.onAllocation?.(chunkBytes * 5);
    const reference = identities.get(stream);
    const chunks = reference ? document.objects.decodeStream(reference.objectNumber, reference.generationNumber)
      : decodePdfStreamChunks(stream.dict, async function* () { yield stream.rawBytes; }, { chunkBytes, ...(options.signal ? { signal: options.signal } : {}) });
    return parseContentStreamEvents(chunks, storage, { ...options, ...(options.imageStorage ? {pathStorage:options.imageStorage} : {}) });
  }
  async function* appearances(outputResources: PdfCosDict, emit: boolean): AsyncGenerator<PdfContentEvent, void, void> {
    const work = preparePageAppearanceSteps(page.dict, pageResources, outputResources, options.hideAnnotations, options.onAllocation);
    let content: AsyncGenerator<PdfContentEvent, void, void> | undefined;
    let first: IteratorResult<PdfContentEvent, void> | undefined;
    let failed = false;
    try {
      let step = work.next();
      while (!step.done) {
        options.signal?.throwIfAborted();
        const request = step.value; let result: PdfAppearanceResult;
        if (request.kind === "resolve" || request.kind === "catalog") result = await resolve(request.kind === "catalog" ? document.crossReference.rootRef : request.node);
        else if (request.kind === "appearance-content") {
          content = cursor(request.stream); first = await content.next(); result = !first.done;
          if (!emit || first.done) { await content.return(); content = undefined; }
        } else if (emit) {
          if (request.stream) {
            yield { kind: "begin-group", group: { kind: "graphics-group", ops: [] } };
            yield* request.nodes;
            if (first && !first.done) yield first.value;
            if (content) { yield* content; content = undefined; }
            yield { kind: "end-group" };
          } else yield* request.nodes;
        }
        step = work.next(result);
      }
    } catch (error) { failed = true; throw error; }
    finally { work.return(); await content?.return().catch(error => { if (!failed) throw error; }); }
  }
  for await (const ignored of appearances(resources, false)) { void ignored; }
  async function* events(): AsyncGenerator<PdfContentEvent, void, void> {
    options.onAllocation?.(chunkBytes * 5);
    yield* parseContentStreamEvents(page.streamContents(), storage, { ...options, ...(options.imageStorage ? {pathStorage:options.imageStorage} : {}) });
    // Keep the prepass resources intact: an earlier appearance may use a resource
    // introduced by a later one, matching the buffered merged-resource behavior.
    options.onAllocation?.(64);
    yield* appearances(cosDict(), true);
  }
  return { resources, events: events() };
}

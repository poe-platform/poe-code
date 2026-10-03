import type { PdfCosDict } from "../ast.js";
import { PdfError } from "../errors.js";
import type { PdfFileSource } from "../source.js";
import { parseCosRangeObject, parseCosRangeValue, type ParseCosRangeOptions, type PdfRangeObject } from "./range-parser.js";
import { repairCandidateSteps } from "./repair-scanner.js";

export type PdfRepairEvent =
  | { kind: "object"; object: PdfRangeObject }
  | { kind: "trailer"; offset: number; trailer: PdfCosDict };

/** Discover damaged-document object bodies and trailers on demand. Stream
 * payloads stay in the caller-owned source. Duplicate objects remain in file
 * order so the consumer can apply latest-body precedence in an external index. */
export async function* scanCosRangeObjects(source: PdfFileSource, options: ParseCosRangeOptions = {}): AsyncGenerator<PdfRepairEvent, void> {
  const configured = { maxNodes: 65536, maxTokenBytes: 1024 * 1024, maxRecursionDepth: 100, ...options, recovery: "repair" as const };
  const { signal } = configured;
  const work = repairCandidateSteps(source.size);
  let cache: Uint8Array = new Uint8Array(0); let start = 0; let turns = 0;
  try {
    let step = work.next();
    while (!step.done) {
      signal?.throwIfAborted();
      if (++turns % 4096 === 0) { await new Promise<void>(resolve => setTimeout(resolve, 0)); signal?.throwIfAborted(); }
      const request = step.value;
      let result: number | undefined;
      if (request.kind === "byte") {
        if (request.offset < source.size) {
          if (request.offset < start || request.offset >= start + cache.length) {
            start = request.offset; cache = await source.read(start, Math.min(source.chunkBytes, source.size - start), signal);
          }
          result = cache[request.offset - start];
        }
      } else {
        let event: PdfRepairEvent | undefined;
        try {
          if (request.kind === "object") {
            const object = await parseCosRangeObject(source, request.offset, configured);
            result = object.span.end;
            event = { kind: "object", object };
          } else {
            const parsed = await parseCosRangeValue(source, request.offset, configured);
            result = parsed.offset;
            if (parsed.value?.kind === "dict") event = { kind: "trailer", offset: request.offset, trailer: parsed.value };
          }
        } catch (error) {
          signal?.throwIfAborted();
          // Only malformed PDF syntax is repairable. Storage, admission and
          // cancellation failures must never silently discard an object.
          if (!(error instanceof PdfError) || error.code !== "E_PARSE") throw error;
        }
        if (event) yield event;
      }
      step = work.next(result);
    }
  } finally { work.return(); }
}

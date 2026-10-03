import type { PdfIndexStorage } from "../cos/object-index.js";
import { PdfFileSource } from "../source.js";
import { parseContentSteps, type PdfContentEvent, type PdfContentParseResult } from "./parser.js";
import { parseContentRangeOperators, type ParseContentRangeOptions } from "./range-operator-parser.js";

/** Pull shared grammar events from caller-owned content storage. Inline images
 * borrow source ranges instead of collecting their payloads. Operand values and
 * individual paths still follow the shared parser's materialization rules. */
export async function* parseContentRangeEvents(source: PdfFileSource, storage: PdfIndexStorage,
  options: ParseContentRangeOptions = {}): AsyncGenerator<PdfContentEvent, void, void> {
  const operators = parseContentRangeOperators(source, storage, options);
  const work = parseContentSteps();
  let failed = false;
  try {
    let step = work.next();
    while (!step.done) {
      options.signal?.throwIfAborted();
      let result: PdfContentParseResult;
      const request = step.value;
      switch (request.kind) {
        case "operator": { const next = await operators.next(); result = next.done ? undefined : next.value; break; }
        case "inline-image": result = { kind: "range", source, start: request.start, end: request.end }; break;
        case "event": yield request.event; break;
      }
      step = work.next(result);
    }
  } catch (error) { failed = true; throw error; }
  finally {
    work.return();
    await operators.return().catch(error => { if (!failed) throw error; });
  }
}

/** Stage decoded chunks on caller storage for the seek-dependent content parser.
 * The iterator owns staging; borrowed inline ranges are valid only until it is
 * closed. Decoding completes before the first event. Content and operand spill
 * share this cursor's staging limit; other cursors need enclosing admission. */
export async function* parseContentStreamEvents(input: AsyncIterable<Uint8Array> | Iterable<Uint8Array>,
  storage: PdfIndexStorage, options: ParseContentRangeOptions = {}): AsyncGenerator<PdfContentEvent, void, void> {
  const chunkBytes = options.chunkBytes ?? 4096;
  if (!Number.isSafeInteger(chunkBytes) || chunkBytes < 8) throw new RangeError("chunkBytes must be at least 8");
  const maxStagingBytes = options.maxStagingBytes ?? Infinity;
  const source = await PdfFileSource.fromStream(storage.fs, storage.directory, input, {
    chunkBytes, cacheBytes: chunkBytes, maxInputBytes: maxStagingBytes,
    ...(options.signal ? { signal: options.signal } : {}),
  });
  let failed = false;
  try {
    yield* parseContentRangeEvents(source, storage, { ...options, maxStagingBytes: maxStagingBytes - source.size });
  } catch (error) { failed = true; throw error; }
  finally { await source.close().catch(error => { if (!failed) throw error; }); }
}

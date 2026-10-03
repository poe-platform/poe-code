import type { PdfIndexStorage } from "../cos/object-index.js";
import type { PdfFileSource } from "../source.js";
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

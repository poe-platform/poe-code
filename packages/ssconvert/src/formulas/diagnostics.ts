import { SsconvertError, type CapabilityContext, type Diagnostic } from "../contracts.js";
import type { Workbook } from "../workbook.js";
import { recalculateWorkbook } from "./evaluator.js";

/** Synchronous calculation notices settle in order before any export or failure. */
export async function recalculateWithDiagnostics(book: Workbook, context: CapabilityContext, force = false): Promise<Workbook> {
  const notices: Diagnostic[] = [];
  let bytes = 0;
  try {
    return recalculateWorkbook(book, context, force, diagnostic => {
      bytes += new TextEncoder().encode(diagnostic.message).byteLength + 1;
      if (bytes > context.limits.outputBytes) throw new SsconvertError("resource-limit", "ssconvert diagnostic bytes limit exceeded");
      notices.push(diagnostic);
    });
  } finally {
    for (const notice of notices) {
      context.signal.throwIfAborted();
      await context.diagnostic?.(notice);
      context.signal.throwIfAborted();
    }
  }
}

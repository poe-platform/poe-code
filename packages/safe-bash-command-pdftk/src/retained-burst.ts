import { editRetainedDocument, createRetainedPageCopy, saveRetainedDocumentChunks, type PdfRetainedDocument } from "@poe-code/pdf-ast";
import { formatBurstFilename } from "./burst-filename.js";
import { retainedInspectionReport } from "./retained-inspection.js";
import type { PdftkArguments } from "./arguments.js";

type Storage = Parameters<typeof saveRetainedDocumentChunks>[1];

/** Retain only one copied graph while the caller consumes each output. */
export async function* retainedBurst(document: PdfRetainedDocument, storage: Storage, options: PdftkArguments, pageCount: number, signal: AbortSignal): AsyncGenerator<{ path: string; chunks: AsyncIterable<Uint8Array> }> {
  const pattern = options.outputTarget ?? "pg_%04d.pdf";
  const slash = pattern.lastIndexOf("/");
  const report = slash < 0 ? "doc_data.txt" : `${pattern.slice(0, slash + 1)}doc_data.txt`;
  const repeated = formatBurstFilename(pattern, 1) === formatBurstFilename(pattern, 2);
  for (let index = repeated ? Math.max(0, pageCount - 1) : 0; index < pageCount; index++) {
    signal.throwIfAborted();
    const path = formatBurstFilename(pattern, index + 1);
    // The compatibility runner publishes only the final value of a repeated
    // filename, and never publishes the stdin/stdout sentinel as a file.
    if (path === "-" || path === report) continue;
    const copy = await createRetainedPageCopy(document, [index], storage, { signal });
    let edited: Awaited<ReturnType<typeof editRetainedDocument>> | undefined;
    let failed = false;
    try {
      if (options.shouldFlatten) edited = await editRetainedDocument(await copy.openDocument(), storage, { signal, flattenForms: true });
      const chunks = options.compressStreams || options.uncompressStreams || edited
        ? saveRetainedDocumentChunks(edited?.document ?? await copy.openDocument(), storage, { signal, streamMode: options.uncompressStreams ? "uncompress" : options.compressStreams ? "compress" : "preserve" })
        : copy.chunks();
      yield { path, chunks };
    } catch (error) { failed = true; throw error; }
    finally { const results = await Promise.allSettled([edited?.close(), copy.close()]); if (!failed) for (const result of results) if (result.status === "rejected") await Promise.reject(result.reason); }
  }
  yield { path: report, chunks: retainedInspectionReport(document, storage, false, signal, "document") };
}

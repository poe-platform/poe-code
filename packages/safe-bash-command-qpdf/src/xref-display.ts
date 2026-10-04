import { PdfError, PdfObjectIndex, findPdfStartXref, readCosXrefRevision, type PdfFileSource, type PdfIndexStorage, type PdfRetainedDocument } from "@poe-code/pdf-ast";

export async function* xrefDisplayParts(document: PdfRetainedDocument, source: PdfFileSource, storage: PdfIndexStorage, highest: number, signal: AbortSignal): AsyncGenerator<string> {
  let latest: PdfObjectIndex | undefined, failed = false;
  try {
    try {
      const offset = await findPdfStartXref(source, { signal });
      latest = await PdfObjectIndex.build(readCosXrefRevision(source, offset, { signal }), storage, { signal, duplicate: "last" });
    } catch (error) {
      signal.throwIfAborted();
      if (!(error instanceof PdfError) || error.code !== "E_PARSE") throw error;
      // Repaired input may have no complete latest revision, matching the
      // buffered inspection's empty revision map.
    }
    let count = 0;
    for await (const entry of document.crossReference.index.entries(signal)) {
      if (entry.type === "free") continue;
      const number = entry.objectNumber, generation = entry.generationNumber ?? 0;
      const object = await document.objects.get(number, generation);
      if (!object) throw new PdfError("E_PARSE", "Missing indexed PDF object");
      const type = object.stream ? "stream" : object.value.kind, revision = await latest?.get(number, signal);
      // The compatibility formatter reads indexInObjectStream, while parser
      // records use indexInStream. Preserve its existing text output.
      yield revision?.type === "compressed"
        ? `${number}/0: compressed; stream = ${revision.objectStreamNumber}; index = ${revision.indexInObjectStream}; type = ${type}\n`
        : `${number}/${generation}: uncompressed; type = ${type}\n`;
      if (++count % 64 === 0) await new Promise<void>(resolve => setTimeout(resolve, 0));
    }
    for await (const page of document.pages()) if (!page.reference) { yield `${++highest}/0: uncompressed; type = dict\n`; count++; }
    if (!count) yield "\n";
  } catch (error) { failed = true; throw error; }
  finally { await latest?.close().catch(error => { if (!failed) return Promise.reject(error); }); }
}

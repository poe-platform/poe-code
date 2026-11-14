import { readPdfHeader, type PdfFileSource, type PdfRetainedDocument } from "@poe-code/pdf-ast";

export async function* xrefDisplayParts(document: PdfRetainedDocument, source: PdfFileSource, highest: number, signal: AbortSignal): AsyncGenerator<string> {
  const { offset: headerOffset } = await readPdfHeader(source, signal);
  let count = 0;
  for await (const entry of document.crossReference.index.entries(signal)) {
    if (entry.type === "free") continue;
    const number = entry.objectNumber, generation = entry.generationNumber ?? 0;
    // Buffered repair discards revisions and exposes recovered objects without
    // their object-stream locations. Keep that fallback for repaired documents.
    if (entry.type === "compressed" && document.crossReference.revisionCount === 0) {
      const object = await document.objects.get(number, generation);
      yield `${number}/${generation}: uncompressed; type = ${object!.value.kind}\n`;
    } else yield entry.type === "compressed"
      ? `${number}/0: compressed; stream = ${entry.objectStreamNumber}, index = ${entry.indexInStream ?? entry.indexInObjectStream}\n`
      : `${number}/${generation}: uncompressed; offset = ${entry.offset! - headerOffset}\n`;
    if (++count % 64 === 0) await new Promise<void>(resolve => setTimeout(resolve, 0));
  }
  for await (const page of document.pages()) if (!page.reference) { yield `${++highest}/0: uncompressed; type = dict\n`; count++; }
  if (!count) yield "\n";
}

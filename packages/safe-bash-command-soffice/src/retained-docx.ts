import { createZipCodec, type ZipSealedArchive } from "@poe-code/office-package";
import type { PagedStorage } from "@poe-code/safe-fs/storage";
import type { RetainedRtfText, RetainedRtfSnapshot } from "./retained-rtf.js";
import { docxMetadata, docxDocumentPrefix, docxDocumentSuffix } from "./docx-parts.js";

/** XML and ZIP records remain in the same caller-owned backing as their text. */
export async function retainRtfDocx(storage: PagedStorage, text: RetainedRtfText, snapshot: RetainedRtfSnapshot, signal: AbortSignal): Promise<ZipSealedArchive> {
  const writer = createZipCodec(undefined, { utcDates: true }).createStagedWriter(storage, {
    maxArchiveBytes: Infinity, maxEntryBytes: Infinity, maxTotalBytes: Infinity, maxMembers: Infinity,
    maxPathBytes: Infinity, maxDepth: Infinity, maxPaxBytes: Infinity, maxTextBytes: Infinity, chunkSize: 16384
  }, signal);
  const attributes = { modified: new Date("1980-01-01T00:00:00Z"), mode: 0o100644, directory: false, symlink: false, compression: "store" as const };
  const encoder = new TextEncoder();
  for (const [name, content] of Object.entries(docxMetadata))
    await writer.addSource(name, (async function* () { yield encoder.encode(content); })(), attributes);
  const escape = (value: string) => value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
  await writer.addSource("word/document.xml", (async function* () {
    yield encoder.encode(docxDocumentPrefix);
    for (let block = 0; block < snapshot.count; block++) {
      signal.throwIfAborted();
      yield encoder.encode(block ? "<w:p><w:r><w:t>" : '<w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t>');
      const decoder = new TextDecoder();
      for await (const bytes of text.streamBlock(snapshot, block)) yield encoder.encode(escape(decoder.decode(bytes, { stream: true })));
      yield encoder.encode(escape(decoder.decode()) + "</w:t></w:r></w:p>");
    }
    yield encoder.encode(docxDocumentSuffix);
  })(), attributes);
  return writer.seal();
}

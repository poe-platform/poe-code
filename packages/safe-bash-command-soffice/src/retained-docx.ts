import { createZipCodec, type ZipSealedArchive } from "@poe-code/office-package";
import type { PagedStorage } from "@poe-code/safe-fs/storage";
import type { RetainedTextSnapshot, RetainedTextBlocks } from "./retained-blocks.js";
import { docxMetadata, docxDocumentPrefix, docxDocumentSuffix } from "./docx-parts.js";

/** XML and ZIP records remain in the same caller-owned backing as their text. */
export async function retainTextDocx(storage: PagedStorage, text: RetainedTextBlocks, snapshot: RetainedTextSnapshot, signal: AbortSignal): Promise<ZipSealedArchive> {
  const encoder = new TextEncoder();
  const escape = (value: string) => value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
  return retainDocxXml(storage, (async function* () {
    yield encoder.encode(docxDocumentPrefix);
    for (let block = 0; block < snapshot.count; block++) {
      signal.throwIfAborted();
      yield encoder.encode(!(await text.isHeading(snapshot, block)) ? "<w:p><w:r><w:t>" : '<w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t>');
      const decoder = new TextDecoder("utf-8", { ignoreBOM: true });
      for await (const bytes of text.streamBlock(snapshot, block)) yield encoder.encode(escape(decoder.decode(bytes, { stream: true })));
      yield encoder.encode(escape(decoder.decode()) + "</w:t></w:r></w:p>");
    }
    yield encoder.encode(docxDocumentSuffix);
  })(), signal);
}

/** Package a bounded document XML stream with the standard DOCX metadata. */
export async function retainDocxXml(storage: PagedStorage, source: AsyncIterable<Uint8Array>, signal: AbortSignal): Promise<ZipSealedArchive> {
  const writer = createZipCodec(undefined, { utcDates: true }).createStagedWriter(storage, {
    maxArchiveBytes: Infinity, maxEntryBytes: Infinity, maxTotalBytes: Infinity, maxMembers: Infinity,
    maxPathBytes: Infinity, maxDepth: Infinity, maxPaxBytes: Infinity, maxTextBytes: Infinity, chunkSize: 16384
  }, signal);
  const attributes = { modified: new Date("1980-01-01T00:00:00Z"), mode: 0o100644, directory: false, symlink: false, compression: "store" as const };
  const encoder = new TextEncoder();
  for (const [name, content] of Object.entries(docxMetadata))
    await writer.addSource(name, (async function* () { yield encoder.encode(content); })(), attributes);
  await writer.addSource("word/document.xml", source, attributes);
  return writer.seal();
}

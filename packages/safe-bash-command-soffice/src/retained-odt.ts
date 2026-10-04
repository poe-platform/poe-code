import { createZipCodec } from "@poe-code/office-package/zip";
import { openRetainedXml, resolveOfficeResources, type RetainedXml, type XmlLexicalToken } from "@poe-code/office-xml";
import { IntegerTable, type PagedStorage } from "@poe-code/safe-fs/storage";
import { retainXmlText } from "./retained-xml-text.js";
import type { RetainedSofficeContext, SofficeSnapshot } from "./retained-input.js";

/** ODT/ODS/ODP Writer text extraction: values and output spans stay in caller storage. */
export async function retainOdtText(storage: PagedStorage, source: SofficeSnapshot, context: RetainedSofficeContext, paragraphSeparator = "\n"): Promise<SofficeSnapshot> {
  const { signal } = context, codec = createZipCodec();
  const limits = resolveOfficeResources({ archiveLimits: { chunkSize: 16384 } }).archiveLimits;
  let content: SofficeSnapshot | undefined;
  await codec.readZipArchive({ size: source.size, read: (offset, maximum) => storage.read(source.position + offset, Math.min(16384, maximum, source.size - offset)) }, limits, signal, {
    storage, async onEntry(entry) {
      const position = storage.allocate(0);
      let size = 0;
      for await (const bytes of codec.decodeZipEntry(entry, limits, signal)) {
        signal.throwIfAborted();
        if (entry.name === "content.xml") { await storage.append(bytes); size += bytes.length; }
      }
      if (entry.name === "content.xml") content = { position, size };
    }
  });
  if (!content) return { position: storage.allocate(0), size: 0 };
  const retained = content;
  const xml = await openRetainedXml((async function* () {
    for (let offset = 0; offset < retained.size; offset += 16384) {
      signal.throwIfAborted();
      yield new Uint8Array(await storage.read(retained.position + offset, Math.min(16384, retained.size - offset)));
    }
  })(), { signal, workingStorage: { fs: context.fs, directory: context.cwd } });
  let failed = true;
  try {
    const result = await extract(xml, storage, signal, paragraphSeparator);
    failed = false;
    return result;
  } finally { await xml.close().catch(error => { if (!failed) throw error; }); }
}

async function extract(xml: RetainedXml, storage: PagedStorage, signal: AbortSignal, paragraphSeparator: string): Promise<SofficeSnapshot> {
  const spans = new IntegerTable(storage), tokens = xml.tokens(), decoder = new TextDecoder();
  let count = 0, size = 0, blocks = 0;
  const newline = { position: await storage.append(Uint8Array.of(10)), size: 1 };
  const separatorBytes = new TextEncoder().encode(paragraphSeparator);
  const separator = { position: await storage.append(separatorBytes), size: separatorBytes.length };
  const tab = { position: await storage.append(Uint8Array.of(9)), size: 1 };
  const add = async (span: SofficeSnapshot) => {
    await spans.set(BigInt(count * 2), BigInt(span.position));
    await spans.set(BigInt(count * 2 + 1), BigInt(span.size));
    count++; size += span.size;
  };
  const name = async (token: XmlLexicalToken): Promise<string> => {
    if (token.range.length > 16) return "";
    let result = "";
    for await (const bytes of xml.read(token.range)) result += decoder.decode(bytes);
    return result;
  };
  const opening = async (): Promise<boolean> => {
    for (;;) {
      const next = await tokens.next();
      if (next.done) return false;
      if (next.value.kind === "start-end") return !next.value.empty;
    }
  };
  async function* textUntil(end?: string): AsyncGenerator<Uint8Array> {
    for (;;) {
      signal.throwIfAborted();
      const next = await tokens.next();
      if (next.done) return;
      const token = next.value;
      if (end && token.kind === "end-name" && await name(token) === end) return;
      if (token.kind === "text") yield* xml.read(token.range);
    }
  }
  const table = async () => {
    let rows = 0;
    for (;;) {
      const next = await tokens.next();
      if (next.done) return;
      const token = next.value, tag = token.kind === "start-name" || token.kind === "end-name" ? await name(token) : "";
      if (token.kind === "end-name" && tag === "table:table") return;
      if (token.kind !== "start-name" || tag !== "table:table-row" || !await opening()) continue;
      let cells = 0;
      for (;;) {
        const next = await tokens.next();
        if (next.done) return;
        const token = next.value, tag = token.kind === "start-name" || token.kind === "end-name" ? await name(token) : "";
        if (token.kind === "end-name" && tag === "table:table-row") break;
        if (token.kind !== "start-name" || tag !== "table:table-cell" || !await opening()) continue;
        const cell = await retainXmlText(storage, textUntil(tag), signal);
        if (!cells) {
          if (!rows) { if (blocks++) await add(separator); }
          else await add(newline);
          rows++;
        } else await add(tab);
        await add(cell); cells++;
      }
    }
  };
  try {
    for (;;) {
      signal.throwIfAborted();
      const next = await tokens.next();
      if (next.done) break;
      if (next.value.kind !== "start-name") continue;
      const tag = await name(next.value);
      if (!["text:h", "text:p", "table:table"].includes(tag) || !await opening()) continue;
      if (tag === "table:table") { await table(); continue; }
      const block = await retainXmlText(storage, textUntil(tag), signal);
      if (block.size) { if (blocks++) await add(separator); await add(block); }
    }
  } finally { await tokens.return(undefined); }
  if (!blocks) {
    return retainXmlText(storage, (async function* () {
      for await (const token of xml.tokens()) if (token.kind === "text") yield* xml.read(token.range);
    })(), signal);
  }
  // Span metadata shares this store. Reserve the complete output before reading it.
  const position = storage.allocate(size);
  let written = 0;
  for (let index = 0; index < count; index++) {
    const start = Number(await spans.get(BigInt(index * 2))), length = Number(await spans.get(BigInt(index * 2 + 1)));
    for (let offset = 0; offset < length; offset += 16384) {
      signal.throwIfAborted();
      const bytes = new Uint8Array(await storage.read(start + offset, Math.min(16384, length - offset)));
      await storage.write(position + written, bytes); written += bytes.length;
    }
  }
  return { position, size };
}

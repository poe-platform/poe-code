import { createZipCodec } from "@poe-code/office-package/zip";
import { openRetainedXml, resolveOfficeResources, type RetainedXml, type XmlLexicalToken, type XmlRange } from "@poe-code/office-xml";
import { IntegerTable, type PagedStorage } from "@poe-code/safe-fs/storage";
import { retainXmlText } from "./retained-xml-text.js";
import type { RetainedSofficeContext, SofficeSnapshot } from "./retained-input.js";

class Spans {
  private readonly values: IntegerTable;
  count = 0;
  constructor(private readonly storage: PagedStorage, private readonly signal: AbortSignal) { this.values = new IntegerTable(storage); }
  async add(span: SofficeSnapshot): Promise<void> {
    await this.values.set(BigInt(this.count * 2), BigInt(span.position));
    await this.values.set(BigInt(this.count * 2 + 1), BigInt(span.size)); this.count++;
  }
  async finish(first = 0): Promise<SofficeSnapshot> {
    let size = 0;
    for (let index = first; index < this.count; index++) size += Number(await this.values.get(BigInt(index * 2 + 1)));
    const position = this.storage.allocate(size); let written = 0;
    for (let index = first; index < this.count; index++) {
      const start = Number(await this.values.get(BigInt(index * 2))), length = Number(await this.values.get(BigInt(index * 2 + 1)));
      for (let offset = 0; offset < length; offset += 16384) {
        this.signal.throwIfAborted();
        const bytes = new Uint8Array(await this.storage.read(start + offset, Math.min(16384, length - offset)));
        await this.storage.write(position + written, bytes); written += bytes.length;
      }
    }
    return { position, size };
  }
}

class Cursor {
  readonly tokens: AsyncGenerator<XmlLexicalToken>;
  constructor(readonly xml: RetainedXml, private readonly storage: PagedStorage, private readonly signal: AbortSignal) { this.tokens = xml.tokens(); }
  async name(range: XmlRange): Promise<string> {
    if (range.length > 16) return "";
    let text = "";
    for await (const bytes of this.xml.read(range)) text += new TextDecoder().decode(bytes);
    return text;
  }
  async open(attribute?: (name: string, range: XmlRange, doubleQuoted: boolean) => Promise<void>): Promise<number | undefined> {
    let name = "";
    for (;;) {
      this.signal.throwIfAborted();
      const next = await this.tokens.next(); if (next.done) return undefined;
      if (next.value.kind === "attribute-name") name = await this.name(next.value.range);
      else if (next.value.kind === "attribute-value" && attribute) {
        let doubleQuoted = false;
        for await (const bytes of this.xml.read({ start: next.value.range.start - 1, length: 1 })) doubleQuoted = bytes[0] === 34;
        await attribute(name, next.value.range, doubleQuoted);
      }
      else if (next.value.kind === "start-end") return next.value.empty ? undefined : next.value.range.start;
    }
  }
  async field(tag: string, exact?: XmlRange): Promise<SofficeSnapshot | undefined> {
    const start = await this.open(); if (start === undefined) return undefined;
    for (;;) {
      this.signal.throwIfAborted();
      const next = await this.tokens.next(); if (next.done) return undefined;
      if (next.value.kind === "end-name" && await this.name(next.value.range) === tag)
        return exact && start !== exact.start + exact.length + 1 ? undefined : retainXmlText(this.storage, this.xml.read({ start, length: next.value.range.start - 2 - start }), this.signal, false);
    }
  }
}

/** XLSX cat keeps shared strings, cells and output spans in caller-owned storage. */
export async function retainXlsxText(storage: PagedStorage, source: SofficeSnapshot, context: RetainedSofficeContext): Promise<SofficeSnapshot> {
  const { signal } = context, codec = createZipCodec(), limits = resolveOfficeResources({ archiveLimits: { chunkSize: 16384 } }).archiveLimits;
  let shared: SofficeSnapshot | undefined, sheet: SofficeSnapshot | undefined, fallback: SofficeSnapshot | undefined, fallbackName: string | undefined;
  await codec.readZipArchive({ size: source.size, read: (offset, maximum) => storage.read(source.position + offset, Math.min(16384, maximum, source.size - offset)) }, limits, signal, {
    storage, async onEntry(entry) {
      if (fallbackName === undefined && entry.name.startsWith("xl/worksheets/sheet")) fallbackName = entry.name;
      const selected = entry.name === "xl/sharedStrings.xml" || entry.name === "xl/worksheets/sheet1.xml" || entry.name === fallbackName;
      const position = storage.allocate(0); let size = 0;
      for await (const bytes of codec.decodeZipEntry(entry, limits, signal)) {
        signal.throwIfAborted(); if (selected) { await storage.append(bytes); size += bytes.length; }
      }
      if (entry.name === "xl/sharedStrings.xml") shared = { position, size };
      if (entry.name === "xl/worksheets/sheet1.xml") sheet = { position, size };
      if (entry.name === fallbackName) fallback = { position, size };
    }
  });
  const strings = new IntegerTable(storage); let stringCount = 0;
  const open = async (snapshot: SofficeSnapshot) => openRetainedXml((async function* () {
    for (let offset = 0; offset < snapshot.size; offset += 16384) {
      signal.throwIfAborted(); yield new Uint8Array(await storage.read(snapshot.position + offset, Math.min(16384, snapshot.size - offset)));
    }
  })(), { signal, workingStorage: { fs: context.fs, directory: context.cwd } });
  const parse = async (snapshot: SofficeSnapshot, run: (cursor: Cursor) => Promise<void>) => {
    const xml = await open(snapshot), cursor = new Cursor(xml, storage, signal); let failed = true;
    try { await run(cursor); failed = false; }
    finally { try { await cursor.tokens.return(undefined); } finally { await xml.close().catch(error => { if (!failed) throw error; }); } }
  };
  if (shared) await parse(shared, async cursor => {
    const spans = new Spans(storage, signal);
    for (;;) {
      const next = await cursor.tokens.next(); if (next.done) break;
      if (next.value.kind !== "start-name" || await cursor.name(next.value.range) !== "si" || await cursor.open() === undefined) continue;
      const first = spans.count;
      for (;;) {
        const token = await cursor.tokens.next(); if (token.done) break;
        const name = await cursor.name(token.value.range);
        if (token.value.kind === "end-name" && name === "si") break;
        if (token.value.kind === "start-name" && name === "t") { const value = await cursor.field("t"); if (value) await spans.add(value); }
      }
      const value = await spans.finish(first);
      await strings.set(BigInt(stringCount * 2), BigInt(value.position)); await strings.set(BigInt(stringCount * 2 + 1), BigInt(value.size)); stringCount++;
    }
  });
  const output = new Spans(storage, signal), tab = { position: await storage.append(Uint8Array.of(9)), size: 1 }, newline = { position: await storage.append(Uint8Array.of(10)), size: 1 };
  let rows = 0;
  const selected = sheet ?? fallback;
  if (selected) await parse(selected, async cursor => {
    for (;;) {
      const next = await cursor.tokens.next(); if (next.done) break;
      if (next.value.kind !== "start-name" || await cursor.name(next.value.range) !== "row" || await cursor.open() === undefined) continue;
      let columns = 0;
      for (;;) {
        const next = await cursor.tokens.next(); if (next.done) break;
        const name = await cursor.name(next.value.range);
        if (next.value.kind === "end-name" && name === "row") break;
        if (next.value.kind !== "start-name" || name !== "c") continue;
        let type = "", typed = false, column: number | undefined;
        const start = await cursor.open(async (name, range, doubleQuoted) => {
          if (!doubleQuoted) return;
          const local = name.split(":").at(-1);
          if (local === "t" && !typed && range.length) { type = await cursor.name(range); typed = true; }
          else if (local?.toLowerCase() === "r" && column === undefined) column = await columnIndex(cursor.xml, range);
        });
        let value: SofficeSnapshot | undefined, inline: SofficeSnapshot | undefined;
        if (start !== undefined) for (;;) {
          const next = await cursor.tokens.next(); if (next.done) break;
          const name = await cursor.name(next.value.range);
          if (next.value.kind === "end-name" && name === "c") break;
          if (next.value.kind === "start-name" && name === "v" && !value) value = await cursor.field("v", next.value.range);
          else if (next.value.kind === "start-name" && name === "t" && !inline) inline = await cursor.field("t");
        }
        if (!columns) { if (rows) await output.add(newline); rows++; }
        while (column !== undefined && columns < column) { if (columns++) await output.add(tab); signal.throwIfAborted(); }
        if (columns++) await output.add(tab);
        if (type === "inlineStr") value = inline;
        else if (type === "s" && value) {
          const index = await sharedIndex(storage, value, signal);
          value = Number.isSafeInteger(index) && index >= 0 && index < stringCount ? { position: Number(await strings.get(BigInt(index * 2))), size: Number(await strings.get(BigInt(index * 2 + 1))) } : undefined;
        }
        if (value) await output.add(value);
      }
    }
  });
  return output.finish();
}

async function columnIndex(xml: RetainedXml, range: XmlRange): Promise<number | undefined> {
  let column = 0, digits = 0, letters = 0;
  for await (const bytes of xml.read(range)) for (const byte of bytes) {
    const upper = byte >= 97 && byte <= 122 ? byte - 32 : byte;
    if (upper >= 65 && upper <= 90 && !digits) { column = column * 26 + upper - 64; letters++; }
    else if (byte >= 48 && byte <= 57 && letters) digits++;
    else return undefined;
  }
  if (!letters || !digits) return undefined;
  if (!Number.isSafeInteger(column)) throw new RangeError("Column index exceeds safe storage addressing");
  return column - 1;
}

async function sharedIndex(storage: PagedStorage, source: SofficeSnapshot, signal: AbortSignal): Promise<number> {
  let value = 0, sign = 1, started = false, digits = false;
  const decoder = new TextDecoder("utf-8", { ignoreBOM: true });
  for (let offset = 0; offset < source.size; offset += 16384) {
    signal.throwIfAborted();
    for (const character of decoder.decode(await storage.read(source.position + offset, Math.min(16384, source.size - offset)), { stream: true })) {
      if (!started && !character.trim()) continue;
      if (!started && (character === "+" || character === "-")) { started = true; sign = character === "-" ? -1 : 1; continue; }
      started = true;
      if (character < "0" || character > "9") return digits ? sign * value : NaN;
      digits = true; value = value * 10 + Number(character);
    }
  }
  return digits ? sign * value : NaN;
}

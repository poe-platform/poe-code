import { resolvePath } from "@poe-code/safe-fs/core";
import { formatPdfNumber, cosDict, cosName, cosNumber, cosRef, cosString, serializeRetainedCosDocumentChunks, type PdfRetainedOutputObject, type PdfSerializedOutputObject } from "@poe-code/pdf-ast";
import { IntegerTable, type PagedStorage } from "@poe-code/safe-fs/storage";
import type { RetainedSofficeContext } from "./retained-input.js";
import type { retainPdfImage } from "./retained-pdf-image.js";

/** Linked bounded byte chunks tolerate metadata allocations in the same backing. */
class ByteChain {
  first = 0;
  private last = 0;
  size = 0;
  constructor(private readonly storage: PagedStorage, private readonly signal: AbortSignal) {}
  async append(bytes: Uint8Array): Promise<void> {
    for (let offset = 0; offset < bytes.length; offset += 16384) {
      this.signal.throwIfAborted();
      const chunk = bytes.subarray(offset, offset + 16384), pointer = this.storage.allocate(16 + chunk.length);
      const header = new Uint8Array(16); new DataView(header.buffer).setFloat64(8, chunk.length);
      await this.storage.write(pointer, header); await this.storage.write(pointer + 16, chunk);
      if (this.last) { const link = new Uint8Array(8); new DataView(link.buffer).setFloat64(0, pointer); await this.storage.write(this.last, link); }
      this.first ||= pointer; this.last = pointer; this.size += chunk.length;
    }
  }
}
async function* readChain(storage: PagedStorage, first: number, signal: AbortSignal): AsyncGenerator<Uint8Array> {
  for (let pointer = first; pointer;) {
    signal.throwIfAborted();
    const header = await storage.read(pointer, 16), view = new DataView(header.buffer, header.byteOffset, 16);
    yield new Uint8Array(await storage.read(pointer + 16, view.getFloat64(8))); pointer = view.getFloat64(0);
  }
}

/** Retain page commands, image resources and serialized objects in caller storage. */
export class RetainedPdf {
  private readonly encoder = new TextEncoder();
  private readonly pages: IntegerTable;
  private readonly images: IntegerTable;
  private readonly pageImages: IntegerTable;
  private readonly signal: AbortSignal;
  private page: ByteChain;
  private imageCount = 0;
  private pageImageFirst = 0;
  private pageCount = 0;
  constructor(private readonly storage: PagedStorage, private readonly context: RetainedSofficeContext) {
    this.signal = context.signal;
    this.pages = new IntegerTable(storage); this.images = new IntegerTable(storage); this.pageImages = new IntegerTable(storage);
    this.page = new ByteChain(storage, this.signal);
  }
  async append(value: string | Uint8Array): Promise<void> { await this.page.append(typeof value === "string" ? this.encoder.encode(value) : value); }
  async finishPage(): Promise<void> {
    await this.pageImages.set(BigInt(this.pageCount * 2), BigInt(this.pageImageFirst));
    await this.pageImages.set(BigInt(this.pageCount * 2 + 1), BigInt(this.imageCount - this.pageImageFirst)); this.pageImageFirst = this.imageCount;
    await this.pages.set(BigInt(this.pageCount * 2), BigInt(this.page.first)); await this.pages.set(BigInt(this.pageCount * 2 + 1), BigInt(this.page.size)); this.pageCount++;
    this.page = new ByteChain(this.storage, this.signal);
  }
  async image(image: NonNullable<Awaited<ReturnType<typeof retainPdfImage>>>, placement: {x: number; y: number; width: number; height: number}): Promise<void> {
    const values = [image.width, image.height, image.components, Number(image.jpeg), image.position, image.size, image.alpha];
    for (const [offset, value] of values.entries()) await this.images.set(BigInt(this.imageCount * 7 + offset), BigInt(value));
    await this.append(`q\n${formatPdfNumber(placement.width)} 0 0 ${formatPdfNumber(placement.height)} ${formatPdfNumber(placement.x)} ${formatPdfNumber(placement.y)} cm\n/Image${this.imageCount} Do\nQ\n`); this.imageCount++;
  }
  async save(options: {title?: string; creator: string; width?: number; height?: number; filterOptions?: string | undefined}): Promise<{size: number; read(): AsyncGenerator<Uint8Array>}> {
    const {storage, context, signal, encoder, pages, images, pageImages, imageCount, pageCount} = this;
    const {title, creator, filterOptions, width = 612, height = 792} = options;
  let firstPage = 0, outputPages = pageCount, version = "1.7", copied = false;
  if (filterOptions?.trim().startsWith("{")) {
    try {
      const filter = JSON.parse(filterOptions) as Record<string, unknown>;
      const unwrap = (key: string) => { const value = filter[key]; return value && typeof value === "object" && "value" in value ? value.value : value; };
      const range = unwrap("PageRange"), requestedVersion = unwrap("SelectPdfVersion");
      let selectedFirst = 0, selectedCount = pageCount;
      if (typeof range === "string" && range.trim()) {
        const [startText, endText] = range.trim().split("-");
        const start = Math.max(1, Number(startText) || 1), end = Math.min(pageCount, Number(endText ?? startText) || start);
        const count = end >= start ? Math.floor(end - start) + 1 : 0;
        if (count > 0 && count < pageCount) {
          if (!Number.isInteger(start)) throw new RangeError("Invalid page index");
          selectedFirst = start - 1; selectedCount = count;
        }
      }
      firstPage = selectedFirst; outputPages = selectedCount; copied = outputPages < pageCount;
      if (requestedVersion === 15) version = "1.5";
      else if (requestedVersion === 16) version = "1.6";
      else if (requestedVersion === 20) version = "2.0";
    } catch { /* Preserve LibreOffice's invalid FilterData fallback. */ }
  }
  const object = (objectNumber: number, value: PdfRetainedOutputObject["value"]): PdfRetainedOutputObject => ({ objectNumber, generationNumber: 0, value });
  async function* kids() {
    yield encoder.encode(`<< /Type /Pages /Count ${outputPages} /Kids [`);
    for (let index = 0; index < outputPages; index++) { signal.throwIfAborted(); yield encoder.encode(`${6 + index * 2} 0 R `); }
    yield encoder.encode("] >>");
  }
  let kidsLength = 0; for await (const bytes of kids()) kidsLength += bytes.length;
  async function* objects(): AsyncGenerator<PdfRetainedOutputObject | PdfSerializedOutputObject> {
    yield object(1, cosDict({ Type: cosName("Catalog"), Pages: cosRef(2) }));
    yield { objectNumber: 2, generationNumber: 0, body: { length: kidsLength, chunks: kids() } };
    yield object(3, cosDict({ Producer: cosString("@poe-code/pdf-ast"), ...(!copied ? { ...(title === undefined ? {} : {Title: cosString(title)}), Creator: cosString(creator) } : {}) }));
    for (const [index, name] of ["Helvetica", "Helvetica-Bold"].entries()) yield object(4 + index, cosDict({ Type: cosName("Font"), Subtype: cosName("Type1"), BaseFont: cosName(name), Encoding: cosName("WinAnsiEncoding") }));
    for (let index = 0; index < outputPages; index++) {
      const first = Number(await pageImages.get(BigInt((firstPage + index) * 2))), count = Number(await pageImages.get(BigInt((firstPage + index) * 2 + 1)));
      async function* pageBody() {
        yield encoder.encode(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${width} ${height}] /Resources << /Font << /Body 4 0 R /Heading 5 0 R >> /XObject << `);
        for (let image = first; image < first + count; image++) yield encoder.encode(`/Image${image} ${6 + outputPages * 2 + image * 2} 0 R `);
        yield encoder.encode(`>> >> /Contents ${7 + index * 2} 0 R >>`);
      }
      let length = 0; for await (const bytes of pageBody()) length += bytes.length;
      yield {objectNumber: 6 + index * 2, generationNumber: 0, body: {length, chunks: pageBody()}};
      yield { ...object(7 + index * 2, cosDict({})), stream: { length: Number(await pages.get(BigInt((firstPage + index) * 2 + 1))), chunks: readChain(storage, Number(await pages.get(BigInt((firstPage + index) * 2))), signal) } };
    }
    async function* read(position: number, size: number) {
      for (let offset = 0; offset < size; offset += 16384) { signal.throwIfAborted(); yield new Uint8Array(await storage.read(position + offset, Math.min(16384, size - offset))); }
    }
    for (let index = 0; index < imageCount; index++) {
      const get = async (offset: number) => Number(await images.get(BigInt(index * 7 + offset)));
      const width = await get(0), height = await get(1), components = await get(2), jpeg = await get(3), position = await get(4), size = await get(5), alpha = await get(6), number = 6 + outputPages * 2 + index * 2;
      const common = {Type: cosName("XObject"), Subtype: cosName("Image"), Width: cosNumber(width), Height: cosNumber(height), BitsPerComponent: cosNumber(8)};
      yield {...object(number, cosDict({...common, ColorSpace: cosName(components === 1 ? "DeviceGray" : components === 4 ? "DeviceCMYK" : "DeviceRGB"), ...(jpeg ? {Filter: cosName("DCTDecode")} : {}), ...(alpha ? {SMask: cosRef(number + 1)} : {})})), stream: {length: size, chunks: read(position, size)}};
      if (alpha) yield {...object(number + 1, cosDict({...common, ColorSpace: cosName("DeviceGray")})), stream: {length: width * height, chunks: read(alpha, width * height)}};
    }
  }
  const output = new ByteChain(storage, signal);
  for await (const bytes of serializeRetainedCosDocumentChunks({ objects: objects(), version, rootRef: cosRef(1), infoRef: cosRef(3), signal, chunkBytes: 16384 }, { fs: context.fs, directory: resolvePath(context.cwd, context.env.TMPDIR || context.cwd) })) await output.append(bytes);
  return { size: output.size, read: () => readChain(storage, output.first, signal) };
  }
}

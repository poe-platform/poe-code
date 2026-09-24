import {
  cosArray,
  cosDict,
  cosName,
  cosNumber,
  cosRef,
  cosStream,
  cosString,
  dictGet,
  dictSet,
  type PdfCosDict,
  type PdfCosNode,
  type PdfCosRef,
  type PdfDictEntry,
  type PdfExtractedPage,
  type PdfExtractedTable,
  type PdfIndirectObject,
  type PdfSemanticNode,
} from "./ast.js";
import {
  createStandardFontHandle,
  createTrueTypeFontHandle,
  PdfPage,
  type PdfFontHandle,
  type PdfImageHandle,
} from "./canvas.js";
import { applyPredictor, decodeFlate } from "./cos/filters.js";
import { parseCosDocument, type ParseCosOptions, type ParsedCosDocument } from "./cos/parser.js";
import { encryptCosDocument, type EncryptPdfOptions } from "./cos/security.js";
import { appendIncrementalRevision, serializeCosDocument } from "./cos/writer.js";
import { getDocumentFormFields, setDocumentFormField, type PdfFormFieldInfo } from "./edit/forms.js";
import { PdfError } from "./errors.js";
import { buildSemanticAstFromPages } from "./extract/semantic-ast.js";
import { formatExtractedPageText, type ExtractTextOptions } from "./extract/text.js";
import type { Standard14FontName } from "./fonts/standard14.js";
import { parseTrueTypeFont } from "./fonts/truetype.js";
import { renderDisplayListToPng, type RenderToPngOptions } from "./render/raster.js";

export interface SavePdfOptions {
  readonly normalizeContent?: boolean | undefined;
  readonly incremental?: boolean | undefined;
  readonly encrypt?: EncryptPdfOptions | undefined;
}

export interface PdfMetadataInfo {
  readonly title?: string | undefined;
  readonly author?: string | undefined;
  readonly subject?: string | undefined;
  readonly keywords?: string | undefined;
  readonly creator?: string | undefined;
  readonly producer?: string | undefined;
}

function collectLeafPages(
  cosDoc: ParsedCosDocument,
  nodeRefOrDict: PdfCosNode | undefined,
  out: Array<{ ref: PdfCosRef; dict: PdfCosDict }> = [],
  visited = new Set<number>()
): Array<{ ref: PdfCosRef; dict: PdfCosDict }> {
  if (!nodeRefOrDict) return out;
  let currentRef: PdfCosRef | undefined;
  if (nodeRefOrDict.kind === "ref") {
    if (visited.has(nodeRefOrDict.objectNumber)) return out;
    visited.add(nodeRefOrDict.objectNumber);
    currentRef = nodeRefOrDict;
  }
  const dict = cosDoc.resolveDict(nodeRefOrDict);
  if (!dict) return out;
  const typeNode = cosDoc.resolve(dictGet(dict, "Type"));
  const typeName = typeNode?.kind === "name" ? typeNode.decoded : "";
  const kidsArr = cosDoc.resolveArray(dictGet(dict, "Kids"));
  if (typeName === "Pages" || kidsArr) {
    if (kidsArr) {
      for (const kid of kidsArr.items) {
        collectLeafPages(cosDoc, kid, out, visited);
      }
    }
  } else if (typeName === "Page" || dictGet(dict, "MediaBox") || dictGet(dict, "Contents")) {
    const ref = currentRef ?? cosDoc.allocateObject(dict);
    out.push({ ref, dict });
  }
  return out;
}

export class PdfDocument {
  readonly cos: ParsedCosDocument;
  private pages: PdfPage[] = [];

  private constructor(cos: ParsedCosDocument) {
    this.cos = cos;
    this.rebuildPagesList();
  }

  static create(): PdfDocument {
    const catalog = cosDict({ Type: cosName("Catalog"), Pages: cosRef(2) });
    const pages = cosDict({ Type: cosName("Pages"), Count: cosNumber(0), Kids: cosArray([]) });
    const info = cosDict({ Producer: cosString("@poe-code/pdf-ast") });
    const rawBytes = serializeCosDocument({
      objects: [
        { objectNumber: 1, generationNumber: 0, value: catalog },
        { objectNumber: 2, generationNumber: 0, value: pages },
        { objectNumber: 3, generationNumber: 0, value: info },
      ],
      rootRef: cosRef(1),
      infoRef: cosRef(3),
    });
    return new PdfDocument(parseCosDocument(rawBytes));
  }

  static load(bytes: Uint8Array, options?: ParseCosOptions): PdfDocument {
    return new PdfDocument(
      parseCosDocument(bytes, {
        ...options,
        recovery: options?.recovery ?? "repair",
      })
    );
  }

  private rebuildPagesList(): void {
    const catalog = this.cos.resolveDict(this.cos.rootRef);
    const pagesNode = catalog ? dictGet(catalog, "Pages") : undefined;
    const leaves = collectLeafPages(this.cos, pagesNode);
    this.pages = leaves.map((leaf, idx) => new PdfPage(this.cos, leaf.ref, leaf.dict, idx));
  }

  private syncPageTree(): void {
    const catalog = this.cos.resolveDict(this.cos.rootRef);
    if (!catalog) return;
    let pagesRef = dictGet(catalog, "Pages");
    let pagesDict = this.cos.resolveDict(pagesRef);
    if (!pagesDict || pagesRef?.kind !== "ref") {
      pagesDict = cosDict({ Type: cosName("Pages"), Count: cosNumber(0), Kids: cosArray([]) });
      pagesRef = this.cos.allocateObject(pagesDict);
      dictSet(catalog, "Pages", pagesRef);
    }
    this.pages.forEach((p, idx) => {
      p.index = idx;
      dictSet(p.pageDict, "Parent", pagesRef!);
    });
    dictSet(pagesDict, "Kids", cosArray(this.pages.map(p => p.pageRef)));
    dictSet(pagesDict, "Count", cosNumber(this.pages.length));
  }

  get pageCount(): number {
    return this.pages.length;
  }

  getPageCount(): number {
    return this.pages.length;
  }

  get version(): string {
    return this.cos.version;
  }

  getVersion(): string {
    return this.cos.version;
  }

  setVersion(version: string): void {
    this.cos.version = version;
  }

  addPage(size?: readonly [number, number] | { readonly width: number; readonly height: number }): PdfPage {
    const resolved: readonly [number, number] = size
      ? "width" in size
        ? [size.width, size.height]
        : [size[0], size[1]]
      : [612, 792];
    return this.addPageWithSize(resolved);
  }

  getPages(): readonly PdfPage[] {
    return this.pages;
  }

  getPage(index: number): PdfPage {
    const p = this.pages[index];
    if (!p) {
      throw new PdfError("E_CAPABILITY", `Page index out of bounds: ${index}`);
    }
    return p;
  }

  private addPageWithSize(size: readonly [number, number] = [612, 792]): PdfPage {
    return this.insertPage(this.pages.length, size);
  }

  insertPage(index: number, size: readonly [number, number] = [612, 792]): PdfPage {
    const catalog = this.cos.resolveDict(this.cos.rootRef);
    const pagesRef = catalog ? dictGet(catalog, "Pages") : undefined;
    const contentStreamRef = this.cos.allocateObject(cosStream(new Uint8Array(0), { compress: true }));
    const pageDict = cosDict({
      Type: cosName("Page"),
      Parent: pagesRef?.kind === "ref" ? pagesRef : undefined,
      MediaBox: cosArray([cosNumber(0), cosNumber(0), cosNumber(size[0]), cosNumber(size[1])]),
      Resources: cosDict({ Font: cosDict({}) }),
      Contents: contentStreamRef,
    });
    const pageRef = this.cos.allocateObject(pageDict);
    const page = new PdfPage(this.cos, pageRef, pageDict, index);
    this.pages.splice(index, 0, page);
    this.syncPageTree();
    return page;
  }

  removePage(index: number): void {
    if (index < 0 || index >= this.pages.length) {
      throw new PdfError("E_CAPABILITY", `Page index out of bounds: ${index}`);
    }
    this.pages.splice(index, 1);
    this.syncPageTree();
  }

  copyPagesFrom(sourceDoc: PdfDocument, indices: readonly number[]): PdfPage[] {
    const memo = new Map<number, PdfCosRef>();
    const sourcePageObjNums = new Set<number>();
    for (let i = 0; i < sourceDoc.getPageCount(); i++) {
      sourcePageObjNums.add(sourceDoc.getPage(i).ref.objectNumber);
    }

    const targetPageRefs = new Map<number, PdfCosRef>();
    for (const idx of indices) {
      const srcPage = sourceDoc.getPage(idx);
      const pageRef = this.cos.allocateObject({ kind: "null" });
      targetPageRefs.set(idx, pageRef);
      memo.set(srcPage.ref.objectNumber, pageRef);
    }

    const cloneNode = (node: PdfCosNode): PdfCosNode => {
      if (node.kind === "ref") {
        const existing = memo.get(node.objectNumber);
        if (existing) return existing;
        if (sourcePageObjNums.has(node.objectNumber)) {
          return { kind: "null" };
        }
        const target = sourceDoc.cos.getObject(node.objectNumber);
        if (!target) return cosRef(0);
        // Reserve object number first to handle cycles (e.g. Parent pointers)
        const placeholderRef = this.cos.allocateObject({ kind: "null" });
        memo.set(node.objectNumber, placeholderRef);
        const clonedTarget = cloneNode(target);
        this.cos.setObject(placeholderRef.objectNumber, clonedTarget, 0);
        return placeholderRef;
      }
      if (node.kind === "array") {
        return cosArray(node.items.map(cloneNode));
      }
      if (node.kind === "dict") {
        const typeEntry = dictGet(node, "Type");
        const isPageTreeNode =
          typeEntry?.kind === "name" &&
          (typeEntry.decoded === "Page" || typeEntry.decoded === "Pages");
        const newEntries: PdfDictEntry[] = [];
        for (const entry of node.entries) {
          if (isPageTreeNode && entry.key.decoded === "Parent") continue;
          newEntries.push({
            key: { ...entry.key },
            value: cloneNode(entry.value),
          });
        }
        return { kind: "dict", entries: newEntries };
      }
      if (node.kind === "stream") {
        const clonedDict = cloneNode(node.dict) as PdfCosDict;
        return {
          kind: "stream",
          dict: clonedDict,
          rawBytes: new Uint8Array(node.rawBytes),
          decodedBytes: node.decodedBytes ? new Uint8Array(node.decodedBytes) : undefined,
        };
      }
      return node;
    };

    const copiedPages: PdfPage[] = [];
    for (const idx of indices) {
      const srcPage = sourceDoc.getPage(idx);
      const clonedPageDict = cloneNode(srcPage.pageDict) as PdfCosDict;
      const size = srcPage.getSize();
      if (!dictGet(clonedPageDict, "MediaBox")) {
        dictSet(
          clonedPageDict,
          "MediaBox",
          cosArray([cosNumber(0), cosNumber(0), cosNumber(size.width), cosNumber(size.height)])
        );
      }
      if (!dictGet(clonedPageDict, "Resources")) {
        dictSet(clonedPageDict, "Resources", cloneNode(srcPage.getResourcesDict()));
      }
      if (!dictGet(clonedPageDict, "Rotate") && srcPage.getRotation() !== 0) {
        dictSet(clonedPageDict, "Rotate", cosNumber(srcPage.getRotation()));
      }
      const inheritedBoxKeys = ["CropBox", "BleedBox", "TrimBox", "ArtBox"] as const;
      for (const boxKey of inheritedBoxKeys) {
        if (!dictGet(clonedPageDict, boxKey)) {
          const boxVal =
            boxKey === "CropBox"
              ? srcPage.getCropBox()
              : boxKey === "BleedBox"
                ? srcPage.getBleedBox()
                : boxKey === "TrimBox"
                  ? srcPage.getTrimBox()
                  : srcPage.getArtBox();
          if (
            boxVal[0] !== 0 ||
            boxVal[1] !== 0 ||
            boxVal[2] !== size.width ||
            boxVal[3] !== size.height
          ) {
            dictSet(
              clonedPageDict,
              boxKey,
              cosArray([
                cosNumber(boxVal[0]),
                cosNumber(boxVal[1]),
                cosNumber(boxVal[2]),
                cosNumber(boxVal[3]),
              ])
            );
          }
        }
      }
      const pageRef = targetPageRefs.get(idx)!;
      this.cos.setObject(pageRef.objectNumber, clonedPageDict, 0);
      const newPage = new PdfPage(this.cos, pageRef, clonedPageDict, this.pages.length);
      this.pages.push(newPage);
      copiedPages.push(newPage);
    }
    this.syncPageTree();
    return copiedPages;
  }

  embedStandardFont(fontName: Standard14FontName): PdfFontHandle {
    return createStandardFontHandle(fontName);
  }

  embedFont(ttfBytes: Uint8Array): PdfFontHandle {
    return createTrueTypeFontHandle(parseTrueTypeFont(ttfBytes));
  }

  embedRgbImage(width: number, height: number, rgbBytes: Uint8Array): PdfImageHandle {
    const streamObj = cosStream(rgbBytes, {
      dict: cosDict({
        Type: cosName("XObject"),
        Subtype: cosName("Image"),
        Width: cosNumber(width),
        Height: cosNumber(height),
        ColorSpace: cosName("DeviceRGB"),
        BitsPerComponent: cosNumber(8),
      }),
      compress: true,
    });
    const xobjectRef = this.cos.allocateObject(streamObj);
    return { xobjectRef, width, height };
  }

  embedPng(pngBytes: Uint8Array): PdfImageHandle {
    if (pngBytes.length < 24 || pngBytes[0] !== 137 || pngBytes[1] !== 80) {
      throw new PdfError("E_PARSE", "Invalid PNG signature");
    }
    const view = new DataView(pngBytes.buffer, pngBytes.byteOffset, pngBytes.byteLength);
    let pos = 8;
    let width = 0;
    let height = 0;
    let bitDepth = 8;
    let colorType = 6;
    const idatParts: Uint8Array[] = [];

    while (pos + 8 <= pngBytes.length) {
      const len = view.getUint32(pos, false);
      const type = String.fromCharCode(
        pngBytes[pos + 4]!,
        pngBytes[pos + 5]!,
        pngBytes[pos + 6]!,
        pngBytes[pos + 7]!
      );
      const chunkData = pngBytes.subarray(pos + 8, pos + 8 + len);
      if (type === "IHDR") {
        width = view.getUint32(pos + 8, false);
        height = view.getUint32(pos + 12, false);
        bitDepth = chunkData[8]!;
        colorType = chunkData[9]!;
      } else if (type === "IDAT") {
        idatParts.push(chunkData);
      } else if (type === "IEND") {
        break;
      }
      pos += 12 + len;
    }

    const totalIdat = idatParts.reduce((s, c) => s + c.length, 0);
    const mergedIdat = new Uint8Array(totalIdat);
    let off = 0;
    for (const part of idatParts) {
      mergedIdat.set(part, off);
      off += part.length;
    }
    const inflated = decodeFlate(mergedIdat);
    const colors = colorType === 6 ? 4 : colorType === 2 ? 3 : colorType === 4 ? 2 : 1;
    const unpredicted = applyPredictor(inflated, {
      Predictor: 15,
      Columns: width,
      Colors: colors,
      BitsPerComponent: bitDepth,
    });

    const rgbBytes = new Uint8Array(width * height * 3);
    if (colors === 4) {
      for (let i = 0; i < width * height; i++) {
        const a = unpredicted[i * 4 + 3]! / 255;
        rgbBytes[i * 3] = Math.round(unpredicted[i * 4]! * a + 255 * (1 - a));
        rgbBytes[i * 3 + 1] = Math.round(unpredicted[i * 4 + 1]! * a + 255 * (1 - a));
        rgbBytes[i * 3 + 2] = Math.round(unpredicted[i * 4 + 2]! * a + 255 * (1 - a));
      }
    } else if (colors === 3) {
      rgbBytes.set(unpredicted.subarray(0, width * height * 3));
    } else {
      for (let i = 0; i < width * height; i++) {
        const g = unpredicted[i * colors]!;
        rgbBytes[i * 3] = g;
        rgbBytes[i * 3 + 1] = g;
        rgbBytes[i * 3 + 2] = g;
      }
    }
    return this.embedRgbImage(width, height, rgbBytes);
  }

  private ensureInfoDict(): PdfCosDict {
    if (this.cos.infoRef) {
      const existing = this.cos.resolveDict(this.cos.infoRef);
      if (existing) return existing;
    }
    const infoDict = cosDict({});
    this.cos.infoRef = this.cos.allocateObject(infoDict);
    return infoDict;
  }

  getMetadata(): PdfMetadataInfo {
    return {
      title: this.cos.getInfoString("Title"),
      author: this.cos.getInfoString("Author"),
      subject: this.cos.getInfoString("Subject"),
      keywords: this.cos.getInfoString("Keywords"),
      creator: this.cos.getInfoString("Creator"),
      producer: this.cos.getInfoString("Producer"),
    };
  }

  setTitle(title: string): void {
    dictSet(this.ensureInfoDict(), "Title", cosString(title));
  }

  setAuthor(author: string): void {
    dictSet(this.ensureInfoDict(), "Author", cosString(author));
  }

  setSubject(subject: string): void {
    dictSet(this.ensureInfoDict(), "Subject", cosString(subject));
  }

  setKeywords(keywords: readonly string[] | string): void {
    const val = Array.isArray(keywords) ? keywords.join(", ") : keywords;
    dictSet(this.ensureInfoDict(), "Keywords", cosString(val as string));
  }

  setCreator(creator: string): void {
    dictSet(this.ensureInfoDict(), "Creator", cosString(creator));
  }

  setProducer(producer: string): void {
    dictSet(this.ensureInfoDict(), "Producer", cosString(producer));
  }

  setMetadata(info: PdfMetadataInfo & { readonly keywords?: readonly string[] | string | undefined }): void {
    if (info.title !== undefined) this.setTitle(info.title);
    if (info.author !== undefined) this.setAuthor(info.author);
    if (info.subject !== undefined) this.setSubject(info.subject);
    if (info.keywords !== undefined) this.setKeywords(info.keywords);
    if (info.creator !== undefined) this.setCreator(info.creator);
    if (info.producer !== undefined) this.setProducer(info.producer);
  }

  extractPage(index: number, modeOrOptions?: ExtractTextOptions["mode"] | ExtractTextOptions): PdfExtractedPage {
    const opts: ExtractTextOptions | undefined =
      typeof modeOrOptions === "string" ? { mode: modeOrOptions } : modeOrOptions;
    return this.getPage(index).extractPage(opts);
  }

  renderPageToPng(index: number, options?: RenderToPngOptions): Uint8Array {
    return renderDisplayListToPng(this.getPage(index).evaluateDisplayList(), options);
  }

  getFormFields(): PdfFormFieldInfo[] {
    return getDocumentFormFields(this.cos);
  }

  setFormField(fieldName: string, value: string | boolean): void {
    setDocumentFormField(this.cos, fieldName, value);
  }

  extractPages(options?: ExtractTextOptions): PdfExtractedPage[] {
    return this.pages.map(p => p.extractPage(options));
  }

  extractText(modeOrOptions?: ExtractTextOptions["mode"] | ExtractTextOptions): string {
    const options: ExtractTextOptions | undefined = typeof modeOrOptions === "string" ? { mode: modeOrOptions } : modeOrOptions;
    return this.pages.map(p => formatExtractedPageText(p.extractPage(options), options)).join("\n\n");
  }

  extractTables(): PdfExtractedTable[] {
    return this.pages.flatMap(p => p.extractTables());
  }

  toSemanticAst(): PdfSemanticNode[] {
    const extractedPages = this.extractPages({ mode: "logical" });
    const tablesByPage = new Map<number, readonly PdfExtractedTable[]>();
    const displayLists = this.pages.map(p => {
      const dl = p.evaluateDisplayList();
      tablesByPage.set(p.index, p.extractTables());
      return dl;
    });
    return buildSemanticAstFromPages(extractedPages, tablesByPage, displayLists);
  }

  save(options: SavePdfOptions = {}): Uint8Array {
    this.syncPageTree();
    if (options.encrypt) {
      return encryptCosDocument(this.cos, options.encrypt);
    }
    const allObjects: PdfIndirectObject[] = [...this.cos.objects.values()].sort(
      (a, b) => a.objectNumber - b.objectNumber
    );
    if (options.incremental && this.cos.bytes.length > 0) {
      return appendIncrementalRevision(this.cos.bytes, this.cos, allObjects);
    }
    return serializeCosDocument({
      objects: allObjects,
      rootRef: this.cos.rootRef,
      infoRef: this.cos.infoRef,
      idArray: this.cos.idArray,
      version: this.cos.version,
      normalizeContent: options.normalizeContent,
    });
  }
}

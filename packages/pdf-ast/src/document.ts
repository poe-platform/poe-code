import {
  cosArray,
  cosDict,
  cosName,
  cosNumber,
  cosRef,
  cosStream,
  cosString,
  decodePdfString,
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
import { decodePng } from "./render/raster.js";
import { parseTrueTypeFont } from "./fonts/truetype.js";
import { renderDisplayListToBitmap, renderDisplayListToPng, type RenderToPngOptions, type RgbaBitmap } from "./render/raster.js";

export interface SavePdfOptions {
  readonly linearize?: boolean | undefined;
  readonly normalizeContent?: boolean | undefined;
  readonly objectStreams?: "preserve" | "disable" | "generate" | undefined;
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

    const srcCatalog = sourceDoc.cos.resolveDict(sourceDoc.cos.rootRef);
    const srcAcroForm = srcCatalog ? sourceDoc.cos.resolveDict(dictGet(srcCatalog, "AcroForm")) : undefined;
    const srcFieldsArr = srcAcroForm ? sourceDoc.cos.resolveArray(dictGet(srcAcroForm, "Fields")) : undefined;
    if (srcFieldsArr && srcFieldsArr.items.length > 0) {
      const hasClonedDescendant = (node: PdfCosNode | undefined, visited = new Set<number>()): boolean => {
        if (!node) return false;
        if (node.kind === "ref") {
          if (memo.has(node.objectNumber)) return true;
          if (visited.has(node.objectNumber)) return false;
          visited.add(node.objectNumber);
        }
        const d = sourceDoc.cos.resolveDict(node);
        if (!d) return false;
        const kids = sourceDoc.cos.resolveArray(dictGet(d, "Kids"));
        if (!kids) return false;
        return kids.items.some(k => hasClonedDescendant(k, visited));
      };

      const clonedRootFieldRefs: PdfCosRef[] = [];
      for (const item of srcFieldsArr.items) {
        if (!hasClonedDescendant(item)) continue;
        const cloned = cloneNode(item);
        if (cloned.kind === "ref") {
          const clonedDict = this.cos.resolveDict(cloned);
          const kidsArr = clonedDict ? this.cos.resolveArray(dictGet(clonedDict, "Kids")) : undefined;
          if (clonedDict && kidsArr && item.kind === "ref") {
            const srcDict = sourceDoc.cos.resolveDict(item);
            const srcKids = srcDict ? sourceDoc.cos.resolveArray(dictGet(srcDict, "Kids")) : undefined;
            if (srcKids && srcKids.items.length === kidsArr.items.length) {
              const filteredKids = kidsArr.items.filter((_, kIdx) => hasClonedDescendant(srcKids.items[kIdx]));
              if (filteredKids.length > 0) {
                dictSet(clonedDict, "Kids", cosArray(filteredKids));
              }
            }
          }
          clonedRootFieldRefs.push(cloned);
        }
      }

      if (clonedRootFieldRefs.length > 0) {
        const dstCatalog = this.cos.resolveDict(this.cos.rootRef);
        if (dstCatalog) {
          let dstAcroForm = this.cos.resolveDict(dictGet(dstCatalog, "AcroForm"));
          if (!dstAcroForm) {
            dstAcroForm = cosDict({ Fields: cosArray([]) });
            dictSet(dstCatalog, "AcroForm", this.cos.allocateObject(dstAcroForm));
          }
          let dstFields = this.cos.resolveArray(dictGet(dstAcroForm, "Fields"));
          if (!dstFields) {
            dstFields = cosArray([]);
            dictSet(dstAcroForm, "Fields", dstFields);
          }
          const existingNums = new Set(
            dstFields.items.filter((x): x is PdfCosRef => x.kind === "ref").map(x => x.objectNumber)
          );
          for (const fRef of clonedRootFieldRefs) {
            if (!existingNums.has(fRef.objectNumber)) {
              dstFields.items.push(fRef);
              existingNums.add(fRef.objectNumber);
            }
          }
          const srcDr = dictGet(srcAcroForm!, "DR");
          if (srcDr && !dictGet(dstAcroForm, "DR")) {
            dictSet(dstAcroForm, "DR", cloneNode(srcDr));
          }
          const srcDa = dictGet(srcAcroForm!, "DA");
          if (srcDa && !dictGet(dstAcroForm, "DA")) {
            dictSet(dstAcroForm, "DA", cloneNode(srcDa));
          }
        }
      }
    }

    const srcOcProps = srcCatalog ? dictGet(srcCatalog, "OCProperties") : undefined;
    if (srcOcProps) {
      const dstCatalog = this.cos.resolveDict(this.cos.rootRef);
      if (dstCatalog && !dictGet(dstCatalog, "OCProperties")) {
        dictSet(dstCatalog, "OCProperties", cloneNode(srcOcProps));
      }
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
    let decoded: { width: number; height: number; data: Uint8Array };
    try {
      decoded = decodePng(pngBytes);
    } catch (err) {
      throw new PdfError("E_PARSE", (err as Error).message);
    }
    const { width, height, data } = decoded;
    const rgbBytes = new Uint8Array(width * height * 3);
    const aBuf = new Uint8Array(width * height);
    let hasTransparency = false;
    for (let i = 0; i < width * height; i++) {
      rgbBytes[i * 3] = data[i * 4]!;
      rgbBytes[i * 3 + 1] = data[i * 4 + 1]!;
      rgbBytes[i * 3 + 2] = data[i * 4 + 2]!;
      const a = data[i * 4 + 3]!;
      aBuf[i] = a;
      if (a < 255) hasTransparency = true;
    }
    const alphaBytes = hasTransparency ? aBuf : undefined;
    if (alphaBytes) {
      const smaskStream = cosStream(alphaBytes, {
        dict: cosDict({
          Type: cosName("XObject"),
          Subtype: cosName("Image"),
          Width: cosNumber(width),
          Height: cosNumber(height),
          ColorSpace: cosName("DeviceGray"),
          BitsPerComponent: cosNumber(8),
        }),
        compress: true,
      });
      const smaskRef = this.cos.allocateObject(smaskStream);
      const streamObj = cosStream(rgbBytes, {
        dict: cosDict({
          Type: cosName("XObject"),
          Subtype: cosName("Image"),
          Width: cosNumber(width),
          Height: cosNumber(height),
          ColorSpace: cosName("DeviceRGB"),
          BitsPerComponent: cosNumber(8),
          SMask: smaskRef,
        }),
        compress: true,
      });
      const xobjectRef = this.cos.allocateObject(streamObj);
      return { xobjectRef, width, height };
    }
    return this.embedRgbImage(width, height, rgbBytes);
  }

  embedJpg(jpegBytes: Uint8Array): PdfImageHandle {
    if (jpegBytes.length < 4 || jpegBytes[0] !== 0xff || jpegBytes[1] !== 0xd8) {
      throw new PdfError("E_PARSE", "Invalid JPEG signature");
    }
    let width = 1;
    let height = 1;
    let components = 3;
    let pos = 2;
    while (pos + 1 < jpegBytes.length) {
      if (jpegBytes[pos] !== 0xff) {
        pos++;
        continue;
      }
      while (pos < jpegBytes.length && jpegBytes[pos] === 0xff) pos++;
      if (pos >= jpegBytes.length) break;
      const marker = jpegBytes[pos++]!;
      if (marker === 0xd9 || marker === 0xda) break;
      if (marker === 0xd8 || (marker >= 0xd0 && marker <= 0xd7) || marker === 0x01) continue;
      if (pos + 1 >= jpegBytes.length) break;
      const segLen = ((jpegBytes[pos]! << 8) | jpegBytes[pos + 1]!) - 2;
      pos += 2;
      if (segLen < 0 || pos + segLen > jpegBytes.length) break;
      if ((marker === 0xc0 || marker === 0xc1 || marker === 0xc2) && segLen >= 6) {
        height = Math.max(1, (jpegBytes[pos + 1]! << 8) | jpegBytes[pos + 2]!);
        width = Math.max(1, (jpegBytes[pos + 3]! << 8) | jpegBytes[pos + 4]!);
        components = jpegBytes[pos + 5]!;
        break;
      }
      pos += segLen;
    }
    const csName = components === 1 ? "DeviceGray" : components === 4 ? "DeviceCMYK" : "DeviceRGB";
    const streamObj = cosStream(jpegBytes, {
      dict: cosDict({
        Type: cosName("XObject"),
        Subtype: cosName("Image"),
        Width: cosNumber(width),
        Height: cosNumber(height),
        ColorSpace: cosName(csName),
        BitsPerComponent: cosNumber(8),
        Filter: cosName("DCTDecode"),
      }),
      compress: false,
    });
    const xobjectRef = this.cos.allocateObject(streamObj);
    return { xobjectRef, width, height };
  }

  embedJpeg(jpegBytes: Uint8Array): PdfImageHandle {
    return this.embedJpg(jpegBytes);
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
      objectStreams: options.objectStreams,
      linearize: options.linearize,
    });
  }
}

export function resolveDestinationPageIndex(
  doc: PdfDocument,
  destOrActionNode: PdfCosNode | undefined
): number | undefined {
  const cos = doc.cos;
  let node = cos.resolve(destOrActionNode);
  if (!node) return undefined;

  if (node.kind === "dict") {
    const actionD = dictGet(node, "D");
    const directDest = dictGet(node, "Dest");
    if (actionD) node = cos.resolve(actionD);
    else if (directDest) node = cos.resolve(directDest);
  }

  if (node?.kind === "string" || node?.kind === "name") {
    const destName = node.kind === "string" ? decodePdfString(node) : node.decoded;
    const catalog = cos.resolveDict(cos.rootRef);
    let foundTarget: PdfCosNode | undefined;
    if (catalog) {
      const catDests = cos.resolveDict(dictGet(catalog, "Dests"));
      if (catDests) {
        foundTarget = dictGet(catDests, destName);
      }
      if (!foundTarget) {
        const namesDict = cos.resolveDict(dictGet(catalog, "Names"));
        const destsTree = namesDict ? dictGet(namesDict, "Dests") : undefined;
        const lookupInNameTree = (
          treeNode: PdfCosNode | undefined,
          visited = new Set<number>()
        ): PdfCosNode | undefined => {
          if (!treeNode) return undefined;
          if (treeNode.kind === "ref") {
            if (visited.has(treeNode.objectNumber)) return undefined;
            visited.add(treeNode.objectNumber);
          }
          const d = cos.resolveDict(treeNode);
          if (!d) return undefined;
          const namesArr = cos.resolveArray(dictGet(d, "Names"));
          if (namesArr) {
            for (let i = 0; i + 1 < namesArr.items.length; i += 2) {
              const kNode = cos.resolve(namesArr.items[i]);
              const kStr =
                kNode?.kind === "string"
                  ? decodePdfString(kNode)
                  : kNode?.kind === "name"
                    ? kNode.decoded
                    : "";
              if (kStr === destName) {
                return namesArr.items[i + 1];
              }
            }
          }
          const kidsArr = cos.resolveArray(dictGet(d, "Kids"));
          if (kidsArr) {
            for (const kid of kidsArr.items) {
              const hit = lookupInNameTree(kid, visited);
              if (hit) return hit;
            }
          }
          return undefined;
        };
        foundTarget = lookupInNameTree(destsTree);
      }
    }
    node = cos.resolve(foundTarget);
    if (node?.kind === "dict") {
      const innerD = dictGet(node, "D");
      if (innerD) node = cos.resolve(innerD);
    }
  }

  if (node?.kind === "array" && node.items.length > 0) {
    const first = node.items[0]!;
    if (first.kind === "ref") {
      const pages = doc.getPages();
      for (let p = 0; p < pages.length; p++) {
        if (pages[p]!.ref.objectNumber === first.objectNumber) {
          return p;
        }
      }
    } else {
      const rFirst = cos.resolve(first);
      if (rFirst?.kind === "number" && rFirst.value >= 0 && rFirst.value < doc.getPageCount()) {
        return Math.round(rFirst.value);
      }
    }
  }

  return undefined;
}

import {
  cosArray,
  cosDict,
  cosHexString,
  cosName,
  cosNumber,
  cosStream,
  cosString,
  decodePdfString,
  dictGet,
  dictSet,
  type PdfContentNode,
  type PdfCosDict,
  type PdfCosNode,
  type PdfCosRef,
  type PdfDisplayList,
  type PdfExtractedPage,
  type PdfExtractedTable,
  type PdfPathSegment,
  type PdfRgbColor,
} from "./ast.js";
import {
  evaluateContentStreamToDisplayList,
  extractPageAnnotations,
  isOptionalContentVisible,
} from "./content/evaluator.js";
import { parseContentStream } from "./content/parser.js";
import { serializeContentAst } from "./content/serializer.js";
import type { ParsedCosDocument } from "./cos/parser.js";
import { redactPageContentAst, type RedactOptions } from "./edit/redact.js";
import { extractTablesFromDisplayList } from "./extract/tables.js";
import { extractPageFromDisplayList, formatExtractedPageText, type ExtractTextOptions } from "./extract/text.js";
import {
  encodeWinAnsiBytes,
  measureStandard14TextWidth,
  type Standard14FontName,
} from "./fonts/standard14.js";
import { embedTrueTypeFontInCos, type ParsedTrueTypeFont } from "./fonts/truetype.js";
import { renderDisplayListToPng, type RenderToPngOptions } from "./render/raster.js";

export function rgb(r: number, g: number, b: number): PdfRgbColor {
  return { r, g, b };
}

export interface PdfFontHandle {
  readonly kind: "standard14" | "truetype";
  readonly name: string;
  readonly standardName?: Standard14FontName | undefined;
  readonly truetype?: ParsedTrueTypeFont | undefined;
  widthOfTextAtSize(text: string, size: number): number;
}

export interface PdfImageHandle {
  readonly xobjectRef: PdfCosRef;
  readonly width: number;
  readonly height: number;
}

export interface DrawTextOptions {
  readonly x: number;
  readonly y: number;
  readonly size?: number | undefined;
  readonly fontSize?: number | undefined;
  readonly font?: PdfFontHandle | Standard14FontName | undefined;
  readonly fontName?: Standard14FontName | undefined;
  readonly color?: PdfRgbColor | undefined;
  readonly rotateRadians?: number | undefined;
}

export interface DrawRectOptions {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly fill?: PdfRgbColor | undefined;
  readonly stroke?: PdfRgbColor | undefined;
  readonly strokeWidth?: number | undefined;
}

export interface DrawLineOptions {
  readonly x1: number;
  readonly y1: number;
  readonly x2: number;
  readonly y2: number;
  readonly stroke?: PdfRgbColor | undefined;
  readonly strokeWidth?: number | undefined;
}

export interface DrawPathOptions {
  readonly fill?: PdfRgbColor | undefined;
  readonly stroke?: PdfRgbColor | undefined;
  readonly strokeWidth?: number | undefined;
  readonly fillRule?: "nonzero" | "evenodd" | undefined;
}

export interface DrawImageOptions {
  readonly x: number;
  readonly y: number;
  readonly width?: number | undefined;
  readonly height?: number | undefined;
}

export class PdfPage {
  readonly cosDoc: ParsedCosDocument;
  readonly pageRef: PdfCosRef;
  readonly pageDict: PdfCosDict;
  index: number;
  private cachedContentAst: PdfContentNode[] | undefined;
  private cachedContentsNode: PdfCosNode | undefined;
  private fontResourceCounter = 1;
  private xobjectResourceCounter = 1;
  private isolatedInitialStream: boolean;

  constructor(cosDoc: ParsedCosDocument, pageRef: PdfCosRef, pageDict: PdfCosDict, index: number) {
    this.cosDoc = cosDoc;
    this.pageRef = pageRef;
    this.pageDict = pageDict;
    this.index = index;
    this.isolatedInitialStream = !dictGet(this.pageDict, "Contents");
  }

  get dict(): PdfCosDict {
    return this.pageDict;
  }

  get ref(): PdfCosRef {
    return this.pageRef;
  }

  getDisplayList(): PdfDisplayList {
    return this.evaluateDisplayList();
  }

  get width(): number {
    return this.getSize().width;
  }

  get height(): number {
    return this.getSize().height;
  }

  getSize(): { width: number; height: number } {
    const mb = this.resolveInheritedArray("MediaBox");
    if (mb && mb.items.length >= 4) {
      const x0 = this.cosDoc.resolve(mb.items[0]);
      const y0 = this.cosDoc.resolve(mb.items[1]);
      const x1 = this.cosDoc.resolve(mb.items[2]);
      const y1 = this.cosDoc.resolve(mb.items[3]);
      if (
        x0?.kind === "number" &&
        y0?.kind === "number" &&
        x1?.kind === "number" &&
        y1?.kind === "number"
      ) {
        return { width: Math.abs(x1.value - x0.value), height: Math.abs(y1.value - y0.value) };
      }
    }
    return { width: 612, height: 792 };
  }

  setSize(width: number, height: number): void {
    dictSet(
      this.pageDict,
      "MediaBox",
      cosArray([cosNumber(0), cosNumber(0), cosNumber(width), cosNumber(height)])
    );
  }

  private resolveBox(key: string): [number, number, number, number] {
    const arr = this.resolveInheritedArray(key) ?? this.resolveInheritedArray("MediaBox");
    if (arr && arr.items.length >= 4) {
      const n0 = this.cosDoc.resolve(arr.items[0]);
      const n1 = this.cosDoc.resolve(arr.items[1]);
      const n2 = this.cosDoc.resolve(arr.items[2]);
      const n3 = this.cosDoc.resolve(arr.items[3]);
      if (
        n0?.kind === "number" &&
        n1?.kind === "number" &&
        n2?.kind === "number" &&
        n3?.kind === "number"
      ) {
        return [n0.value, n1.value, n2.value, n3.value];
      }
    }
    return [0, 0, 612, 792];
  }

  getMediaBox(): [number, number, number, number] {
    return this.resolveBox("MediaBox");
  }

  getCropBox(): [number, number, number, number] {
    return this.resolveBox("CropBox");
  }

  setCropBox(x0: number, y0: number, x1: number, y1: number): void {
    dictSet(
      this.pageDict,
      "CropBox",
      cosArray([cosNumber(x0), cosNumber(y0), cosNumber(x1), cosNumber(y1)])
    );
  }

  getBleedBox(): [number, number, number, number] {
    return this.resolveBox("BleedBox");
  }

  getTrimBox(): [number, number, number, number] {
    return this.resolveBox("TrimBox");
  }

  getArtBox(): [number, number, number, number] {
    return this.resolveBox("ArtBox");
  }

  getRotation(): 0 | 90 | 180 | 270 {
    const rotNode = this.resolveInheritedNode("Rotate");
    if (rotNode?.kind === "number") {
      const norm = ((rotNode.value % 360) + 360) % 360;
      if (norm === 90 || norm === 180 || norm === 270) return norm;
    }
    return 0;
  }

  setRotation(degrees: 0 | 90 | 180 | 270): void {
    dictSet(this.pageDict, "Rotate", cosNumber(degrees));
  }

  scaleContent(xFactor: number, yFactor: number): void {
    const ast = [...this.getContentAst()];
    this.isolatedInitialStream = true;
    this.setContentAst([
      {
        kind: "graphics-group",
        ops: [
          {
            kind: "state-op",
            operator: "cm",
            operands: [
              cosNumber(xFactor),
              cosNumber(0),
              cosNumber(0),
              cosNumber(yFactor),
              cosNumber(0),
              cosNumber(0),
            ],
          },
          ...ast,
        ],
      },
    ]);
  }

  scaleAnnotations(xFactor: number, yFactor: number): void {
    const annotsArr = this.cosDoc.resolveArray(dictGet(this.pageDict, "Annots"));
    if (!annotsArr) return;
    for (const item of annotsArr.items) {
      const annotDict = this.cosDoc.resolveDict(item);
      if (!annotDict) continue;
      const rectArr = this.cosDoc.resolveArray(dictGet(annotDict, "Rect"));
      if (rectArr && rectArr.items.length >= 4) {
        const n0 = this.cosDoc.resolve(rectArr.items[0]);
        const n1 = this.cosDoc.resolve(rectArr.items[1]);
        const n2 = this.cosDoc.resolve(rectArr.items[2]);
        const n3 = this.cosDoc.resolve(rectArr.items[3]);
        if (
          n0?.kind === "number" &&
          n1?.kind === "number" &&
          n2?.kind === "number" &&
          n3?.kind === "number"
        ) {
          dictSet(
            annotDict,
            "Rect",
            cosArray([
              cosNumber(n0.value * xFactor),
              cosNumber(n1.value * yFactor),
              cosNumber(n2.value * xFactor),
              cosNumber(n3.value * yFactor),
            ])
          );
        }
      }
    }
  }

  scale(xFactor: number, yFactor: number): void {
    const { width, height } = this.getSize();
    this.setSize(width * xFactor, height * yFactor);
    this.scaleContent(xFactor, yFactor);
    this.scaleAnnotations(xFactor, yFactor);
  }

  private resolveInheritedNode(key: string) {
    let cur: PdfCosDict | undefined = this.pageDict;
    const visited = new Set< PdfCosDict>();
    while (cur && !visited.has(cur)) {
      visited.add(cur);
      const val = dictGet(cur, key);
      if (val) return this.cosDoc.resolve(val);
      cur = this.cosDoc.resolveDict(dictGet(cur, "Parent"));
    }
    return undefined;
  }

  private resolveInheritedArray(key: string) {
    const node = this.resolveInheritedNode(key);
    return node?.kind === "array" ? node : undefined;
  }

  getResourcesDict(): PdfCosDict {
    let res = this.cosDoc.resolveDict(dictGet(this.pageDict, "Resources"));
    if (!res) {
      const inherited = this.resolveInheritedNode("Resources");
      if (inherited?.kind === "dict") {
        const clonedEntries = inherited.entries.map(entry => {
          const subDict = this.cosDoc.resolveDict(entry.value);
          if (subDict) {
            return {
              key: { ...entry.key },
              value: cosDict(
                Object.fromEntries(subDict.entries.map(se => [se.key.decoded, se.value]))
              ),
            };
          }
          return { key: { ...entry.key }, value: entry.value };
        });
        res = { kind: "dict", entries: clonedEntries };
      } else {
        res = cosDict({});
      }
      dictSet(this.pageDict, "Resources", res);
    }
    return res;
  }

  ensureStandardFontResource(fontName: Standard14FontName): string {
    const res = this.getResourcesDict();
    let fontDict = this.cosDoc.resolveDict(dictGet(res, "Font"));
    if (!fontDict) {
      fontDict = cosDict({});
      dictSet(res, "Font", fontDict);
    }
    for (const entry of fontDict.entries) {
      const fObj = this.cosDoc.resolveDict(entry.value);
      const bf = fObj ? this.cosDoc.resolve(dictGet(fObj, "BaseFont")) : undefined;
      if (bf?.kind === "name" && bf.decoded === fontName) {
        return entry.key.decoded;
      }
    }
    let key = `F${this.fontResourceCounter++}`;
    while (dictGet(fontDict, key)) {
      key = `F${this.fontResourceCounter++}`;
    }
    const fRef = this.cosDoc.allocateObject(
      cosDict({
        Type: cosName("Font"),
        Subtype: cosName("Type1"),
        BaseFont: cosName(fontName),
        Encoding: cosName("WinAnsiEncoding"),
      })
    );
    dictSet(fontDict, key, fRef);
    return key;
  }

  ensureTrueTypeFontResource(font: ParsedTrueTypeFont, usedGlyphs: ReadonlyMap<number, string>): string {
    const res = this.getResourcesDict();
    let fontDict = this.cosDoc.resolveDict(dictGet(res, "Font"));
    if (!fontDict) {
      fontDict = cosDict({});
      dictSet(res, "Font", fontDict);
    }
    let key = `FT${this.fontResourceCounter++}`;
    while (dictGet(fontDict, key)) {
      key = `FT${this.fontResourceCounter++}`;
    }
    const fRef = embedTrueTypeFontInCos(this.cosDoc, font, usedGlyphs);
    dictSet(fontDict, key, fRef);
    return key;
  }

  ensureXObjectResource(xobjectRef: PdfCosRef): string {
    const res = this.getResourcesDict();
    let xobjDict = this.cosDoc.resolveDict(dictGet(res, "XObject"));
    if (!xobjDict) {
      xobjDict = cosDict({});
      dictSet(res, "XObject", xobjDict);
    }
    let key = `Im${this.xobjectResourceCounter++}`;
    while (dictGet(xobjDict, key)) {
      key = `Im${this.xobjectResourceCounter++}`;
    }
    dictSet(xobjDict, key, xobjectRef);
    return key;
  }

  getContentAst(): PdfContentNode[] {
    const currentContents = dictGet(this.pageDict, "Contents");
    if (this.cachedContentAst && this.cachedContentsNode === currentContents) {
      return this.cachedContentAst;
    }
    const merged = this.getRawContentStream();
    this.cachedContentAst = parseContentStream(merged);
    this.cachedContentsNode = currentContents;
    return this.cachedContentAst;
  }

  getRawContentStream(): Uint8Array {
    const contentsNode = this.cosDoc.resolve(dictGet(this.pageDict, "Contents"));
    const chunks: Uint8Array[] = [];
    if (contentsNode?.kind === "stream") {
      chunks.push(this.cosDoc.decodeStream(contentsNode));
    } else if (contentsNode?.kind === "array") {
      for (const item of contentsNode.items) {
        const stm = this.cosDoc.resolve(item);
        if (stm?.kind === "stream") {
          chunks.push(this.cosDoc.decodeStream(stm));
          chunks.push(new TextEncoder().encode("\n"));
        }
      }
    }
    const totalLen = chunks.reduce((s, c) => s + c.length, 0);
    const merged = new Uint8Array(totalLen);
    let offset = 0;
    for (const c of chunks) {
      merged.set(c, offset);
      offset += c.length;
    }
    return merged;
  }

  setRawContentStream(bytesOrText: Uint8Array | string, compress = true): void {
    const bytes = typeof bytesOrText === "string" ? new TextEncoder().encode(bytesOrText) : bytesOrText;
    this.cachedContentAst = parseContentStream(bytes);
    this.isolatedInitialStream = false;
    const stm = cosStream(bytes, { compress });
    const contentsRef = dictGet(this.pageDict, "Contents");
    if (contentsRef?.kind === "ref") {
      this.cosDoc.setObject(contentsRef.objectNumber, stm);
    } else {
      const newRef = this.cosDoc.allocateObject(stm);
      dictSet(this.pageDict, "Contents", newRef);
    }
    this.cachedContentsNode = dictGet(this.pageDict, "Contents");
  }

  private getIsolatedContentAst(): PdfContentNode[] {
    const ast = this.getContentAst();
    if (!this.isolatedInitialStream && ast.length > 0) {
      this.isolatedInitialStream = true;
      this.cachedContentAst = [{ kind: "graphics-group", ops: [...ast] }];
      return this.cachedContentAst;
    }
    this.isolatedInitialStream = true;
    return ast;
  }

  setContentAst(nodes: PdfContentNode[], compress = true): void {
    this.cachedContentAst = [...nodes];
    const bytes = serializeContentAst(this.cachedContentAst);
    const streamObj = cosStream(bytes, { compress });
    const existingContents = dictGet(this.pageDict, "Contents");
    if (existingContents?.kind === "ref") {
      this.cosDoc.setObject(existingContents.objectNumber, streamObj, existingContents.generationNumber);
    } else {
      const ref = this.cosDoc.allocateObject(streamObj);
      dictSet(this.pageDict, "Contents", ref);
    }
    this.cachedContentsNode = dictGet(this.pageDict, "Contents");
  }

  drawText(text: string, options: DrawTextOptions): void {
    const size = options.size ?? options.fontSize ?? 12;
    const color = options.color ?? { r: 0, g: 0, b: 0 };
    const ast = this.getIsolatedContentAst();

    let fontResKey: string;
    let tokenNode;
    if (options.font && typeof options.font === "object" && options.font.kind === "truetype" && options.font.truetype) {
      const { hexBytes, usedGlyphs } = options.font.truetype.encodeTextToCidHex(text);
      fontResKey = this.ensureTrueTypeFontResource(options.font.truetype, usedGlyphs);
      tokenNode = cosHexString(hexBytes);
    } else {
      const stdName: Standard14FontName =
        typeof options.font === "string"
          ? options.font
          : options.font?.standardName ?? options.fontName ?? "Helvetica";
      fontResKey = this.ensureStandardFontResource(stdName);
      tokenNode = cosString(encodeWinAnsiBytes(text));
    }

    const rad = options.rotateRadians ?? 0;
    const cos = Math.cos(rad);
    const sin = Math.sin(rad);
    ast.push({
      kind: "graphics-group",
      ops: [
        {
          kind: "state-op",
          operator: "rg",
          operands: [cosNumber(color.r), cosNumber(color.g), cosNumber(color.b)],
        },
        {
          kind: "text-object",
          commands: [
            { kind: "font", fontName: fontResKey, size },
            { kind: "matrix", matrix: [cos, sin, -sin, cos, options.x, options.y] },
            { kind: "show-text", token: tokenNode },
          ],
        },
      ],
    });
    this.setContentAst(ast);
  }

  drawRect(options: DrawRectOptions): void {
    const ast = this.getIsolatedContentAst();
    const ops: PdfContentNode[] = [];
    if (options.fill) {
      ops.push({
        kind: "state-op",
        operator: "rg",
        operands: [cosNumber(options.fill.r), cosNumber(options.fill.g), cosNumber(options.fill.b)],
      });
    }
    if (options.stroke) {
      ops.push({
        kind: "state-op",
        operator: "RG",
        operands: [cosNumber(options.stroke.r), cosNumber(options.stroke.g), cosNumber(options.stroke.b)],
      });
    }
    if (options.strokeWidth !== undefined) {
      ops.push({
        kind: "state-op",
        operator: "w",
        operands: [cosNumber(options.strokeWidth)],
      });
    }
    const paint = options.fill && options.stroke ? "B" : options.fill ? "f" : "S";
    ops.push({
      kind: "path-op",
      segments: [
        {
          kind: "rect",
          x: options.x,
          y: options.y,
          width: options.width,
          height: options.height,
        },
      ],
      paint,
    });
    ast.push({ kind: "graphics-group", ops });
    this.setContentAst(ast);
  }

  drawLine(options: DrawLineOptions): void {
    const stroke = options.stroke ?? { r: 0, g: 0, b: 0 };
    const sw = options.strokeWidth ?? 1;
    this.drawPath(
      [
        { kind: "move", x: options.x1, y: options.y1 },
        { kind: "line", x: options.x2, y: options.y2 },
      ],
      { stroke, strokeWidth: sw }
    );
  }

  drawPath(segments: readonly PdfPathSegment[], options: DrawPathOptions = {}): void {
    const ast = this.getIsolatedContentAst();
    const ops: PdfContentNode[] = [];
    if (options.fill) {
      ops.push({
        kind: "state-op",
        operator: "rg",
        operands: [cosNumber(options.fill.r), cosNumber(options.fill.g), cosNumber(options.fill.b)],
      });
    }
    if (options.stroke) {
      ops.push({
        kind: "state-op",
        operator: "RG",
        operands: [cosNumber(options.stroke.r), cosNumber(options.stroke.g), cosNumber(options.stroke.b)],
      });
    }
    if (options.strokeWidth !== undefined) {
      ops.push({
        kind: "state-op",
        operator: "w",
        operands: [cosNumber(options.strokeWidth)],
      });
    }
    const evenOdd = options.fillRule === "evenodd";
    const paint =
      options.fill && options.stroke
        ? evenOdd
          ? "B*"
          : "B"
        : options.fill
          ? evenOdd
            ? "f*"
            : "f"
          : "S";
    ops.push({
      kind: "path-op",
      segments: [...segments],
      paint,
    });
    ast.push({ kind: "graphics-group", ops });
    this.setContentAst(ast);
  }

  drawImage(
    image: PdfImageHandle | { readonly width: number; readonly height: number; readonly data: Uint8Array },
    options: DrawImageOptions
  ): void {
    let handle: PdfImageHandle;
    if ("xobjectRef" in image && image.xobjectRef) {
      handle = image;
    } else {
      const bmp = image as { readonly width: number; readonly height: number; readonly data: Uint8Array };
      const pixelCount = bmp.width * bmp.height;
      let rgbBytes: Uint8Array;
      if (bmp.data.length === pixelCount * 4) {
        rgbBytes = new Uint8Array(pixelCount * 3);
        for (let i = 0, j = 0; i < bmp.data.length; i += 4, j += 3) {
          rgbBytes[j] = bmp.data[i]!;
          rgbBytes[j + 1] = bmp.data[i + 1]!;
          rgbBytes[j + 2] = bmp.data[i + 2]!;
        }
      } else {
        rgbBytes = bmp.data;
      }
      const streamObj = cosStream(rgbBytes, {
        dict: cosDict({
          Type: cosName("XObject"),
          Subtype: cosName("Image"),
          Width: cosNumber(bmp.width),
          Height: cosNumber(bmp.height),
          ColorSpace: cosName("DeviceRGB"),
          BitsPerComponent: cosNumber(8),
        }),
        compress: true,
      });
      const xobjectRef = this.cosDoc.allocateObject(streamObj);
      handle = { xobjectRef, width: bmp.width, height: bmp.height };
    }
    const w = options.width ?? handle.width;
    const h = options.height ?? handle.height;
    const resKey = this.ensureXObjectResource(handle.xobjectRef);
    const ast = this.getIsolatedContentAst();
    ast.push({
      kind: "graphics-group",
      ops: [
        {
          kind: "state-op",
          operator: "cm",
          operands: [
            cosNumber(w),
            cosNumber(0),
            cosNumber(0),
            cosNumber(h),
            cosNumber(options.x),
            cosNumber(options.y),
          ],
        },
        { kind: "xobject", name: resKey },
      ],
    });
    this.setContentAst(ast);
  }

  addLinkAnnotation(params: {
    readonly rect: readonly [number, number, number, number];
    readonly uri: string;
    readonly contents?: string | undefined;
  }): void {
    let annots = this.cosDoc.resolveArray(dictGet(this.pageDict, "Annots"));
    if (!annots) {
      annots = cosArray([]);
      dictSet(this.pageDict, "Annots", annots);
    }
    const annotDict = cosDict({
      Type: cosName("Annot"),
      Subtype: cosName("Link"),
      Rect: cosArray([
        cosNumber(params.rect[0]),
        cosNumber(params.rect[1]),
        cosNumber(params.rect[2]),
        cosNumber(params.rect[3]),
      ]),
      Border: cosArray([cosNumber(0), cosNumber(0), cosNumber(0)]),
      Contents: params.contents ? cosString(params.contents) : undefined,
      A: cosDict({
        Type: cosName("Action"),
        S: cosName("URI"),
        URI: cosString(params.uri),
      }),
    });
    annots.items.push(this.cosDoc.allocateObject(annotDict));
  }

  redact(
    regionsOrSingle:
      | readonly [number, number, number, number]
      | readonly (readonly [number, number, number, number])[],
    options?: RedactOptions
  ): void {
    const regions: readonly (readonly [number, number, number, number])[] =
      typeof regionsOrSingle[0] === "number"
        ? [regionsOrSingle as readonly [number, number, number, number]]
        : (regionsOrSingle as readonly (readonly [number, number, number, number])[]);
    const fontName = this.ensureStandardFontResource("Helvetica");
    const { width, height } = this.getSize();
    const redactedNodes = redactPageContentAst({
      pageIndex: this.index,
      width,
      height,
      nodes: this.getContentAst(),
      regions,
      cosDoc: this.cosDoc,
      resourcesDict: this.getResourcesDict(),
      options: { ...options, fontName },
    });
    this.setContentAst(redactedNodes);
  }

  evaluateDisplayList(options?: { readonly hideAnnotations?: boolean | undefined }): PdfDisplayList {
    const { width, height } = this.getSize();
    const baseNodes = [...this.getContentAst()];
    const pageRes = this.getResourcesDict();
    const evalResourcesDict = cosDict({});
    for (const entry of pageRes.entries) {
      const sub = this.cosDoc.resolveDict(entry.value);
      if (sub) {
        const clonedSub = cosDict({});
        for (const se of sub.entries) dictSet(clonedSub, se.key.decoded, se.value);
        dictSet(evalResourcesDict, entry.key.decoded, clonedSub);
      } else {
        dictSet(evalResourcesDict, entry.key.decoded, entry.value);
      }
    }

    const annotsArr = this.cosDoc.resolveArray(dictGet(this.pageDict, "Annots"));
    if (!options?.hideAnnotations && annotsArr && annotsArr.items.length > 0) {
      for (const item of annotsArr.items) {
        const annotDict = this.cosDoc.resolveDict(item);
        if (!annotDict) continue;
        const fNode = this.cosDoc.resolve(dictGet(annotDict, "F"));
        const annotFlags = fNode?.kind === "number" ? fNode.value : 0;
        // Skip Hidden (bit 2 = 2) or NoView (bit 6 = 32) annotations on screen
        if ((annotFlags & 2) !== 0 || (annotFlags & 32) !== 0) continue;
        if (!isOptionalContentVisible(this.cosDoc, dictGet(annotDict, "OC"))) continue;

        const rectArr = this.cosDoc.resolveArray(dictGet(annotDict, "Rect"));
        let rx0 = 50;
        let ry0 = 700;
        if (rectArr && rectArr.items.length >= 2) {
          const r0 = this.cosDoc.resolve(rectArr.items[0]);
          const r1 = this.cosDoc.resolve(rectArr.items[1]);
          if (r0?.kind === "number") rx0 = r0.value;
          if (r1?.kind === "number") ry0 = r1.value;
        }

        const parentDict = this.cosDoc.resolveDict(dictGet(annotDict, "Parent"));
        const ownAsOrV = dictGet(annotDict, "AS") ?? dictGet(annotDict, "V");
        const vNode = this.cosDoc.resolve(
          ownAsOrV ?? (parentDict ? dictGet(parentDict, "V") ?? dictGet(parentDict, "AS") : undefined)
        );

        let renderedApStream = false;
        const apDict = this.cosDoc.resolveDict(dictGet(annotDict, "AP"));
        let apN = apDict ? this.cosDoc.resolve(dictGet(apDict, "N")) : undefined;
        if (apN?.kind === "dict" && vNode?.kind === "name" && vNode.decoded !== "Off") {
          apN = this.cosDoc.resolve(dictGet(apN, vNode.decoded));
        }
        if (apN?.kind === "stream") {
          const apBytes = this.cosDoc.decodeStream(apN);
          const apNodes = parseContentStream(apBytes);
          if (apNodes.length > 0) {
            renderedApStream = true;
            const apRes = this.cosDoc.resolveDict(dictGet(apN.dict, "Resources"));
            if (apRes) {
              for (const subKey of ["Font", "XObject", "ExtGState", "ColorSpace", "Pattern", "Shading"]) {
                const srcSub = this.cosDoc.resolveDict(dictGet(apRes, subKey));
                if (!srcSub) continue;
                let dstSub = this.cosDoc.resolveDict(dictGet(evalResourcesDict, subKey));
                if (!dstSub) {
                  dstSub = cosDict({});
                  dictSet(evalResourcesDict, subKey, dstSub);
                }
                for (const se of srcSub.entries) {
                  if (!dictGet(dstSub, se.key.decoded)) {
                    dictSet(dstSub, se.key.decoded, se.value);
                  }
                }
              }
            }

            const r2Node = rectArr && rectArr.items[2] ? this.cosDoc.resolve(rectArr.items[2]) : undefined;
            const r3Node = rectArr && rectArr.items[3] ? this.cosDoc.resolve(rectArr.items[3]) : undefined;
            const rectW = r2Node?.kind === "number" ? Math.max(1, Math.abs(r2Node.value - rx0)) : 20;
            const rectH = r3Node?.kind === "number" ? Math.max(1, Math.abs(r3Node.value - ry0)) : 20;
            const bboxArr = this.cosDoc.resolveArray(dictGet(apN.dict, "BBox"));
            let bx0 = 0, by0 = 0, bw = rectW, bh = rectH;
            if (bboxArr && bboxArr.items.length >= 4) {
              const b0 = this.cosDoc.resolve(bboxArr.items[0]);
              const b1 = this.cosDoc.resolve(bboxArr.items[1]);
              const b2 = this.cosDoc.resolve(bboxArr.items[2]);
              const b3 = this.cosDoc.resolve(bboxArr.items[3]);
              if (b0?.kind === "number" && b1?.kind === "number" && b2?.kind === "number" && b3?.kind === "number") {
                bx0 = Math.min(b0.value, b2.value);
                by0 = Math.min(b1.value, b3.value);
                bw = Math.max(1, Math.abs(b2.value - b0.value));
                bh = Math.max(1, Math.abs(b3.value - b1.value));
              }
            }
            let ma = 1, mb = 0, mc = 0, md = 1, me = 0, mf = 0;
            const matArr = this.cosDoc.resolveArray(dictGet(apN.dict, "Matrix"));
            if (matArr && matArr.items.length >= 6) {
              const mn = (idx: number, fb = 0) => {
                const r = this.cosDoc.resolve(matArr.items[idx]);
                return r?.kind === "number" ? r.value : fb;
              };
              ma = mn(0, 1); mb = mn(1, 0); mc = mn(2, 0); md = mn(3, 1); me = mn(4, 0); mf = mn(5, 0);
            }
            const corners: Array<[number, number]> = [
              [ma * bx0 + mc * by0 + me, mb * bx0 + md * by0 + mf],
              [ma * (bx0 + bw) + mc * by0 + me, mb * (bx0 + bw) + md * by0 + mf],
              [ma * bx0 + mc * (by0 + bh) + me, mb * bx0 + md * (by0 + bh) + mf],
              [ma * (bx0 + bw) + mc * (by0 + bh) + me, mb * (bx0 + bw) + md * (by0 + bh) + mf],
            ];
            const tMinX = Math.min(...corners.map(c => c[0]));
            const tMinY = Math.min(...corners.map(c => c[1]));
            const tW = Math.max(1, Math.max(...corners.map(c => c[0])) - tMinX);
            const tH = Math.max(1, Math.max(...corners.map(c => c[1])) - tMinY);
            const sx = rectW / tW;
            const sy = rectH / tH;
            const tx = rx0 - tMinX * sx;
            const ty = ry0 - tMinY * sy;
            const ops: PdfContentNode[] = [
              {
                kind: "state-op",
                operator: "cm",
                operands: [
                  cosNumber(sx),
                  cosNumber(0),
                  cosNumber(0),
                  cosNumber(sy),
                  cosNumber(tx),
                  cosNumber(ty),
                ],
              },
            ];
            if (matArr && matArr.items.length >= 6) {
              ops.push({
                kind: "state-op",
                operator: "cm",
                operands: [
                  cosNumber(ma),
                  cosNumber(mb),
                  cosNumber(mc),
                  cosNumber(md),
                  cosNumber(me),
                  cosNumber(mf),
                ],
              });
            }
            ops.push(...apNodes);
            baseNodes.push({
              kind: "graphics-group",
              ops,
            });
          }
        }

        const subNode = this.cosDoc.resolve(dictGet(annotDict, "Subtype"));
        const isWidget =
          (subNode?.kind === "name" && subNode.decoded === "Widget") ||
          Boolean(dictGet(annotDict, "FT") || dictGet(annotDict, "T") || parentDict);
        if (!isWidget || renderedApStream) continue;

        let valText = "";
        if (vNode?.kind === "string") valText = decodePdfString(vNode);
        else if (vNode?.kind === "name" && vNode.decoded !== "Off") valText = vNode.decoded;
        if (!valText) continue;

        baseNodes.push({
          kind: "text-object",
          commands: [
            { kind: "font", fontName: "Helvetica", size: 11 },
            { kind: "move", tx: rx0 + 2, ty: ry0 + 4 },
            { kind: "show-text", token: cosString(valText) },
          ],
        });
      }
    }
    return evaluateContentStreamToDisplayList({
      pageIndex: this.index,
      width,
      height,
      rotation: this.getRotation(),
      nodes: baseNodes,
      cosDoc: this.cosDoc,
      resourcesDict: evalResourcesDict,
      annotations: extractPageAnnotations(this.cosDoc, this.pageDict),
    });
  }

  extractPage(options?: ExtractTextOptions): PdfExtractedPage {
    const dl = this.evaluateDisplayList();
    const extracted = extractPageFromDisplayList(dl, options);
    const tables = extractTablesFromDisplayList(dl);
    return {
      ...extracted,
      tables,
    };
  }

  extractText(options?: ExtractTextOptions): string {
    return formatExtractedPageText(this.extractPage(options), options);
  }

  extractTables(): PdfExtractedTable[] {
    return extractTablesFromDisplayList(this.evaluateDisplayList());
  }

  renderToPng(options?: RenderToPngOptions): Uint8Array {
    return renderDisplayListToPng(this.evaluateDisplayList(), options);
  }
}

export function createStandardFontHandle(standardName: Standard14FontName): PdfFontHandle {
  return {
    kind: "standard14",
    name: standardName,
    standardName,
    widthOfTextAtSize(text: string, size: number): number {
      return measureStandard14TextWidth(text, standardName, size);
    },
  };
}

export function createTrueTypeFontHandle(truetype: ParsedTrueTypeFont): PdfFontHandle {
  return {
    kind: "truetype",
    name: truetype.postScriptName,
    truetype,
    widthOfTextAtSize(text: string, size: number): number {
      return truetype.measureTextWidth(text, size);
    },
  };
}
